import { PRODUCT_GROUPS, PRODUCT_TYPES_BY_ID, productTypeName, resolveQuery, type QueryResolution } from "@/lib/presence/catalog";
import {
  estimatePresence,
  evidenceKey,
  groupEvidence,
  type PresenceEstimate,
  type PresenceEvidence,
  type PresenceTier
} from "@/lib/presence/evidence";
import { modifierFactor, priorFor, type PriorExplanation } from "@/lib/presence/priors";
import type { PresenceStoreRecord } from "@/lib/presence/stores";
import type { Locale, SearchResult, Store } from "@/lib/types";

export const MAX_RESULTS = 40;

// Store types that are a service (rendered as such in the UI); the rest are shop-discovery.
const SERVICE_TYPE_IDS = new Set([
  "store_phone_repair",
  "store_computer_repair",
  "store_bike_repair",
  "store_key_copy",
  "store_shoe_repair",
  "store_tailor",
  "store_print_copy",
  "store_internet_cafe"
]);

// Walking-distance trade-off: a store 700 m away needs twice the probability of one next door.
const DISTANCE_HALF_SCORE_METERS = 700;
const CONFIRMED_RANK_PROBABILITY = 0.85;

const TIER_TO_VALIDATION: Record<PresenceTier, SearchResult["validationStatus"]> = {
  confirmed: "validated",
  likely: "likely",
  possible: "unvalidated",
  reported_missing: "rejected",
  unlikely: "rejected"
};

const TIER_TO_AVAILABILITY: Record<PresenceTier, SearchResult["availabilityStatus"]> = {
  confirmed: "confirmed",
  likely: "likely",
  possible: "unknown",
  reported_missing: "rejected",
  unlikely: "rejected"
};

export type PresenceCandidate = {
  store: PresenceStoreRecord;
  typeId: string;
  estimate: PresenceEstimate;
  prior: PriorExplanation;
  modifierFactor: number;
  distanceMeters: number;
  score: number;
};

export type PresenceSearchOutput = {
  resolution: QueryResolution;
  results: SearchResult[];
  candidates: PresenceCandidate[];
};

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

export function rankScore(probability: number, distanceMeters: number): number {
  return probability / (1 + distanceMeters / DISTANCE_HALF_SCORE_METERS);
}

function storeFromRecord(record: PresenceStoreRecord): Store {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    district: record.district,
    openingHours: record.openingHours ?? "",
    lat: record.lat,
    lng: record.lng,
    website: record.website,
    phone: record.phone,
    appCategories: record.appCategories,
    osmCategory: record.osmCategory,
    ownershipType: record.brand ? "chain" : "unknown"
  };
}

const WHY_TEXT: Record<Locale, Record<PresenceTier, string>> = {
  en: {
    confirmed: "Confirmed by neighbours",
    likely: "Likely: shops of this type usually carry it",
    possible: "Possible: some shops of this type carry it",
    reported_missing: "Recently reported as not available",
    unlikely: "Unlikely"
  },
  de: {
    confirmed: "Von Nachbarn bestätigt",
    likely: "Wahrscheinlich: Läden dieser Art führen es meistens",
    possible: "Möglich: manche Läden dieser Art führen es",
    reported_missing: "Kürzlich als nicht vorrätig gemeldet",
    unlikely: "Unwahrscheinlich"
  },
  es: {
    confirmed: "Confirmado por vecinos",
    likely: "Probable: las tiendas de este tipo suelen tenerlo",
    possible: "Posible: algunas tiendas de este tipo lo tienen",
    reported_missing: "Reportado recientemente como no disponible",
    unlikely: "Poco probable"
  }
};

export function toSearchResult(candidate: PresenceCandidate, rank: number, locale: Locale): SearchResult {
  const type = PRODUCT_TYPES_BY_ID.get(candidate.typeId);
  const { estimate } = candidate;
  const updatedAt = estimate.lastEvidenceAt ?? new Date(0).toISOString();
  const freshnessHours = estimate.lastEvidenceAt
    ? Math.max(0, (Date.now() - Date.parse(estimate.lastEvidenceAt)) / 3_600_000)
    : 24 * 365;
  return {
    store: storeFromRecord(candidate.store),
    product: {
      id: candidate.typeId,
      normalizedName: productTypeName(candidate.typeId, "en").toLowerCase(),
      displayName: productTypeName(candidate.typeId, locale),
      brand: null,
      category: type?.group ?? "other"
    },
    offer: {
      id: `${candidate.store.id}:${candidate.typeId}`,
      storeId: candidate.store.id,
      productId: candidate.typeId,
      priceOptional: null,
      availability: estimate.tier === "confirmed" ? "in_stock" : "unknown",
      updatedAt
    },
    distanceMeters: candidate.distanceMeters,
    freshnessHours,
    rank,
    confidence: Number(estimate.probability.toFixed(3)),
    validationStatus: TIER_TO_VALIDATION[estimate.tier],
    availabilityStatus: TIER_TO_AVAILABILITY[estimate.tier],
    whyThisProductMatches: WHY_TEXT[locale][estimate.tier],
    lastCheckedAt: estimate.lastEvidenceAt,
    sourceType: estimate.positiveWeight > 0 ? "user_validated" : "rules_generated",
    resultKind: SERVICE_TYPE_IDS.has(candidate.typeId) ? "service" : "product"
  };
}

export type PresenceSearchArgs = {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  stores: PresenceStoreRecord[];
  evidence: PresenceEvidence[];
  locale?: Locale;
  resolution?: QueryResolution;
  limit?: number;
  now?: number;
};

/**
 * Honest search: only shops whose estimated probability of carrying the product type is at
 * least "possible" are returned, ordered by probability discounted by walking distance.
 * There is no fallback to "other products of the same group" — an unknown query returns
 * nothing (and is logged as demand) instead of strawberries for "garlic".
 */
export function searchPresence(args: PresenceSearchArgs): PresenceSearchOutput {
  const locale = args.locale ?? "de";
  const resolution = args.resolution ?? resolveQuery(args.query);
  if (!resolution.resolved) {
    return { resolution, results: [], candidates: [] };
  }
  const evidenceByKey = groupEvidence(args.evidence);
  const now = args.now ?? Date.now();
  const bestPerStore = new Map<string, PresenceCandidate>();

  for (const store of args.stores) {
    const distanceMeters = haversineMeters(args.lat, args.lng, store.lat, store.lng);
    if (distanceMeters > args.radiusMeters) {
      continue;
    }
    let factor = 1;
    for (const modifierId of resolution.modifiers) {
      factor *= modifierFactor(store, modifierId);
    }
    for (const match of resolution.types) {
      const type = PRODUCT_TYPES_BY_ID.get(match.typeId);
      if (!type) {
        continue;
      }
      const prior = priorFor(store, type);
      const evidence = evidenceByKey.get(evidenceKey(store.id, type.id)) ?? [];
      if (prior.probability <= 0 && evidence.length === 0) {
        continue;
      }
      const estimate = estimatePresence(prior.probability * factor, evidence, now);
      if (estimate.tier === "unlikely" || estimate.tier === "reported_missing") {
        continue;
      }
      // A recent sighting is worth more than any category guess: rank it as near-certain.
      const rankProbability =
        estimate.tier === "confirmed" ? Math.max(estimate.probability, CONFIRMED_RANK_PROBABILITY) : estimate.probability;
      const candidate: PresenceCandidate = {
        store,
        typeId: type.id,
        estimate,
        prior,
        modifierFactor: factor,
        distanceMeters,
        score: rankScore(rankProbability, distanceMeters)
      };
      const previous = bestPerStore.get(store.id);
      if (!previous || previous.score < candidate.score) {
        bestPerStore.set(store.id, candidate);
      }
    }
  }

  const candidates = Array.from(bestPerStore.values()).sort((a, b) => b.score - a.score);
  const limited = candidates.slice(0, args.limit ?? MAX_RESULTS);
  return {
    resolution,
    candidates: limited,
    results: limited.map((candidate, index) => toSearchResult(candidate, index + 1, locale))
  };
}

export type StorePresenceItem = {
  typeId: string;
  name: string;
  group: string;
  groupName: string;
  estimate: PresenceEstimate;
};

// What a single store most likely carries, for the store page (types only, no services).
export function storePresenceProfile(
  store: PresenceStoreRecord,
  evidence: PresenceEvidence[],
  locale: Locale,
  now: number = Date.now()
): StorePresenceItem[] {
  const evidenceByKey = groupEvidence(evidence);
  const items: StorePresenceItem[] = [];
  for (const type of PRODUCT_TYPES_BY_ID.values()) {
    if (type.kind !== "product") {
      continue;
    }
    const prior = priorFor(store, type);
    const rows = evidenceByKey.get(evidenceKey(store.id, type.id)) ?? [];
    if (prior.probability < 0.3 && rows.length === 0) {
      continue;
    }
    const estimate = estimatePresence(prior.probability, rows, now);
    if (estimate.tier === "unlikely" && rows.length === 0) {
      continue;
    }
    items.push({
      typeId: type.id,
      name: type.names[locale],
      group: type.group,
      groupName: PRODUCT_GROUPS[type.group]?.[locale] ?? type.group,
      estimate
    });
  }
  return items.sort((a, b) => b.estimate.probability - a.estimate.probability);
}
