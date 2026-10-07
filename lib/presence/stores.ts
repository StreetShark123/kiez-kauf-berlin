import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PresenceStore } from "@/lib/presence/priors";

export type PresenceStoreRecord = PresenceStore & {
  address: string;
  district: string;
  lat: number;
  lng: number;
  openingHours: string | null;
  website: string | null;
  phone: string | null;
  appCategories: string[];
};

export type StoreSourceKind = "supabase" | "local_osm";

// Only the OSM tags the presence model reads; keeps memory and payloads small.
const KEPT_TAGS = ["brand", "organic", "diet:halal", "bulk_purchase", "zero_waste", "second_hand", "shop", "amenity", "craft"];

function pickTags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const tags: Record<string, string> = {};
  for (const key of KEPT_TAGS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      tags[key] = value.trim();
    }
  }
  return tags;
}

export function localStoreId(externalId: string): string {
  return `osm-${externalId.replace(/\//g, "-")}`;
}

type LocalOsmRow = {
  external_id: string;
  name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories?: string[];
  website?: string | null;
  phone?: string | null;
  opening_hours?: string | null;
  active_status?: string;
  raw_tags?: Record<string, unknown>;
};

export function mapLocalOsmRow(row: LocalOsmRow): PresenceStoreRecord | null {
  if (!row?.external_id || !row.name || !Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
    return null;
  }
  if (row.active_status && row.active_status !== "active") {
    return null;
  }
  const tags = pickTags(row.raw_tags);
  return {
    id: localStoreId(row.external_id),
    name: row.name,
    osmCategory: row.osm_category ?? null,
    brand: tags.brand ?? null,
    tags,
    address: row.address ?? "",
    district: row.district ?? "Berlin",
    lat: row.lat,
    lng: row.lon,
    openingHours: row.opening_hours ?? null,
    website: row.website ?? null,
    phone: row.phone ?? null,
    appCategories: Array.isArray(row.app_categories) ? row.app_categories : []
  };
}

export async function loadLocalOsmStores(dataDir = path.join(process.cwd(), "data", "berlin")): Promise<PresenceStoreRecord[]> {
  const files = (await fs.readdir(dataDir)).filter(
    (file) => file.startsWith("osm_") && file.endsWith("_establishments.normalized.json")
  );
  const byId = new Map<string, PresenceStoreRecord>();
  for (const file of files.sort()) {
    const parsed = JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8")) as unknown;
    const rows = Array.isArray(parsed) ? (parsed as LocalOsmRow[]) : [];
    for (const row of rows) {
      const store = mapLocalOsmRow(row);
      if (store && !byId.has(store.id)) {
        byId.set(store.id, store);
      }
    }
  }
  return Array.from(byId.values());
}

function getServerSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type SupabaseStoreRow = {
  id: number;
  name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  brand: string | null;
  presence_tags: Record<string, unknown> | null;
};

async function loadSupabaseStores(client: SupabaseClient): Promise<PresenceStoreRecord[]> {
  const pageSize = 1000;
  const stores: PresenceStoreRecord[] = [];
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await client
      .from("presence_establishments")
      .select("id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, brand, presence_tags")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`presence_establishments query failed: ${error.message}`);
    }
    const rows = (data ?? []) as SupabaseStoreRow[];
    for (const row of rows) {
      const tags = pickTags(row.presence_tags);
      stores.push({
        id: String(row.id),
        name: row.name,
        osmCategory: row.osm_category,
        brand: row.brand ?? tags.brand ?? null,
        tags,
        address: row.address,
        district: row.district,
        lat: row.lat,
        lng: row.lon,
        openingHours: row.opening_hours,
        website: row.website,
        phone: row.phone,
        appCategories: row.app_categories ?? []
      });
    }
    if (rows.length < pageSize) {
      break;
    }
  }
  return stores;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { loadedAt: number; source: StoreSourceKind; stores: PresenceStoreRecord[] } | null = null;
let inflight: Promise<{ source: StoreSourceKind; stores: PresenceStoreRecord[] }> | null = null;

/**
 * Store universe for the presence engine. Supabase when configured (ids = establishments.id,
 * so existing store pages keep working); otherwise the OSM snapshots committed in data/berlin.
 */
export async function getPresenceStores(): Promise<{ source: StoreSourceKind; stores: PresenceStoreRecord[] }> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache;
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    const client = getServerSupabase();
    if (client && process.env.PRESENCE_STORE_SOURCE !== "local") {
      try {
        const stores = await loadSupabaseStores(client);
        if (stores.length > 0) {
          cache = { loadedAt: Date.now(), source: "supabase", stores };
          return cache;
        }
      } catch (error) {
        console.warn("[presence] falling back to local OSM stores:", error instanceof Error ? error.message : error);
      }
    }
    const stores = await loadLocalOsmStores();
    cache = { loadedAt: Date.now(), source: "local_osm", stores };
    return cache;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function getServerSupabaseClient(): SupabaseClient | null {
  return getServerSupabase();
}
