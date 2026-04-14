import { NextRequest, NextResponse } from "next/server";
import { getBerlinCenter, searchOffersDetailed } from "@/lib/data";

const DEFAULT_RADIUS_METERS = 2000;
const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 15000;
const SEARCH_TIMEOUT_MS = 10000;

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

    const rawLat = searchParams.get("lat");
    const rawLng = searchParams.get("lng");
    const rawRadius = searchParams.get("radius");

    const parsedLat = parseNumber(rawLat);
    const parsedLng = parseNumber(rawLng);
    const parsedRadius = parseNumber(rawRadius);

    if (rawLat !== null && parsedLat === null) {
      return NextResponse.json({ error: "Invalid lat parameter." }, { status: 400 });
    }
    if (rawLng !== null && parsedLng === null) {
      return NextResponse.json({ error: "Invalid lng parameter." }, { status: 400 });
    }
    if (rawRadius !== null && parsedRadius === null) {
      return NextResponse.json({ error: "Invalid radius parameter." }, { status: 400 });
    }

    const berlinCenter = getBerlinCenter();
    const lat = clamp(parsedLat ?? berlinCenter.lat, -90, 90);
    const lng = clamp(parsedLng ?? berlinCenter.lng, -180, 180);
    const radius = Math.round(
      clamp(parsedRadius ?? DEFAULT_RADIUS_METERS, MIN_RADIUS_METERS, MAX_RADIUS_METERS)
    );

    const fallbackRequested = searchParams.get("fallback") === "1";
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("SEARCH_TIMEOUT"));
      }, SEARCH_TIMEOUT_MS);
    });

    const searchPromise = searchOffersDetailed({
      query: q,
      lat,
      lng,
      radiusMeters: radius
    });

    let searchResponse: Awaited<ReturnType<typeof searchOffersDetailed>>;
    try {
      searchResponse = await Promise.race([searchPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    const { results, backendSource } = searchResponse;

    return NextResponse.json({
      query: q,
      origin: { lat, lng },
      radius,
      results,
      endpoint: `${fallbackRequested ? "search_api_fallback" : "search_api_primary"}:${backendSource}`
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SEARCH_TIMEOUT") {
      return NextResponse.json({ error: "Search timed out." }, { status: 504 });
    }
    console.error("Search API failed", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
