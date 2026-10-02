import { describe, expect, it } from "vitest";
import { estimatePresence, type PresenceEvidence } from "@/lib/presence/evidence";
import { MAX_SIGNALS_PER_DEVICE_PER_DAY, MemoryEvidenceRepository } from "@/lib/presence/evidence-store";
import { searchPresence } from "@/lib/presence/search";
import type { PresenceStoreRecord } from "@/lib/presence/stores";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const vote = (signal: 1 | -1, days = 0, extra: Partial<PresenceEvidence> = {}): PresenceEvidence => ({
  storeId: "s1",
  productTypeId: "garlic",
  signal,
  source: "user",
  createdAt: daysAgo(days),
  ...extra
});

describe("estimatePresence", () => {
  it("returns the prior when there is no evidence", () => {
    const estimate = estimatePresence(0.9, [], NOW);
    expect(estimate.probability).toBeCloseTo(0.9, 5);
    expect(estimate.tier).toBe("likely");
  });

  it("one fresh sighting turns a weak prior into a confirmed answer", () => {
    const estimate = estimatePresence(0.25, [vote(1)], NOW);
    expect(estimate.probability).toBeCloseTo(0.5, 5);
    expect(estimate.tier).toBe("confirmed");
  });

  it("two fresh 'not there' reports pull a strong prior below 'likely'", () => {
    const estimate = estimatePresence(0.9, [vote(-1), vote(-1)], NOW);
    expect(estimate.probability).toBeCloseTo(0.45, 5);
    expect(estimate.tier).toBe("possible");
  });

  it("repeated negative reports hide the shop", () => {
    const estimate = estimatePresence(0.5, [vote(-1), vote(-1), vote(-1)], NOW);
    expect(estimate.tier).toBe("reported_missing");
  });

  it("old evidence fades (user half-life 120 days) and stops counting as confirmation", () => {
    const fresh = estimatePresence(0.25, [vote(1, 0)], NOW);
    const old = estimatePresence(0.25, [vote(1, 240)], NOW);
    expect(old.probability).toBeLessThan(fresh.probability);
    expect(old.tier).not.toBe("confirmed");
  });

  it("ignores flagged evidence and weighs merchants more than single users", () => {
    expect(estimatePresence(0.2, [vote(1, 0, { flagged: true })], NOW).probability).toBeCloseTo(0.2, 5);
    const merchant = estimatePresence(0.2, [vote(-1), vote(1, 0, { source: "merchant" })], NOW);
    expect(merchant.probability).toBeGreaterThan(0.6);
  });
});

describe("MemoryEvidenceRepository", () => {
  it("keeps one current vote per device, store and type", async () => {
    const repository = new MemoryEvidenceRepository();
    const base = { storeId: "s1", productTypeId: "milk", source: "user" as const, deviceHash: "device-a".padEnd(16, "x") };
    await repository.add({ ...base, signal: 1 });
    await repository.add({ ...base, signal: -1 });
    const rows = await repository.listForStore("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe(-1);
  });

  it("rate-limits a device per day", async () => {
    const repository = new MemoryEvidenceRepository();
    for (let index = 0; index < MAX_SIGNALS_PER_DEVICE_PER_DAY; index += 1) {
      expect((await repository.add({ storeId: `s${index}`, productTypeId: "milk", signal: 1, source: "user", deviceHash: "device-b".padEnd(16, "x") })).ok).toBe(true);
    }
    const blocked = await repository.add({ storeId: "s-extra", productTypeId: "milk", signal: 1, source: "user", deviceHash: "device-b".padEnd(16, "x") });
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("searchPresence with evidence", () => {
  const store = (id: string, osmCategory: string, lat: number, name = id): PresenceStoreRecord => ({
    id,
    name,
    osmCategory,
    lat,
    lng: 13.342,
    address: "",
    district: "Moabit",
    openingHours: null,
    website: null,
    phone: null,
    appCategories: []
  });
  const stores = [store("spaeti", "convenience", 52.5317), store("edeka", "supermarket", 52.535, "Edeka")];
  const args = { query: "garlic", lat: 52.5316, lng: 13.342, radiusMeters: 2000, stores, now: NOW };

  it("by default only the supermarket is an answer (garlic at a Späti is a 0.25 guess)", () => {
    const output = searchPresence({ ...args, evidence: [] });
    expect(output.results.map((result) => result.store.id)).toEqual(["edeka"]);
    expect(output.results[0].validationStatus).toBe("likely");
  });

  it("a neighbour's confirmation moves the nearby Späti to the top as confirmed", () => {
    const output = searchPresence({ ...args, evidence: [{ ...vote(1), storeId: "spaeti" }] });
    expect(output.results[0].store.id).toBe("spaeti");
    expect(output.results[0].validationStatus).toBe("validated");
  });

  it("never returns other products of the same group for an unknown query", () => {
    const output = searchPresence({ ...args, query: "cassette", evidence: [] });
    expect(output.results).toEqual([]);
  });
});
