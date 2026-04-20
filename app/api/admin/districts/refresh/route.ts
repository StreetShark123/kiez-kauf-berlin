import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type SourceType =
  | "imported"
  | "rules_generated"
  | "ai_generated"
  | "merchant_added"
  | "user_validated"
  | "website_extracted"
  | "validated";

type ValidationStatus = "unvalidated" | "likely" | "validated" | "rejected";

type EstablishmentRow = {
  id: number;
  district: string | null;
  osm_category: string | null;
  app_categories: string[] | null;
  source_url: string | null;
  freshness_score: number | null;
};

type CanonicalProductRow = {
  id: number;
  group_key: string | null;
  product_group: string | null;
  is_active: boolean | null;
};

type CanonicalFacetRow = {
  canonical_product_id: number;
  facet_normalized: string;
};

type ExistingCandidateRow = {
  establishment_id: number;
  canonical_product_id: number;
  validation_status: ValidationStatus;
};

type CandidateRow = {
  id: number;
  establishment_id: number;
  canonical_product_id: number;
  source_type: SourceType;
  generation_method: string;
  confidence: number;
  validation_status: ValidationStatus;
  why_this_product_matches: string | null;
  category_path: string[] | null;
  inferred_from: Record<string, unknown> | null;
  source_url: string | null;
  extraction_method: string | null;
  last_checked_at: string | null;
  freshness_score: number | null;
};

type MergedRow = {
  establishment_id: number;
  canonical_product_id: number;
  primary_source_type: SourceType;
  merged_sources: SourceType[];
  merged_generation_methods: string[];
  merged_candidate_ids: number[];
  confidence: number;
  validation_status: ValidationStatus;
  why_this_product_matches: string | null;
  category_path: string[] | null;
  inferred_from: Record<string, unknown>;
  source_url: string | null;
  extraction_method: string | null;
  last_checked_at: string | null;
  freshness_score: number | null;
};

const GENERATION_METHOD = "rule_engine_v2_berlin";
const EXTRACTION_METHOD = "rule_engine_mapping_v2";

const CATEGORY_GROUP_RULES: Array<{
  appCategory: string;
  productGroup: string;
  baseConfidence: number;
  reason: string;
}> = [
  { appCategory: "grocery", productGroup: "groceries", baseConfidence: 0.82, reason: "grocery stores usually stock pantry essentials" },
  { appCategory: "grocery", productGroup: "beverages", baseConfidence: 0.79, reason: "grocery stores typically include beverage aisles" },
  { appCategory: "grocery", productGroup: "fresh_produce", baseConfidence: 0.76, reason: "grocery stores often include produce" },
  { appCategory: "grocery", productGroup: "household", baseConfidence: 0.71, reason: "grocery stores often carry household basics" },
  { appCategory: "convenience", productGroup: "beverages", baseConfidence: 0.8, reason: "convenience stores focus on ready-to-buy drinks" },
  { appCategory: "convenience", productGroup: "snacks", baseConfidence: 0.78, reason: "convenience stores are snack-heavy" },
  { appCategory: "convenience", productGroup: "groceries", baseConfidence: 0.65, reason: "convenience stores carry a compact grocery set" },
  { appCategory: "fresh-food", productGroup: "fresh_produce", baseConfidence: 0.84, reason: "fresh food stores strongly map to produce" },
  { appCategory: "fresh-food", productGroup: "groceries", baseConfidence: 0.69, reason: "fresh food stores may carry pantry complement products" },
  { appCategory: "bakery", productGroup: "bakery", baseConfidence: 0.9, reason: "bakery category directly maps to bakery items" },
  { appCategory: "bakery", productGroup: "beverages", baseConfidence: 0.63, reason: "bakeries often sell coffee and drinks" },
  { appCategory: "butcher", productGroup: "meat", baseConfidence: 0.92, reason: "butcher category directly maps to meat products" },
  { appCategory: "butcher", productGroup: "groceries", baseConfidence: 0.57, reason: "butchers may carry supporting groceries" },
  { appCategory: "produce", productGroup: "fresh_produce", baseConfidence: 0.91, reason: "produce category maps to fruits and vegetables" },
  { appCategory: "drinks", productGroup: "beverages", baseConfidence: 0.92, reason: "drink stores map to beverage products" },
  { appCategory: "pharmacy", productGroup: "pharmacy", baseConfidence: 0.93, reason: "pharmacies map to medicine products" },
  { appCategory: "pharmacy", productGroup: "personal_care", baseConfidence: 0.82, reason: "pharmacies stock personal care products" },
  { appCategory: "personal-care", productGroup: "personal_care", baseConfidence: 0.86, reason: "personal care category maps directly" },
  { appCategory: "medical-supplies", productGroup: "pharmacy", baseConfidence: 0.93, reason: "medical supply stores map to pharmacy essentials" },
  { appCategory: "medical-supplies", productGroup: "personal_care", baseConfidence: 0.72, reason: "medical supply stores may include care products" },
  { appCategory: "household", productGroup: "household", baseConfidence: 0.88, reason: "household category maps directly" },
  { appCategory: "hardware", productGroup: "household", baseConfidence: 0.93, reason: "hardware stores map to repair and household products" },
  { appCategory: "bio", productGroup: "groceries", baseConfidence: 0.74, reason: "organic stores stock core groceries" },
  { appCategory: "bio", productGroup: "fresh_produce", baseConfidence: 0.77, reason: "organic stores stock produce" },
  { appCategory: "bio", productGroup: "beverages", baseConfidence: 0.7, reason: "organic stores stock beverages" }
];

const SOURCE_PRIORITY: Record<SourceType, number> = {
  validated: 60,
  user_validated: 50,
  merchant_added: 40,
  website_extracted: 35,
  imported: 30,
  ai_generated: 20,
  rules_generated: 10
};

const VALIDATION_PRIORITY: Record<ValidationStatus, number> = {
  validated: 3,
  likely: 2,
  unvalidated: 1,
  rejected: 0
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function chunkArray<T>(rows: T[], size: number): T[][] {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

function normalizeDistrictInput(value: unknown) {
  return String(value ?? "").trim();
}

function toStatusFromConfidence(confidence: number): ValidationStatus {
  return confidence >= 0.74 ? "likely" : "unvalidated";
}

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      district?: unknown;
      maxProductsPerEstablishment?: unknown;
    };

    const district = normalizeDistrictInput(body.district);
    if (!district) {
      return NextResponse.json({ error: "District is required." }, { status: 400 });
    }

    const maxProductsPerEstablishment = clamp(Number(body.maxProductsPerEstablishment ?? 12), 3, 20);
    const supabase = getSupabaseAdminClient();

    const { data: establishmentsData, error: establishmentsError } = await supabase
      .from("establishments")
      .select("id, district, osm_category, app_categories, source_url, freshness_score")
      .ilike("district", `%${district}%`)
      .in("active_status", ["active", "temporarily_closed"])
      .limit(12000);

    if (establishmentsError) throw new Error(establishmentsError.message);
    const establishments = (establishmentsData ?? []) as EstablishmentRow[];
    if (establishments.length === 0) {
      return NextResponse.json({
        ok: true,
        district,
        message: "No establishments found for district filter.",
        stats: {
          establishments: 0,
          candidates_upserted: 0,
          merged_upserted: 0,
          merged_deleted: 0
        }
      });
    }

    const establishmentIds = establishments.map((row) => row.id);
    const establishmentIdsSet = new Set(establishmentIds);

    const [{ data: productData, error: productError }, { data: facetData, error: facetError }] = await Promise.all([
      supabase
        .from("canonical_products")
        .select("id, group_key, product_group, is_active")
        .eq("is_active", true)
        .limit(8000),
      supabase.from("canonical_product_facets").select("canonical_product_id, facet_normalized").limit(30000)
    ]);

    if (productError) throw new Error(productError.message);
    if (facetError) throw new Error(facetError.message);

    const products = (productData ?? []) as CanonicalProductRow[];
    const facets = (facetData ?? []) as CanonicalFacetRow[];

    const groupToProductIds = new Map<string, Set<number>>();
    for (const product of products) {
      const id = Number(product.id);
      if (!Number.isFinite(id)) continue;
      const group = String(product.group_key ?? product.product_group ?? "").trim().toLowerCase();
      if (!group) continue;
      if (!groupToProductIds.has(group)) groupToProductIds.set(group, new Set());
      groupToProductIds.get(group)?.add(id);
    }
    for (const facet of facets) {
      const productId = Number(facet.canonical_product_id);
      if (!Number.isFinite(productId)) continue;
      const facetKey = String(facet.facet_normalized ?? "").trim().toLowerCase();
      if (!facetKey) continue;
      if (!groupToProductIds.has(facetKey)) groupToProductIds.set(facetKey, new Set());
      groupToProductIds.get(facetKey)?.add(productId);
    }

    const lockedStatuses = new Set<ValidationStatus>(["validated", "rejected"]);
    const existingLocked = new Set<string>();
    for (const chunk of chunkArray(establishmentIds, 350)) {
      const { data, error } = await supabase
        .from("establishment_product_candidates")
        .select("establishment_id, canonical_product_id, validation_status")
        .in("establishment_id", chunk)
        .eq("source_type", "rules_generated")
        .eq("generation_method", GENERATION_METHOD)
        .in("validation_status", ["validated", "rejected"])
        .limit(50000);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as ExistingCandidateRow[]) {
        if (!lockedStatuses.has(row.validation_status)) continue;
        existingLocked.add(`${row.establishment_id}:${row.canonical_product_id}`);
      }
    }

    const generatedByKey = new Map<
      string,
      {
        establishment_id: number;
        canonical_product_id: number;
        confidence: number;
        app_category: string;
        product_group: string;
        reason: string;
        source_url: string | null;
        freshness_score: number;
      }
    >();

    for (const establishment of establishments) {
      const categories = (establishment.app_categories ?? []).map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
      const osmCategory = String(establishment.osm_category ?? "").trim().toLowerCase();
      if (categories.length === 0) continue;

      for (const category of categories) {
        const applicableRules = CATEGORY_GROUP_RULES.filter((rule) => rule.appCategory === category);
        for (const rule of applicableRules) {
          const productIds = groupToProductIds.get(rule.productGroup);
          if (!productIds || productIds.size === 0) continue;

          const boostedConfidence =
            rule.baseConfidence + (osmCategory === "supermarket" || osmCategory === "pharmacy" ? 0.04 : 0);
          const confidence = Number(clamp(boostedConfidence, 0.3, 0.99).toFixed(4));

          for (const canonicalProductId of productIds) {
            const key = `${establishment.id}:${canonicalProductId}`;
            if (existingLocked.has(key)) continue;

            const current = generatedByKey.get(key);
            if (!current || confidence > current.confidence) {
              generatedByKey.set(key, {
                establishment_id: establishment.id,
                canonical_product_id: canonicalProductId,
                confidence,
                app_category: category,
                product_group: rule.productGroup,
                reason: rule.reason,
                source_url: establishment.source_url ?? null,
                freshness_score: Number(clamp(establishment.freshness_score ?? 0.7, 0, 1).toFixed(4))
              });
            }
          }
        }
      }
    }

    const candidateUpserts = [...generatedByKey.values()].map((row) => ({
      establishment_id: row.establishment_id,
      canonical_product_id: row.canonical_product_id,
      source_type: "rules_generated" as SourceType,
      generation_method: GENERATION_METHOD,
      confidence: row.confidence,
      validation_status: toStatusFromConfidence(row.confidence),
      validation_notes: null,
      why_this_product_matches: `Rule mapped app category "${row.app_category}" to product group "${row.product_group}".`,
      category_path: ["rules", row.app_category, row.product_group],
      inferred_from: {
        engine: "admin_district_refresh_v1",
        app_category: row.app_category,
        product_group: row.product_group,
        rule_reason: row.reason
      },
      source_url: row.source_url,
      extraction_method: EXTRACTION_METHOD,
      last_checked_at: new Date().toISOString(),
      freshness_score: row.freshness_score
    }));

    let candidateUpserted = 0;
    for (const chunk of chunkArray(candidateUpserts, 900)) {
      if (chunk.length === 0) continue;
      const { error } = await supabase
        .from("establishment_product_candidates")
        .upsert(chunk, {
          onConflict: "establishment_id,canonical_product_id,source_type,generation_method"
        });
      if (error) throw new Error(error.message);
      candidateUpserted += chunk.length;
    }

    const candidateRows: CandidateRow[] = [];
    for (const chunk of chunkArray(establishmentIds, 280)) {
      const { data, error } = await supabase
        .from("establishment_product_candidates")
        .select(
          "id, establishment_id, canonical_product_id, source_type, generation_method, confidence, validation_status, why_this_product_matches, category_path, inferred_from, source_url, extraction_method, last_checked_at, freshness_score"
        )
        .in("establishment_id", chunk)
        .neq("validation_status", "rejected")
        .limit(80000);
      if (error) throw new Error(error.message);
      candidateRows.push(...((data ?? []) as CandidateRow[]));
    }

    const byPair = new Map<string, CandidateRow[]>();
    for (const row of candidateRows) {
      if (!establishmentIdsSet.has(row.establishment_id)) continue;
      const key = `${row.establishment_id}:${row.canonical_product_id}`;
      const bucket = byPair.get(key) ?? [];
      bucket.push(row);
      byPair.set(key, bucket);
    }

    const mergedRows: MergedRow[] = [];
    for (const [key, rows] of byPair.entries()) {
      if (rows.length === 0) continue;
      const [establishmentIdRaw, canonicalProductIdRaw] = key.split(":");
      const establishment_id = Number(establishmentIdRaw);
      const canonical_product_id = Number(canonicalProductIdRaw);
      if (!Number.isFinite(establishment_id) || !Number.isFinite(canonical_product_id)) continue;

      const sortedByPriority = [...rows].sort((a, b) => {
        const aScore = (SOURCE_PRIORITY[a.source_type] ?? 0) * 10000 + Math.round((a.confidence ?? 0) * 1000);
        const bScore = (SOURCE_PRIORITY[b.source_type] ?? 0) * 10000 + Math.round((b.confidence ?? 0) * 1000);
        if (bScore !== aScore) return bScore - aScore;
        return a.id - b.id;
      });

      const sortedByConfidence = [...rows].sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.id - b.id;
      });

      const validationFlags = new Set(rows.map((row) => row.validation_status));
      let mergedValidation: ValidationStatus = "unvalidated";
      if (validationFlags.has("validated")) mergedValidation = "validated";
      else if (validationFlags.has("likely")) mergedValidation = "likely";
      else if (validationFlags.has("unvalidated")) mergedValidation = "unvalidated";
      else mergedValidation = "rejected";

      const maxConfidence = Math.max(...rows.map((row) => Number(row.confidence ?? 0)));
      const mergedConfidence = Number(
        clamp(
          maxConfidence + (validationFlags.has("validated") ? 0.03 : validationFlags.has("likely") ? 0.01 : 0),
          0,
          0.99
        ).toFixed(4)
      );

      const representative = sortedByConfidence[0];
      const primary = sortedByPriority[0];
      const mergedSources = Array.from(new Set(rows.map((row) => row.source_type)));
      const mergedMethods = Array.from(new Set(rows.map((row) => row.generation_method)));
      const mergedCandidateIds = sortedByConfidence.map((row) => row.id);

      const latestCheckedAt = rows
        .map((row) => row.last_checked_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

      const freshnessScore = rows.reduce((max, row) => Math.max(max, Number(row.freshness_score ?? 0)), 0);

      mergedRows.push({
        establishment_id,
        canonical_product_id,
        primary_source_type: primary.source_type,
        merged_sources: mergedSources,
        merged_generation_methods: mergedMethods,
        merged_candidate_ids: mergedCandidateIds,
        confidence: mergedConfidence,
        validation_status: mergedValidation,
        why_this_product_matches: representative.why_this_product_matches ?? null,
        category_path: representative.category_path ?? null,
        inferred_from: {
          merged_candidate_count: rows.length,
          has_validated: validationFlags.has("validated"),
          has_likely: validationFlags.has("likely"),
          has_unvalidated: validationFlags.has("unvalidated"),
          has_rejected: validationFlags.has("rejected")
        },
        source_url: primary.source_url ?? null,
        extraction_method: primary.extraction_method ?? null,
        last_checked_at: latestCheckedAt,
        freshness_score: Number(clamp(freshnessScore, 0, 1).toFixed(4))
      });
    }

    const byEstablishment = new Map<number, MergedRow[]>();
    for (const row of mergedRows) {
      const bucket = byEstablishment.get(row.establishment_id) ?? [];
      bucket.push(row);
      byEstablishment.set(row.establishment_id, bucket);
    }

    const trimmedRows: MergedRow[] = [];
    for (const [establishmentId, rows] of byEstablishment.entries()) {
      const sorted = [...rows].sort((a, b) => {
        const validationDiff = (VALIDATION_PRIORITY[b.validation_status] ?? 0) - (VALIDATION_PRIORITY[a.validation_status] ?? 0);
        if (validationDiff !== 0) return validationDiff;
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        const sourceDiff = (SOURCE_PRIORITY[b.primary_source_type] ?? 0) - (SOURCE_PRIORITY[a.primary_source_type] ?? 0);
        if (sourceDiff !== 0) return sourceDiff;
        return a.canonical_product_id - b.canonical_product_id;
      });
      trimmedRows.push(...sorted.slice(0, maxProductsPerEstablishment).map((row) => ({ ...row, establishment_id: establishmentId })));
    }

    const validatedMergedKeys = new Set<string>();
    for (const chunk of chunkArray(establishmentIds, 350)) {
      const { data, error } = await supabase
        .from("establishment_product_merged")
        .select("establishment_id, canonical_product_id, validation_status")
        .in("establishment_id", chunk)
        .eq("validation_status", "validated")
        .limit(25000);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Array<{ establishment_id: number; canonical_product_id: number }>) {
        validatedMergedKeys.add(`${row.establishment_id}:${row.canonical_product_id}`);
      }
    }

    let mergedDeleted = 0;
    for (const chunk of chunkArray(establishmentIds, 350)) {
      const { data, error } = await supabase
        .from("establishment_product_merged")
        .delete()
        .in("establishment_id", chunk)
        .neq("validation_status", "validated")
        .select("establishment_id");
      if (error) throw new Error(error.message);
      mergedDeleted += (data ?? []).length;
    }

    const mergedUpsertRows = trimmedRows
      .filter((row) => {
        const key = `${row.establishment_id}:${row.canonical_product_id}`;
        if (!validatedMergedKeys.has(key)) return true;
        return row.validation_status === "validated";
      })
      .map((row) => ({
        ...row,
        updated_at: new Date().toISOString()
      }));

    let mergedUpserted = 0;
    for (const chunk of chunkArray(mergedUpsertRows, 600)) {
      if (chunk.length === 0) continue;
      const { error } = await supabase
        .from("establishment_product_merged")
        .upsert(chunk, { onConflict: "establishment_id,canonical_product_id" });
      if (error) throw new Error(error.message);
      mergedUpserted += chunk.length;
    }

    const { error: refreshError } = await supabase.rpc("refresh_search_product_establishment_mv");
    if (refreshError) throw new Error(refreshError.message);

    return NextResponse.json({
      ok: true,
      district,
      refreshed_at: new Date().toISOString(),
      stats: {
        establishments: establishments.length,
        candidates_upserted: candidateUpserted,
        merged_upserted: mergedUpserted,
        merged_deleted: mergedDeleted
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected district refresh error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
