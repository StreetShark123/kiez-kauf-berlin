import type { Locale } from "@/lib/types";

export type Dictionary = {
  appTitle: string;
  appSubtitle: string;
  searchPlaceholder: string;
  searchHint: string;
  radiusLabel: string;
  searchButton: string;
  quickIntentLabel: string;
  quickIntentPharmacy: string;
  quickIntentHardware: string;
  quickIntentSpati: string;
  quickIntentEssentials: string;
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
  noResultsNearbyTemplate: string;
  noResultsCatalogHint: string;
  noResultsRefineHint: string;
  noResultsSuggestionLabel: string;
  expandSearchButtonTemplate: string;
  compactResultsSummaryTemplate: string;
  viewMoreResultsLabel: string;
  viewLessResultsLabel: string;
  openStore: string;
  routeAction: string;
  matchedProductLabel: string;
  openingHoursLabel: string;
  openingStatusLabel: string;
  openNowLabel: string;
  closedNowLabel: string;
  hoursUnknownLabel: string;
  storeCategoryLabel: string;
  confidenceLabel: string;
  sourceLabel: string;
  validationLabel: string;
  whyMatchLabel: string;
  validationLikely: string;
  validationValidated: string;
  validationUnvalidated: string;
  validationRejected: string;
  unknownCategory: string;
  unknownConfidence: string;
  distanceLabel: string;
  walkTimeLabel: string;
  bikeTimeLabel: string;
  etaApproxLabel: string;
  storeProductsTitle: string;
  priceUnknown: string;
  availabilityInStock: string;
  availabilityLowStock: string;
  availabilityUnknown: string;
  updatedLabel: string;
  checkedLabel: string;
  checkedToday: string;
  checkedYesterday: string;
  checkedDaysAgoTemplate: string;
  checkedUnknown: string;
  centerLabel: string;
  languageLabel: string;
  themeLabel: string;
  darkModeLabel: string;
  lightModeLabel: string;
  geolocationError: string;
  geolocationDenied: string;
  geolocationReady: string;
  geolocationRemembered: string;
  manualPinHint: string;
  queryRequiredError: string;
  searchRequestError: string;
  searchingLabel: string;
  resultsCountLabel: string;
  mapEmptyState: string;
  mapYouAreHere: string;
  berlinOnlyHint: string;
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
  routeOnMapAction: string;
  clearRouteAction: string;
  routeLoadingLabel: string;
  routeError: string;
  activeRouteLabel: string;
  cachedResultLabel: string;
};

const dictionaries: Record<Locale, Dictionary> = {
  de: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Produkte schnell im Kiez finden.",
    searchPlaceholder: "Produkt suchen (z. B. Hafermilch 1L)",
    searchHint: "Kurz und konkret suchen. Wir finden passende Laeden in der Naehe.",
    radiusLabel: "Radius",
    searchButton: "Suchen",
    quickIntentLabel: "Schnellzugriff",
    quickIntentPharmacy: "Apotheke",
    quickIntentHardware: "Baumarkt",
    quickIntentSpati: "Spaeti Basics",
    quickIntentEssentials: "Essentials",
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
    noResultsNearbyTemplate: "Nichts im aktuellen Radius. Nächster Treffer liegt bei etwa {distance}.",
    noResultsCatalogHint:
      "Scheint noch nicht in unserer Produktliste zu sein. Wir erweitern sie laufend, Stück für Stück.",
    noResultsRefineHint: "Kein Treffer? Probier eine einfache Alternative:",
    noResultsSuggestionLabel: "Zum Testen:",
    expandSearchButtonTemplate: "Auf {radius} km erweitern",
    compactResultsSummaryTemplate: "{shown} von {total} Treffern (offen + nah zuerst).",
    viewMoreResultsLabel: "Mehr sehen",
    viewLessResultsLabel: "Weniger sehen",
    openStore: "Filiale ansehen",
    routeAction: "Route",
    matchedProductLabel: "Produkt",
    openingHoursLabel: "Oeffnungszeiten",
    openingStatusLabel: "Status",
    openNowLabel: "Jetzt offen",
    closedNowLabel: "Jetzt zu",
    hoursUnknownLabel: "Unbekannt",
    storeCategoryLabel: "Kategorie",
    confidenceLabel: "Treffer-Sicherheit",
    sourceLabel: "Quelle",
    validationLabel: "Datenstatus",
    whyMatchLabel: "Warum dieser Treffer",
    validationLikely: "Wahrscheinlich",
    validationValidated: "Bestaetigt",
    validationUnvalidated: "Offen",
    validationRejected: "Verworfen",
    unknownCategory: "Ohne Typ",
    unknownConfidence: "Keine Angabe",
    distanceLabel: "Distanz",
    walkTimeLabel: "Zu Fuss",
    bikeTimeLabel: "Fahrrad",
    etaApproxLabel: "ca.",
    storeProductsTitle: "Produkte in dieser Filiale",
    priceUnknown: "Preis nicht verfuegbar",
    availabilityInStock: "Auf Lager",
    availabilityLowStock: "Wenig Bestand",
    availabilityUnknown: "Verfuegbarkeit unbekannt",
    updatedLabel: "Aktualisiert",
    checkedLabel: "Geprueft",
    checkedToday: "heute",
    checkedYesterday: "gestern",
    checkedDaysAgoTemplate: "vor {days} Tagen",
    checkedUnknown: "ohne Datum",
    centerLabel: "Mitte",
    languageLabel: "Sprache",
    themeLabel: "Ansicht",
    darkModeLabel: "Dunkel",
    lightModeLabel: "Hell",
    geolocationError: "Standort nicht gefunden. Du kannst trotzdem suchen.",
    geolocationDenied: "Standortzugriff ist aus. Du kannst den Pin manuell setzen.",
    geolocationReady: "Standort aktiv",
    geolocationRemembered: "Letzter Standort aktiv",
    manualPinHint: "GPS aus? Zieh den Pin an die richtige Stelle.",
    queryRequiredError: "Bitte gib einen Produktnamen ein.",
    searchRequestError: "Suche fehlgeschlagen. Bitte nochmal versuchen.",
    searchingLabel: "Suche...",
    resultsCountLabel: "Treffer",
    mapEmptyState: "Suche starten, dann erscheinen Pins auf der Karte.",
    mapYouAreHere: "Du bist hier",
    berlinOnlyHint: "Sorry, aktuell sind wir nur in Berlin unterwegs.",
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
    backHome: "Zur Startseite",
    routeOnMapAction: "Route auf Karte",
    clearRouteAction: "Route entfernen",
    routeLoadingLabel: "Route wird geladen...",
    routeError: "Route konnte gerade nicht geladen werden.",
    activeRouteLabel: "Aktive Route",
    cachedResultLabel: "Cache"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Find products in nearby local shops.",
    searchPlaceholder: "Search a product (e.g. oat milk 1L)",
    searchHint: "Keep it short and direct. We will map nearby shops fast.",
    radiusLabel: "Radius",
    searchButton: "Search",
    quickIntentLabel: "Quick intents",
    quickIntentPharmacy: "pharmacy",
    quickIntentHardware: "hardware",
    quickIntentSpati: "spaeti essentials",
    quickIntentEssentials: "essentials",
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
    noResultsNearbyTemplate: "Nothing in this radius. Closest match is around {distance}.",
    noResultsCatalogHint:
      "This one might not be in our product list yet. We are still adding items bit by bit.",
    noResultsRefineHint: "No match yet? Try a simpler term:",
    noResultsSuggestionLabel: "Try:",
    expandSearchButtonTemplate: "Expand to {radius} km",
    compactResultsSummaryTemplate: "Showing {shown} of {total} stores (open + nearest first).",
    viewMoreResultsLabel: "View more",
    viewLessResultsLabel: "View less",
    openStore: "Store details",
    routeAction: "Route",
    matchedProductLabel: "Product",
    openingHoursLabel: "Opening hours",
    openingStatusLabel: "Status",
    openNowLabel: "Open now",
    closedNowLabel: "Closed now",
    hoursUnknownLabel: "Unknown",
    storeCategoryLabel: "Category",
    confidenceLabel: "Confidence",
    sourceLabel: "Source",
    validationLabel: "Data status",
    whyMatchLabel: "Why it matched",
    validationLikely: "Likely",
    validationValidated: "Validated",
    validationUnvalidated: "Unvalidated",
    validationRejected: "Rejected",
    unknownCategory: "Unclassified",
    unknownConfidence: "N/A",
    distanceLabel: "Distance",
    walkTimeLabel: "Walk",
    bikeTimeLabel: "Bike",
    etaApproxLabel: "~",
    storeProductsTitle: "Products in this store",
    priceUnknown: "Price unavailable",
    availabilityInStock: "In stock",
    availabilityLowStock: "Low stock",
    availabilityUnknown: "Availability unknown",
    updatedLabel: "Updated",
    checkedLabel: "Checked",
    checkedToday: "today",
    checkedYesterday: "yesterday",
    checkedDaysAgoTemplate: "{days}d ago",
    checkedUnknown: "no date",
    centerLabel: "Center",
    languageLabel: "Language",
    themeLabel: "Theme",
    darkModeLabel: "Dark",
    lightModeLabel: "Light",
    geolocationError: "Could not get your location. You can still search.",
    geolocationDenied: "Location access is off. You can set the pin manually.",
    geolocationReady: "Location on",
    geolocationRemembered: "Using your last location",
    manualPinHint: "No GPS? Drag the pin to your spot.",
    queryRequiredError: "Type something to search.",
    searchRequestError: "Search failed. Please try again.",
    searchingLabel: "Searching...",
    resultsCountLabel: "results",
    mapEmptyState: "Start a search and stores will appear on the map.",
    mapYouAreHere: "You are here",
    berlinOnlyHint: "Sorry, we are only available in Berlin for now.",
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
    backHome: "Back home",
    routeOnMapAction: "Route on map",
    clearRouteAction: "Clear route",
    routeLoadingLabel: "Loading route...",
    routeError: "Could not load route right now.",
    activeRouteLabel: "Active route",
    cachedResultLabel: "Cached result"
  },
  es: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Encuentra productos en tiendas cercanas.",
    searchPlaceholder: "Busca un producto (ej. leche de avena 1L)",
    searchHint: "Busca en corto y directo. Te mostramos tiendas cercanas rapido.",
    radiusLabel: "Radio",
    searchButton: "Buscar",
    quickIntentLabel: "Atajos",
    quickIntentPharmacy: "farmacia",
    quickIntentHardware: "ferreteria",
    quickIntentSpati: "basicos spaeti",
    quickIntentEssentials: "esenciales",
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
    noResultsNearbyTemplate: "Nada en este radio. La tienda mas cercana esta a {distance}.",
    noResultsCatalogHint:
      "Puede que este producto aun no este en nuestra lista. La seguimos ampliando poco a poco.",
    noResultsRefineHint: "Sin resultados? Prueba una forma mas simple:",
    noResultsSuggestionLabel: "Prueba:",
    expandSearchButtonTemplate: "Ampliar a {radius} km",
    compactResultsSummaryTemplate: "Mostrando {shown} de {total} tiendas (abiertas + cercanas primero).",
    viewMoreResultsLabel: "Ver mas",
    viewLessResultsLabel: "Ver menos",
    openStore: "Ver tienda",
    routeAction: "Ruta",
    matchedProductLabel: "Producto",
    openingHoursLabel: "Horario",
    openingStatusLabel: "Estado",
    openNowLabel: "Abierto ahora",
    closedNowLabel: "Cerrado ahora",
    hoursUnknownLabel: "Sin dato",
    storeCategoryLabel: "Categoria",
    confidenceLabel: "Confianza",
    sourceLabel: "Fuente",
    validationLabel: "Estado",
    whyMatchLabel: "Por que sale",
    validationLikely: "Probable",
    validationValidated: "Validado",
    validationUnvalidated: "Sin revisar",
    validationRejected: "Descartado",
    unknownCategory: "Sin tipo",
    unknownConfidence: "Sin dato",
    distanceLabel: "Distancia",
    walkTimeLabel: "Andando",
    bikeTimeLabel: "Bici",
    etaApproxLabel: "aprox.",
    storeProductsTitle: "Productos en esta tienda",
    priceUnknown: "Precio no disponible",
    availabilityInStock: "En stock",
    availabilityLowStock: "Queda poco",
    availabilityUnknown: "Disponibilidad desconocida",
    updatedLabel: "Actualizado",
    checkedLabel: "Revisado",
    checkedToday: "hoy",
    checkedYesterday: "ayer",
    checkedDaysAgoTemplate: "hace {days}d",
    checkedUnknown: "sin fecha",
    centerLabel: "Centro",
    languageLabel: "Idioma",
    themeLabel: "Tema",
    darkModeLabel: "Oscuro",
    lightModeLabel: "Claro",
    geolocationError: "No pude ubicarte. Igual puedes buscar.",
    geolocationDenied: "Sin acceso a ubicacion. Puedes mover el pin manualmente.",
    geolocationReady: "Ubicacion activa",
    geolocationRemembered: "Usando tu ultima ubicacion",
    manualPinHint: "Sin GPS? Arrastra el pin a tu zona.",
    queryRequiredError: "Escribe algo para buscar.",
    searchRequestError: "La busqueda fallo. Intenta de nuevo.",
    searchingLabel: "Buscando...",
    resultsCountLabel: "resultados",
    mapEmptyState: "Empieza una busqueda y veras tiendas en el mapa.",
    mapYouAreHere: "Estas aqui",
    berlinOnlyHint: "Sorry, por ahora solo estamos en Berlin.",
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
    backHome: "Volver al inicio",
    routeOnMapAction: "Ruta en mapa",
    clearRouteAction: "Quitar ruta",
    routeLoadingLabel: "Cargando ruta...",
    routeError: "No se pudo cargar la ruta ahora.",
    activeRouteLabel: "Ruta activa",
    cachedResultLabel: "Resultado en cache"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
