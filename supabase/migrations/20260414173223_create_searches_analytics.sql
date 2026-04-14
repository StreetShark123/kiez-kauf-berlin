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

create index if not exists idx_searches_search_term
  on searches(search_term);
