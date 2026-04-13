import { normalizeQuery } from "@/lib/maps";
import { mockOffers, mockProducts, mockStores } from "@/lib/mock-data";
import { hasSupabase, supabase } from "@/lib/supabase";
import type { Offer, Product, SearchResult, Store, StoreDetail } from "@/lib/types";
import { applyVocabularyTypos, GENERIC_QUERY_TERMS, KEYWORD_GROUP_MAP } from "@/lib/vocabulary";

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
  lastCheckedAt?: string | null;
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
  candidate_last_checked_at?: string | null;
  updated_at: string;
  establishment_name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  opening_hours?: string | null;
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

const MAX_SEARCH_RESULTS = 80;
const MIN_CONFIDENCE_FOR_WEAK_MATCH = 0.28;

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

function inferProductGroupsFromKeyword(query: string): string[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return [];
  }

  return KEYWORD_GROUP_MAP.filter(({ terms }) =>
    terms.some((term) => normalizedFuzzyMatch(normalizeQuery(term), normalized))
  ).map(({ group }) => group);
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
  const normalized = normalizeSearchQuery(query);
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

    return terms.some((term) => normalizedFuzzyMatch(term, normalized));
  });

  return matched.map((product) => product.id);
}

function rankResults(rows: JoinedRow[], args: { query: string; lat: number; lng: number; radius: number }): SearchResult[] {
  const normalized = normalizeSearchQuery(args.query);
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
        lastCheckedAt: row.lastCheckedAt ?? row.offer.updatedAt,
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
  const db = supabase;

  const normalized = normalizeSearchQuery(args.query);
  const canonicalProducts = await getCanonicalCatalog();
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
        "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, opening_hours, product_normalized_name, product_group, candidate_last_checked_at"
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

  let rows: SupabaseSearchDatasetRow[] = [];
  let strategy: DatasetSearchStrategy = "product_name";

  if (canonicalIds.length > 0) {
    const canonicalRows = await executeQuery("canonical_multilingual", (queryBuilder) =>
      queryBuilder.in("canonical_product_id", canonicalIds)
    );
    if (canonicalRows === null) {
      return null;
    }
    if (canonicalRows.length > 0) {
      rows = canonicalRows;
      strategy = "canonical_multilingual";
    }
  }

  if (rows.length === 0 && inferredGroups.length > 0) {
    const groupRows = await executeQuery("group_keyword", (queryBuilder) =>
      queryBuilder.in("product_group", inferredGroups)
    );
    if (groupRows === null) {
      return null;
    }
    if (groupRows.length > 0) {
      rows = groupRows;
      strategy = "group_keyword";
    }
  }

  if (rows.length === 0) {
    const fallbackRows = await executeQuery("product_name", (queryBuilder) =>
      queryBuilder.ilike("product_normalized_name", `%${normalized}%`)
    );
    if (fallbackRows === null) {
      return null;
    }
    rows = fallbackRows;
    strategy = "product_name";
  }

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
        openingHours: String(row.opening_hours ?? ""),
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
      lastCheckedAt: row.candidate_last_checked_at ?? row.updated_at ?? null,
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
      "establishment_id, canonical_product_id, source_type, confidence, validation_status, why_this_product_matches, updated_at, establishment_name, address, district, lat, lon, osm_category, app_categories, opening_hours, product_normalized_name, product_group"
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
  const store: Store = {
    id: String(first.establishment_id),
    name: first.establishment_name,
    address: first.address,
    district: first.district,
    openingHours: String(first.opening_hours ?? ""),
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

  const normalized = normalizeSearchQuery(args.query);
  if (GENERIC_QUERY_TERMS.has(normalized)) {
    return [];
  }

  const filtered =
    datasetStrategy === "canonical_multilingual" || datasetStrategy === "group_keyword"
      ? rows
      : rows.filter((row) => {
          const productName = normalizeQuery(row.product.normalizedName);
          return productName === normalized || productName.includes(normalized);
        });
  const plausibilityFiltered = filtered.filter((row) => {
    const productName = normalizeQuery(row.product.normalizedName);
    const hasStrongTextMatch = productName === normalized || productName.includes(normalized);
    if (hasStrongTextMatch) {
      return true;
    }
    const confidence = typeof row.confidence === "number" ? row.confidence : 0;
    return confidence >= MIN_CONFIDENCE_FOR_WEAK_MATCH;
  });

  return dedupeRankedResults(rankResults(plausibilityFiltered, { query: args.query, lat, lng, radius })).slice(
    0,
    MAX_SEARCH_RESULTS
  );
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
