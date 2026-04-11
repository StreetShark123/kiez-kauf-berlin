import {
  CHECKPOINT_FILE,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlLiteral
} from "./_utils.mjs";

const CATEGORY_GROUP_RULES = [
  ["grocery", "groceries", 0.82, "grocery stores usually stock pantry essentials"],
  ["grocery", "beverages", 0.79, "grocery stores typically include beverage aisles"],
  ["grocery", "fresh_produce", 0.76, "grocery stores often include produce"],
  ["grocery", "household", 0.71, "grocery stores often carry household basics"],
  ["convenience", "beverages", 0.8, "convenience stores focus on ready-to-buy drinks"],
  ["convenience", "snacks", 0.78, "convenience stores are snack-heavy"],
  ["convenience", "groceries", 0.65, "convenience stores carry a compact grocery set"],
  ["fresh-food", "fresh_produce", 0.84, "fresh food stores strongly map to produce"],
  ["fresh-food", "groceries", 0.69, "fresh food stores may carry pantry complement products"],
  ["bakery", "bakery", 0.9, "bakery category directly maps to bakery items"],
  ["bakery", "beverages", 0.63, "bakeries often sell coffee and drinks"],
  ["butcher", "meat", 0.92, "butcher category directly maps to meat products"],
  ["butcher", "groceries", 0.57, "butchers may carry supporting groceries"],
  ["produce", "fresh_produce", 0.91, "produce category maps to fruits and vegetables"],
  ["drinks", "beverages", 0.92, "drink stores map to beverage products"],
  ["pharmacy", "pharmacy", 0.93, "pharmacies map to medicine products"],
  ["pharmacy", "personal_care", 0.82, "pharmacies stock personal care products"],
  ["personal-care", "personal_care", 0.86, "personal care category maps directly"],
  ["household", "household", 0.88, "household category maps directly"],
  ["bio", "groceries", 0.74, "organic stores stock core groceries"],
  ["bio", "fresh_produce", 0.77, "organic stores stock produce"],
  ["bio", "beverages", 0.7, "organic stores stock beverages"]
];

function buildRulesSql(establishmentIds, generationMethod) {
  const idsLiteral = `array[${establishmentIds.map((id) => Number(id)).join(",")}]::bigint[]`;
  const ruleValues = CATEGORY_GROUP_RULES.map((rule) => {
    return `(${rule.map((value) => sqlLiteral(value)).join(",")})`;
  }).join(",\n");

  return `
with target_establishments as (
  select id, osm_category, app_categories
  from establishments
  where id = any(${idsLiteral})
    and active_status = 'active'
),
category_map(app_category, product_group, base_confidence, reason) as (
  values
  ${ruleValues}
),
expanded as (
  select
    e.id as establishment_id,
    e.osm_category,
    unnest(e.app_categories) as app_category
  from target_establishments e
),
scored as (
  select
    ex.establishment_id,
    p.id as canonical_product_id,
    ex.app_category,
    cm.product_group,
    least(
      0.99,
      cm.base_confidence +
      case when ex.osm_category in ('supermarket', 'pharmacy') then 0.04 else 0 end
    )::numeric(5,4) as confidence,
    cm.reason
  from expanded ex
  join category_map cm on cm.app_category = ex.app_category
  join canonical_products p on p.product_group = cm.product_group
),
dedup as (
  select distinct on (establishment_id, canonical_product_id)
    establishment_id,
    canonical_product_id,
    app_category,
    product_group,
    confidence,
    reason
  from scored
  order by establishment_id, canonical_product_id, confidence desc
),
upserted as (
  insert into establishment_product_candidates (
    establishment_id,
    canonical_product_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    validation_notes,
    why_this_product_matches,
    category_path,
    inferred_from
  )
  select
    d.establishment_id,
    d.canonical_product_id,
    'rules_generated'::source_type_enum,
    ${sqlLiteral(generationMethod)},
    d.confidence,
    case when d.confidence >= 0.74 then 'likely'::validation_status_enum else 'unvalidated'::validation_status_enum end,
    null,
    ('Rule mapped app category "' || d.app_category || '" to product group "' || d.product_group || '".')::text,
    array['rules', d.app_category, d.product_group]::text[],
    jsonb_build_object(
      'engine', 'rule_engine_v2',
      'rule_reason', d.reason,
      'app_category', d.app_category,
      'product_group', d.product_group
    )
  from dedup d
  on conflict (establishment_id, canonical_product_id, source_type, generation_method)
  do update set
    confidence = excluded.confidence,
    validation_status = excluded.validation_status,
    validation_notes = excluded.validation_notes,
    why_this_product_matches = excluded.why_this_product_matches,
    category_path = excluded.category_path,
    inferred_from = excluded.inferred_from,
    updated_at = now()
  where establishment_product_candidates.validation_status not in ('validated', 'rejected')
  returning id
)
select count(*)::int as affected_rows from upserted;
`;
}

async function fetchBatch(lastId, batchSize) {
  const sql = `
select id
from establishments
where external_source = 'osm-overpass'
  and id > ${Number(lastId)}
order by id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => Number(row.id));
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 350);
  const resume = Boolean(args.resume);
  const generationMethod = String(args["generation-method"] ?? "rule_engine_v2_berlin");

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.generateRuleCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;
  let totalAffected = 0;
  let totalEstablishments = 0;

  logInfo("Phase 5 - generate rule candidates", {
    batchSize,
    generationMethod,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ids = await fetchBatch(cursor, batchSize);
    if (!ids.length) {
      break;
    }

    const sql = buildRulesSql(ids, generationMethod);
    const result = await runSupabaseQuery({ sql, output: "json" });
    const affectedRows = Number(result.parsed.rows?.[0]?.affected_rows ?? 0);

    totalAffected += affectedRows;
    totalEstablishments += ids.length;
    cursor = ids[ids.length - 1];

    checkpoint.generateRuleCandidates = {
      lastId: cursor,
      generationMethod,
      totalEstablishments,
      totalAffected,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Generated rule candidate batch", {
      establishments: ids.length,
      affectedRows,
      cursor,
      cumulativeAffected: totalAffected
    });
  }

  checkpoint.generateRuleCandidates = {
    lastId: cursor,
    generationMethod,
    totalEstablishments,
    totalAffected,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 5 completed", {
    totalEstablishments,
    totalAffected
  });
}

main().catch((error) => {
  logWarn("Rule candidate generation failed", String(error));
  process.exit(1);
});
