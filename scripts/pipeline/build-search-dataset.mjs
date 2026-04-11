import { logInfo, logWarn, runSupabaseQuery } from "./_utils.mjs";

async function main() {
  logInfo("Phase 7 (part B) - refresh search dataset materialization");

  await runSupabaseQuery({
    sql: "select refresh_search_product_establishment_mv();",
    output: "json"
  });

  const statsResult = await runSupabaseQuery({
    sql: `
select
  (select count(*)::int from establishments where external_source = 'osm-overpass') as establishments_total,
  (select count(*)::int from canonical_products) as canonical_products_total,
  (select count(*)::int from establishment_product_candidates) as candidate_rows_total,
  (select count(*)::int from establishment_product_merged) as merged_rows_total,
  (select count(*)::int from search_product_establishment_mv) as search_rows_total;
`,
    output: "json"
  });

  const stats = statsResult.parsed.rows?.[0] ?? {};
  logInfo("Search dataset refreshed", stats);
}

main().catch((error) => {
  logWarn("Build search dataset failed", String(error));
  process.exit(1);
});
