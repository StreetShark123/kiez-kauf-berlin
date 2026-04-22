import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { adminInternalError } from "@/lib/admin-api-error";
import { recordCurationEvent } from "@/lib/admin-curation";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type CurationEventRow = {
  event_type: string;
  app_category: string | null;
  product_group: string | null;
  created_at: string;
};

type SuggestionRow = {
  id: number;
  app_category: string;
  product_group: string;
  window_days: number;
  support_count: number;
  positive_count: number;
  precision_score: number;
  auto_apply_eligible: boolean;
  status: "suggested" | "applied" | "discarded";
  notes: string | null;
  generated_at: string;
  applied_at: string | null;
  updated_at: string;
};

const POSITIVE_EVENTS = new Set(["product_add", "product_validate"]);
const NEGATIVE_EVENTS = new Set(["product_reject", "product_remove"]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asPositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function asPrecision(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function normalizeTag(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function confidenceFromPrecision(precision: number, supportCount: number) {
  const supportBonus = supportCount >= 50 ? 0.04 : supportCount >= 30 ? 0.02 : 0;
  return Number(clamp(precision - 0.03 + supportBonus, 0.55, 0.98).toFixed(4));
}

export async function GET(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("curation_rule_suggestions")
      .select(
        "id, app_category, product_group, window_days, support_count, positive_count, precision_score, auto_apply_eligible, status, notes, generated_at, applied_at, updated_at"
      )
      .order("generated_at", { ascending: false })
      .limit(200);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      rows: (data ?? []) as SuggestionRow[]
    });
  } catch (error) {
    return adminInternalError(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      windowDays?: unknown;
      minSupport?: unknown;
      minPrecision?: unknown;
      minPositive?: unknown;
      maxApply?: unknown;
    };
    const action = String(body.action ?? "").trim().toLowerCase();
    if (action !== "generate" && action !== "apply") {
      return NextResponse.json({ error: "action must be generate or apply." }, { status: 400 });
    }

    const windowDays = asPositiveInt(body.windowDays, 90, 7, 365);
    const minSupport = asPositiveInt(body.minSupport, 20, 3, 2000);
    const minPositive = asPositiveInt(body.minPositive, 10, 1, 2000);
    const minPrecision = asPrecision(body.minPrecision, 0.9, 0.5, 0.99);
    const maxApply = asPositiveInt(body.maxApply, 120, 1, 1000);
    const supabase = getSupabaseAdminClient();

    if (action === "generate") {
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows, error: rowsError } = await supabase
        .from("curation_events")
        .select("event_type, app_category, product_group, created_at")
        .gte("created_at", sinceIso)
        .in("event_type", [...POSITIVE_EVENTS, ...NEGATIVE_EVENTS])
        .order("created_at", { ascending: false })
        .limit(50000);

      if (rowsError) {
        throw new Error(rowsError.message);
      }

      const aggregate = new Map<string, { appCategory: string; productGroup: string; support: number; positive: number }>();
      for (const row of (rows ?? []) as CurationEventRow[]) {
        const appCategory = normalizeTag(row.app_category);
        const productGroup = normalizeTag(row.product_group);
        if (!appCategory || !productGroup) continue;

        const key = `${appCategory}::${productGroup}`;
        const current = aggregate.get(key) ?? { appCategory, productGroup, support: 0, positive: 0 };
        current.support += 1;
        if (POSITIVE_EVENTS.has(row.event_type)) {
          current.positive += 1;
        }
        aggregate.set(key, current);
      }

      const suggestions = [...aggregate.values()]
        .map((entry) => {
          const precision = entry.support > 0 ? Number((entry.positive / entry.support).toFixed(4)) : 0;
          return {
            app_category: entry.appCategory,
            product_group: entry.productGroup,
            support_count: entry.support,
            positive_count: entry.positive,
            precision_score: precision,
            auto_apply_eligible:
              entry.support >= minSupport && entry.positive >= minPositive && precision >= minPrecision
          };
        })
        .filter((entry) => entry.support_count >= 3)
        .sort((a, b) => {
          if (b.precision_score !== a.precision_score) return b.precision_score - a.precision_score;
          return b.support_count - a.support_count;
        })
        .slice(0, 1000);

      const { data: existingRows, error: existingError } = await supabase
        .from("curation_rule_suggestions")
        .select("app_category, product_group, window_days, status")
        .eq("window_days", windowDays)
        .limit(5000);
      if (existingError) {
        throw new Error(existingError.message);
      }

      const existingStatus = new Map<string, "suggested" | "applied" | "discarded">();
      for (const row of (existingRows ?? []) as Array<{ app_category: string; product_group: string; window_days: number; status: "suggested" | "applied" | "discarded" }>) {
        existingStatus.set(`${row.app_category}::${row.product_group}`, row.status);
      }

      const upsertRows = suggestions.map((entry) => {
        const key = `${entry.app_category}::${entry.product_group}`;
        const previousStatus = existingStatus.get(key);
        const status =
          previousStatus === "applied" || previousStatus === "discarded" ? previousStatus : "suggested";
        return {
          app_category: entry.app_category,
          product_group: entry.product_group,
          window_days: windowDays,
          support_count: entry.support_count,
          positive_count: entry.positive_count,
          precision_score: entry.precision_score,
          auto_apply_eligible: status === "suggested" ? entry.auto_apply_eligible : false,
          status,
          generated_at: new Date().toISOString(),
          notes: `Generated from curation_events window=${windowDays}d threshold=${minSupport}/${minPrecision}`
        };
      });

      let affected = 0;
      for (let index = 0; index < upsertRows.length; index += 400) {
        const chunk = upsertRows.slice(index, index + 400);
        if (!chunk.length) continue;
        // eslint-disable-next-line no-await-in-loop
        const { error: upsertError } = await supabase
          .from("curation_rule_suggestions")
          .upsert(chunk, { onConflict: "app_category,product_group,window_days" });
        if (upsertError) {
          throw new Error(upsertError.message);
        }
        affected += chunk.length;
      }

      await recordCurationEvent(supabase, {
        eventType: "rule_suggest",
        entityType: "rule",
        reason: "Generated curation rule suggestions.",
        beforeState: {},
        afterState: {
          window_days: windowDays,
          affected,
          auto_apply_candidates: upsertRows.filter((row) => row.auto_apply_eligible).length
        },
        metadata: {
          min_support: minSupport,
          min_positive: minPositive,
          min_precision: minPrecision
        }
      });

      return NextResponse.json({
        ok: true,
        action,
        window_days: windowDays,
        generated: suggestions.length,
        upserted: affected,
        auto_apply_candidates: upsertRows.filter((row) => row.auto_apply_eligible).length
      });
    }

    const { data: suggestions, error: suggestionsError } = await supabase
      .from("curation_rule_suggestions")
      .select("id, app_category, product_group, support_count, positive_count, precision_score, auto_apply_eligible, status")
      .eq("window_days", windowDays)
      .eq("status", "suggested")
      .eq("auto_apply_eligible", true)
      .order("precision_score", { ascending: false })
      .order("support_count", { ascending: false })
      .limit(maxApply);

    if (suggestionsError) {
      throw new Error(suggestionsError.message);
    }

    const eligible = (suggestions ?? []) as Array<{
      id: number;
      app_category: string;
      product_group: string;
      support_count: number;
      positive_count: number;
      precision_score: number;
      auto_apply_eligible: boolean;
      status: "suggested";
    }>;

    const filtered = eligible.filter(
      (row) =>
        row.support_count >= minSupport &&
        row.positive_count >= minPositive &&
        Number(row.precision_score ?? 0) >= minPrecision
    );

    let applied = 0;
    for (const row of filtered) {
      const baseConfidence = confidenceFromPrecision(Number(row.precision_score ?? 0), Number(row.support_count ?? 0));
      // eslint-disable-next-line no-await-in-loop
      const { error: upsertRuleError } = await supabase.from("app_category_group_rules").upsert(
        {
          app_category: row.app_category,
          product_group: row.product_group,
          base_confidence: baseConfidence,
          reason: `Learned from curated admin actions (${row.positive_count}/${row.support_count}, precision ${row.precision_score}).`,
          source: "curation",
          support_count: row.support_count,
          precision_score: row.precision_score,
          auto_apply_eligible: true,
          is_active: true
        },
        { onConflict: "app_category,product_group" }
      );
      if (upsertRuleError) {
        throw new Error(upsertRuleError.message);
      }

      // eslint-disable-next-line no-await-in-loop
      const { error: markAppliedError } = await supabase
        .from("curation_rule_suggestions")
        .update({
          status: "applied",
          applied_at: new Date().toISOString(),
          notes: `Auto applied with thresholds support>=${minSupport}, precision>=${minPrecision}`
        })
        .eq("id", row.id);
      if (markAppliedError) {
        throw new Error(markAppliedError.message);
      }

      // eslint-disable-next-line no-await-in-loop
      await recordCurationEvent(supabase, {
        eventType: "rule_apply",
        entityType: "rule",
        appCategory: row.app_category,
        productGroup: row.product_group,
        reason: "Auto-applied conservative rule from curated suggestions.",
        beforeState: {
          support_count: row.support_count,
          precision_score: row.precision_score
        },
        afterState: {
          base_confidence: baseConfidence,
          source: "curation"
        },
        metadata: {
          suggestion_id: row.id
        }
      });

      applied += 1;
    }

    return NextResponse.json({
      ok: true,
      action,
      window_days: windowDays,
      evaluated: eligible.length,
      applied
    });
  } catch (error) {
    return adminInternalError(error);
  }
}
