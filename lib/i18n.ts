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
  distanceLabel: string;
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
  geolocationRemembered: string;
  queryRequiredError: string;
  searchRequestError: string;
  searchingLabel: string;
  resultsCountLabel: string;
  mapEmptyState: string;
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
    appSubtitle: "Finde Produkte in Laeden um dich herum.",
    searchPlaceholder: "Was suchst du? (z. B. Hafermilch 1L)",
    radiusLabel: "Im Umkreis",
    searchButton: "Suchen",
    useMyLocation: "Meinen Standort",
    addressSectionTitle: "Adresse",
    locationFallbackLabel: "Ohne GPS",
    locationFallbackPlaceholder: "Adresse oder PLZ in Berlin",
    resolveLocationButton: "Adresse finden",
    resultsTitle: "Laeden in der Naehe",
    mapTitle: "Karte",
    goToResults: "Zu Treffern",
    goToMap: "Zur Karte",
    noResults: "Hier nichts gefunden. Versuch einen anderen Begriff oder mehr Radius.",
    openStore: "Filiale ansehen",
    routeAction: "Route",
    matchedProductLabel: "Treffer",
    storeCategoryLabel: "Typ",
    confidenceLabel: "Treffer-Sicherheit",
    validationLabel: "Status",
    whyMatchLabel: "Warum dieser Treffer",
    validationLikely: "Wahrscheinlich",
    validationValidated: "Bestaetigt",
    validationUnvalidated: "Offen",
    validationRejected: "Verworfen",
    unknownCategory: "Ohne Typ",
    unknownConfidence: "Keine Angabe",
    distanceLabel: "Distanz",
    storeProductsTitle: "Produkte in dieser Filiale",
    priceUnknown: "Preis nicht verfuegbar",
    availabilityInStock: "Auf Lager",
    availabilityLowStock: "Wenig Bestand",
    availabilityUnknown: "Verfuegbarkeit unbekannt",
    updatedLabel: "Aktualisiert",
    centerLabel: "Mitte",
    languageLabel: "Sprache",
    geolocationError: "Standort nicht gefunden. Suche geht trotzdem.",
    geolocationReady: "Standort aktiv",
    geolocationRemembered: "Letzter Standort aktiv",
    queryRequiredError: "Bitte gib einen Produktnamen ein.",
    searchRequestError: "Die Suche ist fehlgeschlagen.",
    searchingLabel: "Suche...",
    resultsCountLabel: "Treffer",
    mapEmptyState: "Such etwas, dann zeigen wir Pins auf der Karte.",
    mapYouAreHere: "Du bist hier",
    itemLabel: "Artikel",
    backToSearch: "Zurueck",
    notFoundTitle: "Nicht gefunden",
    notFoundDescription: "Die Seite oder Filiale ist gerade nicht verfuegbar.",
    backHome: "Zur Startseite"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Find products in nearby stores.",
    searchPlaceholder: "What are you looking for? (e.g. oat milk 1L)",
    radiusLabel: "Within",
    searchButton: "Search",
    useMyLocation: "Use my location",
    addressSectionTitle: "Address",
    locationFallbackLabel: "Without GPS",
    locationFallbackPlaceholder: "Address or postal code in Berlin",
    resolveLocationButton: "Find address",
    resultsTitle: "Nearby stores",
    mapTitle: "Map",
    goToResults: "Jump to stores",
    goToMap: "Jump to map",
    noResults: "No luck nearby. Try another term or increase the radius.",
    openStore: "Store details",
    routeAction: "Route",
    matchedProductLabel: "Match",
    storeCategoryLabel: "Type",
    confidenceLabel: "Confidence",
    validationLabel: "Status",
    whyMatchLabel: "Why it matched",
    validationLikely: "Likely",
    validationValidated: "Validated",
    validationUnvalidated: "Unvalidated",
    validationRejected: "Rejected",
    unknownCategory: "Unclassified",
    unknownConfidence: "N/A",
    distanceLabel: "Distance",
    storeProductsTitle: "Products in this store",
    priceUnknown: "Price unavailable",
    availabilityInStock: "In stock",
    availabilityLowStock: "Low stock",
    availabilityUnknown: "Availability unknown",
    updatedLabel: "Updated",
    centerLabel: "Center",
    languageLabel: "Language",
    geolocationError: "Could not get your location. You can still search.",
    geolocationReady: "Location on",
    geolocationRemembered: "Using your last location",
    queryRequiredError: "Type something to search.",
    searchRequestError: "Oops, search failed.",
    searchingLabel: "Searching...",
    resultsCountLabel: "results",
    mapEmptyState: "Search something and we will place stores on the map.",
    mapYouAreHere: "You are here",
    itemLabel: "Item",
    backToSearch: "Back",
    notFoundTitle: "Not found",
    notFoundDescription: "This page or store is not available right now.",
    backHome: "Back home"
  },
  es: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Encuentra productos en tiendas cercanas.",
    searchPlaceholder: "Que buscas hoy? (ej. leche de avena 1L)",
    radiusLabel: "Hasta",
    searchButton: "Buscar",
    useMyLocation: "Usar mi ubicacion",
    addressSectionTitle: "Direccion",
    locationFallbackLabel: "Sin GPS",
    locationFallbackPlaceholder: "Direccion o codigo postal en Berlin",
    resolveLocationButton: "Buscar direccion",
    resultsTitle: "Tiendas cerca",
    mapTitle: "Mapa",
    goToResults: "Ir a tiendas",
    goToMap: "Ir al mapa",
    noResults: "No salio nada por aqui. Prueba otro termino o sube el radio.",
    openStore: "Ver tienda",
    routeAction: "Ruta",
    matchedProductLabel: "Coincidencia",
    storeCategoryLabel: "Tipo",
    confidenceLabel: "Confianza",
    validationLabel: "Estado del dato",
    whyMatchLabel: "Por que sale",
    validationLikely: "Probable",
    validationValidated: "Validado",
    validationUnvalidated: "Sin revisar",
    validationRejected: "Descartado",
    unknownCategory: "Sin tipo",
    unknownConfidence: "Sin dato",
    distanceLabel: "Distancia",
    storeProductsTitle: "Productos en esta tienda",
    priceUnknown: "Precio no disponible",
    availabilityInStock: "En stock",
    availabilityLowStock: "Queda poco",
    availabilityUnknown: "Disponibilidad desconocida",
    updatedLabel: "Actualizado",
    centerLabel: "Centro",
    languageLabel: "Idioma",
    geolocationError: "No pude ubicarte. Puedes buscar igual.",
    geolocationReady: "Ubicacion activa",
    geolocationRemembered: "Usando tu ultima ubicacion",
    queryRequiredError: "Escribe algo para buscar.",
    searchRequestError: "Ups, la busqueda fallo.",
    searchingLabel: "Buscando...",
    resultsCountLabel: "resultados",
    mapEmptyState: "Busca algo y te muestro tiendas en el mapa.",
    mapYouAreHere: "Estas aqui",
    itemLabel: "Articulo",
    backToSearch: "Volver",
    notFoundTitle: "No encontrado",
    notFoundDescription: "Esta pagina o tienda no esta disponible ahora mismo.",
    backHome: "Volver al inicio"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
