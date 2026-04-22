import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 25;
  }
  return Math.max(5, Math.min(80, Math.trunc(parsed)));
}

function sanitizeQuery(value: string | null) {
  return (value ?? "")
    .trim()
    .replace(/[%_]/g, "")
    .slice(0, 80);
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { searchParams } = new URL(request.url);
    const q = sanitizeQuery(searchParams.get("q"));
    const limit = parseLimit(searchParams.get("limit"));

    let query = supabase
      .from("canonical_products")
      .select(
        "id, normalized_name, display_name_en, display_name_de, display_name_es, group_key, product_group, is_active, coverage_tier, priority"
      )
      .order("normalized_name", { ascending: true })
      .limit(limit);

    if (q) {
      const pattern = `%${q}%`;
      query = query.or(
        `normalized_name.ilike.${pattern},display_name_en.ilike.${pattern},display_name_de.ilike.${pattern},display_name_es.ilike.${pattern}`
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{
      id: number;
      normalized_name: string;
      display_name_en: string | null;
      display_name_de: string | null;
      display_name_es: string | null;
      group_key: string | null;
      product_group?: string | null;
      is_active: boolean | null;
      coverage_tier: string | null;
      priority: number | null;
    }>;

    const ids = rows.map((row) => row.id);
    const aliasMap = new Map<number, string[]>();
    const facetMap = new Map<number, string[]>();
    if (ids.length > 0) {
      const [{ data: aliases, error: aliasesError }, { data: facets, error: facetsError }] = await Promise.all([
        supabase
          .from("canonical_product_aliases")
          .select("canonical_product_id, alias")
          .in("canonical_product_id", ids)
          .eq("is_active", true)
          .order("priority", { ascending: false })
          .limit(6000),
        supabase
          .from("canonical_product_facets")
          .select("canonical_product_id, facet_normalized")
          .in("canonical_product_id", ids)
          .limit(3000)
      ]);

      if (aliasesError) throw new Error(aliasesError.message);
      if (facetsError) throw new Error(facetsError.message);
      for (const item of aliases ?? []) {
        const productId = Number(item.canonical_product_id);
        const alias = String(item.alias ?? "").trim();
        if (!alias) continue;
        const current = aliasMap.get(productId) ?? [];
        if (!current.includes(alias) && current.length < 12) {
          current.push(alias);
          aliasMap.set(productId, current);
        }
      }

      for (const item of facets ?? []) {
        const productId = Number(item.canonical_product_id);
        const facet = String(item.facet_normalized ?? "").trim().toLowerCase();
        if (!facet) continue;
        const current = facetMap.get(productId) ?? [];
        if (!current.includes(facet) && current.length < 6) {
          current.push(facet);
          facetMap.set(productId, current);
        }
      }
    }

    return NextResponse.json({
      rows: rows.map((row) => ({
        ...row,
        product_group: row.group_key ?? row.product_group ?? "uncategorized",
        synonyms: aliasMap.get(row.id) ?? [],
        facets: facetMap.get(row.id) ?? []
      }))
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
