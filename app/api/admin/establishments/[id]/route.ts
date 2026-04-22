import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { recordCurationEvent } from "@/lib/admin-curation";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type EstablishmentDetailRow = {
  id: number;
  external_source: string;
  external_id: string;
  name: string;
  address: string;
  district: string;
  lat: number;
  lon: number;
  osm_category: string | null;
  app_categories: string[] | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  description: string | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  updated_at: string;
};

type ProductDetailRow = {
  canonical_product_id: number;
  confidence: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
  why_this_product_matches: string | null;
  primary_source_type: string;
  canonical_products:
    | {
        normalized_name: string;
        display_name_en: string;
        display_name_de: string;
        display_name_es: string;
        group_key?: string | null;
        product_group: string;
      }
    | {
        normalized_name: string;
        display_name_en: string;
        display_name_de: string;
        display_name_es: string;
        group_key?: string | null;
        product_group: string;
      }[]
    | null;
};

type ProductAliasRow = {
  canonical_product_id: number;
  alias: string;
  priority: number | null;
  is_active: boolean | null;
};

type ProductFacetRow = {
  canonical_product_id: number;
  facet_normalized: string;
};

type ProductUseCaseRow = {
  canonical_product_id: number;
  use_case_term: string;
  priority: number | null;
  is_active: boolean | null;
};

function parseEstablishmentId(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function sanitizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const clean = entry.trim().toLowerCase().replace(/\s+/g, "-");
    if (!clean) continue;
    unique.add(clean.slice(0, 60));
  }
  return [...unique];
}

function normalizeCategoryArray(values: string[] | null | undefined): string[] {
  const unique = new Set<string>();
  for (const entry of values ?? []) {
    const clean = String(entry ?? "").trim().toLowerCase();
    if (!clean) continue;
    unique.add(clean);
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function coerceNullableString(input: unknown, maxLength = 300) {
  if (typeof input !== "string") {
    return null;
  }
  const clean = input.trim();
  if (!clean) {
    return null;
  }
  return clean.slice(0, maxLength);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parseEstablishmentId(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();

    const [{ data: establishment, error: establishmentError }, { data: products, error: productsError }] =
      await Promise.all([
        supabase
          .from("establishments")
          .select(
            "id, external_source, external_id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, description, active_status, updated_at"
          )
          .eq("id", establishmentId)
          .single(),
        supabase
          .from("establishment_product_merged")
          .select(
            "canonical_product_id, confidence, validation_status, why_this_product_matches, primary_source_type, canonical_products(normalized_name, display_name_en, display_name_de, display_name_es, group_key, product_group)"
          )
          .eq("establishment_id", establishmentId)
          .neq("validation_status", "rejected")
          .order("confidence", { ascending: false })
          .limit(120)
      ]);

    if (establishmentError) throw new Error(establishmentError.message);
    if (productsError) throw new Error(productsError.message);

    const establishmentRow = establishment as EstablishmentDetailRow | null;
    if (!establishmentRow) {
      return NextResponse.json({ error: "Establishment not found." }, { status: 404 });
    }

    const mappedProducts = ((products ?? []) as ProductDetailRow[]).map((item) => {
      const product = Array.isArray(item.canonical_products)
        ? item.canonical_products[0]
        : item.canonical_products;

      return {
        canonical_product_id: item.canonical_product_id,
        confidence: item.confidence,
        validation_status: item.validation_status,
        why_this_product_matches: item.why_this_product_matches,
        primary_source_type: item.primary_source_type,
        product: product
          ? {
              normalized_name: product.normalized_name,
              display_name_en: product.display_name_en,
              display_name_de: product.display_name_de,
              display_name_es: product.display_name_es,
              product_group: product.group_key ?? product.product_group ?? "uncategorized"
            }
          : null
      };
    });

    const productIds = [...new Set(mappedProducts.map((item) => Number(item.canonical_product_id)).filter(Number.isFinite))];
    const aliasMap = new Map<number, string[]>();
    const facetMap = new Map<number, string[]>();
    const useCaseMap = new Map<number, string[]>();

    if (productIds.length > 0) {
      const [{ data: aliases, error: aliasesError }, { data: facets, error: facetsError }, { data: useCases, error: useCasesError }] =
        await Promise.all([
          supabase
            .from("canonical_product_aliases")
            .select("canonical_product_id, alias, priority, is_active")
            .in("canonical_product_id", productIds)
            .eq("is_active", true)
            .order("priority", { ascending: false })
            .limit(6000),
          supabase
            .from("canonical_product_facets")
            .select("canonical_product_id, facet_normalized")
            .in("canonical_product_id", productIds)
            .limit(4000),
          supabase
            .from("canonical_product_use_cases")
            .select("canonical_product_id, use_case_term, priority, is_active")
            .in("canonical_product_id", productIds)
            .eq("is_active", true)
            .order("priority", { ascending: false })
            .limit(4000)
        ]);

      if (aliasesError) throw new Error(aliasesError.message);
      if (facetsError) throw new Error(facetsError.message);
      if (useCasesError) throw new Error(useCasesError.message);

      for (const row of (aliases ?? []) as ProductAliasRow[]) {
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

      for (const row of (facets ?? []) as ProductFacetRow[]) {
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

      for (const row of (useCases ?? []) as ProductUseCaseRow[]) {
        const id = Number(row.canonical_product_id);
        if (!Number.isFinite(id)) continue;
        const useCase = String(row.use_case_term ?? "").trim();
        if (!useCase) continue;
        const current = useCaseMap.get(id) ?? [];
        if (!current.includes(useCase) && current.length < 5) {
          current.push(useCase);
          useCaseMap.set(id, current);
        }
      }
    }

    return NextResponse.json({
      establishment: establishmentRow,
      products: mappedProducts.map((item) => ({
        ...item,
        product: item.product
          ? {
              ...item.product,
              aliases: aliasMap.get(item.canonical_product_id) ?? [],
              facets: facetMap.get(item.canonical_product_id) ?? [],
              use_cases: useCaseMap.get(item.canonical_product_id) ?? []
            }
          : null
      }))
    });
  } catch (error) {
    return adminInternalError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parseEstablishmentId(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      appCategories?: unknown;
      activeStatus?: unknown;
      website?: unknown;
      phone?: unknown;
      openingHours?: unknown;
      description?: unknown;
      district?: unknown;
    };

    const activeStatus =
      body.activeStatus === "active" ||
      body.activeStatus === "inactive" ||
      body.activeStatus === "temporarily_closed" ||
      body.activeStatus === "unknown"
        ? body.activeStatus
        : null;

    const updatePayload: Record<string, unknown> = {};
    if (body.appCategories !== undefined) {
      updatePayload.app_categories = sanitizeCategories(body.appCategories);
    }
    if (activeStatus) {
      updatePayload.active_status = activeStatus;
    }
    if (body.website !== undefined) {
      updatePayload.website = coerceNullableString(body.website, 220);
    }
    if (body.phone !== undefined) {
      updatePayload.phone = coerceNullableString(body.phone, 100);
    }
    if (body.openingHours !== undefined) {
      updatePayload.opening_hours = coerceNullableString(body.openingHours, 400);
    }
    if (body.description !== undefined) {
      updatePayload.description = coerceNullableString(body.description, 1200);
    }
    if (body.district !== undefined) {
      updatePayload.district = coerceNullableString(body.district, 120);
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: beforeEstablishment, error: beforeError } = await supabase
      .from("establishments")
      .select(
        "id, external_source, external_id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, description, active_status, updated_at"
      )
      .eq("id", establishmentId)
      .single();

    if (beforeError) {
      throw new Error(beforeError.message);
    }

    const { data, error } = await supabase
      .from("establishments")
      .update(updatePayload)
      .eq("id", establishmentId)
      .select(
        "id, external_source, external_id, name, address, district, lat, lon, osm_category, app_categories, website, phone, opening_hours, description, active_status, updated_at"
      )
      .single();

    if (error) throw new Error(error.message);

    const beforeRow = beforeEstablishment as EstablishmentDetailRow;
    const afterRow = data as EstablishmentDetailRow;
    const beforeCategories = normalizeCategoryArray(beforeRow.app_categories);
    const afterCategories = normalizeCategoryArray(afterRow.app_categories);
    const addedCategories = afterCategories.filter((entry) => !beforeCategories.includes(entry));
    const removedCategories = beforeCategories.filter((entry) => !afterCategories.includes(entry));

    await recordCurationEvent(supabase, {
      eventType: "establishment_update",
      entityType: "establishment",
      establishmentId,
      reason: "Manual establishment edit from admin panel.",
      beforeState: {
        district: beforeRow.district,
        app_categories: beforeCategories,
        active_status: beforeRow.active_status,
        website: beforeRow.website,
        phone: beforeRow.phone,
        opening_hours: beforeRow.opening_hours,
        description: beforeRow.description
      },
      afterState: {
        district: afterRow.district,
        app_categories: afterCategories,
        active_status: afterRow.active_status,
        website: afterRow.website,
        phone: afterRow.phone,
        opening_hours: afterRow.opening_hours,
        description: afterRow.description
      },
      metadata: {
        changed_fields: Object.keys(updatePayload)
      }
    });

    if (!arraysEqual(beforeCategories, afterCategories)) {
      await recordCurationEvent(supabase, {
        eventType: "category_set",
        entityType: "establishment",
        establishmentId,
        reason: "Manual category correction from admin panel.",
        beforeState: { app_categories: beforeCategories },
        afterState: { app_categories: afterCategories },
        metadata: {
          added_categories: addedCategories,
          removed_categories: removedCategories
        }
      });
    }

    return NextResponse.json({
      establishment: data
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
