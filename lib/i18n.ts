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
  themeLabel: string;
  darkModeLabel: string;
  lightModeLabel: string;
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
  notFoundJoke: string;
  errorTitle: string;
  errorDescription: string;
  errorJoke: string;
  errorCanvasHint: string;
  clearNoteAction: string;
  retryAction: string;
  backHome: string;
};

const dictionaries: Record<Locale, Dictionary> = {
  de: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Produkte schnell im Kiez finden.",
    searchPlaceholder: "Produkt suchen (z. B. Hafermilch 1L)",
    radiusLabel: "Radius",
    searchButton: "Suchen",
    useMyLocation: "Standort",
    addressSectionTitle: "Adresse",
    locationFallbackLabel: "Ohne GPS",
    locationFallbackPlaceholder: "Adresse oder PLZ in Berlin",
    resolveLocationButton: "Adresse finden",
    resultsTitle: "Treffer",
    mapTitle: "Karte",
    goToResults: "Zu Treffern",
    goToMap: "Zur Karte",
    noResults: "Nichts gefunden. Versuch ein anderes Wort oder mehr Radius.",
    openStore: "Filiale ansehen",
    routeAction: "Route",
    matchedProductLabel: "Produkt",
    storeCategoryLabel: "Kategorie",
    confidenceLabel: "Treffer-Sicherheit",
    validationLabel: "Datenstatus",
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
    themeLabel: "Ansicht",
    darkModeLabel: "Dunkel",
    lightModeLabel: "Hell",
    geolocationError: "Standort nicht gefunden. Du kannst trotzdem suchen.",
    geolocationReady: "Standort aktiv",
    geolocationRemembered: "Letzter Standort aktiv",
    queryRequiredError: "Bitte gib einen Produktnamen ein.",
    searchRequestError: "Suche fehlgeschlagen. Bitte nochmal versuchen.",
    searchingLabel: "Suche...",
    resultsCountLabel: "Treffer",
    mapEmptyState: "Suche starten, dann erscheinen Pins auf der Karte.",
    mapYouAreHere: "Du bist hier",
    itemLabel: "Artikel",
    backToSearch: "Zurueck",
    notFoundTitle: "Nicht gefunden",
    notFoundDescription: "Die Seite oder Filiale ist gerade nicht verfuegbar.",
    notFoundJoke: "Spielt wohl gerade Verstecken.",
    errorTitle: "Ups, da hat was geklemmt.",
    errorDescription: "Die Seite hatte gerade einen kleinen Aussetzer.",
    errorJoke: "Keine Sorge, nur ein lockerer Pixel.",
    errorCanvasHint: "Immerhin: Du kannst dir hier schnell eine kleine Notiz malen.",
    clearNoteAction: "Notiz loeschen",
    retryAction: "Nochmal versuchen",
    backHome: "Zur Startseite"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Find products in nearby local shops.",
    searchPlaceholder: "Search a product (e.g. oat milk 1L)",
    radiusLabel: "Radius",
    searchButton: "Search",
    useMyLocation: "Use my location",
    addressSectionTitle: "Address",
    locationFallbackLabel: "Without GPS",
    locationFallbackPlaceholder: "Address or postal code in Berlin",
    resolveLocationButton: "Find address",
    resultsTitle: "Results",
    mapTitle: "Map",
    goToResults: "Jump to stores",
    goToMap: "Jump to map",
    noResults: "No matches nearby. Try another term or increase radius.",
    openStore: "Store details",
    routeAction: "Route",
    matchedProductLabel: "Product",
    storeCategoryLabel: "Category",
    confidenceLabel: "Confidence",
    validationLabel: "Data status",
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
    themeLabel: "Theme",
    darkModeLabel: "Dark",
    lightModeLabel: "Light",
    geolocationError: "Could not get your location. You can still search.",
    geolocationReady: "Location on",
    geolocationRemembered: "Using your last location",
    queryRequiredError: "Type something to search.",
    searchRequestError: "Search failed. Please try again.",
    searchingLabel: "Searching...",
    resultsCountLabel: "results",
    mapEmptyState: "Start a search and stores will appear on the map.",
    mapYouAreHere: "You are here",
    itemLabel: "Item",
    backToSearch: "Back",
    notFoundTitle: "Not found",
    notFoundDescription: "This page or store is not available right now.",
    notFoundJoke: "Looks like it is playing hide and seek.",
    errorTitle: "Oops, something jammed.",
    errorDescription: "This page hit a small hiccup.",
    errorJoke: "No panic, just one shy pixel.",
    errorCanvasHint: "At least you can sketch a quick note here while we recover.",
    clearNoteAction: "Clear note",
    retryAction: "Try again",
    backHome: "Back home"
  },
  es: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Encuentra productos en tiendas cercanas.",
    searchPlaceholder: "Busca un producto (ej. leche de avena 1L)",
    radiusLabel: "Radio",
    searchButton: "Buscar",
    useMyLocation: "Mi ubicacion",
    addressSectionTitle: "Direccion",
    locationFallbackLabel: "Sin GPS",
    locationFallbackPlaceholder: "Direccion o codigo postal en Berlin",
    resolveLocationButton: "Buscar direccion",
    resultsTitle: "Resultados",
    mapTitle: "Mapa",
    goToResults: "Ir a tiendas",
    goToMap: "Ir al mapa",
    noResults: "No hay resultados cerca. Prueba otro termino o mas radio.",
    openStore: "Ver tienda",
    routeAction: "Ruta",
    matchedProductLabel: "Producto",
    storeCategoryLabel: "Categoria",
    confidenceLabel: "Confianza",
    validationLabel: "Estado",
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
    themeLabel: "Tema",
    darkModeLabel: "Oscuro",
    lightModeLabel: "Claro",
    geolocationError: "No pude ubicarte. Igual puedes buscar.",
    geolocationReady: "Ubicacion activa",
    geolocationRemembered: "Usando tu ultima ubicacion",
    queryRequiredError: "Escribe algo para buscar.",
    searchRequestError: "La busqueda fallo. Intenta de nuevo.",
    searchingLabel: "Buscando...",
    resultsCountLabel: "resultados",
    mapEmptyState: "Empieza una busqueda y veras tiendas en el mapa.",
    mapYouAreHere: "Estas aqui",
    itemLabel: "Articulo",
    backToSearch: "Volver",
    notFoundTitle: "No encontrado",
    notFoundDescription: "Esta pagina o tienda no esta disponible ahora mismo.",
    notFoundJoke: "Parece que esta jugando al escondite.",
    errorTitle: "Ups, algo se atasco.",
    errorDescription: "Esta pantalla tuvo un mini tropiezo.",
    errorJoke: "Bueno, siempre puedes tomar notas a la vieja usanza.",
    errorCanvasHint: "Dibuja una nota rapida en toda la pantalla mientras volvemos.",
    clearNoteAction: "Limpiar nota",
    retryAction: "Reintentar",
    backHome: "Volver al inicio"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
