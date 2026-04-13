import rawVocabulary from "@/data/berlin/vocabulary.en.json";
import { normalizeQuery } from "@/lib/maps";

type RawVocabulary = {
  version: string;
  locale: string;
  generic_terms: string[];
  typo_corrections: Record<string, string>;
  groups: Array<{
    group: string;
    terms: string[];
  }>;
};

const vocabulary = rawVocabulary as RawVocabulary;

const normalizeTerm = (value: string) => normalizeQuery(value);

export const VOCABULARY_VERSION = vocabulary.version;
export const VOCABULARY_LOCALE = vocabulary.locale;

export const KEYWORD_GROUP_MAP: Array<{ group: string; terms: string[] }> = vocabulary.groups.map((entry) => ({
  group: entry.group,
  terms: Array.from(new Set(entry.terms.map(normalizeTerm).filter(Boolean)))
}));

export const GENERIC_QUERY_TERMS = new Set(vocabulary.generic_terms.map(normalizeTerm).filter(Boolean));

const TYPO_CORRECTION_MAP = new Map<string, string>(
  Object.entries(vocabulary.typo_corrections).map(([key, value]) => [normalizeTerm(key), normalizeTerm(value)])
);

export function applyVocabularyTypos(normalizedQuery: string): string {
  if (!normalizedQuery) {
    return normalizedQuery;
  }

  const correctedTokens = normalizedQuery
    .split(" ")
    .map((token) => TYPO_CORRECTION_MAP.get(token) ?? token)
    .filter(Boolean);

  return correctedTokens.join(" ");
}
