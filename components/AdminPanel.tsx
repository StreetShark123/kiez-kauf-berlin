"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/types";
import { AdminCoverageMap } from "@/components/AdminCoverageMap";

type AdminTab = "today" | "insights" | "review" | "catalog" | "businesses" | "districts";
type ActiveStatus = "active" | "inactive" | "temporarily_closed" | "unknown";
type BulkActiveStatus = "keep" | ActiveStatus;

type InsightsPayload = {
  window_days: number;
  totals: {
    searches: number;
    resolved: number;
    unresolved: number;
    unresolved_rate: number;
    avg_results_per_search: number;
    establishments_total: number;
    canonical_products_total: number;
    suspected_false_positives: number;
    suspected_false_positive_rate: number;
    rule_suggestions_pending_auto_apply: number;
  };
  top_terms: Array<{ term: string; total: number; unresolved: number }>;
  unresolved_terms: Array<{ term: string; total: number; unresolved: number }>;
  unresolved_recent: Array<{
    search_term: string;
    category: string | null;
    district: string | null;
    radius_km: number | null;
    results_count: number | null;
    timestamp: string;
  }>;
  unresolved_trend_14d: Array<{ day: string; count: number }>;
  endpoint_usage: Array<{ endpoint: string; count: number }>;
  category_quality: Array<{
    group: string;
    total: number;
    suspicious: number;
    validated: number;
    high_confidence_suspicious: number;
    suspicious_rate: number;
  }>;
  suspicious_examples: Array<{
    establishment_id: number;
    establishment_name: string;
    district: string;
    product_group: string;
    confidence: number;
    validation_status: string;
    source_type: string | null;
    osm_category: string | null;
    app_categories: string[];
  }>;
  rule_suggestions: Array<{
    id: number;
    app_category: string;
    product_group: string;
    support_count: number;
    positive_count: number;
    precision_score: number;
    auto_apply_eligible: boolean;
    status: "suggested" | "applied" | "discarded";
    generated_at: string;
  }>;
};

type CatalogPayload = {
  totals: {
    taxonomy_categories: number;
    canonical_products: number;
    establishments_with_categories: number;
    aliases: number;
    facets: number;
    use_cases: number;
  };
  categories: Array<{
    slug: string;
    parent_slug: string | null;
    display_name_en: string;
    display_name_de: string;
    is_searchable: boolean;
    establishment_count: number;
  }>;
  products_by_group: Array<{
    group: string;
    count: number;
    sample: string[];
  }>;
  product_families: Array<{
    id: number;
    family_slug: string;
    display_name_en: string;
    display_name_de: string;
    display_name_es: string;
    normalized_name: string;
    group: string;
    coverage_tier: string;
    priority: number;
    is_active: boolean;
    store_count: number;
    alias_count: number;
    aliases_sample: string[];
    facet_count: number;
    facets_sample: string[];
    use_case_count: number;
    use_cases_sample: string[];
  }>;
};

type EstablishmentListResponse = {
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  rows: EstablishmentListItem[];
};

type EstablishmentListItem = {
  id: number;
  name: string;
  address: string;
  district: string;
  app_categories: string[] | null;
  active_status: ActiveStatus;
  website: string | null;
  phone: string | null;
  updated_at: string;
  product_count: number;
};

type ReviewQueuePayload = {
  window_days: number;
  queue_totals: {
    businesses_flagged: number;
    unresolved_terms: number;
  };
  unresolved_terms: Array<{
    term: string;
    count: number;
    last_seen_at: string;
  }>;
  flag_totals: Array<{
    flag: "missing_categories" | "missing_products" | "low_validation" | "missing_opening_hours" | "stale_data";
    count: number;
  }>;
  establishment_queue: Array<{
    id: number;
    name: string;
    district: string;
    active_status: ActiveStatus;
    updated_at: string;
    app_categories: string[] | null;
    opening_hours: string | null;
    website: string | null;
    product_count: number;
    validated_product_count: number;
    flags: Array<"missing_categories" | "missing_products" | "low_validation" | "missing_opening_hours" | "stale_data">;
    score: number;
  }>;
};

type EstablishmentDetailResponse = {
  establishment: {
    id: number;
    external_source: string;
    external_id: string;
    name: string;
    address: string;
    district: string;
    lat: number;
    lon: number;
    osm_category: string | null;
    app_categories: string[] | null;
    website: string | null;
    phone: string | null;
    opening_hours: string | null;
    description: string | null;
    active_status: ActiveStatus;
    updated_at: string;
  };
  products: Array<{
    canonical_product_id: number;
    confidence: number;
    validation_status: "unvalidated" | "likely" | "validated" | "rejected";
    why_this_product_matches: string | null;
    primary_source_type: string;
    product: {
      normalized_name: string;
      display_name_en: string;
      display_name_de: string;
      display_name_es: string;
      product_group: string;
      aliases: string[];
      facets: string[];
      use_cases: string[];
    } | null;
  }>;
};

type CanonicalProductSearch = {
  rows: Array<{
    id: number;
    normalized_name: string;
    display_name_en: string;
    display_name_de: string;
    display_name_es: string;
    product_group: string;
    synonyms: string[] | null;
    facets?: string[] | null;
  }>;
};

type DistrictOverviewPayload = {
  totals: {
    districts: number;
    establishments: number;
    active: number;
    with_products: number;
    with_geo: number;
  };
  districts: Array<{
    district: string;
    establishments_total: number;
    active_total: number;
    temporarily_closed_total: number;
    inactive_total: number;
    unknown_total: number;
    with_products_total: number;
    with_opening_hours_total: number;
    with_geo_total: number;
    recently_updated_7d_total: number;
    top_categories: Array<{ slug: string; count: number }>;
  }>;
};

type DistrictMapPointsPayload = {
  filters: {
    district: string | null;
    category: string | null;
    active_only: boolean;
    limit: number;
  };
  total: number;
  points: Array<{
    id: number;
    name: string;
    district: string;
    lat: number;
    lon: number;
    active_status: "active" | "inactive" | "temporarily_closed" | "unknown";
    app_categories: string[];
    product_count: number;
    updated_at: string;
  }>;
};

type AdminCopy = {
  title: string;
  subtitle: string;
  keyTitle: string;
  keyHint: string;
  keyPlaceholder: string;
  unlock: string;
  saveKey: string;
  tabs: Record<AdminTab, string>;
  todayTitle: string;
  todayHint: string;
  quickActionsTitle: string;
  loadDistrictMap: string;
  loadingDistrictMap: string;
  showMore: string;
  showLess: string;
  loading: string;
  refresh: string;
  rebuildDataset: string;
  rebuilding: string;
  businessSearchPlaceholder: string;
  noBusinessSelected: string;
  saveChanges: string;
  addProduct: string;
  productSearchPlaceholder: string;
  reasonPlaceholder: string;
  activeStatusLabel: string;
  categoriesLabel: string;
  websiteLabel: string;
  phoneLabel: string;
  openingHoursLabel: string;
  descriptionLabel: string;
  districtLabel: string;
  unauthorized: string;
  disabledPanel: string;
  productsInStore: string;
  unresolvedSearches: string;
  topSearches: string;
  endpointUsage: string;
  categoryQuality: string;
  suspectedFalsePositives: string;
  suspiciousExamples: string;
  prepareSuspiciousFix: string;
  categories: string;
  productGroups: string;
  noData: string;
  add: string;
  loadingProducts: string;
  listSummary: string;
  reviewQueue: string;
  reviewQueueHint: string;
  flaggedBusinesses: string;
  unresolvedTermsReview: string;
  openInEditor: string;
  useForSearch: string;
  markActive: string;
  markTempClosed: string;
  bulkEdit: string;
  selectedCount: string;
  selectPage: string;
  clearSelection: string;
  appendCategories: string;
  applyBulk: string;
  bulkStatusLabel: string;
  keepStatus: string;
  districtsTitle: string;
  districtsHint: string;
  mapPointsTitle: string;
  districtFilterLabel: string;
  categoryFilterLabel: string;
  activeOnlyLabel: string;
  runDistrictRefresh: string;
  runningDistrictRefresh: string;
  copyDistrictImportCommand: string;
  manualFixTitle: string;
  manualFixHint: string;
  aliasTermLabel: string;
  aliasLangLabel: string;
  aliasPriorityLabel: string;
  searchCanonicalForAlias: string;
  saveAliasMapping: string;
  preparingAlias: string;
  prepareAliasFix: string;
  categoriesHint: string;
  categoryPickerSearchPlaceholder: string;
  noCategoryMatches: string;
  validateProduct: string;
  rejectProduct: string;
  removeProduct: string;
  productActionReasonPlaceholder: string;
  runRuleSuggestion: string;
  runningRuleSuggestion: string;
  applyAutoRules: string;
  applyingAutoRules: string;
  ruleSuggestionsTitle: string;
  pendingAutoRules: string;
};

const ADMIN_KEY_STORAGE = "kiezkauf:admin-panel-key";

const COPY: Record<"en" | "de", AdminCopy> = {
  en: {
    title: "Admin panel",
    subtitle: "Usage insights, catalog quality and manual business curation.",
    keyTitle: "Admin access key",
    keyHint: "Set ADMIN_PANEL_KEY and SUPABASE_SERVICE_ROLE_KEY on the server.",
    keyPlaceholder: "Paste admin key",
    unlock: "Unlock panel",
    saveKey: "Remember key in this browser",
    tabs: {
      today: "Today",
      insights: "Insights",
      review: "Review queue",
      catalog: "Catalog",
      businesses: "Businesses",
      districts: "Districts"
    },
    todayTitle: "Today",
    todayHint: "Daily operations: unresolved demand first, then fast curation actions.",
    quickActionsTitle: "Quick actions",
    loadDistrictMap: "Load map points",
    loadingDistrictMap: "Loading map...",
    showMore: "Show more",
    showLess: "Show less",
    loading: "Loading...",
    refresh: "Refresh",
    rebuildDataset: "Refresh search dataset",
    rebuilding: "Refreshing dataset...",
    businessSearchPlaceholder: "Search business by name, address or district",
    noBusinessSelected: "Pick a business to edit details and attach products.",
    saveChanges: "Save business changes",
    addProduct: "Add product manually",
    productSearchPlaceholder: "Search canonical product (milk, hammer, diapers...)",
    reasonPlaceholder: "Why this product should be available here (short note)",
    activeStatusLabel: "Active status",
    categoriesLabel: "App categories (comma separated)",
    categoriesHint: "Pick categories from taxonomy. These are used by rule generation and quality checks.",
    categoryPickerSearchPlaceholder: "Filter categories...",
    noCategoryMatches: "No categories match this filter.",
    websiteLabel: "Website",
    phoneLabel: "Phone",
    openingHoursLabel: "Opening hours",
    descriptionLabel: "Description",
    districtLabel: "District",
    unauthorized: "Unauthorized. Check your admin key.",
    disabledPanel: "Admin panel disabled on server.",
    productsInStore: "Current mapped products",
    unresolvedSearches: "Recent unresolved searches",
    topSearches: "Top searched terms",
    endpointUsage: "Endpoint usage",
    categoryQuality: "Category mismatch risk",
    suspectedFalsePositives: "Suspected false positives",
    suspiciousExamples: "Suspicious examples to review",
    prepareSuspiciousFix: "Prepare fix",
    categories: "Current categories",
    productGroups: "Products by group",
    noData: "No data yet",
    add: "Add",
    loadingProducts: "Searching products...",
    listSummary: "Showing {shown} of {total} businesses",
    reviewQueue: "Review queue",
    reviewQueueHint: "Prioritize unresolved demand and low-quality records first.",
    flaggedBusinesses: "Flagged businesses",
    unresolvedTermsReview: "Unresolved terms",
    openInEditor: "Open in editor",
    useForSearch: "Use as business search",
    markActive: "Mark active",
    markTempClosed: "Mark temp closed",
    bulkEdit: "Bulk edit",
    selectedCount: "{count} selected",
    selectPage: "Select page",
    clearSelection: "Clear",
    appendCategories: "Append categories",
    applyBulk: "Apply bulk update",
    bulkStatusLabel: "Bulk status",
    keepStatus: "keep current",
    districtsTitle: "District coverage",
    districtsHint: "Operational view by district + quick refresh actions.",
    mapPointsTitle: "Active map points",
    districtFilterLabel: "District filter",
    categoryFilterLabel: "Category filter",
    activeOnlyLabel: "Active only",
    runDistrictRefresh: "Refresh district data",
    runningDistrictRefresh: "Refreshing district...",
    copyDistrictImportCommand: "Copy import command",
    manualFixTitle: "Manual search fix",
    manualFixHint: "Map an unresolved term to a canonical product alias to improve matching fast.",
    aliasTermLabel: "Unresolved term",
    aliasLangLabel: "Alias language",
    aliasPriorityLabel: "Priority",
    searchCanonicalForAlias: "Find canonical product",
    saveAliasMapping: "Save alias mapping",
    preparingAlias: "Preparing...",
    prepareAliasFix: "Prepare alias fix",
    validateProduct: "Validate",
    rejectProduct: "Reject",
    removeProduct: "Remove",
    productActionReasonPlaceholder: "Reason for validation/rejection/removal",
    runRuleSuggestion: "Generate learned rules",
    runningRuleSuggestion: "Generating rules...",
    applyAutoRules: "Apply conservative auto-rules",
    applyingAutoRules: "Applying rules...",
    ruleSuggestionsTitle: "Learned rule suggestions",
    pendingAutoRules: "Pending auto-apply"
  },
  de: {
    title: "Admin-Panel",
    subtitle: "Nutzungs-Insights, Katalogqualität und manuelle Pflege von Läden.",
    keyTitle: "Admin-Zugangsschlüssel",
    keyHint: "Setze ADMIN_PANEL_KEY und SUPABASE_SERVICE_ROLE_KEY auf dem Server.",
    keyPlaceholder: "Admin-Key einfügen",
    unlock: "Panel entsperren",
    saveKey: "Key in diesem Browser merken",
    tabs: {
      today: "Heute",
      insights: "Insights",
      review: "Prüfwarteschlange",
      catalog: "Katalog",
      businesses: "Läden",
      districts: "Bezirke"
    },
    todayTitle: "Heute",
    todayHint: "Tagesbetrieb: erst offene Nachfrage, dann schnelle Kuration.",
    quickActionsTitle: "Schnellaktionen",
    loadDistrictMap: "Kartenpunkte laden",
    loadingDistrictMap: "Lade Karte...",
    showMore: "Mehr zeigen",
    showLess: "Weniger zeigen",
    loading: "Lädt...",
    refresh: "Aktualisieren",
    rebuildDataset: "Such-Dataset neu bauen",
    rebuilding: "Dataset wird aktualisiert...",
    businessSearchPlaceholder: "Laden über Name, Adresse oder Bezirk suchen",
    noBusinessSelected: "Wähle einen Laden, um Details und Produkte zu bearbeiten.",
    saveChanges: "Änderungen speichern",
    addProduct: "Produkt manuell hinzufügen",
    productSearchPlaceholder: "Kanonisches Produkt suchen (Milch, Hammer, Windeln...)",
    reasonPlaceholder: "Warum sollte dieses Produkt hier verfügbar sein?",
    activeStatusLabel: "Status",
    categoriesLabel: "App-Kategorien (kommagetrennt)",
    categoriesHint: "Wähle Kategorien aus der Taxonomie. Diese steuern Rules und Qualitätschecks.",
    categoryPickerSearchPlaceholder: "Kategorien filtern...",
    noCategoryMatches: "Keine passenden Kategorien gefunden.",
    websiteLabel: "Website",
    phoneLabel: "Telefon",
    openingHoursLabel: "Öffnungszeiten",
    descriptionLabel: "Beschreibung",
    districtLabel: "Bezirk",
    unauthorized: "Nicht autorisiert. Prüfe deinen Admin-Key.",
    disabledPanel: "Admin-Panel ist serverseitig deaktiviert.",
    productsInStore: "Aktuell verknüpfte Produkte",
    unresolvedSearches: "Neueste Suchanfragen ohne Treffer",
    topSearches: "Top-Suchbegriffe",
    endpointUsage: "Endpoint-Nutzung",
    categoryQuality: "Risiko von Kategorie-Fehlzuordnungen",
    suspectedFalsePositives: "Vermutete Fehlzuordnungen",
    suspiciousExamples: "Verdächtige Beispiele zur Prüfung",
    prepareSuspiciousFix: "Fix vorbereiten",
    categories: "Aktuelle Kategorien",
    productGroups: "Produkte je Gruppe",
    noData: "Noch keine Daten",
    add: "Hinzufügen",
    loadingProducts: "Produkte werden gesucht...",
    listSummary: "{shown} von {total} Läden",
    reviewQueue: "Prüfwarteschlange",
    reviewQueueHint: "Zuerst offene Nachfrage und Datensätze mit schwacher Qualität bearbeiten.",
    flaggedBusinesses: "Markierte Läden",
    unresolvedTermsReview: "Suchbegriffe ohne Treffer",
    openInEditor: "Im Editor öffnen",
    useForSearch: "Als Ladensuche nutzen",
    markActive: "Als aktiv markieren",
    markTempClosed: "Temporär geschlossen",
    bulkEdit: "Massenbearbeitung",
    selectedCount: "{count} ausgewählt",
    selectPage: "Seite wählen",
    clearSelection: "Leeren",
    appendCategories: "Kategorien ergänzen",
    applyBulk: "Massenupdate anwenden",
    bulkStatusLabel: "Status in Masse",
    keepStatus: "unverändert lassen",
    districtsTitle: "Bezirksabdeckung",
    districtsHint: "Operative Sicht nach Bezirk + schnelle Refresh-Aktionen.",
    mapPointsTitle: "Aktive Kartenpunkte",
    districtFilterLabel: "Bezirksfilter",
    categoryFilterLabel: "Kategoriefilter",
    activeOnlyLabel: "Nur aktiv",
    runDistrictRefresh: "Bezirk-Daten refreshen",
    runningDistrictRefresh: "Bezirk wird refreshed...",
    copyDistrictImportCommand: "Import-Befehl kopieren",
    manualFixTitle: "Manueller Search-Fix",
    manualFixHint: "Ordne einen Suchbegriff ohne Treffer als Alias einem kanonischen Produkt zu.",
    aliasTermLabel: "Suchbegriff ohne Treffer",
    aliasLangLabel: "Alias-Sprache",
    aliasPriorityLabel: "Priorität",
    searchCanonicalForAlias: "Kanonisches Produkt finden",
    saveAliasMapping: "Alias-Mapping speichern",
    preparingAlias: "Wird vorbereitet...",
    prepareAliasFix: "Alias-Fix vorbereiten",
    validateProduct: "Validieren",
    rejectProduct: "Ablehnen",
    removeProduct: "Entfernen",
    productActionReasonPlaceholder: "Grund für Validierung/Ablehnung/Entfernung",
    runRuleSuggestion: "Gelernte Regeln erzeugen",
    runningRuleSuggestion: "Regeln werden erzeugt...",
    applyAutoRules: "Konservative Auto-Regeln anwenden",
    applyingAutoRules: "Regeln werden angewendet...",
    ruleSuggestionsTitle: "Gelernte Regelvorschläge",
    pendingAutoRules: "Auto-Apply ausstehend"
  }
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toCommaList(value: string[] | null | undefined) {
  if (!value || value.length === 0) {
    return "";
  }
  return value.join(", ");
}

function parseCommaList(value: string) {
  const unique = new Set<string>();
  for (const token of value.split(",")) {
    const clean = token.trim().toLowerCase().replace(/\s+/g, "-");
    if (!clean) continue;
    unique.add(clean);
  }
  return [...unique];
}

function template(value: string, replacements: Record<string, string>) {
  let output = value;
  for (const [key, replacement] of Object.entries(replacements)) {
    output = output.replace(new RegExp(`\\{${key}\\}`, "g"), replacement);
  }
  return output;
}

function reviewFlagLabel(flag: ReviewQueuePayload["flag_totals"][number]["flag"]) {
  switch (flag) {
    case "missing_categories":
      return "missing categories";
    case "missing_products":
      return "no products";
    case "low_validation":
      return "not validated";
    case "missing_opening_hours":
      return "missing opening hours";
    case "stale_data":
      return "stale";
    default:
      return flag;
  }
}

export function AdminPanel({ locale }: { locale: Locale }) {
  const copy = locale === "de" ? COPY.de : COPY.en;
  const [tab, setTab] = useState<AdminTab>("today");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRebuildingDataset, setIsRebuildingDataset] = useState(false);

  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueuePayload | null>(null);
  const [isLoadingReviewQueue, setIsLoadingReviewQueue] = useState(false);
  const [districtOverview, setDistrictOverview] = useState<DistrictOverviewPayload | null>(null);
  const [districtMapPoints, setDistrictMapPoints] = useState<DistrictMapPointsPayload | null>(null);
  const [hasLoadedDistrictMap, setHasLoadedDistrictMap] = useState(false);
  const [isLoadingDistrictOverview, setIsLoadingDistrictOverview] = useState(false);
  const [isLoadingDistrictMap, setIsLoadingDistrictMap] = useState(false);
  const [districtFilter, setDistrictFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [activeOnlyFilter, setActiveOnlyFilter] = useState(true);
  const [districtActionLoading, setDistrictActionLoading] = useState<string | null>(null);

  const [businessQuery, setBusinessQuery] = useState("");
  const [businessOffset, setBusinessOffset] = useState(0);
  const [businessListResponse, setBusinessListResponse] = useState<EstablishmentListResponse | null>(null);
  const [isLoadingBusinesses, setIsLoadingBusinesses] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<number[]>([]);
  const [bulkCategoriesInput, setBulkCategoriesInput] = useState("");
  const [bulkActiveStatus, setBulkActiveStatus] = useState<BulkActiveStatus>("keep");
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);

  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [businessDetail, setBusinessDetail] = useState<EstablishmentDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [categoryPickerQuery, setCategoryPickerQuery] = useState("");
  const [editActiveStatus, setEditActiveStatus] = useState<ActiveStatus>("active");
  const [editWebsite, setEditWebsite] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editOpeningHours, setEditOpeningHours] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDistrict, setEditDistrict] = useState("");
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);
  const [productActionReason, setProductActionReason] = useState("");
  const [productActionBusyKey, setProductActionBusyKey] = useState<string | null>(null);
  const [isGeneratingRuleSuggestions, setIsGeneratingRuleSuggestions] = useState(false);
  const [isApplyingAutoRules, setIsApplyingAutoRules] = useState(false);

  const [canonicalQuery, setCanonicalQuery] = useState("");
  const [canonicalResults, setCanonicalResults] = useState<CanonicalProductSearch["rows"]>([]);
  const [isSearchingCanonical, setIsSearchingCanonical] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const [manualProductId, setManualProductId] = useState<number | null>(null);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [aliasTermInput, setAliasTermInput] = useState("");
  const [aliasLang, setAliasLang] = useState<"und" | "en" | "de" | "es">("und");
  const [aliasPriority, setAliasPriority] = useState(80);
  const [aliasCanonicalQuery, setAliasCanonicalQuery] = useState("");
  const [aliasCanonicalResults, setAliasCanonicalResults] = useState<CanonicalProductSearch["rows"]>([]);
  const [aliasCanonicalProductId, setAliasCanonicalProductId] = useState<number | null>(null);
  const [isSearchingAliasCanonical, setIsSearchingAliasCanonical] = useState(false);
  const [isSavingAliasMapping, setIsSavingAliasMapping] = useState(false);
  const [isPreparingAlias, setIsPreparingAlias] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const pageSize = 30;

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!adminKey) {
        throw new Error(copy.unauthorized);
      }

      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
          ...(options?.headers ?? {})
        }
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Admin API error (${response.status})`);
      }
      return payload;
    },
    [adminKey, copy.unauthorized]
  );

  const fetchBusinesses = useCallback(
    async (opts?: { query?: string; offset?: number; preserveSelection?: boolean }) => {
      if (!adminKey) return;
      const query = opts?.query ?? businessQuery;
      const offset = opts?.offset ?? businessOffset;

      setIsLoadingBusinesses(true);
      try {
        const payload = (await apiFetch(
          `/api/admin/establishments?q=${encodeURIComponent(query)}&offset=${offset}&limit=${pageSize}`
        )) as EstablishmentListResponse;

        setBusinessListResponse(payload);
        setBusinessOffset(offset);

        if (!opts?.preserveSelection) {
          const firstId = payload.rows[0]?.id ?? null;
          setSelectedBusinessId(firstId);
        } else {
          const currentId = selectedBusinessId;
          const stillVisible = payload.rows.some((item) => item.id === currentId);
          if (!stillVisible && payload.rows.length > 0) {
            setSelectedBusinessId(payload.rows[0].id);
          }
        }
      } finally {
        setIsLoadingBusinesses(false);
      }
    },
    [adminKey, apiFetch, businessOffset, businessQuery, selectedBusinessId]
  );

  const fetchDetail = useCallback(
    async (id: number) => {
      if (!adminKey) return;
      setIsLoadingDetail(true);
      try {
        const payload = (await apiFetch(`/api/admin/establishments/${id}`)) as EstablishmentDetailResponse;
        setBusinessDetail(payload);
        setEditCategories((payload.establishment.app_categories ?? []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean));
        setCategoryPickerQuery("");
        setEditActiveStatus(payload.establishment.active_status);
        setEditWebsite(payload.establishment.website ?? "");
        setEditPhone(payload.establishment.phone ?? "");
        setEditOpeningHours(payload.establishment.opening_hours ?? "");
        setEditDescription(payload.establishment.description ?? "");
        setEditDistrict(payload.establishment.district ?? "");
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [adminKey, apiFetch]
  );

  const fetchInsightsAndCatalog = useCallback(async () => {
    if (!adminKey) return;
    setIsRefreshing(true);
    try {
      const [insightsPayload, catalogPayload] = await Promise.all([
        apiFetch("/api/admin/insights"),
        apiFetch("/api/admin/catalog")
      ]);
      setInsights(insightsPayload as InsightsPayload);
      setCatalog(catalogPayload as CatalogPayload);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : copy.unauthorized);
    } finally {
      setIsRefreshing(false);
    }
  }, [adminKey, apiFetch, copy.unauthorized]);

  const fetchReviewQueue = useCallback(async () => {
    if (!adminKey) return;
    setIsLoadingReviewQueue(true);
    try {
      const payload = (await apiFetch("/api/admin/review-queue")) as ReviewQueuePayload;
      setReviewQueue(payload);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : copy.unauthorized);
    } finally {
      setIsLoadingReviewQueue(false);
    }
  }, [adminKey, apiFetch, copy.unauthorized]);

  const fetchDistrictOverview = useCallback(async () => {
    if (!adminKey) return;
    setIsLoadingDistrictOverview(true);
    try {
      const payload = (await apiFetch("/api/admin/districts/overview")) as DistrictOverviewPayload;
      setDistrictOverview(payload);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : copy.unauthorized);
    } finally {
      setIsLoadingDistrictOverview(false);
    }
  }, [adminKey, apiFetch, copy.unauthorized]);

  const fetchDistrictMapPoints = useCallback(
    async (filters?: { district?: string; category?: string; activeOnly?: boolean }) => {
      if (!adminKey) return;
      const district = filters?.district ?? districtFilter;
      const category = filters?.category ?? categoryFilter;
      const activeOnly = typeof filters?.activeOnly === "boolean" ? filters.activeOnly : activeOnlyFilter;

      setIsLoadingDistrictMap(true);
      try {
        const params = new URLSearchParams();
        if (district.trim()) params.set("district", district.trim());
        if (category.trim()) params.set("category", category.trim().toLowerCase());
        params.set("activeOnly", String(activeOnly));
        params.set("limit", "4500");

        const payload = (await apiFetch(`/api/admin/districts/map-points?${params.toString()}`)) as DistrictMapPointsPayload;
        setDistrictMapPoints(payload);
        setHasLoadedDistrictMap(true);
        setAuthError(null);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : copy.unauthorized);
      } finally {
        setIsLoadingDistrictMap(false);
      }
    },
    [activeOnlyFilter, adminKey, apiFetch, categoryFilter, copy.unauthorized, districtFilter]
  );

  useEffect(() => {
    try {
      const remembered = localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
      if (remembered) {
        setAdminKey(remembered);
        setAdminKeyInput(remembered);
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    if (!adminKey) {
      return;
    }
    let active = true;

    (async () => {
      setIsBootstrapping(true);
      try {
        await Promise.all([fetchInsightsAndCatalog(), fetchReviewQueue()]);
      } catch (error) {
        if (active) {
          setAuthError(error instanceof Error ? error.message : copy.unauthorized);
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    adminKey,
    copy.unauthorized,
    fetchInsightsAndCatalog,
    fetchReviewQueue
  ]);

  useEffect(() => {
    if (!adminKey) return;
    if (tab === "today" || tab === "insights" || tab === "catalog") {
      if (!insights || !catalog) {
        fetchInsightsAndCatalog().catch((error) => {
          setSaveMessage(error instanceof Error ? error.message : "Unable to load insights.");
        });
      }
      return;
    }

    if (tab === "review") {
      if (!reviewQueue && !isLoadingReviewQueue) {
        fetchReviewQueue().catch((error) => {
          setSaveMessage(error instanceof Error ? error.message : "Unable to load review queue.");
        });
      }
      return;
    }

    if (tab === "districts") {
      if (!districtOverview && !isLoadingDistrictOverview) {
        fetchDistrictOverview().catch((error) => {
          setSaveMessage(error instanceof Error ? error.message : "Unable to load district overview.");
        });
      }
      return;
    }

    if (tab === "businesses") {
      if (!businessListResponse && !isLoadingBusinesses) {
        fetchBusinesses({ offset: 0 }).catch((error) => {
          setSaveMessage(error instanceof Error ? error.message : "Unable to load businesses.");
        });
      }
    }
  }, [
    adminKey,
    businessListResponse,
    catalog,
    districtOverview,
    fetchBusinesses,
    fetchDistrictOverview,
    fetchInsightsAndCatalog,
    fetchReviewQueue,
    insights,
    isLoadingBusinesses,
    isLoadingDistrictOverview,
    isLoadingReviewQueue,
    reviewQueue,
    tab
  ]);

  useEffect(() => {
    if (!selectedBusinessId || !adminKey) return;
    fetchDetail(selectedBusinessId).catch((error) => {
      setSaveMessage(error instanceof Error ? error.message : "Detail load failed.");
    });
  }, [adminKey, fetchDetail, selectedBusinessId]);

  const topNoResultTerms = useMemo(() => insights?.unresolved_terms ?? [], [insights]);
  const districtRows = useMemo(() => districtOverview?.districts ?? [], [districtOverview]);
  const districtOptions = useMemo(() => {
    return districtRows.map((row) => row.district).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [districtRows]);
  const categoryOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of districtRows) {
      for (const item of row.top_categories) {
        const clean = String(item.slug ?? "").trim().toLowerCase();
        if (clean) unique.add(clean);
      }
    }
    for (const point of districtMapPoints?.points ?? []) {
      for (const item of point.app_categories ?? []) {
        const clean = String(item ?? "").trim().toLowerCase();
        if (clean) unique.add(clean);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [districtMapPoints, districtRows]);

  const businesses = businessListResponse?.rows ?? [];
  const totalBusinesses = businessListResponse?.pagination.total ?? 0;
  const shownBusinesses = businesses.length;
  const businessCategoryOptions = useMemo(() => {
    const source = catalog?.categories ?? [];
    return source
      .filter((item) => item.is_searchable)
      .map((item) => ({
        slug: item.slug,
        label: locale === "de" ? item.display_name_de || item.display_name_en : item.display_name_en || item.display_name_de,
        count: item.establishment_count
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog?.categories, locale]);

  const filteredBusinessCategoryOptions = useMemo(() => {
    const query = categoryPickerQuery.trim().toLowerCase();
    if (!query) {
      return businessCategoryOptions;
    }
    return businessCategoryOptions.filter((item) => {
      const haystack = `${item.slug} ${item.label}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [businessCategoryOptions, categoryPickerQuery]);

  const onUnlock = async () => {
    setAuthError(null);
    const key = adminKeyInput.trim();
    if (!key) {
      setAuthError(copy.unauthorized);
      return;
    }
    setAdminKey(key);
    if (rememberKey) {
      try {
        localStorage.setItem(ADMIN_KEY_STORAGE, key);
      } catch {
        // no-op
      }
    }
  };

  const onSearchBusinesses = async () => {
    setBusinessOffset(0);
    await fetchBusinesses({ query: businessQuery, offset: 0 });
  };

  const onSaveBusiness = async () => {
    if (!selectedBusinessId) return;
    setIsSavingBusiness(true);
    setSaveMessage(null);
    try {
      const payload = await apiFetch(`/api/admin/establishments/${selectedBusinessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          appCategories: editCategories,
          activeStatus: editActiveStatus,
          website: editWebsite,
          phone: editPhone,
          openingHours: editOpeningHours,
          description: editDescription,
          district: editDistrict
        })
      });

      setBusinessDetail((prev) =>
        prev
          ? {
              ...prev,
              establishment: payload.establishment
            }
          : prev
      );
      setSaveMessage("Saved.");
      await Promise.all([fetchBusinesses({ preserveSelection: true }), fetchReviewQueue()]);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setIsSavingBusiness(false);
    }
  };

  const onToggleBusinessCategory = (slug: string) => {
    const clean = slug.trim().toLowerCase();
    if (!clean) return;
    setEditCategories((current) => {
      if (current.includes(clean)) {
        return current.filter((entry) => entry !== clean);
      }
      return [...current, clean].sort((a, b) => a.localeCompare(b));
    });
  };

  const onProductAction = async (
    canonicalProductId: number,
    action: "validate" | "reject" | "remove"
  ) => {
    if (!selectedBusinessId) return;
    setProductActionBusyKey(`${canonicalProductId}:${action}`);
    setSaveMessage(null);
    try {
      const requestInit: RequestInit =
        action === "remove"
          ? {
              method: "DELETE",
              body: JSON.stringify({
                canonicalProductId,
                reason: productActionReason
              })
            }
          : {
              method: "PATCH",
              body: JSON.stringify({
                canonicalProductId,
                action,
                reason: productActionReason
              })
            };

      await apiFetch(`/api/admin/establishments/${selectedBusinessId}/products`, requestInit);
      await Promise.all([fetchDetail(selectedBusinessId), fetchReviewQueue(), fetchInsightsAndCatalog()]);
      setSaveMessage(`Product ${action} saved.`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Product action failed.");
    } finally {
      setProductActionBusyKey(null);
    }
  };

  const onGenerateRuleSuggestions = async () => {
    setIsGeneratingRuleSuggestions(true);
    setSaveMessage(null);
    try {
      await apiFetch("/api/admin/curation/suggestions", {
        method: "POST",
        body: JSON.stringify({
          action: "generate",
          windowDays: 90,
          minSupport: 20,
          minPositive: 10,
          minPrecision: 0.9
        })
      });
      await fetchInsightsAndCatalog();
      setSaveMessage("Rule suggestions generated.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Rule suggestion generation failed.");
    } finally {
      setIsGeneratingRuleSuggestions(false);
    }
  };

  const onApplyAutoRules = async () => {
    setIsApplyingAutoRules(true);
    setSaveMessage(null);
    try {
      await apiFetch("/api/admin/curation/suggestions", {
        method: "POST",
        body: JSON.stringify({
          action: "apply",
          windowDays: 90,
          minSupport: 20,
          minPositive: 10,
          minPrecision: 0.9,
          maxApply: 120
        })
      });
      await Promise.all([fetchInsightsAndCatalog(), onRefreshDataset()]);
      setSaveMessage("Conservative rules applied and dataset refreshed.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Auto-rule apply failed.");
    } finally {
      setIsApplyingAutoRules(false);
    }
  };

  const onSearchCanonicalProducts = async () => {
    if (!canonicalQuery.trim()) {
      setCanonicalResults([]);
      return;
    }
    setIsSearchingCanonical(true);
    try {
      const payload = (await apiFetch(
        `/api/admin/canonical-products?q=${encodeURIComponent(canonicalQuery)}&limit=30`
      )) as CanonicalProductSearch;
      setCanonicalResults(payload.rows);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Product search failed.");
    } finally {
      setIsSearchingCanonical(false);
    }
  };

  const onAddManualProduct = async () => {
    if (!selectedBusinessId || !manualProductId) {
      return;
    }
    setIsAddingProduct(true);
    setSaveMessage(null);
    try {
      await apiFetch(`/api/admin/establishments/${selectedBusinessId}/products`, {
        method: "POST",
        body: JSON.stringify({
          canonicalProductId: manualProductId,
          reason: manualReason
        })
      });
      await fetchDetail(selectedBusinessId);
      setManualProductId(null);
      setManualReason("");
      setCanonicalResults([]);
      setCanonicalQuery("");
      setSaveMessage("Product attached.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to add product.");
    } finally {
      setIsAddingProduct(false);
    }
  };

  const onSearchCanonicalForAlias = async () => {
    if (!aliasCanonicalQuery.trim()) {
      setAliasCanonicalResults([]);
      return;
    }
    setIsSearchingAliasCanonical(true);
    try {
      const payload = (await apiFetch(
        `/api/admin/canonical-products?q=${encodeURIComponent(aliasCanonicalQuery)}&limit=30`
      )) as CanonicalProductSearch;
      setAliasCanonicalResults(payload.rows);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Alias product search failed.");
    } finally {
      setIsSearchingAliasCanonical(false);
    }
  };

  const onPrepareAliasFix = async (term: string) => {
    const cleanTerm = term.trim();
    if (!cleanTerm) return;
    setIsPreparingAlias(true);
    setAliasTermInput(cleanTerm);
    setAliasCanonicalQuery(cleanTerm);
    setAliasCanonicalProductId(null);
    setAliasCanonicalResults([]);
    try {
      const payload = (await apiFetch(
        `/api/admin/canonical-products?q=${encodeURIComponent(cleanTerm)}&limit=20`
      )) as CanonicalProductSearch;
      setAliasCanonicalResults(payload.rows);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to prepare alias fix.");
    } finally {
      setIsPreparingAlias(false);
    }
  };

  const onPrepareSuspiciousExampleFix = async (example: InsightsPayload["suspicious_examples"][number]) => {
    const suggestedTerm = String(example.product_group ?? "")
      .replaceAll("_", " ")
      .trim();
    if (!suggestedTerm) {
      return;
    }

    setTab("review");
    setSaveMessage(null);
    setIsPreparingAlias(true);
    setAliasTermInput(suggestedTerm);
    setAliasCanonicalQuery(suggestedTerm);
    setAliasCanonicalProductId(null);
    setAliasCanonicalResults([]);
    setAliasLang("und");

    try {
      const payload = (await apiFetch(
        `/api/admin/canonical-products?q=${encodeURIComponent(suggestedTerm)}&limit=20`
      )) as CanonicalProductSearch;
      setAliasCanonicalResults(payload.rows);
      setBusinessQuery(example.establishment_name ?? "");
      await fetchBusinesses({
        query: example.establishment_name ?? "",
        offset: 0
      });
      setSaveMessage(
        `Prepared from suspicious match: ${example.establishment_name} -> ${example.product_group}. Review alias and business category.`
      );
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to prepare suspicious fix.");
    } finally {
      setIsPreparingAlias(false);
    }
  };

  const onSaveAliasMapping = async () => {
    const cleanAlias = aliasTermInput.trim();
    if (!cleanAlias) {
      setSaveMessage("Alias term is required.");
      return;
    }
    if (!aliasCanonicalProductId) {
      setSaveMessage("Select a canonical product first.");
      return;
    }

    setIsSavingAliasMapping(true);
    setSaveMessage(null);
    try {
      await apiFetch("/api/admin/canonical-products/aliases", {
        method: "POST",
        body: JSON.stringify({
          canonicalProductId: aliasCanonicalProductId,
          alias: cleanAlias,
          lang: aliasLang,
          priority: aliasPriority,
          isActive: true
        })
      });

      setSaveMessage(`Alias saved: "${cleanAlias}"`);
      await Promise.all([fetchInsightsAndCatalog(), fetchReviewQueue()]);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Unable to save alias mapping.");
    } finally {
      setIsSavingAliasMapping(false);
    }
  };

  const onRefreshDataset = async () => {
    setIsRebuildingDataset(true);
    setSaveMessage(null);
    try {
      await apiFetch("/api/admin/rebuild-search-dataset", { method: "POST" });
      setSaveMessage("Search dataset refreshed.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Dataset refresh failed.");
    } finally {
      setIsRebuildingDataset(false);
    }
  };

  const onRefreshPanel = async () => {
    if (!adminKey) return;
    setIsRefreshing(true);
    try {
      if (tab === "today" || tab === "insights" || tab === "catalog") {
        await fetchInsightsAndCatalog();
        if (tab === "today") {
          await fetchReviewQueue();
        }
        return;
      }

      if (tab === "review") {
        await fetchReviewQueue();
        return;
      }

      if (tab === "districts") {
        await fetchDistrictOverview();
        if (hasLoadedDistrictMap) {
          await fetchDistrictMapPoints();
        }
        return;
      }

      if (tab === "businesses") {
        await fetchBusinesses({ preserveSelection: true });
        if (selectedBusinessId) {
          await fetchDetail(selectedBusinessId);
        }
      }
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectedIdSet = useMemo(() => new Set<number>(bulkSelectedIds), [bulkSelectedIds]);

  const toggleSelectBusiness = (id: number) => {
    setBulkSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectCurrentPage = () => {
    setBulkSelectedIds((current) => {
      const next = new Set(current);
      for (const item of businesses) {
        next.add(item.id);
      }
      return [...next];
    });
  };

  const clearBulkSelection = () => {
    setBulkSelectedIds([]);
  };

  const onApplyBulkUpdate = async () => {
    if (bulkSelectedIds.length === 0) {
      setSaveMessage("Select at least one business.");
      return;
    }

    const categories = parseCommaList(bulkCategoriesInput);
    const hasStatus = bulkActiveStatus !== "keep";
    if (!hasStatus && categories.length === 0) {
      setSaveMessage("Choose a status or categories for bulk update.");
      return;
    }

    setIsApplyingBulk(true);
    setSaveMessage(null);

    try {
      const payload = (await apiFetch("/api/admin/establishments/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids: bulkSelectedIds,
          activeStatus: hasStatus ? bulkActiveStatus : undefined,
          appendCategories: categories
        })
      })) as { updated_count: number; failed_ids: number[] };

      const failedCount = payload.failed_ids.length;
      if (failedCount > 0) {
        setSaveMessage(`Bulk updated ${payload.updated_count}. Failed: ${failedCount}.`);
      } else {
        setSaveMessage(`Bulk updated ${payload.updated_count} businesses.`);
      }

      setBulkSelectedIds([]);
      setBulkCategoriesInput("");
      setBulkActiveStatus("keep");
      await Promise.all([fetchBusinesses({ preserveSelection: true }), fetchReviewQueue()]);
      if (selectedBusinessId) {
        await fetchDetail(selectedBusinessId);
      }
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Bulk update failed.");
    } finally {
      setIsApplyingBulk(false);
    }
  };

  const onQuickStatusUpdate = async (id: number, status: ActiveStatus) => {
    setSaveMessage(null);
    try {
      await apiFetch(`/api/admin/establishments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ activeStatus: status })
      });
      await Promise.all([fetchReviewQueue(), fetchBusinesses({ preserveSelection: true })]);
      if (selectedBusinessId === id) {
        await fetchDetail(id);
      }
      setSaveMessage(`Status updated for #${id}.`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Quick status update failed.");
    }
  };

  const onOpenReviewBusiness = (id: number) => {
    setTab("businesses");
    setSelectedBusinessId(id);
  };

  const onUseTermForBusinessSearch = async (term: string) => {
    setBusinessQuery(term);
    setTab("businesses");
    await fetchBusinesses({ query: term, offset: 0 });
  };

  const onRunDistrictRefresh = async (district: string) => {
    const cleanDistrict = district.trim();
    if (!cleanDistrict) return;
    setDistrictActionLoading(cleanDistrict);
    setSaveMessage(null);
    try {
      const payload = (await apiFetch("/api/admin/districts/refresh", {
        method: "POST",
        body: JSON.stringify({
          district: cleanDistrict,
          maxProductsPerEstablishment: 12
        })
      })) as {
        stats?: {
          establishments: number;
          candidates_upserted: number;
          merged_upserted: number;
          merged_deleted: number;
        };
      };

      const stats = payload.stats;
      if (stats) {
        setSaveMessage(
          `District refreshed (${cleanDistrict}) · establishments ${stats.establishments} · candidates ${stats.candidates_upserted} · merged ${stats.merged_upserted}/${stats.merged_deleted}`
        );
      } else {
        setSaveMessage(`District refreshed (${cleanDistrict}).`);
      }

      if (hasLoadedDistrictMap) {
        await Promise.all([fetchDistrictOverview(), fetchDistrictMapPoints({ district: cleanDistrict })]);
      } else {
        await fetchDistrictOverview();
      }
      setDistrictFilter(cleanDistrict);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "District refresh failed.");
    } finally {
      setDistrictActionLoading((current) => (current === cleanDistrict ? null : current));
    }
  };

  const onCopyDistrictImportCommand = async (district: string) => {
    const cleanDistrict = district.trim();
    if (!cleanDistrict) return;
    const command = `npm run import:berlin -- --district-filter="${cleanDistrict}" && npm run classify:establishments && npm run generate:rule-candidates && npm run merge:candidates && npm run build:search-dataset`;
    try {
      await navigator.clipboard.writeText(command);
      setSaveMessage(`Import command copied for ${cleanDistrict}.`);
    } catch {
      setSaveMessage(command);
    }
  };

  const onApplyDistrictMapFilters = async () => {
    await fetchDistrictMapPoints({
      district: districtFilter,
      category: categoryFilter,
      activeOnly: activeOnlyFilter
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const listLimit = (key: string, compactLimit: number, total: number) => {
    if (expandedSections[key]) return total;
    return compactLimit;
  };

  return (
    <section className="surface-card p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 hand-divider pb-3">
        <div>
          <h1 className="note-title">{copy.title}</h1>
          <p className="text-sm text-[var(--ink-soft)]">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={onRefreshPanel} disabled={!adminKey || isRefreshing}>
            {isRefreshing ? copy.loading : copy.refresh}
          </button>
          <button type="button" className="btn-primary" onClick={onRefreshDataset} disabled={!adminKey || isRebuildingDataset}>
            <span className="btn-label">{isRebuildingDataset ? copy.rebuilding : copy.rebuildDataset}</span>
          </button>
        </div>
      </div>

      {!adminKey && (
        <div className="surface-card border-dashed p-3">
          <p className="note-subtitle mb-1">{copy.keyTitle}</p>
          <p className="mb-3 text-sm text-[var(--ink-soft)]">{copy.keyHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="field-input w-full max-w-[340px]"
              placeholder={copy.keyPlaceholder}
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              type="password"
            />
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(event) => setRememberKey(event.target.checked)}
              />
              {copy.saveKey}
            </label>
            <button type="button" className="btn-primary" onClick={onUnlock}>
              <span className="btn-label">{copy.unlock}</span>
            </button>
          </div>
          {authError && <p className="mt-2 text-sm text-[var(--danger-ink)]">{authError}</p>}
        </div>
      )}

      {adminKey && (
        <>
          <div className="my-4 flex flex-wrap gap-2">
            {(Object.keys(copy.tabs) as AdminTab[]).map((tabName) => (
              <button
                key={tabName}
                type="button"
                className={`btn-ghost ${tab === tabName ? "is-active" : ""}`}
                onClick={() => setTab(tabName)}
              >
                {copy.tabs[tabName]}
              </button>
            ))}
          </div>

          {isBootstrapping && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
          {authError && <p className="text-sm text-[var(--danger-ink)]">{authError}</p>}

          {!isBootstrapping && tab === "today" && (
            <div className="space-y-4">
              <div className="surface-card p-3">
                <p className="note-subtitle">{copy.todayTitle}</p>
                <p className="text-sm text-[var(--ink-soft)]">{copy.todayHint}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="surface-card p-3">
                  <p className="note-label">Searches (30d)</p>
                  <p className="text-xl font-semibold">{insights?.totals.searches ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Unresolved terms</p>
                  <p className="text-xl font-semibold">{reviewQueue?.queue_totals.unresolved_terms ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Flagged businesses</p>
                  <p className="text-xl font-semibold">{reviewQueue?.queue_totals.businesses_flagged ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Unresolved rate</p>
                  <p className="text-xl font-semibold">
                    {insights ? `${Math.round(insights.totals.unresolved_rate * 100)}%` : "0%"}
                  </p>
                </div>
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">{copy.quickActionsTitle}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setTab("review");
                    }}
                  >
                    {copy.reviewQueue}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setTab("businesses");
                    }}
                  >
                    {copy.tabs.businesses}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setTab("districts");
                    }}
                  >
                    {copy.tabs.districts}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      void onGenerateRuleSuggestions();
                    }}
                    disabled={isGeneratingRuleSuggestions}
                  >
                    {isGeneratingRuleSuggestions ? copy.runningRuleSuggestion : copy.runRuleSuggestion}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.unresolvedTermsReview}</p>
                  {isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {reviewQueue?.unresolved_terms?.length ? (
                    <>
                      <ul className="space-y-2">
                        {reviewQueue.unresolved_terms
                          .slice(0, listLimit("today:unresolved", 8, reviewQueue.unresolved_terms.length))
                          .map((term) => (
                            <li key={term.term} className="rounded-md border border-[var(--line)] p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{term.term}</span>
                                <span className="mono text-xs text-[var(--ink-soft)]">{term.count}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => onUseTermForBusinessSearch(term.term)}
                                >
                                  {copy.useForSearch}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => {
                                    void onPrepareAliasFix(term.term);
                                  }}
                                  disabled={isPreparingAlias}
                                >
                                  {isPreparingAlias ? copy.preparingAlias : copy.prepareAliasFix}
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                      {reviewQueue.unresolved_terms.length > 8 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("today:unresolved")}
                        >
                          {expandedSections["today:unresolved"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>

                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.flaggedBusinesses}</p>
                  {isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {reviewQueue?.establishment_queue?.length ? (
                    <>
                      <ul className="space-y-2">
                        {reviewQueue.establishment_queue
                          .slice(0, listLimit("today:flags", 8, reviewQueue.establishment_queue.length))
                          .map((item) => (
                            <li key={item.id} className="rounded-md border border-[var(--line)] p-2">
                              <p className="text-sm font-semibold">{item.name}</p>
                              <p className="text-xs text-[var(--ink-soft)]">
                                {item.district} · {item.product_count} products
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" className="btn-ghost text-xs" onClick={() => onOpenReviewBusiness(item.id)}>
                                  {copy.openInEditor}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => onQuickStatusUpdate(item.id, "active")}
                                >
                                  {copy.markActive}
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                      {reviewQueue.establishment_queue.length > 8 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("today:flags")}
                        >
                          {expandedSections["today:flags"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isBootstrapping && tab === "insights" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="surface-card p-3">
                  <p className="note-label">Searches (30d)</p>
                  <p className="text-xl font-semibold">{insights?.totals.searches ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Unresolved rate</p>
                  <p className="text-xl font-semibold">
                    {insights ? `${Math.round(insights.totals.unresolved_rate * 100)}%` : "0%"}
                  </p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Establishments</p>
                  <p className="text-xl font-semibold">{insights?.totals.establishments_total ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Canonical products</p>
                  <p className="text-xl font-semibold">{insights?.totals.canonical_products_total ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">{copy.suspectedFalsePositives}</p>
                  <p className="text-xl font-semibold">
                    {insights ? `${Math.round(insights.totals.suspected_false_positive_rate * 100)}%` : "0%"}
                  </p>
                </div>
              </div>

              <div className="surface-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="note-subtitle">{copy.ruleSuggestionsTitle}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-xs text-[var(--ink-soft)]">
                      {copy.pendingAutoRules}: {insights?.totals.rule_suggestions_pending_auto_apply ?? 0}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => {
                        void onGenerateRuleSuggestions();
                      }}
                      disabled={isGeneratingRuleSuggestions}
                    >
                      {isGeneratingRuleSuggestions ? copy.runningRuleSuggestion : copy.runRuleSuggestion}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => {
                        void onApplyAutoRules();
                      }}
                      disabled={isApplyingAutoRules}
                    >
                      {isApplyingAutoRules ? copy.applyingAutoRules : copy.applyAutoRules}
                    </button>
                  </div>
                </div>
                {insights?.rule_suggestions?.length ? (
                  <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                    {insights.rule_suggestions.slice(0, 12).map((row) => (
                      <li key={`rule-suggestion-${row.id}`} className="rounded-md border border-[var(--line)] p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {row.app_category} → {row.product_group}
                          </span>
                          <span className="mono text-xs text-[var(--ink-soft)]">{row.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          support {row.support_count} · positive {row.positive_count} · precision{" "}
                          {Math.round(Number(row.precision_score ?? 0) * 100)}%
                          {row.auto_apply_eligible ? " · auto-eligible" : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="surface-card p-3 xl:col-span-2">
                  <p className="note-subtitle mb-2">{copy.topSearches}</p>
                  {insights?.top_terms?.length ? (
                    <>
                      <ul className="space-y-1 text-sm">
                        {insights.top_terms
                          .slice(0, listLimit("insights:top-terms", 15, insights.top_terms.length))
                          .map((item) => (
                            <li key={item.term} className="flex items-center justify-between gap-2">
                              <span>{item.term}</span>
                              <span className="mono text-[var(--ink-soft)]">
                                {item.total} · no result {item.unresolved}
                              </span>
                            </li>
                          ))}
                      </ul>
                      {insights.top_terms.length > 15 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("insights:top-terms")}
                        >
                          {expandedSections["insights:top-terms"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.endpointUsage}</p>
                  {insights?.endpoint_usage?.length ? (
                    <ul className="space-y-1 text-sm">
                      {insights.endpoint_usage.map((item) => (
                        <li key={item.endpoint} className="flex items-center justify-between gap-2">
                          <span className="truncate">{item.endpoint}</span>
                          <span className="mono text-[var(--ink-soft)]">{item.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.categoryQuality}</p>
                  {insights?.category_quality?.length ? (
                    <ul className="space-y-1 text-sm">
                      {insights.category_quality.slice(0, 12).map((item) => (
                        <li key={item.group} className="flex items-center justify-between gap-2">
                          <span>{item.group.replaceAll("_", " ")}</span>
                          <span className="mono text-[var(--ink-soft)]">
                            {Math.round(item.suspicious_rate * 100)}% · {item.suspicious}/{item.total}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.suspiciousExamples}</p>
                  {insights?.suspicious_examples?.length ? (
                    <>
                      <ul className="space-y-2 text-sm">
                        {insights.suspicious_examples
                          .slice(0, listLimit("insights:suspicious", 14, insights.suspicious_examples.length))
                          .map((row) => (
                            <li
                              key={`${row.establishment_id}-${row.product_group}-${row.confidence}`}
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="font-medium">{row.establishment_name}</p>
                                <p className="text-[var(--ink-soft)]">
                                  {row.product_group} · {Math.round(row.confidence * 100)}% · {row.district}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="btn-ghost text-xs"
                                onClick={() => {
                                  void onPrepareSuspiciousExampleFix(row);
                                }}
                                disabled={isPreparingAlias}
                              >
                                {isPreparingAlias ? copy.preparingAlias : copy.prepareSuspiciousFix}
                              </button>
                            </li>
                          ))}
                      </ul>
                      {insights.suspicious_examples.length > 14 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("insights:suspicious")}
                        >
                          {expandedSections["insights:suspicious"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">{copy.unresolvedSearches}</p>
                {insights?.unresolved_recent?.length ? (
                  <>
                    <ul className="space-y-2 text-sm">
                      {insights.unresolved_recent
                        .slice(0, listLimit("insights:unresolved-recent", 20, insights.unresolved_recent.length))
                        .map((row) => (
                          <li key={`${row.search_term}-${row.timestamp}`} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{row.search_term}</span>
                            <span className="text-[var(--ink-soft)]">
                              {row.district ?? "Berlin"} · {row.radius_km ?? "?"}km · {formatDate(row.timestamp)}
                            </span>
                          </li>
                        ))}
                    </ul>
                    {insights.unresolved_recent.length > 20 && (
                      <button
                        type="button"
                        className="btn-ghost mt-2 text-xs"
                        onClick={() => toggleExpanded("insights:unresolved-recent")}
                      >
                        {expandedSections["insights:unresolved-recent"] ? copy.showLess : copy.showMore}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                )}
              </div>

              {topNoResultTerms.length > 0 && (
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">No-result terms to prioritize</p>
                  <div className="flex flex-wrap gap-2">
                    {topNoResultTerms.slice(0, 20).map((item) => (
                      <span key={item.term} className="rounded-full border border-[var(--line)] px-2 py-1 text-xs">
                        {item.term} ({item.unresolved})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isBootstrapping && tab === "review" && (
            <div className="space-y-4">
              <div className="surface-card p-3">
                <p className="note-subtitle">{copy.reviewQueue}</p>
                <p className="text-sm text-[var(--ink-soft)]">{copy.reviewQueueHint}</p>
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle">{copy.manualFixTitle}</p>
                <p className="mb-3 text-sm text-[var(--ink-soft)]">{copy.manualFixHint}</p>

                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                  <label className="space-y-1 text-sm">
                    <span className="note-label">{copy.aliasTermLabel}</span>
                    <input
                      type="text"
                      className="field-input"
                      value={aliasTermInput}
                      onChange={(event) => setAliasTermInput(event.target.value)}
                      placeholder="e.g. toothbrush, pharmacies, strawberry"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="note-label">{copy.aliasLangLabel}</span>
                    <select
                      className="field-input"
                      value={aliasLang}
                      onChange={(event) => setAliasLang(event.target.value as "und" | "en" | "de" | "es")}
                    >
                      <option value="und">und</option>
                      <option value="en">en</option>
                      <option value="de">de</option>
                      <option value="es">es</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="note-label">{copy.aliasPriorityLabel}</span>
                    <input
                      type="number"
                      className="field-input"
                      value={aliasPriority}
                      min={0}
                      max={100}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setAliasPriority(Math.max(0, Math.min(100, Math.round(next))));
                      }}
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    className="field-input min-w-[260px] flex-1"
                    value={aliasCanonicalQuery}
                    onChange={(event) => setAliasCanonicalQuery(event.target.value)}
                    placeholder={copy.productSearchPlaceholder}
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      void onSearchCanonicalForAlias();
                    }}
                    disabled={isSearchingAliasCanonical}
                  >
                    {isSearchingAliasCanonical ? copy.loadingProducts : copy.searchCanonicalForAlias}
                  </button>
                </div>

                {aliasCanonicalResults.length > 0 ? (
                  <ul className="mt-3 grid gap-2 md:grid-cols-2">
                    {aliasCanonicalResults.slice(0, 10).map((item) => (
                      <li key={`alias-canonical-${item.id}`} className="rounded-md border border-[var(--line)] p-2">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="radio"
                            name="alias-canonical-product"
                            checked={aliasCanonicalProductId === item.id}
                            onChange={() => setAliasCanonicalProductId(item.id)}
                          />
                          <span>
                            <span className="block text-sm font-semibold">{item.display_name_en || item.normalized_name}</span>
                            <span className="block text-xs text-[var(--ink-soft)]">
                              {item.product_group} · #{item.id}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      void onSaveAliasMapping();
                    }}
                    disabled={isSavingAliasMapping || !aliasTermInput.trim() || !aliasCanonicalProductId}
                  >
                    {isSavingAliasMapping ? copy.loading : copy.saveAliasMapping}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="surface-card p-3">
                  <p className="note-label">{copy.flaggedBusinesses}</p>
                  <p className="text-xl font-semibold">{reviewQueue?.queue_totals.businesses_flagged ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">{copy.unresolvedTermsReview}</p>
                  <p className="text-xl font-semibold">{reviewQueue?.queue_totals.unresolved_terms ?? 0}</p>
                </div>
                <div className="surface-card p-3 sm:col-span-2">
                  <p className="note-label">Quality flags</p>
                  {reviewQueue?.flag_totals?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {reviewQueue.flag_totals.map((item) => (
                        <span key={item.flag} className="rounded-full border border-[var(--line)] px-2 py-1 text-xs">
                          {reviewFlagLabel(item.flag)} ({item.count})
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.unresolvedTermsReview}</p>
                  {isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {reviewQueue?.unresolved_terms?.length ? (
                    <>
                      <ul className="space-y-2">
                        {reviewQueue.unresolved_terms
                          .slice(0, listLimit("review:unresolved", 25, reviewQueue.unresolved_terms.length))
                          .map((term) => (
                            <li key={term.term} className="rounded-md border border-[var(--line)] p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{term.term}</span>
                                <span className="mono text-xs text-[var(--ink-soft)]">{term.count}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-[var(--ink-soft)]">{formatDate(term.last_seen_at)}</span>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => onUseTermForBusinessSearch(term.term)}
                                >
                                  {copy.useForSearch}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => {
                                    void onPrepareAliasFix(term.term);
                                  }}
                                  disabled={isPreparingAlias}
                                >
                                  {isPreparingAlias ? copy.preparingAlias : copy.prepareAliasFix}
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                      {reviewQueue.unresolved_terms.length > 25 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("review:unresolved")}
                        >
                          {expandedSections["review:unresolved"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>

                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.flaggedBusinesses}</p>
                  {isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {reviewQueue?.establishment_queue?.length ? (
                    <>
                      <ul className="space-y-2">
                        {reviewQueue.establishment_queue
                          .slice(0, listLimit("review:flags", 28, reviewQueue.establishment_queue.length))
                          .map((item) => (
                            <li key={item.id} className="rounded-md border border-[var(--line)] p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold">{item.name}</p>
                                  <p className="text-xs text-[var(--ink-soft)]">
                                    {item.district} · {item.product_count} products · {item.validated_product_count} validated
                                  </p>
                                </div>
                                <span className="mono text-xs text-[var(--ink-soft)]">#{item.id}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.flags.map((flag) => (
                                  <span key={`${item.id}-${flag}`} className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">
                                    {reviewFlagLabel(flag)}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" className="btn-ghost text-xs" onClick={() => onOpenReviewBusiness(item.id)}>
                                  {copy.openInEditor}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => onQuickStatusUpdate(item.id, "active")}
                                >
                                  {copy.markActive}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => onQuickStatusUpdate(item.id, "temporarily_closed")}
                                >
                                  {copy.markTempClosed}
                                </button>
                              </div>
                            </li>
                          ))}
                      </ul>
                      {reviewQueue.establishment_queue.length > 28 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("review:flags")}
                        >
                          {expandedSections["review:flags"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isBootstrapping && tab === "catalog" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="surface-card p-3">
                  <p className="note-label">Canonical products</p>
                  <p className="text-xl font-semibold">{catalog?.totals.canonical_products ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Aliases</p>
                  <p className="text-xl font-semibold">{catalog?.totals.aliases ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Facets</p>
                  <p className="text-xl font-semibold">{catalog?.totals.facets ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Use cases</p>
                  <p className="text-xl font-semibold">{catalog?.totals.use_cases ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Taxonomy categories</p>
                  <p className="text-xl font-semibold">{catalog?.totals.taxonomy_categories ?? 0}</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.categories}</p>
                  {catalog?.categories?.length ? (
                    <>
                      <ul className="space-y-1 text-sm">
                        {catalog.categories
                          .slice(0, listLimit("catalog:categories", 80, catalog.categories.length))
                          .map((item) => (
                            <li key={item.slug} className="flex items-center justify-between gap-2">
                              <span className="truncate">{item.slug}</span>
                              <span className="mono text-[var(--ink-soft)]">{item.establishment_count}</span>
                            </li>
                          ))}
                      </ul>
                      {catalog.categories.length > 80 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("catalog:categories")}
                        >
                          {expandedSections["catalog:categories"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>

                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.productGroups}</p>
                  {catalog?.products_by_group?.length ? (
                    <>
                      <ul className="space-y-2 text-sm">
                        {catalog.products_by_group
                          .slice(0, listLimit("catalog:groups", 60, catalog.products_by_group.length))
                          .map((group) => (
                            <li key={group.group} className="rounded-md border border-[var(--line)] p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{group.group}</span>
                                <span className="mono text-[var(--ink-soft)]">{group.count}</span>
                              </div>
                              {group.sample.length > 0 && (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">{group.sample.join(", ")}</p>
                              )}
                            </li>
                          ))}
                      </ul>
                      {catalog.products_by_group.length > 60 && (
                        <button
                          type="button"
                          className="btn-ghost mt-2 text-xs"
                          onClick={() => toggleExpanded("catalog:groups")}
                        >
                          {expandedSections["catalog:groups"] ? copy.showLess : copy.showMore}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">Family connections (core → aliases/facets/use cases)</p>
                {catalog?.product_families?.length ? (
                  <>
                    <ul className="space-y-2 text-sm">
                      {catalog.product_families
                        .slice(0, listLimit("catalog:families", 120, catalog.product_families.length))
                        .map((family) => (
                          <li key={family.id} className="rounded-md border border-[var(--line)] p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{family.display_name_en}</span>
                              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">{family.group}</span>
                              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px]">{family.coverage_tier}</span>
                              <span className="mono text-xs text-[var(--ink-soft)]">
                                p{family.priority} · stores {family.store_count}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--ink-soft)]">
                              family_slug: {family.family_slug} · id: {family.id}
                            </p>
                            {family.aliases_sample.length > 0 && (
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                aliases ({family.alias_count}): {family.aliases_sample.join(", ")}
                              </p>
                            )}
                            {family.facets_sample.length > 0 && (
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                facets ({family.facet_count}): {family.facets_sample.join(", ")}
                              </p>
                            )}
                            {family.use_cases_sample.length > 0 && (
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                use cases ({family.use_case_count}): {family.use_cases_sample.join(", ")}
                              </p>
                            )}
                          </li>
                        ))}
                    </ul>
                    {catalog.product_families.length > 120 && (
                      <button
                        type="button"
                        className="btn-ghost mt-2 text-xs"
                        onClick={() => toggleExpanded("catalog:families")}
                      >
                        {expandedSections["catalog:families"] ? copy.showLess : copy.showMore}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                )}
              </div>
            </div>
          )}

          {!isBootstrapping && tab === "districts" && (
            <div className="space-y-4">
              <div className="surface-card p-3">
                <p className="note-subtitle">{copy.districtsTitle}</p>
                <p className="text-sm text-[var(--ink-soft)]">{copy.districtsHint}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="surface-card p-3">
                  <p className="note-label">Districts</p>
                  <p className="text-xl font-semibold">{districtOverview?.totals.districts ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Businesses</p>
                  <p className="text-xl font-semibold">{districtOverview?.totals.establishments ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">Active</p>
                  <p className="text-xl font-semibold">{districtOverview?.totals.active ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">With products</p>
                  <p className="text-xl font-semibold">{districtOverview?.totals.with_products ?? 0}</p>
                </div>
                <div className="surface-card p-3">
                  <p className="note-label">With geo</p>
                  <p className="text-xl font-semibold">{districtOverview?.totals.with_geo ?? 0}</p>
                </div>
              </div>

              <div className="surface-card p-3 space-y-3">
                <p className="note-subtitle">{copy.mapPointsTitle}</p>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] xl:grid-cols-[1fr_1fr_auto_auto]">
                  <label className="text-sm">
                    <span className="note-label">{copy.districtFilterLabel}</span>
                    <select
                      className="field-input mt-1"
                      value={districtFilter}
                      onChange={(event) => setDistrictFilter(event.target.value)}
                    >
                      <option value="">All districts</option>
                      {districtOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="note-label">{copy.categoryFilterLabel}</span>
                    <select
                      className="field-input mt-1"
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value)}
                    >
                      <option value="">All categories</option>
                      {categoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={activeOnlyFilter}
                      onChange={(event) => setActiveOnlyFilter(event.target.checked)}
                    />
                    {copy.activeOnlyLabel}
                  </label>
                  <button
                    type="button"
                    className="btn-secondary self-end"
                    onClick={onApplyDistrictMapFilters}
                    disabled={isLoadingDistrictMap}
                  >
                    {isLoadingDistrictMap
                      ? copy.loadingDistrictMap
                      : hasLoadedDistrictMap
                        ? copy.refresh
                        : copy.loadDistrictMap}
                  </button>
                </div>
                <p className="text-xs text-[var(--ink-soft)]">
                  {hasLoadedDistrictMap
                    ? `${districtMapPoints?.total ?? 0} points on map · filter by district/category to inspect data quality.`
                    : "Map points are loaded on demand to keep admin fast."}
                </p>
                {hasLoadedDistrictMap ? (
                  <AdminCoverageMap points={districtMapPoints?.points ?? []} selectedDistrict={districtFilter} />
                ) : null}
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">District operational table</p>
                {isLoadingDistrictOverview && <p className="mb-2 text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                {districtRows.length ? (
                  <div className="space-y-2">
                    {districtRows.map((item) => {
                      const isRunning = districtActionLoading === item.district;
                      return (
                        <div key={item.district} className="rounded-md border border-[var(--line)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">{item.district}</p>
                              <p className="text-xs text-[var(--ink-soft)]">
                                total {item.establishments_total} · active {item.active_total} · temp closed{" "}
                                {item.temporarily_closed_total} · inactive {item.inactive_total}
                              </p>
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                with products {item.with_products_total} · opening hours {item.with_opening_hours_total} · geo{" "}
                                {item.with_geo_total} · updated 7d {item.recently_updated_7d_total}
                              </p>
                              {item.top_categories.length > 0 && (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  top categories:{" "}
                                  {item.top_categories.map((top) => `${top.slug} (${top.count})`).join(", ")}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => onRunDistrictRefresh(item.district)}
                                disabled={Boolean(districtActionLoading)}
                              >
                                {isRunning ? copy.runningDistrictRefresh : copy.runDistrictRefresh}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost text-xs"
                                onClick={() => onCopyDistrictImportCommand(item.district)}
                              >
                                {copy.copyDistrictImportCommand}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  !isLoadingDistrictOverview && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                )}
              </div>
            </div>
          )}

          {!isBootstrapping && tab === "businesses" && (
            <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="surface-card p-3">
                <div className="mb-2 flex gap-2">
                  <input
                    className="field-input"
                    placeholder={copy.businessSearchPlaceholder}
                    value={businessQuery}
                    onChange={(event) => setBusinessQuery(event.target.value)}
                  />
                  <button type="button" className="btn-secondary" onClick={onSearchBusinesses}>
                    {copy.refresh}
                  </button>
                </div>

                <div className="mb-3 rounded-md border border-[var(--line)] p-2">
                  <p className="note-subtitle mb-1">{copy.bulkEdit}</p>
                  <p className="mb-2 text-xs text-[var(--ink-soft)]">
                    {template(copy.selectedCount, { count: String(bulkSelectedIds.length) })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-ghost text-xs" onClick={selectCurrentPage}>
                      {copy.selectPage}
                    </button>
                    <button type="button" className="btn-ghost text-xs" onClick={clearBulkSelection}>
                      {copy.clearSelection}
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2">
                    <label className="text-xs text-[var(--ink-soft)]">
                      {copy.bulkStatusLabel}
                      <select
                        className="field-input mt-1"
                        value={bulkActiveStatus}
                        onChange={(event) => setBulkActiveStatus(event.target.value as BulkActiveStatus)}
                      >
                        <option value="keep">{copy.keepStatus}</option>
                        <option value="active">active</option>
                        <option value="temporarily_closed">temporarily_closed</option>
                        <option value="inactive">inactive</option>
                        <option value="unknown">unknown</option>
                      </select>
                    </label>
                    <label className="text-xs text-[var(--ink-soft)]">
                      {copy.appendCategories}
                      <input
                        className="field-input mt-1"
                        value={bulkCategoriesInput}
                        onChange={(event) => setBulkCategoriesInput(event.target.value)}
                        placeholder="pharmacy, hardware-store"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={bulkSelectedIds.length === 0 || isApplyingBulk}
                      onClick={onApplyBulkUpdate}
                    >
                      <span className="btn-label">{isApplyingBulk ? copy.loading : copy.applyBulk}</span>
                    </button>
                  </div>
                </div>

                <p className="mb-2 text-xs text-[var(--ink-soft)]">
                  {template(copy.listSummary, {
                    shown: String(shownBusinesses),
                    total: String(totalBusinesses)
                  })}
                </p>
                <div className="space-y-2">
                  {isLoadingBusinesses && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {businesses.map((item) => (
                    <div
                      key={item.id}
                      className={`w-full rounded-md border p-2 text-left ${
                        selectedBusinessId === item.id ? "border-[var(--ink)]" : "border-[var(--line)]"
                      }`}
                    >
                      <div className="mb-1 flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIdSet.has(item.id)}
                          onChange={() => toggleSelectBusiness(item.id)}
                          aria-label={`Select ${item.name}`}
                        />
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedBusinessId(item.id)}>
                          <p className="truncate text-sm font-semibold">{item.name}</p>
                          <p className="text-xs text-[var(--ink-soft)]">{item.district}</p>
                          <p className="text-xs text-[var(--ink-soft)]">
                            {toCommaList(item.app_categories) || "no categories"} · {item.product_count} products
                          </p>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={businessOffset <= 0}
                    onClick={() => fetchBusinesses({ offset: Math.max(0, businessOffset - pageSize), preserveSelection: true })}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={businessOffset + pageSize >= totalBusinesses}
                    onClick={() => fetchBusinesses({ offset: businessOffset + pageSize, preserveSelection: true })}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="surface-card p-3">
                {!selectedBusinessId && <p className="text-sm text-[var(--ink-soft)]">{copy.noBusinessSelected}</p>}
                {selectedBusinessId && isLoadingDetail && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}

                {selectedBusinessId && businessDetail && !isLoadingDetail && (
                  <div className="space-y-3">
                    <div className="hand-divider pb-2">
                      <h2 className="note-subtitle">{businessDetail.establishment.name}</h2>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {businessDetail.establishment.address} · {businessDetail.establishment.external_source}/
                        {businessDetail.establishment.external_id}
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="note-label">{copy.districtLabel}</span>
                        <input className="field-input mt-1" value={editDistrict} onChange={(event) => setEditDistrict(event.target.value)} />
                      </label>

                      <label className="text-sm">
                        <span className="note-label">{copy.activeStatusLabel}</span>
                        <select
                          className="field-input mt-1"
                          value={editActiveStatus}
                          onChange={(event) => setEditActiveStatus(event.target.value as typeof editActiveStatus)}
                        >
                          <option value="active">active</option>
                          <option value="temporarily_closed">temporarily_closed</option>
                          <option value="inactive">inactive</option>
                          <option value="unknown">unknown</option>
                        </select>
                      </label>
                    </div>

                    <div className="text-sm">
                      <span className="note-label">{copy.categoriesLabel}</span>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">{copy.categoriesHint}</p>
                      <input
                        className="field-input mt-2"
                        value={categoryPickerQuery}
                        placeholder={copy.categoryPickerSearchPlaceholder}
                        onChange={(event) => setCategoryPickerQuery(event.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {editCategories.length > 0 ? (
                          editCategories.map((category) => (
                            <button
                              key={`selected-category-${category}`}
                              type="button"
                              className="btn-ghost text-xs is-active"
                              onClick={() => onToggleBusinessCategory(category)}
                            >
                              {category}
                            </button>
                          ))
                        ) : (
                          <span className="text-xs text-[var(--ink-soft)]">{copy.noData}</span>
                        )}
                      </div>
                      <div className="mt-2 max-h-40 overflow-auto rounded-md border border-[var(--line)] p-2">
                        {filteredBusinessCategoryOptions.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {filteredBusinessCategoryOptions.slice(0, 80).map((category) => (
                              <button
                                key={`taxonomy-category-${category.slug}`}
                                type="button"
                                className={`btn-ghost text-xs ${editCategories.includes(category.slug) ? "is-active" : ""}`}
                                onClick={() => onToggleBusinessCategory(category.slug)}
                              >
                                {category.label} ({category.count})
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--ink-soft)]">{copy.noCategoryMatches}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="note-label">{copy.websiteLabel}</span>
                        <input
                          className="field-input mt-1"
                          value={editWebsite}
                          onChange={(event) => setEditWebsite(event.target.value)}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="note-label">{copy.phoneLabel}</span>
                        <input className="field-input mt-1" value={editPhone} onChange={(event) => setEditPhone(event.target.value)} />
                      </label>
                    </div>

                    <label className="text-sm">
                      <span className="note-label">{copy.openingHoursLabel}</span>
                      <input
                        className="field-input mt-1"
                        value={editOpeningHours}
                        onChange={(event) => setEditOpeningHours(event.target.value)}
                      />
                    </label>

                    <label className="text-sm">
                      <span className="note-label">{copy.descriptionLabel}</span>
                      <textarea
                        className="field-input mt-1 min-h-[76px]"
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                      />
                    </label>

                    <button type="button" className="btn-primary" onClick={onSaveBusiness} disabled={isSavingBusiness}>
                      <span className="btn-label">{isSavingBusiness ? copy.loading : copy.saveChanges}</span>
                    </button>

                    <div className="hand-divider pt-2">
                      <p className="note-subtitle">{copy.productsInStore}</p>
                      <input
                        className="field-input mt-2"
                        value={productActionReason}
                        placeholder={copy.productActionReasonPlaceholder}
                        onChange={(event) => setProductActionReason(event.target.value)}
                      />
                      {businessDetail.products.length === 0 ? (
                        <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                      ) : (
                        <ul className="mt-2 space-y-2 text-sm">
                          {businessDetail.products.slice(0, 50).map((item) => (
                            <li key={item.canonical_product_id} className="rounded-md border border-[var(--line)] p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  {item.product?.display_name_en ?? item.product?.normalized_name ?? item.canonical_product_id}
                                </span>
                                <span className="mono text-[var(--ink-soft)]">
                                  {item.validation_status} · {Math.round(item.confidence * 100)}%
                                </span>
                              </div>
                              {item.product && (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  group: {item.product.product_group}
                                </p>
                              )}
                              {item.product?.aliases?.length ? (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  aliases: {item.product.aliases.slice(0, 6).join(", ")}
                                </p>
                              ) : null}
                              {item.product?.facets?.length ? (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  facets: {item.product.facets.join(", ")}
                                </p>
                              ) : null}
                              {item.product?.use_cases?.length ? (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  use cases: {item.product.use_cases.join(", ")}
                                </p>
                              ) : null}
                              {item.why_this_product_matches ? (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">why: {item.why_this_product_matches}</p>
                              ) : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => {
                                    void onProductAction(item.canonical_product_id, "validate");
                                  }}
                                  disabled={Boolean(productActionBusyKey)}
                                >
                                  {productActionBusyKey === `${item.canonical_product_id}:validate`
                                    ? copy.loading
                                    : copy.validateProduct}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => {
                                    void onProductAction(item.canonical_product_id, "reject");
                                  }}
                                  disabled={Boolean(productActionBusyKey)}
                                >
                                  {productActionBusyKey === `${item.canonical_product_id}:reject`
                                    ? copy.loading
                                    : copy.rejectProduct}
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost text-xs"
                                  onClick={() => {
                                    void onProductAction(item.canonical_product_id, "remove");
                                  }}
                                  disabled={Boolean(productActionBusyKey)}
                                >
                                  {productActionBusyKey === `${item.canonical_product_id}:remove`
                                    ? copy.loading
                                    : copy.removeProduct}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="hand-divider pt-2">
                      <p className="note-subtitle mb-2">{copy.addProduct}</p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          className="field-input min-w-[240px] flex-1"
                          placeholder={copy.productSearchPlaceholder}
                          value={canonicalQuery}
                          onChange={(event) => setCanonicalQuery(event.target.value)}
                        />
                        <button type="button" className="btn-secondary" onClick={onSearchCanonicalProducts}>
                          {isSearchingCanonical ? copy.loadingProducts : copy.refresh}
                        </button>
                      </div>

                      {canonicalResults.length > 0 && (
                        <div className="mt-2 max-h-52 overflow-auto rounded-md border border-[var(--line)]">
                          {canonicalResults.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`block w-full border-b border-[var(--line)] px-2 py-2 text-left text-sm last:border-b-0 ${
                                manualProductId === item.id ? "bg-[var(--surface-soft)]" : ""
                              }`}
                              onClick={() => setManualProductId(item.id)}
                            >
                              <p>{item.display_name_en || item.normalized_name}</p>
                              <p className="text-xs text-[var(--ink-soft)]">{item.product_group}</p>
                              {(item.facets?.length || item.synonyms?.length) && (
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  {item.facets?.length ? `facets: ${item.facets.join(", ")}` : ""}
                                  {item.facets?.length && item.synonyms?.length ? " · " : ""}
                                  {item.synonyms?.length ? `aliases: ${item.synonyms.slice(0, 4).join(", ")}` : ""}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      <input
                        className="field-input mt-2"
                        placeholder={copy.reasonPlaceholder}
                        value={manualReason}
                        onChange={(event) => setManualReason(event.target.value)}
                      />

                      <button
                        type="button"
                        className="btn-primary mt-2"
                        disabled={!manualProductId || isAddingProduct}
                        onClick={onAddManualProduct}
                      >
                        <span className="btn-label">{isAddingProduct ? copy.loading : copy.add}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {saveMessage && <p className="mt-3 text-sm text-[var(--ink-soft)]">{saveMessage}</p>}
        </>
      )}
    </section>
  );
}
