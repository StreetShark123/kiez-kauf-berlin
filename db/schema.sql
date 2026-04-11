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
