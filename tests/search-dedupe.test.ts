import { describe, expect, it } from "vitest";
import { __private } from "@/lib/data";
import type { SearchResult } from "@/lib/types";

function makeResult(input: {
  storeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  product: string;
  rank: number;
}): SearchResult {
  return {
    store: {
      id: input.storeId,
      name: input.name,
      address: input.address,
      district: "Berlin",
      openingHours: "",
      lat: input.lat,
      lng: input.lng
    },
    product: {
      id: `p-${input.product}`,
      normalizedName: input.product,
      brand: null,
      category: "test"
    },
    offer: {
      id: `offer-${input.storeId}-${input.product}`,
      storeId: input.storeId,
      productId: `p-${input.product}`,
      priceOptional: null,
      availability: "unknown",
      updatedAt: new Date().toISOString()
    },
    distanceMeters: 120,
    freshnessHours: 3,
    rank: input.rank
  };
}

describe("dedupeRankedResults", () => {
  it("keeps only the best row per store id", () => {
    const ranked = [
      makeResult({
        storeId: "1",
        name: "Bio Markt",
        address: "Turmstrasse 1, Berlin",
        lat: 52.52,
        lng: 13.39,
        product: "milk",
        rank: 1200
      }),
      makeResult({
        storeId: "1",
        name: "Bio Markt",
        address: "Turmstrasse 1, Berlin",
        lat: 52.52,
        lng: 13.39,
        product: "oat milk",
        rank: 1100
      }),
      makeResult({
        storeId: "2",
        name: "Kiosk Nord",
        address: "Lehrter Strasse 2, Berlin",
        lat: 52.53,
        lng: 13.37,
        product: "milk",
        rank: 900
      })
    ];

    const deduped = __private.dedupeRankedResults(ranked);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].store.id).toBe("1");
    expect(deduped[0].product.normalizedName).toBe("milk");
    expect(deduped[1].store.id).toBe("2");
  });

  it("collapses near-identical stores with different ids", () => {
    const ranked = [
      makeResult({
        storeId: "a",
        name: "REWE",
        address: "Invalidenstrasse 10, Berlin",
        lat: 52.53004,
        lng: 13.38112,
        product: "beer",
        rank: 1000
      }),
      makeResult({
        storeId: "b",
        name: "REWE",
        address: "Invalidenstrasse 10, Berlin",
        lat: 52.53003,
        lng: 13.3811,
        product: "beer",
        rank: 990
      })
    ];

    const deduped = __private.dedupeRankedResults(ranked);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].store.id).toBe("a");
  });
});
