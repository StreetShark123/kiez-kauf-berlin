# Role + Service Curation (Phase G)

## Objective
Build a lean curation layer that improves semantic coverage without inflating DB size:
- classify establishments by **store role**
- separate **products** and **services**
- capture **failed searches** for demand-driven enrichment

## Schema changes
Migration: [`20260428171103_role_service_curation_foundation.sql`](/Users/axelsearagomez/Desktop/the%20hood/supabase/migrations/20260428171103_role_service_curation_foundation.sql)

Main additions:
- `establishments`
  - `store_roles text[]`
  - `store_role_primary text`
  - `role_confidence`
  - `role_classification_method`
  - `role_classified_at`
  - `is_relevant_for_kiezkauf`
  - `manual_review_status`
  - `manual_review_notes`
- `canonical_services`
- `canonical_service_aliases`
- `establishment_service_candidates`
- `establishment_service_merged`
- `canonical_search_terms`
- `failed_searches`
- `store_capabilities_lite_v1` (lean runtime view for fast role/capability reads)

## Pipelines
### 1) Classify store roles
```bash
npm run classify:store-roles -- --district-scope=moabit --postal-code-scope=10553
```

### 2) Generate service candidates from rules
```bash
npm run generate:rule-service-candidates -- --district-scope=moabit --postal-code-scope=10553 --max-services-per-store=6
```

### 3) Progressive daily run (Moabit 10553-first)
```bash
npm run curate:moabit-10553 -- --resume --max-cost-usd-per-run=1.2 --max-cost-usd-per-day=2
```

## API behavior
- `GET /api/search` now returns:
  - `results` (product matches)
  - `service_fallback` (service matches when relevant)
  - `result_mode` (`products_only | products_plus_services | services_fallback_only`)
- Search analytics writes unresolved demand into `failed_searches` with explicit reasons:
  - `no_results_products` (no product matches, service fallback available)
  - `no_results_any` (no products and no services)
- Admin establishments endpoints now expose role/review fields for one-by-one curation.

## DB growth guardrails
- keep service candidates to max 3-6 per store in rule generation
- keep raw prompts/responses out of DB (only aggregates/hashes)
- use unresolved queries (`failed_searches`) to prioritize enrichment instead of broad generation
- run persona gate + zero-result demand reports on each curation cycle
