import { NextRequest, NextResponse } from "next/server";
import { ensureAdminAccess } from "@/lib/admin-auth";
import { getEvidenceRepository } from "@/lib/presence/evidence-store";
import { getPresenceStores } from "@/lib/presence/stores";

// Moderation: latest crowd evidence, and flagging (flagged rows stop counting immediately).
export async function GET(request: NextRequest) {
  const denied = ensureAdminAccess(request);
  if (denied) {
    return denied;
  }
  const limit = Math.min(500, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 100) || 100));
  const { source, stores } = await getPresenceStores();
  const names = new Map(stores.map((store) => [store.id, store.name]));
  const rows = await getEvidenceRepository(source).listRecent(limit);
  return NextResponse.json({
    source,
    rows: rows.map((row) => ({
      id: row.id,
      storeId: row.storeId,
      storeName: names.get(row.storeId) ?? null,
      productTypeId: row.productTypeId,
      signal: row.signal,
      source: row.source,
      device: row.deviceHash ? row.deviceHash.slice(0, 8) : null,
      query: row.query,
      flagged: Boolean(row.flagged),
      createdAt: row.createdAt
    }))
  });
}

export async function PATCH(request: NextRequest) {
  const denied = ensureAdminAccess(request);
  if (denied) {
    return denied;
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown; flagged?: unknown } | null;
  if (!body || (typeof body.id !== "string" && typeof body.id !== "number") || typeof body.flagged !== "boolean") {
    return NextResponse.json({ error: "id and flagged (boolean) are required." }, { status: 400 });
  }
  const { source } = await getPresenceStores();
  const ok = await getEvidenceRepository(source).setFlag(String(body.id), body.flagged);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
