import { describe, expect, it } from "vitest";
import rawPriors from "@/data/presence/category-priors.v1.json";
import { PRODUCT_GROUPS, PRODUCT_TYPES, PRODUCT_TYPES_BY_ID, resolveQuery } from "@/lib/presence/catalog";
import { stemmedTokens } from "@/lib/presence/normalize";

type ProbabilityMap = Record<string, number>;
const priors = rawPriors as {
  categories: Record<string, { inherit?: string; groups?: ProbabilityMap; types?: ProbabilityMap }>;
  brands: Array<{ id: string; base_category?: string; groups?: ProbabilityMap; types?: ProbabilityMap }>;
};

const typeIds = (query: string) => resolveQuery(query).types.map((match) => match.typeId).sort();

describe("presence catalog integrity", () => {
  it("has unique type ids that belong to declared groups", () => {
    const ids = PRODUCT_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of PRODUCT_TYPES) {
      expect(PRODUCT_GROUPS[type.group], `group of ${type.id}`).toBeDefined();
    }
  });

  it("priors only reference existing types, groups and categories, with probabilities in [0,1]", () => {
    const problems: string[] = [];
    const check = (owner: string, map: ProbabilityMap | undefined, kind: "group" | "type") => {
      for (const [key, value] of Object.entries(map ?? {})) {
        const exists = kind === "group" ? Boolean(PRODUCT_GROUPS[key]) : PRODUCT_TYPES_BY_ID.has(key);
        if (!exists) problems.push(`${owner}: unknown ${kind} "${key}"`);
        if (!(value >= 0 && value <= 1)) problems.push(`${owner}: ${key}=${value} out of range`);
      }
    };
    for (const [category, entry] of Object.entries(priors.categories)) {
      if (entry.inherit && !priors.categories[entry.inherit]) problems.push(`${category}: unknown inherit ${entry.inherit}`);
      check(category, entry.groups, "group");
      check(category, entry.types, "type");
    }
    for (const brand of priors.brands) {
      if (brand.base_category && !priors.categories[brand.base_category]) {
        problems.push(`brand ${brand.id}: unknown base_category ${brand.base_category}`);
      }
      check(`brand ${brand.id}`, brand.groups, "group");
      check(`brand ${brand.id}`, brand.types, "type");
    }
    expect(problems).toEqual([]);
  });

  it("does not give the same alias to two product types (ambiguity must be deliberate)", () => {
    const owners = new Map<string, Set<string>>();
    for (const type of PRODUCT_TYPES) {
      for (const alias of type.aliases) {
        const key = stemmedTokens(alias).join(" ");
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key)!.add(type.id);
      }
    }
    const collisions = Array.from(owners.entries())
      .filter(([, ids]) => ids.size > 1)
      .map(([alias, ids]) => `${alias}: ${Array.from(ids).join(", ")}`);
    expect(collisions).toEqual([]);
  });
});

describe("query resolution", () => {
  it("prefers the longest alias", () => {
    expect(typeIds("oat milk")).toEqual(["oat_milk"]);
    expect(typeIds("bike lock")).toEqual(["bike_lock"]);
    expect(typeIds("ice cream")).toEqual(["ice_cream"]);
  });

  it("resolves German, Spanish, umlaut-less spellings and plurals", () => {
    expect(typeIds("Glühbirne")).toEqual(["light_bulb"]);
    expect(typeIds("gluehbirne")).toEqual(["light_bulb"]);
    expect(typeIds("pañales")).toEqual(["diapers"]);
    expect(typeIds("batteries")).toEqual(["batteries"]);
    expect(typeIds("Brötchen")).toEqual(["bread_rolls"]);
  });

  it("glues compounds typed as two words", () => {
    expect(typeIds("tooth paste")).toEqual(["toothpaste"]);
    expect(typeIds("tooth brush")).toEqual(["toothbrush"]);
  });

  it("does not guess on short words or when the rest of the query is unknown", () => {
    // "paste" is one letter from "pastel" (cake in Spanish): must not become cake.
    expect(typeIds("paste")).toEqual([]);
    expect(typeIds("tooth paste")).not.toContain("cake");
    expect(resolveQuery("hair dryer").resolved).toBe(false);
  });

  it("tolerates typos on long words only", () => {
    expect(typeIds("bateries")).toEqual(["batteries"]);
    expect(typeIds("Waschmitel")).toEqual(["laundry_detergent"]);
    expect(typeIds("mjlk")).toEqual(["milk"]);
  });

  it("separates modifiers from the product", () => {
    const resolution = resolveQuery("organic vegetables");
    expect(resolution.types.map((match) => match.typeId)).toEqual(["vegetables"]);
    expect(resolution.modifiers).toEqual(["organic"]);
    expect(resolveQuery("refill detergent").modifiers).toEqual(["refill"]);
    expect(typeIds("bio")).toEqual(["store_organic"]);
  });

  it("resolves every quick-intent button label in all languages", () => {
    for (const label of ["Apotheke", "pharmacy", "farmacia", "Baumarkt", "hardware", "ferreteria", "Spaeti Basics", "spaeti essentials", "basicos spaeti", "Essentials", "esenciales"]) {
      expect(resolveQuery(label).resolved, label).toBe(true);
    }
  });

  it("ignores filler words and keeps unknown ones visible", () => {
    expect(typeIds("where can I buy milk near me")).toEqual(["milk"]);
    const unknown = resolveQuery("cassette");
    expect(unknown.resolved).toBe(false);
    expect(unknown.unmatchedTokens).toEqual(["cassette"]);
  });
});
