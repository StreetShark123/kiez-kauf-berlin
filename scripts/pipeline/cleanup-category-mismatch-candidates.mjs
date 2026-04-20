import { logInfo, logWarn, runSupabaseQuery } from "./_utils.mjs";

const SQL = `
with target_art_household_candidates as (
  select c.id
  from establishment_product_candidates c
  join establishments e on e.id = c.establishment_id
  join canonical_products p on p.id = c.canonical_product_id
  where c.source_type in ('rules_generated', 'ai_generated')
    and c.validation_status not in ('validated', 'rejected')
    and coalesce(p.group_key, p.product_group) = 'household'
    and (
      e.osm_category in ('art', 'antiques', 'craft', 'stationery')
      or c.category_path && array['art', 'antiques']::text[]
      or coalesce(c.inferred_from ->> 'app_category', '') in ('art', 'antiques')
      or coalesce(c.why_this_product_matches, '') ilike '%app category "art"%'
      or coalesce(c.why_this_product_matches, '') ilike '%app category "antiques"%'
    )
),
target_service_beauty_candidates as (
  select c.id
  from establishment_product_candidates c
  join establishments e on e.id = c.establishment_id
  join canonical_products p on p.id = c.canonical_product_id
  where c.source_type in ('rules_generated', 'ai_generated')
    and c.validation_status not in ('validated', 'rejected')
    and e.osm_category in ('beauty', 'cosmetics', 'perfumery')
    and coalesce(p.group_key, p.product_group) in ('personal_care', 'pharmacy', 'household', 'groceries')
),
target_candidates as (
  select id from target_art_household_candidates
  union
  select id from target_service_beauty_candidates
),
updated as (
  update establishment_product_candidates c
  set
    validation_status = 'rejected'::validation_status_enum,
    validation_notes = coalesce(
      c.validation_notes,
      'Auto-rejected: category/product mismatch for low-trust generated mapping.'
    ),
    inferred_from = coalesce(c.inferred_from, '{}'::jsonb) || jsonb_build_object(
      'cleanup_rule', 'category_mismatch_v2',
      'cleaned_at', now()
    ),
    updated_at = now()
  where c.id in (select id from target_candidates)
  returning c.id, c.establishment_id
)
select
  count(*)::int as rejected_candidates,
  coalesce(count(distinct establishment_id), 0)::int as affected_establishments
from updated;
`;

async function main() {
  const result = await runSupabaseQuery({ sql: SQL, output: "json" });
  const rejectedCandidates = Number(result.parsed.rows?.[0]?.rejected_candidates ?? 0);
  const affectedEstablishments = Number(result.parsed.rows?.[0]?.affected_establishments ?? 0);

  logInfo("Category mismatch cleanup completed", {
    rejectedCandidates,
    affectedEstablishments
  });
}

main().catch((error) => {
  logWarn("Category mismatch cleanup failed", String(error));
  process.exit(1);
});
