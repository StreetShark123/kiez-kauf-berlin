"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Doodle } from "@/components/Doodle";
import { LocalMap } from "@/components/LocalMap";
import { PresenceFeedback } from "@/components/PresenceFeedback";
import { track } from "@vercel/analytics";
import type { Dictionary } from "@/lib/i18n";
import { categoryLabel } from "@/lib/category-labels";
import { estimateTravelMinutes } from "@/lib/maps";
import { evaluateOpeningInfo, type OpeningInfo, type OpeningStatus } from "@/lib/opening-hours";
import type { Locale, SearchResult } from "@/lib/types";

type SearchPayload = {
  engine?: "presence" | "legacy";
  query: string;
  origin: { lat: number; lng: number };
  radius: number;
  results: SearchResult[];
  service_fallback?: SearchResult[];
  result_mode?: "products_only" | "products_plus_services" | "services_fallback_only";
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
const COLLAPSED_RESULTS_LIMIT = 6;
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
const QUICK_INTENT_KEYWORDS: Record<string, string[]> = {
  pharmacy: ["pharmacy", "apotheke", "apotheke berlin", "drugstore", "chemist"],
  hardware: ["hardware", "tool", "tools", "baumarkt", "diy", "ferreteria"],
  spaeti: ["spaeti", "spati", "kiosk", "convenience", "late shop"],
  essentials: ["essentials", "basic", "basics", "groceries", "grocery", "lebensmittel"]
};

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

function formatValidation(dictionary: Dictionary, status: SearchResult["validationStatus"]) {
  if (status === "validated") return dictionary.validationValidated;
  if (status === "likely") return dictionary.validationLikely;
  if (status === "rejected") return dictionary.validationRejected;
  return dictionary.validationUnvalidated;
}

function humanizeProductName(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function resolveDisplayValidationStatus(
  result: Pick<SearchResult, "validationStatus" | "confidence">
): NonNullable<SearchResult["validationStatus"]> {
  if (result.validationStatus) {
    return result.validationStatus;
  }
  const confidence = result.confidence;
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0.66) {
    return "likely";
  }
  return "unvalidated";
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

function displayProductName(product: SearchResult["product"]) {
  const readable = humanizeProductName(product.displayName ?? product.normalizedName);
  return readable || product.normalizedName;
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
  initialCenter,
  locale = "de"
}: {
  dictionary: Dictionary;
  initialCenter: { lat: number; lng: number };
  locale?: Locale;
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
  const [, setShowCachedResultBadge] = useState(false);
  const [, setLastSearchEndpoint] = useState<string | null>(null);
  const [lastSearchEngine, setLastSearchEngine] = useState<"presence" | "legacy" | null>(null);
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState<string>("");
  // Mobile only: the map is opt-in so results come first. Desktop always shows it (CSS).
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [activeRecentIndex, setActiveRecentIndex] = useState(-1);
  const lastHapticAtRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const loggedMalformedResultKeysRef = useRef<Set<string>>(new Set());
  const loggedInvalidCenterRef = useRef(false);
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map());
  const routeCacheRef = useRef<Map<string, RouteCacheEntry>>(new Map());
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const searchInputBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    routeRequestIdRef.current += 1;
    routeAbortRef.current?.abort();
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

  useEffect(() => {
    return () => {
      if (searchInputBlurTimeoutRef.current) {
        clearTimeout(searchInputBlurTimeoutRef.current);
        searchInputBlurTimeoutRef.current = null;
      }
    };
  }, []);

  const savedStoreIdSet = useMemo(() => new Set(savedStoreIds), [savedStoreIds]);
  const resultsWithOpeningInfo = useMemo(() => {
    return results.map((result) => {
      const openingInfo = evaluateOpeningInfo(result.store.openingHours);
      return {
        result,
        openingInfo,
        openingStatus: openingInfo.status
      };
    });
  }, [results]);
  const statusFilteredCount = useMemo(() => {
    return resultsWithOpeningInfo.reduce((count, entry) => {
      if (openNowOnly && entry.openingStatus !== "open") {
        return count;
      }
      if (savedOnly && !savedStoreIdSet.has(entry.result.store.id)) {
        return count;
      }
      if (independentOnly && entry.result.store.ownershipType !== "independent") {
        return count;
      }
      return count + 1;
    }, 0);
  }, [independentOnly, openNowOnly, resultsWithOpeningInfo, savedOnly, savedStoreIdSet]);
  const statusFiltersHideAllResults = hasSearched && results.length > 0 && statusFilteredCount === 0;

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
    return [...resultsWithOpeningInfo].sort((a, b) => {
        const statusDelta = openingStatusSortRank(a.openingStatus) - openingStatusSortRank(b.openingStatus);
        if (statusDelta !== 0) {
          return statusDelta;
        }

        // The presence engine already ranks by probability discounted by distance; re-sorting by
        // distance alone would put a "possible" shop next door above a "likely" one 200 m away.
        if (lastSearchEngine === "presence") {
          return a.result.rank - b.result.rank;
        }

        const distanceDelta = a.result.distanceMeters - b.result.distanceMeters;
        if (distanceDelta !== 0) {
          return distanceDelta;
        }

        return b.result.rank - a.result.rank;
      });
  }, [lastSearchEngine, resultsWithOpeningInfo]);

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

  const hasHiddenListResults = filteredListResults.length > COLLAPSED_RESULTS_LIMIT;

  const mapResults = useMemo(
    () => filteredListResults.map((entry) => entry.result),
    [filteredListResults]
  );

  const relatedTerms = useMemo(
    () => suggestRelatedTerms(query, quickIntents.map((intent) => intent.label)),
    [query, quickIntents]
  );
  const visibleRecentSearches = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return recentSearches.slice(0, 7);
    }
    const normalized = normalizeQueryForAnalytics(trimmedQuery);
    return recentSearches
      .filter((term) => normalizeQueryForAnalytics(term).includes(normalized))
      .slice(0, 7);
  }, [query, recentSearches]);
  const showRecentSearchesDropdown = isSearchInputFocused && visibleRecentSearches.length > 0;

  useEffect(() => {
    if (!showRecentSearchesDropdown) {
      setActiveRecentIndex(-1);
      return;
    }
    setActiveRecentIndex((current) => {
      if (current >= 0 && current < visibleRecentSearches.length) {
        return current;
      }
      return 0;
    });
  }, [showRecentSearchesDropdown, visibleRecentSearches.length]);

  const filtersHideAllResults = hasSearched && results.length > 0 && filteredListResults.length === 0;
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
      routeRequestIdRef.current += 1;
      routeAbortRef.current?.abort();
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

    // null means "all cards collapsed" (user choice); only repair a selection that vanished.
    if (selectedOfferId && !filteredListResults.some((entry) => entry.result.offer.id === selectedOfferId)) {
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

  function scrollToMapSection(force = false) {
    if (typeof window === "undefined") {
      return;
    }
    const mapSection = mapSectionRef.current;
    if (!mapSection) {
      return;
    }

    const rect = mapSection.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const sectionMostlyVisible = rect.top <= viewportHeight * 0.2 && rect.bottom >= viewportHeight * 0.72;

    if (!force && sectionMostlyVisible) {
      return;
    }

    const topOffset = window.innerWidth < 768 ? 8 : 12;
    const ensureVisible = (behavior: ScrollBehavior = "smooth") => {
      const nextRect = mapSection.getBoundingClientRect();
      const mapTopVisible = nextRect.top <= 18;
      const mapHasEnoughViewport = nextRect.bottom >= Math.min(window.innerHeight * 0.58, 360);
      if (mapTopVisible && mapHasEnoughViewport) {
        return;
      }

      const targetTop = Math.max(0, window.scrollY + nextRect.top - topOffset);
      window.scrollTo({
        top: targetTop,
        behavior
      });
    };

    // First try native alignment (Safari behaves very well here).
    mapSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest"
    });

    // Chrome can occasionally ignore/under-scroll during layout updates; verify and fallback.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ensureVisible("smooth");
      });
    });

    setTimeout(() => {
      ensureVisible("auto");
    }, 170);
  }

  function inferSearchCategoryFromQuery(searchQuery: string) {
    const normalized = normalizeQueryForAnalytics(searchQuery);
    if (!normalized) {
      return null;
    }

    const includesTerm = (haystack: string, needle: string) => {
      if (!needle) {
        return false;
      }
      if (haystack === needle) {
        return true;
      }
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`).test(haystack);
    };

    for (const intent of quickIntents) {
      const normalizedLabel = normalizeQueryForAnalytics(intent.label);
      if (includesTerm(normalized, normalizedLabel)) {
        return intent.id;
      }

      const keywords = QUICK_INTENT_KEYWORDS[intent.id] ?? [];
      for (const keyword of keywords) {
        const normalizedKeyword = normalizeQueryForAnalytics(keyword);
        if (includesTerm(normalized, normalizedKeyword)) {
          return intent.id;
        }
      }
    }

    return null;
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
    reason?: "no_results_products" | "no_results_any" | null;
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
          endpoint: args.endpoint,
          reason: args.reason ?? null
        })
      });
    } catch {
      // Keep analytics best-effort only.
    }
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

  function selectRecentSearch(term: string) {
    setQuery(term);
    setActiveQuickIntent(null);
    setIsSearchInputFocused(false);
    setActiveRecentIndex(-1);
    void runSearch({ overrideQuery: term, category: null });
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
    routeRequestIdRef.current += 1;
    routeAbortRef.current?.abort();
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
        radius: String(Math.round(radiusKm * 1000)),
        locale
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
      const serviceFallbackResults = sanitizeResults(
        Array.isArray(data?.service_fallback) ? data.service_fallback : [],
        effectiveRadiusKm
      ).map((result) => ({
        ...result,
        resultKind: "service" as const
      }));
      const displayResults =
        primaryResults.length > 0 ? primaryResults : serviceFallbackResults;
      const analyticsReason: "no_results_products" | "no_results_any" | null =
        primaryResults.length === 0
          ? serviceFallbackResults.length > 0
            ? "no_results_products"
            : "no_results_any"
          : null;
      let guidance: NoResultsGuidance | null = null;

      if (displayResults.length === 0) {
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

          const nearbyPrimaryResults = sanitizeResults(
            Array.isArray(nearbyData?.results) ? nearbyData.results : [],
            MAX_RADIUS_KM
          );
          const nearbyServiceFallbackResults = sanitizeResults(
            Array.isArray(nearbyData?.service_fallback) ? nearbyData.service_fallback : [],
            MAX_RADIUS_KM
          );
          const nearbyResults =
            nearbyPrimaryResults.length > 0 ? nearbyPrimaryResults : nearbyServiceFallbackResults;
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

      setResults(displayResults);
      setLastSearchEngine(data?.engine ?? "legacy");
      setLastSubmittedQuery(effectiveQuery);
      setSelectedOfferId(displayResults[0]?.offer.id ?? null);
      setHasSearched(true);
      setNoResultsGuidance(guidance);
      addRecentSearch(effectiveQuery);
      const withOpeningHours = displayResults.filter(
        (result) => typeof result.store.openingHours === "string" && result.store.openingHours.trim().length > 0
      ).length;
      const validatedCount = displayResults.filter((result) => result.validationStatus === "validated").length;
      const likelyCount = displayResults.filter((result) => result.validationStatus === "likely").length;
      const avgConfidence =
        displayResults.length > 0
          ? Number(
              (
                displayResults.reduce(
                  (sum, result) => sum + (typeof result.confidence === "number" ? result.confidence : 0),
                  0
                ) / displayResults.length
              ).toFixed(3)
            )
          : 0;
      const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      trackEvent("search_success", {
        results_count: displayResults.length,
        product_results_count: primaryResults.length,
        service_fallback_count: serviceFallbackResults.length,
        result_mode: data?.result_mode ?? null,
        radius_km: Number(effectiveRadiusKm.toFixed(1)),
        duration_ms: Math.round(finishedAt - startedAt),
        no_results_guidance: guidance?.type ?? null,
        suggested_radius_km: guidance?.type === "nearby" ? Number(guidance.suggestedRadiusKm.toFixed(1)) : null
      });
      trackEvent("search_quality_snapshot", {
        results_count: displayResults.length,
        product_results_count: primaryResults.length,
        service_fallback_count: serviceFallbackResults.length,
        with_opening_hours: withOpeningHours,
        validated_count: validatedCount,
        likely_count: likelyCount,
        avg_confidence: avgConfidence
      });
      void logSearchAnalytics({
        searchTerm: effectiveQuery,
        category: effectiveCategory,
        radiusKm: effectiveRadiusKm,
        resultsCount: displayResults.length,
        hasResults: displayResults.length > 0,
        endpoint: primaryResponse.endpointUsed,
        reason: analyticsReason
      });
      if (displayResults.length === 0) {
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
    scrollToMapSection(true);

    if (isActiveSameRoute) {
      routeRequestIdRef.current += 1;
      routeAbortRef.current?.abort();
      setActiveRoute(null);
      setRouteErrorMessage(null);
      trackEvent("route_clear_on_map", {
        offer_id: result.offer.id,
        mode
      });
      requestAnimationFrame(() => {
        scrollToMapSection(true);
      });
      return;
    }

    routeRequestIdRef.current += 1;
    const requestId = routeRequestIdRef.current;
    routeAbortRef.current?.abort();
    const routeAbortController = new AbortController();
    routeAbortRef.current = routeAbortController;
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
        requestAnimationFrame(() => {
          scrollToMapSection(true);
        });
        setRouteLoadingKey((current) => (current === routeKey ? null : current));
        if (routeAbortRef.current === routeAbortController) {
          routeAbortRef.current = null;
        }
        return;
      }

      const params = new URLSearchParams({
        mode,
        originLat: String(safeCenter.lat),
        originLng: String(safeCenter.lng),
        destinationLat: String(result.store.lat),
        destinationLng: String(result.store.lng)
      });

      const response = await fetch(`/api/route?${params.toString()}`, {
        signal: routeAbortController.signal
      });
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
      requestAnimationFrame(() => {
        scrollToMapSection(true);
      });
      pulse([8, 18, 8]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
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
      if (routeAbortRef.current === routeAbortController) {
        routeAbortRef.current = null;
      }
    }
  }

  const onMapMarkerSelect = useCallback((result: SearchResult) => {
    setSelectedOfferId(result.offer.id);
    requestAnimationFrame(() => {
      document.getElementById(`result-row-${result.offer.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const onMapManualCenterChange = useCallback(
    (nextCenter: { lat: number; lng: number }) => {
      setCenter(nextCenter);
      resetSearchForLocationChange(dictionary.manualPinHint);
    },
    [dictionary.manualPinHint, resetSearchForLocationChange]
  );

  const showResultsArea = hasSearched || isLoading;
  const usingUserLocation =
    geolocationPermission === "granted" ||
    center.lat !== safeInitialCenter.lat ||
    center.lng !== safeInitialCenter.lng;
  const resultsHeading = (() => {
    const first = filteredListResults[0]?.result;
    const productLabel = first && lastSearchEngine === "presence" ? displayProductName(first.product) : lastSubmittedQuery;
    const [before, after = ""] = applyTemplate(dictionary.resultsHeadingTemplate, {
      count: String(filteredListResults.length)
    }).split("{product}");
    return (
      <>
        {before}
        <mark className="nb-mark">{productLabel}</mark>
        {after}
      </>
    );
  })();

  function openRoute(result: SearchResult, mode: RouteMode) {
    setIsMapVisible(true);
    void drawRouteOnMap(result, mode);
  }

  return (
    <section className={`nb ${showResultsArea ? "nb-has-results" : "nb-idle"}`}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </p>

      <header className="nb-hero">
        <p className="nb-kicker mono">{dictionary.appTitle}</p>
        {!showResultsArea ? (
          <>
            <Doodle kind="kiez" />
            <h1 className="nb-title">{dictionary.heroTitle}</h1>
          </>
        ) : null}

        <form
          className="nb-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <label className="sr-only" htmlFor="search-query-input">
            {dictionary.searchPlaceholder}
          </label>
          <div className="nb-search-field">
            <UiIcon kind="search" className="nb-search-icon" />
            <input
              id="search-query-input"
              value={query}
              autoComplete="off"
              enterKeyHint="search"
              onChange={(event) => {
                const nextValue = event.target.value;
                setQuery(nextValue);
                if (activeQuickIntent) {
                  const activeLabel = quickIntents.find((intent) => intent.id === activeQuickIntent)?.label ?? "";
                  if (normalizeQueryForAnalytics(nextValue) !== normalizeQueryForAnalytics(activeLabel)) {
                    setActiveQuickIntent(null);
                  }
                }
              }}
              onKeyDown={(event) => {
                if (showRecentSearchesDropdown && event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveRecentIndex((current) => Math.min(current + 1, visibleRecentSearches.length - 1));
                  return;
                }
                if (showRecentSearchesDropdown && event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveRecentIndex((current) => Math.max(current - 1, 0));
                  return;
                }
                if (showRecentSearchesDropdown && event.key === "Escape") {
                  event.preventDefault();
                  setIsSearchInputFocused(false);
                  setActiveRecentIndex(-1);
                  return;
                }
                if (event.key === "Enter" && showRecentSearchesDropdown && activeRecentIndex >= 0) {
                  const highlighted = visibleRecentSearches[activeRecentIndex];
                  if (highlighted) {
                    event.preventDefault();
                    selectRecentSearch(highlighted);
                  }
                }
              }}
              onFocus={() => {
                if (searchInputBlurTimeoutRef.current) {
                  clearTimeout(searchInputBlurTimeoutRef.current);
                  searchInputBlurTimeoutRef.current = null;
                }
                setIsSearchInputFocused(true);
              }}
              onBlur={() => {
                if (searchInputBlurTimeoutRef.current) {
                  clearTimeout(searchInputBlurTimeoutRef.current);
                }
                searchInputBlurTimeoutRef.current = setTimeout(() => {
                  setIsSearchInputFocused(false);
                  searchInputBlurTimeoutRef.current = null;
                }, 120);
              }}
              placeholder={dictionary.searchPlaceholder}
              className="nb-search-input"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={showRecentSearchesDropdown}
              aria-controls="recent-searches-listbox"
              aria-activedescendant={
                showRecentSearchesDropdown && activeRecentIndex >= 0 ? `recent-option-${activeRecentIndex}` : undefined
              }
            />
            {showRecentSearchesDropdown ? (
              <div
                id="recent-searches-listbox"
                className="nb-recent"
                role="listbox"
                aria-label={dictionary.recentSearchesLabel}
              >
                <p className="nb-recent-label mono">{dictionary.recentSearchesLabel}</p>
                {visibleRecentSearches.map((term, index) => (
                  <button
                    key={`recent-dropdown-${term}-${index}`}
                    id={`recent-option-${index}`}
                    type="button"
                    className="nb-recent-item"
                    role="option"
                    aria-selected={activeRecentIndex === index}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectRecentSearch(term);
                    }}
                    onMouseEnter={() => setActiveRecentIndex(index)}
                    disabled={isLoading}
                  >
                    {term}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="submit" disabled={isLoading} className="nb-btn nb-btn-primary" aria-busy={isLoading}>
            {isLoading ? dictionary.searchingLabel : dictionary.searchButton}
          </button>
        </form>

        <p className="nb-where">
          <UiIcon kind="distance" className="nb-inline-icon" />
          <span>
            {dictionary.nearLabel}{" "}
            <strong>{usingUserLocation ? dictionary.nearYourLocation : dictionary.nearDefaultArea}</strong>
          </span>
          {geolocationPermission !== "granted" && geolocationPermission !== "unsupported" ? (
            <button
              type="button"
              className="nb-link"
              onClick={() => requestBrowserLocation()}
              disabled={isLocating}
            >
              {isLocating ? dictionary.searchingLabel : dictionary.useMyLocation}
            </button>
          ) : null}
        </p>

        {!showResultsArea ? (
          <p className="nb-try">
            <span className="nb-hand">{dictionary.tryLabel}:</span>{" "}
            {quickIntents.map((intent, index) => (
              <span key={`try-${intent.id}`}>
                <button
                  type="button"
                  className="nb-link"
                  onClick={() => {
                    setQuery(intent.label);
                    setActiveQuickIntent(intent.id);
                    void runSearch({ overrideQuery: intent.label, category: intent.id });
                  }}
                  disabled={isLoading}
                >
                  {intent.label}
                </button>
                {index < quickIntents.length - 1 ? <span aria-hidden="true"> · </span> : null}
              </span>
            ))}
          </p>
        ) : null}

        {errorMessage || (locationMessage && locationMessage !== dictionary.manualPinHint) ? (
          <div className="nb-status" role="status" aria-live="polite" aria-atomic="true">
            {errorMessage ? <p className="nb-status-error">{errorMessage}</p> : null}
            {/* The map shows its own drag-the-pin affordance; don't repeat it as text. */}
            {!errorMessage && locationMessage && locationMessage !== dictionary.manualPinHint ? <p>{locationMessage}</p> : null}
          </div>
        ) : null}
      </header>

      {showResultsArea ? (
        <div className="nb-results">
          <div className="nb-toolbar">
            <label htmlFor="radius-km-picker" className="nb-toolbar-label mono">
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
              className="nb-select mono"
            >
              {RADIUS_PICKER_OPTIONS.map((option) => (
                <option key={`radius-${option}`} value={formatRadiusValue(option)}>
                  {formatRadiusKm(option)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`nb-chip ${openNowOnly ? "is-active" : ""}`}
              aria-pressed={openNowOnly}
              onClick={() => {
                setOpenNowOnly((current) => !current);
                pulse(6);
              }}
            >
              {dictionary.openNowOnlyLabel}
            </button>
            {savedStoreIds.length > 0 ? (
              <button
                type="button"
                className={`nb-chip ${savedOnly ? "is-active" : ""}`}
                aria-pressed={savedOnly}
                onClick={() => {
                  setSavedOnly((current) => !current);
                  pulse(6);
                }}
              >
                {dictionary.savedOnlyLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="nb-chip nb-map-toggle"
              aria-pressed={isMapVisible}
              onClick={() => setIsMapVisible((current) => !current)}
            >
              {isMapVisible ? dictionary.hideMapAction : dictionary.showMapAction}
            </button>
          </div>

          <div className="nb-columns">
            <div className="nb-list-col">
              {isLoading && filteredListResults.length === 0 ? (
                <div className="nb-loading-wrap">
                  <Doodle kind="searching" />
                  <p className="nb-loading nb-hand">{dictionary.searchingLabel}</p>
                </div>
              ) : null}

              {filteredListResults.length > 0 ? (
                <>
                  <h2 className="nb-results-heading">{resultsHeading}</h2>
                  <ol className="nb-list" aria-label={dictionary.resultsTitle}>
                    {visibleListResults.map(({ result, openingStatus, openingInfo }, index) => {
                      const isOpen = selectedOfferId === result.offer.id;
                      const status = resolveDisplayValidationStatus(result);
                      const tierClass =
                        status === "validated" ? "is-confirmed" : status === "likely" ? "is-likely" : "is-possible";
                      const travel = estimateTravel(result.distanceMeters);
                      const category = categoryLabel(result.store.osmCategory, locale);
                      const openingLabel =
                        openingStatus === "unknown" ? null : formatOpeningStatusWithDetails(dictionary, openingInfo);
                      const walkRouteActive = activeRoute?.offerId === result.offer.id && activeRoute.mode === "walk";
                      const bikeRouteActive = activeRoute?.offerId === result.offer.id && activeRoute.mode === "bike";
                      const routeLoading = routeLoadingKey?.startsWith(`${result.offer.id}:`) ?? false;
                      const phoneHref = sanitizePhoneHref(result.store.phone);
                      const isSaved = savedStoreIdSet.has(result.store.id);
                      const confirmedAgo =
                        status === "validated" && result.lastCheckedAt
                          ? formatRelativeCheckedAt(result.lastCheckedAt, {
                              checkedUnknown: dictionary.checkedUnknown,
                              checkedToday: dictionary.checkedToday,
                              checkedYesterday: dictionary.checkedYesterday,
                              checkedDaysAgoTemplate: dictionary.checkedDaysAgoTemplate
                            })
                          : null;

                      return (
                        <li
                          key={result.offer.id}
                          id={`result-row-${result.offer.id}`}
                          className={`nb-card ${isOpen ? "is-open" : ""} ${
                            flashedOfferId === result.offer.id ? "is-flashing" : ""
                          } ${openingStatus === "closed" ? "is-closed" : ""}`}
                        >
                          <button
                            type="button"
                            className="nb-card-head"
                            aria-expanded={isOpen}
                            aria-controls={`result-body-${result.offer.id}`}
                            onClick={() => {
                              pulse(6);
                              setSelectedOfferId(isOpen ? null : result.offer.id);
                            }}
                          >
                            <span className="nb-card-index mono" aria-hidden="true">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="nb-card-main">
                              <span className="nb-card-title-row">
                                <span className="nb-card-name">{result.store.name}</span>
                                <span className="nb-card-distance mono">
                                  {formatDistance(result.distanceMeters)}
                                </span>
                              </span>
                              <span className="nb-card-meta">
                                <span className="nb-card-meta-main">
                                  <span className={`nb-tier ${tierClass}`}>{formatValidation(dictionary, status)}</span>
                                  {category ? <span>{category}</span> : null}
                                </span>
                                {openingLabel ? (
                                  <span className={`nb-card-hours mono ${openingStatus === "closed" ? "nb-closed" : ""}`}>
                                    {openingLabel}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          </button>

                          {isOpen ? (
                            <div className="nb-card-body" id={`result-body-${result.offer.id}`}>
                              <p className="nb-why">
                                <strong>{displayProductName(result.product)}</strong>
                                {result.whyThisProductMatches ? <> — {result.whyThisProductMatches}</> : null}
                                {confirmedAgo ? (
                                  <span className="nb-muted"> · {confirmedAgo}</span>
                                ) : null}
                              </p>

                              <div className="nb-actions">
                                <button
                                  type="button"
                                  className={`nb-btn nb-btn-primary nb-btn-small ${walkRouteActive ? "is-active" : ""}`}
                                  disabled={routeLoading}
                                  onClick={() => openRoute(result, "walk")}
                                >
                                  <UiIcon kind="walk" className="nb-inline-icon" />
                                  {walkRouteActive
                                    ? dictionary.clearRouteAction
                                    : `${dictionary.directionsAction} · ${applyTemplate(dictionary.walkMinutesTemplate, {
                                        min: String(travel.walkMin)
                                      })}`}
                                </button>
                                <button
                                  type="button"
                                  className={`nb-btn nb-btn-small ${bikeRouteActive ? "is-active" : ""}`}
                                  disabled={routeLoading}
                                  onClick={() => openRoute(result, "bike")}
                                >
                                  <UiIcon kind="bike" className="nb-inline-icon" />
                                  {bikeRouteActive
                                    ? dictionary.clearRouteAction
                                    : applyTemplate(dictionary.bikeMinutesTemplate, { min: String(travel.bikeMin) })}
                                </button>
                                <button
                                  type="button"
                                  className={`nb-btn nb-btn-small ${isSaved ? "is-active" : ""}`}
                                  aria-pressed={isSaved}
                                  onClick={() => toggleSavedStore(result.store.id)}
                                >
                                  {isSaved ? `★ ${dictionary.unsaveStoreAction}` : `☆ ${dictionary.saveStoreAction}`}
                                </button>
                                {phoneHref ? (
                                  <a
                                    href={phoneHref}
                                    className="nb-btn nb-btn-small"
                                    onClick={() => trackEvent("store_call_click", { store_id: result.store.id })}
                                  >
                                    {dictionary.callStoreAction}
                                  </a>
                                ) : null}
                              </div>

                              {lastSearchEngine === "presence" ? (
                                <PresenceFeedback
                                  key={result.offer.id}
                                  dictionary={dictionary}
                                  storeId={result.store.id}
                                  productTypeId={result.product.id}
                                  productLabel={displayProductName(result.product)}
                                  query={lastSubmittedQuery}
                                />
                              ) : null}

                              <p className="nb-card-foot mono">
                                <span>{result.store.address}</span>
                                {result.store.openingHours ? <span>{result.store.openingHours}</span> : null}
                                <Link href={`/${locale}/store/${result.store.id}` as Route} className="nb-link">
                                  {dictionary.storePageAction} →
                                </Link>
                              </p>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {hasHiddenListResults ? (
                    <button
                      type="button"
                      className="nb-link nb-more"
                      onClick={() => {
                        setIsResultsExpanded((current) => !current);
                        pulse(7);
                      }}
                    >
                      {isResultsExpanded
                        ? dictionary.viewLessResultsLabel
                        : applyTemplate(dictionary.moreResultsTemplate, {
                            count: String(filteredListResults.length - visibleListResults.length)
                          })}
                    </button>
                  ) : null}
                  {quickExpandRadiusKm !== null ? (
                    <button
                      type="button"
                      className="nb-link nb-more"
                      onClick={() => expandSearchTo(quickExpandRadiusKm, "results_list")}
                      disabled={isLoading}
                    >
                      {quickExpandButtonLabel}
                    </button>
                  ) : null}
                </>
              ) : null}

              {!isLoading && hasSearched && (results.length === 0 || filtersHideAllResults) ? (
                <div className="nb-empty">
                  <Doodle kind="empty" />
                  <p className="nb-hand nb-empty-title">{noResultsMessage}</p>
                  {noResultsGuidance?.type === "nearby" && !filtersHideAllResults ? (
                    <button
                      type="button"
                      className="nb-btn nb-btn-small"
                      onClick={() => expandSearchTo(noResultsGuidance.suggestedRadiusKm, "no_results")}
                      disabled={isLoading}
                    >
                      {expandSearchButtonLabel}
                    </button>
                  ) : null}
                  {filtersHideAllResults ? (
                    <button
                      type="button"
                      className="nb-btn nb-btn-small"
                      onClick={() => {
                        setOpenNowOnly(false);
                        setSavedOnly(false);
                        setIndependentOnly(false);
                        pulse(7);
                      }}
                    >
                      {dictionary.clearFiltersAction}
                    </button>
                  ) : null}
                  {relatedTerms.length > 0 ? (
                    <p className="nb-try">
                      <span className="nb-hand">{dictionary.tryLabel}:</span>{" "}
                      {relatedTerms.map((term, index) => (
                        <span key={`related-${term}`}>
                          <button
                            type="button"
                            className="nb-link"
                            onClick={() => {
                              setQuery(term);
                              setActiveQuickIntent(null);
                              void runSearch({ overrideQuery: term, category: null });
                            }}
                            disabled={isLoading}
                          >
                            {term}
                          </button>
                          {index < relatedTerms.length - 1 ? <span aria-hidden="true"> · </span> : null}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <section
              id="map"
              ref={mapSectionRef}
              className={`nb-map-col ${isMapVisible ? "is-visible" : ""}`}
              aria-label={dictionary.mapTitle}
            >
              {routeLoadingKey || activeRouteLabel || routeErrorMessage ? (
                <div className="nb-route-status mono" role="status" aria-live="polite" aria-atomic="true">
                  {routeLoadingKey ? <span>{dictionary.routeLoadingLabel}</span> : null}
                  {!routeLoadingKey && activeRouteLabel ? <mark className="nb-mark">{activeRouteLabel}</mark> : null}
                  {!routeLoadingKey && routeErrorMessage ? <span className="nb-status-error">{routeErrorMessage}</span> : null}
                  {activeRoute ? (
                    <button
                      type="button"
                      className="nb-link"
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
              ) : null}
              <LocalMap
                center={safeCenter}
                results={mapResults}
                themeMode={themeMode}
                berlinOnlyHint={dictionary.berlinOnlyHint}
                geolocationPermission={geolocationPermission}
                isLocating={isLocating}
                geolocationLabel={dictionary.useMyLocation}
                geolocationDeniedLabel={dictionary.geolocationDenied}
                onRequestGeolocation={() => {
                  requestBrowserLocation();
                }}
                manualCenterEnabled={manualCenterEnabled}
                onManualCenterChange={onMapManualCenterChange}
                radiusMeters={Math.round(radiusKm * 1000)}
                activeRouteGeometry={activeRoute?.geometry ?? null}
                activeRouteFitKey={
                  activeRoute ? `${activeRoute.offerId}:${activeRoute.mode}:${Math.round(activeRoute.distanceMeters)}` : null
                }
                selectedOfferId={selectedOfferId}
                onMarkerSelect={onMapMarkerSelect}
                isLoading={isLoading}
                loadingLabel={dictionary.searchingLabel}
                cacheIndicatorLabel={null}
                className="nb-map-frame"
              />
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
