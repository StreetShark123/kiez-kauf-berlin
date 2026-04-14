import { NextResponse } from "next/server";
import { hasSupabase, supabase } from "@/lib/supabase";

type SearchAnalyticsPayload = {
  searchTerm?: string;
  category?: string | null;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  resultsCount?: number;
  hasResults?: boolean;
  endpoint?: string;
};

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const DISTRICT_LOOKUP = [
  "Mitte",
  "Friedrichshain-Kreuzberg",
  "Pankow",
  "Charlottenburg-Wilmersdorf",
  "Spandau",
  "Steglitz-Zehlendorf",
  "Tempelhof-Schoneberg",
  "Neukolln",
  "Treptow-Kopenick",
  "Marzahn-Hellersdorf",
  "Lichtenberg",
  "Reinickendorf"
] as const;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeDistrictName(value: string) {
  const normalized = normalizeText(value).replace(/ß/g, "ss");
  const match = DISTRICT_LOOKUP.find((district) => normalized.includes(normalizeText(district)));
  return match ?? null;
}

async function reverseGeocodeDistrict(lat: number, lng: number): Promise<string | null> {
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), 2500);

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lng),
      zoom: "12",
      addressdetails: "1"
    });

    const response = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      signal: timeoutController.signal,
      headers: {
        "User-Agent": "KiezKaufBerlin/0.1 (search analytics)",
        "Accept-Language": "en,de"
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      address?: {
        borough?: string;
        city_district?: string;
        suburb?: string;
        neighbourhood?: string;
        quarter?: string;
      };
    };

    const address = data.address;
    if (!address) {
      return null;
    }

    const candidates = [
      address.borough,
      address.city_district,
      address.suburb,
      address.quarter,
      address.neighbourhood
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const candidate of candidates) {
      const district = normalizeDistrictName(candidate);
      if (district) {
        return district;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SearchAnalyticsPayload;
    const searchTerm = body.searchTerm?.trim() ?? "";

    if (!searchTerm) {
      return NextResponse.json({ error: "searchTerm is required." }, { status: 400 });
    }

    const lat = isFiniteCoordinate(body.lat) ? body.lat : null;
    const lng = isFiniteCoordinate(body.lng) ? body.lng : null;
    const radiusKm = typeof body.radiusKm === "number" && Number.isFinite(body.radiusKm) ? body.radiusKm : null;
    const resultsCount =
      typeof body.resultsCount === "number" && Number.isFinite(body.resultsCount)
        ? Math.trunc(body.resultsCount)
        : 0;
    const hasResults =
      typeof body.hasResults === "boolean"
        ? body.hasResults
        : resultsCount > 0;

    const district = lat !== null && lng !== null ? await reverseGeocodeDistrict(lat, lng) : null;

    if (hasSupabase && supabase) {
      const { error } = await supabase.from("searches").insert({
        search_term: searchTerm,
        category: body.category?.trim() || null,
        district,
        radius_km: radiusKm,
        results_count: resultsCount,
        has_results: hasResults,
        endpoint: body.endpoint?.trim() || null
      });

      if (error) {
        throw new Error(error.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("search analytics tracking failed", error);
    return NextResponse.json({ error: "tracking failed" }, { status: 500 });
  }
}
