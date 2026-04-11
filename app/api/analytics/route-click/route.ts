import { NextResponse } from "next/server";
import { hasSupabase, supabase } from "@/lib/supabase";

type RouteClickPayload = {
  interactionId?: string;
  storeId?: string;
  productId?: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  locale?: string;
};

function getInteractionId(candidate: string | undefined, fallback: string) {
  if (candidate && candidate.trim().length > 0) {
    return candidate;
  }
  return fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RouteClickPayload;
    if (!body.storeId || !body.productId) {
      return NextResponse.json(
        { error: "storeId and productId are required." },
        { status: 400 }
      );
    }

    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${body.storeId}-${body.productId}`;

    const interactionId = getInteractionId(body.interactionId, generated);

    if (hasSupabase && supabase) {
      const { error } = await supabase.from("route_clicks").upsert(
        {
          interaction_id: interactionId,
          store_id: body.storeId,
          product_id: body.productId,
          origin_lat: body.originLat,
          origin_lng: body.originLng,
          destination_lat: body.destinationLat,
          destination_lng: body.destinationLng,
          locale: body.locale ?? "de"
        },
        { onConflict: "interaction_id", ignoreDuplicates: true }
      );

      if (error) {
        throw new Error(error.message);
      }
    }

    return NextResponse.json({ ok: true, interactionId });
  } catch (error) {
    console.error("route-click tracking failed", error);
    return NextResponse.json({ error: "tracking failed" }, { status: 500 });
  }
}
