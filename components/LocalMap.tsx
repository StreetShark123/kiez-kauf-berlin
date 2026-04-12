"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  StyleSpecification
} from "maplibre-gl";
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
const BERLIN_FALLBACK_CENTER = { lat: 52.5208, lng: 13.4094 };
const DEV_DEBUG = process.env.NODE_ENV !== "production";

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidCenterPoint(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as { lat?: unknown; lng?: unknown };
  return (
    isFiniteCoordinate(point.lat) &&
    isFiniteCoordinate(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

function isValidMapResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<SearchResult>;
  const store = result.store as Partial<SearchResult["store"]> | undefined;
  const offer = result.offer as Partial<SearchResult["offer"]> | undefined;
  const product = result.product as Partial<SearchResult["product"]> | undefined;

  return (
    !!store &&
    !!offer &&
    !!product &&
    isValidCenterPoint({ lat: store.lat, lng: store.lng }) &&
    typeof store.name === "string" &&
    typeof offer.id === "string" &&
    typeof product.normalizedName === "string" &&
    isFiniteCoordinate(result.distanceMeters)
  );
}

type RenderableMapResult = {
  item: SearchResult;
  lat: number;
  lng: number;
};

function toRenderableMapResult(value: unknown): RenderableMapResult | null {
  if (!isValidMapResult(value)) {
    return null;
  }

  const lat = value.store.lat;
  const lng = value.store.lng;
  if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) {
    return null;
  }

  return {
    item: value,
    lat,
    lng
  };
}

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
  themeMode,
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
  themeMode: "light" | "dark";
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
  const initialCenterRef = useRef(
    isValidCenterPoint(center) ? center : BERLIN_FALLBACK_CENTER
  );
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const userMarkerRef = useRef<MapLibreMarker | null>(null);
  const resultMarkersRef = useRef<Map<string, MapLibreMarker>>(new Map());
  const lastBoundsKeyRef = useRef<string>("");
  const loggedMalformedResultKeysRef = useRef<Set<string>>(new Set());
  const loggedInvalidCenterRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const safeCenter = useMemo(
    () => (isValidCenterPoint(center) ? center : BERLIN_FALLBACK_CENTER),
    [center]
  );

  useEffect(() => {
    if (!DEV_DEBUG || isValidCenterPoint(center) || loggedInvalidCenterRef.current) {
      return;
    }

    loggedInvalidCenterRef.current = true;
    console.warn("[map-data-guard] Invalid map center received, using Berlin fallback", center);
  }, [center]);

  useEffect(() => {
    let mounted = true;
    const resultMarkers = resultMarkersRef.current;

    async function initMap() {
      if (!containerRef.current || mapRef.current) {
        return;
      }

      const maplibregl = await import("maplibre-gl");
      if (!mounted || !containerRef.current) {
        return;
      }

      maplibreRef.current = maplibregl;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: BASE_BW_STYLE,
        center: [initialCenterRef.current.lng, initialCenterRef.current.lat],
        zoom: 13
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("load", () => {
        if (!mounted) {
          return;
        }
        setMapReady(true);
      });

      mapRef.current = map;
    }

    initMap().catch((error) => {
      console.error("Failed to load map", error);
    });

    return () => {
      mounted = false;
      userMarkerRef.current = null;
      resultMarkers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
      lastBoundsKeyRef.current = "";
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }

    const radiusLineColor = themeMode === "dark" ? "#f1f1f1" : "#111111";
    const radiusFillColor = themeMode === "dark" ? "#f1f1f1" : "#111111";
    const radiusFillOpacity = themeMode === "dark" ? 0.08 : 0.06;
    const radiusLineOpacity = themeMode === "dark" ? 0.62 : 0.56;

    const radiusGeoJSON = buildRadiusPolygon(
      { lat: safeCenter.lat, lng: safeCenter.lng },
      Math.max(100, radiusMeters)
    );

    const radiusSource = map.getSource("search-radius") as
      | { setData: (data: unknown) => void }
      | undefined;

    if (radiusSource) {
      radiusSource.setData(radiusGeoJSON);
    } else {
      map.addSource("search-radius", {
        type: "geojson",
        data: radiusGeoJSON
      });
    }

    if (!map.getLayer("search-radius-fill")) {
      map.addLayer({
        id: "search-radius-fill",
        type: "fill",
        source: "search-radius",
        paint: {
          "fill-color": radiusFillColor,
          "fill-opacity": radiusFillOpacity
        }
      });
    } else {
      map.setPaintProperty("search-radius-fill", "fill-color", radiusFillColor);
      map.setPaintProperty("search-radius-fill", "fill-opacity", radiusFillOpacity);
    }

    if (!map.getLayer("search-radius-line")) {
      map.addLayer({
        id: "search-radius-line",
        type: "line",
        source: "search-radius",
        paint: {
          "line-color": radiusLineColor,
          "line-width": 1.25,
          "line-opacity": radiusLineOpacity
        }
      });
    } else {
      map.setPaintProperty("search-radius-line", "line-color", radiusLineColor);
      map.setPaintProperty("search-radius-line", "line-opacity", radiusLineOpacity);
    }
  }, [safeCenter.lat, safeCenter.lng, radiusMeters, themeMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReady) {
      return;
    }

    if (!userMarkerRef.current) {
      const userMarkerElement = createPinElement("user", 0);
      userMarkerElement.addEventListener("click", () => triggerHaptic(7));

      userMarkerRef.current = new maplibregl.Marker({ element: userMarkerElement, anchor: "bottom" }).addTo(map);
    }

    userMarkerRef.current
      .setLngLat([safeCenter.lng, safeCenter.lat])
      .setPopup(new maplibregl.Popup({ closeButton: false }).setText(userMarkerLabel));
  }, [safeCenter.lat, safeCenter.lng, userMarkerLabel, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !mapReady) {
      return;
    }

    try {
      const appendPopupLine = (
        container: HTMLDivElement,
        kind: "product" | "distance" | "category" | "validation",
        label: string,
        value: string
      ) => {
        const line = document.createElement("p");
        line.className = `map-popup-line map-popup-line-${kind}`;
        line.textContent = `${label}: ${value}`;
        container.appendChild(line);
      };

      const validResults: RenderableMapResult[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const item = results[index];
        const renderable = toRenderableMapResult(item);
        if (renderable) {
          validResults.push(renderable);
          continue;
        }

        if (DEV_DEBUG) {
          const maybeOfferId =
            (item as { offer?: { id?: unknown } } | null | undefined)?.offer?.id;
          const malformedKey = typeof maybeOfferId === "string" ? `offer:${maybeOfferId}` : `idx:${index}`;
          if (!loggedMalformedResultKeysRef.current.has(malformedKey)) {
            loggedMalformedResultKeysRef.current.add(malformedKey);
            console.warn("[map-data-guard] Dropping malformed map result before pin rendering", {
              index,
              malformedKey,
              item
            });
          }
        }
      }

      const visibleResults = validResults.slice(0, MAX_PIN_RESULTS);
      const nextVisibleIds = new Set<string>();
      const radiusGeoJSON = buildRadiusPolygon(
        { lat: safeCenter.lat, lng: safeCenter.lng },
        Math.max(100, radiusMeters)
      );

      visibleResults.forEach((entry, index) => {
        const { item, lat, lng } = entry;
        try {
          const popupContainer = document.createElement("div");
          popupContainer.className = "map-popup";

          const title = document.createElement("h3");
          title.className = "map-popup-title";
          title.textContent = item.store.name;
          popupContainer.appendChild(title);

          appendPopupLine(popupContainer, "product", matchedProductLabel, item.product.normalizedName);
          appendPopupLine(popupContainer, "distance", distanceLabel, formatDistance(item.distanceMeters));
          appendPopupLine(
            popupContainer,
            "category",
            storeCategoryLabel,
            primaryCategory(item, unknownCategoryLabel)
          );

          const validation = validationLabelFor(
            item.validationStatus,
            validationLikelyLabel,
            validationValidatedLabel
          );
          if (validation) {
            appendPopupLine(popupContainer, "validation", validationLabel, validation);
          }

          const markerId = String(item.offer.id);
          const existingMarker = resultMarkersRef.current.get(markerId);
          if (existingMarker) {
            existingMarker
              .setLngLat([lng, lat])
              .setPopup(new maplibregl.Popup({ closeButton: false, offset: 14 }).setDOMContent(popupContainer));
            existingMarker.getElement().classList.toggle("map-pin-top", index === 0);
          } else {
            const markerElement = createPinElement("result", index);
            markerElement.addEventListener("click", () => triggerHaptic(7));

            const marker = new maplibregl.Marker({ element: markerElement, anchor: "bottom" })
              .setLngLat([lng, lat])
              .setPopup(new maplibregl.Popup({ closeButton: false, offset: 14 }).setDOMContent(popupContainer))
              .addTo(map);

            resultMarkersRef.current.set(markerId, marker);
          }

          nextVisibleIds.add(markerId);
        } catch (markerError) {
          if (DEV_DEBUG) {
            console.error("[map-data-guard] Marker render failed; dropping entry", {
              markerError,
              entry
            });
          }
        }
      });

      for (const [markerId, marker] of resultMarkersRef.current.entries()) {
        if (nextVisibleIds.has(markerId)) {
          continue;
        }
        marker.remove();
        resultMarkersRef.current.delete(markerId);
      }

      const circleCoordinates = radiusGeoJSON.features[0]?.geometry.coordinates[0] ?? [];
      const boundsFromCircle = circleCoordinates.reduce(
        (acc, coord) => acc.extend(coord as [number, number]),
        new maplibregl.LngLatBounds([safeCenter.lng, safeCenter.lat], [safeCenter.lng, safeCenter.lat])
      );
      const bounds = visibleResults.reduce((acc, entry) => acc.extend([entry.lng, entry.lat]), boundsFromCircle);

      const boundsKey = [
        safeCenter.lat.toFixed(5),
        safeCenter.lng.toFixed(5),
        String(Math.round(radiusMeters)),
        ...visibleResults.map(
          (entry) =>
            `${entry.item.offer.id}:${entry.lat.toFixed(5)}:${entry.lng.toFixed(5)}`
        )
      ].join("|");

      if (boundsKey !== lastBoundsKeyRef.current) {
        map.fitBounds(bounds, {
          padding: 56,
          maxZoom: 14.5,
          duration: 260
        });
        lastBoundsKeyRef.current = boundsKey;
      }
    } catch (mapCycleError) {
      if (DEV_DEBUG) {
        console.error("[map-data-guard] Map render cycle failed; preserving map state", {
          mapCycleError,
          resultsCount: results.length
        });
      }
    }
  }, [
    safeCenter.lat,
    safeCenter.lng,
    distanceLabel,
    matchedProductLabel,
    radiusMeters,
    results,
    storeCategoryLabel,
    unknownCategoryLabel,
    validationLabel,
    validationLikelyLabel,
    validationValidatedLabel,
    mapReady
  ]);

  return (
    <div
      ref={containerRef}
      className={`bw-map map-stroke-frame w-full overflow-hidden rounded-[0.7rem] ${
        className ?? "h-[320px]"
      }`}
    />
  );
}
