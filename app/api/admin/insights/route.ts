import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SearchRow = {
  search_term: string;
  category: string | null;
  district: string | null;
  radius_km: number | null;
  results_count: number | null;
  has_results: boolean | null;
  endpoint: string | null;
  timestamp: string;
};

type EstablishmentMetaRow = {
  id: number;
  name: string;
  district: string | null;
  app_categories: string[] | null;
  osm_category: string | null;
};

type CanonicalGroupRow = {
  id: number;
  group_key: string | null;
  product_group: string | null;
};

type MergedRow = {
  establishment_id: number;
  canonical_product_id: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
  confidence: number | null;
  primary_source_type: string | null;
};

type RuleSuggestionRow = {
  id: number;
  app_category: string;
  product_group: string;
  support_count: number;
  positive_count: number;
  precision_score: number;
  auto_apply_eligible: boolean;
  status: "suggested" | "applied" | "discarded";
  generated_at: string;
};

const GROUP_EXPECTED_APP_CATEGORIES: Record<string, string[]> = {
  groceries: ["grocery", "convenience", "bio", "fresh-food", "produce", "bakery", "butcher"],
  fresh_produce: ["produce", "fresh-food", "grocery", "bio"],
  beverages: ["drinks", "grocery", "convenience", "bio", "bakery"],
  household: ["household", "hardware", "grocery", "convenience"],
  pharmacy: ["pharmacy", "medical-supplies"],
  personal_care: ["personal-care", "pharmacy", "medical-supplies", "beauty"],
  bakery: ["bakery", "grocery", "convenience"],
  meat: ["butcher", "grocery", "fresh-food"],
  snacks: ["convenience", "grocery", "bakery", "drinks"],
  pet_care: ["pet", "grocery", "convenience"]
};

const GROUP_EXPECTED_OSM_CATEGORIES: Record<string, string[]> = {
  groceries: ["supermarket", "convenience", "deli", "kiosk", "department_store", "mall", "health_food"],
  fresh_produce: ["supermarket", "greengrocer", "convenience", "health_food", "deli", "marketplace"],
  beverages: ["supermarket", "convenience", "beverages", "kiosk", "department_store", "deli"],
  household: ["doityourself", "hardware", "department_store", "supermarket", "mall", "convenience"],
  pharmacy: ["pharmacy", "chemist", "medical_supply", "department_store", "mall"],
  personal_care: ["pharmacy", "chemist", "medical_supply", "beauty", "cosmetics", "department_store", "mall"],
  bakery: ["bakery", "supermarket", "convenience", "department_store"],
  meat: ["butcher", "supermarket", "deli", "department_store"],
  snacks: ["supermarket", "convenience", "kiosk", "beverages", "department_store", "deli"],
  pet_care: ["pet", "supermarket", "department_store", "mall", "convenience"]
};

function normalizeTerm(value: string) {
  return value.trim().toLowerCase();
}

function normalizeTag(value: string) {
  return value.trim().toLowerCase();
}

function toDayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();

    const [
      { data: searches, error: searchesError },
      { count: establishmentCount, error: establishmentError },
      { data: establishmentsMeta, error: establishmentsMetaError },
      { data: canonicalGroups, error: canonicalGroupsError },
      { data: ruleSuggestions, error: ruleSuggestionsError },
      { count: canonicalCount, error: canonicalError }
    ] =
      await Promise.all([
        supabase
          .from("searches")
          .select("search_term, category, district, radius_km, results_count, has_results, endpoint, timestamp")
          .gte("timestamp", since)
          .order("timestamp", { ascending: false })
          .limit(5000),
        supabase.from("establishments").select("id", { count: "exact", head: true }),
        supabase
          .from("establishments")
          .select("id, name, district, app_categories, osm_category")
          .in("active_status", ["active", "temporarily_closed"])
          .limit(12000),
        supabase.from("canonical_products").select("id, group_key, product_group").eq("is_active", true).limit(5000),
        supabase
          .from("curation_rule_suggestions")
          .select(
            "id, app_category, product_group, support_count, positive_count, precision_score, auto_apply_eligible, status, generated_at"
          )
          .order("generated_at", { ascending: false })
          .limit(120),
        supabase.from("canonical_products").select("id", { count: "exact", head: true })
      ]);

    if (searchesError) {
      throw new Error(searchesError.message);
    }
    if (establishmentError) {
      throw new Error(establishmentError.message);
    }
    if (establishmentsMetaError) {
      throw new Error(establishmentsMetaError.message);
    }
    if (canonicalGroupsError) {
      throw new Error(canonicalGroupsError.message);
    }
    if (ruleSuggestionsError) {
      throw new Error(ruleSuggestionsError.message);
    }
    if (canonicalError) {
      throw new Error(canonicalError.message);
    }

    const rows = (searches ?? []) as SearchRow[];
    const establishmentRows = (establishmentsMeta ?? []) as EstablishmentMetaRow[];
    const productRows = (canonicalGroups ?? []) as CanonicalGroupRow[];
    const suggestionRows = (ruleSuggestions ?? []) as RuleSuggestionRow[];

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let totalResults = 0;

    const topTermsMap = new Map<string, { term: string; total: number; unresolved: number }>();
    const unresolvedRecent: SearchRow[] = [];
    const noResultByDay = new Map<string, number>();
    const endpointStats = new Map<string, number>();

    for (const row of rows) {
      const term = normalizeTerm(row.search_term);
      if (!term) {
        continue;
      }

      const hasResults = Boolean(row.has_results);
      const resultCount = Number.isFinite(row.results_count ?? null) ? Number(row.results_count ?? 0) : 0;
      if (hasResults) {
        resolvedCount += 1;
      } else {
        unresolvedCount += 1;
        unresolvedRecent.push(row);
        const day = toDayKey(row.timestamp);
        noResultByDay.set(day, (noResultByDay.get(day) ?? 0) + 1);
      }
      totalResults += Math.max(resultCount, 0);

      const existing = topTermsMap.get(term) ?? { term, total: 0, unresolved: 0 };
      existing.total += 1;
      if (!hasResults) {
        existing.unresolved += 1;
      }
      topTermsMap.set(term, existing);

      const endpoint = row.endpoint?.trim() || "unknown";
      endpointStats.set(endpoint, (endpointStats.get(endpoint) ?? 0) + 1);
    }

    const topTerms = [...topTermsMap.values()]
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return b.unresolved - a.unresolved;
      })
      .slice(0, 20);

    const unresolvedGrouped = [...topTermsMap.values()]
      .filter((entry) => entry.unresolved > 0)
      .sort((a, b) => b.unresolved - a.unresolved)
      .slice(0, 20);

    const noResultTrend = [...noResultByDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14);

    const recentUnresolved = unresolvedRecent
      .slice(0, 30)
      .map((item) => ({
        search_term: item.search_term,
        category: item.category,
        district: item.district,
        radius_km: item.radius_km,
        results_count: item.results_count,
        timestamp: item.timestamp
      }));

    const totalSearches = rows.length;
    const avgResultsPerSearch = totalSearches > 0 ? Number((totalResults / totalSearches).toFixed(2)) : 0;
    const establishmentById = new Map<number, EstablishmentMetaRow>();
    for (const row of establishmentRows) {
      establishmentById.set(Number(row.id), row);
    }

    const canonicalGroupById = new Map<number, string>();
    for (const row of productRows) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      const group = normalizeTag(String(row.group_key ?? row.product_group ?? ""));
      if (!group) continue;
      canonicalGroupById.set(id, group);
    }

    const categoryStats = new Map<
      string,
      { total: number; suspicious: number; validated: number; high_confidence_suspicious: number }
    >();
    const suspiciousExamples: Array<{
      establishment_id: number;
      establishment_name: string;
      district: string;
      product_group: string;
      confidence: number;
      validation_status: string;
      source_type: string | null;
      osm_category: string | null;
      app_categories: string[];
    }> = [];

    const establishmentIds = establishmentRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const chunkSize = 500;

    for (let index = 0; index < establishmentIds.length; index += chunkSize) {
      const chunk = establishmentIds.slice(index, index + chunkSize);
      // eslint-disable-next-line no-await-in-loop
      const { data: mergedRows, error: mergedError } = await supabase
        .from("establishment_product_merged")
        .select("establishment_id, canonical_product_id, validation_status, confidence, primary_source_type")
        .in("establishment_id", chunk)
        .neq("validation_status", "rejected")
        .limit(20000);

      if (mergedError) {
        throw new Error(mergedError.message);
      }

      for (const merged of (mergedRows ?? []) as MergedRow[]) {
        const establishment = establishmentById.get(Number(merged.establishment_id));
        if (!establishment) continue;
        const group = canonicalGroupById.get(Number(merged.canonical_product_id));
        if (!group) continue;

        const appCategories = Array.isArray(establishment.app_categories)
          ? establishment.app_categories.map((value) => normalizeTag(String(value ?? ""))).filter(Boolean)
          : [];
        const osmCategory = normalizeTag(String(establishment.osm_category ?? ""));
        const expectedApp = GROUP_EXPECTED_APP_CATEGORIES[group] ?? [];
        const expectedOsm = GROUP_EXPECTED_OSM_CATEGORIES[group] ?? [];
        const hasAppFit = appCategories.some((category) => expectedApp.includes(category));
        const hasOsmFit = osmCategory.length > 0 && expectedOsm.includes(osmCategory);
        const categoryFit = hasAppFit || hasOsmFit;
        const confidence = Number.isFinite(merged.confidence ?? null) ? Number(merged.confidence ?? 0) : 0;

        const stats = categoryStats.get(group) ?? {
          total: 0,
          suspicious: 0,
          validated: 0,
          high_confidence_suspicious: 0
        };
        stats.total += 1;
        if (merged.validation_status === "validated") {
          stats.validated += 1;
        }

        const suspicious =
          !categoryFit &&
          merged.validation_status !== "validated" &&
          !(merged.primary_source_type === "merchant_added" || merged.primary_source_type === "user_validated");

        if (suspicious) {
          stats.suspicious += 1;
          if (confidence >= 0.82) {
            stats.high_confidence_suspicious += 1;
          }
          if (suspiciousExamples.length < 250) {
            suspiciousExamples.push({
              establishment_id: Number(merged.establishment_id),
              establishment_name: establishment.name,
              district: establishment.district ?? "Berlin",
              product_group: group,
              confidence,
              validation_status: merged.validation_status,
              source_type: merged.primary_source_type,
              osm_category: establishment.osm_category,
              app_categories: appCategories
            });
          }
        }

        categoryStats.set(group, stats);
      }
    }

    const categoryQuality = [...categoryStats.entries()]
      .map(([group, stats]) => ({
        group,
        total: stats.total,
        suspicious: stats.suspicious,
        validated: stats.validated,
        high_confidence_suspicious: stats.high_confidence_suspicious,
        suspicious_rate: stats.total > 0 ? Number((stats.suspicious / stats.total).toFixed(4)) : 0
      }))
      .filter((row) => row.total >= 20)
      .sort((a, b) => {
        if (b.suspicious_rate !== a.suspicious_rate) return b.suspicious_rate - a.suspicious_rate;
        return b.suspicious - a.suspicious;
      });

    const suspiciousTotal = categoryQuality.reduce((sum, row) => sum + row.suspicious, 0);
    const consideredTotal = categoryQuality.reduce((sum, row) => sum + row.total, 0);
    const suspiciousRate = consideredTotal > 0 ? Number((suspiciousTotal / consideredTotal).toFixed(4)) : 0;
    const autoApplyPending = suggestionRows.filter(
      (row) => row.status === "suggested" && row.auto_apply_eligible
    ).length;

    return NextResponse.json({
      window_days: 30,
      totals: {
        searches: totalSearches,
        resolved: resolvedCount,
        unresolved: unresolvedCount,
        unresolved_rate: totalSearches > 0 ? Number((unresolvedCount / totalSearches).toFixed(4)) : 0,
        avg_results_per_search: avgResultsPerSearch,
        establishments_total: establishmentCount ?? 0,
        canonical_products_total: canonicalCount ?? 0,
        suspected_false_positives: suspiciousTotal,
        suspected_false_positive_rate: suspiciousRate,
        rule_suggestions_pending_auto_apply: autoApplyPending
      },
      top_terms: topTerms,
      unresolved_terms: unresolvedGrouped,
      unresolved_recent: recentUnresolved,
      unresolved_trend_14d: noResultTrend,
      endpoint_usage: [...endpointStats.entries()]
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count),
      category_quality: categoryQuality,
      suspicious_examples: suspiciousExamples
        .sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return a.establishment_name.localeCompare(b.establishment_name);
        })
        .slice(0, 25),
      rule_suggestions: suggestionRows.slice(0, 30)
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
