import { NextRequest, NextResponse } from "next/server";
import { estimateRouteDistanceMeters, estimateTravelMinutes } from "@/lib/maps";

type RouteMode = "walk" | "bike";

type RoutePayload = {
  mode: RouteMode;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  durationSeconds: number;
  distanceMeters: number;
  geometry: [number, number][];
  fallback: boolean;
};

const ROUTE_TIMEOUT_MS = 5500;

function parseFinite(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinate(lat: number, lng: number) {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseRouteMode(value: string | null): RouteMode {
  return value === "bike" ? "bike" : "walk";
}

function buildFallbackGeometry(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): [number, number][] {
  const midLat = (origin.lat + destination.lat) / 2;
  const midLng = (origin.lng + destination.lng) / 2;
  const bend = [midLng + (destination.lat - origin.lat) * 0.06, midLat] as [number, number];

  return [
    [origin.lng, origin.lat],
    bend,
    [destination.lng, destination.lat]
  ];
}

function fallbackPayload(args: {
  mode: RouteMode;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  linearDistanceMeters: number;
}): RoutePayload {
  const routeDistanceMeters = estimateRouteDistanceMeters(args.linearDistanceMeters, args.mode);
  const durationMinutes = estimateTravelMinutes(args.linearDistanceMeters, args.mode);
  return {
    mode: args.mode,
    origin: args.origin,
    destination: args.destination,
    durationSeconds: durationMinutes * 60,
    distanceMeters: routeDistanceMeters,
    geometry: buildFallbackGeometry(args.origin, args.destination),
    fallback: true
  };
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);

  const part1 =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const part2 = 2 * Math.atan2(Math.sqrt(part1), Math.sqrt(1 - part1));
  return earthRadius * part2;
}

function candidateRoutingUrls(args: {
  mode: RouteMode;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}): string[] {
  const coords = `${args.origin.lng},${args.origin.lat};${args.destination.lng},${args.destination.lat}`;
  const common = `alternatives=false&steps=false&overview=full&geometries=geojson`;

  if (args.mode === "walk") {
    return [
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?${common}`,
      `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?${common}`
    ];
  }

  return [
    `https://routing.openstreetmap.de/routed-bike/route/v1/bike/${coords}?${common}`,
    `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coords}?${common}`
  ];
}

async function fetchRouteFromProvider(args: {
  mode: RouteMode;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}): Promise<RoutePayload | null> {
  const urls = candidateRoutingUrls(args);

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        next: { revalidate: 0 }
      });
      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as {
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: { coordinates?: [number, number][] };
        }>;
      };

      const route = data.routes?.[0];
      const geometry = route?.geometry?.coordinates;
      const duration = route?.duration;
      const distance = route?.distance;

      if (
        !Array.isArray(geometry) ||
        geometry.length < 2 ||
        typeof duration !== "number" ||
        typeof distance !== "number"
      ) {
        continue;
      }

      return {
        mode: args.mode,
        origin: args.origin,
        destination: args.destination,
        durationSeconds: duration,
        distanceMeters: distance,
        geometry,
        fallback: false
      };
    } catch {
      // Try next provider candidate.
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = parseRouteMode(searchParams.get("mode"));
    const originLat = parseFinite(searchParams.get("originLat"));
    const originLng = parseFinite(searchParams.get("originLng"));
    const destinationLat = parseFinite(searchParams.get("destinationLat"));
    const destinationLng = parseFinite(searchParams.get("destinationLng"));

    if (
      originLat === null ||
      originLng === null ||
      destinationLat === null ||
      destinationLng === null
    ) {
      return NextResponse.json({ error: "Invalid route parameters." }, { status: 400 });
    }

    if (
      !isValidCoordinate(originLat, originLng) ||
      !isValidCoordinate(destinationLat, destinationLng)
    ) {
      return NextResponse.json({ error: "Out-of-range coordinates." }, { status: 400 });
    }

    const origin = { lat: originLat, lng: originLng };
    const destination = { lat: destinationLat, lng: destinationLng };
    const linearDistanceMeters = haversineMeters(originLat, originLng, destinationLat, destinationLng);

    const providerRoute = await fetchRouteFromProvider({ mode, origin, destination });
    if (providerRoute) {
      return NextResponse.json(providerRoute);
    }

    return NextResponse.json(
      fallbackPayload({
        mode,
        origin,
        destination,
        linearDistanceMeters
      })
    );
  } catch (error) {
    console.error("Route API failed", error);
    return NextResponse.json({ error: "Route calculation failed." }, { status: 500 });
  }
}
