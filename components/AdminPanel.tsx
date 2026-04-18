"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/lib/types";

type AdminTab = "insights" | "review" | "catalog" | "businesses";
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
};

type CatalogPayload = {
  totals: {
    taxonomy_categories: number;
    canonical_products: number;
    establishments_with_categories: number;
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
      insights: "Insights",
      review: "Review queue",
      catalog: "Catalog",
      businesses: "Businesses"
    },
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
    keepStatus: "keep current"
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
      insights: "Insights",
      review: "Prüfwarteschlange",
      catalog: "Katalog",
      businesses: "Läden"
    },
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
    keepStatus: "unverändert lassen"
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
  const [tab, setTab] = useState<AdminTab>("insights");
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

  const [editCategories, setEditCategories] = useState("");
  const [editActiveStatus, setEditActiveStatus] = useState<ActiveStatus>("active");
  const [editWebsite, setEditWebsite] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editOpeningHours, setEditOpeningHours] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDistrict, setEditDistrict] = useState("");
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);

  const [canonicalQuery, setCanonicalQuery] = useState("");
  const [canonicalResults, setCanonicalResults] = useState<CanonicalProductSearch["rows"]>([]);
  const [isSearchingCanonical, setIsSearchingCanonical] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const [manualProductId, setManualProductId] = useState<number | null>(null);
  const [isAddingProduct, setIsAddingProduct] = useState(false);

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
        setEditCategories(toCommaList(payload.establishment.app_categories));
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
        await Promise.all([fetchInsightsAndCatalog(), fetchReviewQueue(), fetchBusinesses({ offset: 0 })]);
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
  }, [adminKey, copy.unauthorized, fetchBusinesses, fetchInsightsAndCatalog, fetchReviewQueue]);

  useEffect(() => {
    if (!selectedBusinessId || !adminKey) return;
    fetchDetail(selectedBusinessId).catch((error) => {
      setSaveMessage(error instanceof Error ? error.message : "Detail load failed.");
    });
  }, [adminKey, fetchDetail, selectedBusinessId]);

  const topNoResultTerms = useMemo(() => insights?.unresolved_terms ?? [], [insights]);

  const businesses = businessListResponse?.rows ?? [];
  const totalBusinesses = businessListResponse?.pagination.total ?? 0;
  const shownBusinesses = businesses.length;

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
          appCategories: parseCommaList(editCategories),
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
    await Promise.all([
      fetchInsightsAndCatalog(),
      fetchReviewQueue(),
      fetchBusinesses({ preserveSelection: true })
    ]);
  };

  useEffect(() => {
    if (!adminKey || tab !== "review" || reviewQueue || isLoadingReviewQueue) {
      return;
    }
    fetchReviewQueue().catch((error) => {
      setSaveMessage(error instanceof Error ? error.message : "Unable to load review queue.");
    });
  }, [adminKey, fetchReviewQueue, isLoadingReviewQueue, reviewQueue, tab]);

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

          {!isBootstrapping && tab === "insights" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="surface-card p-3 xl:col-span-2">
                  <p className="note-subtitle mb-2">{copy.topSearches}</p>
                  {insights?.top_terms?.length ? (
                    <ul className="space-y-1 text-sm">
                      {insights.top_terms.slice(0, 15).map((item) => (
                        <li key={item.term} className="flex items-center justify-between gap-2">
                          <span>{item.term}</span>
                          <span className="mono text-[var(--ink-soft)]">
                            {item.total} · no result {item.unresolved}
                          </span>
                        </li>
                      ))}
                    </ul>
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

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">{copy.unresolvedSearches}</p>
                {insights?.unresolved_recent?.length ? (
                  <ul className="space-y-2 text-sm">
                    {insights.unresolved_recent.slice(0, 20).map((row) => (
                      <li key={`${row.search_term}-${row.timestamp}`} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{row.search_term}</span>
                        <span className="text-[var(--ink-soft)]">
                          {row.district ?? "Berlin"} · {row.radius_km ?? "?"}km · {formatDate(row.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
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
                    <ul className="space-y-2">
                      {reviewQueue.unresolved_terms.slice(0, 25).map((term) => (
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
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>

                <div className="surface-card p-3">
                  <p className="note-subtitle mb-2">{copy.flaggedBusinesses}</p>
                  {isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.loading}</p>}
                  {reviewQueue?.establishment_queue?.length ? (
                    <ul className="space-y-2">
                      {reviewQueue.establishment_queue.slice(0, 28).map((item) => (
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
                  ) : (
                    !isLoadingReviewQueue && <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isBootstrapping && tab === "catalog" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">{copy.categories}</p>
                {catalog?.categories?.length ? (
                  <ul className="space-y-1 text-sm">
                    {catalog.categories.slice(0, 80).map((item) => (
                      <li key={item.slug} className="flex items-center justify-between gap-2">
                        <span className="truncate">{item.slug}</span>
                        <span className="mono text-[var(--ink-soft)]">{item.establishment_count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                )}
              </div>

              <div className="surface-card p-3">
                <p className="note-subtitle mb-2">{copy.productGroups}</p>
                {catalog?.products_by_group?.length ? (
                  <ul className="space-y-2 text-sm">
                    {catalog.products_by_group.slice(0, 60).map((group) => (
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
                ) : (
                  <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
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

                    <label className="text-sm">
                      <span className="note-label">{copy.categoriesLabel}</span>
                      <input
                        className="field-input mt-1"
                        value={editCategories}
                        onChange={(event) => setEditCategories(event.target.value)}
                      />
                    </label>

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
                      {businessDetail.products.length === 0 ? (
                        <p className="text-sm text-[var(--ink-soft)]">{copy.noData}</p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-sm">
                          {businessDetail.products.slice(0, 50).map((item) => (
                            <li key={item.canonical_product_id} className="flex flex-wrap items-center justify-between gap-2">
                              <span>{item.product?.display_name_en ?? item.product?.normalized_name ?? item.canonical_product_id}</span>
                              <span className="mono text-[var(--ink-soft)]">
                                {item.validation_status} · {Math.round(item.confidence * 100)}%
                              </span>
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
