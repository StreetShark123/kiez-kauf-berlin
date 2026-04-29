-- Phase A: runtime query intelligence observability and curation scaffolding.

create table if not exists public.query_resolution_log (
  id bigserial primary key,
  request_id text not null,
  original_query text not null,
  resolved_query text not null,
  intent_type text not null default 'unknown' check (intent_type in ('product','service','category','problem_to_solve','unknown')),
  confidence numeric(5,4) not null default 0,
  canonical_terms text[] not null default '{}',
  alternate_queries text[] not null default '{}',
  must_have_tokens text[] not null default '{}',
  negative_tokens text[] not null default '{}',
  model text,
  provider text,
  prompt_hash text,
  used_llm boolean not null default false,
  llm_latency_ms integer,
  llm_input_tokens integer,
  llm_output_tokens integer,
  estimated_cost_usd numeric(12,6),
  error_message text,
  query_lat double precision,
  query_lng double precision,
  radius_meters integer,
  result_mode text,
  results_count integer,
  service_fallback_count integer,
  endpoint text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_query_resolution_log_request_id
  on public.query_resolution_log(request_id);

create index if not exists idx_query_resolution_log_created_at
  on public.query_resolution_log(created_at desc);

create index if not exists idx_query_resolution_log_original_query
  on public.query_resolution_log(lower(original_query));

create index if not exists idx_query_resolution_log_resolved_query
  on public.query_resolution_log(lower(resolved_query));

create index if not exists idx_query_resolution_log_intent
  on public.query_resolution_log(intent_type, created_at desc);

create table if not exists public.store_capability_profiles (
  id bigserial primary key,
  establishment_id bigint not null references public.establishments(id) on delete cascade,
  source_type text not null default 'ai_generated' check (source_type in ('rules_generated','website_extracted','ai_generated','validated')),
  extraction_method text,
  model text,
  prompt_hash text,
  profile_version text not null default 'v1',
  store_type text,
  business_roles text[] not null default '{}',
  likely_products text[] not null default '{}',
  likely_services text[] not null default '{}',
  unlikely_terms text[] not null default '{}',
  confidence numeric(5,4) not null default 0,
  validation_status text not null default 'likely' check (validation_status in ('unvalidated','likely','validated','rejected')),
  manual_review_needed boolean not null default true,
  review_reason text,
  source_url text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, profile_version)
);

create index if not exists idx_store_capability_profiles_establishment
  on public.store_capability_profiles(establishment_id);

create index if not exists idx_store_capability_profiles_validation
  on public.store_capability_profiles(validation_status, updated_at desc);

create index if not exists idx_store_capability_profiles_roles
  on public.store_capability_profiles using gin (business_roles);

create table if not exists public.ranking_decisions (
  id bigserial primary key,
  request_id text not null,
  query text not null,
  normalized_query text not null,
  district text,
  radius_meters integer,
  model text,
  provider text,
  strategy text not null default 'rules_only' check (strategy in ('rules_only','llm_rerank','hybrid')),
  considered_candidates integer not null default 0,
  selected_candidates integer not null default 0,
  decision_confidence numeric(5,4),
  rationale text,
  input_hash text,
  output_hash text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_ranking_decisions_request_id
  on public.ranking_decisions(request_id);

create index if not exists idx_ranking_decisions_created_at
  on public.ranking_decisions(created_at desc);

alter table public.query_resolution_log enable row level security;
alter table public.store_capability_profiles enable row level security;
alter table public.ranking_decisions enable row level security;

revoke all on table public.query_resolution_log from anon, authenticated;
revoke all on table public.store_capability_profiles from anon, authenticated;
revoke all on table public.ranking_decisions from anon, authenticated;

-- keep updated_at coherent on mutable table
 do $$
 begin
   if exists (
     select 1
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'set_updated_at'
       and n.nspname = 'public'
   ) and not exists (
     select 1 from pg_trigger where tgname = 'trg_store_capability_profiles_set_updated_at'
   ) then
     create trigger trg_store_capability_profiles_set_updated_at
       before update on public.store_capability_profiles
       for each row execute function public.set_updated_at();
   end if;
 end $$;
