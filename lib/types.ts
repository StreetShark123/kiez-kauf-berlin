export type Locale = "de" | "en" | "es";

export type Store = {
  id: string;
  name: string;
  address: string;
  district: string;
  openingHours: string;
  lat: number;
  lng: number;
  website?: string | null;
  phone?: string | null;
  ownershipType?: "independent" | "chain" | "unknown";
  appCategories?: string[];
  osmCategory?: string | null;
  storeRoles?: string[];
  storeRolePrimary?: string | null;
  storeRoleConfidence?: number | null;
};

export type Product = {
  id: string;
  normalizedName: string;
  displayName?: string | null;
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
  lastCheckedAt?: string | null;
  sourceType?:
    | "imported"
    | "rules_generated"
    | "ai_generated"
    | "ai_inferred"
    | "merchant_added"
    | "user_validated"
    | "website_extracted"
    | "validated"
    | null;
  resultKind?: "product" | "service";
  availabilityStatus?: "confirmed" | "likely" | "unknown" | "rejected" | null;
};

export type StoreDetail = {
  store: Store;
  offers: Array<{
    offer: Offer;
    product: Product;
  }>;
};
