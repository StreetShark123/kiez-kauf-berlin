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

const BERLIN_BBOX = {
  south: 52.3383,
  west: 13.0884,
  north: 52.6755,
  east: 13.7612
};

const SHOP_REGEX =
  "supermarket|convenience|greengrocer|bakery|butcher|deli|organic|chemist|beverages|kiosk|health_food|department_store|mall";

const USEFUL_CATEGORIES = new Set([
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
  "pharmacy"
]);

function buildOverpassQuery() {
  const { south, west, north, east } = BERLIN_BBOX;

  return `
[out:json][timeout:300];
(
  nwr["shop"~"${SHOP_REGEX}"](${south},${west},${north},${east});
  nwr["amenity"="pharmacy"](${south},${west},${north},${east});
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
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
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

function normalizeElements(elements) {
  const byExternalId = new Map();

  for (const row of elements) {
    const tags = row.tags ?? {};
    const name = (tags.name ?? "").trim();
    const lat = typeof row.lat === "number" ? row.lat : row.center?.lat;
    const lon = typeof row.lon === "number" ? row.lon : row.center?.lon;

    if (!name || typeof lat !== "number" || typeof lon !== "number") {
      continue;
    }

    const osmCategory = (tags.shop ?? tags.amenity ?? "").trim();
    if (!USEFUL_CATEGORIES.has(osmCategory)) {
      continue;
    }

    const district =
      (tags["addr:suburb"] ?? tags["addr:district"] ?? tags["addr:city_district"] ?? "Berlin").trim() ||
      "Berlin";

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
    description,
    active_status
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
    s.description,
    s.active_status
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
    opening_hours = coalesce(excluded.opening_hours, establishments.opening_hours),
    description = coalesce(establishments.description, excluded.description),
    active_status = excluded.active_status,
    updated_at = now()
  returning id
)
select count(*)::int as promoted_count from promoted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 250);
  const limit = args.limit ? Number(args.limit) : null;
  const offset = args.offset ? Number(args.offset) : 0;
  const resume = Boolean(args.resume);

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
    checkpointFile: CHECKPOINT_FILE
  });

  const query = buildOverpassQuery();
  const payload = await fetchOverpassPayload(query);
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const normalized = normalizeElements(elements);

  const sliced = normalized.slice(startIndex, limit ? startIndex + limit : undefined);

  logInfo("Normalized establishments", {
    rawElements: elements.length,
    uniqueUsefulEstablishments: normalized.length,
    selectedForThisRun: sliced.length
  });

  const outFile = path.join(DATA_DIR, "osm_berlin_establishments.normalized.json");
  await writeJsonFile(outFile, sliced);
  logInfo(`Wrote normalized snapshot to ${outFile}`);

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

  checkpoint.importBerlin = {
    batchId,
    nextIndex: startIndex + processed,
    totalSelected: sliced.length,
    promotedCount,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 2 completed", {
    importedRows: processed,
    promotedCount,
    batchId
  });
}

main().catch((error) => {
  logWarn("Import pipeline failed", String(error));
  process.exit(1);
});
