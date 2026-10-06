import rawCatalog from "@/data/presence/product-types.v1.json";
import { boundedLevenshtein, foldGermanDigraphs, fuzzyTokenDistance, stemToken, stemmedTokens, tokenize } from "@/lib/presence/normalize";
import type { Locale } from "@/lib/types";

export type ProductTypeKind = "product" | "store_type";

export type ProductType = {
  id: string;
  group: string;
  kind: ProductTypeKind;
  names: Record<Locale, string>;
  aliases: string[];
  // Only for kind=store_type: P(store of osm category is this kind of shop / offers this service).
  stores?: Record<string, number>;
  brands?: string[];
  // Specialty items (baklava, Guinness...) are only expected where a prior names them explicitly.
  specialty: boolean;
};

export type Modifier = {
  id: string;
  aliases: string[];
  default: number;
  categories: Record<string, number>;
  brands: string[];
  nameContains: string[];
  tags: Record<string, string[]>;
};

type RawType = {
  id: string;
  group: string;
  kind?: ProductTypeKind;
  en: string;
  de: string;
  es: string;
  aliases?: string[];
  stores?: Record<string, number>;
  brands?: string[];
  specialty?: boolean;
};

type RawModifier = {
  id: string;
  aliases: string[];
  default: number;
  categories?: Record<string, number>;
  brands?: string[];
  name_contains?: string[];
  tags?: Record<string, string[]>;
};

type RawCatalog = {
  version: string;
  groups: Record<string, Record<Locale, string>>;
  modifiers: RawModifier[];
  types: RawType[];
};

const catalog = rawCatalog as unknown as RawCatalog;

export const CATALOG_VERSION = catalog.version;

export const PRODUCT_GROUPS = catalog.groups;

export const PRODUCT_TYPES: ProductType[] = catalog.types.map((type) => ({
  id: type.id,
  group: type.group,
  kind: type.kind ?? "product",
  names: { en: type.en, de: type.de, es: type.es },
  aliases: [type.en, type.de, type.es, ...(type.aliases ?? [])],
  stores: type.stores,
  brands: type.brands,
  specialty: type.specialty === true
}));

export const PRODUCT_TYPES_BY_ID = new Map(PRODUCT_TYPES.map((type) => [type.id, type]));

export const MODIFIERS: Modifier[] = catalog.modifiers.map((modifier) => ({
  id: modifier.id,
  aliases: modifier.aliases,
  default: modifier.default,
  categories: modifier.categories ?? {},
  brands: modifier.brands ?? [],
  nameContains: modifier.name_contains ?? [],
  tags: modifier.tags ?? {}
}));

type AliasEntry = {
  ownerId: string;
  ownerKind: "type" | "modifier";
  tokens: string[];
  rawTokens: string[];
};

function buildAliasIndex(): AliasEntry[] {
  const entries: AliasEntry[] = [];
  const seen = new Set<string>();
  const push = (ownerId: string, ownerKind: AliasEntry["ownerKind"], alias: string) => {
    const tokens = stemmedTokens(alias);
    if (tokens.length === 0) {
      return;
    }
    const key = `${ownerKind}:${ownerId}:${tokens.join(" ")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ ownerId, ownerKind, tokens, rawTokens: tokenize(alias).map(foldGermanDigraphs) });
  };
  for (const type of PRODUCT_TYPES) {
    for (const alias of type.aliases) {
      push(type.id, "type", alias);
    }
  }
  for (const modifier of MODIFIERS) {
    for (const alias of modifier.aliases) {
      push(modifier.id, "modifier", alias);
    }
  }
  return entries;
}

const ALIAS_INDEX = buildAliasIndex();

// Single-word aliases, so "tooth paste" / "Zahn bürste" can be glued back into one word.
const SINGLE_TOKEN_ALIASES = new Set(
  ALIAS_INDEX.filter((entry) => entry.tokens.length === 1).map((entry) => entry.tokens[0])
);

function joinSplitCompounds(rawTokens: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const next = rawTokens[index + 1];
    if (next !== undefined) {
      const joined = rawTokens[index] + next;
      if (SINGLE_TOKEN_ALIASES.has(stemToken(joined))) {
        output.push(joined);
        index += 1;
        continue;
      }
    }
    output.push(rawTokens[index]);
  }
  return output;
}

// Words that carry no product meaning ("where can I buy", "near me"...).
const STOPWORDS = new Set(
  [
    "a", "an", "the", "for", "of", "to", "in", "on", "near", "me", "my", "some", "buy", "where", "can", "i", "get", "find", "shop", "store", "berlin", "moabit",
    "de", "la", "el", "los", "las", "un", "una", "para", "comprar", "donde", "cerca", "mi", "en", "y", "con", "tienda",
    "der", "die", "das", "ein", "eine", "fur", "kaufen", "wo", "gibt", "es", "bei", "mir", "und", "mit", "im", "laden", "and", "or"
  ].map((word) => stemmedTokens(word)[0])
);

export type TypeMatch = {
  typeId: string;
  alias: string;
  coveredTokens: number;
  fuzzy: boolean;
};

export type QueryResolution = {
  query: string;
  tokens: string[];
  types: TypeMatch[];
  modifiers: string[];
  unmatchedTokens: string[];
  resolved: boolean;
};

type CandidateMatch = {
  entry: AliasEntry;
  positions: number[];
  fuzzy: boolean;
  // Sum of edit distances on stemmed tokens, and on the unstemmed words as a tie-breaker:
  // "bateries" is 1 edit from both "battery" and "bakery" once stemmed, but not as typed.
  distance: number;
  rawDistance: number;
};

// Alias tokens must appear in the query in order (not necessarily adjacent: "aa battery pack").
function matchAlias(queryTokens: string[], rawQueryTokens: string[], entry: AliasEntry): CandidateMatch | null {
  const positions: number[] = [];
  let distance = 0;
  let rawDistance = 0;
  let cursor = 0;
  for (const [aliasIndex, aliasToken] of entry.tokens.entries()) {
    let found = queryTokens.indexOf(aliasToken, cursor);
    let tokenDistance = 0;
    if (found === -1) {
      let best: { index: number; distance: number } | null = null;
      for (let index = cursor; index < queryTokens.length; index += 1) {
        const candidateDistance = fuzzyTokenDistance(queryTokens[index], aliasToken);
        if (candidateDistance !== null && (!best || candidateDistance < best.distance)) {
          best = { index, distance: candidateDistance };
        }
      }
      if (!best) {
        return null;
      }
      found = best.index;
      tokenDistance = best.distance;
    }
    positions.push(found);
    distance += tokenDistance;
    if (tokenDistance > 0) {
      const raw = boundedLevenshtein(rawQueryTokens[found] ?? "", entry.rawTokens[aliasIndex] ?? aliasToken, 4);
      rawDistance += Number.isFinite(raw) ? raw : 5;
    }
    cursor = found + 1;
  }
  return { entry, positions, fuzzy: distance > 0, distance, rawDistance };
}

/**
 * Resolve a free-text query into product types.
 * Greedy longest-match: "oat milk" beats "milk", "bike lock" beats "lock".
 * Several types can be returned when the query names several things or an alias is shared.
 */
export function resolveQuery(query: string): QueryResolution {
  const words = joinSplitCompounds(tokenize(query));
  const tokens = words.map(stemToken);
  const rawTokens = words.map(foldGermanDigraphs);
  const candidates: CandidateMatch[] = [];
  for (const entry of ALIAS_INDEX) {
    const match = matchAlias(tokens, rawTokens, entry);
    if (match) {
      candidates.push(match);
    }
  }

  // Longest alias first, exact before fuzzy.
  candidates.sort((a, b) => {
    if (b.positions.length !== a.positions.length) {
      return b.positions.length - a.positions.length;
    }
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.rawDistance - b.rawDistance;
  });

  // position -> how the token was claimed (alias length + whether it was fuzzy)
  const claims = new Map<number, { length: number; fuzzy: boolean }>();
  const typeMatches = new Map<string, TypeMatch>();
  const modifiers = new Set<string>();

  for (const candidate of candidates) {
    const overlapsClaimed = candidate.positions.some((position) => claims.has(position));
    // An equally long, equally exact alias on exactly the same tokens is genuine ambiguity
    // (e.g. "gift card"): keep every type instead of picking one arbitrarily.
    const sameSpanAsClaimed =
      overlapsClaimed &&
      candidate.positions.every((position) => {
        const claim = claims.get(position);
        // Only exact matches create ambiguity; a typo resolves to its single closest alias.
        return claim !== undefined && claim.length === candidate.positions.length && !claim.fuzzy && !candidate.fuzzy;
      });
    if (overlapsClaimed && !sameSpanAsClaimed) {
      continue;
    }
    const claimPositions = () =>
      candidate.positions.forEach((position) =>
        claims.set(position, { length: candidate.positions.length, fuzzy: candidate.fuzzy })
      );
    if (candidate.entry.ownerKind === "modifier") {
      if (!overlapsClaimed) {
        modifiers.add(candidate.entry.ownerId);
        claimPositions();
      }
      continue;
    }
    const previous = typeMatches.get(candidate.entry.ownerId);
    if (!previous || previous.coveredTokens < candidate.positions.length) {
      typeMatches.set(candidate.entry.ownerId, {
        typeId: candidate.entry.ownerId,
        alias: candidate.entry.tokens.join(" "),
        coveredTokens: candidate.positions.length,
        fuzzy: candidate.fuzzy
      });
    }
    claimPositions();
  }

  // "bio" alone or "unverpackt" alone means the shop type, not a modifier on nothing.
  if (typeMatches.size === 0 && modifiers.size > 0) {
    if (modifiers.has("organic") || modifiers.has("refill")) {
      typeMatches.set("store_organic", { typeId: "store_organic", alias: "modifier", coveredTokens: 1, fuzzy: false });
    }
    if (modifiers.has("halal")) {
      typeMatches.set("store_butcher", { typeId: "store_butcher", alias: "modifier", coveredTokens: 1, fuzzy: false });
    }
  }

  let unmatchedTokens = tokens.filter((token, index) => !claims.has(index) && !STOPWORDS.has(token));

  // A typo guess is only trusted when it explains the whole query: in "tooth paste" the unknown
  // "tooth" means we misunderstood, so "paste≈pastel" must not turn into cake.
  if (unmatchedTokens.length > 0) {
    for (const [typeId, match] of typeMatches) {
      if (match.fuzzy) {
        typeMatches.delete(typeId);
      }
    }
    unmatchedTokens = tokens.filter((token, index) => {
      if (STOPWORDS.has(token)) {
        return false;
      }
      const claim = claims.get(index);
      return !claim || claim.fuzzy;
    });
  }

  return {
    query,
    tokens,
    types: Array.from(typeMatches.values()),
    modifiers: Array.from(modifiers),
    unmatchedTokens,
    resolved: typeMatches.size > 0
  };
}

export function productTypeName(typeId: string, locale: Locale): string {
  return PRODUCT_TYPES_BY_ID.get(typeId)?.names[locale] ?? typeId;
}
