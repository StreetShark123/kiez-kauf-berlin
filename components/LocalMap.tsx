"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { SearchResult } from "@/lib/types";

export function LocalMap({
  center,
  results
}: {
  center: { lat: number; lng: number };
  results: SearchResult[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const markerSeed = useMemo(() => results.map((item) => item.offer.id).join(","), [results]);

  useEffect(() => {
    let mounted = true;
    let map: MapLibreMap | null = null;

    async function loadMap() {
      if (!containerRef.current) {
        return;
      }

      const maplibregl = (await import("maplibre-gl")).default;
      if (!mounted) {
        return;
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://demotiles.maplibre.org/style.json",
        center: [center.lng, center.lat],
        zoom: 13
      });
      const mapInstance = map;

      mapInstance.addControl(new maplibregl.NavigationControl(), "top-right");

      new maplibregl.Marker({ color: "#111111" })
        .setLngLat([center.lng, center.lat])
        .setPopup(new maplibregl.Popup().setText("You are here"))
        .addTo(mapInstance);

      results.slice(0, 20).forEach((item) => {
        new maplibregl.Marker({ color: "#777777" })
          .setLngLat([item.store.lng, item.store.lat])
          .setPopup(
            new maplibregl.Popup().setText(
              `${item.store.name} - ${Math.round(item.distanceMeters)}m - ${item.product.normalizedName}`
            )
          )
          .addTo(mapInstance);
      });
    }

    loadMap().catch((error) => {
      console.error("Failed to load map", error);
    });

    return () => {
      mounted = false;
      map?.remove();
    };
  }, [center.lat, center.lng, markerSeed, results]);

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full overflow-hidden rounded-[1.25rem] border-2 border-black bg-white shadow-[6px_6px_0_rgba(15,15,15,0.08)]"
    />
  );
}
