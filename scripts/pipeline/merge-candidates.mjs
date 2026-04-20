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

function buildMergeSql(establishmentIds, maxProductsPerEstablishment) {
  const idsLiteral = `array[${establishmentIds.map((id) => Number(id)).join(",")}]::bigint[]`;

  return `
with source_priority(source_type, weight) as (
  values
    ('validated'::source_type_enum, 60),
    ('user_validated'::source_type_enum, 50),
    ('merchant_added'::source_type_enum, 40),
    ('website_extracted'::source_type_enum, 35),
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
    c.source_url,
    c.extraction_method,
    c.last_checked_at,
    c.freshness_score,
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
    max(last_checked_at) as last_checked_at,
    max(freshness_score) as freshness_score,
    (array_agg(source_url order by weight desc, confidence desc, id asc))[1] as source_url,
    (array_agg(extraction_method order by weight desc, confidence desc, id asc))[1] as extraction_method,
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
    a.inferred_from,
    a.source_url,
    a.extraction_method,
    a.last_checked_at,
    a.freshness_score
  from aggregated a
  join ranked r
    on r.establishment_id = a.establishment_id
   and r.canonical_product_id = a.canonical_product_id
   and r.rn = 1
), trimmed as (
  select
    f.*,
    row_number() over (
      partition by f.establishment_id
      order by
        case f.validation_status
          when 'validated' then 3
          when 'likely' then 2
          when 'unvalidated' then 1
          else 0
        end desc,
        f.confidence desc,
        case f.primary_source_type
          when 'validated' then 7
          when 'user_validated' then 6
          when 'merchant_added' then 5
          when 'website_extracted' then 4
          when 'imported' then 3
          when 'ai_generated' then 2
          else 1
        end desc,
        f.canonical_product_id asc
    ) as store_rank
  from final_rows f
), deleted as (
  delete from establishment_product_merged m
  where m.establishment_id = any(${idsLiteral})
    and m.validation_status <> 'validated'
    and not exists (
      select 1
      from trimmed t
      where t.store_rank <= ${Number(maxProductsPerEstablishment)}
        and t.establishment_id = m.establishment_id
        and t.canonical_product_id = m.canonical_product_id
    )
  returning id
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
    inferred_from,
    source_url,
    extraction_method,
    last_checked_at,
    freshness_score
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
    inferred_from,
    source_url,
    extraction_method,
    last_checked_at,
    freshness_score
  from trimmed
  where store_rank <= ${Number(maxProductsPerEstablishment)}
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
    source_url = excluded.source_url,
    extraction_method = excluded.extraction_method,
    last_checked_at = excluded.last_checked_at,
    freshness_score = excluded.freshness_score,
    updated_at = now()
  where not (
    establishment_product_merged.validation_status = 'validated'
    and excluded.validation_status <> 'validated'
  )
    and (
      establishment_product_merged.primary_source_type is distinct from excluded.primary_source_type
      or establishment_product_merged.merged_sources is distinct from excluded.merged_sources
      or establishment_product_merged.merged_generation_methods is distinct from excluded.merged_generation_methods
      or establishment_product_merged.merged_candidate_ids is distinct from excluded.merged_candidate_ids
      or establishment_product_merged.confidence is distinct from excluded.confidence
      or establishment_product_merged.validation_status is distinct from excluded.validation_status
      or establishment_product_merged.why_this_product_matches is distinct from excluded.why_this_product_matches
      or establishment_product_merged.category_path is distinct from excluded.category_path
      or establishment_product_merged.inferred_from is distinct from excluded.inferred_from
      or establishment_product_merged.source_url is distinct from excluded.source_url
      or establishment_product_merged.extraction_method is distinct from excluded.extraction_method
      or establishment_product_merged.last_checked_at is distinct from excluded.last_checked_at
      or establishment_product_merged.freshness_score is distinct from excluded.freshness_score
  )
  returning id
)
select
  (select count(*)::int from upserted) as merged_rows,
  (select count(*)::int from deleted) as deleted_rows;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 500);
  const maxProductsPerEstablishment = Number(args["max-products-per-establishment"] ?? 12);
  const resume = Boolean(args.resume);

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.mergeCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;
  let totalEstablishments = 0;
  let totalMergedRows = 0;

  logInfo("Phase 7 (part A) - merge candidates", {
    batchSize,
    maxProductsPerEstablishment,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ids = await fetchBatch(cursor, batchSize);
    if (!ids.length) {
      break;
    }

    const sql = buildMergeSql(ids, maxProductsPerEstablishment);
    const result = await runSupabaseQuery({ sql, output: "json" });
    const mergedRows = Number(result.parsed.rows?.[0]?.merged_rows ?? 0);
    const deletedRows = Number(result.parsed.rows?.[0]?.deleted_rows ?? 0);

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
      deletedRows,
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
