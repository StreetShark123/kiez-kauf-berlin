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

function buildUpsertSql(rows) {
  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(String(row.normalized_name).trim().toLowerCase()),
        sqlLiteral(row.display_name_es),
        sqlLiteral(row.display_name_en),
        sqlLiteral(row.display_name_de),
        sqlArray(row.synonyms ?? []),
        sqlLiteral(row.product_group)
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
  product_group
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
