-- Data quality and freshness support for Berlin dataset refresh and enrichment.

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'source_type_enum'::regtype
      and enumlabel = 'website_extracted'
  ) then
    alter type source_type_enum add value 'website_extracted';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum
    where enumtypid = 'source_type_enum'::regtype
      and enumlabel = 'validated'
  ) then
    alter type source_type_enum add value 'validated';
  end if;
end $$;

alter table if exists establishments
  add column if not exists last_imported_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists source_url text,
  add column if not exists last_enriched_at timestamptz,
  add column if not exists freshness_score numeric(5,4),
  add column if not exists is_closed_candidate boolean not null default false,
  add column if not exists closed_candidate_since timestamptz,
  add column if not exists opening_hours_source text,
  add column if not exists opening_hours_source_url text,
  add column if not exists opening_hours_last_checked_at timestamptz,
  add column if not exists opening_hours_confidence numeric(5,4),
  add column if not exists opening_hours_osm text,
  add column if not exists opening_hours_website text,
  add column if not exists opening_hours_conflict_note text,
  add column if not exists possible_duplicate_of bigint references establishments(id) on delete set null,
  add column if not exists duplicate_confidence numeric(5,4);

update establishments
set
  last_imported_at = coalesce(last_imported_at, updated_at, created_at),
  last_seen_at = coalesce(last_seen_at, updated_at, created_at),
  freshness_score = coalesce(freshness_score, 0.75),
  opening_hours_osm = coalesce(opening_hours_osm, opening_hours),
  opening_hours_source = coalesce(
    opening_hours_source,
    case when opening_hours is not null and btrim(opening_hours) <> '' then 'osm' end
  ),
  opening_hours_source_url = coalesce(opening_hours_source_url, source_url),
  opening_hours_last_checked_at = coalesce(
    opening_hours_last_checked_at,
    case when opening_hours is not null and btrim(opening_hours) <> '' then updated_at end
  ),
  opening_hours_confidence = coalesce(
    opening_hours_confidence,
    case when opening_hours is not null and btrim(opening_hours) <> '' then 0.88 end
  )
where external_source = 'osm-overpass';

alter table establishments
  alter column freshness_score set default 0.75;

alter table establishments
  add constraint establishments_freshness_score_check
    check (freshness_score is null or (freshness_score >= 0 and freshness_score <= 1));

alter table establishments
  add constraint establishments_opening_hours_confidence_check
    check (opening_hours_confidence is null or (opening_hours_confidence >= 0 and opening_hours_confidence <= 1));

alter table establishments
  add constraint establishments_duplicate_confidence_check
    check (duplicate_confidence is null or (duplicate_confidence >= 0 and duplicate_confidence <= 1));

create index if not exists idx_establishments_last_seen_at on establishments(last_seen_at desc);
create index if not exists idx_establishments_last_imported_at on establishments(last_imported_at desc);
create index if not exists idx_establishments_freshness_score on establishments(freshness_score desc);
create index if not exists idx_establishments_closed_candidate on establishments(is_closed_candidate);
create index if not exists idx_establishments_possible_duplicate on establishments(possible_duplicate_of);

create table if not exists establishment_website_enrichment (
  id bigserial primary key,
  establishment_id bigint not null unique references establishments(id) on delete cascade,
  source_url text not null,
  fetched_at timestamptz not null default now(),
  http_status integer,
  page_title text,
  meta_description text,
  headings text[] not null default '{}',
  breadcrumbs text[] not null default '{}',
  visible_categories text[] not null default '{}',
  visible_brands text[] not null default '{}',
  schema_entities jsonb not null default '[]'::jsonb,
  schema_opening_hours text,
  extracted_opening_hours text,
  extraction_notes text,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_establishment_website_enrichment_fetched_at
  on establishment_website_enrichment(fetched_at desc);

create index if not exists idx_establishment_website_enrichment_source_url
  on establishment_website_enrichment(source_url);

create table if not exists establishment_refresh_runs (
  id bigserial primary key,
  run_type text not null,
  run_label text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  details jsonb not null default '{}'::jsonb
);

create or replace function compute_establishment_freshness_score(
  p_last_seen_at timestamptz,
  p_last_imported_at timestamptz,
  p_last_enriched_at timestamptz,
  p_is_closed_candidate boolean default false,
  p_active_status active_status_enum default 'active'
) returns numeric
language plpgsql
as $$
declare
  age_seen_days numeric := extract(epoch from (now() - coalesce(p_last_seen_at, now() - interval '365 day'))) / 86400.0;
  age_import_days numeric := extract(epoch from (now() - coalesce(p_last_imported_at, now() - interval '365 day'))) / 86400.0;
  age_enriched_days numeric := extract(epoch from (now() - coalesce(p_last_enriched_at, now() - interval '365 day'))) / 86400.0;
  score numeric := 1.0;
begin
  score := score
    - least(0.58, age_seen_days * 0.010)
    - least(0.23, age_import_days * 0.004)
    - least(0.15, age_enriched_days * 0.0025);

  if p_is_closed_candidate then
    score := score - 0.18;
  end if;

  if p_active_status = 'temporarily_closed' then
    score := score - 0.12;
  elsif p_active_status = 'inactive' then
    score := score - 0.28;
  end if;

  return greatest(0.05, least(0.99, round(score, 4)));
end;
$$;

create or replace function refresh_establishment_freshness_scores()
returns integer
language plpgsql
as $$
declare
  updated_rows integer;
begin
  with updated as (
    update establishments e
    set freshness_score = compute_establishment_freshness_score(
      e.last_seen_at,
      e.last_imported_at,
      e.last_enriched_at,
      e.is_closed_candidate,
      e.active_status
    )
    where e.external_source = 'osm-overpass'
    returning 1
  )
  select count(*) into updated_rows from updated;

  return coalesce(updated_rows, 0);
end;
$$;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at_timestamp') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_establishment_website_enrichment_set_updated_at') then
      create trigger trg_establishment_website_enrichment_set_updated_at
      before update on establishment_website_enrichment
      for each row execute function set_updated_at_timestamp();
    end if;
  end if;
end $$;

drop view if exists search_product_establishment_dataset;
drop materialized view if exists search_product_establishment_mv;

create materialized view search_product_establishment_mv as
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
    e.opening_hours,
    e.opening_hours_source,
    e.opening_hours_confidence,
    e.freshness_score,
    e.last_seen_at,
    e.last_imported_at,
    e.last_enriched_at,
    e.source_url,
    p.normalized_name as product_normalized_name,
    p.display_name_es,
    p.display_name_en,
    p.display_name_de,
    p.product_group,
    row_number() over (
      partition by m.establishment_id, m.canonical_product_id
      order by m.confidence desc, m.updated_at desc, m.id asc
    ) as rn
  from establishment_product_merged m
  join establishments e on e.id = m.establishment_id
  join canonical_products p on p.id = m.canonical_product_id
  where m.validation_status <> 'rejected'
    and e.active_status in ('active', 'temporarily_closed')
    and coalesce(e.is_closed_candidate, false) = false
    and e.possible_duplicate_of is null
)
select
  establishment_id,
  canonical_product_id,
  source_type,
  confidence,
  validation_status,
  why_this_product_matches,
  category_path,
  inferred_from,
  updated_at,
  external_source,
  external_id,
  establishment_name,
  address,
  district,
  lat,
  lon,
  osm_category,
  app_categories,
  opening_hours,
  opening_hours_source,
  opening_hours_confidence,
  freshness_score,
  last_seen_at,
  last_imported_at,
  last_enriched_at,
  source_url,
  product_normalized_name,
  display_name_es,
  display_name_en,
  display_name_de,
  product_group
from ranked
where rn = 1;

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

create index if not exists idx_search_product_establishment_mv_freshness
  on search_product_establishment_mv(freshness_score desc);

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
