import rawVocabulary from "@/data/berlin/vocabulary.en.json";
import { normalizeQuery } from "@/lib/maps";

type RawVocabulary = {
  version: string;
  locale: string;
  generic_terms: string[];
  broad_terms?: string[];
  typo_corrections: Record<string, string>;
  groups: Array<{
    group: string;
    terms: string[];
  }>;
};

const vocabulary = rawVocabulary as RawVocabulary;

const normalizeTerm = (value: string) => normalizeQuery(value);
const splitTokens = (value: string) => value.split(" ").map((token) => token.trim()).filter(Boolean);

function dedupeNormalizedTerms(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeTerm).filter(Boolean)));
}

export const VOCABULARY_VERSION = vocabulary.version;
export const VOCABULARY_LOCALE = vocabulary.locale;

export const KEYWORD_GROUP_MAP: Array<{ group: string; terms: string[] }> = vocabulary.groups.map((entry) => ({
  group: entry.group,
  terms: dedupeNormalizedTerms(entry.terms)
}));

export const GENERIC_QUERY_TERMS = new Set(vocabulary.generic_terms.map(normalizeTerm).filter(Boolean));
export const BROAD_QUERY_TERMS = new Set((vocabulary.broad_terms ?? []).map(normalizeTerm).filter(Boolean));

export const KEYWORD_GROUP_TERMS_BY_GROUP = new Map<string, string[]>(
  KEYWORD_GROUP_MAP.map(({ group, terms }) => [group, terms])
);

export const KEYWORD_TERM_TO_GROUPS = new Map<string, string[]>();
export const KEYWORD_TOKEN_TO_GROUPS = new Map<string, string[]>();
export const KEYWORD_PREFIX_TO_GROUPS = new Map<string, string[]>();

for (const { group, terms } of KEYWORD_GROUP_MAP) {
  for (const term of terms) {
    const existingByTerm = KEYWORD_TERM_TO_GROUPS.get(term) ?? [];
    if (!existingByTerm.includes(group)) {
      KEYWORD_TERM_TO_GROUPS.set(term, [...existingByTerm, group]);
    }

    const tokens = splitTokens(term);
    for (const token of tokens) {
      const existingByToken = KEYWORD_TOKEN_TO_GROUPS.get(token) ?? [];
      if (!existingByToken.includes(group)) {
        KEYWORD_TOKEN_TO_GROUPS.set(token, [...existingByToken, group]);
      }

      if (token.length >= 3) {
        for (let size = 3; size <= Math.min(token.length, 6); size += 1) {
          const prefix = token.slice(0, size);
          const existingByPrefix = KEYWORD_PREFIX_TO_GROUPS.get(prefix) ?? [];
          if (!existingByPrefix.includes(group)) {
            KEYWORD_PREFIX_TO_GROUPS.set(prefix, [...existingByPrefix, group]);
          }
        }
      }
    }
  }
}

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

export function getCandidateGroupsFromVocabulary(normalizedQuery: string): string[] {
  if (!normalizedQuery) {
    return [];
  }

  const candidates = new Set<string>();
  const exactGroups = KEYWORD_TERM_TO_GROUPS.get(normalizedQuery);
  if (exactGroups) {
    exactGroups.forEach((group) => candidates.add(group));
  }

  const queryTokens = splitTokens(normalizedQuery);
  for (const token of queryTokens) {
    const tokenGroups = KEYWORD_TOKEN_TO_GROUPS.get(token);
    if (tokenGroups) {
      tokenGroups.forEach((group) => candidates.add(group));
    }

    if (token.length >= 3) {
      const prefixGroups = KEYWORD_PREFIX_TO_GROUPS.get(token.slice(0, Math.min(token.length, 6)));
      if (prefixGroups) {
        prefixGroups.forEach((group) => candidates.add(group));
      }
    }
  }

  return Array.from(candidates);
}
