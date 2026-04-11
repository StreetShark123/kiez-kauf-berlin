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

function buildMergeSql(establishmentIds) {
  const idsLiteral = `array[${establishmentIds.map((id) => Number(id)).join(",")}]::bigint[]`;

  return `
with source_priority(source_type, weight) as (
  values
    ('user_validated'::source_type_enum, 50),
    ('merchant_added'::source_type_enum, 40),
    ('imported'::source_type_enum, 30),
    ('ai_generated'::source_type_enum, 20),
    ('rules_generated'::source_type_enum, 10)
), base as (
  select
    c.id,
    c.establishment_id,
    c.canonical_product_id,
    c.source_type,
    c.generation_method,
    c.confidence,
    c.validation_status,
    c.why_this_product_matches,
    c.category_path,
    c.inferred_from,
    sp.weight
  from establishment_product_candidates c
  join source_priority sp on sp.source_type = c.source_type
  where c.establishment_id = any(${idsLiteral})
), ranked as (
  select
    b.*,
    row_number() over (
      partition by b.establishment_id, b.canonical_product_id
      order by b.confidence desc nulls last, b.id asc
    ) as rn
  from base b
), aggregated as (
  select
    establishment_id,
    canonical_product_id,
    (array_agg(source_type order by weight desc, confidence desc, id asc))[1] as primary_source_type,
    array_agg(distinct source_type) as merged_sources,
    array_agg(distinct generation_method) as merged_generation_methods,
    array_agg(id order by confidence desc, id asc) as merged_candidate_ids,
    least(
      0.99,
      max(confidence) +
      case
        when bool_or(validation_status = 'validated') then 0.03
        when bool_or(validation_status = 'likely') then 0.01
        else 0
      end
    )::numeric(5,4) as confidence,
    case
      when bool_or(validation_status = 'validated') then 'validated'::validation_status_enum
      when bool_or(validation_status = 'likely') then 'likely'::validation_status_enum
      when bool_or(validation_status = 'unvalidated') then 'unvalidated'::validation_status_enum
      when bool_or(validation_status = 'rejected') then 'rejected'::validation_status_enum
      else 'unvalidated'::validation_status_enum
    end as validation_status,
    jsonb_build_object(
      'merged_candidate_count', count(*),
      'has_validated', bool_or(validation_status = 'validated'),
      'has_likely', bool_or(validation_status = 'likely'),
      'has_unvalidated', bool_or(validation_status = 'unvalidated'),
      'has_rejected', bool_or(validation_status = 'rejected')
    ) as inferred_from
  from base
  group by establishment_id, canonical_product_id
), final_rows as (
  select
    a.establishment_id,
    a.canonical_product_id,
    a.primary_source_type,
    a.merged_sources,
    a.merged_generation_methods,
    a.merged_candidate_ids,
    a.confidence,
    a.validation_status,
    r.why_this_product_matches,
    r.category_path,
    a.inferred_from
  from aggregated a
  join ranked r
    on r.establishment_id = a.establishment_id
   and r.canonical_product_id = a.canonical_product_id
   and r.rn = 1
), upserted as (
  insert into establishment_product_merged (
    establishment_id,
    canonical_product_id,
    primary_source_type,
    merged_sources,
    merged_generation_methods,
    merged_candidate_ids,
    confidence,
    validation_status,
    why_this_product_matches,
    category_path,
    inferred_from
  )
  select
    establishment_id,
    canonical_product_id,
    primary_source_type,
    merged_sources,
    merged_generation_methods,
    merged_candidate_ids,
    confidence,
    validation_status,
    why_this_product_matches,
    category_path,
    inferred_from
  from final_rows
  on conflict (establishment_id, canonical_product_id)
  do update set
    primary_source_type = excluded.primary_source_type,
    merged_sources = excluded.merged_sources,
    merged_generation_methods = excluded.merged_generation_methods,
    merged_candidate_ids = excluded.merged_candidate_ids,
    confidence = excluded.confidence,
    validation_status = excluded.validation_status,
    why_this_product_matches = excluded.why_this_product_matches,
    category_path = excluded.category_path,
    inferred_from = excluded.inferred_from,
    updated_at = now()
  where not (
    establishment_product_merged.validation_status = 'validated'
    and excluded.validation_status <> 'validated'
  )
  returning id
)
select count(*)::int as merged_rows from upserted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 500);
  const resume = Boolean(args.resume);

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.mergeCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;
  let totalEstablishments = 0;
  let totalMergedRows = 0;

  logInfo("Phase 7 (part A) - merge candidates", {
    batchSize,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ids = await fetchBatch(cursor, batchSize);
    if (!ids.length) {
      break;
    }

    const sql = buildMergeSql(ids);
    const result = await runSupabaseQuery({ sql, output: "json" });
    const mergedRows = Number(result.parsed.rows?.[0]?.merged_rows ?? 0);

    totalEstablishments += ids.length;
    totalMergedRows += mergedRows;
    cursor = ids[ids.length - 1];

    checkpoint.mergeCandidates = {
      lastId: cursor,
      totalEstablishments,
      totalMergedRows,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Merged candidate batch", {
      establishments: ids.length,
      mergedRows,
      cursor,
      cumulativeMergedRows: totalMergedRows
    });
  }

  checkpoint.mergeCandidates = {
    lastId: cursor,
    totalEstablishments,
    totalMergedRows,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 7 (part A) completed", {
    totalEstablishments,
    totalMergedRows
  });
}

main().catch((error) => {
  logWarn("Candidate merge failed", String(error));
  process.exit(1);
});
