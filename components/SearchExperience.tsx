"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import { track } from "@vercel/analytics";
import type { Dictionary } from "@/lib/i18n";
import type { SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
};

type NoResultsGuidance =
  | {
      type: "nearby";
      nearestDistanceMeters: number;
      suggestedRadiusKm: number;
    }
  | {
      type: "catalog_gap";
    };

const LOCATION_CACHE_KEY = "kiezkauf:last-location";
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 30;
const BERLIN_FALLBACK_CENTER = { lat: 52.5208, lng: 13.4094 };
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 15;
const RADIUS_STEP_KM = 0.5;
const DEV_DEBUG = process.env.NODE_ENV !== "production";

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidCenterPoint(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { lat?: unknown; lng?: unknown };
  return (
    isFiniteCoordinate(candidate.lat) &&
    isFiniteCoordinate(candidate.lng) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

function isValidSearchResultRecord(value: unknown): value is SearchResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SearchResult>;
  if (!candidate.store || !candidate.offer || !candidate.product) {
    return false;
  }

  const store = candidate.store as Partial<SearchResult["store"]>;
  const offer = candidate.offer as Partial<SearchResult["offer"]>;
  const product = candidate.product as Partial<SearchResult["product"]>;

  return (
    typeof store.name === "string" &&
    isFiniteCoordinate(store.lat) &&
    isFiniteCoordinate(store.lng) &&
    store.lat >= -90 &&
    store.lat <= 90 &&
    store.lng >= -180 &&
    store.lng <= 180 &&
    typeof offer.id === "string" &&
    typeof product.normalizedName === "string" &&
    isFiniteCoordinate(candidate.distanceMeters)
  );
}

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function formatRadiusKm(radiusKm: number) {
  return Number.isInteger(radiusKm) ? `${radiusKm} km` : `${radiusKm.toFixed(1)} km`;
}

function formatRadiusValue(radiusKm: number) {
  return Number.isInteger(radiusKm) ? String(radiusKm) : radiusKm.toFixed(1);
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function clampRadiusKm(radiusKm: number) {
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, radiusKm));
}

function roundRadiusToStep(radiusKm: number) {
  return Math.round(radiusKm / RADIUS_STEP_KM) * RADIUS_STEP_KM;
}

function suggestRadiusKmForDistance(distanceMeters: number, currentRadiusKm: number) {
  const bufferedKm = distanceMeters / 1000 + 0.2;
  const roundedToStep = Math.ceil(bufferedKm / RADIUS_STEP_KM) * RADIUS_STEP_KM;
  return clampRadiusKm(Math.max(roundedToStep, currentRadiusKm + RADIUS_STEP_KM));
}

function suggestNextExpandRadiusKm(currentRadiusKm: number) {
  const candidate = Math.max(currentRadiusKm + 1, currentRadiusKm * 1.5);
  const roundedUp = Math.ceil(candidate / RADIUS_STEP_KM) * RADIUS_STEP_KM;
  return clampRadiusKm(roundRadiusToStep(roundedUp));
}

function applyTemplate(template: string, replacements: Record<string, string>) {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return output;
}

function primaryCategory(result: SearchResult, unknownCategoryLabel: string) {
  return result.store.appCategories?.[0] ?? result.store.osmCategory ?? unknownCategoryLabel;
}

function formatValidation(dictionary: Dictionary, status: SearchResult["validationStatus"]) {
  if (status === "validated") return dictionary.validationValidated;
  if (status === "likely") return dictionary.validationLikely;
  if (status === "rejected") return dictionary.validationRejected;
  return dictionary.validationUnvalidated;
}

function trackEvent(name: string, payload: Record<string, string | number | boolean | null>) {
  try {
    track(name, payload);
  } catch {
    // Ignore client analytics errors so UX never breaks.
  }
}

function normalizeQueryForAnalytics(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function UiIcon({
  kind,
  className
}: {
  kind: "search" | "distance" | "product" | "category" | "validation" | "note";
  className?: string;
}) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (kind === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <circle cx="11" cy="11" r="6" {...commonProps} />
        <path d="M16 16l5 5" {...commonProps} />
      </svg>
    );
  }

  if (kind === "distance") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <path d="M12 21s6-5.3 6-10a6 6 0 10-12 0c0 4.7 6 10 6 10z" {...commonProps} />
        <circle cx="12" cy="11" r="2" {...commonProps} />
      </svg>
    );
  }

  if (kind === "product") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <path d="M4 6h16l-1.2 11.3a2 2 0 01-2 1.7H7.2a2 2 0 01-2-1.7L4 6z" {...commonProps} />
        <path d="M9 6V4h6v2" {...commonProps} />
      </svg>
    );
  }

  if (kind === "category") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <rect x="4" y="4" width="7" height="7" rx="1" {...commonProps} />
        <rect x="13" y="4" width="7" height="7" rx="1" {...commonProps} />
        <rect x="4" y="13" width="7" height="7" rx="1" {...commonProps} />
        <rect x="13" y="13" width="7" height="7" rx="1" {...commonProps} />
      </svg>
    );
  }

  if (kind === "validation") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <path d="M20 7L9.5 17.5 4 12" {...commonProps} />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
      <path d="M5 6h14M5 12h10M5 18h8" {...commonProps} />
    </svg>
  );
}

export function SearchExperience({
  dictionary,
  initialCenter
}: {
  dictionary: Dictionary;
  initialCenter: { lat: number; lng: number };
}) {
  const safeInitialCenter = isValidCenterPoint(initialCenter) ? initialCenter : BERLIN_FALLBACK_CENTER;
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [center, setCenter] = useState(safeInitialCenter);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [noResultsGuidance, setNoResultsGuidance] = useState<NoResultsGuidance | null>(null);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const lastHapticAtRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const loggedMalformedResultKeysRef = useRef<Set<string>>(new Set());
  const loggedInvalidCenterRef = useRef(false);

  const safeCenter = useMemo(
    () => (isValidCenterPoint(center) ? center : safeInitialCenter),
    [center, safeInitialCenter]
  );

  useEffect(() => {
    if (!DEV_DEBUG || isValidCenterPoint(initialCenter)) {
      return;
    }
    console.warn("[map-data-guard] Invalid initial center received, using Berlin fallback", initialCenter);
  }, [initialCenter]);

  useEffect(() => {
    if (!DEV_DEBUG || isValidCenterPoint(center) || loggedInvalidCenterRef.current) {
      return;
    }
    loggedInvalidCenterRef.current = true;
    console.warn("[map-data-guard] Runtime center became invalid, using safe fallback for map/search", center);
  }, [center]);

  function pulse(pattern: number | number[] = 10) {
    const now = Date.now();
    if (now - lastHapticAtRef.current < 80) {
      return;
    }
    lastHapticAtRef.current = now;
    triggerHaptic(pattern);
  }

  useEffect(() => {
    try {
      const cached = localStorage.getItem(LOCATION_CACHE_KEY);
      if (!cached) {
        return;
      }

      const parsed = JSON.parse(cached) as {
        lat: number;
        lng: number;
        timestamp: number;
        accuracy?: number;
      };
      if (
        !isValidCenterPoint(parsed) ||
        typeof parsed?.timestamp !== "number"
      ) {
        if (DEV_DEBUG) {
          console.warn("[map-data-guard] Ignoring malformed cached geolocation", parsed);
        }
        return;
      }

      if (Date.now() - parsed.timestamp > LOCATION_CACHE_TTL_MS) {
        return;
      }
      if (typeof parsed.accuracy === "number" && parsed.accuracy > 300) {
        return;
      }

      setCenter({ lat: parsed.lat, lng: parsed.lng });
      setLocationMessage(dictionary.geolocationRemembered);
    } catch {
      // Ignore bad local cache and keep default center.
    }
  }, [dictionary.geolocationRemembered]);

  useEffect(() => {
    const readTheme = () => {
      if (typeof document === "undefined") {
        return "light" as const;
      }
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : ("light" as const);
    };

    setThemeMode(readTheme());

    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: string }>).detail;
      if (detail?.theme === "dark" || detail?.theme === "light") {
        setThemeMode(detail.theme);
        return;
      }
      setThemeMode(readTheme());
    };

    window.addEventListener("kiezkauf-theme-change", handleThemeChange as EventListener);
    return () => window.removeEventListener("kiezkauf-theme-change", handleThemeChange as EventListener);
  }, []);

  const resultSummary = useMemo(() => {
    if (isLoading) {
      return dictionary.searchingLabel;
    }
    if (!hasSearched) {
      return dictionary.mapEmptyState;
    }
    if (results.length === 0 && noResultsGuidance?.type === "nearby") {
      return applyTemplate(dictionary.noResultsNearbyTemplate, {
        distance: formatDistance(noResultsGuidance.nearestDistanceMeters)
      });
    }
    if (results.length === 0 && noResultsGuidance?.type === "catalog_gap") {
      return dictionary.noResultsCatalogHint;
    }
    return `${results.length} ${dictionary.resultsCountLabel}`;
  }, [
    dictionary.mapEmptyState,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    dictionary.resultsCountLabel,
    dictionary.searchingLabel,
    hasSearched,
    isLoading,
    noResultsGuidance,
    results.length
  ]);

  const liveStatus = useMemo(() => {
    if (isLoading) {
      return dictionary.searchingLabel;
    }
    if (errorMessage) {
      return errorMessage;
    }
    if (locationMessage) {
      return locationMessage;
    }
    if (!hasSearched) {
      return dictionary.mapEmptyState;
    }
    if (results.length === 0 && noResultsGuidance?.type === "nearby") {
      return applyTemplate(dictionary.noResultsNearbyTemplate, {
        distance: formatDistance(noResultsGuidance.nearestDistanceMeters)
      });
    }
    if (results.length === 0 && noResultsGuidance?.type === "catalog_gap") {
      return dictionary.noResultsCatalogHint;
    }
    return `${results.length} ${dictionary.resultsCountLabel}`;
  }, [
    dictionary.mapEmptyState,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    dictionary.resultsCountLabel,
    dictionary.searchingLabel,
    errorMessage,
    hasSearched,
    isLoading,
    locationMessage,
    noResultsGuidance,
    results.length
  ]);

  const noResultsMessage = useMemo(() => {
    if (noResultsGuidance?.type === "nearby") {
      return applyTemplate(dictionary.noResultsNearbyTemplate, {
        distance: formatDistance(noResultsGuidance.nearestDistanceMeters)
      });
    }
    if (noResultsGuidance?.type === "catalog_gap") {
      return dictionary.noResultsCatalogHint;
    }
    return dictionary.noResults;
  }, [
    dictionary.noResults,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    noResultsGuidance
  ]);

  const expandSearchButtonLabel = useMemo(() => {
    if (noResultsGuidance?.type !== "nearby") {
      return "";
    }
    return applyTemplate(dictionary.expandSearchButtonTemplate, {
      radius: formatRadiusValue(noResultsGuidance.suggestedRadiusKm)
    });
  }, [dictionary.expandSearchButtonTemplate, noResultsGuidance]);

  const quickExpandRadiusKm = useMemo(() => {
    if (!hasSearched || radiusKm >= MAX_RADIUS_KM) {
      return null;
    }
    return suggestNextExpandRadiusKm(radiusKm);
  }, [hasSearched, radiusKm]);

  const quickExpandButtonLabel = useMemo(() => {
    if (quickExpandRadiusKm === null) {
      return "";
    }
    return applyTemplate(dictionary.expandSearchButtonTemplate, {
      radius: formatRadiusValue(quickExpandRadiusKm)
    });
  }, [dictionary.expandSearchButtonTemplate, quickExpandRadiusKm]);

  useEffect(() => {
    return () => {
      searchRequestIdRef.current += 1;
      searchAbortRef.current?.abort();
    };
  }, []);

  async function runSearch(options?: { overrideRadiusKm?: number }) {
    if (!query.trim()) {
      setErrorMessage(dictionary.queryRequiredError);
      pulse(18);
      return;
    }

    const effectiveRadiusKm = clampRadiusKm(options?.overrideRadiusKm ?? radiusKm);
    searchAbortRef.current?.abort();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    const abortController = new AbortController();
    searchAbortRef.current = abortController;

    pulse(8);
    setIsLoading(true);
    setErrorMessage(null);
    setNoResultsGuidance(null);
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const queryForAnalytics = normalizeQueryForAnalytics(query);
    trackEvent("search_submit", {
      query_length: query.trim().length,
      radius_km: Number(effectiveRadiusKm.toFixed(1)),
      query_normalized: queryForAnalytics || null
    });

    const fetchSearchPayload = async (radiusKm: number) => {
      const params = new URLSearchParams({
        q: query,
        lat: String(safeCenter.lat),
        lng: String(safeCenter.lng),
        radius: String(Math.round(radiusKm * 1000))
      });

      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: abortController.signal
      });
      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      return (await response.json()) as SearchPayload;
    };

    const sanitizeResults = (rawResults: unknown[], radiusKm: number) => {
      const sanitizedResults: SearchResult[] = [];
      let droppedMalformed = 0;

      for (let index = 0; index < rawResults.length; index += 1) {
        const item = rawResults[index];
        if (isValidSearchResultRecord(item)) {
          sanitizedResults.push(item);
          continue;
        }

        droppedMalformed += 1;
        if (DEV_DEBUG) {
          const maybeOfferId = (item as { offer?: { id?: unknown } } | null | undefined)?.offer?.id;
          const malformedKey = typeof maybeOfferId === "string" ? `offer:${maybeOfferId}` : `idx:${radiusKm}:${index}`;
          if (!loggedMalformedResultKeysRef.current.has(malformedKey)) {
            loggedMalformedResultKeysRef.current.add(malformedKey);
            console.warn("[map-data-guard] Dropping malformed search result from API payload", {
              index,
              malformedKey,
              radiusKm,
              item
            });
          }
        }
      }

      if (DEV_DEBUG && droppedMalformed > 0) {
        console.warn(`[map-data-guard] Dropped ${droppedMalformed} malformed search results at ${radiusKm}km`);
      }

      return sanitizedResults;
    };

    try {
      const data = await fetchSearchPayload(effectiveRadiusKm);
      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      const primaryResults = sanitizeResults(Array.isArray(data?.results) ? data.results : [], effectiveRadiusKm);
      let guidance: NoResultsGuidance | null = null;

      if (primaryResults.length === 0) {
        if (effectiveRadiusKm < MAX_RADIUS_KM) {
          const nearbyData = await fetchSearchPayload(MAX_RADIUS_KM);
          if (requestId !== searchRequestIdRef.current) {
            return;
          }

          const nearbyResults = sanitizeResults(
            Array.isArray(nearbyData?.results) ? nearbyData.results : [],
            MAX_RADIUS_KM
          );
          if (nearbyResults.length > 0) {
            const nearestDistanceMeters = nearbyResults.reduce(
              (currentMin, result) => Math.min(currentMin, result.distanceMeters),
              Number.POSITIVE_INFINITY
            );
            if (Number.isFinite(nearestDistanceMeters)) {
              guidance = {
                type: "nearby",
                nearestDistanceMeters,
                suggestedRadiusKm: suggestRadiusKmForDistance(nearestDistanceMeters, effectiveRadiusKm)
              };
            } else {
              guidance = { type: "catalog_gap" };
            }
          } else {
            guidance = { type: "catalog_gap" };
          }
        } else {
          guidance = { type: "catalog_gap" };
        }
      }

      setResults(primaryResults);
      setHasSearched(true);
      setNoResultsGuidance(guidance);
      const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      trackEvent("search_success", {
        results_count: primaryResults.length,
        radius_km: Number(effectiveRadiusKm.toFixed(1)),
        duration_ms: Math.round(finishedAt - startedAt),
        no_results_guidance: guidance?.type ?? null,
        suggested_radius_km: guidance?.type === "nearby" ? Number(guidance.suggestedRadiusKm.toFixed(1)) : null
      });
      if (primaryResults.length === 0) {
        trackEvent("search_zero_results", {
          query_normalized: queryForAnalytics || null,
          radius_km: Number(effectiveRadiusKm.toFixed(1)),
          guidance_type: guidance?.type ?? null,
          suggested_radius_km: guidance?.type === "nearby" ? Number(guidance.suggestedRadiusKm.toFixed(1)) : null
        });
      }
      pulse([12, 28, 10]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (requestId !== searchRequestIdRef.current) {
        return;
      }
      console.error(error);
      setErrorMessage(dictionary.searchRequestError);
      setNoResultsGuidance(null);
      const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      trackEvent("search_error", {
        radius_km: Number(effectiveRadiusKm.toFixed(1)),
        duration_ms: Math.round(finishedAt - startedAt)
      });
      pulse(24);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }

  function expandSearchTo(radiusToUse: number, source: "no_results" | "results_list") {
    const nextRadiusKm = clampRadiusKm(radiusToUse);
    setRadiusKm(nextRadiusKm);
    pulse(8);
    trackEvent("search_expand_radius_click", {
      from_km: Number(radiusKm.toFixed(1)),
      to_km: Number(nextRadiusKm.toFixed(1)),
      source
    });
    void runSearch({ overrideRadiusKm: nextRadiusKm });
  }

  function useBrowserLocation() {
    pulse(8);
    trackEvent("geolocation_request", {});
    if (!navigator.geolocation) {
      setErrorMessage(dictionary.geolocationError);
      trackEvent("geolocation_unavailable", {});
      pulse(22);
      return;
    }

    const applyPosition = (position: GeolocationPosition) => {
      const nextCenter = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      if (!isValidCenterPoint(nextCenter)) {
        setErrorMessage(dictionary.geolocationError);
        setIsLocating(false);
        if (DEV_DEBUG) {
          console.warn("[map-data-guard] Ignoring malformed browser geolocation coordinates", position.coords);
        }
        return;
      }
      setCenter(nextCenter);
      setLocationMessage(dictionary.geolocationReady);
      setErrorMessage(null);
      setIsLocating(false);
      trackEvent("geolocation_success", {
        accuracy_m: Math.round(position.coords.accuracy)
      });
      pulse([10, 22, 10]);

      try {
        localStorage.setItem(
          LOCATION_CACHE_KEY,
          JSON.stringify({
            ...nextCenter,
            accuracy: position.coords.accuracy,
            timestamp: Date.now()
          })
        );
      } catch {
        // Ignore localStorage write errors.
      }
    };

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      () => {
        navigator.geolocation.getCurrentPosition(
          applyPosition,
          () => {
            setErrorMessage(dictionary.geolocationError);
            setIsLocating(false);
            trackEvent("geolocation_error", {});
            pulse(26);
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  return (
    <section className="space-y-3 md:space-y-3.5">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </p>
      <section className="tool-block">
        <div className="tool-row hand-divider p-2.5 md:p-3">
          <div className="space-y-1.5 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-1.5 md:space-y-0">
            <label className="sr-only" htmlFor="search-query-input">
              {dictionary.searchPlaceholder}
            </label>
            <div className="search-input-wrap md:col-start-1 md:row-start-1">
              <UiIcon kind="search" className="search-input-icon" />
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
                className="field-input search-input"
              />
            </div>
            <div className="search-action-row">
              <button
                type="button"
                onClick={() => {
                  void runSearch();
                }}
                disabled={isLoading}
                className={`btn-primary search-submit search-action-btn min-w-[108px] sm:min-w-[124px] md:min-w-[150px] disabled:cursor-not-allowed ${
                  isLoading ? "is-loading-simple" : ""
                }`}
                aria-busy={isLoading}
              >
                <span className="btn-label">{isLoading ? dictionary.searchingLabel : dictionary.searchButton}</span>
              </button>
              <button
                type="button"
                onClick={useBrowserLocation}
                disabled={isLocating}
                className="btn-icon search-action-btn disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={dictionary.useMyLocation}
                title={dictionary.useMyLocation}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    d="M12 3v3m0 12v3M3 12h3m12 0h3m-9-5a5 5 0 100 10 5 5 0 000-10z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="tool-row hand-divider px-2.5 pb-2.5 pt-1.5 md:px-3 md:pb-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="radius-km-slider" className="note-label note-mark">
              {dictionary.radiusLabel}
            </label>
            <span className="mono status-inline">{formatRadiusKm(radiusKm)}</span>
          </div>
          <input
            id="radius-km-slider"
            type="range"
            min={MIN_RADIUS_KM}
            max={MAX_RADIUS_KM}
            step={RADIUS_STEP_KM}
            value={radiusKm}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isNaN(next)) {
                setRadiusKm(next);
              }
            }}
            onPointerUp={() => pulse(7)}
            onKeyUp={(event) => {
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowUp" ||
                event.key === "ArrowDown"
              ) {
                pulse(7);
              }
            }}
            className="range-input"
          />
        </div>

        {(locationMessage || errorMessage) && (
          <div className="p-2.5 md:p-3" role="status" aria-live="polite" aria-atomic="true">
            {locationMessage ? <p className="status-text">{locationMessage}</p> : null}
            {errorMessage ? <p className="status-text status-error">{errorMessage}</p> : null}
          </div>
        )}
      </section>

      <section id="map" className="space-y-1.5 md:space-y-2">
        <div className="hand-divider flex items-end justify-between pb-2">
          <h2 className="note-title">{dictionary.mapTitle}</h2>
          <p className="status-text">{resultSummary}</p>
        </div>
        <LocalMap
          center={safeCenter}
          results={results}
          themeMode={themeMode}
          userMarkerLabel={dictionary.mapYouAreHere}
          berlinOnlyHint={dictionary.berlinOnlyHint}
          matchedProductLabel={dictionary.matchedProductLabel}
          storeCategoryLabel={dictionary.storeCategoryLabel}
          distanceLabel={dictionary.distanceLabel}
          validationLabel={dictionary.validationLabel}
          validationLikelyLabel={dictionary.validationLikely}
          validationValidatedLabel={dictionary.validationValidated}
          unknownCategoryLabel={dictionary.unknownCategory}
          radiusMeters={Math.round(radiusKm * 1000)}
          className="h-[55vh] min-h-[280px] md:h-[66vh] md:min-h-[360px]"
        />

        {!isLoading && hasSearched && results.length === 0 ? (
          <div className="note-empty no-results-box p-3">
            <p>{noResultsMessage}</p>
            {noResultsGuidance?.type === "nearby" ? (
              <button
                type="button"
                className="btn-secondary mt-2 w-full text-[0.76rem] md:w-auto"
                onClick={() => {
                  expandSearchTo(noResultsGuidance.suggestedRadiusKm, "no_results");
                }}
                disabled={isLoading}
              >
                {expandSearchButtonLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {results.length > 0 ? (
          <section className="note-divider pt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 md:mb-2">
              <h3 className="note-subtitle note-mark">{dictionary.resultsTitle}</h3>
              {quickExpandRadiusKm !== null ? (
                <button
                  type="button"
                  className="btn-ghost text-[0.72rem] px-2.5 py-1.5"
                  onClick={() => {
                    expandSearchTo(quickExpandRadiusKm, "results_list");
                  }}
                  disabled={isLoading}
                >
                  {quickExpandButtonLabel}
                </button>
              ) : null}
            </div>
            <div className="space-y-1">
              {results.map((result, index) => (
                <details
                  key={result.offer.id}
                  className="store-item result-enter"
                  style={{ animationDelay: `${Math.min(index, 10) * 26}ms` }}
                  onToggle={() => pulse(6)}
                >
                  <summary className="store-summary">
                    <span className="store-summary-name">{result.store.name}</span>
                    <span className="store-summary-meta">
                      <span className="mono store-summary-distance">
                        <UiIcon kind="distance" className="store-summary-icon" />
                        {formatDistance(result.distanceMeters)}
                      </span>
                      <span className="store-summary-caret" aria-hidden="true">
                        <svg viewBox="0 0 20 20">
                          <path d="M5 7.5L10 12.5L15 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </span>
                    </span>
                  </summary>
                  <div className="store-details">
                    <p className="store-detail-line">
                      <UiIcon kind="product" className="store-detail-icon" />
                      <span>
                        {dictionary.matchedProductLabel}: {result.product.normalizedName}
                      </span>
                    </p>
                    <p className="store-detail-line">
                      <UiIcon kind="category" className="store-detail-icon" />
                      <span>
                        {dictionary.storeCategoryLabel}: {primaryCategory(result, dictionary.unknownCategory)}
                      </span>
                    </p>
                    {result.validationStatus ? (
                      <p className="store-detail-line">
                        <UiIcon kind="validation" className="store-detail-icon" />
                        <span>
                          {dictionary.validationLabel}: {formatValidation(dictionary, result.validationStatus)}
                        </span>
                      </p>
                    ) : null}
                    {result.whyThisProductMatches ? (
                      <p className="store-detail-line">
                        <UiIcon kind="note" className="store-detail-icon" />
                        <span>{result.whyThisProductMatches}</span>
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </section>
  );
}
