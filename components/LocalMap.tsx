"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { SearchResult } from "@/lib/types";

const BASE_BW_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

export function LocalMap({
  center,
  results,
  userMarkerLabel,
  className
}: {
  center: { lat: number; lng: number };
  results: SearchResult[];
  userMarkerLabel: string;
  className?: string;
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
        style: BASE_BW_STYLE,
        center: [center.lng, center.lat],
        zoom: 14
      });
      const mapInstance = map;

      mapInstance.addControl(new maplibregl.NavigationControl(), "top-right");

      new maplibregl.Marker({ color: "#111111" })
        .setLngLat([center.lng, center.lat])
        .setPopup(new maplibregl.Popup().setText(userMarkerLabel))
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
  }, [center.lat, center.lng, markerSeed, results, userMarkerLabel]);

  return (
    <div
      ref={containerRef}
      className={`bw-map w-full overflow-hidden rounded-[0.7rem] bg-white ${
        className ?? "h-[320px]"
      }`}
    />
  );
}
