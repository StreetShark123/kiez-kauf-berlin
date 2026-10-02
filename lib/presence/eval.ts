import { canonicalCategory } from "@/lib/presence/priors";
import { normalizeText } from "@/lib/presence/normalize";

export type GoldQuery = {
  query: string;
  persona: string;
  expect_types: string[];
  good_categories: string[];
  good_brands?: string[];
  good_name_contains?: string[];
  // OSM tags that make a shop a correct answer, e.g. {"diet:halal": ["yes","only"]}
  good_tags?: Record<string, string[]>;
  bad_categories?: string[];
  notes?: string;
};

export type GoldSuite = {
  version: string;
  default_origin: { lat: number; lng: number; radius_meters: number };
  queries: GoldQuery[];
};

export type EvaluatedResult = { storeName: string; osmCategory: string | null; tags?: Record<string, string> | null };

export type QueryEvaluation = {
  query: string;
  persona: string;
  resolvedTypes: string[] | null;
  resolutionOk: boolean | null;
  resultCount: number;
  top: Array<{ store: string; category: string | null; verdict: "good" | "bad" | "neutral" }>;
  precisionAt3: number;
  top1Correct: boolean;
  badInTop3: boolean;
  expectsNothing: boolean;
  passed: boolean;
};

export type SuiteSummary = {
  total: number;
  precisionAt3: number;
  top1Accuracy: number;
  badInTop3Rate: number;
  resolutionAccuracy: number | null;
  passRate: number;
};

function verdictFor(result: EvaluatedResult, gold: GoldQuery): "good" | "bad" | "neutral" {
  const category = canonicalCategory(result.osmCategory);
  const name = normalizeText(result.storeName);
  const inList = (list: string[] | undefined) =>
    (list ?? []).some((value) => canonicalCategory(value) === category || value === result.osmCategory);
  const nameHit = [...(gold.good_brands ?? []), ...(gold.good_name_contains ?? [])].some((needle) =>
    ` ${name} `.includes(` ${normalizeText(needle)} `)
  );
  const tagHit = Object.entries(gold.good_tags ?? {}).some(([tag, values]) => {
    const value = result.tags?.[tag];
    return typeof value === "string" && values.includes(value.toLowerCase());
  });
  if (nameHit || tagHit || inList(gold.good_categories)) {
    return "good";
  }
  if (inList(gold.bad_categories)) {
    return "bad";
  }
  return "neutral";
}

export function evaluateQuery(
  gold: GoldQuery,
  results: EvaluatedResult[],
  resolvedTypes: string[] | null
): QueryEvaluation {
  const expectsNothing = gold.expect_types.length === 0 && gold.good_categories.length === 0;
  const top = results.slice(0, 3).map((result) => ({
    store: result.storeName,
    category: result.osmCategory,
    verdict: verdictFor(result, gold)
  }));
  const goodCount = top.filter((entry) => entry.verdict === "good").length;
  // An empty answer to an answerable query is a miss, not "no false positives".
  const precisionAt3 = expectsNothing ? (results.length === 0 ? 1 : 0) : top.length === 0 ? 0 : goodCount / top.length;
  const top1Correct = expectsNothing ? results.length === 0 : top[0]?.verdict === "good";
  const badInTop3 = top.some((entry) => entry.verdict === "bad");
  const resolutionOk =
    resolvedTypes === null
      ? null
      : gold.expect_types.length === 0
        ? resolvedTypes.length === 0
        : gold.expect_types.every((type) => resolvedTypes.includes(type));
  return {
    query: gold.query,
    persona: gold.persona,
    resolvedTypes,
    resolutionOk,
    resultCount: results.length,
    top,
    precisionAt3,
    top1Correct,
    badInTop3,
    expectsNothing,
    passed: top1Correct && !badInTop3 && precisionAt3 >= 2 / 3 - 1e-9
  };
}

export function summarize(evaluations: QueryEvaluation[]): SuiteSummary {
  const total = evaluations.length || 1;
  const withResolution = evaluations.filter((entry) => entry.resolutionOk !== null);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / total;
  return {
    total: evaluations.length,
    precisionAt3: mean(evaluations.map((entry) => entry.precisionAt3)),
    top1Accuracy: mean(evaluations.map((entry) => (entry.top1Correct ? 1 : 0))),
    badInTop3Rate: mean(evaluations.map((entry) => (entry.badInTop3 ? 1 : 0))),
    resolutionAccuracy: withResolution.length
      ? withResolution.filter((entry) => entry.resolutionOk).length / withResolution.length
      : null,
    passRate: mean(evaluations.map((entry) => (entry.passed ? 1 : 0)))
  };
}
