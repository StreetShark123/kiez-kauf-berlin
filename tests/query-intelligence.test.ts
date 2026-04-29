import { describe, expect, it } from "vitest";
import { chooseEffectiveQuery, type QueryResolution } from "@/lib/query-intelligence";

function baseResolution(overrides: Partial<QueryResolution> = {}): QueryResolution {
  return {
    requestId: "req-1",
    originalQuery: "phone rapair",
    resolvedQuery: "phone repair",
    intentType: "service",
    confidence: 0.8,
    canonicalTerms: ["phone repair"],
    alternateQueries: [],
    mustHaveTokens: [],
    negativeTokens: [],
    usedLlm: true,
    model: "gpt-4.1-mini",
    provider: "openai",
    promptHash: "abc",
    llmLatencyMs: 150,
    llmInputTokens: 120,
    llmOutputTokens: 30,
    estimatedCostUsd: 0.0001,
    errorMessage: null,
    ...overrides
  };
}

describe("query intelligence", () => {
  it("uses resolved query when confidence is strong", () => {
    expect(chooseEffectiveQuery(baseResolution())).toBe("phone repair");
  });

  it("falls back to original query when confidence is low", () => {
    expect(chooseEffectiveQuery(baseResolution({ confidence: 0.42 }))).toBe("phone rapair");
  });

  it("accepts small actionable rewrites on medium confidence", () => {
    expect(
      chooseEffectiveQuery(
        baseResolution({
          confidence: 0.5,
          intentType: "service",
          resolvedQuery: "phone repair"
        })
      )
    ).toBe("phone repair");
  });

  it("accepts rewrite with canonical support even if intent is unknown", () => {
    expect(
      chooseEffectiveQuery(
        baseResolution({
          confidence: 0.5,
          intentType: "unknown",
          canonicalTerms: ["phone repair"],
          resolvedQuery: "phone repair"
        })
      )
    ).toBe("phone repair");
  });

  it("falls back to original query when llm was not used", () => {
    expect(
      chooseEffectiveQuery(
        baseResolution({
          usedLlm: false,
          resolvedQuery: "something else",
          confidence: 0.99
        })
      )
    ).toBe("phone rapair");
  });
});
