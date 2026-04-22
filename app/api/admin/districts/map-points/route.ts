import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type EstablishmentPointRow = {
  id: number;
  name: string;
  district: string | null;
  lat: number | null;
  lon: number | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  app_categories: string[] | null;
  updated_at: string;
};

type ProductCountRow = {
  establishment_id: number;
};

function parseLimit(value: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2500;
  return Math.max(200, Math.min(8000, Math.trunc(n)));
}

function parseBoolean(value: string | null, fallback = false) {
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function hasGeo(row: EstablishmentPointRow) {
  return (
    typeof row.lat === "number" &&
    Number.isFinite(row.lat) &&
    typeof row.lon === "number" &&
    Number.isFinite(row.lon)
  );
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const district = String(searchParams.get("district") ?? "").trim();
    const category = String(searchParams.get("category") ?? "").trim().toLowerCase();
    const activeOnly = parseBoolean(searchParams.get("activeOnly"), true);
    const limit = parseLimit(searchParams.get("limit"));

    const supabase = getSupabaseAdminClient();

    let query = supabase
      .from("establishments")
      .select("id, name, district, lat, lon, active_status, app_categories, updated_at")
      .not("lat", "is", null)
      .not("lon", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (district) {
      query = query.ilike("district", `%${district}%`);
    }
    if (category) {
      query = query.contains("app_categories", [category]);
    }
    if (activeOnly) {
      query = query.in("active_status", ["active", "temporarily_closed"]);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as EstablishmentPointRow[]).filter(hasGeo);
    const ids = rows.map((row) => row.id);

    const productCountByEstablishment = new Map<number, number>();
    if (ids.length > 0) {
      const { data: mergedRows, error: mergedError } = await supabase
        .from("establishment_product_merged")
        .select("establishment_id")
        .in("establishment_id", ids)
        .neq("validation_status", "rejected")
        .limit(50000);

      if (mergedError) throw new Error(mergedError.message);

      for (const row of (mergedRows ?? []) as ProductCountRow[]) {
        const id = Number(row.establishment_id);
        if (!Number.isFinite(id)) continue;
        productCountByEstablishment.set(id, (productCountByEstablishment.get(id) ?? 0) + 1);
      }
    }

    return NextResponse.json({
      filters: {
        district: district || null,
        category: category || null,
        active_only: activeOnly,
        limit
      },
      total: rows.length,
      points: rows.map((row) => ({
        id: row.id,
        name: row.name,
        district: row.district ?? "Berlin",
        lat: row.lat,
        lon: row.lon,
        active_status: row.active_status,
        app_categories: row.app_categories ?? [],
        product_count: productCountByEstablishment.get(row.id) ?? 0,
        updated_at: row.updated_at
      }))
    });
  } catch (error) {
    return adminInternalError(error);
  }
}

