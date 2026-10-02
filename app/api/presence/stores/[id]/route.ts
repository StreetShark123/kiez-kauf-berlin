import { NextRequest, NextResponse } from "next/server";
import { getStorePresence } from "@/lib/presence/server";
import type { Locale } from "@/lib/types";

// What this store most likely carries, with the confidence tier per product type.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const localeParam = request.nextUrl.searchParams.get("locale");
  const locale: Locale = localeParam === "en" || localeParam === "es" ? localeParam : "de";
  const presence = await getStorePresence(id, locale);
  if (!presence) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }
  return NextResponse.json({
    store: {
      id: presence.store.id,
      name: presence.store.name,
      osmCategory: presence.store.osmCategory
    },
    items: presence.items.slice(0, 120).map((item) => ({
      productTypeId: item.typeId,
      name: item.name,
      group: item.group,
      groupName: item.groupName,
      probability: Number(item.estimate.probability.toFixed(3)),
      tier: item.estimate.tier,
      lastEvidenceAt: item.estimate.lastEvidenceAt
    }))
  });
}
