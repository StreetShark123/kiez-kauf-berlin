// Text normalization shared by catalog indexing and query resolution.
// Both sides MUST go through the same functions, otherwise aliases silently stop matching.

const GERMAN_DIGRAPHS: Array<[RegExp, string]> = [
  [/ae/g, "a"],
  [/oe/g, "o"],
  [/ue/g, "u"]
];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "gluehbirne" (typed without umlaut keys) and "glühbirne" must meet in the same form.
export function foldGermanDigraphs(token: string): string {
  if (token.length < 4) {
    return token;
  }
  let output = token;
  for (const [pattern, replacement] of GERMAN_DIGRAPHS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

// Conservative English plural folding so "batteries"/"battery" and "tomatoes"/"tomato" match.
export function stemToken(token: string): string {
  const folded = foldGermanDigraphs(token);
  if (folded.length <= 3 || /\d/.test(folded)) {
    return folded;
  }
  if (folded.endsWith("ies") && folded.length > 4) {
    return `${folded.slice(0, -3)}y`;
  }
  if (folded.endsWith("oes")) {
    return folded.slice(0, -2);
  }
  if (folded.endsWith("ss") || folded.endsWith("us") || folded.endsWith("is")) {
    return folded;
  }
  if (folded.endsWith("s")) {
    return folded.slice(0, -1);
  }
  return folded;
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

export function stemmedTokens(value: string): string[] {
  return tokenize(value).map(stemToken);
}

export function levenshteinWithin(a: string, b: string, maxDistance: number): boolean {
  return boundedLevenshtein(a, b, maxDistance) <= maxDistance;
}

// Edit distance, or Infinity as soon as it is known to exceed maxDistance.
export function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return Number.POSITIVE_INFINITY;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) {
      return Number.POSITIVE_INFINITY;
    }
    previous = current;
  }
  const distance = previous[b.length];
  return distance <= maxDistance ? distance : Number.POSITIVE_INFINITY;
}

// Typos are only tolerated on words of 6+ letters: "mjlk" is handled by an explicit alias,
// while "batterien" vs "baterien" is caught here. Returns the edit distance, or null.
export function fuzzyTokenDistance(queryToken: string, aliasToken: string): number | null {
  if (queryToken === aliasToken) {
    return 0;
  }
  if (/\d/.test(queryToken) || /\d/.test(aliasToken)) {
    return null;
  }
  // 5-letter words are too close to each other ("paste" vs "pastel") to guess safely.
  const shorter = Math.min(queryToken.length, aliasToken.length);
  if (shorter < 6) {
    return null;
  }
  const allowed = shorter >= 9 ? 2 : 1;
  const distance = boundedLevenshtein(queryToken, aliasToken, allowed);
  return Number.isFinite(distance) ? distance : null;
}

export function fuzzyTokenMatch(queryToken: string, aliasToken: string): boolean {
  return fuzzyTokenDistance(queryToken, aliasToken) !== null;
}
