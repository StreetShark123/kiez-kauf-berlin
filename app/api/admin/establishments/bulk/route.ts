import { NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type ActiveStatus = "active" | "inactive" | "temporarily_closed" | "unknown";

type EstablishmentCategoryRow = {
  id: number;
  app_categories: string[] | null;
};

function parseIds(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set<number>();
  for (const value of input) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    unique.add(Math.trunc(parsed));
  }

  return [...unique].slice(0, 150);
}

function sanitizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const clean = value.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60);
    if (!clean) continue;
    unique.add(clean);
  }

  return [...unique];
}

function parseStatus(value: unknown): ActiveStatus | null {
  if (value === "active" || value === "inactive" || value === "temporarily_closed" || value === "unknown") {
    return value;
  }
  return null;
}

function mergeCategories(existing: string[] | null, additions: string[]) {
  const unique = new Set<string>();
  for (const value of existing ?? []) {
    const clean = value.trim().toLowerCase();
    if (!clean) continue;
    unique.add(clean);
  }
  for (const value of additions) {
    unique.add(value);
  }
  return [...unique];
}

export async function POST(request: Request) {
  const unauthorized = ensureAdminAccess(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as {
      ids?: unknown;
      activeStatus?: unknown;
      appendCategories?: unknown;
      replaceCategories?: unknown;
    };

    const ids = parseIds(body.ids);
    if (ids.length === 0) {
      return NextResponse.json({ error: "No valid establishment ids provided." }, { status: 400 });
    }

    const activeStatus = parseStatus(body.activeStatus);
    const appendCategories = sanitizeCategories(body.appendCategories);
    const replaceCategories = sanitizeCategories(body.replaceCategories);

    const hasCategoryAction = appendCategories.length > 0 || replaceCategories.length > 0;
    const hasStatusAction = Boolean(activeStatus);

    if (!hasCategoryAction && !hasStatusAction) {
      return NextResponse.json({ error: "No editable bulk fields provided." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    if (!hasCategoryAction && activeStatus) {
      const { data, error } = await supabase
        .from("establishments")
        .update({ active_status: activeStatus })
        .in("id", ids)
        .select("id");

      if (error) throw new Error(error.message);

      return NextResponse.json({
        updated_count: (data ?? []).length,
        failed_ids: []
      });
    }

    const { data: rows, error: rowsError } = await supabase
      .from("establishments")
      .select("id, app_categories")
      .in("id", ids);

    if (rowsError) throw new Error(rowsError.message);

    const byId = new Map<number, EstablishmentCategoryRow>();
    for (const row of (rows ?? []) as EstablishmentCategoryRow[]) {
      byId.set(row.id, row);
    }

    const failedIds: number[] = [];
    let updatedCount = 0;

    for (const id of ids) {
      const existing = byId.get(id);
      if (!existing) {
        failedIds.push(id);
        continue;
      }

      const nextCategories =
        replaceCategories.length > 0
          ? replaceCategories
          : appendCategories.length > 0
            ? mergeCategories(existing.app_categories, appendCategories)
            : existing.app_categories ?? [];

      const payload: Record<string, unknown> = {
        app_categories: nextCategories
      };

      if (activeStatus) {
        payload.active_status = activeStatus;
      }

      const { error: updateError } = await supabase
        .from("establishments")
        .update(payload)
        .eq("id", id);

      if (updateError) {
        failedIds.push(id);
      } else {
        updatedCount += 1;
      }
    }

    return NextResponse.json({
      updated_count: updatedCount,
      failed_ids: failedIds
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin bulk update error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
