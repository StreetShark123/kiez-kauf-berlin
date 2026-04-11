import { NextRequest, NextResponse } from "next/server";
import { searchOffers } from "@/lib/data";

function parseNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q")?.trim() ?? "";
    if (!q) {
      return NextResponse.json(
        { error: "Query parameter q is required." },
        {
          status: 400
        }
      );
    }

    const lat = parseNumber(searchParams.get("lat"));
    const lng = parseNumber(searchParams.get("lng"));
    const radius = parseNumber(searchParams.get("radius"));

    const results = await searchOffers({
      query: q,
      lat,
      lng,
      radiusMeters: radius
    });

    return NextResponse.json({
      query: q,
      origin: { lat, lng },
      radius: radius ?? 2000,
      results
    });
  } catch (error) {
    console.error("Search API failed", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
