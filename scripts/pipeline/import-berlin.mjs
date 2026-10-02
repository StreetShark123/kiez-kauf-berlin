import { createHash } from "node:crypto";
import path from "node:path";
import {
  CHECKPOINT_FILE,
  DATA_DIR,
  chunkArray,
  ensureDataDir,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlArray,
  sqlLiteral,
  stableNormalizeText,
  writeJsonFile
} from "./_utils.mjs";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const DEFAULT_BERLIN_BBOX = {
  south: 52.3383,
  west: 13.0884,
  north: 52.6755,
  east: 13.7612
};

const MOABIT_BBOX = {
  south: 52.5171,
  west: 13.3196,
  north: 52.5485,
  east: 13.3798
};

const SHOP_TYPES = [
  "supermarket",
  "convenience",
  "greengrocer",
  "bakery",
  "butcher",
  "deli",
  "organic",
  "chemist",
  "beverages",
  "kiosk",
  "health_food",
  "department_store",
  "mall",
  "antiques",
  "art",
  "craft",
  "stationery",
  "beauty",
  "cosmetics",
  "perfumery",
  "drugstore",
  "medical_supply",
  "orthopaedic",
  "orthopedics",
  "clothes",
  "second_hand",
  "charity",
  "hardware",
  "doityourself",
  "household",
  "copyshop",
  "mobile_phone",
  "electronics",
  "computer",
  "bicycle",
  "locksmith",
  // Everyday-need retail that the presence model covers (batteries, cables, flowers, pet food...).
  "variety_store",
  "newsagent",
  "tobacco",
  "florist",
  "garden_centre",
  "pet",
  "books",
  "toys",
  "alcohol",
  "wine",
  "confectionery",
  "pastry",
  "seafood",
  "coffee",
  "tea",
  "baby_goods",
  "shoes",
  "houseware",
  "zero_waste"
];

const SHOP_REGEX = SHOP_TYPES.join("|");

const AMENITY_TYPES = ["pharmacy", "bicycle_repair", "internet_cafe"];
const AMENITY_REGEX = AMENITY_TYPES.join("|");

const CRAFT_TYPES = [
  "tailor",
  "shoemaker",
  "watchmaker",
  "key_cutter",
  "electronics_repair",
  "bicycle_repair",
  "optician"
];
const CRAFT_REGEX = CRAFT_TYPES.join("|");

const USEFUL_CATEGORIES = new Set([
  ...SHOP_TYPES,
  ...AMENITY_TYPES,
  ...CRAFT_TYPES
]);

function parseBboxArg(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const [southRaw, westRaw, northRaw, eastRaw] = value.split(",").map((item) => Number(item.trim()));
  if (![southRaw, westRaw, northRaw, eastRaw].every((item) => Number.isFinite(item))) {
    return null;
  }

  if (!(southRaw < northRaw && westRaw < eastRaw)) {
    return null;
  }

  return {
    south: southRaw,
    west: westRaw,
    north: northRaw,
    east: eastRaw
  };
}

function resolveImportScope(args) {
  const neighborhood = String(args.neighborhood ?? "").trim().toLowerCase();
  const districtFilter = String(args["district-filter"] ?? neighborhood ?? "").trim().toLowerCase();
  const areaName = String(args["area-name"] ?? "").trim();
  const forceDistrict = String(args["force-district"] ?? "").trim();

  if (neighborhood === "moabit") {
    return {
      label: "moabit",
      bbox: MOABIT_BBOX,
      districtFilter: districtFilter || "moabit",
      areaName: null,
      forceDistrict: forceDistrict || null
    };
  }

  if (areaName) {
    return {
      label: stableNormalizeText(areaName).replace(/\s+/g, "-") || "custom-area",
      bbox: null,
      districtFilter,
      areaName,
      forceDistrict: forceDistrict || null
    };
  }

  const bboxFromArg = parseBboxArg(args.bbox);
  if (bboxFromArg) {
    return {
      label: "custom",
      bbox: bboxFromArg,
      districtFilter,
      areaName: null,
      forceDistrict: forceDistrict || null
    };
  }

  return {
    label: "berlin",
    bbox: DEFAULT_BERLIN_BBOX,
    districtFilter,
    areaName: null,
    forceDistrict: forceDistrict || null
  };
}

function buildOverpassQuery(scope) {
  if (scope.areaName) {
    const areaNameSafe = scope.areaName.replace(/"/g, '\\"');
    return `
[out:json][timeout:300];
area["name"="Berlin"]["boundary"="administrative"]->.berlin;
rel(area.berlin)["boundary"="administrative"]["name"="${areaNameSafe}"];
map_to_area->.searchArea;
(
  nwr["shop"~"${SHOP_REGEX}"](area.searchArea);
  nwr["amenity"~"${AMENITY_REGEX}"](area.searchArea);
  nwr["craft"~"${CRAFT_REGEX}"](area.searchArea);
);
out center tags;
`.trim();
  }

  const { south, west, north, east } = scope.bbox;

  return `
[out:json][timeout:300];
(
  nwr["shop"~"${SHOP_REGEX}"](${south},${west},${north},${east});
  nwr["amenity"~"${AMENITY_REGEX}"](${south},${west},${north},${east});
  nwr["craft"~"${CRAFT_REGEX}"](${south},${west},${north},${east});
);
out center tags;
`.trim();
}

async function fetchOverpassPayload(query) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        logInfo(`Fetching OSM data from ${endpoint} (attempt ${attempt})`);

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json",
            "User-Agent": "kiez-kauf-finder/0.1 (data-refresh; contact=admin@kiezkauf.local)"
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(120000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const payload = await response.json();
        const elements = Array.isArray(payload.elements) ? payload.elements : [];
        logInfo(`Loaded ${elements.length} raw elements from ${endpoint}`);
        return payload;
      } catch (error) {
        lastError = error;
        logWarn(`Endpoint failed: ${endpoint} (attempt ${attempt})`, String(error));
      }
    }
  }

  throw new Error(`All Overpass endpoints failed. Last error: ${String(lastError)}`);
}

function toAddress(tags, districtFallback) {
  const street = tags["addr:street"] ?? "";
  const house = tags["addr:housenumber"] ?? "";
  const postcode = tags["addr:postcode"] ?? "";
  const city = tags["addr:city"] ?? "Berlin";

  const streetPart = [street, house].filter(Boolean).join(" ").trim();
  const districtPart = districtFallback || "Berlin";
  const output = [streetPart, postcode, city].filter(Boolean).join(", ");

  if (output) {
    return output;
  }

  return districtPart ? `${districtPart}, Berlin` : "Berlin";
}

function normalizeElements(elements, scope) {
  const byExternalId = new Map();
  const districtFilterNormalized = stableNormalizeText(scope.districtFilter ?? "");
  const forceDistrict = scope.forceDistrict ? String(scope.forceDistrict).trim() : null;

  for (const row of elements) {
    const tags = row.tags ?? {};
    const name = (tags.name ?? "").trim();
    const lat = typeof row.lat === "number" ? row.lat : row.center?.lat;
    const lon = typeof row.lon === "number" ? row.lon : row.center?.lon;

    if (!name || typeof lat !== "number" || typeof lon !== "number") {
      continue;
    }

    const rawOsmCategory = (tags.shop ?? tags.amenity ?? tags.craft ?? "").trim();
    const secondHandTag = stableNormalizeText(tags.second_hand ?? "");
    const isSecondHandTagged =
      secondHandTag === "yes" || secondHandTag === "only" || secondHandTag === "true";
    const osmCategory = isSecondHandTagged ? "second_hand" : rawOsmCategory;
    if (!USEFUL_CATEGORIES.has(osmCategory)) {
      continue;
    }

    const district = forceDistrict
      ? forceDistrict
      : (tags["addr:suburb"] ?? tags["addr:district"] ?? tags["addr:city_district"] ?? "Berlin").trim() || "Berlin";
    const districtNormalized = stableNormalizeText(district);
    if (districtFilterNormalized && !districtNormalized.includes(districtFilterNormalized)) {
      continue;
    }

    const externalId = `${row.type}/${row.id}`;
    const normalizedName = stableNormalizeText(name);
    const normalizedAddress = stableNormalizeText(toAddress(tags, district));
    const checksum = createHash("sha1")
      .update(`${normalizedName}|${normalizedAddress}|${lat.toFixed(6)}|${lon.toFixed(6)}|${osmCategory}`)
      .digest("hex");

    const candidate = {
      external_source: "osm-overpass",
      external_id: externalId,
      name,
      address: toAddress(tags, district),
      district,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      osm_category: osmCategory,
      app_categories: [],
      website: tags.website ?? null,
      phone: tags.phone ?? null,
      opening_hours: tags.opening_hours ?? null,
      description: "Imported from OSM Overpass for Berlin.",
      active_status: "active",
      checksum,
      is_useful: true,
      raw_tags: tags,
      source_payload: {
        osm_type: row.type,
        osm_id: row.id,
        source: "overpass",
        fetched_at: new Date().toISOString()
      }
    };

    const previous = byExternalId.get(externalId);
    if (!previous) {
      byExternalId.set(externalId, candidate);
      continue;
    }

    const prevScore = scoreStore(previous);
    const newScore = scoreStore(candidate);
    if (newScore > prevScore) {
      byExternalId.set(externalId, candidate);
    }
  }

  const byNameAndLocation = new Map();
  for (const item of byExternalId.values()) {
    const fuzzyKey = `${stableNormalizeText(item.name)}|${item.lat.toFixed(4)}|${item.lon.toFixed(4)}|${item.osm_category}`;
    const existing = byNameAndLocation.get(fuzzyKey);
    if (!existing || scoreStore(item) > scoreStore(existing)) {
      byNameAndLocation.set(fuzzyKey, item);
    }
  }

  return [...byNameAndLocation.values()].sort((a, b) => {
    const districtCmp = a.district.localeCompare(b.district, "de");
    if (districtCmp !== 0) {
      return districtCmp;
    }
    return a.name.localeCompare(b.name, "de");
  });
}

function scoreStore(item) {
  let score = 0;
  if (item.address && item.address !== "Berlin") {
    score += 3;
  }
  if (item.opening_hours) {
    score += 2;
  }
  if (item.phone) {
    score += 1;
  }
  if (item.website) {
    score += 1;
  }
  if (item.district && item.district !== "Berlin") {
    score += 1;
  }
  return score;
}

function buildUpsertStageSql(rows, batchId) {
  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(batchId),
        sqlLiteral(row.external_source),
        sqlLiteral(row.external_id),
        sqlLiteral(row.name),
        sqlLiteral(row.address),
        sqlLiteral(row.district),
        sqlLiteral(row.lat),
        sqlLiteral(row.lon),
        sqlLiteral(row.osm_category),
        sqlArray(row.app_categories),
        sqlLiteral(row.website),
        sqlLiteral(row.phone),
        sqlLiteral(row.opening_hours),
        sqlLiteral(row.description),
        sqlLiteral(row.active_status),
        sqlLiteral(row.checksum),
        sqlLiteral(row.is_useful),
        sqlLiteral(row.raw_tags),
        sqlLiteral(row.source_payload)
      ].join(",")})`;
    })
    .join(",\n");

  return `
insert into berlin_establishment_stage (
  import_batch_id,
  external_source,
  external_id,
  name,
  address,
  district,
  lat,
  lon,
  osm_category,
  app_categories,
  website,
  phone,
  opening_hours,
  description,
  active_status,
  checksum,
  is_useful,
  raw_tags,
  source_payload
)
values
${values}
on conflict (external_source, external_id)
do update set
  import_batch_id = excluded.import_batch_id,
  name = excluded.name,
  address = excluded.address,
  district = excluded.district,
  lat = excluded.lat,
  lon = excluded.lon,
  osm_category = excluded.osm_category,
  website = excluded.website,
  phone = excluded.phone,
  opening_hours = excluded.opening_hours,
  description = excluded.description,
  active_status = excluded.active_status,
  checksum = excluded.checksum,
  is_useful = excluded.is_useful,
  raw_tags = excluded.raw_tags,
  source_payload = excluded.source_payload,
  imported_at = now(),
  updated_at = now();
`;
}

function buildPromoteSql(batchId) {
  return `
with promoted as (
  insert into establishments (
    external_source,
    external_id,
    name,
    address,
    district,
    lat,
    lon,
    osm_category,
    app_categories,
    website,
    phone,
    opening_hours,
    opening_hours_osm,
    opening_hours_source,
    opening_hours_source_url,
    opening_hours_last_checked_at,
    opening_hours_confidence,
    description,
    active_status,
    source_url,
    last_imported_at,
    last_seen_at,
    freshness_score,
    is_closed_candidate,
    closed_candidate_since
  )
  select
    s.external_source,
    s.external_id,
    s.name,
    s.address,
    s.district,
    s.lat,
    s.lon,
    s.osm_category,
    s.app_categories,
    s.website,
    s.phone,
    s.opening_hours,
    s.opening_hours,
    case
      when s.opening_hours is not null and btrim(s.opening_hours) <> '' then 'osm'
      else null
    end as opening_hours_source,
    ('https://www.openstreetmap.org/' || s.external_id) as opening_hours_source_url,
    case
      when s.opening_hours is not null and btrim(s.opening_hours) <> '' then now()
      else null
    end as opening_hours_last_checked_at,
    case
      when s.opening_hours is not null and btrim(s.opening_hours) <> '' then 0.88
      else null
    end::numeric(5,4) as opening_hours_confidence,
    s.description,
    s.active_status,
    coalesce(s.website, ('https://www.openstreetmap.org/' || s.external_id)) as source_url,
    now() as last_imported_at,
    now() as last_seen_at,
    0.9::numeric(5,4) as freshness_score,
    false as is_closed_candidate,
    null::timestamptz as closed_candidate_since
  from berlin_establishment_stage s
  where s.import_batch_id = ${sqlLiteral(batchId)}
    and s.is_useful = true
  on conflict (external_source, external_id)
  do update set
    name = excluded.name,
    address = excluded.address,
    district = excluded.district,
    lat = excluded.lat,
    lon = excluded.lon,
    osm_category = excluded.osm_category,
    app_categories = case
      when coalesce(cardinality(establishments.app_categories), 0) > 0 then establishments.app_categories
      else excluded.app_categories
    end,
    website = coalesce(excluded.website, establishments.website),
    phone = coalesce(excluded.phone, establishments.phone),
    opening_hours = coalesce(establishments.opening_hours, excluded.opening_hours),
    opening_hours_osm = coalesce(excluded.opening_hours_osm, establishments.opening_hours_osm),
    opening_hours_source = case
      when excluded.opening_hours_osm is not null and btrim(excluded.opening_hours_osm) <> '' then 'osm'
      else establishments.opening_hours_source
    end,
    opening_hours_source_url = case
      when excluded.opening_hours_osm is not null and btrim(excluded.opening_hours_osm) <> '' then excluded.opening_hours_source_url
      else establishments.opening_hours_source_url
    end,
    opening_hours_last_checked_at = case
      when excluded.opening_hours_osm is not null and btrim(excluded.opening_hours_osm) <> '' then now()
      else establishments.opening_hours_last_checked_at
    end,
    opening_hours_confidence = case
      when excluded.opening_hours_osm is not null and btrim(excluded.opening_hours_osm) <> '' then 0.88
      else establishments.opening_hours_confidence
    end,
    description = coalesce(establishments.description, excluded.description),
    active_status = excluded.active_status,
    source_url = coalesce(establishments.source_url, excluded.source_url),
    last_imported_at = now(),
    last_seen_at = now(),
    freshness_score = coalesce(establishments.freshness_score, excluded.freshness_score, 0.9),
    is_closed_candidate = false,
    closed_candidate_since = null,
    updated_at = now()
  returning id
)
select count(*)::int as promoted_count from promoted;
`;
}

function buildMarkMissingAsClosedCandidatesSql(batchId, graceDays) {
  return `
with seen as (
  select external_source, external_id
  from berlin_establishment_stage
  where import_batch_id = ${sqlLiteral(batchId)}
    and is_useful = true
),
updated as (
  update establishments e
  set
    is_closed_candidate = true,
    closed_candidate_since = coalesce(e.closed_candidate_since, now()),
    active_status = case when e.active_status = 'active' then 'unknown'::active_status_enum else e.active_status end,
    freshness_score = greatest(0.05, coalesce(e.freshness_score, 0.75) - 0.12),
    updated_at = now()
  where e.external_source = 'osm-overpass'
    and not exists (
      select 1
      from seen s
      where s.external_source = e.external_source
        and s.external_id = e.external_id
    )
    and coalesce(e.last_seen_at, now() - interval '365 day') < now() - interval '${Number(graceDays)} day'
  returning e.id
)
select count(*)::int as flagged_rows from updated;
`;
}

const REFRESH_FRESHNESS_SQL = "select refresh_establishment_freshness_scores()::int as refreshed_rows;";

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 250);
  const limit = args.limit ? Number(args.limit) : null;
  const offset = args.offset ? Number(args.offset) : 0;
  const resume = Boolean(args.resume);
  const closeCandidateGraceDays = Number(args["close-candidate-grace-days"] ?? 21);
  const markMissingArg = args["mark-missing"];

  await ensureDataDir();

  const checkpoint = await loadCheckpoint();
  const importState = checkpoint.importBerlin ?? {};
  let startIndex = offset;
  let batchId = args["batch-id"] ?? null;

  if (resume) {
    startIndex = Number(importState.nextIndex ?? startIndex);
    batchId = batchId ?? importState.batchId ?? null;
  }

  if (!batchId) {
    batchId = `berlin-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  logInfo("Phase 2 - importing and normalizing Berlin establishments", {
    batchSize,
    startIndex,
    limit,
    batchId,
    scope: {
      neighborhood: String(args.neighborhood ?? ""),
      districtFilter: String(args["district-filter"] ?? ""),
      bbox: String(args.bbox ?? ""),
      areaName: String(args["area-name"] ?? ""),
      forceDistrict: String(args["force-district"] ?? "")
    },
    checkpointFile: CHECKPOINT_FILE
  });

  const scope = resolveImportScope(args);

  const query = buildOverpassQuery(scope);
  const payload = await fetchOverpassPayload(query);
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const normalized = normalizeElements(elements, scope);

  const sliced = normalized.slice(startIndex, limit ? startIndex + limit : undefined);

  logInfo("Normalized establishments", {
    rawElements: elements.length,
    uniqueUsefulEstablishments: normalized.length,
    selectedForThisRun: sliced.length,
    scopeLabel: scope.label,
    districtFilter: scope.districtFilter || null,
    bbox: scope.bbox
  });

  const outFile = path.join(DATA_DIR, `osm_${scope.label}_establishments.normalized.json`);
  await writeJsonFile(outFile, sliced);
  logInfo(`Wrote normalized snapshot to ${outFile}`);

  if (args["snapshot-only"] === true || args["snapshot-only"] === "true") {
    logInfo("Snapshot-only run: skipped Supabase stage/promote steps");
    return;
  }

  const chunks = chunkArray(sliced, batchSize);
  let processed = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const rows = chunks[i];
    const sql = buildUpsertStageSql(rows, batchId);
    await runSupabaseQuery({ sql, output: "json" });

    processed += rows.length;
    const nextIndex = startIndex + processed;

    checkpoint.importBerlin = {
      batchId,
      nextIndex,
      totalSelected: sliced.length,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo(`Imported batch ${i + 1}/${chunks.length}`, {
      rows: rows.length,
      cumulative: processed,
      nextIndex
    });
  }

  const promoteResult = await runSupabaseQuery({
    sql: buildPromoteSql(batchId),
    output: "json"
  });

  const promotedCount = Number(promoteResult.parsed.rows?.[0]?.promoted_count ?? 0);
  logInfo("Promoted stage rows into establishments", { promotedCount, batchId });

  const canMarkMissing =
    markMissingArg === true ||
    markMissingArg === "true" ||
    (markMissingArg !== "false" && !limit && startIndex === 0 && !resume);

  let flaggedClosedCandidateCount = 0;
  if (canMarkMissing) {
    const closeResult = await runSupabaseQuery({
      sql: buildMarkMissingAsClosedCandidatesSql(batchId, closeCandidateGraceDays),
      output: "json"
    });
    flaggedClosedCandidateCount = Number(closeResult.parsed.rows?.[0]?.flagged_rows ?? 0);
  } else {
    logInfo("Skipped closed-candidate reconciliation (partial run or explicitly disabled)");
  }

  const freshnessResult = await runSupabaseQuery({
    sql: REFRESH_FRESHNESS_SQL,
    output: "json"
  });
  const refreshedRows = Number(freshnessResult.parsed.rows?.[0]?.refreshed_rows ?? 0);
  logInfo("Refreshed establishment freshness scores", { refreshedRows });

  checkpoint.importBerlin = {
    batchId,
    nextIndex: startIndex + processed,
    totalSelected: sliced.length,
    promotedCount,
    flaggedClosedCandidateCount,
    refreshedRows,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 2 completed", {
    importedRows: processed,
    promotedCount,
    flaggedClosedCandidateCount,
    refreshedRows,
    batchId
  });
}

main().catch((error) => {
  logWarn("Import pipeline failed", String(error));
  process.exit(1);
});
