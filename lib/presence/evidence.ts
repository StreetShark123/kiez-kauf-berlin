// Evidence model: every observation about "store S has / doesn't have product type T" is one row.
// Users never edit the catalog directly; they add evidence. The posterior is recomputed on read,
// so a bad actor can only shift weight, never overwrite truth, and old observations fade.

export type EvidenceSource = "user" | "merchant" | "admin" | "website" | "import";

export type PresenceEvidence = {
  storeId: string;
  productTypeId: string;
  signal: 1 | -1;
  source: EvidenceSource;
  weight?: number | null;
  createdAt: string;
  deviceHash?: string | null;
  flagged?: boolean;
};

const SOURCE_WEIGHT: Record<EvidenceSource, number> = {
  user: 1,
  website: 1.5,
  import: 1,
  merchant: 4,
  admin: 6
};

// Half-life in days: shelves change, so a confirmation from last year counts much less.
const SOURCE_HALF_LIFE_DAYS: Record<EvidenceSource, number> = {
  user: 120,
  website: 180,
  import: 365,
  merchant: 240,
  admin: 365
};

// How many pseudo-observations the editorial prior is worth.
// 2 means two fresh user reports saying "not there" flip a 0.9 prior to ~0.45.
export const PRIOR_STRENGTH = 2;

export type PresenceTier = "confirmed" | "likely" | "possible" | "reported_missing" | "unlikely";

export type PresenceEstimate = {
  probability: number;
  prior: number;
  tier: PresenceTier;
  positiveWeight: number;
  negativeWeight: number;
  lastEvidenceAt: string | null;
  lastPositiveAt: string | null;
};

export const TIER_THRESHOLDS = {
  // One fresh sighting on a 0.25 prior lands at 0.5: someone saw it, so we say so.
  confirmedMinProbability: 0.5,
  confirmedMaxAgeDays: 120,
  likely: 0.65,
  possible: 0.3
};

function decayFactor(createdAt: string, source: EvidenceSource, now: number): number {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.pow(0.5, ageDays / SOURCE_HALF_LIFE_DAYS[source]);
}

export function estimatePresence(
  prior: number,
  evidence: PresenceEvidence[],
  now: number = Date.now()
): PresenceEstimate {
  const clampedPrior = Math.min(0.99, Math.max(0.01, prior));
  let alpha = clampedPrior * PRIOR_STRENGTH;
  let beta = (1 - clampedPrior) * PRIOR_STRENGTH;
  let positiveWeight = 0;
  let negativeWeight = 0;
  let lastEvidenceAt: string | null = null;
  let lastPositiveAt: string | null = null;

  for (const row of evidence) {
    if (row.flagged) {
      continue;
    }
    const weight = (row.weight ?? SOURCE_WEIGHT[row.source]) * decayFactor(row.createdAt, row.source, now);
    if (weight <= 0) {
      continue;
    }
    if (row.signal > 0) {
      alpha += weight;
      positiveWeight += weight;
      if (!lastPositiveAt || row.createdAt > lastPositiveAt) {
        lastPositiveAt = row.createdAt;
      }
    } else {
      beta += weight;
      negativeWeight += weight;
    }
    if (!lastEvidenceAt || row.createdAt > lastEvidenceAt) {
      lastEvidenceAt = row.createdAt;
    }
  }

  const probability = alpha / (alpha + beta);
  return {
    probability,
    prior: clampedPrior,
    tier: tierFor(probability, positiveWeight, negativeWeight, lastPositiveAt, now),
    positiveWeight,
    negativeWeight,
    lastEvidenceAt,
    lastPositiveAt
  };
}

function tierFor(
  probability: number,
  positiveWeight: number,
  negativeWeight: number,
  lastPositiveAt: string | null,
  now: number
): PresenceTier {
  const positiveIsRecent =
    lastPositiveAt !== null &&
    (now - Date.parse(lastPositiveAt)) / 86_400_000 <= TIER_THRESHOLDS.confirmedMaxAgeDays;
  if (positiveWeight >= 0.75 && positiveIsRecent && probability >= TIER_THRESHOLDS.confirmedMinProbability) {
    return "confirmed";
  }
  if (negativeWeight >= 0.75 && negativeWeight > positiveWeight && probability < TIER_THRESHOLDS.possible) {
    return "reported_missing";
  }
  if (probability >= TIER_THRESHOLDS.likely) {
    return "likely";
  }
  if (probability >= TIER_THRESHOLDS.possible) {
    return "possible";
  }
  return "unlikely";
}

export function evidenceKey(storeId: string, productTypeId: string): string {
  return `${storeId}::${productTypeId}`;
}

export function groupEvidence(rows: PresenceEvidence[]): Map<string, PresenceEvidence[]> {
  const grouped = new Map<string, PresenceEvidence[]>();
  for (const row of rows) {
    const key = evidenceKey(row.storeId, row.productTypeId);
    const list = grouped.get(key);
    if (list) {
      list.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}
