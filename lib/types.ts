export type Locale = "de" | "en";

export type Store = {
  id: string;
  name: string;
  address: string;
  district: string;
  openingHours: string;
  lat: number;
  lng: number;
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
};

export type StoreDetail = {
  store: Store;
  offers: Array<{
    offer: Offer;
    product: Product;
  }>;
};
