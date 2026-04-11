import type { Offer, Product, Store } from "@/lib/types";

export const mockStores: Store[] = [
  {
    id: "st_1",
    name: "Kiez Markt Kreuzberg",
    address: "OranienstraBe 164, 10969 Berlin",
    district: "Kreuzberg",
    openingHours: "Mo-Sa 08:00-22:00",
    lat: 52.5006,
    lng: 13.4034
  },
  {
    id: "st_2",
    name: "Bio Eck Prenzlauer Berg",
    address: "Schonhauser Allee 142, 10437 Berlin",
    district: "Prenzlauer Berg",
    openingHours: "Mo-Sa 09:00-21:00",
    lat: 52.5406,
    lng: 13.4123
  },
  {
    id: "st_3",
    name: "Friedrichshain Kiosk Plus",
    address: "Warschauer StraBe 37, 10243 Berlin",
    district: "Friedrichshain",
    openingHours: "Mo-So 10:00-23:00",
    lat: 52.5051,
    lng: 13.4476
  }
];

export const mockProducts: Product[] = [
  {
    id: "pr_1",
    normalizedName: "hafermilch 1l",
    brand: "Oatly",
    category: "getranke"
  },
  {
    id: "pr_2",
    normalizedName: "pasta fusilli 500g",
    brand: "Barilla",
    category: "lebensmittel"
  },
  {
    id: "pr_3",
    normalizedName: "zahnpasta sensitive",
    brand: "Elmex",
    category: "drogerie"
  }
];

export const mockOffers: Offer[] = [
  {
    id: "of_1",
    storeId: "st_1",
    productId: "pr_1",
    priceOptional: 2.49,
    availability: "in_stock",
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "of_2",
    storeId: "st_2",
    productId: "pr_1",
    priceOptional: 2.29,
    availability: "low_stock",
    updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "of_3",
    storeId: "st_3",
    productId: "pr_2",
    priceOptional: 1.99,
    availability: "in_stock",
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "of_4",
    storeId: "st_1",
    productId: "pr_3",
    priceOptional: null,
    availability: "in_stock",
    updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
  }
];
