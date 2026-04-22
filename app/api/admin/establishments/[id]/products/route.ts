import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { recordCurationEvent } from "@/lib/admin-curation";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ExistingMergedRow = {
  id: number;
  confidence: number;
  validation_status: "unvalidated" | "likely" | "validated" | "rejected";
  primary_source_type:
    | "imported"
    | "rules_generated"
    | "ai_generated"
    | "merchant_added"
    | "user_validated"
    | "website_extracted"
    | "validated";
  merged_sources: string[] | null;
  merged_generation_methods: string[] | null;
  merged_candidate_ids: number[] | null;
  why_this_product_matches: string | null;
};

type EstablishmentContextRow = {
  id: number;
  app_categories: string[] | null;
};

type CanonicalProductContextRow = {
  id: number;
  group_key: string | null;
  product_group: string | null;
  normalized_name: string;
};

function parsePositiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.trunc(parsed);
}

function asReason(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.trim();
  if (!clean) {
    return null;
  }
  return clean.slice(0, 400);
}

function asConfidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.92;
  }
  return Math.max(0.4, Math.min(1, parsed));
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

async function loadContext(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  establishmentId: number,
  canonicalProductId: number
) {
  const [{ data: establishment, error: establishmentError }, { data: product, error: productError }] =
    await Promise.all([
      supabase
        .from("establishments")
        .select("id, app_categories")
        .eq("id", establishmentId)
        .single(),
      supabase
        .from("canonical_products")
        .select("id, group_key, product_group, normalized_name")
        .eq("id", canonicalProductId)
        .single()
    ]);

  if (establishmentError || !establishment) {
    throw new Error(establishmentError?.message ?? "Establishment not found.");
  }
  if (productError || !product) {
    throw new Error(productError?.message ?? "Canonical product not found.");
  }

  return {
    establishment: establishment as EstablishmentContextRow,
    product: product as CanonicalProductContextRow
  };
}

async function upsertCandidate(args: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  establishmentId: number;
  canonicalProductId: number;
  sourceType: "merchant_added" | "user_validated";
  generationMethod: "admin_panel_manual" | "admin_panel_review";
  confidence: number;
  validationStatus: "validated" | "rejected";
  reason: string | null;
  action: string;
}) {
  const nowIso = new Date().toISOString();
  const insertPayload = {
    establishment_id: args.establishmentId,
    canonical_product_id: args.canonicalProductId,
    source_type: args.sourceType,
    generation_method: args.generationMethod,
    confidence: args.confidence,
    validation_status: args.validationStatus,
    validation_notes: args.reason,
    why_this_product_matches:
      args.reason ??
      (args.validationStatus === "validated"
        ? "Manually validated in admin panel."
        : "Manually rejected in admin panel."),
    inferred_from: {
      source: "admin_panel",
      action: args.action,
      at: nowIso
    },
    source_url: null,
    extraction_method: args.generationMethod,
    last_checked_at: nowIso,
    freshness_score: Math.min(1, Math.max(0.5, args.confidence))
  };

  const { data, error } = await args.supabase
    .from("establishment_product_candidates")
    .upsert(insertPayload, {
      onConflict: "establishment_id,canonical_product_id,source_type,generation_method"
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to upsert candidate row.");
  }

  return Number(data.id);
}

async function upsertMerged(args: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  establishmentId: number;
  canonicalProductId: number;
  candidateId: number;
  confidence: number;
  validationStatus: "validated" | "rejected";
  sourceType: "merchant_added" | "user_validated";
  generationMethod: "admin_panel_manual" | "admin_panel_review";
  reason: string | null;
  action: string;
}) {
  const { data: existingMerged, error: existingMergedError } = await args.supabase
    .from("establishment_product_merged")
    .select(
      "id, confidence, validation_status, primary_source_type, merged_sources, merged_generation_methods, merged_candidate_ids, why_this_product_matches"
    )
    .eq("establishment_id", args.establishmentId)
    .eq("canonical_product_id", args.canonicalProductId)
    .maybeSingle();

  if (existingMergedError) {
    throw new Error(existingMergedError.message);
  }

  const current = existingMerged as ExistingMergedRow | null;
  const mergedSources = new Set<string>(current?.merged_sources ?? []);
  mergedSources.add(args.sourceType);

  const mergedMethods = new Set<string>(current?.merged_generation_methods ?? []);
  mergedMethods.add(args.generationMethod);

  const mergedCandidateIds = new Set<number>((current?.merged_candidate_ids ?? []).map((value) => Number(value)));
  mergedCandidateIds.add(args.candidateId);

  const nowIso = new Date().toISOString();
  const mergedPayload = {
    establishment_id: args.establishmentId,
    canonical_product_id: args.canonicalProductId,
    primary_source_type: args.sourceType,
    merged_sources: [...mergedSources] as Array<
      | "imported"
      | "rules_generated"
      | "ai_generated"
      | "merchant_added"
      | "user_validated"
      | "website_extracted"
      | "validated"
    >,
    merged_generation_methods: [...mergedMethods],
    merged_candidate_ids: [...mergedCandidateIds],
    confidence:
      args.validationStatus === "validated"
        ? Math.max(current?.confidence ?? 0, args.confidence)
        : Math.max(0.4, Math.min(current?.confidence ?? args.confidence, args.confidence)),
    validation_status: args.validationStatus,
    why_this_product_matches:
      args.reason ??
      current?.why_this_product_matches ??
      (args.validationStatus === "validated"
        ? "Manually validated in admin panel."
        : "Manually rejected in admin panel."),
    inferred_from: {
      source: "admin_panel",
      action: args.action,
      at: nowIso
    },
    extraction_method: args.generationMethod,
    last_checked_at: nowIso,
    freshness_score: Math.min(1, Math.max(0.5, args.confidence))
  };

  const { data: merged, error: mergedError } = await args.supabase
    .from("establishment_product_merged")
    .upsert(mergedPayload, {
      onConflict: "establishment_id,canonical_product_id"
    })
    .select(
      "id, establishment_id, canonical_product_id, confidence, validation_status, primary_source_type, why_this_product_matches, updated_at"
    )
    .single();

  if (mergedError) {
    throw new Error(mergedError.message);
  }

  return merged;
}

async function logProductEvent(args: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  eventType: "product_add" | "product_validate" | "product_reject" | "product_remove";
  establishmentId: number;
  canonicalProductId: number;
  appCategories: string[];
  productGroup: string;
  reason: string | null;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const categories = args.appCategories.length ? args.appCategories : [null];
  for (const category of categories) {
    // eslint-disable-next-line no-await-in-loop
    await recordCurationEvent(args.supabase, {
      eventType: args.eventType,
      entityType: "establishment_product",
      establishmentId: args.establishmentId,
      canonicalProductId: args.canonicalProductId,
      appCategory: category,
      productGroup: args.productGroup,
      reason: args.reason,
      beforeState: args.beforeState,
      afterState: args.afterState,
      metadata: args.metadata
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parsePositiveInt(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      canonicalProductId?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };

    const canonicalProductId = parsePositiveInt(body.canonicalProductId);
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }

    const reason = asReason(body.reason);
    const confidence = asConfidence(body.confidence);
    const supabase = getSupabaseAdminClient();
    const context = await loadContext(supabase, establishmentId, canonicalProductId);
    const productGroup = String(context.product.group_key ?? context.product.product_group ?? "uncategorized")
      .trim()
      .toLowerCase();
    const appCategories = normalizeCategoryArray(context.establishment.app_categories);

    const candidateId = await upsertCandidate({
      supabase,
      establishmentId,
      canonicalProductId,
      sourceType: "merchant_added",
      generationMethod: "admin_panel_manual",
      confidence,
      validationStatus: "validated",
      reason,
      action: "manual_add"
    });

    const merged = await upsertMerged({
      supabase,
      establishmentId,
      canonicalProductId,
      candidateId,
      confidence,
      validationStatus: "validated",
      sourceType: "merchant_added",
      generationMethod: "admin_panel_manual",
      reason,
      action: "manual_add"
    });

    await logProductEvent({
      supabase,
      eventType: "product_add",
      establishmentId,
      canonicalProductId,
      appCategories,
      productGroup,
      reason,
      beforeState: {
        validation_status: "unknown"
      },
      afterState: {
        validation_status: "validated",
        source_type: "merchant_added",
        confidence
      },
      metadata: {
        action: "manual_add",
        normalized_name: context.product.normalized_name
      }
    });

    return NextResponse.json({
      candidate_id: candidateId,
      merged
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
  const establishmentId = parsePositiveInt(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      canonicalProductId?: unknown;
      action?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };

    const canonicalProductId = parsePositiveInt(body.canonicalProductId);
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }

    const action = String(body.action ?? "").trim().toLowerCase();
    if (action !== "validate" && action !== "reject") {
      return NextResponse.json({ error: "action must be validate or reject." }, { status: 400 });
    }

    const reason = asReason(body.reason);
    const confidence = asConfidence(body.confidence);
    const supabase = getSupabaseAdminClient();
    const context = await loadContext(supabase, establishmentId, canonicalProductId);
    const productGroup = String(context.product.group_key ?? context.product.product_group ?? "uncategorized")
      .trim()
      .toLowerCase();
    const appCategories = normalizeCategoryArray(context.establishment.app_categories);
    const validationStatus = action === "validate" ? "validated" : "rejected";

    if (validationStatus === "rejected") {
      const { error: rejectExistingError } = await supabase
        .from("establishment_product_candidates")
        .update({
          validation_status: "rejected",
          validation_notes: reason,
          updated_at: new Date().toISOString()
        })
        .eq("establishment_id", establishmentId)
        .eq("canonical_product_id", canonicalProductId);
      if (rejectExistingError) {
        throw new Error(rejectExistingError.message);
      }
    }

    const candidateId = await upsertCandidate({
      supabase,
      establishmentId,
      canonicalProductId,
      sourceType: "user_validated",
      generationMethod: "admin_panel_review",
      confidence,
      validationStatus,
      reason,
      action: action === "validate" ? "manual_validate" : "manual_reject"
    });

    const merged = await upsertMerged({
      supabase,
      establishmentId,
      canonicalProductId,
      candidateId,
      confidence,
      validationStatus,
      sourceType: "user_validated",
      generationMethod: "admin_panel_review",
      reason,
      action: action === "validate" ? "manual_validate" : "manual_reject"
    });

    await logProductEvent({
      supabase,
      eventType: action === "validate" ? "product_validate" : "product_reject",
      establishmentId,
      canonicalProductId,
      appCategories,
      productGroup,
      reason,
      beforeState: {
        validation_status: "unknown"
      },
      afterState: {
        validation_status: validationStatus,
        source_type: "user_validated",
        confidence
      },
      metadata: {
        action,
        normalized_name: context.product.normalized_name
      }
    });

    return NextResponse.json({
      candidate_id: candidateId,
      merged
    });
  } catch (error) {
    return adminInternalError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  const establishmentId = parsePositiveInt(id);
  if (!establishmentId) {
    return NextResponse.json({ error: "Invalid establishment id." }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      canonicalProductId?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };

    const canonicalProductId = parsePositiveInt(body.canonicalProductId);
    if (!canonicalProductId) {
      return NextResponse.json({ error: "canonicalProductId is required." }, { status: 400 });
    }

    const reason = asReason(body.reason) ?? "Removed manually from admin panel.";
    const confidence = asConfidence(body.confidence);
    const supabase = getSupabaseAdminClient();
    const context = await loadContext(supabase, establishmentId, canonicalProductId);
    const productGroup = String(context.product.group_key ?? context.product.product_group ?? "uncategorized")
      .trim()
      .toLowerCase();
    const appCategories = normalizeCategoryArray(context.establishment.app_categories);

    const { error: rejectExistingError } = await supabase
      .from("establishment_product_candidates")
      .update({
        validation_status: "rejected",
        validation_notes: reason,
        updated_at: new Date().toISOString()
      })
      .eq("establishment_id", establishmentId)
      .eq("canonical_product_id", canonicalProductId);
    if (rejectExistingError) {
      throw new Error(rejectExistingError.message);
    }

    const candidateId = await upsertCandidate({
      supabase,
      establishmentId,
      canonicalProductId,
      sourceType: "user_validated",
      generationMethod: "admin_panel_review",
      confidence,
      validationStatus: "rejected",
      reason,
      action: "manual_remove"
    });

    const merged = await upsertMerged({
      supabase,
      establishmentId,
      canonicalProductId,
      candidateId,
      confidence,
      validationStatus: "rejected",
      sourceType: "user_validated",
      generationMethod: "admin_panel_review",
      reason,
      action: "manual_remove"
    });

    await logProductEvent({
      supabase,
      eventType: "product_remove",
      establishmentId,
      canonicalProductId,
      appCategories,
      productGroup,
      reason,
      beforeState: {
        validation_status: "unknown"
      },
      afterState: {
        validation_status: "rejected",
        source_type: "user_validated",
        confidence
      },
      metadata: {
        action: "remove",
        normalized_name: context.product.normalized_name
      }
    });

    return NextResponse.json({
      candidate_id: candidateId,
      merged
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
