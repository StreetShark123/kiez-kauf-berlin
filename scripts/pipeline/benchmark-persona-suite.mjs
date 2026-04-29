import path from "node:path";
import {
  CHECKPOINT_FILE,
  PROJECT_ROOT,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  readJsonFile,
  runSupabaseQuery,
  saveCheckpoint,
  stableNormalizeText,
  writeJsonFile
} from "./_utils.mjs";

const BENCHMARK_FILE_DEFAULT = path.join(PROJECT_ROOT, "data", "berlin", "persona-benchmark.v1.json");
const REPORTS_DIR = path.join(PROJECT_ROOT, "data", "berlin", "reports");

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const earthRadius = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const part1 =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const part2 = 2 * Math.atan2(Math.sqrt(part1), Math.sqrt(1 - part1));
  return earthRadius * part2;
}

function splitTokens(value) {
  return stableNormalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseNumeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function levenshteinDistanceWithinLimit(a, b, maxDistance) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
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

function fuzzyTokenMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return false;
  const maxDistance = longest >= 8 ? 2 : 1;
  return levenshteinDistanceWithinLimit(a, b, maxDistance) <= maxDistance;
}

function fuzzyContains(normalizedText, normalizedQuery) {
  if (!normalizedText || !normalizedQuery) return false;
  if (normalizedText.includes(normalizedQuery) || normalizedQuery.includes(normalizedText)) return true;

  const textTokens = splitTokens(normalizedText);
  const queryTokens = splitTokens(normalizedQuery);
  if (textTokens.length === 0 || queryTokens.length === 0) return false;

  return queryTokens.every((queryToken) =>
    textTokens.some((textToken) => {
      if (
        textToken === queryToken ||
        textToken.includes(queryToken) ||
        queryToken.includes(textToken)
      ) {
        return true;
      }
      return fuzzyTokenMatch(textToken, queryToken);
    })
  );
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function summarizeByPersona(rows) {
  const summary = {};
  for (const row of rows) {
    if (!summary[row.persona]) {
      summary[row.persona] = { total: 0, hits: 0, hit_rate: 0 };
    }
    summary[row.persona].total += 1;
    if (row.has_any) summary[row.persona].hits += 1;
  }

  for (const persona of Object.keys(summary)) {
    const entry = summary[persona];
    entry.hit_rate = entry.total > 0 ? Number((entry.hits / entry.total).toFixed(4)) : 0;
  }

  return summary;
}

async function fetchCanonicalMaps() {
  const [productsResult, servicesResult] = await Promise.all([
    runSupabaseQuery({
      sql: `
select
  p.id,
  lower(regexp_replace(btrim(p.normalized_name), '\\s+', ' ', 'g')) as normalized_name,
  coalesce(pa.aliases, '{}'::text[]) as aliases
from public.canonical_products p
left join lateral (
  select array_agg(distinct lower(regexp_replace(btrim(alias), '\\s+', ' ', 'g'))) as aliases
  from public.canonical_product_aliases a
  where a.canonical_product_id = p.id
    and coalesce(a.is_active, true) = true
) pa on true
where coalesce(p.is_active, true) = true;
`
    }),
    runSupabaseQuery({
      sql: `
select
  s.id,
  lower(regexp_replace(btrim(s.slug), '\\s+', ' ', 'g')) as slug,
  coalesce(sa.aliases, '{}'::text[]) as aliases
from public.canonical_services s
left join lateral (
  select array_agg(distinct lower(regexp_replace(btrim(alias), '\\s+', ' ', 'g'))) as aliases
  from public.canonical_service_aliases a
  where a.canonical_service_id = s.id
    and coalesce(a.is_active, true) = true
) sa on true
where coalesce(s.is_active, true) = true;
`
    })
  ]);

  const productRows = productsResult.parsed.rows ?? [];
  const serviceRows = servicesResult.parsed.rows ?? [];

  const productCandidates = productRows.map((row) => {
    const terms = new Set([stableNormalizeText(row.normalized_name)]);
    for (const alias of Array.isArray(row.aliases) ? row.aliases : []) {
      const normalized = stableNormalizeText(alias);
      if (normalized) terms.add(normalized);
    }
    return {
      id: Number(row.id),
      terms: Array.from(terms).filter(Boolean)
    };
  });

  const serviceCandidates = serviceRows.map((row) => {
    const terms = new Set([stableNormalizeText(row.slug)]);
    for (const alias of Array.isArray(row.aliases) ? row.aliases : []) {
      const normalized = stableNormalizeText(alias);
      if (normalized) terms.add(normalized);
    }
    return {
      id: Number(row.id),
      terms: Array.from(terms).filter(Boolean)
    };
  });

  return { productCandidates, serviceCandidates };
}

function resolveCanonicalIdsFromQuery(normalizedQuery, candidates) {
  const ids = new Set();
  for (const candidate of candidates) {
    for (const term of candidate.terms) {
      if (!term) continue;
      if (fuzzyContains(term, normalizedQuery) || fuzzyContains(normalizedQuery, term)) {
        ids.add(candidate.id);
        break;
      }
    }
  }
  return ids;
}

function buildBoundingBox({ lat, lng, radiusMeters }) {
  const radius = Math.max(250, radiusMeters);
  const latDelta = radius / 111320;
  const cosLat = Math.max(0.1, Math.abs(Math.cos((lat * Math.PI) / 180)));
  const lngDelta = radius / (111320 * cosLat);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

async function fetchNearbyProducts({ lat, lng, radiusMeters }) {
  const box = buildBoundingBox({ lat, lng, radiusMeters });
  const sql = `
select
  establishment_id,
  canonical_product_id,
  establishment_name,
  product_normalized_name,
  confidence,
  validation_status,
  source_type,
  lat,
  lon
from public.search_product_establishment_dataset
where lat between ${box.minLat} and ${box.maxLat}
  and lon between ${box.minLng} and ${box.maxLng};
`;

  const result = await runSupabaseQuery({ sql });
  return (result.parsed.rows ?? [])
    .map((row) => ({
      establishmentId: Number(row.establishment_id),
      canonicalProductId: Number(row.canonical_product_id),
      storeName: String(row.establishment_name ?? "").trim() || "Unknown store",
      productName: stableNormalizeText(row.product_normalized_name),
      confidence: parseNumeric(row.confidence) ?? 0,
      validationStatus: String(row.validation_status ?? ""),
      sourceType: String(row.source_type ?? ""),
      lat: parseNumeric(row.lat),
      lon: parseNumeric(row.lon)
    }))
    .filter((row) => row.lat !== null && row.lon !== null)
    .map((row) => ({
      ...row,
      distanceMeters: haversineMeters(lat, lng, row.lat, row.lon)
    }))
    .filter((row) => row.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 180);
}

async function fetchNearbyServices({ lat, lng, radiusMeters }) {
  const box = buildBoundingBox({ lat, lng, radiusMeters });
  const sql = `
select
  m.establishment_id,
  m.canonical_service_id,
  m.confidence,
  m.validation_status,
  m.primary_source_type,
  m.availability_status,
  e.name as establishment_name,
  e.lat,
  e.lon,
  s.slug,
  s.display_name_en,
  s.display_name_de,
  s.display_name_es
from public.establishment_service_merged m
join public.establishments e on e.id = m.establishment_id
join public.canonical_services s on s.id = m.canonical_service_id
where e.lat between ${box.minLat} and ${box.maxLat}
  and e.lon between ${box.minLng} and ${box.maxLng};
`;

  const result = await runSupabaseQuery({ sql });
  return (result.parsed.rows ?? [])
    .map((row) => ({
      establishmentId: Number(row.establishment_id),
      canonicalServiceId: Number(row.canonical_service_id),
      confidence: parseNumeric(row.confidence) ?? 0,
      validationStatus: String(row.validation_status ?? ""),
      sourceType: String(row.primary_source_type ?? ""),
      availabilityStatus: String(row.availability_status ?? ""),
      storeName: String(row.establishment_name ?? "").trim() || "Unknown store",
      slug: stableNormalizeText(row.slug),
      displayNameEn: stableNormalizeText(row.display_name_en),
      displayNameDe: stableNormalizeText(row.display_name_de),
      displayNameEs: stableNormalizeText(row.display_name_es),
      lat: parseNumeric(row.lat),
      lon: parseNumeric(row.lon)
    }))
    .filter((row) => row.lat !== null && row.lon !== null)
    .map((row) => ({
      ...row,
      distanceMeters: haversineMeters(lat, lng, row.lat, row.lon)
    }))
    .filter((row) => row.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 120);
}

function isTrusted(validationStatus, sourceType) {
  return (
    validationStatus === "validated" ||
    sourceType === "user_validated" ||
    sourceType === "merchant_added" ||
    sourceType === "website_extracted"
  );
}

function scoreProductMatch(row, normalizedQuery, canonicalIds) {
  const canonicalMatch = canonicalIds.has(row.canonicalProductId);
  const textMatch = fuzzyContains(row.productName, normalizedQuery);
  const trusted = isTrusted(row.validationStatus, row.sourceType);
  if (!canonicalMatch && !textMatch) return -1;

  let score = 0;
  if (canonicalMatch) score += 2;
  if (textMatch) score += 2;
  score += Math.min(1.2, row.confidence || 0);
  if (trusted) score += 1;
  score += Math.max(0, 1 - row.distanceMeters / 3000);
  return score;
}

function scoreServiceMatch(row, normalizedQuery, canonicalIds) {
  const canonicalMatch = canonicalIds.has(row.canonicalServiceId);
  const textMatch =
    fuzzyContains(row.slug, normalizedQuery) ||
    fuzzyContains(row.displayNameEn, normalizedQuery) ||
    fuzzyContains(row.displayNameDe, normalizedQuery) ||
    fuzzyContains(row.displayNameEs, normalizedQuery);

  if (!canonicalMatch && !textMatch) return -1;

  let score = 0;
  if (canonicalMatch) score += 2;
  if (textMatch) score += 2;
  score += Math.min(1.2, row.confidence || 0);
  if (isTrusted(row.validationStatus, row.sourceType)) score += 1;
  score += Math.max(0, 1 - row.distanceMeters / 3000);
  return score;
}

async function main() {
  const args = parseArgs(process.argv);
  const benchmarkFile = String(args.file ?? BENCHMARK_FILE_DEFAULT);
  const outputName = String(args.output ?? "r0-persona-benchmark-gated.json");
  const minHitRate = Number(args["min-hit-rate"] ?? 0.65);
  const minQueries = Number(args["min-queries"] ?? 20);
  const failOnBelowThreshold = parseBoolean(args["fail-on-below-threshold"], false);

  logInfo("Running persona benchmark suite", {
    benchmarkFile,
    outputName,
    minHitRate,
    minQueries,
    failOnBelowThreshold,
    checkpointFile: CHECKPOINT_FILE
  });

  const suite = await readJsonFile(benchmarkFile);
  const queries = Array.isArray(suite.queries) ? suite.queries : [];
  if (queries.length === 0) {
    throw new Error("Persona benchmark suite is empty.");
  }

  const defaultOrigin = suite.default_origin ?? {};
  const defaultLat = parseNumeric(defaultOrigin.lat) ?? 52.5316;
  const defaultLng = parseNumeric(defaultOrigin.lng) ?? 13.342;
  const defaultRadius = parseNumeric(defaultOrigin.radius_meters) ?? 2500;

  const { productCandidates, serviceCandidates } = await fetchCanonicalMaps();

  const rows = [];
  let totalHits = 0;

  for (const entry of queries) {
    const persona = String(entry.persona ?? "Unknown").trim() || "Unknown";
    const query = String(entry.query ?? "").trim();
    if (!query) continue;

    const intent = String(entry.intent ?? "product").toLowerCase();
    const lat = parseNumeric(entry.lat) ?? defaultLat;
    const lng = parseNumeric(entry.lng) ?? defaultLng;
    const radiusMeters = parseNumeric(entry.radius_meters) ?? defaultRadius;

    const normalizedQuery = stableNormalizeText(query);
    const productIds = resolveCanonicalIdsFromQuery(normalizedQuery, productCandidates);
    const serviceIds = resolveCanonicalIdsFromQuery(normalizedQuery, serviceCandidates);

    // eslint-disable-next-line no-await-in-loop
    const nearbyProducts = await fetchNearbyProducts({ lat, lng, radiusMeters });
    // eslint-disable-next-line no-await-in-loop
    const nearbyServices = await fetchNearbyServices({ lat, lng, radiusMeters });

    let productHits = [];
    let serviceHits = [];

    if (intent !== "service") {
      productHits = nearbyProducts
        .map((row) => ({ row, score: scoreProductMatch(row, normalizedQuery, productIds) }))
        .filter((entry2) => entry2.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
    }

    if (intent !== "product") {
      serviceHits = nearbyServices
        .map((row) => ({ row, score: scoreServiceMatch(row, normalizedQuery, serviceIds) }))
        .filter((entry2) => entry2.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
    }

    const hasAny = productHits.length > 0 || serviceHits.length > 0;
    if (hasAny) totalHits += 1;

    const topProduct = productHits[0]?.row;
    const topService = serviceHits[0]?.row;

    rows.push({
      persona,
      query,
      intent,
      radius_meters: radiusMeters,
      product_hits: productHits.length,
      service_hits: serviceHits.length,
      has_any: hasAny,
      top_store:
        topProduct?.storeName ?? topService?.storeName ?? null,
      top_item:
        topProduct?.productName ?? topService?.slug ?? null,
      distance_meters:
        parseNumeric(topProduct?.distanceMeters ?? topService?.distanceMeters) ?? null
    });
  }

  const totalQueries = rows.length;
  const hitRate = totalQueries > 0 ? Number((totalHits / totalQueries).toFixed(4)) : 0;
  const byPersona = summarizeByPersona(rows);
  const report = {
    generated_at: new Date().toISOString(),
    suite_version: suite.version ?? "unknown",
    summary: {
      total_queries: totalQueries,
      total_hits: totalHits,
      hit_rate: hitRate,
      min_hit_rate_target: minHitRate,
      by_persona: byPersona
    },
    rows
  };

  const outputPath = path.join(REPORTS_DIR, outputName);
  await writeJsonFile(outputPath, report);

  const checkpoint = await loadCheckpoint();
  checkpoint.personaBenchmark = {
    outputPath,
    totalQueries,
    totalHits,
    hitRate,
    minHitRate,
    pass: totalQueries >= minQueries && hitRate >= minHitRate,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Persona benchmark completed", checkpoint.personaBenchmark);

  if (totalQueries < minQueries) {
    const message = `Persona benchmark has too few queries (${totalQueries} < ${minQueries}).`;
    if (failOnBelowThreshold) {
      throw new Error(message);
    }
    logWarn(message);
    return;
  }

  if (hitRate < minHitRate) {
    const message = `Persona benchmark below target (${hitRate} < ${minHitRate}).`;
    if (failOnBelowThreshold) {
      throw new Error(message);
    }
    logWarn(message);
  }
}

main().catch((error) => {
  logWarn("Persona benchmark failed", String(error));
  process.exit(1);
});
