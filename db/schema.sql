create extension if not exists postgis;
create extension if not exists pgcrypto;

create table if not exists stores (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  address text not null,
  district text not null,
  opening_hours text not null,
  lat double precision not null,
  lng double precision not null,
  geog geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(lng, lat), 4326)::geography
  ) stored,
  created_at timestamptz not null default now()
);

create index if not exists idx_stores_geog on stores using gist(geog);

create table if not exists products (
  id text primary key default gen_random_uuid()::text,
  normalized_name text not null,
  brand text,
  category text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_products_normalized_name on products(normalized_name);

create table if not exists offers (
  id text primary key default gen_random_uuid()::text,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  price_optional numeric(10,2),
  availability text not null check (availability in ('in_stock', 'low_stock', 'unknown')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_offers_store on offers(store_id);
create index if not exists idx_offers_product on offers(product_id);
create unique index if not exists idx_offers_store_product on offers(store_id, product_id);

create table if not exists route_clicks (
  id bigserial primary key,
  interaction_id text not null unique,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  origin_lat double precision,
  origin_lng double precision,
  destination_lat double precision,
  destination_lng double precision,
  locale text not null default 'de',
  clicked_at timestamptz not null default now()
);

create index if not exists idx_route_clicks_clicked_at on route_clicks(clicked_at desc);

create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  search_term text not null,
  category text,
  district text,
  radius_km numeric,
  results_count integer,
  has_results boolean,
  endpoint text,
  timestamp timestamptz not null default now()
);

create index if not exists idx_searches_timestamp_desc
  on searches(timestamp desc);

create index if not exists idx_searches_has_results
  on searches(has_results, timestamp desc);

-- ============================================================
-- Minimal Berlin data model for real establishments and probable products
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_type_enum') then
    create type source_type_enum as enum (
      'imported',
      'rules_generated',
      'ai_generated',
      'merchant_added',
      'user_validated'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'validation_status_enum') then
    create type validation_status_enum as enum (
      'unvalidated',
      'likely',
      'validated',
      'rejected'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'active_status_enum') then
    create type active_status_enum as enum (
      'active',
      'inactive',
      'temporarily_closed',
      'unknown'
    );
  end if;
end $$;

create table if not exists establishments (
  id bigserial primary key,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create index if not exists idx_establishments_district on establishments(district);
create index if not exists idx_establishments_lat_lon on establishments(lat, lon);

create table if not exists canonical_products (
  id bigserial primary key,
  normalized_name text not null unique,
  display_name_es text not null,
  display_name_en text not null,
  display_name_de text not null,
  synonyms text[] not null default '{}',
  product_group text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normalized_name = lower(trim(normalized_name)))
);

create index if not exists idx_canonical_products_group on canonical_products(product_group);

create table if not exists establishment_product_candidates (
  id bigserial primary key,
  establishment_id bigint not null references establishments(id) on delete cascade,
  canonical_product_id bigint not null references canonical_products(id) on delete restrict,
  source_type source_type_enum not null,
  generation_method text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  validation_status validation_status_enum not null default 'unvalidated',
  validation_notes text,
  why_this_product_matches text,
  category_path text[],
  inferred_from jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, canonical_product_id, source_type, generation_method)
);

create index if not exists idx_epc_establishment on establishment_product_candidates(establishment_id);
create index if not exists idx_epc_product on establishment_product_candidates(canonical_product_id);
create index if not exists idx_epc_source_type on establishment_product_candidates(source_type);
create index if not exists idx_epc_validation_status on establishment_product_candidates(validation_status);

create table if not exists establishment_product_candidate_audit (
  id bigserial primary key,
  candidate_id bigint not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_at timestamptz not null default now(),
  changed_by_type text not null default 'system',
  changed_by_id text,
  reason text,
  old_row jsonb,
  new_row jsonb
);

create index if not exists idx_epc_audit_candidate_changed_at
  on establishment_product_candidate_audit(candidate_id, changed_at desc);

create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_establishments_set_updated_at') then
    create trigger trg_establishments_set_updated_at
    before update on establishments
    for each row execute function set_updated_at_timestamp();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_canonical_products_set_updated_at') then
    create trigger trg_canonical_products_set_updated_at
    before update on canonical_products
    for each row execute function set_updated_at_timestamp();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_epc_set_updated_at') then
    create trigger trg_epc_set_updated_at
    before update on establishment_product_candidates
    for each row execute function set_updated_at_timestamp();
  end if;
end $$;

create or replace function audit_establishment_product_candidate_changes()
returns trigger as $$
declare
  actor_type text := coalesce(nullif(current_setting('app.audit.actor_type', true), ''), 'system');
  actor_id text := nullif(current_setting('app.audit.actor_id', true), '');
  actor_reason text := nullif(current_setting('app.audit.reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, new_row
    )
    values (
      new.id, 'insert', actor_type, actor_id, actor_reason, to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, old_row, new_row
    )
    values (
      new.id, 'update', actor_type, actor_id, actor_reason, to_jsonb(old), to_jsonb(new)
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into establishment_product_candidate_audit (
      candidate_id, action, changed_by_type, changed_by_id, reason, old_row
    )
    values (
      old.id, 'delete', actor_type, actor_id, actor_reason, to_jsonb(old)
    );
    return old;
  end if;

  return null;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_epc_changes') then
    create trigger trg_audit_epc_changes
    after insert or update or delete on establishment_product_candidates
    for each row execute function audit_establishment_product_candidate_changes();
  end if;
end $$;
