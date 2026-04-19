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

const PRODUCTS_FILE = path.join(DATA_DIR, "canonical-products.seed.json");

function toFamilySlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildUpsertSql(rows) {
  const values = rows
    .map((row) => {
      const normalizedName = String(row.normalized_name).trim().toLowerCase();
      const groupKey = String(row.group_key ?? row.product_group ?? "uncategorized")
        .trim()
        .toLowerCase();
      const familySlug =
        toFamilySlug(row.family_slug ?? normalizedName) || toFamilySlug(`product-${normalizedName}`);
      const coverageTier = String(row.coverage_tier ?? "core")
        .trim()
        .toLowerCase();
      const rawPriority = Number.isFinite(Number(row.priority)) ? Number(row.priority) : 50;
      const priority = Math.max(0, Math.min(100, Math.round(rawPriority)));
      const isActive = typeof row.is_active === "boolean" ? row.is_active : true;

      return `(${[
        sqlLiteral(normalizedName),
        sqlLiteral(row.display_name_es),
        sqlLiteral(row.display_name_en),
        sqlLiteral(row.display_name_de),
        sqlArray(row.synonyms ?? []),
        sqlLiteral(groupKey),
        sqlLiteral(groupKey),
        sqlLiteral(familySlug),
        sqlLiteral(isActive),
        sqlLiteral(priority),
        sqlLiteral(coverageTier)
      ].join(",")})`;
    })
    .join(",\n");

  return `
insert into canonical_products (
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

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 200);
  const products = await readJsonFile(PRODUCTS_FILE);

  logInfo("Phase 4 - seed canonical products", {
    sourceFile: PRODUCTS_FILE,
    products: products.length,
    batchSize
  });

  const batches = chunkArray(products, batchSize);
  let total = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const sql = buildUpsertSql(batches[i]);
    await runSupabaseQuery({ sql, output: "json" });

    total += batches[i].length;
    logInfo(`Seeded canonical products batch ${i + 1}/${batches.length}`, {
      rows: batches[i].length,
      cumulative: total
    });
  }

  const countResult = await runSupabaseQuery({
    sql: "select count(*)::int as total_products from canonical_products;",
    output: "json"
  });

  const totalProducts = Number(countResult.parsed.rows?.[0]?.total_products ?? 0);
  logInfo("Phase 4 completed", {
    seededRows: total,
    totalProducts
  });
}

main().catch((error) => {
  logWarn("Canonical product seed failed", String(error));
  process.exit(1);
});
