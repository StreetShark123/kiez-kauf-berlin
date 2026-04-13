#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const vocabularyPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(process.cwd(), "data/berlin/vocabulary.en.json");

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

function fail(message, payload = null) {
  if (payload === null) {
    console.error(`[vocab:lint] ERROR ${message}`);
    return;
  }
  console.error(`[vocab:lint] ERROR ${message}`, payload);
}

function warn(message, payload = null) {
  if (payload === null) {
    console.warn(`[vocab:lint] WARN ${message}`);
    return;
  }
  console.warn(`[vocab:lint] WARN ${message}`, payload);
}

const raw = fs.readFileSync(vocabularyPath, "utf8");
const vocabulary = JSON.parse(raw);

let errorCount = 0;
let warningCount = 0;

if (!Array.isArray(vocabulary.groups) || vocabulary.groups.length === 0) {
  fail("`groups` must be a non-empty array.");
  process.exit(1);
}

const groupNames = new Set();
const normalizedTermToGroups = new Map();
const normalizedTokenSet = new Set();

for (const groupEntry of vocabulary.groups) {
  const group = String(groupEntry?.group ?? "").trim();
  const terms = Array.isArray(groupEntry?.terms) ? groupEntry.terms : [];

  if (!group) {
    errorCount += 1;
    fail("Group without valid `group` name detected.", groupEntry);
    continue;
  }
  if (groupNames.has(group)) {
    errorCount += 1;
    fail(`Duplicate group name detected: ${group}`);
  } else {
    groupNames.add(group);
  }
  if (terms.length === 0) {
    errorCount += 1;
    fail(`Group has zero terms: ${group}`);
    continue;
  }

  const seenTermsInGroup = new Set();
  for (const term of terms) {
    const normalized = normalize(term);
    if (!normalized) {
      errorCount += 1;
      fail(`Empty/invalid term found in group: ${group}`, { term });
      continue;
    }
    if (seenTermsInGroup.has(normalized)) {
      errorCount += 1;
      fail(`Duplicate normalized term inside group '${group}': ${normalized}`);
      continue;
    }
    seenTermsInGroup.add(normalized);

    const groupSet = normalizedTermToGroups.get(normalized) ?? new Set();
    groupSet.add(group);
    normalizedTermToGroups.set(normalized, groupSet);

    for (const token of normalized.split(" ")) {
      if (token) {
        normalizedTokenSet.add(token);
      }
    }
  }
}

for (const [term, groups] of normalizedTermToGroups.entries()) {
  if (groups.size > 1) {
    warningCount += 1;
    warn(`Term appears in multiple groups (check ambiguity): ${term}`, Array.from(groups));
  }
}

const genericTerms = new Set((vocabulary.generic_terms ?? []).map(normalize).filter(Boolean));
const broadTerms = new Set((vocabulary.broad_terms ?? []).map(normalize).filter(Boolean));
const typoEntries = Object.entries(vocabulary.typo_corrections ?? {});

for (const [rawKey, rawValue] of typoEntries) {
  const key = normalize(rawKey);
  const value = normalize(rawValue);
  if (!key || !value) {
    errorCount += 1;
    fail("Invalid typo correction (empty key/value after normalization).", { rawKey, rawValue });
    continue;
  }
  if (key === value) {
    warningCount += 1;
    warn("Typo correction maps to itself; likely unnecessary.", { key });
  }

  const targetKnown =
    normalizedTermToGroups.has(value) ||
    normalizedTokenSet.has(value) ||
    genericTerms.has(value) ||
    broadTerms.has(value);

  if (!targetKnown) {
    errorCount += 1;
    fail("Typo correction target is unknown in vocabulary/generic/broad terms.", {
      rawKey,
      rawValue,
      normalizedTarget: value
    });
  }
}

const summary = {
  file: path.relative(process.cwd(), vocabularyPath),
  groups: groupNames.size,
  terms: normalizedTermToGroups.size,
  typoCorrections: typoEntries.length,
  warnings: warningCount,
  errors: errorCount
};

if (errorCount > 0) {
  console.error("[vocab:lint] FAILED", summary);
  process.exit(1);
}

console.log("[vocab:lint] OK", summary);
