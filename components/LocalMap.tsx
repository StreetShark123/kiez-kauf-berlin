"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";
import type { LngLatBoundsLike, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
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

const MAX_PIN_RESULTS = 120;

function triggerHaptic(pattern: number | number[] = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function buildRadiusPolygon(center: { lat: number; lng: number }, radiusMeters: number, points = 72) {
  const coordinates: [number, number][] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = Math.max(1, 111320 * Math.cos(latRad));

  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusMeters;
    const dy = Math.sin(angle) * radiusMeters;
    const lng = center.lng + dx / metersPerDegreeLng;
    const lat = center.lat + dy / metersPerDegreeLat;
    coordinates.push([lng, lat]);
  }

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Polygon" as const,
          coordinates: [coordinates]
        }
      }
    ]
  };
}

function primaryCategory(result: SearchResult, unknownCategoryLabel: string) {
  const firstCategory = result.store.appCategories?.[0];
  if (firstCategory) {
    return firstCategory;
  }
  if (result.store.osmCategory) {
    return result.store.osmCategory;
  }
  return unknownCategoryLabel;
}

function validationLabelFor(
  status: SearchResult["validationStatus"],
  validationLikelyLabel: string,
  validationValidatedLabel: string
) {
  if (status === "likely") {
    return validationLikelyLabel;
  }
  if (status === "validated") {
    return validationValidatedLabel;
  }
  return null;
}

function createPinElement(kind: "user" | "result", rank: number) {
  const marker = document.createElement("div");
  marker.className = kind === "user" ? "map-pin map-pin-user" : "map-pin";
  if (kind === "result" && rank === 0) {
    marker.classList.add("map-pin-top");
  }
  return marker;
}

export function LocalMap({
  center,
  results,
  userMarkerLabel,
  matchedProductLabel,
  storeCategoryLabel,
  distanceLabel,
  validationLabel,
  validationLikelyLabel,
  validationValidatedLabel,
  unknownCategoryLabel,
  radiusMeters,
  className
}: {
  center: { lat: number; lng: number };
  results: SearchResult[];
  userMarkerLabel: string;
  matchedProductLabel: string;
  storeCategoryLabel: string;
  distanceLabel: string;
  validationLabel: string;
  validationLikelyLabel: string;
  validationValidatedLabel: string;
  unknownCategoryLabel: string;
  radiusMeters: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const markerSeed = useMemo(
    () =>
      `${center.lat.toFixed(4)}:${center.lng.toFixed(4)}:${radiusMeters}:${results
        .map((item) => item.offer.id)
        .join(",")}`,
    [center.lat, center.lng, radiusMeters, results]
  );

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
        zoom: 13
      });
      const mapInstance = map;

      mapInstance.addControl(new maplibregl.NavigationControl(), "top-right");

      const renderMapContent = () => {
        const radiusGeoJSON = buildRadiusPolygon(
          { lat: center.lat, lng: center.lng },
          Math.max(100, radiusMeters)
        );
        mapInstance.addSource("search-radius", {
          type: "geojson",
          data: radiusGeoJSON
        });
        mapInstance.addLayer({
          id: "search-radius-fill",
          type: "fill",
          source: "search-radius",
          paint: {
            "fill-color": "#111111",
            "fill-opacity": 0.06
          }
        });
        mapInstance.addLayer({
          id: "search-radius-line",
          type: "line",
          source: "search-radius",
          paint: {
            "line-color": "#111111",
            "line-width": 1.2,
            "line-opacity": 0.52,
            "line-dasharray": [2, 2]
          }
        });

        const userMarkerElement = createPinElement("user", 0);
        userMarkerElement.addEventListener("click", () => triggerHaptic(7));

        new maplibregl.Marker({ element: userMarkerElement, anchor: "bottom" })
          .setLngLat([center.lng, center.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false }).setText(userMarkerLabel))
          .addTo(mapInstance);

        const visibleResults = results.slice(0, MAX_PIN_RESULTS);
        visibleResults.forEach((item, index) => {
          const popupContainer = document.createElement("div");
          popupContainer.className = "map-popup";

          const title = document.createElement("h3");
          title.className = "map-popup-title";
          title.textContent = item.store.name;
          popupContainer.appendChild(title);

          const productLine = document.createElement("p");
          productLine.className = "map-popup-line";
          productLine.textContent = `${matchedProductLabel}: ${item.product.normalizedName}`;
          popupContainer.appendChild(productLine);

          const distanceLine = document.createElement("p");
          distanceLine.className = "map-popup-line";
          distanceLine.textContent = `${distanceLabel}: ${formatDistance(item.distanceMeters)}`;
          popupContainer.appendChild(distanceLine);

          const categoryLine = document.createElement("p");
          categoryLine.className = "map-popup-line";
          categoryLine.textContent = `${storeCategoryLabel}: ${primaryCategory(item, unknownCategoryLabel)}`;
          popupContainer.appendChild(categoryLine);

          const validation = validationLabelFor(
            item.validationStatus,
            validationLikelyLabel,
            validationValidatedLabel
          );
          if (validation) {
            const validationLine = document.createElement("p");
            validationLine.className = "map-popup-line";
            validationLine.textContent = `${validationLabel}: ${validation}`;
            popupContainer.appendChild(validationLine);
          }

          const markerElement = createPinElement("result", index);
          markerElement.addEventListener("click", () => triggerHaptic(7));

          new maplibregl.Marker({ element: markerElement, anchor: "bottom" })
            .setLngLat([item.store.lng, item.store.lat])
            .setPopup(new maplibregl.Popup({ closeButton: false, offset: 14 }).setDOMContent(popupContainer))
            .addTo(mapInstance);
        });

        const circleCoordinates = radiusGeoJSON.features[0]?.geometry.coordinates[0] ?? [];
        const boundsFromCircle = circleCoordinates.reduce(
          (acc, coord) => acc.extend(coord as [number, number]),
          new maplibregl.LngLatBounds([center.lng, center.lat], [center.lng, center.lat])
        );
        const bounds = visibleResults.reduce(
          (acc, item) => acc.extend([item.store.lng, item.store.lat]),
          boundsFromCircle
        );
        mapInstance.fitBounds(bounds as LngLatBoundsLike, {
          padding: 56,
          maxZoom: 14.5,
          duration: 0
        });
      };

      if (mapInstance.isStyleLoaded()) {
        renderMapContent();
      } else {
        mapInstance.on("load", renderMapContent);
      }
    }

    loadMap().catch((error) => {
      console.error("Failed to load map", error);
    });

    return () => {
      mounted = false;
      map?.remove();
    };
  }, [
    center.lat,
    center.lng,
    distanceLabel,
    markerSeed,
    matchedProductLabel,
    results,
    storeCategoryLabel,
    unknownCategoryLabel,
    userMarkerLabel,
    validationLabel,
    validationLikelyLabel,
    validationValidatedLabel,
    radiusMeters
  ]);

  return (
    <div
      ref={containerRef}
      className={`bw-map w-full overflow-hidden rounded-[0.7rem] bg-white ${
        className ?? "h-[320px]"
      }`}
    />
  );
}
