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

function formatAvailability(result: SearchResult, dictionary: Dictionary): string {
  if (result.offer.availability === "in_stock") {
    return dictionary.availabilityInStock;
  }
  if (result.offer.availability === "low_stock") {
    return dictionary.availabilityLowStock;
  }
  return dictionary.availabilityUnknown;
}

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
      setErrorMessage("Please provide a product query.");
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
      setErrorMessage("Search request failed.");
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
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(
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

  return (
    <section className="space-y-5">
      <div className="note-card note-tape paper-lines p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="stamp">Shopping Note</span>
          <p className="mono text-xs text-neutral-600">Write it, find it, walk there.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={dictionary.searchPlaceholder}
            className="rounded-xl border border-black/30 bg-white px-4 py-3 focus:border-black focus:outline-none"
          />
          <label className="mono flex items-center gap-2 rounded-xl border border-black/30 px-3 text-sm text-neutral-700">
            {dictionary.radiusLabel}
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="w-16 border-0 bg-transparent text-right focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={runSearch}
            disabled={isLoading}
            className="rounded-xl border border-black bg-black px-5 py-3 font-medium text-white transition hover:bg-white hover:text-black disabled:opacity-50"
          >
            {dictionary.searchButton}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <button
            type="button"
            onClick={useBrowserLocation}
            className="rounded-xl border border-black px-4 py-2 text-black transition hover:bg-black hover:text-white"
          >
            {dictionary.useMyLocation}
          </button>

          <div className="flex flex-1 flex-col gap-2 md:flex-row">
            <input
              value={fallbackAddress}
              onChange={(event) => setFallbackAddress(event.target.value)}
              placeholder={dictionary.locationFallbackPlaceholder}
              className="w-full rounded-xl border border-black/30 bg-white px-4 py-2 focus:border-black focus:outline-none"
            />
            <button
              type="button"
              onClick={resolveFallbackAddress}
              className="rounded-xl border border-black/30 px-4 py-2 text-neutral-700 transition hover:border-black hover:text-black"
            >
              {dictionary.resolveLocationButton}
            </button>
          </div>
        </div>

        <p className="mono mt-3 text-xs text-neutral-700">Center: {centerLabel}</p>
        {locationMessage ? <p className="mono text-xs text-neutral-800">{locationMessage}</p> : null}
        {errorMessage ? <p className="mono text-xs text-neutral-700">{errorMessage}</p> : null}
      </div>

      <LocalMap center={center} results={results} />

      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">{dictionary.resultsTitle}</h2>
        {results.length === 0 ? (
          <p className="note-card rounded-xl border-dashed p-4 text-neutral-700">{dictionary.noResults}</p>
        ) : null}

        {results.map((result) => (
          <article key={result.offer.id} className="note-card p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{result.store.name}</h3>
                <p className="text-sm text-neutral-700">{result.store.address}</p>
                <p className="mono text-xs text-neutral-600">
                  {result.product.normalizedName} - {Math.round(result.distanceMeters)}m
                </p>
                <p className="mono text-xs text-neutral-600">
                  {formatAvailability(result, dictionary)} - {dictionary.updatedLabel}{" "}
                  {result.freshnessHours}h
                </p>
                <p className="text-sm">
                  {typeof result.offer.priceOptional === "number"
                    ? `${result.offer.priceOptional.toFixed(2)} EUR`
                    : dictionary.priceUnknown}
                </p>
              </div>

              <div className="flex gap-2">
                <Link
                  href={`/${locale}/store/${result.store.id}`}
                  className="rounded-xl border border-black/40 px-4 py-2 text-sm text-neutral-800 transition hover:border-black"
                >
                  {dictionary.openStore}
                </Link>
                <button
                  type="button"
                  onClick={() => void trackRouteClick(result)}
                  className="rounded-xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-white hover:text-black"
                >
                  {dictionary.routeAction}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
