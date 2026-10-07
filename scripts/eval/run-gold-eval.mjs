// Gold-suite evaluation against a running app (local or production), for either engine.
//   npm run eval:gold -- --base-url=http://127.0.0.1:3000 --engine=presence
//   npm run eval:gold -- --base-url=https://<prod> --engine=legacy
// Scoring mirrors lib/presence/eval.ts: a result is correct only if the shop is of a kind where
// the product is realistically sold (data/eval/gold-queries.v1.json).
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const args = parseArgs(process.argv);
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const engine = String(args.engine ?? "presence");
const suiteFile = String(args.suite ?? "data/eval/gold-queries.v1.json");

const suite = JSON.parse(await fs.readFile(suiteFile, "utf8"));
const priors = JSON.parse(await fs.readFile("data/presence/category-priors.v1.json", "utf8"));
const canonical = (category) => {
  const value = String(category ?? "").toLowerCase();
  return priors.category_aliases[value] ?? value;
};

function verdict(result, gold) {
  const category = canonical(result.store?.osmCategory);
  const name = ` ${normalize(result.store?.name)} `;
  const inList = (list) => (list ?? []).some((value) => canonical(value) === category);
  const nameHit = [...(gold.good_brands ?? []), ...(gold.good_name_contains ?? [])].some((needle) =>
    name.includes(` ${normalize(needle)} `)
  );
  if (nameHit || inList(gold.good_categories)) return "good";
  if (inList(gold.bad_categories)) return "bad";
  return "neutral";
}

const { lat, lng, radius_meters: radius } = suite.default_origin;
const rows = [];
for (const gold of suite.queries) {
  const params = new URLSearchParams({ q: gold.query, lat: String(lat), lng: String(lng), radius: String(radius), engine });
  let payload = null;
  try {
    const response = await fetch(`${baseUrl}/api/search?${params}`, { signal: AbortSignal.timeout(20000) });
    payload = response.ok ? await response.json() : null;
  } catch (error) {
    console.warn(`request failed for "${gold.query}": ${error}`);
  }
  const results = [...(payload?.results ?? []), ...((payload?.results ?? []).length ? [] : payload?.service_fallback ?? [])];
  const expectsNothing = gold.expect_types.length === 0 && gold.good_categories.length === 0;
  const top = results.slice(0, 3).map((result) => ({
    store: result.store?.name,
    category: result.store?.osmCategory ?? null,
    product: result.product?.displayName ?? result.product?.normalizedName,
    verdict: verdict(result, gold)
  }));
  const good = top.filter((entry) => entry.verdict === "good").length;
  rows.push({
    query: gold.query,
    persona: gold.persona,
    result_count: results.length,
    precision_at_3: expectsNothing ? (results.length === 0 ? 1 : 0) : top.length ? good / top.length : 0,
    top1_correct: expectsNothing ? results.length === 0 : top[0]?.verdict === "good",
    bad_in_top3: top.some((entry) => entry.verdict === "bad"),
    top
  });
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const summary = {
  engine,
  base_url: baseUrl,
  total: rows.length,
  precision_at_3: Number(mean(rows.map((row) => row.precision_at_3)).toFixed(4)),
  top1_accuracy: Number(mean(rows.map((row) => (row.top1_correct ? 1 : 0))).toFixed(4)),
  bad_in_top3_rate: Number(mean(rows.map((row) => (row.bad_in_top3 ? 1 : 0))).toFixed(4)),
  non_empty_rate: Number(mean(rows.map((row) => (row.result_count > 0 ? 1 : 0))).toFixed(4))
};

const outDir = "data/eval/reports";
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `gold-${engine}-${new Date().toISOString().slice(0, 10)}.json`);
await fs.writeFile(outFile, `${JSON.stringify({ generated_at: new Date().toISOString(), summary, rows }, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
for (const row of rows.filter((entry) => !entry.top1_correct || entry.bad_in_top3)) {
  console.log(`  ✗ ${row.query}: ${row.top.map((entry) => `${entry.store} (${entry.category}) ${entry.verdict}`).join(" | ") || "(no results)"}`);
}
console.log(`report: ${outFile}`);

const minPrecision = args["min-precision"] ? Number(args["min-precision"]) : null;
if (minPrecision !== null && summary.precision_at_3 < minPrecision) {
  process.exit(1);
}
