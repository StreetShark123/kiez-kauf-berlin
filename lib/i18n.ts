import type { Locale } from "@/lib/types";

export type Dictionary = {
  appTitle: string;
  appSubtitle: string;
  searchPlaceholder: string;
  radiusLabel: string;
  searchButton: string;
  useMyLocation: string;
  addressSectionTitle: string;
  locationFallbackLabel: string;
  locationFallbackPlaceholder: string;
  resolveLocationButton: string;
  resultsTitle: string;
  mapTitle: string;
  goToResults: string;
  goToMap: string;
  noResults: string;
  openStore: string;
  routeAction: string;
  matchedProductLabel: string;
  storeCategoryLabel: string;
  confidenceLabel: string;
  validationLabel: string;
  whyMatchLabel: string;
  validationLikely: string;
  validationValidated: string;
  validationUnvalidated: string;
  validationRejected: string;
  unknownCategory: string;
  unknownConfidence: string;
  storeProductsTitle: string;
  priceUnknown: string;
  availabilityInStock: string;
  availabilityLowStock: string;
  availabilityUnknown: string;
  updatedLabel: string;
  centerLabel: string;
  languageLabel: string;
  geolocationError: string;
  geolocationReady: string;
  queryRequiredError: string;
  searchRequestError: string;
  mapYouAreHere: string;
  itemLabel: string;
  backToSearch: string;
  notFoundTitle: string;
  notFoundDescription: string;
  backHome: string;
};

const dictionaries: Record<Locale, Dictionary> = {
  de: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Lokale Produktsuche in Berlin.",
    searchPlaceholder: "Produkt exakt suchen (z. B. Hafermilch 1L)",
    radiusLabel: "Suchradius (km)",
    searchButton: "Produkte suchen",
    useMyLocation: "Meinen Standort nutzen",
    addressSectionTitle: "Deine Adresse",
    locationFallbackLabel: "Fallback ohne GPS",
    locationFallbackPlaceholder: "Adresse oder Postleitzahl in Berlin",
    resolveLocationButton: "Adresse auf Karte finden",
    resultsTitle: "Ergebnisse in deiner Naehe",
    mapTitle: "Karte",
    goToResults: "Zu Ergebnissen",
    goToMap: "Zur Karte",
    noResults: "Keine Treffer im Radius. Probiere einen groesseren Radius oder einen anderen Produktnamen.",
    openStore: "Details zur Filiale",
    routeAction: "Route starten",
    matchedProductLabel: "Produkt",
    storeCategoryLabel: "Kategorie",
    confidenceLabel: "Treffer-Sicherheit",
    validationLabel: "Datenstatus",
    whyMatchLabel: "Warum dieser Treffer",
    validationLikely: "Wahrscheinlich",
    validationValidated: "Validiert",
    validationUnvalidated: "Ungeprueft",
    validationRejected: "Verworfen",
    unknownCategory: "Nicht klassifiziert",
    unknownConfidence: "Keine Angabe",
    storeProductsTitle: "Produkte in dieser Filiale",
    priceUnknown: "Preis nicht verfuegbar",
    availabilityInStock: "Auf Lager",
    availabilityLowStock: "Wenig Bestand",
    availabilityUnknown: "Verfuegbarkeit unbekannt",
    updatedLabel: "Aktualisiert",
    centerLabel: "Zentrum",
    languageLabel: "Sprache",
    geolocationError: "Standort konnte nicht ermittelt werden. Bitte Fallback verwenden.",
    geolocationReady: "Standort aktiv",
    queryRequiredError: "Bitte gib einen Produktnamen ein.",
    searchRequestError: "Die Suche ist fehlgeschlagen.",
    mapYouAreHere: "Dein Standort",
    itemLabel: "Artikel",
    backToSearch: "Zurueck zur Suche",
    notFoundTitle: "Nicht gefunden",
    notFoundDescription: "Die Seite oder Filiale ist nicht verfuegbar.",
    backHome: "Zur Startseite"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Local product search in Berlin.",
    searchPlaceholder: "Search exact product (e.g. oat milk 1L)",
    radiusLabel: "Search radius (km)",
    searchButton: "Search products",
    useMyLocation: "Use my location",
    addressSectionTitle: "Your address",
    locationFallbackLabel: "Fallback without GPS",
    locationFallbackPlaceholder: "Address or postal code in Berlin",
    resolveLocationButton: "Find address on map",
    resultsTitle: "Results near you",
    mapTitle: "Map",
    goToResults: "Jump to results",
    goToMap: "Jump to map",
    noResults: "No matches in this radius. Try a wider radius or another product name.",
    openStore: "Store details",
    routeAction: "Get directions",
    matchedProductLabel: "Product",
    storeCategoryLabel: "Category",
    confidenceLabel: "Confidence",
    validationLabel: "Data status",
    whyMatchLabel: "Why this match",
    validationLikely: "Likely",
    validationValidated: "Validated",
    validationUnvalidated: "Unvalidated",
    validationRejected: "Rejected",
    unknownCategory: "Unclassified",
    unknownConfidence: "N/A",
    storeProductsTitle: "Products in this store",
    priceUnknown: "Price unavailable",
    availabilityInStock: "In stock",
    availabilityLowStock: "Low stock",
    availabilityUnknown: "Availability unknown",
    updatedLabel: "Updated",
    centerLabel: "Center",
    languageLabel: "Language",
    geolocationError: "We could not detect your location. Please use fallback.",
    geolocationReady: "Location ready",
    queryRequiredError: "Please provide a product query.",
    searchRequestError: "Search request failed.",
    mapYouAreHere: "You are here",
    itemLabel: "Item",
    backToSearch: "Back to search",
    notFoundTitle: "Not found",
    notFoundDescription: "The page or store is not available.",
    backHome: "Back home"
  },
  es: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Buscador local de productos en Berlin.",
    searchPlaceholder: "Busca un producto exacto (por ej. leche de avena 1L)",
    radiusLabel: "Radio de busqueda (km)",
    searchButton: "Buscar productos",
    useMyLocation: "Usar mi ubicacion",
    addressSectionTitle: "Tu direccion",
    locationFallbackLabel: "Modo manual sin GPS",
    locationFallbackPlaceholder: "Direccion o codigo postal en Berlin",
    resolveLocationButton: "Buscar direccion en el mapa",
    resultsTitle: "Resultados cerca de ti",
    mapTitle: "Mapa",
    goToResults: "Ir a resultados",
    goToMap: "Ir al mapa",
    noResults: "No hay resultados en este radio. Prueba con un radio mayor u otro producto.",
    openStore: "Ver tienda",
    routeAction: "Como llegar",
    matchedProductLabel: "Producto",
    storeCategoryLabel: "Categoria",
    confidenceLabel: "Confianza",
    validationLabel: "Estado del dato",
    whyMatchLabel: "Por que coincide",
    validationLikely: "Probable",
    validationValidated: "Validado",
    validationUnvalidated: "Sin validar",
    validationRejected: "Descartado",
    unknownCategory: "Sin categoria",
    unknownConfidence: "Sin dato",
    storeProductsTitle: "Productos en esta tienda",
    priceUnknown: "Precio no disponible",
    availabilityInStock: "En stock",
    availabilityLowStock: "Queda poco",
    availabilityUnknown: "Disponibilidad desconocida",
    updatedLabel: "Actualizado",
    centerLabel: "Centro",
    languageLabel: "Idioma",
    geolocationError: "No se pudo obtener tu ubicacion. Usa el modo manual.",
    geolocationReady: "Ubicacion lista",
    queryRequiredError: "Escribe un producto para buscar.",
    searchRequestError: "La busqueda ha fallado.",
    mapYouAreHere: "Tu ubicacion",
    itemLabel: "Articulo",
    backToSearch: "Volver a la busqueda",
    notFoundTitle: "No encontrado",
    notFoundDescription: "La pagina o la tienda no esta disponible.",
    backHome: "Volver al inicio"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
