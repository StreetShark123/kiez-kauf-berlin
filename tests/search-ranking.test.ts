import { describe, expect, it } from "vitest";
import { getStoreDetail, searchOffers } from "@/lib/data";

describe("searchOffers", () => {
  it("prioritizes exact product match and closer distance", async () => {
    const results = await searchOffers({
      query: "hafermilch 1l",
      lat: 52.5006,
      lng: 13.4034,
      radiusMeters: 5000
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].product.normalizedName).toBe("hafermilch 1l");
    expect(results[0].store.id).toBe("st_1");
  });

  it("returns no results for unknown product", async () => {
    const results = await searchOffers({
      query: "producto inexistente",
      lat: 52.52,
      lng: 13.405,
      radiusMeters: 5000
    });

    expect(results).toEqual([]);
  });
});

describe("getStoreDetail", () => {
  it("returns detail with offers for existing store", async () => {
    const store = await getStoreDetail("st_1");
    expect(store).not.toBeNull();
    expect(store?.offers.length).toBeGreaterThan(0);
  });

  it("returns null for missing store", async () => {
    const store = await getStoreDetail("missing-store");
    expect(store).toBeNull();
  });
});
