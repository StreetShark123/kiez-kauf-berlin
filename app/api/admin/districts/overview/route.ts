import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type EstablishmentRow = {
  id: number;
  district: string | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  app_categories: string[] | null;
  opening_hours: string | null;
  lat: number | null;
  lon: number | null;
  updated_at: string;
};

type ProductCountRow = {
  establishment_id: number;
};

type DistrictAggregate = {
  district: string;
  establishments_total: number;
  active_total: number;
  temporarily_closed_total: number;
  inactive_total: number;
  unknown_total: number;
  with_products_total: number;
  with_opening_hours_total: number;
  with_geo_total: number;
  recently_updated_7d_total: number;
  top_categories: Array<{ slug: string; count: number }>;
};

function toDistrictLabel(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return "Berlin";
  return clean;
}

function hasGeo(row: EstablishmentRow) {
  return (
    typeof row.lat === "number" &&
    Number.isFinite(row.lat) &&
    typeof row.lon === "number" &&
    Number.isFinite(row.lon)
  );
}

function hasOpeningHours(value: string | null | undefined) {
  return Boolean(String(value ?? "").trim());
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const supabase = getSupabaseAdminClient();

    const [{ data: establishments, error: establishmentsError }, { data: productCounts, error: productCountsError }] =
      await Promise.all([
        supabase
          .from("establishments")
          .select("id, district, active_status, app_categories, opening_hours, lat, lon, updated_at")
          .order("district", { ascending: true })
          .limit(30000),
        supabase
          .from("establishment_product_merged")
          .select("establishment_id")
          .neq("validation_status", "rejected")
          .limit(80000)
      ]);

    if (establishmentsError) throw new Error(establishmentsError.message);
    if (productCountsError) throw new Error(productCountsError.message);

    const establishmentRows = (establishments ?? []) as EstablishmentRow[];
    const mergedRows = (productCounts ?? []) as ProductCountRow[];

    const productCountByEstablishment = new Map<number, number>();
    for (const row of mergedRows) {
      const id = Number(row.establishment_id);
      if (!Number.isFinite(id)) continue;
      productCountByEstablishment.set(id, (productCountByEstablishment.get(id) ?? 0) + 1);
    }

    const now = Date.now();
    const sevenDaysMs = 1000 * 60 * 60 * 24 * 7;
    const districtMap = new Map<string, DistrictAggregate>();
    const categoryCounters = new Map<string, Map<string, number>>();

    for (const row of establishmentRows) {
      const district = toDistrictLabel(row.district);
      const aggregate =
        districtMap.get(district) ??
        ({
          district,
          establishments_total: 0,
          active_total: 0,
          temporarily_closed_total: 0,
          inactive_total: 0,
          unknown_total: 0,
          with_products_total: 0,
          with_opening_hours_total: 0,
          with_geo_total: 0,
          recently_updated_7d_total: 0,
          top_categories: []
        } satisfies DistrictAggregate);

      aggregate.establishments_total += 1;
      if (row.active_status === "active") aggregate.active_total += 1;
      else if (row.active_status === "temporarily_closed") aggregate.temporarily_closed_total += 1;
      else if (row.active_status === "inactive") aggregate.inactive_total += 1;
      else aggregate.unknown_total += 1;

      if ((productCountByEstablishment.get(row.id) ?? 0) > 0) {
        aggregate.with_products_total += 1;
      }
      if (hasOpeningHours(row.opening_hours)) {
        aggregate.with_opening_hours_total += 1;
      }
      if (hasGeo(row)) {
        aggregate.with_geo_total += 1;
      }

      const updatedAtMs = new Date(row.updated_at).getTime();
      if (Number.isFinite(updatedAtMs) && now - updatedAtMs <= sevenDaysMs) {
        aggregate.recently_updated_7d_total += 1;
      }

      const districtCategoryCounter = categoryCounters.get(district) ?? new Map<string, number>();
      for (const category of row.app_categories ?? []) {
        const clean = String(category ?? "").trim().toLowerCase();
        if (!clean) continue;
        districtCategoryCounter.set(clean, (districtCategoryCounter.get(clean) ?? 0) + 1);
      }
      categoryCounters.set(district, districtCategoryCounter);

      districtMap.set(district, aggregate);
    }

    const districts = [...districtMap.values()]
      .map((item) => {
        const topCategories = [...(categoryCounters.get(item.district) ?? new Map()).entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([slug, count]) => ({ slug, count }));
        return {
          ...item,
          top_categories: topCategories
        };
      })
      .sort((a, b) => b.active_total - a.active_total || a.district.localeCompare(b.district));

    return NextResponse.json({
      totals: {
        districts: districts.length,
        establishments: establishmentRows.length,
        active: districts.reduce((acc, item) => acc + item.active_total, 0),
        with_products: districts.reduce((acc, item) => acc + item.with_products_total, 0),
        with_geo: districts.reduce((acc, item) => acc + item.with_geo_total, 0)
      },
      districts
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
