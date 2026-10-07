import { beforeAll, describe, expect, it } from "vitest";
import goldSuite from "@/data/eval/gold-queries.v1.json";
import { evaluateQuery, summarize, type GoldSuite, type QueryEvaluation } from "@/lib/presence/eval";
import { searchPresence } from "@/lib/presence/search";
import { loadLocalOsmStores, type PresenceStoreRecord } from "@/lib/presence/stores";

// Quality gate for the presence engine on the committed OSM snapshot (no database needed).
// Thresholds are deliberately below the current score so a regression fails CI, not noise.
const MIN_PRECISION_AT_3 = 0.93;
const MIN_TOP1_ACCURACY = 0.95;
const MAX_BAD_IN_TOP3_RATE = 0.02;

const suite = goldSuite as GoldSuite;
let stores: PresenceStoreRecord[] = [];
let evaluations: QueryEvaluation[] = [];

beforeAll(async () => {
  stores = await loadLocalOsmStores();
  const { lat, lng, radius_meters: radiusMeters } = suite.default_origin;
  evaluations = suite.queries.map((gold) => {
    const output = searchPresence({ query: gold.query, lat, lng, radiusMeters, stores, evidence: [] });
    return evaluateQuery(
      gold,
      output.candidates.map((candidate) => ({
        storeName: candidate.store.name,
        osmCategory: candidate.store.osmCategory,
        tags: candidate.store.tags
      })),
      output.resolution.types.map((match) => match.typeId)
    );
  });
  const failing = evaluations.filter((entry) => !entry.passed);
  if (failing.length > 0) {
    console.info(
      "[gold] not passing:\n" +
        failing
          .map(
            (entry) =>
              `  ${entry.query} -> [${entry.resolvedTypes?.join(",")}] ` +
              entry.top.map((top) => `${top.store} (${top.category}) ${top.verdict}`).join(" | ")
          )
          .join("\n")
    );
  }
  console.info("[gold] summary", summarize(evaluations));
});

describe("presence engine against the gold suite", () => {
  it("loads the local store snapshot", () => {
    expect(stores.length).toBeGreaterThan(1000);
  });

  it("resolves every gold query to the expected product types", () => {
    const wrong = evaluations
      .filter((entry) => entry.resolutionOk === false)
      .map((entry) => `${entry.query} -> ${entry.resolvedTypes?.join(",") || "(none)"}`);
    expect(wrong).toEqual([]);
  });

  it("meets precision / top-1 / no-bad-answers thresholds", () => {
    const summary = summarize(evaluations);
    expect(summary.precisionAt3).toBeGreaterThanOrEqual(MIN_PRECISION_AT_3);
    expect(summary.top1Accuracy).toBeGreaterThanOrEqual(MIN_TOP1_ACCURACY);
    expect(summary.badInTop3Rate).toBeLessThanOrEqual(MAX_BAD_IN_TOP3_RATE);
  });

  it("never answers the April failure cases with the wrong kind of shop", () => {
    const byQuery = new Map(evaluations.map((entry) => [entry.query, entry]));
    for (const query of ["garlic", "apricot", "laundry detergent", "refill detergent", "tampons"]) {
      expect(byQuery.get(query)?.badInTop3, query).toBe(false);
      expect(byQuery.get(query)?.top1Correct, query).toBe(true);
    }
    expect(byQuery.get("cassette")?.resultCount).toBe(0);
  });
});
