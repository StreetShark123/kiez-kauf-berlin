-- Presence model v1
-- Product types and category priors live in git (data/presence/*.json); the database only stores
-- what cannot live in git: observations from people (evidence) and the store universe.

-- 1) Store universe for the presence engine, with the OSM tags it needs (brand, organic, halal...).
create or replace view public.presence_establishments
with (security_invoker = true) as
select
  e.id,
  e.external_id,
  e.name,
  e.address,
  e.district,
  e.lat,
  e.lon,
  e.osm_category,
  e.app_categories,
  e.website,
  e.phone,
  e.opening_hours,
  nullif(btrim(s.raw_tags ->> 'brand'), '') as brand,
  coalesce(
    jsonb_strip_nulls(
      jsonb_build_object(
        'brand', s.raw_tags ->> 'brand',
        'organic', s.raw_tags ->> 'organic',
        'diet:halal', s.raw_tags ->> 'diet:halal',
        'bulk_purchase', s.raw_tags ->> 'bulk_purchase',
        'zero_waste', s.raw_tags ->> 'zero_waste',
        'second_hand', s.raw_tags ->> 'second_hand'
      )
    ),
    '{}'::jsonb
  ) as presence_tags
from public.establishments e
left join public.berlin_establishment_stage s
  on s.external_source = e.external_source
 and s.external_id = e.external_id
where e.active_status = 'active';

revoke all on public.presence_establishments from anon, authenticated;
grant select on public.presence_establishments to service_role;

-- 2) Evidence: one row per observation "store X has (+1) / does not have (-1) product type T".
create table if not exists public.presence_evidence (
  id bigserial primary key,
  establishment_id bigint not null references public.establishments(id) on delete cascade,
  product_type_id text not null check (product_type_id ~ '^[a-z0-9_]{2,64}$'),
  signal smallint not null check (signal in (-1, 1)),
  source text not null default 'user' check (source in ('user', 'merchant', 'admin', 'website', 'import')),
  weight numeric(5,3) check (weight is null or (weight >= 0 and weight <= 10)),
  -- salted hash of an anonymous device cookie; never a raw identifier
  device_hash text check (device_hash is null or length(device_hash) between 16 and 128),
  interaction_id uuid,
  query text check (query is null or length(query) <= 200),
  is_flagged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_presence_evidence_type_created
  on public.presence_evidence (product_type_id, created_at desc)
  where is_flagged = false;
create index if not exists idx_presence_evidence_store
  on public.presence_evidence (establishment_id, product_type_id);
create index if not exists idx_presence_evidence_device_created
  on public.presence_evidence (device_hash, created_at desc)
  where device_hash is not null;

-- Writes go exclusively through the Next.js API (service role), which enforces rate limits.
alter table public.presence_evidence enable row level security;
revoke all on public.presence_evidence from anon, authenticated;
grant select, insert, update, delete on public.presence_evidence to service_role;
grant usage, select on sequence public.presence_evidence_id_seq to service_role;

-- 3) Admin/analytics helper: aggregated, undecayed view of the evidence per store and type.
create or replace view public.presence_evidence_summary
with (security_invoker = true) as
select
  establishment_id,
  product_type_id,
  count(*) filter (where signal = 1) as positive_count,
  count(*) filter (where signal = -1) as negative_count,
  count(distinct device_hash) as distinct_devices,
  max(created_at) as last_evidence_at
from public.presence_evidence
where is_flagged = false
group by establishment_id, product_type_id;

revoke all on public.presence_evidence_summary from anon, authenticated;
grant select on public.presence_evidence_summary to service_role;
