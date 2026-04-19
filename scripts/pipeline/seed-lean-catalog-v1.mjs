import path from "node:path";
import {
  DATA_DIR,
  chunkArray,
  logInfo,
  logWarn,
  parseArgs,
  readJsonFile,
  runSupabaseQuery,
  sqlArray,
  sqlLiteral
} from "./_utils.mjs";

const CATALOG_FILE = path.join(DATA_DIR, "lean-catalog-v1.seed.json");

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCoverageTier(value) {
  const tier = String(value ?? "core").trim().toLowerCase();
  if (["core", "extended", "edge"].includes(tier)) return tier;
  return "core";
}

function normalizePriority(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeRow(raw) {
  const normalizedName = String(raw.normalized_name ?? "").trim().toLowerCase();
  if (!normalizedName) {
    throw new Error("lean catalog row without normalized_name");
  }

  const groupKey = String(raw.group_key ?? raw.product_group ?? "uncategorized")
    .trim()
    .toLowerCase();
  const familySlug = slugify(raw.family_slug ?? normalizedName) || `product-${slugify(normalizedName)}`;

  return {
    normalized_name: normalizedName,
    family_slug: familySlug,
    group_key: groupKey || "uncategorized",
    display_name_en: String(raw.display_name_en ?? normalizedName),
    display_name_de: String(raw.display_name_de ?? raw.display_name_en ?? normalizedName),
    display_name_es: String(raw.display_name_es ?? raw.display_name_en ?? normalizedName),
    is_active: typeof raw.is_active === "boolean" ? raw.is_active : true,
    priority: normalizePriority(raw.priority, 50),
    coverage_tier: normalizeCoverageTier(raw.coverage_tier),
    synonyms: Array.isArray(raw.synonyms) ? raw.synonyms.map((item) => String(item)).filter(Boolean) : [],
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
    facets: Array.isArray(raw.facets) ? raw.facets.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [],
    use_cases: Array.isArray(raw.use_cases) ? raw.use_cases : []
  };
}

function buildCoreUpsertSql(rows) {
  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.normalized_name),
        sqlLiteral(row.display_name_es),
        sqlLiteral(row.display_name_en),
        sqlLiteral(row.display_name_de),
        sqlArray(row.synonyms),
        sqlLiteral(row.group_key),
        sqlLiteral(row.group_key),
        sqlLiteral(row.family_slug),
        sqlLiteral(row.is_active),
        sqlLiteral(row.priority),
        sqlLiteral(row.coverage_tier)
      ].join(",")})`;
    })
    .join(",\n");

  return `
insert into public.canonical_products (
  normalized_name,
  display_name_es,
  display_name_en,
  display_name_de,
  synonyms,
  product_group,
  group_key,
  family_slug,
  is_active,
  priority,
  coverage_tier
)
values
${values}
on conflict (normalized_name)
do update set
  display_name_es = excluded.display_name_es,
  display_name_en = excluded.display_name_en,
  display_name_de = excluded.display_name_de,
  synonyms = excluded.synonyms,
  product_group = excluded.product_group,
  group_key = excluded.group_key,
  family_slug = excluded.family_slug,
  is_active = excluded.is_active,
  priority = excluded.priority,
  coverage_tier = excluded.coverage_tier,
  updated_at = now();
`;
}

function buildAliasRows(row, canonicalProductId) {
  const out = [];
  const seen = new Set();

  function addAlias(lang, term, priority = 70, isActive = true) {
    const alias = String(term ?? "").trim();
    if (!alias) return;
    const aliasKey = `${String(lang || "und").trim().toLowerCase()}::${alias.toLowerCase()}`;
    if (seen.has(aliasKey)) return;
    seen.add(aliasKey);
    out.push({
      canonical_product_id: canonicalProductId,
      lang: String(lang || "und").trim().toLowerCase(),
      alias,
      priority: normalizePriority(priority, 70),
      is_active: Boolean(isActive)
    });
  }

  addAlias("und", row.normalized_name, 100, true);
  addAlias("en", row.display_name_en, 90, true);
  addAlias("de", row.display_name_de, 90, true);
  addAlias("es", row.display_name_es, 90, true);

  for (const synonym of row.synonyms) {
    addAlias("und", synonym, 75, true);
  }

  for (const item of row.aliases) {
    if (typeof item === "string") {
      addAlias("und", item, 70, true);
      continue;
    }

    addAlias(
      item.lang ?? "und",
      item.alias ?? item.term ?? "",
      item.priority ?? 70,
      item.is_active ?? true
    );
  }

  return out;
}

function buildFacetRows(row, canonicalProductId) {
  const facets = new Set([row.group_key]);
  for (const item of row.facets) {
    const value = String(item ?? "").trim().toLowerCase();
    if (value) facets.add(value);
  }

  return [...facets].map((facet) => ({
    canonical_product_id: canonicalProductId,
    facet
  }));
}

function buildUseCaseRows(row, canonicalProductId) {
  const out = [];
  const seen = new Set();

  for (const item of row.use_cases) {
    const lang = typeof item === "string" ? "und" : String(item.lang ?? "und").trim().toLowerCase();
    const term = typeof item === "string" ? item : item.term ?? item.use_case_term ?? "";
    const cleanTerm = String(term ?? "").trim();
    if (!cleanTerm) continue;

    const key = `${lang}::${cleanTerm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      canonical_product_id: canonicalProductId,
      lang,
      use_case_term: cleanTerm,
      priority: normalizePriority(typeof item === "string" ? 65 : item.priority ?? 65, 65),
      is_active: typeof item === "string" ? true : Boolean(item.is_active ?? true)
    });
  }

  return out;
}

function buildAliasInsertSql(rows) {
  if (!rows.length) return null;

  const values = rows
    .map((row) => `(${[
      sqlLiteral(row.canonical_product_id),
      sqlLiteral(row.lang),
      sqlLiteral(row.alias),
      sqlLiteral(row.priority),
      sqlLiteral(row.is_active)
    ].join(",")})`)
    .join(",\n");

  return `
insert into public.canonical_product_aliases (
  canonical_product_id,
  lang,
  alias,
  priority,
  is_active
)
values
${values}
on conflict on constraint canonical_product_aliases_unique
do update set
  priority = excluded.priority,
  is_active = excluded.is_active,
  updated_at = now();
`;
}

function buildFacetInsertSql(rows) {
  if (!rows.length) return null;

  const values = rows
    .map((row) => `(${[
      sqlLiteral(row.canonical_product_id),
      sqlLiteral(row.facet)
    ].join(",")})`)
    .join(",\n");

  return `
insert into public.canonical_product_facets (
  canonical_product_id,
  facet
)
values
${values}
on conflict on constraint canonical_product_facets_unique do nothing;
`;
}

function buildUseCaseInsertSql(rows) {
  if (!rows.length) return null;

  const values = rows
    .map((row) => `(${[
      sqlLiteral(row.canonical_product_id),
      sqlLiteral(row.lang),
      sqlLiteral(row.use_case_term),
      sqlLiteral(row.priority),
      sqlLiteral(row.is_active)
    ].join(",")})`)
    .join(",\n");

  return `
insert into public.canonical_product_use_cases (
  canonical_product_id,
  lang,
  use_case_term,
  priority,
  is_active
)
values
${values}
on conflict on constraint canonical_product_use_cases_unique
do update set
  priority = excluded.priority,
  is_active = excluded.is_active,
  updated_at = now();
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 120);

  const rawRows = await readJsonFile(CATALOG_FILE);
  const rows = rawRows.map(normalizeRow);

  logInfo("Phase B - seed lean_catalog_v1", {
    sourceFile: CATALOG_FILE,
    rows: rows.length,
    batchSize
  });

  const batches = chunkArray(rows, batchSize);
  let aliasCount = 0;
  let facetCount = 0;
  let useCaseCount = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];

    await runSupabaseQuery({ sql: buildCoreUpsertSql(batch), output: "json" });

    const slugResult = await runSupabaseQuery({
      sql: `
select id, family_slug
from public.canonical_products
where family_slug = any(${sqlArray(batch.map((row) => row.family_slug))});
`,
      output: "json"
    });

    const idBySlug = new Map(
      (slugResult.parsed.rows ?? []).map((row) => [String(row.family_slug), Number(row.id)])
    );

    const aliasRows = [];
    const facetRows = [];
    const useCaseRows = [];

    for (const row of batch) {
      const canonicalProductId = idBySlug.get(row.family_slug);
      if (!canonicalProductId) continue;

      aliasRows.push(...buildAliasRows(row, canonicalProductId));
      facetRows.push(...buildFacetRows(row, canonicalProductId));
      useCaseRows.push(...buildUseCaseRows(row, canonicalProductId));
    }

    const aliasSql = buildAliasInsertSql(aliasRows);
    const facetSql = buildFacetInsertSql(facetRows);
    const useCaseSql = buildUseCaseInsertSql(useCaseRows);

    if (aliasSql) {
      await runSupabaseQuery({ sql: aliasSql, output: "json" });
      aliasCount += aliasRows.length;
    }

    if (facetSql) {
      await runSupabaseQuery({ sql: facetSql, output: "json" });
      facetCount += facetRows.length;
    }

    if (useCaseSql) {
      await runSupabaseQuery({ sql: useCaseSql, output: "json" });
      useCaseCount += useCaseRows.length;
    }

    logInfo(`Phase B batch ${i + 1}/${batches.length}`, {
      products: batch.length,
      aliases: aliasRows.length,
      facets: facetRows.length,
      useCases: useCaseRows.length
    });
  }

  const counts = await runSupabaseQuery({
    sql: `
select
  (select count(*)::int from public.canonical_products) as canonical_products,
  (select count(*)::int from public.canonical_product_aliases) as canonical_product_aliases,
  (select count(*)::int from public.canonical_product_facets) as canonical_product_facets,
  (select count(*)::int from public.canonical_product_use_cases) as canonical_product_use_cases;
`,
    output: "json"
  });

  logInfo("Phase B completed", {
    batches: batches.length,
    aliasRowsProcessed: aliasCount,
    facetRowsProcessed: facetCount,
    useCaseRowsProcessed: useCaseCount,
    totals: counts.parsed.rows?.[0] ?? null
  });
}

main().catch((error) => {
  logWarn("Phase B seed failed", String(error));
  process.exit(1);
});
