"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import { track } from "@vercel/analytics";
import type { Dictionary } from "@/lib/i18n";
import { estimateTravelMinutes } from "@/lib/maps";
import { evaluateOpeningStatus, type OpeningStatus } from "@/lib/opening-hours";
import type { SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
};

type RouteMode = "walk" | "bike";

type RouteApiPayload = {
  mode: RouteMode;
  durationSeconds: number;
  distanceMeters: number;
  geometry: [number, number][];
  fallback?: boolean;
};

type SearchCacheEntry = {
  payload: SearchPayload;
  savedAt: number;
};

type RouteCacheEntry = {
  payload: RouteApiPayload;
  savedAt: number;
};

type ActiveRoute = {
  offerId: string;
  mode: RouteMode;
  durationMinutes: number;
  distanceMeters: number;
  geometry: [number, number][];
  fallback: boolean;
};

type GeolocationPermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

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
const AUTO_GEO_SESSION_KEY = "kiezkauf:auto-geolocation-requested-v1";
const BERLIN_FALLBACK_CENTER = { lat: 52.5208, lng: 13.4094 };
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 15;
const RADIUS_STEP_KM = 0.5;
const COLLAPSED_RESULTS_LIMIT = 3;
const SEARCH_CACHE_TTL_MS = 1000 * 60;
const ROUTE_CACHE_TTL_MS = 1000 * 60 * 5;
const DEV_DEBUG = process.env.NODE_ENV !== "production";

function readCachedLocation(): { lat: number; lng: number } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cached = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!cached) {
      return null;
    }

    const parsed = JSON.parse(cached) as {
      lat?: unknown;
      lng?: unknown;
      timestamp?: unknown;
      accuracy?: unknown;
    };

    const timestamp =
      typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp)
        ? parsed.timestamp
        : null;
    const accuracy =
      typeof parsed.accuracy === "number" && Number.isFinite(parsed.accuracy)
        ? parsed.accuracy
        : null;

    if (!isValidCenterPoint(parsed) || timestamp === null) {
      return null;
    }

    if (Date.now() - timestamp > LOCATION_CACHE_TTL_MS) {
      return null;
    }

    if (accuracy !== null && accuracy > 300) {
      return null;
    }

    return { lat: parsed.lat, lng: parsed.lng };
  } catch {
    return null;
  }
}

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

function formatEtaLabel(prefix: string, minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return `${prefix} 1 min`;
  }
  return `${prefix} ${minutes} min`;
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

function formatConfidencePercent(confidence: number | null | undefined, unknownLabel: string) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return unknownLabel;
  }
  return `${Math.round(confidence * 100)}%`;
}

function compactWhyText(value: string | null | undefined, maxLength = 130) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function formatRelativeCheckedAt(
  value: string | null | undefined,
  dictionary: Pick<
    Dictionary,
    "checkedUnknown" | "checkedToday" | "checkedYesterday" | "checkedDaysAgoTemplate"
  >
) {
  if (!value) {
    return dictionary.checkedUnknown;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return dictionary.checkedUnknown;
  }

  const deltaDays = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (deltaDays <= 0) {
    return dictionary.checkedToday;
  }
  if (deltaDays === 1) {
    return dictionary.checkedYesterday;
  }
  return applyTemplate(dictionary.checkedDaysAgoTemplate, { days: String(deltaDays) });
}

function formatSourceType(sourceType: SearchResult["sourceType"]) {
  if (!sourceType) {
    return "n/a";
  }
  const humanized = sourceType.replace(/_/g, " ");
  return `${humanized.charAt(0).toUpperCase()}${humanized.slice(1)}`;
}

function validationToneClass(status: SearchResult["validationStatus"]) {
  if (status === "validated") return "is-validated";
  if (status === "likely") return "is-likely";
  if (status === "rejected") return "is-rejected";
  return "is-unvalidated";
}

function formatOpeningStatusLabel(dictionary: Dictionary, status: OpeningStatus) {
  if (status === "open") return dictionary.openNowLabel;
  if (status === "closed") return dictionary.closedNowLabel;
  return dictionary.hoursUnknownLabel;
}

function openingStatusToneClass(status: OpeningStatus) {
  if (status === "open") return "is-open-now";
  if (status === "closed") return "is-closed-now";
  return "is-hours-unknown";
}

function openingStatusSortRank(status: OpeningStatus) {
  if (status === "open") return 0;
  if (status === "unknown") return 1;
  return 2;
}

function buildSearchCacheKey(args: {
  query: string;
  lat: number;
  lng: number;
  radiusKm: number;
}) {
  return [
    normalizeQueryForAnalytics(args.query),
    args.lat.toFixed(5),
    args.lng.toFixed(5),
    args.radiusKm.toFixed(2)
  ].join("|");
}

function buildRouteCacheKey(args: {
  mode: RouteMode;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}) {
  return [
    args.mode,
    args.originLat.toFixed(5),
    args.originLng.toFixed(5),
    args.destinationLat.toFixed(5),
    args.destinationLng.toFixed(5)
  ].join("|");
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
  kind: "search" | "distance" | "product" | "category" | "validation" | "note" | "walk" | "bike" | "hours";
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

  if (kind === "hours") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <circle cx="12" cy="12" r="8" {...commonProps} />
        <path d="M12 7.5v5l3 2" {...commonProps} />
      </svg>
    );
  }

  if (kind === "walk") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <circle cx="12" cy="4.5" r="1.7" {...commonProps} />
        <path d="M11 8l3 2 2-1.2M12.2 9.2l-2.4 4.5m2.4-1.2l2.8 1.6M10 22l1.8-4.8m2.7-1l-1.2 5.8" {...commonProps} />
      </svg>
    );
  }

  if (kind === "bike") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className ?? "h-4 w-4"}>
        <circle cx="6" cy="17" r="3.2" {...commonProps} />
        <circle cx="18" cy="17" r="3.2" {...commonProps} />
        <path d="M8.5 10h4.2l1.5 3.1m-4.2 0L12.7 17m0-7l-2.3 3m6.9 0h-3.1m-1.5-3h3.9" {...commonProps} />
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
  const cachedCenter = useMemo(() => readCachedLocation(), []);
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(2);
  const [center, setCenter] = useState<{ lat: number; lng: number }>(() => cachedCenter ?? safeInitialCenter);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geolocationPermission, setGeolocationPermission] = useState<GeolocationPermissionState>("unknown");
  const [locationMessage, setLocationMessage] = useState<string | null>(
    cachedCenter ? dictionary.geolocationRemembered : null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [routeErrorMessage, setRouteErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [noResultsGuidance, setNoResultsGuidance] = useState<NoResultsGuidance | null>(null);
  const [isResultsExpanded, setIsResultsExpanded] = useState(false);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [routeLoadingKey, setRouteLoadingKey] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const lastHapticAtRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const radiusAutoSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const loggedMalformedResultKeysRef = useRef<Set<string>>(new Set());
  const loggedInvalidCenterRef = useRef(false);
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map());
  const routeCacheRef = useRef<Map<string, RouteCacheEntry>>(new Map());

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

  const pulse = useCallback((pattern: number | number[] = 10) => {
    const now = Date.now();
    if (now - lastHapticAtRef.current < 80) {
      return;
    }
    lastHapticAtRef.current = now;
    triggerHaptic(pattern);
  }, []);

  const resetSearchForLocationChange = useCallback((nextLocationMessage: string) => {
    searchRequestIdRef.current += 1;
    searchAbortRef.current?.abort();
    if (radiusAutoSearchTimeoutRef.current) {
      clearTimeout(radiusAutoSearchTimeoutRef.current);
      radiusAutoSearchTimeoutRef.current = null;
    }
    setIsLoading(false);
    setResults([]);
    setHasSearched(false);
    setIsResultsExpanded(false);
    setSelectedOfferId(null);
    setNoResultsGuidance(null);
    setActiveRoute(null);
    setRouteLoadingKey(null);
    setRouteErrorMessage(null);
    setErrorMessage(null);
    setLocationMessage(nextLocationMessage);
    trackEvent("search_reset_for_location_change", {
      had_results: results.length > 0
    });
  }, [results.length]);

  const requestBrowserLocation = useCallback((options?: { auto?: boolean }) => {
    const isAutoRequest = options?.auto === true;
    if (!isAutoRequest) {
      pulse(8);
    }
    trackEvent("geolocation_request", {
      source: isAutoRequest ? "auto" : "user"
    });

    if (isLocating) {
      return;
    }

    if (!navigator.geolocation) {
      setGeolocationPermission("unsupported");
      setErrorMessage(isAutoRequest ? null : dictionary.geolocationError);
      setLocationMessage(dictionary.manualPinHint);
      trackEvent("geolocation_unavailable", {});
      if (!isAutoRequest) {
        pulse(22);
      }
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
      setGeolocationPermission("granted");
      setCenter(nextCenter);
      resetSearchForLocationChange(dictionary.geolocationReady);
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
      (error) => {
        navigator.geolocation.getCurrentPosition(
          applyPosition,
          (secondError) => {
            const denied =
              error.code === error.PERMISSION_DENIED || secondError.code === secondError.PERMISSION_DENIED;
            if (denied) {
              setGeolocationPermission("denied");
              setLocationMessage(dictionary.geolocationDenied);
              setErrorMessage(null);
            } else {
              setErrorMessage(dictionary.geolocationError);
            }
            setIsLocating(false);
            trackEvent("geolocation_error", {
              denied
            });
            if (!isAutoRequest) {
              pulse(26);
            }
          },
          { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [
    dictionary.geolocationDenied,
    dictionary.geolocationError,
    dictionary.geolocationReady,
    dictionary.manualPinHint,
    isLocating,
    pulse,
    resetSearchForLocationChange
  ]);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    const syncPermissionState = (state: string) => {
      if (cancelled) {
        return;
      }
      if (state === "granted" || state === "denied" || state === "prompt") {
        setGeolocationPermission(state);
        if (state === "denied") {
          setLocationMessage(dictionary.manualPinHint);
        }
        return;
      }
      setGeolocationPermission("unknown");
    };

    const markAutoRequestedThisSession = () => {
      try {
        sessionStorage.setItem(AUTO_GEO_SESSION_KEY, "1");
      } catch {
        // Ignore sessionStorage write errors.
      }
    };

    const wasAutoRequestedThisSession = () => {
      try {
        return sessionStorage.getItem(AUTO_GEO_SESSION_KEY) === "1";
      } catch {
        return false;
      }
    };

    const tryAutoRequest = () => {
      if (wasAutoRequestedThisSession()) {
        return;
      }
      if (isLocating) {
        return;
      }
      markAutoRequestedThisSession();
      void requestBrowserLocation({ auto: true });
    };

    if (!navigator.geolocation) {
      setGeolocationPermission("unsupported");
      setLocationMessage(dictionary.manualPinHint);
      return () => {
        cancelled = true;
      };
    }

    const setup = async () => {
      if (!("permissions" in navigator) || typeof navigator.permissions.query !== "function") {
        setGeolocationPermission("unknown");
        tryAutoRequest();
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: "geolocation"
        } as PermissionDescriptor);
        syncPermissionState(permissionStatus.state);

        permissionStatus.onchange = () => {
          syncPermissionState(permissionStatus?.state ?? "unknown");
        };

        if (permissionStatus.state === "prompt") {
          tryAutoRequest();
        }
        if (permissionStatus.state === "granted") {
          tryAutoRequest();
        }
      } catch {
        setGeolocationPermission("unknown");
        tryAutoRequest();
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, [dictionary.manualPinHint, isLocating, requestBrowserLocation]);

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
    if (routeErrorMessage) {
      return routeErrorMessage;
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
    routeErrorMessage,
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

  const quickIntentTerms = useMemo(
    () => [
      dictionary.quickIntentPharmacy,
      dictionary.quickIntentHardware,
      dictionary.quickIntentSpati
    ],
    [dictionary.quickIntentHardware, dictionary.quickIntentPharmacy, dictionary.quickIntentSpati]
  );

  const manualCenterEnabled = geolocationPermission !== "granted";

  const activeRouteLabel = useMemo(() => {
    if (!activeRoute) {
      return null;
    }
    const modeLabel = activeRoute.mode === "walk" ? dictionary.walkTimeLabel : dictionary.bikeTimeLabel;
    const etaLabel = formatEtaLabel(dictionary.etaApproxLabel, activeRoute.durationMinutes);
    return `${dictionary.activeRouteLabel}: ${modeLabel} ${etaLabel}`;
  }, [
    activeRoute,
    dictionary.activeRouteLabel,
    dictionary.bikeTimeLabel,
    dictionary.etaApproxLabel,
    dictionary.walkTimeLabel
  ]);

  const prioritizedListResults = useMemo(() => {
    return results
      .map((result) => ({
        result,
        openingStatus: evaluateOpeningStatus(result.store.openingHours)
      }))
      .sort((a, b) => {
        const statusDelta = openingStatusSortRank(a.openingStatus) - openingStatusSortRank(b.openingStatus);
        if (statusDelta !== 0) {
          return statusDelta;
        }

        const distanceDelta = a.result.distanceMeters - b.result.distanceMeters;
        if (distanceDelta !== 0) {
          return distanceDelta;
        }

        return b.result.rank - a.result.rank;
      });
  }, [results]);

  const visibleListResults = useMemo(() => {
    if (isResultsExpanded) {
      return prioritizedListResults;
    }
    return prioritizedListResults.slice(0, COLLAPSED_RESULTS_LIMIT);
  }, [isResultsExpanded, prioritizedListResults]);

  const selectedResultEntry = useMemo(() => {
    if (prioritizedListResults.length === 0) {
      return null;
    }
    if (!selectedOfferId) {
      return prioritizedListResults[0];
    }
    return (
      prioritizedListResults.find((entry) => entry.result.offer.id === selectedOfferId) ??
      prioritizedListResults[0]
    );
  }, [prioritizedListResults, selectedOfferId]);

  const hasHiddenListResults = prioritizedListResults.length > COLLAPSED_RESULTS_LIMIT;

  const compactListSummary = useMemo(() => {
    if (isResultsExpanded || !hasHiddenListResults) {
      return "";
    }
    return applyTemplate(dictionary.compactResultsSummaryTemplate, {
      shown: String(visibleListResults.length),
      total: String(prioritizedListResults.length)
    });
  }, [
    dictionary.compactResultsSummaryTemplate,
    hasHiddenListResults,
    isResultsExpanded,
    prioritizedListResults.length,
    visibleListResults.length
  ]);

  const estimateTravel = useCallback(
    (distanceMeters: number) => {
      const walkMin = estimateTravelMinutes(distanceMeters, "walk");
      const bikeMin = estimateTravelMinutes(distanceMeters, "bike");
      return {
        walkMin,
        bikeMin,
        walkLabel: formatEtaLabel(dictionary.etaApproxLabel, walkMin),
        bikeLabel: formatEtaLabel(dictionary.etaApproxLabel, bikeMin)
      };
    },
    [dictionary.etaApproxLabel]
  );

  useEffect(() => {
    const searchCache = searchCacheRef.current;
    const routeCache = routeCacheRef.current;

    return () => {
      searchRequestIdRef.current += 1;
      searchAbortRef.current?.abort();
      if (radiusAutoSearchTimeoutRef.current) {
        clearTimeout(radiusAutoSearchTimeoutRef.current);
        radiusAutoSearchTimeoutRef.current = null;
      }
      searchCache.clear();
      routeCache.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeRoute) {
      return;
    }
    const stillVisible = results.some((result) => result.offer.id === activeRoute.offerId);
    if (!stillVisible) {
      setActiveRoute(null);
    }
  }, [activeRoute, results]);

  useEffect(() => {
    if (prioritizedListResults.length === 0) {
      if (selectedOfferId !== null) {
        setSelectedOfferId(null);
      }
      return;
    }

    const selectedStillExists = selectedOfferId
      ? prioritizedListResults.some((entry) => entry.result.offer.id === selectedOfferId)
      : false;

    if (!selectedStillExists) {
      setSelectedOfferId(prioritizedListResults[0]?.result.offer.id ?? null);
    }
  }, [prioritizedListResults, selectedOfferId]);

  useEffect(() => {
    if (!selectedOfferId) {
      return;
    }

    const element = document.getElementById(`result-row-${selectedOfferId}`);
    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }, [selectedOfferId]);

  function triggerQuickIntentSearch(term: string, source: "quick_intent" | "no_results") {
    const trimmed = term.trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setErrorMessage(null);
    setRouteErrorMessage(null);
    pulse(8);
    trackEvent("search_quick_term", {
      source,
      term: normalizeQueryForAnalytics(trimmed)
    });
    void runSearch({ overrideQuery: trimmed });
  }

  async function runSearch(options?: { overrideRadiusKm?: number; overrideQuery?: string }) {
    const effectiveQuery = (options?.overrideQuery ?? query).trim();
    if (!effectiveQuery) {
      setErrorMessage(dictionary.queryRequiredError);
      pulse(18);
      return;
    }

    if (options?.overrideQuery && options.overrideQuery !== query) {
      setQuery(options.overrideQuery);
    }

    if (radiusAutoSearchTimeoutRef.current) {
      clearTimeout(radiusAutoSearchTimeoutRef.current);
      radiusAutoSearchTimeoutRef.current = null;
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
    setRouteErrorMessage(null);
    setActiveRoute(null);
    setIsResultsExpanded(false);
    setSelectedOfferId(null);
    setRouteLoadingKey(null);
    setNoResultsGuidance(null);
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const queryForAnalytics = normalizeQueryForAnalytics(effectiveQuery);
    trackEvent("search_submit", {
      query_length: effectiveQuery.length,
      radius_km: Number(effectiveRadiusKm.toFixed(1)),
      query_normalized: queryForAnalytics || null
    });

    const fetchSearchPayload = async (radiusKm: number) => {
      const cacheKey = buildSearchCacheKey({
        query: effectiveQuery,
        lat: safeCenter.lat,
        lng: safeCenter.lng,
        radiusKm
      });
      const cached = searchCacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.savedAt < SEARCH_CACHE_TTL_MS) {
        trackEvent("search_cache_hit", {
          radius_km: Number(radiusKm.toFixed(1)),
          query_normalized: queryForAnalytics || null
        });
        return cached.payload;
      }

      const params = new URLSearchParams({
        q: effectiveQuery,
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

      const payload = (await response.json()) as SearchPayload;
      searchCacheRef.current.set(cacheKey, {
        payload,
        savedAt: Date.now()
      });
      if (searchCacheRef.current.size > 80) {
        const oldestKey = searchCacheRef.current.keys().next().value;
        if (oldestKey) {
          searchCacheRef.current.delete(oldestKey);
        }
      }
      return payload;
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
      setSelectedOfferId(primaryResults[0]?.offer.id ?? null);
      setHasSearched(true);
      setNoResultsGuidance(guidance);
      const withOpeningHours = primaryResults.filter(
        (result) => typeof result.store.openingHours === "string" && result.store.openingHours.trim().length > 0
      ).length;
      const validatedCount = primaryResults.filter((result) => result.validationStatus === "validated").length;
      const likelyCount = primaryResults.filter((result) => result.validationStatus === "likely").length;
      const avgConfidence =
        primaryResults.length > 0
          ? Number(
              (
                primaryResults.reduce(
                  (sum, result) => sum + (typeof result.confidence === "number" ? result.confidence : 0),
                  0
                ) / primaryResults.length
              ).toFixed(3)
            )
          : 0;
      const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      trackEvent("search_success", {
        results_count: primaryResults.length,
        radius_km: Number(effectiveRadiusKm.toFixed(1)),
        duration_ms: Math.round(finishedAt - startedAt),
        no_results_guidance: guidance?.type ?? null,
        suggested_radius_km: guidance?.type === "nearby" ? Number(guidance.suggestedRadiusKm.toFixed(1)) : null
      });
      trackEvent("search_quality_snapshot", {
        results_count: primaryResults.length,
        with_opening_hours: withOpeningHours,
        validated_count: validatedCount,
        likely_count: likelyCount,
        avg_confidence: avgConfidence
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
    if (radiusAutoSearchTimeoutRef.current) {
      clearTimeout(radiusAutoSearchTimeoutRef.current);
      radiusAutoSearchTimeoutRef.current = null;
    }
    pulse(8);
    trackEvent("search_expand_radius_click", {
      from_km: Number(radiusKm.toFixed(1)),
      to_km: Number(nextRadiusKm.toFixed(1)),
      source
    });
    void runSearch({ overrideRadiusKm: nextRadiusKm });
  }

  async function drawRouteOnMap(result: SearchResult, mode: RouteMode) {
    const routeKey = `${result.offer.id}:${mode}`;
    const isActiveSameRoute =
      activeRoute?.offerId === result.offer.id && activeRoute.mode === mode;
    setSelectedOfferId(result.offer.id);

    if (isActiveSameRoute) {
      setActiveRoute(null);
      setRouteErrorMessage(null);
      trackEvent("route_clear_on_map", {
        offer_id: result.offer.id,
        mode
      });
      return;
    }

    routeRequestIdRef.current += 1;
    const requestId = routeRequestIdRef.current;
    setRouteLoadingKey(routeKey);
    setErrorMessage(null);
    setRouteErrorMessage(null);

    try {
      const routeCacheKey = buildRouteCacheKey({
        mode,
        originLat: safeCenter.lat,
        originLng: safeCenter.lng,
        destinationLat: result.store.lat,
        destinationLng: result.store.lng
      });
      const cachedRoute = routeCacheRef.current.get(routeCacheKey);
      if (cachedRoute && Date.now() - cachedRoute.savedAt < ROUTE_CACHE_TTL_MS) {
        const cachedDurationMinutes = Math.max(1, Math.round((cachedRoute.payload.durationSeconds ?? 0) / 60));
        setActiveRoute({
          offerId: result.offer.id,
          mode,
          durationMinutes: cachedDurationMinutes,
          distanceMeters: cachedRoute.payload.distanceMeters,
          geometry: cachedRoute.payload.geometry,
          fallback: Boolean(cachedRoute.payload.fallback)
        });
        trackEvent("route_cache_hit", {
          offer_id: result.offer.id,
          mode
        });
        setRouteLoadingKey((current) => (current === routeKey ? null : current));
        return;
      }

      const params = new URLSearchParams({
        mode,
        originLat: String(safeCenter.lat),
        originLng: String(safeCenter.lng),
        destinationLat: String(result.store.lat),
        destinationLng: String(result.store.lng)
      });

      const response = await fetch(`/api/route?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Route request failed with status ${response.status}`);
      }
      const data = (await response.json()) as RouteApiPayload;
      if (requestId !== routeRequestIdRef.current) {
        return;
      }

      if (!Array.isArray(data.geometry) || data.geometry.length < 2) {
        throw new Error("Invalid route geometry");
      }
      routeCacheRef.current.set(routeCacheKey, {
        payload: data,
        savedAt: Date.now()
      });
      if (routeCacheRef.current.size > 60) {
        const oldestKey = routeCacheRef.current.keys().next().value;
        if (oldestKey) {
          routeCacheRef.current.delete(oldestKey);
        }
      }

      const durationMinutes = Math.max(1, Math.round((data.durationSeconds ?? 0) / 60));
      setActiveRoute({
        offerId: result.offer.id,
        mode,
        durationMinutes,
        distanceMeters: data.distanceMeters,
        geometry: data.geometry,
        fallback: Boolean(data.fallback)
      });
      setRouteErrorMessage(null);
      trackEvent("route_on_map_success", {
        offer_id: result.offer.id,
        mode,
        duration_min: durationMinutes,
        fallback: Boolean(data.fallback)
      });
      pulse([8, 18, 8]);
    } catch (error) {
      if (requestId !== routeRequestIdRef.current) {
        return;
      }
      if (DEV_DEBUG) {
        console.error("[route-on-map] failed to draw route", error);
      }
      setRouteErrorMessage(dictionary.routeError);
      trackEvent("route_on_map_error", {
        offer_id: result.offer.id,
        mode
      });
      pulse(22);
    } finally {
      if (requestId === routeRequestIdRef.current) {
        setRouteLoadingKey((current) => (current === routeKey ? null : current));
      }
    }
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
                onClick={() => {
                  requestBrowserLocation();
                }}
                disabled={isLocating}
                className={`btn-icon search-action-btn disabled:cursor-not-allowed disabled:opacity-60 ${
                  geolocationPermission === "granted"
                    ? "geo-btn-active"
                    : geolocationPermission === "denied" || geolocationPermission === "unsupported"
                      ? "geo-btn-denied"
                      : ""
                }`}
                aria-label={
                  geolocationPermission === "denied" || geolocationPermission === "unsupported"
                    ? dictionary.geolocationDenied
                    : dictionary.useMyLocation
                }
                title={
                  geolocationPermission === "denied" || geolocationPermission === "unsupported"
                    ? dictionary.geolocationDenied
                    : dictionary.useMyLocation
                }
              >
                <span className="geo-icon-wrap">
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
                  {geolocationPermission === "denied" || geolocationPermission === "unsupported" ? (
                    <span aria-hidden="true" className="geo-off-slash" />
                  ) : null}
                </span>
              </button>
            </div>
            <p className="status-text hidden md:col-span-3 sm:block">{dictionary.searchHint}</p>
            <div className="quick-intents md:col-span-3" aria-label={dictionary.quickIntentLabel}>
              {quickIntentTerms.map((term) => (
                <button
                  key={term}
                  type="button"
                  className="btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem]"
                  onClick={() => {
                    triggerQuickIntentSearch(term, "quick_intent");
                  }}
                  disabled={isLoading}
                >
                  {term}
                </button>
              ))}
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
                if (radiusAutoSearchTimeoutRef.current) {
                  clearTimeout(radiusAutoSearchTimeoutRef.current);
                  radiusAutoSearchTimeoutRef.current = null;
                }
                if (hasSearched && query.trim()) {
                  radiusAutoSearchTimeoutRef.current = setTimeout(() => {
                    void runSearch({ overrideRadiusKm: next });
                  }, 420);
                }
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
        <div className="hand-divider flex items-end justify-end pb-2">
          <p className="status-text">{resultSummary}</p>
        </div>
        {(routeLoadingKey || activeRouteLabel || routeErrorMessage) && (
          <div className="route-status-row" role="status" aria-live="polite" aria-atomic="true">
            {routeLoadingKey ? <span className="route-status-chip is-loading">{dictionary.routeLoadingLabel}</span> : null}
            {!routeLoadingKey && activeRouteLabel ? (
              <span className="route-status-chip is-active">{activeRouteLabel}</span>
            ) : null}
            {!routeLoadingKey && routeErrorMessage ? (
              <span className="route-status-chip is-error">{routeErrorMessage}</span>
            ) : null}
            {activeRoute ? (
              <button
                type="button"
                className="btn-ghost route-status-clear-btn px-2.5 py-1.5 text-[0.72rem]"
                onClick={() => {
                  setActiveRoute(null);
                  setRouteErrorMessage(null);
                  pulse(8);
                }}
              >
                {dictionary.clearRouteAction}
              </button>
            ) : null}
          </div>
        )}
        <LocalMap
          center={safeCenter}
          results={results}
          themeMode={themeMode}
          berlinOnlyHint={dictionary.berlinOnlyHint}
          manualCenterEnabled={manualCenterEnabled}
          onManualCenterChange={(nextCenter) => {
            setCenter(nextCenter);
            resetSearchForLocationChange(dictionary.manualPinHint);
          }}
          radiusMeters={Math.round(radiusKm * 1000)}
          activeRouteGeometry={activeRoute?.geometry ?? null}
          activeRouteFitKey={
            activeRoute
              ? `${activeRoute.offerId}:${activeRoute.mode}:${Math.round(activeRoute.distanceMeters)}`
              : null
          }
          selectedOfferId={selectedOfferId}
          onMarkerSelect={(result) => {
            setSelectedOfferId(result.offer.id);
          }}
          className="h-[clamp(300px,52svh,520px)] md:h-[66vh] md:min-h-[360px]"
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
            <p className="status-text mt-2">{dictionary.noResultsRefineHint}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="status-text">{dictionary.noResultsSuggestionLabel}</span>
              {quickIntentTerms.map((term) => (
                <button
                  key={`no-results-${term}`}
                  type="button"
                  className="btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem]"
                  onClick={() => {
                    triggerQuickIntentSearch(term, "no_results");
                  }}
                  disabled={isLoading}
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {results.length > 0 ? (
          <section className="note-divider pt-2">
            {selectedResultEntry ? (
              <article
                id="selected-store-card"
                className={`store-item selected-store-card ${openingStatusToneClass(
                  selectedResultEntry.openingStatus
                )} is-selected`}
              >
                <div className="selected-store-head">
                  <p className="store-summary-name">{selectedResultEntry.result.store.name}</p>
                  <span className="store-summary-meta">
                    <span className="mono store-summary-distance">
                      <UiIcon kind="distance" className="store-summary-icon" />
                      {formatDistance(selectedResultEntry.result.distanceMeters)}
                    </span>
                    <span
                      className={`store-summary-badge ${openingStatusToneClass(
                        selectedResultEntry.openingStatus
                      )}`}
                    >
                      {formatOpeningStatusLabel(dictionary, selectedResultEntry.openingStatus)}
                    </span>
                    {selectedResultEntry.result.validationStatus ? (
                      <span
                        className={`store-summary-badge ${validationToneClass(
                          selectedResultEntry.result.validationStatus
                        )}`}
                      >
                        {formatValidation(dictionary, selectedResultEntry.result.validationStatus)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="store-details selected-store-details">
                  <p className="store-detail-line">
                    <UiIcon kind="product" className="store-detail-icon" />
                    <span>
                      {dictionary.matchedProductLabel}: {selectedResultEntry.result.product.normalizedName}
                    </span>
                  </p>
                  <p className="store-detail-line">
                    <UiIcon kind="category" className="store-detail-icon" />
                    <span>
                      {dictionary.storeCategoryLabel}:{" "}
                      {primaryCategory(selectedResultEntry.result, dictionary.unknownCategory)}
                    </span>
                  </p>
                  <p className="store-detail-line">
                    <UiIcon kind="validation" className="store-detail-icon" />
                    <span>
                      {dictionary.openingStatusLabel}:{" "}
                      {formatOpeningStatusLabel(dictionary, selectedResultEntry.openingStatus)}
                    </span>
                  </p>
                  {selectedResultEntry.result.store.openingHours ? (
                    <p className="store-detail-line">
                      <UiIcon kind="hours" className="store-detail-icon" />
                      <span>
                        {dictionary.openingHoursLabel}: {selectedResultEntry.result.store.openingHours}
                      </span>
                    </p>
                  ) : null}
                  <p className="store-detail-line">
                    <UiIcon kind="walk" className="store-detail-icon" />
                    <span>
                      {dictionary.walkTimeLabel}:{" "}
                      {
                        estimateTravel(selectedResultEntry.result.distanceMeters).walkLabel
                      } · {dictionary.bikeTimeLabel}:{" "}
                      {
                        estimateTravel(selectedResultEntry.result.distanceMeters).bikeLabel
                      }
                    </span>
                  </p>
                  <div className="store-meta-wrap">
                    <span className="store-meta-chip">
                      {dictionary.confidenceLabel}:{" "}
                      {formatConfidencePercent(
                        selectedResultEntry.result.confidence,
                        dictionary.unknownConfidence
                      )}
                    </span>
                    <span className="store-meta-chip">
                      {dictionary.sourceLabel}: {formatSourceType(selectedResultEntry.result.sourceType)}
                    </span>
                    <span className="store-meta-chip">
                      {dictionary.checkedLabel}:{" "}
                      {formatRelativeCheckedAt(selectedResultEntry.result.lastCheckedAt, {
                        checkedUnknown: dictionary.checkedUnknown,
                        checkedToday: dictionary.checkedToday,
                        checkedYesterday: dictionary.checkedYesterday,
                        checkedDaysAgoTemplate: dictionary.checkedDaysAgoTemplate
                      })}
                    </span>
                    {selectedResultEntry.result.validationStatus ? (
                      <span className={`store-meta-chip ${validationToneClass(selectedResultEntry.result.validationStatus)}`}>
                        {dictionary.validationLabel}: {formatValidation(dictionary, selectedResultEntry.result.validationStatus)}
                      </span>
                    ) : null}
                  </div>
                  {selectedResultEntry.result.whyThisProductMatches ? (
                    <p className="store-detail-line">
                      <UiIcon kind="note" className="store-detail-icon" />
                      <span>
                        {dictionary.whyMatchLabel}: {compactWhyText(selectedResultEntry.result.whyThisProductMatches)}
                      </span>
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(() => {
                      const selectedTravel = estimateTravel(selectedResultEntry.result.distanceMeters);
                      const walkRouteKey = `${selectedResultEntry.result.offer.id}:walk`;
                      const bikeRouteKey = `${selectedResultEntry.result.offer.id}:bike`;
                      const walkRouteActive =
                        activeRoute?.offerId === selectedResultEntry.result.offer.id && activeRoute.mode === "walk";
                      const bikeRouteActive =
                        activeRoute?.offerId === selectedResultEntry.result.offer.id && activeRoute.mode === "bike";
                      const walkRouteLoading = routeLoadingKey === walkRouteKey;
                      const bikeRouteLoading = routeLoadingKey === bikeRouteKey;

                      return (
                        <>
                          <button
                            type="button"
                            className={`btn-ghost inline-flex text-[0.72rem] px-2.5 py-1.5 ${
                              walkRouteActive ? "is-active" : ""
                            }`}
                            disabled={walkRouteLoading}
                            onClick={() => {
                              void drawRouteOnMap(selectedResultEntry.result, "walk");
                            }}
                          >
                            {walkRouteLoading
                              ? dictionary.routeLoadingLabel
                              : walkRouteActive
                                ? dictionary.clearRouteAction
                                : `${dictionary.routeOnMapAction} · ${dictionary.walkTimeLabel} ${selectedTravel.walkMin}m`}
                          </button>
                          <button
                            type="button"
                            className={`btn-ghost inline-flex text-[0.72rem] px-2.5 py-1.5 ${
                              bikeRouteActive ? "is-active" : ""
                            }`}
                            disabled={bikeRouteLoading}
                            onClick={() => {
                              void drawRouteOnMap(selectedResultEntry.result, "bike");
                            }}
                          >
                            {bikeRouteLoading
                              ? dictionary.routeLoadingLabel
                              : bikeRouteActive
                                ? dictionary.clearRouteAction
                                : `${dictionary.routeOnMapAction} · ${dictionary.bikeTimeLabel} ${selectedTravel.bikeMin}m`}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </article>
            ) : null}

            <div className="results-toolbar mb-1.5 md:mb-2">
              <h3 className="note-subtitle note-mark">{dictionary.resultsTitle}</h3>
              <div className="results-toolbar-actions">
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
                {hasHiddenListResults ? (
                  <button
                    type="button"
                    className="btn-ghost text-[0.72rem] px-2.5 py-1.5"
                    onClick={() => {
                      setIsResultsExpanded((current) => !current);
                      pulse(7);
                    }}
                    disabled={isLoading}
                  >
                    {isResultsExpanded ? dictionary.viewLessResultsLabel : dictionary.viewMoreResultsLabel}
                  </button>
                ) : null}
              </div>
            </div>
            {compactListSummary ? (
              <p className="status-text results-toolbar-summary mb-1.5">{compactListSummary}</p>
            ) : null}
            <div
              className="space-y-1"
              role="listbox"
              aria-label={dictionary.resultsTitle}
              aria-activedescendant={selectedOfferId ? `result-row-${selectedOfferId}` : undefined}
            >
              {visibleListResults.map(({ result, openingStatus }, index) => {
                const travel = estimateTravel(result.distanceMeters);
                const isSelected = selectedOfferId === result.offer.id;

                return (
                  <div
                    key={result.offer.id}
                    className={`store-item result-enter ${openingStatusToneClass(openingStatus)} ${
                      isSelected ? "is-selected" : ""
                    }`}
                    style={{ animationDelay: `${Math.min(index, 10) * 26}ms` }}
                  >
                    <button
                      id={`result-row-${result.offer.id}`}
                      type="button"
                      className="store-summary store-summary-button w-full text-left"
                      role="option"
                      aria-selected={isSelected}
                      aria-current={isSelected ? "true" : undefined}
                      aria-describedby={isSelected ? "selected-store-card" : undefined}
                      onClick={() => {
                        pulse(6);
                        setSelectedOfferId(result.offer.id);
                      }}
                    >
                      <span className="store-summary-name">{result.store.name}</span>
                      <span className="store-summary-meta">
                        <span className="mono store-summary-distance">
                          <UiIcon kind="distance" className="store-summary-icon" />
                          {formatDistance(result.distanceMeters)}
                        </span>
                        <span className={`store-summary-badge ${openingStatusToneClass(openingStatus)}`}>
                          {formatOpeningStatusLabel(dictionary, openingStatus)}
                        </span>
                        <span
                          className="mono store-summary-travel store-summary-desktop-meta"
                          title={`${dictionary.walkTimeLabel}: ${travel.walkLabel}`}
                        >
                          <UiIcon kind="walk" className="store-summary-icon" />
                          {travel.walkMin}m
                        </span>
                        <span
                          className="mono store-summary-travel store-summary-desktop-meta"
                          title={`${dictionary.bikeTimeLabel}: ${travel.bikeLabel}`}
                        >
                          <UiIcon kind="bike" className="store-summary-icon" />
                          {travel.bikeMin}m
                        </span>
                        {result.validationStatus ? (
                          <span className={`store-summary-badge store-summary-desktop-meta ${validationToneClass(result.validationStatus)}`}>
                            {formatValidation(dictionary, result.validationStatus)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </section>
    </section>
  );
}
