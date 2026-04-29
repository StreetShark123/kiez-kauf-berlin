import { normalizeQuery } from "@/lib/maps";
import { mockOffers, mockProducts, mockStores } from "@/lib/mock-data";
import { hasSupabase, supabase } from "@/lib/supabase";
import type { Offer, Product, SearchResult, Store, StoreDetail } from "@/lib/types";
import {
  applyVocabularyTypos,
  BROAD_QUERY_TERMS,
  GENERIC_QUERY_TERMS,
  getCandidateGroupsFromVocabulary,
  KEYWORD_GROUP_MAP,
  KEYWORD_GROUP_TERMS_BY_GROUP
} from "@/lib/vocabulary";

// Berlin Mitte (Alexanderplatz area) as the default map/search center.
const BERLIN_CENTER = { lat: 52.5208, lng: 13.4094 };
const DEV_DEBUG = process.env.NODE_ENV !== "production";
const MAX_INFERRED_GROUPS = 4;
const MIN_GROUP_SCORE = 2;
const CHAIN_NAME_HINTS = [
  "dm",
  "rossmann",
  "aldi",
  "lidl",
  "rewe",
  "edeka",
  "kaufland",
  "obi",
  "bauhaus",
  "hornbach",
  "mediamarkt",
  "saturn",
  "ikea",
  "douglas",
  "fressnapf",
  "muller"
];
const SERVICE_ONLY_OSM_CATEGORIES = new Set(["beauty", "cosmetics", "perfumery", "hairdresser"]);
const SERVICE_ONLY_APP_CATEGORIES = new Set(["beauty"]);
const SERVICE_BEAUTY_NAME_HINTS = [
  "depil",
  "laser",
  "wax",
  "kosmetikstudio",
  "kosmetik",
  "beauty salon",
  "beautybar",
  "nail",
  "lashes",
  "brow",
  "friseur",
  "hair",
  "barber",
  "spa",
  "sun tower",
  "sun studio",
  "massage"
];
const GROUP_FALLBACK_OSM_ALLOWLIST: Record<string, string[]> = {
  groceries: ["supermarket", "convenience", "deli", "kiosk", "department_store", "mall", "health_food"],
  fresh_produce: ["supermarket", "greengrocer", "convenience", "health_food", "deli", "marketplace"],
  beverages: ["supermarket", "convenience", "beverages", "kiosk", "department_store", "deli"],
  household: ["doityourself", "hardware", "department_store", "supermarket", "mall", "convenience"],
  pharmacy: ["pharmacy", "chemist", "medical_supply", "department_store", "mall"],
  personal_care: ["pharmacy", "chemist", "medical_supply", "department_store", "mall"],
  pet_care: ["pet", "supermarket", "department_store", "mall", "convenience"],
  snacks: ["supermarket", "convenience", "kiosk", "beverages", "department_store", "deli"]
};
const GROUP_FALLBACK_APP_CATEGORY_ALLOWLIST: Record<string, string[]> = {
  groceries: ["grocery", "convenience", "bio", "produce", "fresh-food"],
  fresh_produce: ["produce", "fresh-food", "grocery", "bio"],
  beverages: ["drinks", "grocery", "convenience", "bio", "bakery"],
  household: ["household", "hardware", "grocery", "convenience"],
  pharmacy: ["pharmacy", "medical-supplies"],
  personal_care: ["personal-care", "pharmacy", "medical-supplies"],
  pet_care: ["pet", "grocery", "convenience"],
  snacks: ["convenience", "grocery", "bakery", "drinks"]
};
const STRATEGY_AUGMENT_THRESHOLD = 110;
const SERVICE_INTENT_QUERY_HINTS = [
  "repair",
  "reparatur",
  "fix",
  "service",
  "servicio",
  "pedicure",
  "manicure",
  "haircut",
  "barber",
  "nail",
  "nails",
  "waxing",
  "depilation",
  "massage",
  "alteration",
  "tailoring",
  "tailor",
  "schneiderei",
  "tailor",
  "schneid",
  "shoe repair",
  "cobbler",
  "key copy",
  "key cutting",
  "locksmith",
  "schluessel",
  "schlussel",
  "bike repair",
  "fahrrad reparatur",
  "phone repair",
  "iphone repair",
  "screen repair",
  "copy shop",
  "druck",
  "dry cleaning",
  "shoe glue"
];
const SERVICE_SINGLE_TOKEN_HINTS = new Set([
  "repair",
  "reparatur",
  "pedicure",
  "manicure",
  "barber",
  "haircut",
  "massage",
  "locksmith",
  "schluessel",
  "schlussel",
  "tailor",
  "tailoring",
  "schneiderei",
  "cobbler",
  "alteration"
]);
const STRICT_GROUP_TOKEN_MATCH = new Set([
  "household",
  "pharmacy",
  "personal_care",
  "pet_care",
  "beverages"
]);
const STORE_ROLE_SERVICE_PRIORITIES = new Set([
  "repair_service",
  "sells_services",
  "beauty_personal_care",
  "health_care",
  "specialist_retail"
]);

function isSchemaCompatibilityError(message: string | undefined): boolean {
  const lower = String(message ?? "").toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("permission denied") ||
    lower.includes("relation") ||
    lower.includes("column") ||
    lower.includes("schema")
  );
}

function inferOwnershipTypeFromStoreName(name: string | null | undefined): Store["ownershipType"] {
  const normalized = normalizeQuery(name ?? "");
  if (!normalized) {
    return "unknown";
  }

  if (CHAIN_NAME_HINTS.some((hint) => normalized.includes(hint))) {
    return "chain";
  }

  if (normalized.split(" ").length >= 2) {
    return "independent";
  }

  return "unknown";
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadius = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);

  const part1 =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const part2 = 2 * Math.atan2(Math.sqrt(part1), Math.sqrt(1 - part1));
  return earthRadius * part2;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValidStoreCoordinates(
  store: { lat?: unknown; lng?: unknown } | null | undefined
): store is { lat: number; lng: number } {
  return (
    !!store &&
    isFiniteCoordinate(store.lat) &&
    isFiniteCoordinate(store.lng) &&
    store.lat >= -90 &&
    store.lat <= 90 &&
    store.lng >= -180 &&
    store.lng <= 180
  );
}

function debugMalformedRecord(context: string, payload: unknown) {
  if (!DEV_DEBUG) {
    return;
  }
  console.warn(`[search-data-guard] ${context}`, payload);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getBoundingBoxFromRadius(args: {
  lat: number;
  lng: number;
  radiusMeters: number;
}): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lat = clamp(args.lat, -90, 90);
  const lng = clamp(args.lng, -180, 180);
  const radius = Math.max(100, args.radiusMeters);
  const latDelta = radius / 111320;
  const cosLat = Math.max(0.1, Math.abs(Math.cos(toRadians(lat))));
  const lngDelta = radius / (111320 * cosLat);

  return {
    minLat: clamp(lat - latDelta, -90, 90),
    maxLat: clamp(lat + latDelta, -90, 90),
    minLng: clamp(lng - lngDelta, -180, 180),
    maxLng: clamp(lng + lngDelta, -180, 180)
  };
}

type JoinedRow = {
  offer: Offer;
  product: Product;
  store: Store;
  confidence?: number | null;
  validationStatus?: SearchResult["validationStatus"];
  whyThisProductMatches?: string | null;
  lastCheckedAt?: string | null;
  sourceType?: SearchResult["sourceType"];
  candidateFreshnessScore?: number | null;
  establishmentFreshnessScore?: number | null;
  matchedByStrategy?: DatasetSearchStrategy | null;
};

type SupabaseOfferRow = {
  id: string;
  store_id: string;
  product_id: string;
  price_optional: number | null;
  availability: string;
  updated_at: string;
  stores:
    | {
        id: string;
        name: string;
        address: string;
        district: string;
        opening_hours: string;
        lat: number;
        lng: number;
        website?: string | null;
        phone?: string | null;
      }
    | null
    | Array<{
        id: string;
        name: string;
        address: string;
        district: string;
        opening_hours: string;
        lat: number;
        lng: number;
        website?: string | null;
        phone?: string | null;
      }>;
  products:
    | {
        id: string;
        normalized_name: string;
        brand: string | null;
        category: string;
      }
    | null
    | Array<{
        id: string;
        normalized_name: string;
        brand: string | null;
        category: string;
      }>;
};

type SupabaseSearchDatasetRow = {
  establishment_id: number;
  canonical_product_id: number;
  source_type: SearchResult["sourceType"];
  confidence: number;
  validation_status: SearchResult["validationStatus"];
  why_this_product_matches: string | null;
  candidate_last_checked_at?: string | null;
  candidate_freshness_score?: number | null;
  updated_at: string;
  establishment_name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  opening_hours?: string | null;
  freshness_score?: number | null;
  source_url?: string | null;
  product_normalized_name: string;
  product_group: string;
};

type SupabaseEstablishmentMetadataRow = {
  id: number;
  phone: string | null;
  website: string | null;
  name: string | null;
};

type SupabaseCanonicalProductRow = {
  id: number;
  normalized_name: string;
  display_name_en: string | null;
  display_name_es: string | null;
  display_name_de: string | null;
  group_key?: string | null;
  is_active?: boolean | null;
  synonyms: string[] | null;
  product_group: string;
};

type SupabaseCanonicalProductAliasRow = {
  canonical_product_id: number;
  alias: string;
  is_active: boolean | null;
};

type SupabaseCanonicalProductFacetRow = {
  canonical_product_id: number;
  facet_normalized: string;
};

type SupabaseCanonicalServiceRow = {
  id: number;
  slug: string;
  display_name_en: string | null;
  display_name_es: string | null;
  display_name_de: string | null;
  group_key: string | null;
  is_active: boolean | null;
};

type SupabaseCanonicalServiceAliasRow = {
  canonical_service_id: number;
  alias: string;
  is_active: boolean | null;
};

type SupabaseServiceSearchRow = {
  establishment_id: number;
  canonical_service_id: number;
  primary_source_type: SearchResult["sourceType"];
  confidence: number;
  validation_status: SearchResult["validationStatus"];
  availability_status: SearchResult["availabilityStatus"];
  why_this_service_matches: string | null;
  source_url: string | null;
  updated_at: string;
  canonical_services:
    | {
        id: number;
        slug: string;
        display_name_en: string | null;
        display_name_de: string | null;
        display_name_es: string | null;
        group_key: string | null;
      }
    | Array<{
        id: number;
        slug: string;
        display_name_en: string | null;
        display_name_de: string | null;
        display_name_es: string | null;
        group_key: string | null;
      }>
    | null;
  establishments:
    | {
        id: number;
        name: string | null;
        address: string | null;
        district: string | null;
        lat: number | null;
        lon: number | null;
        opening_hours: string | null;
        website: string | null;
        phone: string | null;
        osm_category: string | null;
        app_categories: string[] | null;
      }
    | Array<{
        id: number;
        name: string | null;
        address: string | null;
        district: string | null;
        lat: number | null;
        lon: number | null;
        opening_hours: string | null;
        website: string | null;
        phone: string | null;
        osm_category: string | null;
        app_categories: string[] | null;
      }>
    | null;
};

type SupabaseStoreCapabilityProfileRow = {
  establishment_id: number;
  store_type: string | null;
  business_roles: string[] | null;
  likely_products: string[] | null;
  likely_services: string[] | null;
  confidence: number | null;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected" | null;
  profile_version: string;
  updated_at: string;
};

type StoreCapabilityProfile = {
  establishmentId: number;
  storeType: string | null;
  businessRoles: string[];
  likelyProducts: string[];
  likelyServices: string[];
  confidence: number;
  validationStatus: "unvalidated" | "likely" | "validated" | "rejected" | null;
  profileVersion: string;
  updatedAt: string;
};

type DatasetSearchStrategy =
  | "product_name"
  | "canonical_multilingual"
  | "group_keyword"
  | "category_intent";

type DatasetSearchResponse = {
  rows: JoinedRow[];
  strategy: DatasetSearchStrategy;
};

const MAX_SEARCH_RESULTS = 80;
const MIN_CONFIDENCE_FOR_WEAK_MATCH = 0.28;

let canonicalCatalogCache:
  | {
      loadedAt: number;
      rows: SupabaseCanonicalProductRow[];
    }
  | null = null;

let canonicalServiceCatalogCache:
  | {
      loadedAt: number;
      rows: SupabaseCanonicalServiceRow[];
      aliasesByServiceId: Map<number, Set<string>>;
    }
  | null = null;

const CANONICAL_CACHE_TTL_MS = 1000 * 60 * 10;
const APP_CATEGORY_INTENT_MAP: Array<{ category: string; terms: string[] }> = [
  {
    category: "pharmacy",
    terms: [
      "pharmacy",
      "apotheke",
      "chemist",
      "condom",
      "condoms",
      "tampon",
      "tampons",
      "pregnancy test",
      "painkiller",
      "ibuprofen",
      "paracetamol"
    ]
  },
  {
    category: "hardware",
    terms: [
      "hardware",
      "hammer",
      "screwdriver",
      "pliers",
      "wrench",
      "drill",
      "nails",
      "glue",
      "lightbulb",
      "light bulb",
      "fuse"
    ]
  },
  {
    category: "electronics",
    terms: [
      "usb c cable",
      "usb cable",
      "charger",
      "phone charger",
      "adapter",
      "travel adapter",
      "lightning cable",
      "hdmi cable",
      "power bank"
    ]
  },
  {
    category: "beauty",
    terms: [
      "wax",
      "waxing",
      "depilation",
      "hair removal",
      "eyebrow",
      "brow",
      "lashes",
      "nails",
      "manicure",
      "pedicure",
      "beauty",
      "beauty salon",
      "kosmetik",
      "kosmetikstudio"
    ]
  },
  {
    category: "art",
    terms: [
      "art",
      "arts",
      "art supplies",
      "watercolor",
      "watercolour",
      "watercolor paint",
      "paint brush",
      "paintbrush",
      "brushes",
      "sketchbook",
      "craft",
      "crafts",
      "stationery",
      "papeleria",
      "papeleria tecnica",
      "kunst",
      "kunstbedarf",
      "schreibwaren"
    ]
  },
  {
    category: "antiques",
    terms: ["antique", "antiques", "antiquities", "vintage", "antiguedades", "antik", "antikladen"]
  },
  {
    category: "second-hand",
    terms: [
      "second hand",
      "second-hand",
      "secondhand",
      "thrift",
      "thrift shop",
      "charity shop",
      "used clothes",
      "vintage clothes",
      "gebraucht",
      "gebrauchtwaren",
      "humana"
    ]
  }
];
const APP_CATEGORY_INTENT_OSM_ALLOWLIST: Record<string, string[]> = {
  pharmacy: ["pharmacy", "chemist", "medical_supply"],
  hardware: ["doityourself", "hardware"],
  electronics: ["electronics", "mobile_phone", "computer", "hifi", "appliance", "convenience", "kiosk"],
  beauty: ["beauty", "cosmetics", "perfumery", "hairdresser", "chemist"],
  art: ["art", "stationery", "craft", "antiques", "books", "second_hand"],
  antiques: ["antiques", "art", "second_hand", "books", "stationery", "craft"],
  "second-hand": ["second_hand", "charity", "antiques"]
};
const APP_CATEGORY_INTENT_GROUP_ALLOWLIST: Record<string, string[]> = {
  pharmacy: ["pharmacy", "personal_care"],
  hardware: ["household"],
  electronics: ["household"],
  beauty: ["personal_care", "pharmacy"],
  "second-hand": ["household", "personal_care", "groceries"]
};

function inferAppCategoryIntents(query: string): string[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }

  const queryTokens = new Set(splitNormalizedTokens(normalized));
  const matched = new Set<string>();

  for (const { category, terms } of APP_CATEGORY_INTENT_MAP) {
    const normalizedTerms = terms.map((term) => normalizeSearchQuery(term)).filter(Boolean);
    for (const term of normalizedTerms) {
      if (term === normalized) {
        matched.add(category);
        break;
      }

      const termTokens = splitNormalizedTokens(term);
      if (termTokens.length > 0 && termTokens.every((token) => queryTokens.has(token))) {
        matched.add(category);
        break;
      }
    }
  }

  return Array.from(matched);
}

function normalizedContains(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

function splitNormalizedTokens(value: string): string[] {
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeSearchQuery(value: string): string {
  const normalized = normalizeQuery(value);
  return applyVocabularyTypos(normalized);
}

async function fetchStoreCapabilityProfilesByStoreIds(
  storeIds: string[]
): Promise<Map<string, StoreCapabilityProfile>> {
  if (!supabase || storeIds.length === 0) {
    return new Map();
  }

  const establishmentIds = Array.from(
    new Set(
      storeIds
        .map((storeId) => Number(storeId))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  if (establishmentIds.length === 0) {
    return new Map();
  }

  const { data: liteData, error: liteError } = await supabase
    .from("store_capabilities_lite_v1")
    .select(
      "establishment_id, store_role_primary, profile_roles, likely_products, likely_services, profile_confidence, profile_validation_status, updated_at"
    )
    .in("establishment_id", establishmentIds);

  let rows: SupabaseStoreCapabilityProfileRow[] = [];
  if (liteError) {
    const { data, error } = await supabase
      .from("store_capability_profiles")
      .select(
        "establishment_id, store_type, business_roles, likely_products, likely_services, confidence, validation_status, profile_version, updated_at"
      )
      .in("establishment_id", establishmentIds)
      .eq("profile_version", "v1");

    if (error) {
      if (isSchemaCompatibilityError(error.message)) {
        return new Map();
      }
      throw new Error(`Supabase store capability profile query failed: ${error.message}`);
    }
    rows = (data ?? []) as SupabaseStoreCapabilityProfileRow[];
  } else {
    rows = ((liteData ?? []) as Array<Record<string, unknown>>).map((row) => ({
      establishment_id: Number(row.establishment_id),
      store_type: typeof row.store_role_primary === "string" ? row.store_role_primary : null,
      business_roles: Array.isArray(row.profile_roles)
        ? (row.profile_roles as string[])
        : [],
      likely_products: Array.isArray(row.likely_products)
        ? (row.likely_products as string[])
        : [],
      likely_services: Array.isArray(row.likely_services)
        ? (row.likely_services as string[])
        : [],
      confidence:
        typeof row.profile_confidence === "number"
          ? row.profile_confidence
          : Number(row.profile_confidence ?? 0),
      validation_status:
        typeof row.profile_validation_status === "string"
          ? (row.profile_validation_status as SupabaseStoreCapabilityProfileRow["validation_status"])
          : null,
      profile_version: "v1",
      updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString()
    }));
  }

  const byStoreId = new Map<string, StoreCapabilityProfile>();

  for (const row of rows) {
    const key = String(row.establishment_id);
    const candidate: StoreCapabilityProfile = {
      establishmentId: row.establishment_id,
      storeType: row.store_type,
      businessRoles: Array.isArray(row.business_roles) ? row.business_roles.map((value) => normalizeQuery(String(value))).filter(Boolean) : [],
      likelyProducts: Array.isArray(row.likely_products) ? row.likely_products.map((value) => normalizeQuery(String(value))).filter(Boolean) : [],
      likelyServices: Array.isArray(row.likely_services) ? row.likely_services.map((value) => normalizeQuery(String(value))).filter(Boolean) : [],
      confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0),
      validationStatus: row.validation_status ?? null,
      profileVersion: row.profile_version,
      updatedAt: row.updated_at
    };

    const existing = byStoreId.get(key);
    if (!existing) {
      byStoreId.set(key, candidate);
      continue;
    }

    const existingScore =
      validationRank(existing.validationStatus) * 1000 +
      Math.round((existing.confidence || 0) * 100);
    const nextScore =
      validationRank(candidate.validationStatus) * 1000 +
      Math.round((candidate.confidence || 0) * 100);

    if (nextScore > existingScore) {
      byStoreId.set(key, candidate);
    }
  }

  return byStoreId;
}

function profileSupportsServiceIntent(
  profile: StoreCapabilityProfile | null | undefined,
  normalizedQuery: string
): boolean {
  if (!profile) {
    return false;
  }

  const hasRoleSupport = profile.businessRoles.some((role) => STORE_ROLE_SERVICE_PRIORITIES.has(role));
  if (hasRoleSupport) {
    return true;
  }

  if (!normalizedQuery) {
    return false;
  }

  return profile.likelyServices.some((service) => normalizedFuzzyMatch(service, normalizedQuery));
}

function profileContradictsProductIntent(
  profile: StoreCapabilityProfile | null | undefined,
  normalizedQuery: string
): boolean {
  if (!profile || !normalizedQuery) {
    return false;
  }

  const hasProductRole =
    profile.businessRoles.includes("sells_physical_products") ||
    profile.businessRoles.includes("food_grocery") ||
    profile.businessRoles.includes("specialist_retail") ||
    profile.businessRoles.includes("health_care");

  if (hasProductRole) {
    return false;
  }

  const hasLikelyProductSignal = profile.likelyProducts.some((term) => normalizedFuzzyMatch(term, normalizedQuery));
  if (hasLikelyProductSignal) {
    return false;
  }

  return true;
}

function levenshteinDistanceWithinLimit(a: string, b: string, maxDistance: number): number {
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function isFuzzyTokenMatch(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }

  const longestLength = Math.max(a.length, b.length);
  if (longestLength < 4) {
    return false;
  }

  const maxDistance = longestLength >= 8 ? 2 : 1;
  return levenshteinDistanceWithinLimit(a, b, maxDistance) <= maxDistance;
}

function normalizedFuzzyMatch(term: string, normalizedQuery: string): boolean {
  if (!term || !normalizedQuery) {
    return false;
  }
  if (normalizedContains(term, normalizedQuery)) {
    return true;
  }

  const termTokens = splitNormalizedTokens(term);
  const queryTokens = splitNormalizedTokens(normalizedQuery);
  if (termTokens.length === 0 || queryTokens.length === 0) {
    return false;
  }

  return queryTokens.every((queryToken) =>
    termTokens.some((termToken) => isFuzzyTokenMatch(termToken, queryToken))
  );
}

function hasMeaningfulTokenMatch(productNameNormalized: string, normalizedQuery: string): boolean {
  const productTokens = splitNormalizedTokens(productNameNormalized);
  const queryTokens = splitNormalizedTokens(normalizedQuery).filter((token) => token.length >= 4);
  if (productTokens.length === 0 || queryTokens.length === 0) {
    return false;
  }

  return queryTokens.some((queryToken) =>
    productTokens.some((productToken) => {
      if (
        productToken === queryToken ||
        productToken.includes(queryToken) ||
        queryToken.includes(productToken)
      ) {
        return true;
      }
      return isFuzzyTokenMatch(productToken, queryToken);
    })
  );
}

function isSpecificProductQuery(normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return false;
  }
  if (GENERIC_QUERY_TERMS.has(normalizedQuery) || BROAD_QUERY_TERMS.has(normalizedQuery)) {
    return false;
  }

  const queryTokens = splitNormalizedTokens(normalizedQuery);
  if (queryTokens.length === 0) {
    return false;
  }

  if (queryTokens.length === 1) {
    return queryTokens[0].length >= 5;
  }

  return queryTokens.some((token) => token.length >= 4);
}

function isLikelyServiceIntentQuery(normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return false;
  }

  if (SERVICE_INTENT_QUERY_HINTS.some((hint) => normalizedQuery.includes(hint))) {
    return true;
  }

  const tokens = splitNormalizedTokens(normalizedQuery);
  if (tokens.length === 1 && SERVICE_SINGLE_TOKEN_HINTS.has(tokens[0])) {
    return true;
  }
  const hasServiceVerb = tokens.some((token) =>
    ["repair", "reparatur", "fix", "service", "servicio"].includes(token)
  );
  const hasObjectToken = tokens.some((token) =>
    [
      "bike",
      "fahrrad",
      "phone",
      "iphone",
      "screen",
      "shoe",
      "key",
      "lock",
      "copy",
      "print",
      "tailor"
    ].includes(token)
  );

  return hasServiceVerb && hasObjectToken;
}

function keepProductResultForServiceIntent(result: SearchResult, normalizedQuery: string): boolean {
  const productName = normalizeSearchQuery(result.product.normalizedName ?? "");
  const hasDirectMatch =
    productName === normalizedQuery ||
    productName.includes(normalizedQuery) ||
    normalizedFuzzyMatch(productName, normalizedQuery);
  const confidence = typeof result.confidence === "number" ? result.confidence : 0;
  const trustedSource =
    result.validationStatus === "validated" ||
    result.sourceType === "user_validated" ||
    result.sourceType === "merchant_added" ||
    result.sourceType === "website_extracted";

  return hasDirectMatch && trustedSource && confidence >= 0.86;
}

function shouldKeepGroupFallbackRow(args: {
  normalizedQuery: string;
  productNameNormalized: string;
  productGroup?: string | null;
  osmCategory?: string | null;
  appCategories?: string[] | null;
  storeName?: string | null;
  confidence: number;
  sourceType: SearchResult["sourceType"] | null | undefined;
  validationStatus: SearchResult["validationStatus"] | null | undefined;
  matchedByStrategy?: DatasetSearchStrategy | null;
}): boolean {
  const {
    normalizedQuery,
    productNameNormalized,
    productGroup,
    osmCategory,
    appCategories,
    storeName,
    confidence,
    sourceType,
    validationStatus,
    matchedByStrategy
  } = args;

  if (!isSpecificProductQuery(normalizedQuery)) {
    return true;
  }

  const hasStrongTextMatch =
    productNameNormalized === normalizedQuery ||
    productNameNormalized.includes(normalizedQuery) ||
    normalizedFuzzyMatch(productNameNormalized, normalizedQuery) ||
    hasMeaningfulTokenMatch(productNameNormalized, normalizedQuery);

  if (hasStrongTextMatch) {
    return true;
  }

  const normalizedGroup = normalizeQuery(String(productGroup ?? "")).replace(/\s+/g, "_");
  const normalizedOsmCategory = normalizeQuery(String(osmCategory ?? ""));
  const normalizedAppCategories = Array.isArray(appCategories)
    ? appCategories.map((value) => normalizeQuery(String(value ?? ""))).filter(Boolean)
    : [];
  const normalizedStoreName = normalizeQuery(String(storeName ?? ""));
  const isChainStore =
    normalizedStoreName.length > 0 &&
    CHAIN_NAME_HINTS.some((hint) => normalizedStoreName.includes(hint));
  const isServiceOnlyStore =
    SERVICE_ONLY_OSM_CATEGORIES.has(normalizedOsmCategory) ||
    normalizedAppCategories.some((category) => SERVICE_ONLY_APP_CATEGORIES.has(category));

  if (
    isServiceOnlyStore &&
    !isChainStore &&
    validationStatus !== "validated" &&
    sourceType !== "merchant_added" &&
    sourceType !== "user_validated"
  ) {
    return false;
  }

  const allowedStoreCategories = GROUP_FALLBACK_OSM_ALLOWLIST[normalizedGroup] ?? [];
  const allowedAppCategories = GROUP_FALLBACK_APP_CATEGORY_ALLOWLIST[normalizedGroup] ?? [];
  const hasOsmGroupFit =
    normalizedGroup.length > 0 &&
    normalizedOsmCategory.length > 0 &&
    allowedStoreCategories.includes(normalizedOsmCategory);
  const hasAppCategoryFit =
    normalizedGroup.length > 0 &&
    normalizedAppCategories.length > 0 &&
    normalizedAppCategories.some((category) => allowedAppCategories.includes(category));
  const hasStoreGroupFit = hasOsmGroupFit || hasAppCategoryFit;
  const strictGroup = STRICT_GROUP_TOKEN_MATCH.has(normalizedGroup);
  const trustedSource =
    sourceType === "user_validated" ||
    sourceType === "merchant_added" ||
    sourceType === "website_extracted" ||
    validationStatus === "validated";
  const hasTokenLevelMatch = hasMeaningfulTokenMatch(productNameNormalized, normalizedQuery);

  // Canonical multilingual match should be preserved when the store-category fit is coherent.
  // Otherwise require a stronger source to avoid exploding false positives.
  if (matchedByStrategy === "canonical_multilingual") {
    if (validationStatus === "rejected") {
      return false;
    }
    if (hasStoreGroupFit && confidence >= 0.55) {
      return true;
    }
    return trustedSource && confidence >= 0.85;
  }

  if (strictGroup && !hasTokenLevelMatch && !trustedSource) {
    return false;
  }

  if (hasStoreGroupFit && confidence >= 0.78 && validationStatus !== "rejected") {
    return true;
  }

  return trustedSource && confidence >= 0.9 && (hasStoreGroupFit || confidence >= 0.97);
}

function scoreMatchedVocabularyTerm(term: string, normalizedQuery: string): number {
  const queryTokens = splitNormalizedTokens(normalizedQuery);
  const termTokens = splitNormalizedTokens(term);
  const isBroad = BROAD_QUERY_TERMS.has(term);
  const exact = term === normalizedQuery;
  const contains = normalizedContains(term, normalizedQuery);

  let score = 0;
  if (exact) {
    score += isBroad ? 4 : 8;
  } else if (contains) {
    score += isBroad ? 2 : 5;
  } else {
    score += isBroad ? 1 : 3;
  }

  if (termTokens.length >= 2) {
    score += 2;
  }
  if (queryTokens.length >= 2 && termTokens.length >= 2) {
    score += 1;
  }
  if (isBroad) {
    score -= 1;
  }

  return score;
}

function inferProductGroupsFromKeyword(query: string): string[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }

  const candidateGroups = new Set(getCandidateGroupsFromVocabulary(normalized));
  const queryTokens = splitNormalizedTokens(normalized);

  const scoreGroups = (groups: string[]) => {
    const scored: Array<{ group: string; score: number }> = [];

    for (const group of groups) {
      const terms = KEYWORD_GROUP_TERMS_BY_GROUP.get(group) ?? [];
      let bestScore = 0;
      let matches = 0;

      for (const term of terms) {
        if (!normalizedFuzzyMatch(term, normalized)) {
          continue;
        }

        matches += 1;
        bestScore = Math.max(bestScore, scoreMatchedVocabularyTerm(term, normalized));
      }

      if (bestScore <= 0) {
        continue;
      }

      const score = bestScore + Math.min(matches - 1, 2);
      scored.push({ group, score });
    }

    return scored;
  };

  const scopedGroupList =
    candidateGroups.size > 0 ? Array.from(candidateGroups) : KEYWORD_GROUP_MAP.map(({ group }) => group);
  let scoredGroups = scoreGroups(scopedGroupList);

  if (scoredGroups.length === 0 && candidateGroups.size > 0) {
    scoredGroups = scoreGroups(KEYWORD_GROUP_MAP.map(({ group }) => group));
  }
  if (scoredGroups.length === 0) {
    return [];
  }

  scoredGroups.sort((a, b) => b.score - a.score);
  const topScore = scoredGroups[0]?.score ?? 0;
  const acceptedScore = Math.max(MIN_GROUP_SCORE, topScore - 3);
  const isShortSingleTokenQuery = queryTokens.length === 1 && queryTokens[0].length <= 4;

  return scoredGroups
    .filter(({ score }) => score >= acceptedScore)
    .filter(({ score }) => !isShortSingleTokenQuery || score >= topScore)
    .slice(0, MAX_INFERRED_GROUPS)
    .map(({ group }) => group);
}

function validationRank(status: SearchResult["validationStatus"] | null | undefined): number {
  if (status === "validated") return 4;
  if (status === "likely") return 3;
  if (status === "unvalidated") return 2;
  if (status === "rejected") return 0;
  return 1;
}

function sourceRank(sourceType: SearchResult["sourceType"] | null | undefined): number {
  if (sourceType === "user_validated" || sourceType === "validated") return 6;
  if (sourceType === "merchant_added") return 5;
  if (sourceType === "website_extracted") return 4;
  if (sourceType === "ai_generated") return 3;
  if (sourceType === "ai_inferred") return 3;
  if (sourceType === "rules_generated") return 2;
  if (sourceType === "imported") return 1;
  return 0;
}

function isLikelyServiceOnlyBeautyStore(store: Store): boolean {
  const osmCategory = String(store.osmCategory ?? "").trim().toLowerCase();
  const appCategories = Array.isArray(store.appCategories)
    ? store.appCategories.map((category) => normalizeQuery(category))
    : [];
  const matchesServiceOsmCategory = SERVICE_ONLY_OSM_CATEGORIES.has(osmCategory);
  const matchesServiceAppCategory = appCategories.some((category) => SERVICE_ONLY_APP_CATEGORIES.has(category));

  if (!matchesServiceOsmCategory && !matchesServiceAppCategory) {
    return false;
  }

  const normalizedName = normalizeQuery(store.name ?? "");
  if (!normalizedName && matchesServiceOsmCategory) {
    return true;
  }
  if (!normalizedName) {
    return false;
  }

  if (CHAIN_NAME_HINTS.some((hint) => normalizedName.includes(hint))) {
    return false;
  }

  if (SERVICE_BEAUTY_NAME_HINTS.some((hint) => normalizedName.includes(hint))) {
    return true;
  }

  return false;
}

function strategyRank(strategy: DatasetSearchStrategy): number {
  if (strategy === "category_intent") return 4;
  if (strategy === "canonical_multilingual") return 3;
  if (strategy === "group_keyword") return 2;
  return 1;
}

function mergeRowsByPriority(
  target: Map<string, { row: SupabaseSearchDatasetRow; strategy: DatasetSearchStrategy }>,
  rows: SupabaseSearchDatasetRow[],
  strategy: DatasetSearchStrategy
) {
  for (const row of rows) {
    const key = `${row.establishment_id}:${row.canonical_product_id}`;
    const existing = target.get(key);
    if (!existing) {
      target.set(key, { row, strategy });
      continue;
    }

    const existingScore =
      strategyRank(existing.strategy) * 1_000_000 +
      validationRank(existing.row.validation_status) * 100_000 +
      sourceRank(existing.row.source_type) * 10_000 +
      Math.round((existing.row.confidence ?? 0) * 1_000);
    const nextScore =
      strategyRank(strategy) * 1_000_000 +
      validationRank(row.validation_status) * 100_000 +
      sourceRank(row.source_type) * 10_000 +
      Math.round((row.confidence ?? 0) * 1_000);

    if (nextScore > existingScore) {
      target.set(key, { row, strategy });
    }
  }
}

async function getCanonicalCatalog(): Promise<SupabaseCanonicalProductRow[]> {
  const db = supabase;
  if (!db) {
    return [];
  }

  if (canonicalCatalogCache && Date.now() - canonicalCatalogCache.loadedAt < CANONICAL_CACHE_TTL_MS) {
    return canonicalCatalogCache.rows;
  }

  const loadCoreRows = async (): Promise<SupabaseCanonicalProductRow[]> => {
    const primary = await db
      .from("canonical_products")
      .select(
        "id, normalized_name, display_name_en, display_name_es, display_name_de, group_key, is_active"
      )
      .eq("is_active", true)
      .limit(2000);

    if (!primary.error) {
      return (primary.data ?? []) as SupabaseCanonicalProductRow[];
    }

    if (!isSchemaCompatibilityError(primary.error.message)) {
      throw new Error(`Supabase canonical products query failed: ${primary.error.message}`);
    }

    const legacy = await db
      .from("canonical_products")
      .select("id, normalized_name, display_name_en, display_name_es, display_name_de, synonyms, product_group")
      .limit(2000);

    if (legacy.error) {
      throw new Error(`Supabase canonical products legacy query failed: ${legacy.error.message}`);
    }

    if (DEV_DEBUG) {
      console.warn("[catalog-compat] Falling back to legacy canonical_products schema");
    }

    return (legacy.data ?? []) as SupabaseCanonicalProductRow[];
  };

  const coreRows = await loadCoreRows();

  const aliasesByProductId = new Map<number, Set<string>>();
  const aliasResponse = await db
    .from("canonical_product_aliases")
    .select("canonical_product_id, alias, is_active")
    .eq("is_active", true)
    .limit(20000);

  if (aliasResponse.error) {
    if (!isSchemaCompatibilityError(aliasResponse.error.message)) {
      throw new Error(`Supabase canonical aliases query failed: ${aliasResponse.error.message}`);
    }

    if (DEV_DEBUG) {
      console.warn("[catalog-compat] canonical_product_aliases not available yet, using legacy synonyms only");
    }
  } else {
    const aliasRows = (aliasResponse.data ?? []) as SupabaseCanonicalProductAliasRow[];
    for (const row of aliasRows) {
      const productId = Number(row.canonical_product_id);
      if (!Number.isFinite(productId)) {
        continue;
      }

      const alias = String(row.alias ?? "").trim();
      if (!alias) {
        continue;
      }

      if (!aliasesByProductId.has(productId)) {
        aliasesByProductId.set(productId, new Set());
      }
      aliasesByProductId.get(productId)?.add(alias);
    }
  }

  const rows = coreRows
    .filter((row) => row.is_active !== false)
    .map((row) => {
      const mergedSynonyms = Array.from(
        new Set([
          ...(aliasesByProductId.has(row.id) ? Array.from(aliasesByProductId.get(row.id) ?? []) : [])
        ])
      );

      return {
        ...row,
        product_group: String(row.group_key ?? "uncategorized"),
        synonyms: mergedSynonyms
      } satisfies SupabaseCanonicalProductRow;
    });

  canonicalCatalogCache = {
    loadedAt: Date.now(),
    rows
  };
  return rows;
}

function findCanonicalProductIdsByQuery(query: string, products: SupabaseCanonicalProductRow[]): number[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }

  const queryTokens = splitNormalizedTokens(normalized);
  const productIndex = products.map((product) => {
    const terms = Array.from(
      new Set(
        [
          product.normalized_name,
          product.display_name_en ?? "",
          product.display_name_es ?? "",
          product.display_name_de ?? "",
          ...(product.synonyms ?? [])
        ]
          .map((item) => normalizeQuery(item))
          .filter(Boolean)
      )
    );

    const tokenSet = new Set<string>();
    for (const term of terms) {
      for (const token of splitNormalizedTokens(term)) {
        tokenSet.add(token);
      }
    }

    return {
      id: product.id,
      terms,
      tokenSet
    };
  });

  const exactMatches = productIndex.filter(({ terms }) => terms.some((term) => term === normalized));
  if (exactMatches.length > 0) {
    return exactMatches.map((entry) => entry.id);
  }

  const inclusiveMatches = productIndex.filter(({ terms }) =>
    terms.some((term) => normalizedContains(term, normalized))
  );
  if (inclusiveMatches.length > 0) {
    return inclusiveMatches.map((entry) => entry.id);
  }

  const shortlist = productIndex.filter(({ tokenSet, terms }) => {
    if (queryTokens.length === 0) {
      return false;
    }

    const hasTokenOverlap = queryTokens.some((queryToken) => {
      for (const productToken of tokenSet) {
        if (
          productToken === queryToken ||
          productToken.startsWith(queryToken) ||
          queryToken.startsWith(productToken)
        ) {
          return true;
        }
      }
      return false;
    });

    if (hasTokenOverlap) {
      return true;
    }

    return queryTokens.some((queryToken) => queryToken.length >= 3 && terms.some((term) => term.includes(queryToken)));
  });

  return shortlist
    .filter(({ terms }) => terms.some((term) => normalizedFuzzyMatch(term, normalized)))
    .map((entry) => entry.id);
}

async function getCanonicalServiceCatalog(): Promise<{
  rows: SupabaseCanonicalServiceRow[];
  aliasesByServiceId: Map<number, Set<string>>;
}> {
  const db = supabase;
  if (!db) {
    return {
      rows: [],
      aliasesByServiceId: new Map()
    };
  }

  if (
    canonicalServiceCatalogCache &&
    Date.now() - canonicalServiceCatalogCache.loadedAt < CANONICAL_CACHE_TTL_MS
  ) {
    return {
      rows: canonicalServiceCatalogCache.rows,
      aliasesByServiceId: canonicalServiceCatalogCache.aliasesByServiceId
    };
  }

  const { data: serviceData, error: serviceError } = await db
    .from("canonical_services")
    .select("id, slug, display_name_en, display_name_es, display_name_de, group_key, is_active")
    .eq("is_active", true)
    .limit(2000);

  if (serviceError) {
    if (isSchemaCompatibilityError(serviceError.message)) {
      if (DEV_DEBUG) {
        console.warn("[catalog-compat] canonical_services not available for service fallback");
      }
      return {
        rows: [],
        aliasesByServiceId: new Map()
      };
    }
    throw new Error(`Supabase canonical services query failed: ${serviceError.message}`);
  }

  const aliasMap = new Map<number, Set<string>>();
  const { data: aliasData, error: aliasError } = await db
    .from("canonical_service_aliases")
    .select("canonical_service_id, alias, is_active")
    .eq("is_active", true)
    .limit(12000);

  if (aliasError) {
    if (!isSchemaCompatibilityError(aliasError.message)) {
      throw new Error(`Supabase canonical service aliases query failed: ${aliasError.message}`);
    }
    if (DEV_DEBUG) {
      console.warn("[catalog-compat] canonical_service_aliases not available for service fallback");
    }
  } else {
    for (const row of (aliasData ?? []) as SupabaseCanonicalServiceAliasRow[]) {
      const serviceId = Number(row.canonical_service_id);
      if (!Number.isFinite(serviceId)) {
        continue;
      }

      const alias = String(row.alias ?? "").trim();
      if (!alias) {
        continue;
      }

      if (!aliasMap.has(serviceId)) {
        aliasMap.set(serviceId, new Set());
      }
      aliasMap.get(serviceId)?.add(alias);
    }
  }

  const rows = ((serviceData ?? []) as SupabaseCanonicalServiceRow[]).filter(
    (row) => row.is_active !== false
  );

  canonicalServiceCatalogCache = {
    loadedAt: Date.now(),
    rows,
    aliasesByServiceId: aliasMap
  };

  return {
    rows,
    aliasesByServiceId: aliasMap
  };
}

function findCanonicalServiceIdsByQuery(
  query: string,
  services: SupabaseCanonicalServiceRow[],
  aliasesByServiceId: Map<number, Set<string>>
): number[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized || services.length === 0) {
    return [];
  }

  const queryTokens = splitNormalizedTokens(normalized);
  const matches: Array<{ id: number; score: number }> = [];

  for (const service of services) {
    const terms = Array.from(
      new Set(
        [
          service.slug,
          service.display_name_en ?? "",
          service.display_name_de ?? "",
          service.display_name_es ?? "",
          ...(aliasesByServiceId.has(service.id) ? Array.from(aliasesByServiceId.get(service.id) ?? []) : [])
        ]
          .map((value) => normalizeQuery(String(value)))
          .filter(Boolean)
      )
    );

    if (terms.length === 0) {
      continue;
    }

    const hasExact = terms.some((term) => term === normalized);
    const hasIncludes = terms.some((term) => normalizedContains(term, normalized));
    const hasFuzzy = terms.some((term) => normalizedFuzzyMatch(term, normalized));
    const hasToken = terms.some((term) =>
      queryTokens.some((token) => token.length >= 3 && term.includes(token))
    );

    if (!hasExact && !hasIncludes && !hasFuzzy && !hasToken) {
      continue;
    }

    const score =
      (hasExact ? 100 : 0) +
      (hasIncludes ? 40 : 0) +
      (hasFuzzy ? 22 : 0) +
      (hasToken ? 10 : 0) +
      (service.group_key === "repair" ? 3 : 0);

    matches.push({ id: service.id, score });
  }

  if (matches.length === 0) {
    return [];
  }

  matches.sort((a, b) => b.score - a.score);
  const threshold = Math.max(14, (matches[0]?.score ?? 0) - 40);
  return matches
    .filter((entry) => entry.score >= threshold)
    .slice(0, 24)
    .map((entry) => entry.id);
}

async function searchServiceFallbackResults(args: {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  excludeStoreIds?: Set<string>;
}): Promise<SearchResult[]> {
  if (!supabase) {
    return [];
  }

  const { rows: services, aliasesByServiceId } = await getCanonicalServiceCatalog();
  if (services.length === 0) {
    return [];
  }

  const matchedServiceIds = findCanonicalServiceIdsByQuery(args.query, services, aliasesByServiceId);
  if (matchedServiceIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("establishment_service_merged")
    .select(
      "establishment_id, canonical_service_id, primary_source_type, confidence, validation_status, availability_status, why_this_service_matches, source_url, updated_at, canonical_services:canonical_service_id(id, slug, display_name_en, display_name_de, display_name_es, group_key), establishments:establishment_id(id, name, address, district, lat, lon, opening_hours, website, phone, osm_category, app_categories)"
    )
    .in("canonical_service_id", matchedServiceIds)
    .neq("validation_status", "rejected")
    .gte("confidence", 0.7)
    .limit(900);

  if (error) {
    if (isSchemaCompatibilityError(error.message)) {
      return [];
    }
    throw new Error(`Supabase service fallback query failed: ${error.message}`);
  }

  const rows = (data ?? []) as SupabaseServiceSearchRow[];
  const normalizedQuery = normalizeSearchQuery(args.query);
  const results: SearchResult[] = [];
  let malformedRows = 0;

  for (const row of rows) {
    const store = Array.isArray(row.establishments) ? row.establishments[0] : row.establishments;
    const service = Array.isArray(row.canonical_services)
      ? row.canonical_services[0]
      : row.canonical_services;
    if (!store || !service || !hasValidStoreCoordinates({ lat: store.lat, lng: store.lon })) {
      malformedRows += 1;
      if (malformedRows <= 5) {
        debugMalformedRecord("Skipping malformed service fallback row", {
          establishmentId: row.establishment_id,
          serviceId: row.canonical_service_id,
          store,
          service
        });
      }
      continue;
    }

    const storeId = String(store.id);
    if (args.excludeStoreIds?.has(storeId)) {
      continue;
    }

    const storeLat = Number(store.lat);
    const storeLon = Number(store.lon);
    if (!Number.isFinite(storeLat) || !Number.isFinite(storeLon)) {
      continue;
    }

    const distanceMeters = haversineMeters(args.lat, args.lng, storeLat, storeLon);
    if (distanceMeters > args.radiusMeters) {
      continue;
    }

    if (row.primary_source_type === "rules_generated" && Number(row.confidence ?? 0) < 0.78) {
      continue;
    }

    const serviceName =
      service.display_name_en ?? service.display_name_de ?? service.display_name_es ?? service.slug;
    const normalizedServiceName = normalizeQuery(String(serviceName ?? service.slug ?? ""));
    const exactMatch = normalizedServiceName === normalizedQuery ? 1 : 0;
    const includesMatch = normalizedServiceName.includes(normalizedQuery) ? 1 : 0;
    const fuzzyMatch = normalizedFuzzyMatch(normalizedServiceName, normalizedQuery) ? 1 : 0;
    const confidence = typeof row.confidence === "number" ? row.confidence : 0;
    const validationScore =
      row.validation_status === "validated"
        ? 1500
        : row.validation_status === "likely"
          ? 700
          : row.validation_status === "rejected"
            ? -10000
            : 0;
    const sourceScore = sourceRank(row.primary_source_type) * 220;
    const freshnessHours = Math.max(
      1,
      Math.round((Date.now() - new Date(row.updated_at).getTime()) / (60 * 60 * 1000))
    );

    const rank =
      exactMatch * 92000 +
      includesMatch * 46000 +
      fuzzyMatch * 8000 +
      confidence * 2000 +
      validationScore +
      sourceScore -
      distanceMeters -
      freshnessHours * 2;

    results.push({
      offer: {
        id: `service_${storeId}_${service.id}_${row.primary_source_type ?? "unknown"}`,
        storeId,
        productId: `service_${service.id}`,
        priceOptional: null,
        availability: "unknown",
        updatedAt: row.updated_at ?? new Date().toISOString()
      },
      store: {
        id: storeId,
        name: String(store.name ?? "Unknown store"),
        address: String(store.address ?? ""),
        district: String(store.district ?? "Berlin"),
        openingHours: String(store.opening_hours ?? ""),
        lat: storeLat,
        lng: storeLon,
        website: store.website ?? row.source_url ?? null,
        phone: store.phone ?? null,
        ownershipType: inferOwnershipTypeFromStoreName(store.name),
        appCategories: store.app_categories ?? [],
        osmCategory: store.osm_category
      },
      product: {
        id: `service_${service.id}`,
        normalizedName: normalizedServiceName || normalizeQuery(service.slug),
        displayName: String(serviceName ?? service.slug),
        brand: null,
        category: String(service.group_key ?? "services")
      },
      distanceMeters,
      freshnessHours,
      rank,
      confidence,
      validationStatus: row.validation_status ?? "unvalidated",
      whyThisProductMatches: row.why_this_service_matches ?? "Service fallback match",
      lastCheckedAt: row.updated_at ?? null,
      sourceType: row.primary_source_type ?? "rules_generated",
      resultKind: "service",
      availabilityStatus: row.availability_status ?? "likely"
    });
  }

  return dedupeRankedResults(results)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_SEARCH_RESULTS);
}

async function searchCategoryIntentStoreFallback(args: {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}): Promise<SearchResult[]> {
  if (!supabase) {
    return [];
  }

  const categoryIntents = inferAppCategoryIntents(args.query);
  if (categoryIntents.length === 0) {
    return [];
  }

  const bounds = getBoundingBoxFromRadius({
    lat: args.lat,
    lng: args.lng,
    radiusMeters: args.radiusMeters
  });

  const { data, error } = await supabase
    .from("establishments")
    .select(
      "id, name, address, district, lat, lon, opening_hours, website, phone, osm_category, app_categories, active_status"
    )
    .in("active_status", ["active", "temporarily_closed", "unknown"])
    .gte("lat", bounds.minLat)
    .lte("lat", bounds.maxLat)
    .gte("lon", bounds.minLng)
    .lte("lon", bounds.maxLng)
    .limit(1200);

  if (error) {
    if (isSchemaCompatibilityError(error.message)) {
      return [];
    }
    throw new Error(`Supabase category-intent fallback query failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: number;
    name: string | null;
    address: string | null;
    district: string | null;
    lat: number | null;
    lon: number | null;
    opening_hours: string | null;
    website: string | null;
    phone: string | null;
    osm_category: string | null;
    app_categories: string[] | null;
    active_status: string | null;
  }>;

  const results: SearchResult[] = [];
  const normalizedQuery = normalizeSearchQuery(args.query);

  for (const row of rows) {
    if (!hasValidStoreCoordinates({ lat: row.lat, lng: row.lon })) {
      continue;
    }

    const normalizedOsm = normalizeQuery(String(row.osm_category ?? ""));
    const normalizedApps = (row.app_categories ?? []).map((item) => normalizeQuery(String(item ?? "")));
    const matchedCategory = categoryIntents.find((category) => {
      const allowedOsm = APP_CATEGORY_INTENT_OSM_ALLOWLIST[category] ?? [];
      const allowedOsmNormalized = allowedOsm.map((value) => normalizeQuery(value));
      return normalizedApps.includes(category) || allowedOsmNormalized.includes(normalizedOsm);
    });

    if (!matchedCategory) {
      continue;
    }

    const rowLat = Number(row.lat);
    const rowLon = Number(row.lon);
    if (!Number.isFinite(rowLat) || !Number.isFinite(rowLon)) {
      continue;
    }

    const distanceMeters = haversineMeters(args.lat, args.lng, rowLat, rowLon);
    if (distanceMeters > args.radiusMeters) {
      continue;
    }

    const rank = 22000 - distanceMeters;
    const displayName =
      matchedCategory === "antiques"
        ? "Antiques shop"
        : matchedCategory === "art"
          ? "Art shop"
          : matchedCategory === "second-hand"
            ? "Second-hand shop"
            : `${matchedCategory} store`;
    const normalizedName =
      matchedCategory === "antiques"
        ? "antiques"
        : matchedCategory === "second-hand"
          ? "second hand"
          : matchedCategory;

    results.push({
      offer: {
        id: `category_${matchedCategory}_${row.id}`,
        storeId: String(row.id),
        productId: `category_${matchedCategory}`,
        priceOptional: null,
        availability: "unknown",
        updatedAt: new Date().toISOString()
      },
      product: {
        id: `category_${matchedCategory}`,
        normalizedName,
        displayName,
        brand: null,
        category: "discovery"
      },
      store: {
        id: String(row.id),
        name: String(row.name ?? "Unknown store"),
        address: String(row.address ?? ""),
        district: String(row.district ?? "Berlin"),
        openingHours: String(row.opening_hours ?? ""),
        lat: rowLat,
        lng: rowLon,
        website: row.website ?? null,
        phone: row.phone ?? null,
        ownershipType: inferOwnershipTypeFromStoreName(row.name),
        appCategories: row.app_categories ?? [],
        osmCategory: row.osm_category
      },
      distanceMeters,
      freshnessHours: 0,
      rank,
      confidence: 0.72,
      validationStatus: "likely",
      whyThisProductMatches: `Store category likely matches "${normalizedQuery}" intent.`,
      lastCheckedAt: null,
      sourceType: "rules_generated",
      resultKind: "product",
      availabilityStatus: null
    });
  }

  return dedupeRankedResults(results).sort((a, b) => b.rank - a.rank).slice(0, 24);
}

function rankResults(rows: JoinedRow[], args: { query: string; lat: number; lng: number; radius: number }): SearchResult[] {
  const normalized = normalizeSearchQuery(args.query);
  const queryIsSpecific = isSpecificProductQuery(normalized);
  const likelyServiceIntent = isLikelyServiceIntentQuery(normalized);
  const validRows: JoinedRow[] = [];
  let droppedRows = 0;

  for (const row of rows) {
    if (!hasValidStoreCoordinates(row?.store)) {
      droppedRows += 1;
      if (droppedRows <= 5) {
        debugMalformedRecord("Dropping malformed joined row (invalid store coordinates)", {
          offerId: row?.offer?.id ?? null,
          store: row?.store ?? null
        });
      }
      continue;
    }
    validRows.push(row);
  }

  if (droppedRows > 0 && DEV_DEBUG) {
    console.warn(`[search-data-guard] Dropped ${droppedRows} malformed rows before ranking`);
  }

  return validRows
    .map((row) => {
      const distanceMeters = haversineMeters(args.lat, args.lng, row.store.lat, row.store.lng);
      const freshnessHours = Math.max(
        1,
        Math.round((Date.now() - new Date(row.offer.updatedAt).getTime()) / (60 * 60 * 1000))
      );
      const exactMatch = row.product.normalizedName === normalized ? 1 : 0;
      const includesMatch = row.product.normalizedName.includes(normalized) ? 1 : 0;
      const fuzzyMatch = normalizedFuzzyMatch(normalizeQuery(row.product.normalizedName), normalized) ? 1 : 0;
      const confidenceScore = typeof row.confidence === "number" ? row.confidence * 2000 : 0;
      const hasStrongTextMatch =
        exactMatch === 1 ||
        includesMatch === 1 ||
        fuzzyMatch === 1 ||
        hasMeaningfulTokenMatch(normalizeQuery(row.product.normalizedName), normalized);
      const validationScore =
        row.validationStatus === "validated"
          ? 1500
          : row.validationStatus === "likely"
            ? 700
            : row.validationStatus === "rejected"
              ? -10000
              : 0;
      const sourceScore =
        sourceRank(row.sourceType) * 230;
      const candidateFreshnessScore = typeof row.candidateFreshnessScore === "number" ? row.candidateFreshnessScore : 0;
      const establishmentFreshnessScore =
        typeof row.establishmentFreshnessScore === "number" ? row.establishmentFreshnessScore : 0;
      const freshnessScore = candidateFreshnessScore * 520 + establishmentFreshnessScore * 280;
      const normalizedOsmCategory = normalizeQuery(row.store.osmCategory ?? "");
      const storeRoles = Array.isArray(row.store.storeRoles)
        ? row.store.storeRoles.map((role) => normalizeQuery(String(role)))
        : [];
      const hasServiceRoleSupport = storeRoles.some((role) => STORE_ROLE_SERVICE_PRIORITIES.has(role));
      const genericStorePenalty =
        queryIsSpecific &&
        !hasStrongTextMatch &&
        (normalizedOsmCategory === "mall" || normalizedOsmCategory === "department store")
          ? 1800
          : 0;
      const serviceIntentPenalty =
        likelyServiceIntent && !hasStrongTextMatch && !hasServiceRoleSupport ? 3200 : 0;

      const rank =
        exactMatch * 100000 +
        includesMatch * 50000 +
        fuzzyMatch * 8000 +
        confidenceScore +
        validationScore +
        sourceScore +
        freshnessScore -
        genericStorePenalty -
        serviceIntentPenalty -
        distanceMeters -
        freshnessHours * 2;

      const rankedResult: SearchResult = {
        offer: row.offer,
        product: row.product,
        store: row.store,
        distanceMeters,
        freshnessHours,
        rank,
        confidence: row.confidence ?? null,
        validationStatus: row.validationStatus ?? null,
        whyThisProductMatches: row.whyThisProductMatches ?? null,
        lastCheckedAt: row.lastCheckedAt ?? row.offer.updatedAt,
        sourceType: row.sourceType ?? null,
        resultKind: "product",
        availabilityStatus: null
      };

      return rankedResult;
    })
    .filter((row) => row.distanceMeters <= args.radius)
    .sort((a, b) => b.rank - a.rank);
}

function minConfidenceThresholdForRow(row: JoinedRow): number {
  if (row.validationStatus === "validated") {
    return 0;
  }
  if (row.sourceType === "user_validated" || row.sourceType === "merchant_added") {
    return 0;
  }
  if (row.sourceType === "website_extracted") {
    return 0.33;
  }
  if (row.sourceType === "ai_generated") {
    return 0.44;
  }
  if (row.sourceType === "ai_inferred") {
    return 0.44;
  }
  if (row.sourceType === "rules_generated") {
    return 0.53;
  }
  return MIN_CONFIDENCE_FOR_WEAK_MATCH;
}

function dedupeRankedResults(results: SearchResult[]): SearchResult[] {
  const seenStoreIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const deduped: SearchResult[] = [];
  let droppedResults = 0;

  for (const item of results) {
    if (!hasValidStoreCoordinates(item?.store)) {
      droppedResults += 1;
      if (droppedResults <= 5) {
        debugMalformedRecord("Dropping malformed ranked result (invalid store coordinates)", {
          offerId: item?.offer?.id ?? null,
          store: item?.store ?? null
        });
      }
      continue;
    }

    const storeIdKey = String(item.store.id);
    const nameKey = normalizeQuery(item.store.name);
    const addressKey = normalizeQuery(item.store.address);
    const latKey = Math.round(item.store.lat * 10000);
    const lngKey = Math.round(item.store.lng * 10000);
    const fingerprint = `${nameKey}|${addressKey}|${latKey}|${lngKey}`;

    if (seenStoreIds.has(storeIdKey) || seenFingerprints.has(fingerprint)) {
      continue;
    }

    seenStoreIds.add(storeIdKey);
    seenFingerprints.add(fingerprint);
    deduped.push(item);
  }

  if (droppedResults > 0 && DEV_DEBUG) {
    console.warn(`[search-data-guard] Dropped ${droppedResults} malformed ranked results`);
  }

  return deduped;
}

function getMockRows(): JoinedRow[] {
  return mockOffers
    .map((offer) => {
      const product = mockProducts.find((item) => item.id === offer.productId);
      const store = mockStores.find((item) => item.id === offer.storeId);
      if (!product || !store) {
        return null;
      }

      return {
        offer,
        product,
        store
      };
    })
    .filter((row): row is JoinedRow => row !== null);
}

async function getSupabaseRowsLegacy(): Promise<JoinedRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("offers")
    .select(
      "id, store_id, product_id, price_optional, availability, updated_at, stores:store_id(id,name,address,district,opening_hours,lat,lng), products:product_id(id,normalized_name,brand,category)"
    );

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const rows = (data ?? []) as SupabaseOfferRow[];
  const legacyRows: JoinedRow[] = [];

  for (const row of rows) {
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
    const product = Array.isArray(row.products) ? row.products[0] : row.products;

    if (!store || !product || !hasValidStoreCoordinates(store)) {
      if (DEV_DEBUG) {
        debugMalformedRecord("Skipping malformed legacy row from Supabase", {
          offerId: row.id,
          store,
          product
        });
      }
      continue;
    }

    legacyRows.push({
      offer: {
        id: row.id,
        storeId: row.store_id,
        productId: row.product_id,
        priceOptional: row.price_optional,
        availability: row.availability as Offer["availability"],
        updatedAt: row.updated_at
      } satisfies Offer,
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        district: store.district,
        openingHours: store.opening_hours,
        lat: store.lat,
        lng: store.lng,
        website: (store as { website?: string | null }).website ?? null,
        phone: (store as { phone?: string | null }).phone ?? null,
        ownershipType: inferOwnershipTypeFromStoreName(store.name)
      } satisfies Store,
      product: {
        id: product.id,
        normalizedName: product.normalized_name,
        brand: product.brand,
        category: product.category
      } satisfies Product
    });
  }

  return legacyRows;
}

async function searchSupabaseRowsFromDataset(args: {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  limit?: number;
}): Promise<DatasetSearchResponse | null> {
  if (!supabase) {
    return null;
  }
  const db = supabase;

  const normalized = normalizeSearchQuery(args.query);
  const categoryIntents = inferAppCategoryIntents(args.query);
  const canonicalProducts = await getCanonicalCatalog();
  const canonicalProductsById = new Map(
    canonicalProducts.map((product) => [String(product.id), product])
  );
  const canonicalIds = findCanonicalProductIdsByQuery(args.query, canonicalProducts);
  const inferredGroups = inferProductGroupsFromKeyword(args.query);
  const limit = args.limit ?? 450;
  const bounds = getBoundingBoxFromRadius({
    lat: args.lat,
    lng: args.lng,
    radiusMeters: args.radiusMeters
  });

  const buildScopedQuery = () =>
    db
      .from("search_product_establishment_dataset")
      .select(
        "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, opening_hours, source_url, product_normalized_name, product_group, candidate_last_checked_at, candidate_freshness_score, freshness_score"
      )
      .gte("lat", bounds.minLat)
      .lte("lat", bounds.maxLat)
      .gte("lon", bounds.minLng)
      .lte("lon", bounds.maxLng);

  const executeQuery = async (
    strategy: DatasetSearchStrategy,
    applyFilter: (queryBuilder: ReturnType<typeof buildScopedQuery>) => ReturnType<typeof buildScopedQuery>
  ): Promise<SupabaseSearchDatasetRow[] | null> => {
    const { data, error } = await applyFilter(buildScopedQuery())
      .order("confidence", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      const message = (error.message || "").toLowerCase();
      const fallbackEligible =
        message.includes("relation") ||
        message.includes("does not exist") ||
        message.includes("search_product_establishment_dataset") ||
        message.includes("column");

      if (fallbackEligible) {
        return null;
      }

      throw new Error(`Supabase search dataset query failed (${strategy}): ${error.message}`);
    }

    return (data ?? []) as SupabaseSearchDatasetRow[];
  };

  const mergedRows = new Map<
    string,
    { row: SupabaseSearchDatasetRow; strategy: DatasetSearchStrategy }
  >();
  let strategy: DatasetSearchStrategy = "product_name";
  let hasPrimaryStrategy = false;

  const resolveFacetCanonicalIds = async (facets: string[]): Promise<number[] | null> => {
    if (facets.length === 0) {
      return [];
    }

    const { data, error } = await db
      .from("canonical_product_facets")
      .select("canonical_product_id, facet_normalized")
      .in("facet_normalized", facets)
      .limit(8000);

    if (error) {
      if (isSchemaCompatibilityError(error.message)) {
        if (DEV_DEBUG) {
          console.warn("[catalog-compat] canonical_product_facets not available, fallback to product_group");
        }
        return null;
      }
      throw new Error(`Supabase facet lookup failed: ${error.message}`);
    }

    const rows = (data ?? []) as SupabaseCanonicalProductFacetRow[];
    const ids = new Set<number>();
    for (const row of rows) {
      const id = Number(row.canonical_product_id);
      if (Number.isFinite(id)) {
        ids.add(id);
      }
    }
    return [...ids];
  };

  if (categoryIntents.length > 0) {
    for (const category of categoryIntents) {
      const allowedOsmCategories = APP_CATEGORY_INTENT_OSM_ALLOWLIST[category] ?? [];
      const allowedGroups = APP_CATEGORY_INTENT_GROUP_ALLOWLIST[category] ?? null;
      // eslint-disable-next-line no-await-in-loop
      const categoryRows = await executeQuery("category_intent", (queryBuilder) =>
        (() => {
          let scoped = queryBuilder.contains("app_categories", [category]);
          if (allowedOsmCategories.length > 0) {
            scoped = scoped.in("osm_category", allowedOsmCategories);
          }
          if (Array.isArray(allowedGroups) && allowedGroups.length > 0) {
            return scoped.in("product_group", allowedGroups);
          }
          return scoped;
        })()
      );
      if (categoryRows === null) {
        return null;
      }
      if (categoryRows.length > 0) {
        mergeRowsByPriority(mergedRows, categoryRows, "category_intent");
      }
    }

    strategy = "category_intent";
    hasPrimaryStrategy = true;
  }

  if (!hasPrimaryStrategy && canonicalIds.length > 0) {
    const canonicalRows = await executeQuery("canonical_multilingual", (queryBuilder) =>
      queryBuilder.in("canonical_product_id", canonicalIds)
    );
    if (canonicalRows === null) {
      return null;
    }
    if (canonicalRows.length > 0) {
      mergeRowsByPriority(mergedRows, canonicalRows, "canonical_multilingual");
      strategy = "canonical_multilingual";
      hasPrimaryStrategy = true;
    }
  }

  if (!hasPrimaryStrategy && inferredGroups.length > 0) {
    const facetCanonicalIds = await resolveFacetCanonicalIds(inferredGroups);
    let groupRows: SupabaseSearchDatasetRow[] = [];

    if (facetCanonicalIds && facetCanonicalIds.length > 0) {
      const byFacetRows = await executeQuery("group_keyword", (queryBuilder) =>
        queryBuilder.in("canonical_product_id", facetCanonicalIds)
      );
      if (byFacetRows === null) {
        return null;
      }
      groupRows = byFacetRows;
    }

    if (groupRows.length === 0) {
      const legacyGroupRows = await executeQuery("group_keyword", (queryBuilder) =>
        queryBuilder.in("product_group", inferredGroups)
      );
      if (legacyGroupRows === null) {
        return null;
      }
      groupRows = legacyGroupRows;
    }

    if (groupRows.length > 0) {
      const shouldAugment = !hasPrimaryStrategy || mergedRows.size < STRATEGY_AUGMENT_THRESHOLD;
      if (shouldAugment) {
        mergeRowsByPriority(mergedRows, groupRows, "group_keyword");
      }
      if (!hasPrimaryStrategy) {
        strategy = "group_keyword";
        hasPrimaryStrategy = true;
      }
    }
  }

  if (!hasPrimaryStrategy || (strategy !== "category_intent" && mergedRows.size < STRATEGY_AUGMENT_THRESHOLD)) {
    const fallbackRows = await executeQuery("product_name", (queryBuilder) =>
      queryBuilder.ilike("product_normalized_name", `%${normalized}%`)
    );
    if (fallbackRows === null) {
      return null;
    }
    if (fallbackRows.length > 0) {
      mergeRowsByPriority(mergedRows, fallbackRows, "product_name");
      if (!hasPrimaryStrategy) {
        strategy = "product_name";
        hasPrimaryStrategy = true;
      }
    }
  }

  const mergedEntries = Array.from(mergedRows.values());
  const rows = mergedEntries.map((item) => item.row);

  const joinedRows: JoinedRow[] = [];
  let malformedRows = 0;
  const establishmentIds = [...new Set(rows.map((row) => row.establishment_id))];
  const metadataById = new Map<number, SupabaseEstablishmentMetadataRow>();

  if (establishmentIds.length > 0) {
    const { data: establishmentRows, error: establishmentError } = await db
      .from("establishments")
      .select("id, phone, website, name")
      .in("id", establishmentIds);

    if (establishmentError) {
      const message = (establishmentError.message || "").toLowerCase();
      const rlsBlocked =
        message.includes("permission denied") ||
        message.includes("row-level security") ||
        message.includes("rls");
      if (!rlsBlocked) {
        throw new Error(`Supabase establishment metadata query failed: ${establishmentError.message}`);
      }
    } else {
      for (const metadataRow of (establishmentRows ?? []) as SupabaseEstablishmentMetadataRow[]) {
        metadataById.set(metadataRow.id, metadataRow);
      }
    }
  }

  for (const entry of mergedEntries) {
    const row = entry.row;
    if (!hasValidStoreCoordinates({ lat: row.lat, lng: row.lon })) {
      malformedRows += 1;
      if (malformedRows <= 5) {
        debugMalformedRecord("Skipping malformed dataset row (invalid lat/lon)", {
          establishmentId: row.establishment_id,
          establishmentName: row.establishment_name,
          lat: row.lat,
          lon: row.lon
        });
      }
      continue;
    }

    const storeId = String(row.establishment_id);
    const productId = String(row.canonical_product_id);
    const canonicalProduct = canonicalProductsById.get(productId);
    const offerId = `candidate_${storeId}_${productId}_${row.source_type ?? "unknown"}`;
    const updatedAt = row.updated_at ?? new Date().toISOString();
    const establishmentMetadata = metadataById.get(row.establishment_id);
    const website = establishmentMetadata?.website ?? row.source_url ?? null;
    const storeName = String(row.establishment_name ?? establishmentMetadata?.name ?? "Unknown store");

    joinedRows.push({
      offer: {
        id: offerId,
        storeId,
        productId,
        priceOptional: null,
        availability: "unknown",
        updatedAt
      },
      store: {
        id: storeId,
        name: storeName,
        address: String(row.address ?? ""),
        district: String(row.district ?? "Berlin"),
        openingHours: String(row.opening_hours ?? ""),
        lat: row.lat,
        lng: row.lon,
        website,
        phone: establishmentMetadata?.phone ?? null,
        ownershipType: inferOwnershipTypeFromStoreName(storeName),
        appCategories: row.app_categories ?? [],
        osmCategory: row.osm_category
      },
      product: {
        id: productId,
        normalizedName: String(row.product_normalized_name ?? ""),
        displayName:
          canonicalProduct?.display_name_en ??
          canonicalProduct?.display_name_de ??
          canonicalProduct?.display_name_es ??
          null,
        brand: null,
        category: String(row.product_group ?? "")
      },
      confidence: row.confidence,
      validationStatus: row.validation_status,
      whyThisProductMatches: row.why_this_product_matches,
      lastCheckedAt: row.candidate_last_checked_at ?? row.updated_at ?? null,
      sourceType: row.source_type,
      candidateFreshnessScore: row.candidate_freshness_score ?? null,
      establishmentFreshnessScore: row.freshness_score ?? null,
      matchedByStrategy: entry.strategy
    } satisfies JoinedRow);
  }

  if (malformedRows > 0 && DEV_DEBUG) {
    console.warn(`[search-data-guard] Skipped ${malformedRows} malformed dataset rows`);
  }

  return {
    strategy,
    rows: joinedRows
  };
}

async function getStoreDetailFromDataset(id: string): Promise<StoreDetail | null> {
  if (!supabase) {
    return null;
  }

  const establishmentId = Number(id);
  if (!Number.isFinite(establishmentId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("search_product_establishment_dataset")
    .select(
      "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, opening_hours, source_url, product_normalized_name, product_group"
    )
    .eq("establishment_id", establishmentId)
    .limit(500);

  if (error) {
    const message = (error.message || "").toLowerCase();
    if (
      message.includes("relation") ||
      message.includes("does not exist") ||
      message.includes("search_product_establishment_dataset")
    ) {
      return null;
    }
    throw new Error(`Supabase store detail dataset query failed: ${error.message}`);
  }

  const rows = (data ?? []) as SupabaseSearchDatasetRow[];
  if (!rows.length) {
    return null;
  }

  const first = rows[0];
  if (!hasValidStoreCoordinates({ lat: first.lat, lng: first.lon })) {
    debugMalformedRecord("Store detail row has invalid coordinates; returning null detail", {
      establishmentId: first.establishment_id,
      establishmentName: first.establishment_name,
      lat: first.lat,
      lon: first.lon
    });
    return null;
  }
  const { data: establishmentData, error: establishmentError } = await supabase
    .from("establishments")
    .select("id, phone, website, name")
    .eq("id", establishmentId)
    .maybeSingle();

  const metadataErrorMessage = (establishmentError?.message || "").toLowerCase();
  const metadataRlsBlocked =
    metadataErrorMessage.includes("permission denied") ||
    metadataErrorMessage.includes("row-level security") ||
    metadataErrorMessage.includes("rls");
  if (establishmentError && !metadataRlsBlocked) {
    throw new Error(`Supabase establishment detail metadata query failed: ${establishmentError.message}`);
  }

  const metadata = metadataRlsBlocked ? null : (establishmentData as SupabaseEstablishmentMetadataRow | null);
  const storeName = first.establishment_name ?? metadata?.name ?? "Unknown store";
  const canonicalProducts = await getCanonicalCatalog();
  const canonicalProductsById = new Map(
    canonicalProducts.map((product) => [String(product.id), product])
  );

  const store: Store = {
    id: String(first.establishment_id),
    name: storeName,
    address: first.address,
    district: first.district,
    openingHours: String(first.opening_hours ?? ""),
    lat: first.lat,
    lng: first.lon,
    website: metadata?.website ?? first.source_url ?? null,
    phone: metadata?.phone ?? null,
    ownershipType: inferOwnershipTypeFromStoreName(storeName),
    appCategories: first.app_categories ?? [],
    osmCategory: first.osm_category
  };

  return {
    store,
    offers: rows.map((row) => {
      const storeId = String(row.establishment_id);
      const productId = String(row.canonical_product_id);
      const canonicalProduct = canonicalProductsById.get(productId);
      return {
        offer: {
          id: `candidate_${storeId}_${productId}_${row.source_type ?? "unknown"}`,
          storeId,
          productId,
          priceOptional: null,
          availability: "unknown",
          updatedAt: row.updated_at ?? new Date().toISOString()
        },
        product: {
          id: productId,
          normalizedName: row.product_normalized_name,
          displayName:
            canonicalProduct?.display_name_en ??
            canonicalProduct?.display_name_de ??
            canonicalProduct?.display_name_es ??
            null,
          brand: null,
          category: row.product_group
        }
      };
    })
  };
}

export type SearchBackendSource = "supabase_dataset" | "supabase_legacy" | "mock";

export async function searchOffersDetailed(args: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}): Promise<{
  results: SearchResult[];
  serviceFallback: SearchResult[];
  resultMode: "products_only" | "products_plus_services" | "services_fallback_only";
  backendSource: SearchBackendSource;
}> {
  const lat = typeof args.lat === "number" ? args.lat : BERLIN_CENTER.lat;
  const lng = typeof args.lng === "number" ? args.lng : BERLIN_CENTER.lng;
  const radius = typeof args.radiusMeters === "number" ? args.radiusMeters : 2000;

  let rows: JoinedRow[];
  let datasetStrategy: DatasetSearchStrategy | null = null;
  let backendSource: SearchBackendSource = hasSupabase ? "supabase_legacy" : "mock";
  if (hasSupabase) {
    const datasetResponse = await searchSupabaseRowsFromDataset({
      query: args.query,
      lat,
      lng,
      radiusMeters: radius
    });
    if (datasetResponse) {
      rows = datasetResponse.rows;
      datasetStrategy = datasetResponse.strategy;
      backendSource = "supabase_dataset";
    } else {
      rows = await getSupabaseRowsLegacy();
      backendSource = "supabase_legacy";
    }
  } else {
    rows = getMockRows();
    backendSource = "mock";
  }

  const capabilityProfiles = hasSupabase
    ? await fetchStoreCapabilityProfilesByStoreIds(rows.map((row) => row.store.id))
    : new Map<string, StoreCapabilityProfile>();

  rows = rows.map((row) => {
    const profile = capabilityProfiles.get(String(row.store.id));
    if (!profile) {
      return row;
    }

    return {
      ...row,
      store: {
        ...row.store,
        storeRoles: profile.businessRoles,
        storeRolePrimary: profile.storeType,
        storeRoleConfidence: profile.confidence
      }
    };
  });

  const normalized = normalizeSearchQuery(args.query);
  if (GENERIC_QUERY_TERMS.has(normalized)) {
    return {
      results: [],
      serviceFallback: [],
      resultMode: "products_only",
      backendSource
    };
  }
  const likelyServiceIntent = isLikelyServiceIntentQuery(normalized);
  const queryIsSpecific = isSpecificProductQuery(normalized);

  const filtered =
    datasetStrategy === "canonical_multilingual" ||
    datasetStrategy === "group_keyword" ||
    datasetStrategy === "category_intent"
      ? rows
      : rows.filter((row) => {
          const productName = normalizeQuery(row.product.normalizedName);
          return productName === normalized || productName.includes(normalized);
        });
  const plausibilityFiltered = filtered.filter((row) => {
    const storeProfile = capabilityProfiles.get(String(row.store.id));

    if (likelyServiceIntent) {
      const hasTextMatch =
        normalizeQuery(row.product.normalizedName).includes(normalized) ||
        normalizedFuzzyMatch(normalizeQuery(row.product.normalizedName), normalized);
      const profileSupportsService = profileSupportsServiceIntent(storeProfile, normalized);

      if (!profileSupportsService && !hasTextMatch && row.validationStatus !== "validated") {
        return false;
      }
    }

    const isServiceBeautyStore = isLikelyServiceOnlyBeautyStore(row.store);
    if (
      isSpecificProductQuery(normalized) &&
      isServiceBeautyStore &&
      row.validationStatus !== "validated" &&
      row.sourceType !== "merchant_added" &&
      row.sourceType !== "user_validated"
    ) {
      return false;
    }

    const productName = normalizeQuery(row.product.normalizedName);
    const hasStrongTextMatch =
      productName === normalized ||
      productName.includes(normalized) ||
      normalizedFuzzyMatch(productName, normalized);
    const confidence = typeof row.confidence === "number" ? row.confidence : 0;

    if (
    datasetStrategy === "group_keyword" ||
      datasetStrategy === "product_name" ||
      datasetStrategy === "canonical_multilingual" ||
      datasetStrategy === "category_intent"
    ) {
      const keepByGroupGuard = shouldKeepGroupFallbackRow({
        normalizedQuery: normalized,
        productNameNormalized: productName,
        productGroup: row.product.category,
        osmCategory: row.store.osmCategory ?? null,
        appCategories: row.store.appCategories ?? null,
        storeName: row.store.name,
        confidence,
        sourceType: row.sourceType,
        validationStatus: row.validationStatus,
        matchedByStrategy: row.matchedByStrategy ?? datasetStrategy
      });
      if (!keepByGroupGuard) {
        return false;
      }
    }

    if (hasStrongTextMatch) {
      return true;
    }

    const matchedByCanonicalAlias = row.matchedByStrategy === "canonical_multilingual";
    if (
      queryIsSpecific &&
      !matchedByCanonicalAlias &&
      profileContradictsProductIntent(storeProfile, normalized)
    ) {
      return false;
    }

    return confidence >= minConfidenceThresholdForRow(row);
  });

  let results = dedupeRankedResults(
    rankResults(plausibilityFiltered, { query: args.query, lat, lng, radius })
  ).slice(0, MAX_SEARCH_RESULTS);

  let serviceFallback = await searchServiceFallbackResults({
    query: args.query,
    lat,
    lng,
    radiusMeters: radius,
    excludeStoreIds: new Set(results.map((result) => result.store.id))
  });

  if (serviceFallback.length > 0 && hasSupabase) {
    const serviceProfiles = await fetchStoreCapabilityProfilesByStoreIds(
      serviceFallback.map((item) => item.store.id)
    );
    serviceFallback = serviceFallback.map((item) => {
      const profile = serviceProfiles.get(String(item.store.id));
      if (!profile) {
        return item;
      }
      return {
        ...item,
        store: {
          ...item.store,
          storeRoles: profile.businessRoles,
          storeRolePrimary: profile.storeType,
          storeRoleConfidence: profile.confidence
        }
      };
    });
  }

  if (likelyServiceIntent && serviceFallback.length > 0) {
    results = results.filter((result) => keepProductResultForServiceIntent(result, normalized));
  }

  let categoryFallback: SearchResult[] = [];
  if (results.length === 0 && serviceFallback.length === 0) {
    categoryFallback = await searchCategoryIntentStoreFallback({
      query: args.query,
      lat,
      lng,
      radiusMeters: radius
    });
    if (categoryFallback.length > 0) {
      results = categoryFallback;
    }
  }

  const resultMode: "products_only" | "products_plus_services" | "services_fallback_only" =
    results.length > 0
      ? serviceFallback.length > 0
        ? "products_plus_services"
        : "products_only"
      : serviceFallback.length > 0
        ? "services_fallback_only"
        : "products_only";

  return {
    results,
    serviceFallback,
    resultMode,
    backendSource
  };
}

export async function searchOffers(args: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}): Promise<SearchResult[]> {
  const response = await searchOffersDetailed(args);
  return response.results;
}

export async function getStoreDetail(id: string): Promise<StoreDetail | null> {
  if (hasSupabase) {
    const detailFromDataset = await getStoreDetailFromDataset(id);
    if (detailFromDataset) {
      return detailFromDataset;
    }
  }

  const rows = hasSupabase ? await getSupabaseRowsLegacy() : getMockRows();
  const storeRows = rows.filter((row) => row.store.id === id);

  if (storeRows.length === 0) {
    return null;
  }

  return {
    store: storeRows[0].store,
    offers: storeRows.map((row) => ({ offer: row.offer, product: row.product }))
  };
}

export function getBerlinCenter() {
  return BERLIN_CENTER;
}

export const __private = {
  inferProductGroupsFromKeyword,
  findCanonicalProductIdsByQuery,
  dedupeRankedResults,
  hasMeaningfulTokenMatch,
  isSpecificProductQuery,
  isLikelyServiceIntentQuery,
  keepProductResultForServiceIntent,
  shouldKeepGroupFallbackRow,
  inferAppCategoryIntents
};
