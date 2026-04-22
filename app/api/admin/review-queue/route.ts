import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SearchRow = {
  search_term: string;
  timestamp: string;
};

type EstablishmentRow = {
  id: number;
  name: string;
  district: string;
  updated_at: string;
  app_categories: string[] | null;
  active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
  opening_hours: string | null;
  website: string | null;
};

type ProductRow = {
  establishment_id: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
};

type ReviewFlag =
  | "missing_categories"
  | "missing_products"
  | "low_validation"
  | "missing_opening_hours"
  | "stale_data";

type ProductStats = {
  total: number;
  validated: number;
};

const REVIEW_WINDOW_DAYS = 30;
const MAX_QUEUE_ITEMS = 160;
const STALE_DAYS = 120;
const ESTABLISHMENTS_SCAN_LIMIT = 8000;

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

function inChunks(values: number[], size: number) {
  const chunks: number[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function flagWeight(flag: ReviewFlag) {
  switch (flag) {
    case "missing_categories":
      return 2;
    case "missing_products":
      return 2;
    case "low_validation":
      return 1;
    case "missing_opening_hours":
      return 1;
    case "stale_data":
      return 1;
    default:
      return 0;
  }
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

    const [{ data: searches, error: searchesError }, { data: establishments, error: establishmentsError }] = await Promise.all([
      supabase
        .from("searches")
        .select("search_term, timestamp")
        .eq("has_results", false)
        .gte("timestamp", since)
        .order("timestamp", { ascending: false })
        .limit(6000),
      supabase
        .from("establishments")
        .select("id, name, district, updated_at, app_categories, active_status, opening_hours, website")
        .order("updated_at", { ascending: true })
        .limit(ESTABLISHMENTS_SCAN_LIMIT)
    ]);

    if (searchesError) throw new Error(searchesError.message);
    if (establishmentsError) throw new Error(establishmentsError.message);

    const unresolvedMap = new Map<string, { term: string; count: number; last_seen_at: string }>();
    for (const row of (searches ?? []) as SearchRow[]) {
      const term = normalizeTerm(row.search_term);
      if (!term) continue;

      const existing = unresolvedMap.get(term);
      if (!existing) {
        unresolvedMap.set(term, {
          term,
          count: 1,
          last_seen_at: row.timestamp
        });
        continue;
      }

      existing.count += 1;
      if (row.timestamp > existing.last_seen_at) {
        existing.last_seen_at = row.timestamp;
      }
    }

    const unresolvedTerms = [...unresolvedMap.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.last_seen_at.localeCompare(a.last_seen_at);
      })
      .slice(0, 35);

    const establishmentRows = (establishments ?? []) as EstablishmentRow[];
    const establishmentIds = establishmentRows.map((row) => row.id);

    const productStats = new Map<number, ProductStats>();
    for (const chunk of inChunks(establishmentIds, 500)) {
      const { data: productRows, error: productError } = await supabase
        .from("establishment_product_merged")
        .select("establishment_id, validation_status")
        .in("establishment_id", chunk)
        .neq("validation_status", "rejected");

      if (productError) throw new Error(productError.message);

      for (const row of (productRows ?? []) as ProductRow[]) {
        const stats = productStats.get(row.establishment_id) ?? { total: 0, validated: 0 };
        stats.total += 1;
        if (row.validation_status === "validated") {
          stats.validated += 1;
        }
        productStats.set(row.establishment_id, stats);
      }
    }

    const flagTotals = new Map<ReviewFlag, number>();
    const queue = establishmentRows
      .map((row) => {
        const stats = productStats.get(row.id) ?? { total: 0, validated: 0 };
        const flags: ReviewFlag[] = [];

        if (!row.app_categories || row.app_categories.length === 0) {
          flags.push("missing_categories");
        }
        if (stats.total === 0) {
          flags.push("missing_products");
        } else if (stats.validated === 0) {
          flags.push("low_validation");
        }
        if (row.active_status === "active" && !row.opening_hours?.trim()) {
          flags.push("missing_opening_hours");
        }

        const updatedAtMs = Date.parse(row.updated_at);
        if (Number.isFinite(updatedAtMs) && updatedAtMs < staleThreshold) {
          flags.push("stale_data");
        }

        for (const flag of flags) {
          flagTotals.set(flag, (flagTotals.get(flag) ?? 0) + 1);
        }

        const score = flags.reduce((sum, flag) => sum + flagWeight(flag), 0);

        return {
          id: row.id,
          name: row.name,
          district: row.district,
          active_status: row.active_status,
          updated_at: row.updated_at,
          app_categories: row.app_categories,
          opening_hours: row.opening_hours,
          website: row.website,
          product_count: stats.total,
          validated_product_count: stats.validated,
          flags,
          score
        };
      })
      .filter((item) => item.flags.length > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.updated_at.localeCompare(b.updated_at);
      })
      .slice(0, MAX_QUEUE_ITEMS);

    return NextResponse.json({
      window_days: REVIEW_WINDOW_DAYS,
      queue_totals: {
        businesses_flagged: queue.length,
        unresolved_terms: unresolvedTerms.length
      },
      unresolved_terms: unresolvedTerms,
      flag_totals: [...flagTotals.entries()]
        .map(([flag, count]) => ({ flag, count }))
        .sort((a, b) => b.count - a.count),
      establishment_queue: queue
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
