import path from "node:path";
import {
  CHECKPOINT_FILE,
  PROJECT_ROOT,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  stableNormalizeText,
  writeJsonFile
} from "./_utils.mjs";

const OUTPUT_DIR = path.join(PROJECT_ROOT, "data", "berlin", "reports");

const KEYWORD_GROUP_HINTS = {
  pharmacy: ["condom", "tampon", "ibuprofen", "painkiller", "pregnancy", "allergy", "cough"],
  household: ["detergent", "clean", "bleach", "sponge", "trash bag", "foil", "paper towel"],
  groceries: ["milk", "egg", "rice", "pasta", "oil", "flour", "bread", "apricot", "vegetable"],
  beverages: ["beer", "water", "wine", "guinness", "juice", "soda"],
  personal_care: ["shampoo", "deodorant", "soap", "toothpaste", "diaper", "baby wipe"],
  pet_care: ["cat", "dog", "pet food", "litter"],
  snacks: ["chocolate", "chips", "snack", "cookies", "sweet"],
  stationery: ["pencil", "marker", "notebook", "paper", "glue", "eraser"],
  hardware: ["hammer", "pliers", "screw", "screwdriver", "light bulb", "fuse", "tape"],
  services: ["repair", "copy", "tailor", "key", "locksmith", "pedicure", "manicure", "bike repair"]
};

function inferGroupHint(normalizedQuery) {
  for (const [group, hints] of Object.entries(KEYWORD_GROUP_HINTS)) {
    if (hints.some((hint) => normalizedQuery.includes(stableNormalizeText(hint)))) {
      return group;
    }
  }
  return "unknown";
}

async function fetchCanonicalSearchTerms() {
  const sql = `
select
  id,
  canonical_type,
  canonical_term,
  aliases,
  priority,
  canonical_product_id,
  canonical_service_id
from public.canonical_search_terms
where coalesce(is_active, true) = true;
`;
  const result = await runSupabaseQuery({ sql });
  return result.parsed.rows ?? [];
}

function queryMatchesTerm(query, term, aliases) {
  const normalizedQuery = stableNormalizeText(query);
  const normalizedTerm = stableNormalizeText(term);
  if (!normalizedQuery || !normalizedTerm) return false;

  if (
    normalizedQuery === normalizedTerm ||
    normalizedQuery.includes(normalizedTerm) ||
    normalizedTerm.includes(normalizedQuery)
  ) {
    return true;
  }

  const normalizedAliases = Array.isArray(aliases) ? aliases.map((alias) => stableNormalizeText(alias)) : [];
  return normalizedAliases.some((alias) => {
    if (!alias) return false;
    return (
      normalizedQuery === alias ||
      normalizedQuery.includes(alias) ||
      alias.includes(normalizedQuery)
    );
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const windowDays = Number(args["window-days"] ?? 21);
  const limit = Number(args.limit ?? 150);
  const districtScope = String(args["district-scope"] ?? "").trim();
  const unresolvedOnly = String(args["unresolved-only"] ?? "true").toLowerCase() !== "false";

  logInfo("Building zero-result demand report", {
    windowDays,
    limit,
    districtScope: districtScope || null,
    unresolvedOnly,
    checkpointFile: CHECKPOINT_FILE
  });

  const whereClauses = [
    `created_at >= now() - (${windowDays}::int * interval '1 day')`,
    `coalesce(result_count, 0) <= 0`
  ];

  if (districtScope) {
    whereClauses.push(`lower(coalesce(district, '')) = lower('${districtScope.replace(/'/g, "''")}')`);
  }

  if (unresolvedOnly) {
    whereClauses.push(`resolved = false`);
  }

  const sql = `
with base as (
  select
    normalized_query,
    max(query) as sample_query,
    count(*)::int as failures,
    count(distinct date_trunc('day', created_at))::int as active_days,
    max(created_at) as last_seen_at,
    min(created_at) as first_seen_at,
    max(district) filter (where district is not null) as district
  from public.failed_searches
  where ${whereClauses.join("\n    and ")}
  group by normalized_query
)
select *
from base
order by failures desc, active_days desc, last_seen_at desc
limit ${limit};
`;

  const [demandResult, terms] = await Promise.all([
    runSupabaseQuery({ sql }),
    fetchCanonicalSearchTerms()
  ]);

  const termRows = terms.map((term) => ({
    id: Number(term.id),
    canonicalType: String(term.canonical_type ?? ""),
    canonicalTerm: String(term.canonical_term ?? ""),
    aliases: Array.isArray(term.aliases) ? term.aliases : [],
    priority: Number(term.priority ?? 0),
    canonicalProductId: term.canonical_product_id ? Number(term.canonical_product_id) : null,
    canonicalServiceId: term.canonical_service_id ? Number(term.canonical_service_id) : null
  }));

  const rows = (demandResult.parsed.rows ?? []).map((row) => {
    const normalizedQuery = stableNormalizeText(row.normalized_query ?? row.sample_query ?? "");
    const matchingTerms = termRows
      .filter((term) => queryMatchesTerm(normalizedQuery, term.canonicalTerm, term.aliases))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);

    return {
      normalized_query: normalizedQuery,
      sample_query: String(row.sample_query ?? "").trim(),
      failures: Number(row.failures ?? 0),
      active_days: Number(row.active_days ?? 0),
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      district: row.district,
      mapped_to_existing_term: matchingTerms.length > 0,
      mapped_terms: matchingTerms.map((term) => ({
        canonical_type: term.canonicalType,
        canonical_term: term.canonicalTerm,
        canonical_product_id: term.canonicalProductId,
        canonical_service_id: term.canonicalServiceId,
        priority: term.priority
      })),
      suggested_group_hint: inferGroupHint(normalizedQuery)
    };
  });

  const unmapped = rows.filter((row) => !row.mapped_to_existing_term);
  const report = {
    generated_at: new Date().toISOString(),
    scope: {
      window_days: windowDays,
      district_scope: districtScope || null,
      unresolved_only: unresolvedOnly,
      limit
    },
    summary: {
      total_failed_queries: rows.length,
      mapped_to_existing_terms: rows.length - unmapped.length,
      unmapped_queries: unmapped.length,
      top_unmapped_by_failures: unmapped.slice(0, 20)
    },
    rows
  };

  const outputName = `zero-results-demand-${new Date().toISOString().slice(0, 10)}.json`;
  const outputPath = path.join(OUTPUT_DIR, outputName);
  await writeJsonFile(outputPath, report);

  const checkpoint = await loadCheckpoint();
  checkpoint.zeroResultsDemand = {
    windowDays,
    districtScope: districtScope || null,
    totalFailedQueries: rows.length,
    unmappedQueries: unmapped.length,
    outputPath,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Zero-results demand report generated", checkpoint.zeroResultsDemand);
}

main().catch((error) => {
  logWarn("Zero-results demand report failed", String(error));
  process.exit(1);
});
