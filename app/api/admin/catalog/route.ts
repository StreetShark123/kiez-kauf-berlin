import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type CanonicalProductRow = {
  id: number;
  normalized_name: string;
  family_slug: string | null;
  display_name_en: string | null;
  display_name_de: string | null;
  display_name_es: string | null;
  coverage_tier: "core" | "extended" | "edge" | null;
  priority: number | null;
  is_active: boolean | null;
  group_key?: string | null;
  product_group?: string | null;
};

type TaxonomyRow = {
  slug: string;
  parent_slug: string | null;
  display_name_en: string;
  display_name_de: string;
  is_searchable: boolean;
};

type EstablishmentCategoryRow = {
  app_categories: string[] | null;
};

type CanonicalAliasRow = {
  canonical_product_id: number;
  alias: string;
  lang: string;
  is_active: boolean | null;
  priority: number | null;
};

type CanonicalFacetRow = {
  canonical_product_id: number;
  facet_normalized: string;
};

type CanonicalUseCaseRow = {
  canonical_product_id: number;
  use_case_term: string;
  is_active: boolean | null;
  priority: number | null;
};

type MergedRow = {
  canonical_product_id: number;
};

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();

    const [
      { data: products, error: productsError },
      { data: taxonomy, error: taxonomyError },
      { data: establishments, error: establishmentsError },
      { data: aliases, error: aliasesError },
      { data: facets, error: facetsError },
      { data: useCases, error: useCasesError },
      { data: merged, error: mergedError }
    ] =
      await Promise.all([
        supabase
          .from("canonical_products")
          .select(
            "id, normalized_name, family_slug, display_name_en, display_name_de, display_name_es, group_key, product_group, coverage_tier, priority, is_active"
          )
          .order("priority", { ascending: false })
          .limit(7000),
        supabase
          .from("app_category_taxonomy")
          .select("slug, parent_slug, display_name_en, display_name_de, is_searchable")
          .order("slug", { ascending: true })
          .limit(1500),
        supabase.from("establishments").select("app_categories").limit(10000),
        supabase
          .from("canonical_product_aliases")
          .select("canonical_product_id, alias, lang, is_active, priority")
          .eq("is_active", true)
          .order("priority", { ascending: false })
          .limit(50000),
        supabase
          .from("canonical_product_facets")
          .select("canonical_product_id, facet_normalized")
          .limit(50000),
        supabase
          .from("canonical_product_use_cases")
          .select("canonical_product_id, use_case_term, is_active, priority")
          .eq("is_active", true)
          .order("priority", { ascending: false })
          .limit(50000),
        supabase
          .from("establishment_product_merged")
          .select("canonical_product_id")
          .neq("validation_status", "rejected")
          .limit(80000)
      ]);

    if (productsError) throw new Error(productsError.message);
    if (taxonomyError) throw new Error(taxonomyError.message);
    if (establishmentsError) throw new Error(establishmentsError.message);
    if (aliasesError) throw new Error(aliasesError.message);
    if (facetsError) throw new Error(facetsError.message);
    if (useCasesError) throw new Error(useCasesError.message);
    if (mergedError) throw new Error(mergedError.message);

    const productRows = (products ?? []) as CanonicalProductRow[];
    const taxonomyRows = (taxonomy ?? []) as TaxonomyRow[];
    const establishmentRows = (establishments ?? []) as EstablishmentCategoryRow[];
    const aliasRows = (aliases ?? []) as CanonicalAliasRow[];
    const facetRows = (facets ?? []) as CanonicalFacetRow[];
    const useCaseRows = (useCases ?? []) as CanonicalUseCaseRow[];
    const mergedRows = (merged ?? []) as MergedRow[];

    const productsByGroup = new Map<string, { group: string; count: number; sample: string[] }>();
    for (const row of productRows) {
      const key = row.group_key?.trim() || row.product_group?.trim() || "uncategorized";
      const entry = productsByGroup.get(key) ?? { group: key, count: 0, sample: [] };
      entry.count += 1;
      if (entry.sample.length < 6) {
        entry.sample.push(row.normalized_name);
      }
      productsByGroup.set(key, entry);
    }

    const establishmentsByCategory = new Map<string, number>();
    for (const row of establishmentRows) {
      const categories = Array.isArray(row.app_categories) ? row.app_categories : [];
      for (const category of categories) {
        const key = category?.trim();
        if (!key) continue;
        establishmentsByCategory.set(key, (establishmentsByCategory.get(key) ?? 0) + 1);
      }
    }

    const taxonomyWithCounts = taxonomyRows.map((row) => ({
      ...row,
      establishment_count: establishmentsByCategory.get(row.slug) ?? 0
    }));

    const aliasMap = new Map<number, string[]>();
    for (const row of aliasRows) {
      const id = Number(row.canonical_product_id);
      if (!Number.isFinite(id)) continue;
      const alias = String(row.alias ?? "").trim();
      if (!alias) continue;
      const current = aliasMap.get(id) ?? [];
      if (!current.includes(alias) && current.length < 8) {
        current.push(alias);
        aliasMap.set(id, current);
      }
    }

    const facetMap = new Map<number, string[]>();
    for (const row of facetRows) {
      const id = Number(row.canonical_product_id);
      if (!Number.isFinite(id)) continue;
      const facet = String(row.facet_normalized ?? "").trim().toLowerCase();
      if (!facet) continue;
      const current = facetMap.get(id) ?? [];
      if (!current.includes(facet) && current.length < 6) {
        current.push(facet);
        facetMap.set(id, current);
      }
    }

    const useCaseMap = new Map<number, string[]>();
    for (const row of useCaseRows) {
      const id = Number(row.canonical_product_id);
      if (!Number.isFinite(id)) continue;
      const term = String(row.use_case_term ?? "").trim();
      if (!term) continue;
      const current = useCaseMap.get(id) ?? [];
      if (!current.includes(term) && current.length < 5) {
        current.push(term);
        useCaseMap.set(id, current);
      }
    }

    const storeCountByProductId = new Map<number, number>();
    for (const row of mergedRows) {
      const id = Number(row.canonical_product_id);
      if (!Number.isFinite(id)) continue;
      storeCountByProductId.set(id, (storeCountByProductId.get(id) ?? 0) + 1);
    }

    const familyConnections = productRows
      .map((row) => {
        const id = Number(row.id);
        const group = row.group_key?.trim() || row.product_group?.trim() || "uncategorized";
        const aliasesSample = aliasMap.get(id) ?? [];
        const facetsSample = facetMap.get(id) ?? [];
        const useCasesSample = useCaseMap.get(id) ?? [];

        return {
          id,
          family_slug: row.family_slug ?? `product-${id}`,
          display_name_en: row.display_name_en ?? row.normalized_name,
          display_name_de: row.display_name_de ?? row.display_name_en ?? row.normalized_name,
          display_name_es: row.display_name_es ?? row.display_name_en ?? row.normalized_name,
          normalized_name: row.normalized_name,
          group,
          coverage_tier: row.coverage_tier ?? "core",
          priority: row.priority ?? 50,
          is_active: row.is_active !== false,
          store_count: storeCountByProductId.get(id) ?? 0,
          alias_count: aliasesSample.length,
          aliases_sample: aliasesSample,
          facet_count: facetsSample.length,
          facets_sample: facetsSample,
          use_case_count: useCasesSample.length,
          use_cases_sample: useCasesSample
        };
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (b.store_count !== a.store_count) return b.store_count - a.store_count;
        if (b.alias_count !== a.alias_count) return b.alias_count - a.alias_count;
        return a.display_name_en.localeCompare(b.display_name_en);
      })
      .slice(0, 320);

    return NextResponse.json({
      totals: {
        taxonomy_categories: taxonomyRows.length,
        canonical_products: productRows.length,
        establishments_with_categories: establishmentRows.filter((row) => (row.app_categories ?? []).length > 0).length,
        aliases: aliasRows.length,
        facets: facetRows.length,
        use_cases: useCaseRows.length
      },
      categories: taxonomyWithCounts,
      products_by_group: [...productsByGroup.values()].sort((a, b) => b.count - a.count),
      product_families: familyConnections
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
