import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type EstablishmentRow = {
  id: number;
  name: string;
  address: string;
  district: string;
  app_categories: string[] | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  website: string | null;
  phone: string | null;
  updated_at: string;
};

type ProductCountRow = {
  establishment_id: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
};

function parseNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function sanitizeSearchTerm(value: string | null) {
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

    const query = sanitizeSearchTerm(searchParams.get("q"));
    const limit = Math.min(80, Math.max(10, parseNumber(searchParams.get("limit"), 30)));
    const offset = Math.max(0, parseNumber(searchParams.get("offset"), 0));

    let listQuery = supabase
      .from("establishments")
      .select(
        "id, name, address, district, app_categories, active_status, website, phone, updated_at",
        { count: "exact" }
      )
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      const search = `%${query}%`;
      listQuery = listQuery.or(
        `name.ilike.${search},address.ilike.${search},district.ilike.${search},website.ilike.${search}`
      );
    }

    const { data, error, count } = await listQuery;
    if (error) {
      throw new Error(error.message);
    }

    const establishments = (data ?? []) as EstablishmentRow[];
    const ids = establishments.map((item) => item.id);

    const productCounts = new Map<number, number>();
    if (ids.length > 0) {
      const { data: mergedRows, error: mergedError } = await supabase
        .from("establishment_product_merged")
        .select("establishment_id, validation_status")
        .in("establishment_id", ids)
        .neq("validation_status", "rejected");

      if (mergedError) {
        throw new Error(mergedError.message);
      }

      for (const row of (mergedRows ?? []) as ProductCountRow[]) {
        productCounts.set(row.establishment_id, (productCounts.get(row.establishment_id) ?? 0) + 1);
      }
    }

    return NextResponse.json({
      pagination: {
        offset,
        limit,
        total: count ?? 0
      },
      rows: establishments.map((item) => ({
        ...item,
        product_count: productCounts.get(item.id) ?? 0
      }))
    });
  } catch (error) {
    return adminInternalError(error);
  }
}

