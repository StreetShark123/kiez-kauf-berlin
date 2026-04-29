-- Capabilities-lite view for runtime/search quality controls.
-- Lean and additive: no payload snapshots, only compact serving signals.

create or replace view public.store_capabilities_lite_v1
with (security_invoker = true)
as
with best_profile as (
  select distinct on (p.establishment_id)
    p.establishment_id,
    coalesce(p.business_roles, '{}'::text[]) as business_roles,
    coalesce(p.likely_products, '{}'::text[]) as likely_products,
    coalesce(p.likely_services, '{}'::text[]) as likely_services,
    p.confidence,
    p.validation_status,
    p.source_type,
    p.updated_at
  from public.store_capability_profiles p
  where p.profile_version = 'v1'
  order by
    p.establishment_id,
    case p.validation_status
      when 'validated' then 4
      when 'likely' then 3
      when 'unvalidated' then 2
      when 'rejected' then 1
      else 0
    end desc,
    p.confidence desc,
    p.updated_at desc
)
select
  e.id as establishment_id,
  e.name,
  e.district,
  e.store_role_primary,
  e.store_roles,
  e.is_relevant_for_kiezkauf,
  e.manual_review_status,
  coalesce(bp.business_roles, '{}'::text[]) as profile_roles,
  coalesce(bp.likely_products, '{}'::text[]) as likely_products,
  coalesce(bp.likely_services, '{}'::text[]) as likely_services,
  bp.confidence as profile_confidence,
  bp.validation_status as profile_validation_status,
  bp.source_type as profile_source_type,
  (
    coalesce(e.store_role_primary, 'unclear') in ('sells_physical_products', 'food_grocery', 'specialist_retail', 'health_care')
    or coalesce(e.store_roles, '{}'::text[]) && array['sells_physical_products', 'food_grocery', 'specialist_retail', 'health_care']::text[]
    or coalesce(bp.business_roles, '{}'::text[]) && array['sells_physical_products', 'food_grocery', 'specialist_retail', 'health_care']::text[]
  ) as supports_products,
  (
    coalesce(e.store_role_primary, 'unclear') in ('sells_services', 'repair_service', 'beauty_personal_care', 'health_care')
    or coalesce(e.store_roles, '{}'::text[]) && array['sells_services', 'repair_service', 'beauty_personal_care', 'health_care']::text[]
    or coalesce(bp.business_roles, '{}'::text[]) && array['sells_services', 'repair_service', 'beauty_personal_care', 'health_care']::text[]
  ) as supports_services,
  (
    coalesce(e.store_role_primary, 'unclear') = 'repair_service'
    or coalesce(e.store_roles, '{}'::text[]) && array['repair_service']::text[]
    or coalesce(bp.business_roles, '{}'::text[]) && array['repair_service']::text[]
    or exists (
      select 1
      from unnest(coalesce(bp.likely_services, '{}'::text[])) as s(term)
      where term ilike '%repair%'
         or term ilike '%reparatur%'
         or term ilike '%fix%'
    )
  ) as supports_repair,
  greatest(e.updated_at, coalesce(bp.updated_at, e.updated_at)) as updated_at
from public.establishments e
left join best_profile bp on bp.establishment_id = e.id;

grant select on public.store_capabilities_lite_v1 to anon, authenticated;

comment on view public.store_capabilities_lite_v1 is
  'Lean runtime capabilities by establishment. Derived from establishments + best v1 profile.';
