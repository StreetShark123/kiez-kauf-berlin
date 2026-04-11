import type { Locale } from "@/lib/types";

export type Dictionary = {
  appTitle: string;
  appSubtitle: string;
  searchPlaceholder: string;
  radiusLabel: string;
  searchButton: string;
  useMyLocation: string;
  locationFallbackLabel: string;
  locationFallbackPlaceholder: string;
  resolveLocationButton: string;
  resultsTitle: string;
  noResults: string;
  openStore: string;
  routeAction: string;
  priceUnknown: string;
  availabilityInStock: string;
  availabilityLowStock: string;
  availabilityUnknown: string;
  updatedLabel: string;
  languageLabel: string;
  geolocationError: string;
  geolocationReady: string;
};

const dictionaries: Record<Locale, Dictionary> = {
  de: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Finde Produkte in Geschaften in deiner Nahe.",
    searchPlaceholder: "Produkt exakt suchen (z. B. Hafermilch 1L)",
    radiusLabel: "Suchradius (km)",
    searchButton: "Produkte suchen",
    useMyLocation: "Meinen Standort nutzen",
    locationFallbackLabel: "Fallback ohne GPS",
    locationFallbackPlaceholder: "Adresse oder Postleitzahl in Berlin",
    resolveLocationButton: "Adresse auf Karte finden",
    resultsTitle: "Ergebnisse in deiner Nahe",
    noResults: "Keine Treffer im Radius. Probiere einen groBeren Radius oder einen anderen Produktnamen.",
    openStore: "Details zur Filiale",
    routeAction: "Route starten",
    priceUnknown: "Preis nicht verfugbar",
    availabilityInStock: "Auf Lager",
    availabilityLowStock: "Wenig Bestand",
    availabilityUnknown: "Verfugbarkeit unbekannt",
    updatedLabel: "Aktualisiert",
    languageLabel: "Sprache",
    geolocationError: "Standort konnte nicht ermittelt werden. Bitte Fallback verwenden.",
    geolocationReady: "Standort aktiv"
  },
  en: {
    appTitle: "KiezKauf Berlin",
    appSubtitle: "Find products in local shops near you.",
    searchPlaceholder: "Search exact product (e.g. oat milk 1L)",
    radiusLabel: "Search radius (km)",
    searchButton: "Search products",
    useMyLocation: "Use my location",
    locationFallbackLabel: "Fallback without GPS",
    locationFallbackPlaceholder: "Address or postal code in Berlin",
    resolveLocationButton: "Find address on map",
    resultsTitle: "Results near you",
    noResults: "No matches in this radius. Try a wider radius or another product name.",
    openStore: "Store details",
    routeAction: "Get directions",
    priceUnknown: "Price unavailable",
    availabilityInStock: "In stock",
    availabilityLowStock: "Low stock",
    availabilityUnknown: "Availability unknown",
    updatedLabel: "Updated",
    languageLabel: "Language",
    geolocationError: "We could not detect your location. Please use fallback.",
    geolocationReady: "Location ready"
  }
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
