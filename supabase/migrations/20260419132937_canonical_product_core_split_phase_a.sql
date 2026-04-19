begin;

create extension if not exists pg_trgm;

create or replace function public.canonical_slugify(p_input text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(p_input, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

alter function public.canonical_slugify(text)
  set search_path = public;

alter table public.canonical_products
  add column if not exists group_key text,
  add column if not exists family_slug text,
  add column if not exists is_active boolean not null default true,
  add column if not exists priority smallint not null default 50,
  add column if not exists coverage_tier text not null default 'core';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'canonical_products_group_key_normalized_chk'
      and conrelid = 'public.canonical_products'::regclass
  ) then
    alter table public.canonical_products
      add constraint canonical_products_group_key_normalized_chk
      check (group_key = lower(btrim(group_key)));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'canonical_products_priority_range_chk'
      and conrelid = 'public.canonical_products'::regclass
  ) then
    alter table public.canonical_products
      add constraint canonical_products_priority_range_chk
      check (priority between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'canonical_products_coverage_tier_chk'
      and conrelid = 'public.canonical_products'::regclass
  ) then
    alter table public.canonical_products
      add constraint canonical_products_coverage_tier_chk
      check (coverage_tier in ('core', 'extended', 'edge'));
  end if;
end
$$;

create or replace function public.sync_canonical_products_core_fields()
returns trigger
language plpgsql
as $$
declare
  v_group text;
  v_slug text;
begin
  if tg_op = 'INSERT' then
    v_group := coalesce(new.group_key, new.product_group);
  else
    if new.group_key is distinct from old.group_key then
      v_group := new.group_key;
    elsif new.product_group is distinct from old.product_group then
      v_group := new.product_group;
    else
      v_group := coalesce(new.group_key, new.product_group, old.group_key, old.product_group);
    end if;
  end if;

  v_group := lower(btrim(coalesce(v_group, 'uncategorized')));
  if v_group = '' then
    v_group := 'uncategorized';
  end if;

  new.group_key := v_group;
  new.product_group := v_group;

  if tg_op = 'INSERT' then
    if new.family_slug is null or btrim(new.family_slug) = '' then
      v_slug := public.canonical_slugify(new.normalized_name);
    else
      v_slug := public.canonical_slugify(new.family_slug);
    end if;
  else
    if new.family_slug is null
      or btrim(new.family_slug) = ''
      or new.normalized_name is distinct from old.normalized_name
    then
      v_slug := public.canonical_slugify(coalesce(new.family_slug, new.normalized_name));
    else
      v_slug := public.canonical_slugify(new.family_slug);
    end if;
  end if;

  if v_slug is null then
    v_slug := 'product-' || coalesce(new.id::text, substr(md5(coalesce(new.normalized_name, 'product')), 1, 8));
  end if;

  if exists (
    select 1
    from public.canonical_products cp
    where cp.family_slug = v_slug
      and cp.id <> coalesce(new.id, -1)
  ) then
    v_slug := v_slug || '-' || coalesce(new.id::text, substr(md5(coalesce(new.normalized_name, 'product')), 1, 6));
  end if;

  new.family_slug := v_slug;
  new.coverage_tier := lower(btrim(coalesce(new.coverage_tier, 'core')));
  new.priority := coalesce(new.priority, 50);
  new.is_active := coalesce(new.is_active, true);

  return new;
end;
$$;

alter function public.sync_canonical_products_core_fields()
  set search_path = public;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_canonical_products_sync_core_fields'
  ) then
    create trigger trg_canonical_products_sync_core_fields
      before insert or update on public.canonical_products
      for each row execute function public.sync_canonical_products_core_fields();
  end if;
end
$$;

update public.canonical_products
set
  group_key = coalesce(group_key, product_group),
  family_slug = coalesce(family_slug, normalized_name),
  is_active = coalesce(is_active, true),
  priority = coalesce(priority, 50),
  coverage_tier = coalesce(coverage_tier, 'core');

with duplicates as (
  select
    id,
    family_slug,
    row_number() over (partition by family_slug order by id asc) as rn
  from public.canonical_products
)
update public.canonical_products p
set family_slug = p.family_slug || '-' || p.id::text
from duplicates d
where p.id = d.id
  and d.rn > 1;

update public.canonical_products
set family_slug = 'product-' || id::text
where family_slug is null or btrim(family_slug) = '';

alter table public.canonical_products
  alter column group_key set not null,
  alter column family_slug set not null;

create unique index if not exists idx_canonical_products_family_slug
  on public.canonical_products(family_slug);

create index if not exists idx_canonical_products_group_key_active
  on public.canonical_products(group_key, is_active, priority desc);

create index if not exists idx_canonical_products_coverage_tier_priority
  on public.canonical_products(coverage_tier, priority desc);

create table if not exists public.canonical_product_aliases (
  id bigserial primary key,
  canonical_product_id bigint not null references public.canonical_products(id) on delete cascade,
  lang text not null default 'und',
  alias text not null,
  alias_normalized text generated always as (lower(btrim(alias))) stored,
  priority smallint not null default 50,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_product_aliases_alias_not_blank_chk check (char_length(alias_normalized) > 0),
  constraint canonical_product_aliases_priority_range_chk check (priority between 0 and 100),
  constraint canonical_product_aliases_unique unique (canonical_product_id, lang, alias_normalized)
);

create index if not exists idx_canonical_product_aliases_lookup
  on public.canonical_product_aliases(lang, alias_normalized)
  where is_active = true;

create index if not exists idx_canonical_product_aliases_alias_trgm
  on public.canonical_product_aliases using gin (alias_normalized gin_trgm_ops)
  where is_active = true;

create table if not exists public.canonical_product_facets (
  id bigserial primary key,
  canonical_product_id bigint not null references public.canonical_products(id) on delete cascade,
  facet text not null,
  facet_normalized text generated always as (lower(btrim(facet))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_product_facets_not_blank_chk check (char_length(facet_normalized) > 0),
  constraint canonical_product_facets_unique unique (canonical_product_id, facet_normalized)
);

create index if not exists idx_canonical_product_facets_lookup
  on public.canonical_product_facets(facet_normalized);

create table if not exists public.canonical_product_use_cases (
  id bigserial primary key,
  canonical_product_id bigint not null references public.canonical_products(id) on delete cascade,
  lang text not null default 'und',
  use_case_term text not null,
  use_case_normalized text generated always as (lower(btrim(use_case_term))) stored,
  priority smallint not null default 50,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_product_use_cases_not_blank_chk check (char_length(use_case_normalized) > 0),
  constraint canonical_product_use_cases_priority_range_chk check (priority between 0 and 100),
  constraint canonical_product_use_cases_unique unique (canonical_product_id, lang, use_case_normalized)
);

create index if not exists idx_canonical_product_use_cases_lookup
  on public.canonical_product_use_cases(lang, use_case_normalized)
  where is_active = true;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_canonical_product_aliases_set_updated_at'
  ) then
    create trigger trg_canonical_product_aliases_set_updated_at
      before update on public.canonical_product_aliases
      for each row execute function public.set_updated_at_timestamp();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_canonical_product_facets_set_updated_at'
  ) then
    create trigger trg_canonical_product_facets_set_updated_at
      before update on public.canonical_product_facets
      for each row execute function public.set_updated_at_timestamp();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_canonical_product_use_cases_set_updated_at'
  ) then
    create trigger trg_canonical_product_use_cases_set_updated_at
      before update on public.canonical_product_use_cases
      for each row execute function public.set_updated_at_timestamp();
  end if;
end
$$;

insert into public.canonical_product_aliases (
  canonical_product_id,
  lang,
  alias,
  priority,
  is_active
)
with alias_seed as (
  select id as canonical_product_id, 'und'::text as lang, normalized_name as alias, 100::smallint as priority
  from public.canonical_products

  union all

  select id, 'en'::text, display_name_en, 90::smallint
  from public.canonical_products

  union all

  select id, 'de'::text, display_name_de, 90::smallint
  from public.canonical_products

  union all

  select id, 'es'::text, display_name_es, 90::smallint
  from public.canonical_products

  union all

  select cp.id, 'und'::text, syn.alias, 75::smallint
  from public.canonical_products cp
  cross join lateral unnest(coalesce(cp.synonyms, '{}'::text[])) as syn(alias)
)
select
  canonical_product_id,
  lang,
  btrim(alias) as alias,
  priority,
  true as is_active
from alias_seed
where alias is not null
  and btrim(alias) <> ''
on conflict on constraint canonical_product_aliases_unique
do update
set
  priority = greatest(public.canonical_product_aliases.priority, excluded.priority),
  is_active = true,
  updated_at = now();

insert into public.canonical_product_facets (
  canonical_product_id,
  facet
)
select
  id as canonical_product_id,
  group_key as facet
from public.canonical_products
where group_key is not null
  and btrim(group_key) <> ''
on conflict on constraint canonical_product_facets_unique do nothing;

alter table if exists public.canonical_product_aliases enable row level security;
alter table if exists public.canonical_product_facets enable row level security;
alter table if exists public.canonical_product_use_cases enable row level security;

comment on column public.canonical_products.product_group is
  'Deprecated compatibility column (phase A). Use group_key for new catalog logic.';

comment on column public.canonical_products.synonyms is
  'Deprecated compatibility column (phase A). Use canonical_product_aliases for searchable terms.';

comment on table public.canonical_product_aliases is
  'Search aliases for canonical products by language with priority and active flag.';

comment on table public.canonical_product_facets is
  'Stable functional facets (kitchen, cleaning, health, baby, pet, office, etc.).';

comment on table public.canonical_product_use_cases is
  'Intent/use-case terms (e.g. breakfast, school, cold relief) per language.';

commit;
