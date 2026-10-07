import rawPriors from "@/data/presence/category-priors.v1.json";
import { MODIFIERS, PRODUCT_TYPES_BY_ID, type ProductType } from "@/lib/presence/catalog";
import { normalizeText } from "@/lib/presence/normalize";

type ProbabilityMap = Record<string, number>;

type RawCategory = {
  inherit?: string;
  groups?: ProbabilityMap;
  types?: ProbabilityMap;
};

type RawBrand = {
  id: string;
  match: string[];
  base_category?: string;
  organic?: boolean;
  groups?: ProbabilityMap;
  types?: ProbabilityMap;
};

type RawPriors = {
  version: string;
  category_aliases: Record<string, string>;
  categories: Record<string, RawCategory>;
  brands: RawBrand[];
};

const priors = rawPriors as unknown as RawPriors;

export const PRIORS_VERSION = priors.version;

// "Snacks 0.93 at a Späti" must not imply "baklava 0.93 at a Späti".
const SPECIALTY_GROUP_DAMPING = 0.15;

export type PresenceStore = {
  id: string;
  name: string;
  osmCategory: string | null;
  brand?: string | null;
  tags?: Record<string, string> | null;
};

type ResolvedCategory = { groups: ProbabilityMap; types: ProbabilityMap };

function resolveCategory(category: string, depth = 0): ResolvedCategory {
  const raw = priors.categories[category];
  if (!raw || depth > 4) {
    return { groups: {}, types: {} };
  }
  const parent = raw.inherit ? resolveCategory(raw.inherit, depth + 1) : { groups: {}, types: {} };
  return {
    groups: { ...parent.groups, ...(raw.groups ?? {}) },
    types: { ...parent.types, ...(raw.types ?? {}) }
  };
}

const RESOLVED_CATEGORIES = new Map<string, ResolvedCategory>(
  Object.keys(priors.categories).map((category) => [category, resolveCategory(category)])
);

export function canonicalCategory(osmCategory: string | null | undefined): string | null {
  if (!osmCategory) {
    return null;
  }
  const normalized = osmCategory.trim().toLowerCase();
  return priors.category_aliases[normalized] ?? normalized;
}

export function isKnownCategory(category: string): boolean {
  return RESOLVED_CATEGORIES.has(category);
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) {
    return false;
  }
  return ` ${haystack} `.includes(` ${needle} `);
}

// Brand detection: exact OSM brand tag first, then whole-word match inside the store name.
function matchingBrands(store: PresenceStore): RawBrand[] {
  const brandTag = normalizeText(store.brand ?? store.tags?.brand ?? "");
  const name = normalizeText(store.name);
  return priors.brands.filter((brand) =>
    brand.match.some((pattern) => {
      const normalizedPattern = normalizeText(pattern);
      return (brandTag && brandTag === normalizedPattern) || containsWord(name, normalizedPattern);
    })
  );
}

export type StoreProfile = {
  category: string | null;
  brandIds: string[];
  organic: boolean;
  groups: ProbabilityMap;
  types: ProbabilityMap;
};

const profileCache = new Map<string, StoreProfile>();

export function buildStoreProfile(store: PresenceStore): StoreProfile {
  const cacheKey = `${store.id}|${store.osmCategory}|${store.brand ?? ""}|${store.name}`;
  const cached = profileCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const brands = matchingBrands(store);
  const baseCategory =
    brands.map((brand) => brand.base_category).find((value): value is string => Boolean(value)) ??
    canonicalCategory(store.osmCategory);
  const base = baseCategory ? RESOLVED_CATEGORIES.get(baseCategory) : undefined;
  const profile: StoreProfile = {
    category: baseCategory,
    brandIds: brands.map((brand) => brand.id),
    organic: brands.some((brand) => brand.organic === true),
    groups: { ...(base?.groups ?? {}) },
    types: { ...(base?.types ?? {}) }
  };
  for (const brand of brands) {
    Object.assign(profile.groups, brand.groups ?? {});
    // Brand group overrides must beat category-level type overrides of the same group,
    // otherwise "organic chain: tobacco 0.02" would lose against "supermarket: cigarettes 0.6".
    for (const [groupKey] of Object.entries(brand.groups ?? {})) {
      for (const typeId of Object.keys(profile.types)) {
        if (PRODUCT_TYPES_BY_ID.get(typeId)?.group === groupKey) {
          delete profile.types[typeId];
        }
      }
    }
    Object.assign(profile.types, brand.types ?? {});
  }
  if (profileCache.size > 20000) {
    profileCache.clear();
  }
  profileCache.set(cacheKey, profile);
  return profile;
}

export type PriorExplanation = {
  probability: number;
  basis: "brand_or_category_type" | "category_group" | "store_type" | "brand_store_type" | "none";
  category: string | null;
  brandIds: string[];
};

export function priorFor(store: PresenceStore, type: ProductType): PriorExplanation {
  const profile = buildStoreProfile(store);
  const explicit = profile.types[type.id];
  const common = { category: profile.category, brandIds: profile.brandIds };

  if (type.kind === "store_type") {
    const name = normalizeText(store.name);
    const brandHit = (type.brands ?? []).some((brand) => containsWord(name, normalizeText(brand)));
    if (brandHit) {
      return { probability: 0.97, basis: "brand_store_type", ...common };
    }
    const byCategory = profile.category ? type.stores?.[profile.category] : undefined;
    const value = Math.max(byCategory ?? 0, explicit ?? 0);
    return { probability: value, basis: value > 0 ? "store_type" : "none", ...common };
  }

  if (explicit !== undefined) {
    return { probability: explicit, basis: "brand_or_category_type", ...common };
  }
  const byGroup = profile.groups[type.group];
  if (byGroup !== undefined) {
    const probability = type.specialty ? byGroup * SPECIALTY_GROUP_DAMPING : byGroup;
    return { probability, basis: "category_group", ...common };
  }
  return { probability: 0, basis: "none", ...common };
}

// Multiplier in [0,1] applied for "organic", "refill", "halal"... modifiers.
export function modifierFactor(store: PresenceStore, modifierId: string): number {
  const modifier = MODIFIERS.find((entry) => entry.id === modifierId);
  if (!modifier) {
    return 1;
  }
  const profile = buildStoreProfile(store);
  const name = normalizeText(store.name);
  const brandTag = normalizeText(store.brand ?? store.tags?.brand ?? "");
  const brandHit = modifier.brands.some((brand) => {
    const normalizedBrand = normalizeText(brand);
    return brandTag === normalizedBrand || containsWord(name, normalizedBrand);
  });
  const nameHit = modifier.nameContains.some((needle) => containsWord(name, normalizeText(needle)));
  const tagHit = Object.entries(modifier.tags).some(([tag, values]) => {
    const value = store.tags?.[tag];
    return typeof value === "string" && values.includes(value.toLowerCase());
  });
  if (brandHit || nameHit || tagHit || (modifierId === "organic" && profile.organic)) {
    return 1;
  }
  if (profile.category && modifier.categories[profile.category] !== undefined) {
    return modifier.categories[profile.category];
  }
  return modifier.default;
}
