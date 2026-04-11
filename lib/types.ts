export type Locale = "de" | "en" | "es";

export type Store = {
  id: string;
  name: string;
  address: string;
  district: string;
  openingHours: string;
  lat: number;
  lng: number;
  appCategories?: string[];
  osmCategory?: string | null;
};

export type Product = {
  id: string;
  normalizedName: string;
  brand: string | null;
  category: string;
};

export type Offer = {
  id: string;
  storeId: string;
  productId: string;
  priceOptional: number | null;
  availability: "in_stock" | "low_stock" | "unknown";
  updatedAt: string;
};

export type SearchResult = {
  store: Store;
  product: Product;
  offer: Offer;
  distanceMeters: number;
  freshnessHours: number;
  rank: number;
  confidence?: number | null;
  validationStatus?: "unvalidated" | "likely" | "validated" | "rejected" | null;
  whyThisProductMatches?: string | null;
  sourceType?: "imported" | "rules_generated" | "ai_generated" | "merchant_added" | "user_validated" | null;
};

export type StoreDetail = {
  store: Store;
  offers: Array<{
    offer: Offer;
    product: Product;
  }>;
};
