import {
  CHECKPOINT_FILE,
  clamp,
  loadCheckpoint,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sqlArray,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const AI_GROUP_WEIGHTS = {
  grocery: { groceries: 0.8, beverages: 0.66, fresh_produce: 0.64, household: 0.55, snacks: 0.52 },
  "fresh-food": { fresh_produce: 0.82, groceries: 0.58, bakery: 0.55 },
  convenience: { beverages: 0.82, snacks: 0.78, groceries: 0.6, household: 0.48 },
  bakery: { bakery: 0.89, beverages: 0.52, snacks: 0.45 },
  butcher: { meat: 0.9, groceries: 0.42 },
  produce: { fresh_produce: 0.9, groceries: 0.4 },
  drinks: { beverages: 0.93, snacks: 0.48 },
  pharmacy: { pharmacy: 0.92, personal_care: 0.79 },
  "personal-care": { personal_care: 0.88, pharmacy: 0.44 },
  household: { household: 0.9, groceries: 0.35 },
  bio: { groceries: 0.67, fresh_produce: 0.74, beverages: 0.55 }
};

async function fetchCanonicalProducts() {
  const sql = `
select id, normalized_name, product_group
from canonical_products
order by id asc;
`;
  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    normalized_name: String(row.normalized_name),
    product_group: String(row.product_group)
  }));
}

async function fetchEstablishmentBatch(lastId, batchSize) {
  const sql = `
select id, name, district, osm_category, app_categories
from establishments
where external_source = 'osm-overpass'
  and id > ${Number(lastId)}
order by id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    district: String(row.district ?? "Berlin"),
    osm_category: String(row.osm_category ?? ""),
    app_categories: Array.isArray(row.app_categories) ? row.app_categories.map(String) : []
  }));
}

function heuristicCandidates(establishment, canonicalProducts, limit) {
  const scores = new Map();
  const nameNorm = stableNormalizeText(establishment.name);

  for (const category of establishment.app_categories) {
    const weights = AI_GROUP_WEIGHTS[category] ?? null;
    if (!weights) continue;

    for (const product of canonicalProducts) {
      const groupWeight = weights[product.product_group] ?? 0;
      if (groupWeight <= 0) continue;

      const prev = scores.get(product.id) ?? {
        product,
        score: 0,
        reasonBits: []
      };

      if (groupWeight > prev.score) {
        prev.score = groupWeight;
      }
      prev.reasonBits.push(`category ${category} -> group ${product.product_group}`);
      scores.set(product.id, prev);
    }
  }

  if (!scores.size) {
    for (const product of canonicalProducts) {
      if (!["groceries", "beverages", "snacks"].includes(product.product_group)) {
        continue;
      }
      scores.set(product.id, {
        product,
        score: 0.45,
        reasonBits: ["fallback broad urban essentials"]
      });
    }
  }

  for (const entry of scores.values()) {
    const productNorm = stableNormalizeText(entry.product.normalized_name);
    const words = productNorm.split(" ").filter((w) => w.length >= 4);
    const overlap = words.some((w) => nameNorm.includes(w));
    if (overlap) {
      entry.score = clamp(entry.score + 0.08, 0, 1);
      entry.reasonBits.push("name keyword overlap");
    }

    if (establishment.osm_category === "pharmacy" && entry.product.product_group === "pharmacy") {
      entry.score = clamp(entry.score + 0.06, 0, 1);
      entry.reasonBits.push("osm pharmacy boost");
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => {
      const confidence = Number(clamp(entry.score + 0.03, 0.42, 0.93).toFixed(4));
      return {
        canonical_product_id: entry.product.id,
        confidence,
        why: `AI heuristic matched ${entry.reasonBits.slice(0, 2).join("; ")}.`,
        category_path: ["ai", "heuristic", ...(establishment.app_categories.slice(0, 1) || ["uncategorized"])]
      };
    });
}

function buildPrompt(establishment, productPool, maxRecommendations) {
  return [
    "You are ranking probable products for a Berlin local store.",
    "Do not claim stock certainty; output probable matches only.",
    `Store: ${establishment.name}`,
    `District: ${establishment.district}`,
    `OSM category: ${establishment.osm_category || "unknown"}`,
    `App categories: ${establishment.app_categories.join(", ") || "none"}`,
    `Return up to ${maxRecommendations} recommendations from this pool:`,
    JSON.stringify(productPool, null, 2),
    'Respond ONLY JSON with key "recommendations": [{"canonical_product_id": number, "confidence": number, "why": string}].'
  ].join("\n");
}

async function llmCandidates(establishment, canonicalProducts, maxRecommendations, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const pool = canonicalProducts
    .filter((product) => {
      const categorySet = new Set(establishment.app_categories);
      if (!categorySet.size) return ["groceries", "beverages", "snacks"].includes(product.product_group);

      for (const category of categorySet) {
        const weights = AI_GROUP_WEIGHTS[category] ?? {};
        if ((weights[product.product_group] ?? 0) > 0) {
          return true;
        }
      }

      return false;
    })
    .slice(0, 40)
    .map((p) => ({ id: p.id, name: p.normalized_name, group: p.product_group }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You produce compact JSON for database ingestion. Avoid markdown and keep confidence in [0,1]."
        },
        {
          role: "user",
          content: buildPrompt(establishment, pool, maxRecommendations)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include content");
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("OpenAI response was not JSON");
  }

  const parsed = JSON.parse(content.slice(start, end + 1));
  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

  return recommendations
    .filter((item) => Number.isFinite(Number(item.canonical_product_id)))
    .slice(0, maxRecommendations)
    .map((item) => {
      const confidence = Number(clamp(Number(item.confidence ?? 0.58), 0.35, 0.96).toFixed(4));
      const why = String(item.why ?? "AI model matched store profile and product group.").slice(0, 220);
      return {
        canonical_product_id: Number(item.canonical_product_id),
        confidence,
        why,
        category_path: ["ai", "llm", ...(establishment.app_categories.slice(0, 1) || ["uncategorized"])]
      };
    });
}

function buildUpsertSql(rows, generationMethod, inferredMode, modelName) {
  if (!rows.length) {
    return "select 0::int as affected_rows;";
  }

  const values = rows
    .map((row) => {
      const status = row.confidence >= 0.8 ? "likely" : "unvalidated";
      return `(${[
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.canonical_product_id),
        `'ai_generated'::source_type_enum`,
        sqlLiteral(generationMethod),
        sqlLiteral(row.confidence),
        `'${status}'::validation_status_enum`,
        sqlLiteral(null),
        sqlLiteral(row.why),
        sqlArray(row.category_path),
        sqlLiteral({
          mode: inferredMode,
          model: modelName,
          generated_at: new Date().toISOString()
        })
      ].join(",")})`;
    })
    .join(",\n");

  return `
with incoming (
  establishment_id,
  canonical_product_id,
  source_type,
  generation_method,
  confidence,
  validation_status,
  validation_notes,
  why_this_product_matches,
  category_path,
  inferred_from
) as (
  values
  ${values}
), upserted as (
  insert into establishment_product_candidates (
    establishment_id,
    canonical_product_id,
    source_type,
    generation_method,
    confidence,
    validation_status,
    validation_notes,
    why_this_product_matches,
    category_path,
    inferred_from
  )
  select * from incoming
  on conflict (establishment_id, canonical_product_id, source_type, generation_method)
  do update set
    confidence = excluded.confidence,
    validation_status = excluded.validation_status,
    validation_notes = excluded.validation_notes,
    why_this_product_matches = excluded.why_this_product_matches,
    category_path = excluded.category_path,
    inferred_from = excluded.inferred_from,
    updated_at = now()
  where establishment_product_candidates.validation_status not in ('validated', 'rejected')
  returning id
)
select count(*)::int as affected_rows from upserted;
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number(args["batch-size"] ?? 120);
  const maxRecommendations = Number(args["max-recommendations"] ?? 8);
  const resume = Boolean(args.resume);
  const forceHeuristic = Boolean(args["force-heuristic"]);
  const model = String(args.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.generateAiCandidates ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  const useLlm = hasApiKey && !forceHeuristic;
  const generationMethod = useLlm ? "openai_llm_candidate_refiner_v1" : "ai_heuristic_candidate_refiner_v1";

  const canonicalProducts = await fetchCanonicalProducts();
  logInfo("Phase 6 - generate AI candidates", {
    batchSize,
    maxRecommendations,
    useLlm,
    generationMethod,
    model,
    canonicalProducts: canonicalProducts.length,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE
  });

  let totalEstablishments = 0;
  let totalGenerated = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const establishments = await fetchEstablishmentBatch(cursor, batchSize);
    if (!establishments.length) {
      break;
    }

    const upsertRows = [];

    for (const establishment of establishments) {
      let candidates = null;
      let mode = "heuristic";

      if (useLlm) {
        try {
          candidates = await llmCandidates(establishment, canonicalProducts, maxRecommendations, model);
          mode = "llm";
        } catch (error) {
          logWarn(`LLM generation failed for establishment ${establishment.id}, fallback to heuristic`, String(error));
        }
      }

      if (!candidates || !candidates.length) {
        candidates = heuristicCandidates(establishment, canonicalProducts, maxRecommendations);
        mode = "heuristic";
      }

      const uniqueByProduct = new Map();
      for (const candidate of candidates) {
        if (!uniqueByProduct.has(candidate.canonical_product_id)) {
          uniqueByProduct.set(candidate.canonical_product_id, candidate);
        }
      }

      for (const candidate of uniqueByProduct.values()) {
        upsertRows.push({
          establishment_id: establishment.id,
          canonical_product_id: candidate.canonical_product_id,
          confidence: candidate.confidence,
          why: candidate.why,
          category_path: candidate.category_path,
          mode
        });
      }
    }

    const inferredMode = useLlm ? "llm_or_heuristic_fallback" : "heuristic";
    const upsertSql = buildUpsertSql(upsertRows, generationMethod, inferredMode, useLlm ? model : "none");
    const upsertResult = await runSupabaseQuery({ sql: upsertSql, output: "json" });
    const affectedRows = Number(upsertResult.parsed.rows?.[0]?.affected_rows ?? 0);

    totalEstablishments += establishments.length;
    totalGenerated += affectedRows;
    cursor = establishments[establishments.length - 1].id;

    checkpoint.generateAiCandidates = {
      lastId: cursor,
      generationMethod,
      mode: useLlm ? "llm" : "heuristic",
      totalEstablishments,
      totalGenerated,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Generated AI candidate batch", {
      establishments: establishments.length,
      upsertRows: upsertRows.length,
      affectedRows,
      cursor,
      cumulativeGenerated: totalGenerated
    });
  }

  checkpoint.generateAiCandidates = {
    lastId: cursor,
    generationMethod,
    mode: useLlm ? "llm" : "heuristic",
    totalEstablishments,
    totalGenerated,
    completed: true,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  logInfo("Phase 6 completed", {
    totalEstablishments,
    totalGenerated,
    generationMethod,
    mode: useLlm ? "llm" : "heuristic"
  });
}

main().catch((error) => {
  logWarn("AI candidate generation failed", String(error));
  process.exit(1);
});
