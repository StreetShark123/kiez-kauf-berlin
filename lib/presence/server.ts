import { createHash } from "node:crypto";
import { PRODUCT_TYPES_BY_ID, resolveQuery, type QueryResolution } from "@/lib/presence/catalog";
import { getEvidenceRepository, type AddEvidenceResult } from "@/lib/presence/evidence-store";
import { estimatePresence, type PresenceEstimate } from "@/lib/presence/evidence";
import { priorFor } from "@/lib/presence/priors";
import { searchPresence, storePresenceProfile, type StorePresenceItem } from "@/lib/presence/search";
import { getPresenceStores, type PresenceStoreRecord } from "@/lib/presence/stores";
import type { Locale, SearchResult } from "@/lib/types";

export const DEVICE_COOKIE = "kk_did";

export type SearchEngine = "presence" | "legacy";

export function selectedEngine(override: string | null | undefined): SearchEngine {
  const value = (override ?? process.env.SEARCH_ENGINE ?? "presence").toLowerCase();
  return value === "legacy" ? "legacy" : "presence";
}

export type PresenceApiSearch = {
  resolution: QueryResolution;
  results: SearchResult[];
  serviceResults: SearchResult[];
  storeSource: "supabase" | "local_osm";
  evidenceSource: string;
};

/**
 * Try the raw query first; if the catalog doesn't know it, try the LLM-normalised query
 * (e.g. a translation). Never falls back to "same product group" matches.
 */
export async function runPresenceSearch(args: {
  query: string;
  alternateQuery?: string | null;
  lat: number;
  lng: number;
  radiusMeters: number;
  locale: Locale;
}): Promise<PresenceApiSearch> {
  let resolution = resolveQuery(args.query);
  if (!resolution.resolved && args.alternateQuery && args.alternateQuery !== args.query) {
    const alternate = resolveQuery(args.alternateQuery);
    if (alternate.resolved) {
      resolution = alternate;
    }
  }
  const { source, stores } = await getPresenceStores();
  const repository = getEvidenceRepository(source);
  const evidence = resolution.resolved
    ? await repository.listForTypes(resolution.types.map((match) => match.typeId))
    : [];
  const output = searchPresence({
    query: args.query,
    resolution,
    lat: args.lat,
    lng: args.lng,
    radiusMeters: args.radiusMeters,
    stores,
    evidence,
    locale: args.locale
  });
  return {
    resolution,
    results: output.results.filter((result) => result.resultKind !== "service"),
    serviceResults: output.results.filter((result) => result.resultKind === "service"),
    storeSource: source,
    evidenceSource: repository.kind
  };
}

export async function findPresenceStore(storeId: string): Promise<{
  store: PresenceStoreRecord | null;
  source: "supabase" | "local_osm";
}> {
  const { source, stores } = await getPresenceStores();
  return { store: stores.find((entry) => entry.id === storeId) ?? null, source };
}

export async function getStorePresence(storeId: string, locale: Locale): Promise<{
  store: PresenceStoreRecord;
  items: StorePresenceItem[];
} | null> {
  const { store, source } = await findPresenceStore(storeId);
  if (!store) {
    return null;
  }
  const evidence = await getEvidenceRepository(source).listForStore(store.id);
  return { store, items: storePresenceProfile(store, evidence, locale) };
}

export function hashDeviceId(deviceId: string): string {
  const salt = process.env.PRESENCE_DEVICE_SALT ?? "kiezkauf-dev-salt";
  return createHash("sha256").update(`${salt}:${deviceId}`).digest("hex").slice(0, 40);
}

export type FeedbackOutcome =
  | { ok: true; estimate: PresenceEstimate }
  | { ok: false; status: number; error: string };

export async function recordPresenceFeedback(args: {
  storeId: string;
  productTypeId: string;
  found: boolean;
  deviceId: string;
  interactionId?: string | null;
  query?: string | null;
}): Promise<FeedbackOutcome> {
  const type = PRODUCT_TYPES_BY_ID.get(args.productTypeId);
  if (!type) {
    return { ok: false, status: 400, error: "Unknown product type." };
  }
  const { store, source } = await findPresenceStore(args.storeId);
  if (!store) {
    return { ok: false, status: 404, error: "Unknown store." };
  }
  const repository = getEvidenceRepository(source);
  const result: AddEvidenceResult = await repository.add({
    storeId: store.id,
    productTypeId: type.id,
    signal: args.found ? 1 : -1,
    source: "user",
    deviceHash: hashDeviceId(args.deviceId),
    interactionId: args.interactionId ?? null,
    query: args.query ?? null
  });
  if (!result.ok) {
    const status = result.reason === "rate_limited" ? 429 : result.reason === "invalid_store" ? 404 : 503;
    return { ok: false, status, error: result.reason };
  }
  const evidence = (await repository.listForStore(store.id)).filter((row) => row.productTypeId === type.id);
  return { ok: true, estimate: estimatePresence(priorFor(store, type).probability, evidence) };
}
