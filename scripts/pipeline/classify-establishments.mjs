import path from "node:path";
import {
  CHECKPOINT_FILE,
  DATA_DIR,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  readJsonFile,
  runSupabaseQuery,
  saveCheckpoint,
  sqlArray,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const TAXONOMY_FILE = path.join(DATA_DIR, "app-category-taxonomy.json");

const OSM_TO_CATEGORY_MAP = {
  supermarket: ["grocery", "fresh-food", "household", "drinks"],
  convenience: ["convenience", "grocery", "drinks"],
  greengrocer: ["produce", "fresh-food", "grocery"],
  bakery: ["bakery", "fresh-food", "grocery"],
  butcher: ["butcher", "fresh-food"],
  deli: ["grocery", "fresh-food"],
  organic: ["bio", "grocery", "fresh-food"],
  health_food: ["bio", "grocery"],
  chemist: ["personal-care", "household"],
  drugstore: ["beauty", "personal-care", "household"],
  beauty: ["beauty"],
  cosmetics: ["beauty"],
  perfumery: ["beauty"],
  beverages: ["drinks", "convenience"],
  kiosk: ["convenience", "drinks"],
  pharmacy: ["pharmacy", "personal-care"],
  medical_supply: ["medical-supplies", "pharmacy", "personal-care"],
  orthopaedic: ["medical-supplies", "pharmacy", "personal-care"],
  orthopedics: ["medical-supplies", "pharmacy", "personal-care"],
  antiques: ["antiques"],
  art: ["art"],
  craft: ["art"],
  stationery: ["art"],
  hardware: ["hardware", "household"],
  doityourself: ["hardware", "household"],
  household: ["household", "hardware"],
  department_store: ["grocery", "household", "personal-care", "drinks"],
  mall: ["household", "personal-care", "grocery"]
};

function keywordCategories(nameNormalized) {
  const out = new Set();

  if (/(bio|natur|organic)/.test(nameNormalized)) out.add("bio");
  if (/(apotheke|pharma)/.test(nameNormalized)) out.add("pharmacy");
  if (/(ortho|orthop|sanitatshaus|medical supply)/.test(nameNormalized)) out.add("medical-supplies");
  if (/(spati|spaeti|spatkauf|kiosk)/.test(nameNormalized)) out.add("convenience");
  if (/(back|bakery|brot|baeck)/.test(nameNormalized)) out.add("bakery");
  if (/(fleisch|metzger|butcher)/.test(nameNormalized)) out.add("butcher");
  if (/(getrank|drink|beverage)/.test(nameNormalized)) out.add("drinks");
  if (/(beauty|kosmetik|cosmetic|parfum|perfum)/.test(nameNormalized)) out.add("beauty");
  if (/(kunst|atelier|craft|bastel|papier|\bart\b)/.test(nameNormalized)) out.add("art");
  if (/(antiq|vintage)/.test(nameNormalized)) out.add("antiques");
  if (/(hardware|werkzeug|baumarkt|diy)/.test(nameNormalized)) out.add("hardware");

  return [...out];
}

function classify(row) {
  const osm = String(row.osm_category ?? "").trim();
  const normalizedName = stableNormalizeText(row.name);

  const categories = new Set(OSM_TO_CATEGORY_MAP[osm] ?? []);
  for (const extra of keywordCategories(normalizedName)) {
    categories.add(extra);
  }

  if (categories.has("pharmacy")) {
    categories.add("personal-care");
  }

  if ((categories.has("beauty") || categories.has("personal-care")) && categories.has("art")) {
    categories.delete("art");
  }

  if (!categories.size) {
    categories.add("household");
  }

  const list = [...categories].slice(0, 5);
  const confidenceBase = OSM_TO_CATEGORY_MAP[osm] ? 0.8 : 0.56;
  const confidenceBoost = Math.min(0.15, keywordCategories(normalizedName).length * 0.04);
  const confidence = Math.min(0.97, Number((confidenceBase + confidenceBoost).toFixed(4)));

  return {
    id: Number(row.id),
    app_categories: list,
    classification_confidence: confidence,
    classification_method: "pipeline_category_classifier_v1",
    classification_notes: `OSM category ${osm || "unknown"} with keyword enrichment.`
  };
}

function buildTaxonomySql(entries) {
  const values = entries
    .map((row) => {
      return `(${[
        sqlLiteral(row.slug),
        sqlLiteral(row.display_name_es),
        sqlLiteral(row.display_name_en),
        sqlLiteral(row.display_name_de),
        sqlLiteral(row.description),
        sqlLiteral(row.parent_slug),
        sqlLiteral(true)
      ].join(",")})`;
    })
    .join(",\n");

  return `
insert into app_category_taxonomy (
  slug,
  display_name_es,
  display_name_en,
  display_name_de,
  description,
  parent_slug,
  is_searchable
)
values
${values}
on conflict (slug) do update set
  display_name_es = excluded.display_name_es,
  display_name_en = excluded.display_name_en,
  display_name_de = excluded.display_name_de,
  description = excluded.description,
  parent_slug = excluded.parent_slug,
  is_searchable = excluded.is_searchable,
  updated_at = now();
`;
}

function buildUpdateSql(rows) {
  if (!rows.length) {
    return "select 0::int as updated_rows;";
  }

  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.id),
        sqlArray(row.app_categories),
        sqlLiteral(row.classification_confidence),
        sqlLiteral(row.classification_method),
        sqlLiteral(row.classification_notes)
      ].join(",")})`;
    })
    .join(",\n");

  return `
with updates(id, app_categories, confidence, method, notes) as (
  values
  ${values}
), updated as (
  update establishments e
  set
    app_categories = updates.app_categories,
    classification_confidence = updates.confidence,
    classification_method = updates.method,
    classification_notes = updates.notes,
    classification_updated_at = now(),
    updated_at = now()
  from updates
  where e.id = updates.id
    and (
      e.classification_method is null
      or e.classification_method like 'pipeline_%'
      or coalesce(cardinality(e.app_categories), 0) = 0
    )
  returning e.id
)
select count(*)::int as updated_rows from updated;
`;
}

async function fetchBatch(lastId, batchSize) {
  const sql = `
select id, name, osm_category, app_categories
from establishments
where external_source = 'osm-overpass'
  and id > ${Number(lastId)}
order by id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return res.parsed.rows ?? [];
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 300);
  const resume = Boolean(args.resume);

  const taxonomy = await readJsonFile(TAXONOMY_FILE);
  await runSupabaseQuery({ sql: buildTaxonomySql(taxonomy), output: "json" });
  logInfo("Upserted app category taxonomy", { entries: taxonomy.length });

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.classifyEstablishments ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;
  let totalUpdated = 0;
  let totalSeen = 0;

  logInfo("Phase 3 - classify establishments", {
    batchSize,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await fetchBatch(cursor, batchSize);
    if (!rows.length) {
      break;
    }

    const classified = rows.map(classify);
    const updateResult = await runSupabaseQuery({
      sql: buildUpdateSql(classified),
      output: "json"
    });

    const updatedRows = Number(updateResult.parsed.rows?.[0]?.updated_rows ?? 0);
    totalUpdated += updatedRows;
    totalSeen += rows.length;
    cursor = Number(rows[rows.length - 1].id);

    checkpoint.classifyEstablishments = {
      lastId: cursor,
      totalSeen,
      totalUpdated,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Classified batch", {
      seen: rows.length,
      updatedRows,
      cursor,
      cumulativeUpdated: totalUpdated
    });
  }

  checkpoint.classifyEstablishments = {
    lastId: cursor,
    totalSeen,
    totalUpdated,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 3 completed", {
    totalSeen,
    totalUpdated
  });
}

main().catch((error) => {
  logWarn("Classification pipeline failed", String(error));
  process.exit(1);
});
