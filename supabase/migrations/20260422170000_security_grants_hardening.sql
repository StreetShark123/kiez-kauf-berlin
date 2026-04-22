begin;

-- Tighten anon/authenticated privileges to least-privilege serving needs.

revoke all on table public.app_category_group_rules from anon, authenticated;
revoke all on table public.app_category_taxonomy from anon, authenticated;
revoke all on table public.berlin_establishment_stage from anon, authenticated;
revoke all on table public.canonical_product_aliases from anon, authenticated;
revoke all on table public.canonical_product_facets from anon, authenticated;
revoke all on table public.canonical_product_use_cases from anon, authenticated;
revoke all on table public.canonical_products from anon, authenticated;
revoke all on table public.curation_events from anon, authenticated;
revoke all on table public.curation_rule_suggestions from anon, authenticated;
revoke all on table public.establishment_product_candidate_audit from anon, authenticated;
revoke all on table public.establishment_product_candidates from anon, authenticated;
revoke all on table public.establishment_product_merged from anon, authenticated;
revoke all on table public.establishment_refresh_runs from anon, authenticated;
revoke all on table public.establishment_website_enrichment from anon, authenticated;
revoke all on table public.establishments from anon, authenticated;
revoke all on table public.offers from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.route_clicks from anon, authenticated;
revoke all on table public.search_product_establishment_dataset from anon, authenticated;
revoke all on table public.search_product_establishment_mv from anon, authenticated;
revoke all on table public.searches from anon, authenticated;
revoke all on table public.stores from anon, authenticated;

-- PostGIS metadata should not be writable or broadly readable by anon/authenticated.
revoke all on table public.spatial_ref_sys from anon, authenticated;
revoke all on table public.geometry_columns from anon, authenticated;
revoke all on table public.geography_columns from anon, authenticated;

-- Public read surface required by serving/search.
grant select on table public.stores to anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select on table public.offers to anon, authenticated;
grant select on table public.establishments to anon, authenticated;
grant select on table public.canonical_products to anon, authenticated;
grant select on table public.canonical_product_aliases to anon, authenticated;
grant select on table public.canonical_product_facets to anon, authenticated;
grant select on table public.canonical_product_use_cases to anon, authenticated;
grant select on table public.search_product_establishment_dataset to anon, authenticated;
grant select on table public.search_product_establishment_mv to anon, authenticated;

-- Public anonymous analytics writes.
grant insert on table public.searches to anon, authenticated;
grant insert on table public.route_clicks to anon, authenticated;

do $$
begin
  if to_regclass('public.route_clicks_id_seq') is not null then
    execute 'grant usage, select on sequence public.route_clicks_id_seq to anon, authenticated';
  end if;
end
$$;

commit;
