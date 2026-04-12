import { normalizeQuery } from "@/lib/maps";
import { mockOffers, mockProducts, mockStores } from "@/lib/mock-data";
import { hasSupabase, supabase } from "@/lib/supabase";
import type { Offer, Product, SearchResult, Store, StoreDetail } from "@/lib/types";

// Berlin Mitte (Alexanderplatz area) as the default map/search center.
const BERLIN_CENTER = { lat: 52.5208, lng: 13.4094 };
const DEV_DEBUG = process.env.NODE_ENV !== "production";

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
  sourceType?: SearchResult["sourceType"];
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
  updated_at: string;
  establishment_name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  product_normalized_name: string;
  product_group: string;
};

type SupabaseCanonicalProductRow = {
  id: number;
  normalized_name: string;
  display_name_en: string | null;
  display_name_es: string | null;
  display_name_de: string | null;
  synonyms: string[] | null;
  product_group: string;
};

type DatasetSearchStrategy = "product_name" | "canonical_multilingual" | "group_keyword";

type DatasetSearchResponse = {
  rows: JoinedRow[];
  strategy: DatasetSearchStrategy;
};

const KEYWORD_GROUP_MAP: Array<{ group: string; terms: string[] }> = [
  {
    group: "beverages",
    terms: ["beer", "bier", "cerveza", "drink", "bebida", "getraenk", "getrank"]
  },
  {
    group: "fresh_produce",
    terms: ["garlic", "knoblauch", "ajo", "vegetable", "verdura", "gemuese", "gemuse"]
  },
  {
    group: "household",
    terms: ["pliers", "zange", "alicates", "tool", "herramienta", "werkzeug"]
  }
];

let canonicalCatalogCache:
  | {
      loadedAt: number;
      rows: SupabaseCanonicalProductRow[];
    }
  | null = null;

const CANONICAL_CACHE_TTL_MS = 1000 * 60 * 10;

function normalizedContains(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

function inferProductGroupsFromKeyword(query: string): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  return KEYWORD_GROUP_MAP.filter(({ terms }) => terms.some((term) => normalizedContains(normalized, term))).map(
    ({ group }) => group
  );
}

async function getCanonicalCatalog(): Promise<SupabaseCanonicalProductRow[]> {
  if (!supabase) {
    return [];
  }

  if (canonicalCatalogCache && Date.now() - canonicalCatalogCache.loadedAt < CANONICAL_CACHE_TTL_MS) {
    return canonicalCatalogCache.rows;
  }

  const { data, error } = await supabase
    .from("canonical_products")
    .select("id, normalized_name, display_name_en, display_name_es, display_name_de, synonyms, product_group")
    .limit(1000);

  if (error) {
    throw new Error(`Supabase canonical products query failed: ${error.message}`);
  }

  const rows = (data ?? []) as SupabaseCanonicalProductRow[];
  canonicalCatalogCache = {
    loadedAt: Date.now(),
    rows
  };
  return rows;
}

function findCanonicalProductIdsByQuery(query: string, products: SupabaseCanonicalProductRow[]): number[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const matched = products.filter((product) => {
    const terms = [
      product.normalized_name,
      product.display_name_en ?? "",
      product.display_name_es ?? "",
      product.display_name_de ?? "",
      ...(product.synonyms ?? [])
    ]
      .map((item) => normalizeQuery(item))
      .filter(Boolean);

    return terms.some((term) => normalizedContains(term, normalized));
  });

  return matched.map((product) => product.id);
}

function rankResults(rows: JoinedRow[], args: { query: string; lat: number; lng: number; radius: number }): SearchResult[] {
  const normalized = normalizeQuery(args.query);
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
      const confidenceScore = typeof row.confidence === "number" ? row.confidence * 2000 : 0;
      const validationScore =
        row.validationStatus === "validated"
          ? 1500
          : row.validationStatus === "likely"
            ? 700
            : row.validationStatus === "rejected"
              ? -10000
              : 0;

      const rank =
        exactMatch * 100000 + includesMatch * 50000 + confidenceScore + validationScore - distanceMeters - freshnessHours * 2;

      return {
        offer: row.offer,
        product: row.product,
        store: row.store,
        distanceMeters,
        freshnessHours,
        rank,
        confidence: row.confidence ?? null,
        validationStatus: row.validationStatus ?? null,
        whyThisProductMatches: row.whyThisProductMatches ?? null,
        sourceType: row.sourceType ?? null
      };
    })
    .filter((row) => row.distanceMeters <= args.radius)
    .sort((a, b) => b.rank - a.rank);
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

  return rows
    .map((row) => {
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
        return null;
      }

      return {
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
          lng: store.lng
        } satisfies Store,
        product: {
          id: product.id,
          normalizedName: product.normalized_name,
          brand: product.brand,
          category: product.category
        } satisfies Product
      };
    })
    .filter((row): row is JoinedRow => row !== null);
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

  const normalized = normalizeQuery(args.query);
  const canonicalProducts = await getCanonicalCatalog();
  const canonicalIds = findCanonicalProductIdsByQuery(normalized, canonicalProducts);
  const inferredGroups = canonicalIds.length === 0 ? inferProductGroupsFromKeyword(normalized) : [];
  const limit = args.limit ?? 450;
  const bounds = getBoundingBoxFromRadius({
    lat: args.lat,
    lng: args.lng,
    radiusMeters: args.radiusMeters
  });

  let query = supabase
    .from("search_product_establishment_dataset")
    .select(
      "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, product_normalized_name, product_group"
    );

  query = query
    .gte("lat", bounds.minLat)
    .lte("lat", bounds.maxLat)
    .gte("lon", bounds.minLng)
    .lte("lon", bounds.maxLng);

  let strategy: DatasetSearchStrategy = "product_name";
  if (canonicalIds.length > 0) {
    query = query.in("canonical_product_id", canonicalIds);
    strategy = "canonical_multilingual";
  } else if (inferredGroups.length > 0) {
    query = query.in("product_group", inferredGroups);
    strategy = "group_keyword";
  } else {
    query = query.ilike("product_normalized_name", `%${normalized}%`);
  }

  const { data, error } = await query
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

    throw new Error(`Supabase search dataset query failed: ${error.message}`);
  }

  const rows = (data ?? []) as SupabaseSearchDatasetRow[];

  const joinedRows: JoinedRow[] = [];
  let malformedRows = 0;

  for (const row of rows) {
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
    const offerId = `candidate_${storeId}_${productId}_${row.source_type ?? "unknown"}`;
    const updatedAt = row.updated_at ?? new Date().toISOString();

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
        name: String(row.establishment_name ?? "Unknown store"),
        address: String(row.address ?? ""),
        district: String(row.district ?? "Berlin"),
        openingHours: "",
        lat: row.lat,
        lng: row.lon,
        appCategories: row.app_categories ?? [],
        osmCategory: row.osm_category
      },
      product: {
        id: productId,
        normalizedName: String(row.product_normalized_name ?? ""),
        brand: null,
        category: String(row.product_group ?? "")
      },
      confidence: row.confidence,
      validationStatus: row.validation_status,
      whyThisProductMatches: row.why_this_product_matches,
      sourceType: row.source_type
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
      "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, product_normalized_name, product_group"
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
  const store: Store = {
    id: String(first.establishment_id),
    name: first.establishment_name,
    address: first.address,
    district: first.district,
    openingHours: "",
    lat: first.lat,
    lng: first.lon,
    appCategories: first.app_categories ?? [],
    osmCategory: first.osm_category
  };

  return {
    store,
    offers: rows.map((row) => {
      const storeId = String(row.establishment_id);
      const productId = String(row.canonical_product_id);
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
          brand: null,
          category: row.product_group
        }
      };
    })
  };
}

export async function searchOffers(args: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}): Promise<SearchResult[]> {
  const lat = typeof args.lat === "number" ? args.lat : BERLIN_CENTER.lat;
  const lng = typeof args.lng === "number" ? args.lng : BERLIN_CENTER.lng;
  const radius = typeof args.radiusMeters === "number" ? args.radiusMeters : 2000;

  let rows: JoinedRow[];
  let datasetStrategy: DatasetSearchStrategy | null = null;
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
    } else {
      rows = await getSupabaseRowsLegacy();
    }
  } else {
    rows = getMockRows();
  }

  const normalized = normalizeQuery(args.query);
  const filtered =
    datasetStrategy === "canonical_multilingual" || datasetStrategy === "group_keyword"
      ? rows
      : rows.filter((row) => {
          const productName = normalizeQuery(row.product.normalizedName);
          return productName === normalized || productName.includes(normalized);
        });

  return dedupeRankedResults(rankResults(filtered, { query: args.query, lat, lng, radius }));
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
  dedupeRankedResults
};
