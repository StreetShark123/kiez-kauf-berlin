import { describe, expect, it } from "vitest";
import { __private } from "@/lib/data";

describe("keyword intent helpers", () => {
  it("maps english intent terms and common typos to expected product groups", () => {
    expect(__private.inferProductGroupsFromKeyword("beer")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("mjlk")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("garlic")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("apricot")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("pliers")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("hammr")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("glu")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("condoms")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("painkiller")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("diapers")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("tortilla")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("nori")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("jalapeno")).toContain("fresh_produce");
  });

  it("matches canonical products through english names, synonyms and typo-tolerant matching", () => {
    const catalog = [
      {
        id: 18,
        normalized_name: "hafermilch 1l",
        display_name_en: "Oat milk 1L",
        display_name_es: "Leche de avena 1L",
        display_name_de: "Hafermilch 1L",
        synonyms: ["oat milk", "hafer drink"],
        product_group: "beverages"
      },
      {
        id: 19,
        normalized_name: "vollmilch 1l",
        display_name_en: "Whole milk 1L",
        display_name_es: "Leche entera 1L",
        display_name_de: "Vollmilch 1L",
        synonyms: ["milk 1l"],
        product_group: "beverages"
      },
      {
        id: 20,
        normalized_name: "jalapeno 100g",
        display_name_en: "Jalapeno 100g",
        display_name_es: "Jalapeno 100g",
        display_name_de: "Jalapeno 100g",
        synonyms: ["jalapeno", "green chili"],
        product_group: "fresh_produce"
      }
    ];

    expect(__private.findCanonicalProductIdsByQuery("milk", catalog)).toEqual([18, 19]);
    expect(__private.findCanonicalProductIdsByQuery("mjlk", catalog)).toEqual([18, 19]);
    expect(__private.findCanonicalProductIdsByQuery("hafer", catalog)).toEqual([18]);
    expect(__private.findCanonicalProductIdsByQuery("jalapeño", catalog)).toEqual([20]);
    expect(__private.findCanonicalProductIdsByQuery("jalapneo", catalog)).toEqual([20]);
  });
});
