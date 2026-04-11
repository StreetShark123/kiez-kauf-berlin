"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import { buildDirectionsUrl } from "@/lib/maps";
import type { Dictionary } from "@/lib/i18n";
import type { Locale, SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
};

export function SearchExperience({
  locale,
  dictionary,
  initialCenter
}: {
  locale: Locale;
  dictionary: Dictionary;
  initialCenter: { lat: number; lng: number };
}) {
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [center, setCenter] = useState(initialCenter);
  const [fallbackAddress, setFallbackAddress] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const centerLabel = useMemo(
    () => `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
    [center.lat, center.lng]
  );

  async function runSearch() {
    if (!query.trim()) {
      setErrorMessage(dictionary.queryRequiredError);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({
        q: query,
        lat: String(center.lat),
        lng: String(center.lng),
        radius: String(Math.round(radiusKm * 1000))
      });

      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const data = (await response.json()) as SearchPayload;
      setResults(data.results);
    } catch (error) {
      console.error(error);
      setErrorMessage(dictionary.searchRequestError);
    } finally {
      setIsLoading(false);
    }
  }

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      setErrorMessage(dictionary.geolocationError);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLocationMessage(dictionary.geolocationReady);
        setErrorMessage(null);
      },
      () => {
        setErrorMessage(dictionary.geolocationError);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function resolveFallbackAddress() {
    if (!fallbackAddress.trim()) {
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&bounded=1&viewbox=13.0884,52.6755,13.7612,52.3383&q=${encodeURIComponent(
          `${fallbackAddress}, Berlin`
        )}`
      );
      const data = (await response.json()) as Array<{ lat: string; lon: string }>;
      const first = data[0];

      if (!first) {
        setErrorMessage(dictionary.geolocationError);
        return;
      }

      setCenter({
        lat: Number(first.lat),
        lng: Number(first.lon)
      });
      setLocationMessage(dictionary.geolocationReady);
      setErrorMessage(null);
    } catch (error) {
      console.error(error);
      setErrorMessage(dictionary.geolocationError);
    }
  }

  async function trackRouteClick(result: SearchResult) {
    const interactionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${result.offer.id}`;

    const payload = {
      interactionId,
      storeId: result.store.id,
      productId: result.product.id,
      originLat: center.lat,
      originLng: center.lng,
      destinationLat: result.store.lat,
      destinationLng: result.store.lng,
      locale
    };

    await fetch("/api/analytics/route-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const directions = buildDirectionsUrl({
      destinationLat: result.store.lat,
      destinationLng: result.store.lng,
      originLat: center.lat,
      originLng: center.lng
    });

    window.open(directions, "_blank", "noopener,noreferrer");
  }

  function formatValidation(status: SearchResult["validationStatus"]) {
    if (status === "validated") return dictionary.validationValidated;
    if (status === "likely") return dictionary.validationLikely;
    if (status === "rejected") return dictionary.validationRejected;
    return dictionary.validationUnvalidated;
  }

  function formatConfidence(value: number | null | undefined) {
    if (typeof value !== "number") {
      return dictionary.unknownConfidence;
    }
    return `${Math.round(value * 100)}%`;
  }

  function primaryCategory(result: SearchResult) {
    const firstCategory = result.store.appCategories?.[0];
    if (firstCategory) {
      return firstCategory;
    }
    if (result.store.osmCategory) {
      return result.store.osmCategory;
    }
    return dictionary.unknownCategory;
  }

  return (
    <section className="space-y-5">
      <section className="tool-block">
        <div className="tool-row p-3 md:p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="sr-only" htmlFor="search-query-input">
              {dictionary.searchPlaceholder}
            </label>
            <input
              id="search-query-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              placeholder={dictionary.searchPlaceholder}
              className="field-input"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={isLoading}
              className="btn-primary min-w-[150px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {dictionary.searchButton}
            </button>
          </div>
        </div>

        <div className="tool-row grid gap-2 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto_auto] md:items-center md:p-4">
          <button type="button" onClick={useBrowserLocation} className="btn-secondary whitespace-nowrap">
            {dictionary.useMyLocation}
          </button>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="sr-only" htmlFor="address-fallback">
              {dictionary.locationFallbackLabel}
            </label>
            <input
              id="address-fallback"
              value={fallbackAddress}
              onChange={(event) => setFallbackAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void resolveFallbackAddress();
                }
              }}
              placeholder={dictionary.locationFallbackPlaceholder}
              autoComplete="street-address"
              className="field-input"
            />
            <button type="button" onClick={() => void resolveFallbackAddress()} className="btn-ghost whitespace-nowrap">
              {dictionary.resolveLocationButton}
            </button>
          </div>

          <label className="mono inline-flex items-center gap-2 text-[0.74rem] text-neutral-600">
            <span>{dictionary.radiusLabel}</span>
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={radiusKm}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isNaN(next)) {
                  setRadiusKm(Math.min(10, Math.max(0.5, next)));
                }
              }}
              className="field-input w-[74px] px-2 py-1.5 text-right"
            />
          </label>

          <div className="flex items-center gap-1.5">
            <a href="#results" className="btn-ghost whitespace-nowrap text-[0.78rem]">
              {dictionary.goToResults}
            </a>
            <a href="#map" className="btn-ghost whitespace-nowrap text-[0.78rem]">
              {dictionary.goToMap}
            </a>
          </div>
        </div>

        <div className="p-3 md:p-4">
          <p className="status-text">
            {dictionary.centerLabel}: {centerLabel}
          </p>
          {locationMessage ? <p className="status-text">{locationMessage}</p> : null}
          {errorMessage ? <p className="status-text text-neutral-800">{errorMessage}</p> : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <section id="results" className="ink-rule">
          <div className="mb-2 flex items-end justify-between gap-3">
            <h2 className="text-[1.05rem] font-medium tracking-tight">{dictionary.resultsTitle}</h2>
            <p className="status-text">{results.length}</p>
          </div>

          {results.length === 0 ? (
            <p className="border border-neutral-300 p-3 text-sm text-neutral-600">{dictionary.noResults}</p>
          ) : (
            <ol className="border-y border-neutral-300">
              {results.map((result) => (
                <li key={result.offer.id} className="result-row">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div className="space-y-1.5">
                      <h3 className="text-[0.99rem] font-medium leading-tight">{result.store.name}</h3>
                      <p className="text-sm text-neutral-700">{result.store.address}</p>

                      <div className="flex flex-wrap gap-1.5">
                        <span className="result-kv">{Math.round(result.distanceMeters)} m</span>
                        <span className="result-kv">
                          {dictionary.storeCategoryLabel}: {primaryCategory(result)}
                        </span>
                        <span className="result-kv">
                          {dictionary.confidenceLabel}: {formatConfidence(result.confidence)}
                        </span>
                        <span className="result-kv">
                          {dictionary.validationLabel}: {formatValidation(result.validationStatus)}
                        </span>
                      </div>

                      <p className="text-[0.78rem] text-neutral-600">
                        {dictionary.matchedProductLabel}: {result.product.normalizedName}
                      </p>

                      {result.whyThisProductMatches ? (
                        <p className="text-[0.78rem] text-neutral-600">
                          {dictionary.whyMatchLabel}: {result.whyThisProductMatches}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      <Link href={`/${locale}/store/${result.store.id}`} className="btn-secondary text-[0.8rem]">
                        {dictionary.openStore}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void trackRouteClick(result)}
                        className="btn-primary text-[0.8rem]"
                      >
                        {dictionary.routeAction}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section id="map" className="space-y-2 lg:sticky lg:top-4">
          <h2 className="text-[1.05rem] font-medium tracking-tight">{dictionary.mapTitle}</h2>
          <LocalMap
            center={center}
            results={results}
            userMarkerLabel={dictionary.mapYouAreHere}
            className="h-[44vh] min-h-[300px] border border-neutral-300"
          />
        </section>
      </div>
    </section>
  );
}
