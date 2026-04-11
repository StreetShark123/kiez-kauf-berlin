-- Pipeline support objects for Berlin establishment/product ingestion and search dataset

alter table if exists establishments
  add column if not exists classification_method text,
  add column if not exists classification_confidence numeric(5,4),
  add column if not exists classification_notes text,
  add column if not exists classification_updated_at timestamptz;

create table if not exists app_category_taxonomy (
  slug text primary key,
  display_name_es text not null,
  display_name_en text not null,
  display_name_de text not null,
  description text,
  parent_slug text references app_category_taxonomy(slug) on delete set null,
  is_searchable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_category_taxonomy_parent on app_category_taxonomy(parent_slug);

create table if not exists berlin_establishment_stage (
  id bigserial primary key,
  import_batch_id text not null,
  external_source text not null,
  external_id text not null,
  name text not null,
  address text not null,
  district text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  osm_category text,
  app_categories text[] not null default '{}',
  website text,
  phone text,
  opening_hours text,
  description text,
  active_status active_status_enum not null default 'active',
  checksum text,
  is_useful boolean not null default true,
  raw_tags jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create index if not exists idx_berlin_stage_batch on berlin_establishment_stage(import_batch_id);
create index if not exists idx_berlin_stage_useful on berlin_establishment_stage(is_useful);
create index if not exists idx_berlin_stage_category on berlin_establishment_stage(osm_category);
create index if not exists idx_berlin_stage_lat_lon on berlin_establishment_stage(lat, lon);

create table if not exists establishment_product_merged (
  id bigserial primary key,
  establishment_id bigint not null references establishments(id) on delete cascade,
  canonical_product_id bigint not null references canonical_products(id) on delete restrict,
  primary_source_type source_type_enum not null,
  merged_sources source_type_enum[] not null default '{}',
  merged_generation_methods text[] not null default '{}',
  merged_candidate_ids bigint[] not null default '{}',
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  validation_status validation_status_enum not null default 'unvalidated',
  why_this_product_matches text,
  category_path text[],
  inferred_from jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, canonical_product_id)
);

create index if not exists idx_epm_establishment on establishment_product_merged(establishment_id);
create index if not exists idx_epm_product on establishment_product_merged(canonical_product_id);
create index if not exists idx_epm_validation_status on establishment_product_merged(validation_status);

create materialized view if not exists search_product_establishment_mv as
with ranked as (
  select
    m.establishment_id,
    m.canonical_product_id,
    m.primary_source_type as source_type,
    m.confidence,
    m.validation_status,
    m.why_this_product_matches,
    m.category_path,
    m.inferred_from,
    m.updated_at,
    e.external_source,
    e.external_id,
    e.name as establishment_name,
    e.address,
    e.district,
    e.lat,
    e.lon,
    e.osm_category,
    e.app_categories,
    p.normalized_name as product_normalized_name,
    p.display_name_es,
    p.display_name_en,
    p.display_name_de,
    p.product_group
  from establishment_product_merged m
  join establishments e on e.id = m.establishment_id
  join canonical_products p on p.id = m.canonical_product_id
  where e.active_status = 'active'
    and m.validation_status <> 'rejected'
)
select * from ranked;

create unique index if not exists idx_search_product_establishment_mv_unique
  on search_product_establishment_mv(establishment_id, canonical_product_id);

create index if not exists idx_search_product_establishment_mv_product_name
  on search_product_establishment_mv(product_normalized_name);

create index if not exists idx_search_product_establishment_mv_validation
  on search_product_establishment_mv(validation_status);

create index if not exists idx_search_product_establishment_mv_district
  on search_product_establishment_mv(district);

create index if not exists idx_search_product_establishment_mv_lat_lon
  on search_product_establishment_mv(lat, lon);

create or replace view search_product_establishment_dataset as
select * from search_product_establishment_mv;

create or replace function refresh_search_product_establishment_mv()
returns void
language plpgsql
as $$
begin
  refresh materialized view search_product_establishment_mv;
end;
$$;

-- Ensure updated_at trigger is attached to new tables.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at_timestamp') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_app_category_taxonomy_set_updated_at') then
      create trigger trg_app_category_taxonomy_set_updated_at
      before update on app_category_taxonomy
      for each row execute function set_updated_at_timestamp();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_berlin_stage_set_updated_at') then
      create trigger trg_berlin_stage_set_updated_at
      before update on berlin_establishment_stage
      for each row execute function set_updated_at_timestamp();
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_epm_set_updated_at') then
      create trigger trg_epm_set_updated_at
      before update on establishment_product_merged
      for each row execute function set_updated_at_timestamp();
    end if;
  end if;
end $$;
