import { describe, expect, it } from "vitest";
import { __private } from "@/lib/data";
import { normalizeQuery } from "@/lib/maps";

describe("keyword intent helpers", () => {
  it("maps english intent terms and common typos to expected product groups", () => {
    expect(__private.inferProductGroupsFromKeyword("beer")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("guinness")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("guiness")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("mjlk")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("garlic")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("apricot")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("strawberries")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("mango")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("sesame seeds")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("pliers")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("hammr")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("glu")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("scissors")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("lightbulb")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("cassette")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("casete")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("condoms")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("condons")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("painkiller")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("diapers")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("baby formula")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("pacifer")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("cat food")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("detergant")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("frying pan")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("potting soil")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("wrenchh")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("cerveza")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("bier")).toContain("beverages");
    expect(__private.inferProductGroupsFromKeyword("panales")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("hundefutter")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("pharmacies")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("detergente")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("sarten")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("pflanzerde")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("llave inglesa")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("apotheke")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("katzenstreu")).toContain("pet_care");
    expect(__private.inferProductGroupsFromKeyword("tortilla")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("nori")).toContain("groceries");
    expect(__private.inferProductGroupsFromKeyword("jalapeno")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("jalapneo")).toContain("fresh_produce");
    expect(__private.inferProductGroupsFromKeyword("scrwedriver")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("tampons")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("tampones")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("menstrual cup")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("pantyliner")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("sunscrean")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("pregnancy test")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("morning after pill")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("lubrifiant")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("anticeptic")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("compresas")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("flashlight")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("candels")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("powerbank")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("drain cleaner")).toContain("household");
    expect(__private.inferProductGroupsFromKeyword("cold medicine")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("orss")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("ffp2 mask")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("contact lens solution")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("diarhea medicine")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("omeprazol")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("loperamide")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("melatonina")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("compression socks")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("blutdruckmessgeraet")).toContain("pharmacy");
    expect(__private.inferProductGroupsFromKeyword("wet wipes")).toContain("personal_care");
    expect(__private.inferProductGroupsFromKeyword("puppypad")).toContain("pet_care");
    expect(__private.inferProductGroupsFromKeyword("poop bags")).toContain("pet_care");
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

  it("normalizes punctuation and accents in user queries", () => {
    expect(normalizeQuery("jalapeño!!")).toBe("jalapeno");
    expect(normalizeQuery("milk-1L")).toBe("milk 1l");
  });

  it("applies strict lexical guard for specific group-fallback queries", () => {
    expect(__private.isSpecificProductQuery("jalapeno")).toBe(true);
    expect(__private.isSpecificProductQuery("milk")).toBe(false);

    expect(__private.hasMeaningfulTokenMatch("jalapeno 100g", "jalapeno")).toBe(true);
    expect(__private.hasMeaningfulTokenMatch("bananen 1kg", "jalapeno")).toBe(false);

    expect(
      __private.shouldKeepGroupFallbackRow({
        normalizedQuery: "jalapeno",
        productNameNormalized: "jalapeno 100g",
        confidence: 0.72,
        sourceType: "rules_generated",
        validationStatus: "likely"
      })
    ).toBe(true);

    expect(
      __private.shouldKeepGroupFallbackRow({
        normalizedQuery: "jalapeno",
        productNameNormalized: "bananen 1kg",
        confidence: 0.93,
        sourceType: "rules_generated",
        validationStatus: "likely"
      })
    ).toBe(false);

    expect(
      __private.shouldKeepGroupFallbackRow({
        normalizedQuery: "strawberry",
        productNameNormalized: "aepfel 1kg",
        productGroup: "fresh_produce",
        osmCategory: "supermarket",
        confidence: 0.84,
        sourceType: "rules_generated",
        validationStatus: "likely"
      })
    ).toBe(true);

    expect(
      __private.shouldKeepGroupFallbackRow({
        normalizedQuery: "brush",
        productNameNormalized: "tampons 32",
        productGroup: "personal_care",
        osmCategory: "beauty",
        confidence: 0.92,
        sourceType: "rules_generated",
        validationStatus: "likely"
      })
    ).toBe(false);
  });

  it("maps category-intent queries to app categories for store-first fallback", () => {
    expect(__private.inferAppCategoryIntents("antiques")).toContain("antiques");
    expect(__private.inferAppCategoryIntents("antique")).toContain("antiques");
    expect(__private.inferAppCategoryIntents("art")).toContain("art");
    expect(__private.inferAppCategoryIntents("art supplies")).toContain("art");
    expect(__private.inferAppCategoryIntents("stationery")).toContain("art");
    expect(__private.inferAppCategoryIntents("wax")).toContain("beauty");
    expect(__private.inferAppCategoryIntents("waxing")).toContain("beauty");
  });

  it("detects service-intent queries and suppresses weak product-only matches", () => {
    expect(__private.isLikelyServiceIntentQuery("repair")).toBe(true);
    expect(__private.isLikelyServiceIntentQuery("bike repair")).toBe(true);
    expect(__private.isLikelyServiceIntentQuery("key copy")).toBe(true);
    expect(__private.isLikelyServiceIntentQuery("milk")).toBe(false);

    const weakRuleResult = {
      product: { normalizedName: "hair repair shampoo" },
      confidence: 0.62,
      validationStatus: "likely",
      sourceType: "rules_generated"
    };
    const trustedMatchResult = {
      product: { normalizedName: "repair kit" },
      confidence: 0.91,
      validationStatus: "validated",
      sourceType: "website_extracted"
    };

    expect(
      __private.keepProductResultForServiceIntent(
        weakRuleResult as never,
        "repair"
      )
    ).toBe(false);
    expect(
      __private.keepProductResultForServiceIntent(
        trustedMatchResult as never,
        "repair"
      )
    ).toBe(true);
  });
});
