"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalMap } from "@/components/LocalMap";
import { track } from "@vercel/analytics";
import type { Dictionary } from "@/lib/i18n";
import { estimateTravelMinutes } from "@/lib/maps";
import { evaluateOpeningInfo, type OpeningInfo, type OpeningStatus } from "@/lib/opening-hours";
import type { SearchResult } from "@/lib/types";

type SearchPayload = {
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
  endpoint?: string;
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
  endpointUsed: string;
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
const RADIUS_PICKER_OPTIONS = [0.5, 1, 1.5, 2, 3, 5, 8, 12, 15] as const;
const COLLAPSED_RESULTS_LIMIT = 3;
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 10;
const ROUTE_CACHE_TTL_MS = 1000 * 60 * 5;
const SEARCH_TIMEOUT_MS = 10000;
const SEARCH_PRIMARY_ENDPOINT = "/api/search";
const SEARCH_FALLBACK_ENDPOINT = "/api/search?fallback=1";
const RECENT_SEARCHES_STORAGE_KEY = "kiezkauf:recent-searches";
const SAVED_STORES_STORAGE_KEY = "kiezkauf:saved-stores";
const MAX_RECENT_SEARCHES = 8;
const DEV_DEBUG = process.env.NODE_ENV !== "production";
const RELATED_TERM_HINTS: Array<{ trigger: string; terms: string[] }> = [
  { trigger: "pencil", terms: ["mechanical pencil", "2mm lead", "stationery"] },
  { trigger: "hammer", terms: ["tool", "hardware", "nails"] },
  { trigger: "baby", terms: ["diapers", "baby wipes", "pharmacy"] },
  { trigger: "pet", terms: ["pet food", "cat litter", "animal store"] },
  { trigger: "clean", terms: ["detergent", "bleach", "droguerie"] },
  { trigger: "cable", terms: ["adapter", "charger", "electronics"] }
];

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

function formatOpeningStatusWithDetails(dictionary: Dictionary, openingInfo: OpeningInfo) {
  if (openingInfo.status === "open" && openingInfo.closesAt) {
    return applyTemplate(dictionary.openUntilTemplate, { time: openingInfo.closesAt });
  }
  return formatOpeningStatusLabel(dictionary, openingInfo.status);
}

function sanitizePhoneHref(phone: string | null | undefined) {
  if (!phone) {
    return null;
  }
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned.length < 6) {
    return null;
  }
  return `tel:${cleaned}`;
}

function formatStoreOwnership(
  dictionary: Dictionary,
  ownership: SearchResult["store"]["ownershipType"] | undefined
) {
  if (ownership === "independent") {
    return dictionary.ownershipIndependent;
  }
  if (ownership === "chain") {
    return dictionary.ownershipChain;
  }
  return dictionary.ownershipUnknown;
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

function suggestRelatedTerms(query: string, quickIntentTerms: string[]) {
  const normalized = normalizeQueryForAnalytics(query);
  if (!normalized) {
    return quickIntentTerms.slice(0, 3);
  }

  const suggestions = new Set<string>();
  for (const hint of RELATED_TERM_HINTS) {
    if (normalized.includes(hint.trigger)) {
      for (const term of hint.terms) {
        suggestions.add(term);
      }
    }
  }

  for (const term of quickIntentTerms) {
    if (suggestions.size >= 4) {
      break;
    }
    if (normalizeQueryForAnalytics(term) !== normalized) {
      suggestions.add(term);
    }
  }

  return [...suggestions].slice(0, 4);
}

function buildSearchCacheKey(args: {
  query: string;
  lat: number;
  lng: number;
  radiusKm: number;
}) {
  return [
    normalizeQueryForAnalytics(args.query),
    args.lat.toFixed(3),
    args.lng.toFixed(3),
    args.radiusKm.toFixed(1)
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
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [independentOnly, setIndependentOnly] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [savedStoreIds, setSavedStoreIds] = useState<string[]>([]);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [flashedOfferId, setFlashedOfferId] = useState<string | null>(null);
  const [routeLoadingKey, setRouteLoadingKey] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [activeQuickIntent, setActiveQuickIntent] = useState<string | null>(null);
  const [showCachedResultBadge, setShowCachedResultBadge] = useState(false);
  const [lastSearchEndpoint, setLastSearchEndpoint] = useState<string | null>(null);
  const lastHapticAtRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const loggedMalformedResultKeysRef = useRef<Set<string>>(new Set());
  const loggedInvalidCenterRef = useRef(false);
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map());
  const routeCacheRef = useRef<Map<string, RouteCacheEntry>>(new Map());
  const mapSectionRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const cachedRecent = JSON.parse(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(cachedRecent)) {
        setRecentSearches(
          cachedRecent
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, MAX_RECENT_SEARCHES)
        );
      }
    } catch {
      // ignore invalid cache payload
    }

    try {
      const cachedSaved = JSON.parse(localStorage.getItem(SAVED_STORES_STORAGE_KEY) ?? "[]") as unknown;
      if (Array.isArray(cachedSaved)) {
        setSavedStoreIds(cachedSaved.filter((item): item is string => typeof item === "string").slice(0, 300));
      }
    } catch {
      // ignore invalid cache payload
    }
  }, []);

  const savedStoreIdSet = useMemo(() => new Set(savedStoreIds), [savedStoreIds]);
  const statusFilteredCount = useMemo(() => {
    return results.reduce((count, result) => {
      if (openNowOnly && evaluateOpeningInfo(result.store.openingHours).status !== "open") {
        return count;
      }
      if (savedOnly && !savedStoreIdSet.has(result.store.id)) {
        return count;
      }
      if (independentOnly && result.store.ownershipType !== "independent") {
        return count;
      }
      return count + 1;
    }, 0);
  }, [independentOnly, openNowOnly, results, savedOnly, savedStoreIdSet]);
  const statusFiltersHideAllResults = hasSearched && results.length > 0 && statusFilteredCount === 0;

  const resultSummary = useMemo(() => {
    if (isLoading) {
      return dictionary.searchingLabel;
    }
    if (!hasSearched) {
      return dictionary.mapEmptyState;
    }
    if (statusFiltersHideAllResults) {
      return dictionary.noFilteredResultsLabel;
    }
    if (results.length === 0 && noResultsGuidance?.type === "nearby") {
      return applyTemplate(dictionary.noResultsNearbyTemplate, {
        distance: formatDistance(noResultsGuidance.nearestDistanceMeters)
      });
    }
    if (results.length === 0 && noResultsGuidance?.type === "catalog_gap") {
      return dictionary.noResultsCatalogHint;
    }
    return `${statusFilteredCount} ${dictionary.resultsCountLabel}`;
  }, [
    dictionary.noFilteredResultsLabel,
    dictionary.mapEmptyState,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    dictionary.resultsCountLabel,
    dictionary.searchingLabel,
    statusFilteredCount,
    statusFiltersHideAllResults,
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
    if (statusFiltersHideAllResults) {
      return dictionary.noFilteredResultsLabel;
    }
    if (results.length === 0 && noResultsGuidance?.type === "nearby") {
      return applyTemplate(dictionary.noResultsNearbyTemplate, {
        distance: formatDistance(noResultsGuidance.nearestDistanceMeters)
      });
    }
    if (results.length === 0 && noResultsGuidance?.type === "catalog_gap") {
      return dictionary.noResultsCatalogHint;
    }
    return `${statusFilteredCount} ${dictionary.resultsCountLabel}`;
  }, [
    dictionary.mapEmptyState,
    dictionary.noFilteredResultsLabel,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    dictionary.resultsCountLabel,
    dictionary.searchingLabel,
    errorMessage,
    statusFilteredCount,
    statusFiltersHideAllResults,
    hasSearched,
    isLoading,
    locationMessage,
    routeErrorMessage,
    noResultsGuidance,
    results.length
  ]);

  const noResultsMessage = useMemo(() => {
    if (statusFiltersHideAllResults) {
      return dictionary.noFilteredResultsLabel;
    }
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
    dictionary.noFilteredResultsLabel,
    dictionary.noResults,
    dictionary.noResultsCatalogHint,
    dictionary.noResultsNearbyTemplate,
    statusFiltersHideAllResults,
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

  const quickIntents = useMemo(
    () => [
      { id: "pharmacy", label: dictionary.quickIntentPharmacy },
      { id: "hardware", label: dictionary.quickIntentHardware },
      { id: "spaeti", label: dictionary.quickIntentSpati },
      { id: "essentials", label: dictionary.quickIntentEssentials }
    ],
    [
      dictionary.quickIntentEssentials,
      dictionary.quickIntentHardware,
      dictionary.quickIntentPharmacy,
      dictionary.quickIntentSpati
    ]
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
        openingInfo: evaluateOpeningInfo(result.store.openingHours)
      }))
      .map((entry) => ({
        ...entry,
        openingStatus: entry.openingInfo.status,
        ownershipType: entry.result.store.ownershipType ?? "unknown"
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

  const filteredListResults = useMemo(() => {
    return prioritizedListResults.filter((entry) => {
      if (openNowOnly && entry.openingStatus !== "open") {
        return false;
      }
      if (savedOnly && !savedStoreIdSet.has(entry.result.store.id)) {
        return false;
      }
      if (independentOnly && entry.result.store.ownershipType !== "independent") {
        return false;
      }
      return true;
    });
  }, [independentOnly, openNowOnly, prioritizedListResults, savedOnly, savedStoreIdSet]);

  const visibleListResults = useMemo(() => {
    if (isResultsExpanded) {
      return filteredListResults;
    }
    return filteredListResults.slice(0, COLLAPSED_RESULTS_LIMIT);
  }, [filteredListResults, isResultsExpanded]);

  const selectedResultEntry = useMemo(() => {
    if (filteredListResults.length === 0) {
      return null;
    }
    if (!selectedOfferId) {
      return filteredListResults[0];
    }
    return (
      filteredListResults.find((entry) => entry.result.offer.id === selectedOfferId) ??
      filteredListResults[0]
    );
  }, [filteredListResults, selectedOfferId]);

  const selectedMatchSummary = useMemo(() => {
    if (!selectedResultEntry) {
      return "";
    }

    const matchReason = compactWhyText(selectedResultEntry.result.whyThisProductMatches, 150);
    if (matchReason) {
      return matchReason;
    }

    const categoryLabel = primaryCategory(selectedResultEntry.result, dictionary.unknownCategory);
    return `${dictionary.storeCategoryLabel}: ${categoryLabel}`;
  }, [
    dictionary.storeCategoryLabel,
    dictionary.unknownCategory,
    selectedResultEntry
  ]);

  const hasHiddenListResults = filteredListResults.length > COLLAPSED_RESULTS_LIMIT;

  const compactListSummary = useMemo(() => {
    if (isResultsExpanded || !hasHiddenListResults) {
      return "";
    }
    return applyTemplate(dictionary.compactResultsSummaryTemplate, {
      shown: String(visibleListResults.length),
      total: String(filteredListResults.length)
    });
  }, [
    dictionary.compactResultsSummaryTemplate,
    filteredListResults.length,
    hasHiddenListResults,
    isResultsExpanded,
    visibleListResults.length
  ]);

  const mapResults = useMemo(
    () => filteredListResults.map((entry) => entry.result),
    [filteredListResults]
  );

  const relatedTerms = useMemo(
    () => suggestRelatedTerms(query, quickIntents.map((intent) => intent.label)),
    [query, quickIntents]
  );

  const filtersHideAllResults = hasSearched && results.length > 0 && filteredListResults.length === 0;
  const districtContext = useMemo(() => {
    const firstResult = filteredListResults[0]?.result;
    if (!firstResult) {
      return null;
    }
    const district = firstResult.store.district?.trim();
    if (!district) {
      return null;
    }
    return applyTemplate(dictionary.districtContextTemplate, { district });
  }, [dictionary.districtContextTemplate, filteredListResults]);

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

  const selectedTravel = useMemo(() => {
    if (!selectedResultEntry) {
      return null;
    }
    return estimateTravel(selectedResultEntry.result.distanceMeters);
  }, [estimateTravel, selectedResultEntry]);

  useEffect(() => {
    const searchCache = searchCacheRef.current;
    const routeCache = routeCacheRef.current;

    return () => {
      searchRequestIdRef.current += 1;
      searchAbortRef.current?.abort();
      searchCache.clear();
      routeCache.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeRoute) {
      return;
    }
    const stillVisible = mapResults.some((result) => result.offer.id === activeRoute.offerId);
    if (!stillVisible) {
      setActiveRoute(null);
    }
  }, [activeRoute, mapResults]);

  useEffect(() => {
    if (filteredListResults.length === 0) {
      if (selectedOfferId !== null) {
        setSelectedOfferId(null);
      }
      return;
    }

    const selectedStillExists = selectedOfferId
      ? filteredListResults.some((entry) => entry.result.offer.id === selectedOfferId)
      : false;

    if (!selectedStillExists) {
      setSelectedOfferId(filteredListResults[0]?.result.offer.id ?? null);
    }
  }, [filteredListResults, selectedOfferId]);

  useEffect(() => {
    if (!selectedOfferId) {
      return;
    }

    setFlashedOfferId(selectedOfferId);
    const flashTimeout = setTimeout(() => {
      setFlashedOfferId((current) => (current === selectedOfferId ? null : current));
    }, 760);

    return () => {
      clearTimeout(flashTimeout);
    };
  }, [selectedOfferId]);

  const mapPanelClassName =
    activeRoute && hasSearched
      ? "h-[clamp(248px,42svh,430px)] md:h-[66vh] md:min-h-[360px]"
      : "h-[clamp(320px,56svh,560px)] md:h-[66vh] md:min-h-[360px]";

  function scrollToMapSection() {
    const mapSection = mapSectionRef.current;
    if (!mapSection) {
      return;
    }
    mapSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function inferSearchCategoryFromQuery(searchQuery: string) {
    const normalized = normalizeQueryForAnalytics(searchQuery);
    if (!normalized) {
      return null;
    }
    const matched = quickIntents.find((intent) => normalizeQueryForAnalytics(intent.label) === normalized);
    return matched?.id ?? null;
  }

  async function fetchSearchWithTimeout(
    url: string,
    abortController: AbortController
  ): Promise<Response> {
    const timeoutController = new AbortController();
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      timeoutController.abort("timeout");
    }, SEARCH_TIMEOUT_MS);
    const onAbort = () => timeoutController.abort("aborted");
    abortController.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(url, {
        signal: timeoutController.signal
      });
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (abortController.signal.aborted) {
          throw error;
        }
        if (didTimeout) {
          throw new Error("SEARCH_TIMEOUT");
        }
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      abortController.signal.removeEventListener("abort", onAbort);
    }
  }

  async function logSearchAnalytics(args: {
    searchTerm: string;
    category: string | null;
    radiusKm: number;
    resultsCount: number;
    hasResults: boolean;
    endpoint: string;
  }) {
    try {
      await fetch("/api/analytics/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          searchTerm: args.searchTerm,
          category: args.category,
          lat: safeCenter.lat,
          lng: safeCenter.lng,
          radiusKm: Number(args.radiusKm.toFixed(1)),
          resultsCount: args.resultsCount,
          hasResults: args.hasResults,
          endpoint: args.endpoint
        })
      });
    } catch {
      // Keep analytics best-effort only.
    }
  }

  function triggerQuickIntentSearch(intentId: string, term: string, source: "quick_intent" | "no_results") {
    const trimmed = term.trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setActiveQuickIntent(intentId);
    setErrorMessage(null);
    setRouteErrorMessage(null);
    pulse(8);
    trackEvent("search_quick_term", {
      source,
      term: normalizeQueryForAnalytics(trimmed),
      category: intentId
    });
    void runSearch({ overrideQuery: trimmed, category: intentId });
  }

  function persistRecentSearches(nextRecentSearches: string[]) {
    setRecentSearches(nextRecentSearches);
    if (typeof window === "undefined") {
      return;
    }
    try {
      localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(nextRecentSearches));
    } catch {
      // ignore storage errors
    }
  }

  function addRecentSearch(term: string) {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) {
      return;
    }
    const next = [
      normalizedTerm,
      ...recentSearches.filter(
        (item) => normalizeQueryForAnalytics(item) !== normalizeQueryForAnalytics(normalizedTerm)
      )
    ].slice(0, MAX_RECENT_SEARCHES);
    persistRecentSearches(next);
  }

  function toggleSavedStore(storeId: string) {
    const next = savedStoreIdSet.has(storeId)
      ? savedStoreIds.filter((id) => id !== storeId)
      : [...savedStoreIds, storeId];

    setSavedStoreIds(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(SAVED_STORES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    }
    pulse(7);
  }

  function setRadiusFromPicker(nextRadiusKm: number) {
    const clampedRadius = clampRadiusKm(nextRadiusKm);
    setRadiusKm(clampedRadius);
    pulse(7);
    trackEvent("radius_picker_change", {
      from_km: Number(radiusKm.toFixed(1)),
      to_km: Number(clampedRadius.toFixed(1))
    });
    if (hasSearched && query.trim()) {
      void runSearch({ overrideRadiusKm: clampedRadius });
    }
  }

  async function runSearch(options?: { overrideRadiusKm?: number; overrideQuery?: string; category?: string | null }) {
    const effectiveQuery = (options?.overrideQuery ?? query).trim();
    if (!effectiveQuery) {
      setErrorMessage(dictionary.queryRequiredError);
      pulse(18);
      return;
    }

    const inferredCategory = inferSearchCategoryFromQuery(effectiveQuery);
    const effectiveCategory = options?.category ?? inferredCategory;
    if (effectiveCategory) {
      setActiveQuickIntent(effectiveCategory);
    }

    if (options?.overrideQuery && options.overrideQuery !== query) {
      setQuery(options.overrideQuery);
    }
    if (!options?.category && activeQuickIntent && effectiveCategory !== activeQuickIntent) {
      setActiveQuickIntent(null);
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
    setShowCachedResultBadge(false);
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const queryForAnalytics = normalizeQueryForAnalytics(effectiveQuery);
    trackEvent("search_submit", {
      query_length: effectiveQuery.length,
      radius_km: Number(effectiveRadiusKm.toFixed(1)),
      query_normalized: queryForAnalytics || null,
      category: effectiveCategory
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
          query_normalized: queryForAnalytics || null,
          endpoint: cached.endpointUsed
        });
        return {
          payload: cached.payload,
          cacheHit: true,
          endpointUsed: cached.endpointUsed
        };
      }

      const params = new URLSearchParams({
        q: effectiveQuery,
        lat: String(safeCenter.lat),
        lng: String(safeCenter.lng),
        radius: String(Math.round(radiusKm * 1000))
      });

      const attemptEndpoints = [SEARCH_PRIMARY_ENDPOINT, SEARCH_FALLBACK_ENDPOINT];
      let payload: SearchPayload | null = null;
      let endpointUsed = "unknown";
      let lastAttemptError: unknown = null;

      for (let index = 0; index < attemptEndpoints.length; index += 1) {
        const endpoint = attemptEndpoints[index];
        try {
          const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
          const response = await fetchSearchWithTimeout(url, abortController);
          if (!response.ok) {
            throw new Error(`Search failed with status ${response.status}`);
          }
          payload = (await response.json()) as SearchPayload;
          endpointUsed = payload.endpoint ?? (index === 0 ? "search_api_primary" : "search_api_fallback");
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          lastAttemptError = error;
          if (index === 0) {
            continue;
          }
          throw error;
        }
      }

      if (!payload) {
        throw lastAttemptError ?? new Error("Search failed");
      }

      searchCacheRef.current.set(cacheKey, {
        payload,
        savedAt: Date.now(),
        endpointUsed
      });
      if (searchCacheRef.current.size > 80) {
        const oldestKey = searchCacheRef.current.keys().next().value;
        if (oldestKey) {
          searchCacheRef.current.delete(oldestKey);
        }
      }
      return {
        payload,
        cacheHit: false,
        endpointUsed
      };
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
      const primaryResponse = await fetchSearchPayload(effectiveRadiusKm);
      const data = primaryResponse.payload;
      if (requestId !== searchRequestIdRef.current) {
        return;
      }
      setShowCachedResultBadge(primaryResponse.cacheHit);
      setLastSearchEndpoint(primaryResponse.endpointUsed);

      const primaryResults = sanitizeResults(Array.isArray(data?.results) ? data.results : [], effectiveRadiusKm);
      let guidance: NoResultsGuidance | null = null;

      if (primaryResults.length === 0) {
        if (effectiveRadiusKm < MAX_RADIUS_KM) {
          const nearbyResponse = await fetchSearchPayload(MAX_RADIUS_KM);
          const nearbyData = nearbyResponse.payload;
          if (requestId !== searchRequestIdRef.current) {
            return;
          }
          if (nearbyResponse.cacheHit) {
            setShowCachedResultBadge(true);
          }
          setLastSearchEndpoint((current) => current ?? nearbyResponse.endpointUsed);

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
      addRecentSearch(effectiveQuery);
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
      void logSearchAnalytics({
        searchTerm: effectiveQuery,
        category: effectiveCategory,
        radiusKm: effectiveRadiusKm,
        resultsCount: primaryResults.length,
        hasResults: primaryResults.length > 0,
        endpoint: primaryResponse.endpointUsed
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
      const isTimeoutError =
        error instanceof Error &&
        (error.message === "SEARCH_TIMEOUT" || error.message.includes("status 504"));
      trackEvent("search_error", {
        radius_km: Number(effectiveRadiusKm.toFixed(1)),
        duration_ms: Math.round(finishedAt - startedAt),
        timeout: isTimeoutError
      });
      void logSearchAnalytics({
        searchTerm: effectiveQuery,
        category: effectiveCategory,
        radiusKm: effectiveRadiusKm,
        resultsCount: -1,
        hasResults: false,
        endpoint: isTimeoutError ? "search_timeout" : "search_failed"
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

  async function drawRouteOnMap(result: SearchResult, mode: RouteMode) {
    const routeKey = `${result.offer.id}:${mode}`;
    const isActiveSameRoute =
      activeRoute?.offerId === result.offer.id && activeRoute.mode === mode;
    setSelectedOfferId(result.offer.id);
    scrollToMapSection();

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
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQuery(nextValue);
                  if (activeQuickIntent) {
                    const activeLabel =
                      quickIntents.find((intent) => intent.id === activeQuickIntent)?.label ?? "";
                    if (normalizeQueryForAnalytics(nextValue) !== normalizeQueryForAnalytics(activeLabel)) {
                      setActiveQuickIntent(null);
                    }
                  }
                }}
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
                className="btn-primary search-submit search-action-btn min-w-[108px] sm:min-w-[124px] md:min-w-[150px] disabled:cursor-not-allowed"
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
              {quickIntents.map((intent) => (
                <button
                  key={intent.id}
                  type="button"
                  className={`btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem] ${
                    activeQuickIntent === intent.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    triggerQuickIntentSearch(intent.id, intent.label, "quick_intent");
                  }}
                  disabled={isLoading}
                >
                  {intent.label}
                </button>
              ))}
            </div>
            {recentSearches.length > 0 ? (
              <div className="quick-intents quick-intents-recent md:col-span-3" aria-label={dictionary.recentSearchesLabel}>
                <span className="status-text">{dictionary.recentSearchesLabel}</span>
                {recentSearches.map((term) => (
                  <button
                    key={`recent-${term}`}
                    type="button"
                    className="btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem]"
                    onClick={() => {
                      setQuery(term);
                      setActiveQuickIntent(null);
                      void runSearch({ overrideQuery: term, category: null });
                    }}
                    disabled={isLoading}
                  >
                    {term}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="search-compact-controls md:col-span-3">
              <label htmlFor="radius-km-picker" className="note-label">
                {dictionary.radiusLabel}
              </label>
              <select
                id="radius-km-picker"
                value={formatRadiusValue(radiusKm)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isNaN(next)) {
                    setRadiusFromPicker(next);
                  }
                }}
                className="field-input radius-picker"
              >
                {RADIUS_PICKER_OPTIONS.map((option) => (
                  <option key={`radius-${option}`} value={formatRadiusValue(option)}>
                    {formatRadiusKm(option)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`btn-ghost compact-toggle ${openNowOnly ? "is-active" : ""}`}
                onClick={() => {
                  setOpenNowOnly((current) => !current);
                  pulse(6);
                }}
              >
                {dictionary.openNowOnlyLabel}
              </button>
              <button
                type="button"
                className={`btn-ghost compact-toggle ${savedOnly ? "is-active" : ""}`}
                onClick={() => {
                  setSavedOnly((current) => !current);
                  pulse(6);
                }}
              >
                {dictionary.savedOnlyLabel}
              </button>
              <button
                type="button"
                className={`btn-ghost compact-toggle ${independentOnly ? "is-active" : ""}`}
                onClick={() => {
                  setIndependentOnly((current) => !current);
                  pulse(6);
                }}
              >
                {dictionary.independentOnlyLabel}
              </button>
            </div>
          </div>
        </div>

        {(locationMessage || errorMessage) && (
          <div className="p-2.5 md:p-3" role="status" aria-live="polite" aria-atomic="true">
            {locationMessage ? <p className="status-text">{locationMessage}</p> : null}
            {errorMessage ? <p className="status-text status-error">{errorMessage}</p> : null}
          </div>
        )}
      </section>

      <section id="map" ref={mapSectionRef} className="space-y-1.5 md:space-y-2">
        <div className="hand-divider flex items-end justify-end pb-2">
          <div className="flex items-center gap-2">
            {showCachedResultBadge && !isLoading ? (
              <span className="status-chip" title={lastSearchEndpoint ?? undefined}>
                {dictionary.cachedResultLabel}
              </span>
            ) : null}
            <p className="status-text">{resultSummary}</p>
          </div>
        </div>
        {districtContext ? <p className="status-text -mt-1">{districtContext}</p> : null}
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
          results={mapResults}
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
          isLoading={isLoading}
          loadingLabel={dictionary.searchingLabel}
          cacheIndicatorLabel={showCachedResultBadge && !isLoading ? dictionary.cachedResultLabel : null}
          className={mapPanelClassName}
        />

        {!isLoading && hasSearched && (results.length === 0 || filtersHideAllResults) ? (
          <div className="note-empty no-results-box p-3">
            <p>{noResultsMessage}</p>
            {noResultsGuidance?.type === "nearby" && !filtersHideAllResults ? (
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
            {filtersHideAllResults ? (
              <button
                type="button"
                className="btn-secondary mt-2 w-full text-[0.76rem] md:w-auto"
                onClick={() => {
                  setOpenNowOnly(false);
                  setSavedOnly(false);
                  pulse(7);
                }}
              >
                {dictionary.clearFiltersAction}
              </button>
            ) : null}
            <p className="status-text mt-2">{dictionary.noResultsRefineHint}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="status-text">{dictionary.noResultsSuggestionLabel}</span>
              {quickIntents.map((intent) => (
                <button
                  key={`no-results-${intent.id}`}
                  type="button"
                  className={`btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem] ${
                    activeQuickIntent === intent.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    triggerQuickIntentSearch(intent.id, intent.label, "no_results");
                  }}
                  disabled={isLoading}
                >
                  {intent.label}
                </button>
              ))}
            </div>
            {relatedTerms.length > 0 ? (
              <>
                <p className="status-text mt-2">{dictionary.relatedTermsLabel}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {relatedTerms.map((term) => (
                    <button
                      key={`related-${term}`}
                      type="button"
                      className="btn-ghost quick-intent-chip px-2.5 py-1.5 text-[0.72rem]"
                      onClick={() => {
                        setQuery(term);
                        setActiveQuickIntent(null);
                        void runSearch({ overrideQuery: term, category: null });
                      }}
                      disabled={isLoading}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {filteredListResults.length > 0 ? (
          <section className="note-divider pt-2">
            {selectedResultEntry ? (
              <article
                id="selected-store-card"
                key={selectedResultEntry.result.offer.id}
                className={`store-item selected-store-card ${openingStatusToneClass(
                  selectedResultEntry.openingStatus
                )} is-selected selected-store-card-enter`}
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
                      {formatOpeningStatusWithDetails(dictionary, selectedResultEntry.openingInfo)}
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
                <p className="selected-store-match">
                  <UiIcon kind="note" className="store-detail-icon" />
                  <span>
                    {dictionary.whyMatchLabel}: {selectedMatchSummary}
                  </span>
                </p>
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
                    <UiIcon kind="category" className="store-detail-icon" />
                    <span>
                      {dictionary.ownershipLabel}:{" "}
                      {formatStoreOwnership(dictionary, selectedResultEntry.result.store.ownershipType)}
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
                  <div className="store-meta-wrap">
                    <span className="store-meta-chip">
                      {dictionary.confidenceLabel}:{" "}
                      {formatConfidencePercent(
                        selectedResultEntry.result.confidence,
                        dictionary.unknownConfidence
                      )}
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
                    {savedStoreIdSet.has(selectedResultEntry.result.store.id) ? (
                      <span className="store-meta-chip">{dictionary.savedStoreLabel}</span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(() => {
                      const travel = selectedTravel ?? estimateTravel(selectedResultEntry.result.distanceMeters);
                      const walkRouteKey = `${selectedResultEntry.result.offer.id}:walk`;
                      const bikeRouteKey = `${selectedResultEntry.result.offer.id}:bike`;
                      const walkRouteActive =
                        activeRoute?.offerId === selectedResultEntry.result.offer.id && activeRoute.mode === "walk";
                      const bikeRouteActive =
                        activeRoute?.offerId === selectedResultEntry.result.offer.id && activeRoute.mode === "bike";
                      const walkRouteLoading = routeLoadingKey === walkRouteKey;
                      const bikeRouteLoading = routeLoadingKey === bikeRouteKey;
                      const phoneHref = sanitizePhoneHref(selectedResultEntry.result.store.phone);
                      const isSavedStore = savedStoreIdSet.has(selectedResultEntry.result.store.id);

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
                                : `${dictionary.routeOnMapAction} · ${dictionary.walkTimeLabel} ${travel.walkMin}m`}
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
                              : `${dictionary.routeOnMapAction} · ${dictionary.bikeTimeLabel} ${travel.bikeMin}m`}
                          </button>
                          {phoneHref ? (
                            <a
                              href={phoneHref}
                              className="btn-ghost inline-flex text-[0.72rem] px-2.5 py-1.5"
                              onClick={() => {
                                trackEvent("store_call_click", {
                                  store_id: selectedResultEntry.result.store.id
                                });
                              }}
                            >
                              {dictionary.callStoreAction}
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className={`btn-ghost inline-flex text-[0.72rem] px-2.5 py-1.5 ${isSavedStore ? "is-active" : ""}`}
                            onClick={() => {
                              toggleSavedStore(selectedResultEntry.result.store.id);
                            }}
                          >
                            {isSavedStore ? dictionary.unsaveStoreAction : dictionary.saveStoreAction}
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
                {openNowOnly || savedOnly || independentOnly ? (
                  <button
                    type="button"
                    className="btn-ghost text-[0.72rem] px-2.5 py-1.5"
                    onClick={() => {
                      setOpenNowOnly(false);
                      setSavedOnly(false);
                      setIndependentOnly(false);
                      pulse(7);
                    }}
                    disabled={isLoading}
                  >
                    {dictionary.clearFiltersAction}
                  </button>
                ) : null}
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
              {visibleListResults.map(({ result, openingStatus, openingInfo }, index) => {
                const travel = estimateTravel(result.distanceMeters);
                const isSelected = selectedOfferId === result.offer.id;
                const phoneHref = sanitizePhoneHref(result.store.phone);
                const rowWalkRouteKey = `${result.offer.id}:walk`;
                const rowWalkRouteActive =
                  activeRoute?.offerId === result.offer.id && activeRoute.mode === "walk";
                const rowWalkRouteLoading = routeLoadingKey === rowWalkRouteKey;

                return (
                  <div
                    key={result.offer.id}
                    className={`store-item result-enter ${openingStatusToneClass(openingStatus)} ${
                      isSelected ? "is-selected" : ""
                    } ${flashedOfferId === result.offer.id ? "is-flashing" : ""}`}
                    style={{ animationDelay: `${Math.min(index, 10) * 26}ms` }}
                  >
                    <div className="store-summary-row">
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
                            {formatOpeningStatusWithDetails(dictionary, openingInfo)}
                          </span>
                          <span className="store-summary-inline-meta">
                            {formatStoreOwnership(dictionary, result.store.ownershipType)}
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
                          {result.validationStatus === "validated" ? (
                            <span className={`store-summary-badge store-summary-desktop-meta ${validationToneClass(result.validationStatus)}`}>
                              {formatValidation(dictionary, result.validationStatus)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <div className="store-row-actions">
                        <button
                          type="button"
                          className={`btn-ghost px-2 py-1 text-[0.66rem] ${rowWalkRouteActive ? "is-active" : ""}`}
                          disabled={rowWalkRouteLoading}
                          onClick={() => {
                            void drawRouteOnMap(result, "walk");
                          }}
                        >
                          {rowWalkRouteLoading
                            ? dictionary.routeLoadingLabel
                            : rowWalkRouteActive
                              ? dictionary.clearRouteAction
                              : dictionary.routeAction}
                        </button>
                        {phoneHref ? (
                          <a
                            href={phoneHref}
                            className="btn-ghost px-2 py-1 text-[0.66rem]"
                            onClick={() => {
                              trackEvent("store_call_click", {
                                store_id: result.store.id
                              });
                            }}
                          >
                            {dictionary.callStoreAction}
                          </a>
                        ) : null}
                      </div>
                    </div>
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
