import { createHash } from "node:crypto";
import {
  CHECKPOINT_FILE,
  clamp,
  loadCheckpoint,
  loadLocalEnvFiles,
  logInfo,
  logWarn,
  parseArgs,
  runSupabaseQuery,
  saveCheckpoint,
  sleep,
  sqlArray,
  sqlLiteral,
  stableNormalizeText
} from "./_utils.mjs";

const DISTRICT_SCOPE_MAP = {
  mitte: ["Mitte", "Moabit", "Wedding", "Gesundbrunnen", "Tiergarten", "Hansaviertel"],
  moabit: ["Moabit"]
};

const MODEL_PRICING_USD_PER_MILLION = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 }
};

const ROLE_ENUM = new Set([
  "sells_physical_products",
  "sells_services",
  "repair_service",
  "food_prepared",
  "food_grocery",
  "health_care",
  "beauty_personal_care",
  "specialist_retail",
  "unclear"
]);

const ROLE_RULES_BY_APP_CATEGORY = {
  grocery: ["food_grocery", "sells_physical_products"],
  convenience: ["food_grocery", "sells_physical_products"],
  "fresh-food": ["food_grocery", "sells_physical_products"],
  produce: ["food_grocery", "sells_physical_products"],
  bakery: ["food_prepared", "food_grocery"],
  butcher: ["food_grocery", "sells_physical_products"],
  drinks: ["food_grocery", "sells_physical_products"],
  pharmacy: ["health_care", "sells_physical_products"],
  "medical-supplies": ["health_care", "specialist_retail"],
  beauty: ["beauty_personal_care", "sells_services"],
  "personal-care": ["beauty_personal_care", "sells_physical_products"],
  hardware: ["specialist_retail", "sells_physical_products"],
  mall: ["sells_physical_products"],
  department_store: ["sells_physical_products"]
};

const ROLE_RULES_BY_OSM = {
  pharmacy: ["health_care", "sells_physical_products"],
  chemist: ["health_care", "sells_physical_products"],
  supermarket: ["food_grocery", "sells_physical_products"],
  convenience: ["food_grocery", "sells_physical_products"],
  kiosk: ["food_grocery", "sells_physical_products"],
  bakery: ["food_prepared", "food_grocery"],
  butcher: ["food_grocery", "sells_physical_products"],
  hairdresser: ["beauty_personal_care", "sells_services"],
  beauty: ["beauty_personal_care", "sells_services"],
  optician: ["health_care", "specialist_retail"],
  hardware: ["specialist_retail", "sells_physical_products"],
  locksmith: ["repair_service", "sells_services"],
  tailor: ["repair_service", "sells_services"],
  dry_cleaning: ["sells_services"],
  bicycle: ["specialist_retail", "repair_service"]
};

function parseBooleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveDistrictScopeNames(rawScope) {
  const scope = String(rawScope ?? "").trim().toLowerCase();
  if (!scope) return [];
  if (DISTRICT_SCOPE_MAP[scope]) return DISTRICT_SCOPE_MAP[scope];
  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePostalCodeScope(rawScope) {
  return String(rawScope ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/[^\d]/g, ""))
    .filter((item) => item.length >= 4 && item.length <= 6);
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeKeywordArray(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const normalized = stableNormalizeText(raw).slice(0, 80);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function hasStrongWebsiteSignals(establishment) {
  if (!establishment.websiteSignals) return false;
  const s = establishment.websiteSignals;
  if (typeof s.eligible_for_llm === "boolean") {
    return s.eligible_for_llm;
  }
  const strongHttp = typeof s.http_status === "number" && s.http_status >= 200 && s.http_status < 300;
  const hasStructure =
    (s.headings?.length ?? 0) >= 2 ||
    (s.visible_categories?.length ?? 0) >= 2 ||
    (s.schema_entities?.length ?? 0) >= 1;
  return strongHttp && hasStructure;
}

function resolveRuleRoles(establishment) {
  const roles = [];
  const pushRole = (value) => {
    if (!value || !ROLE_ENUM.has(value) || roles.includes(value)) return;
    roles.push(value);
  };

  for (const appCategory of establishment.app_categories) {
    for (const role of ROLE_RULES_BY_APP_CATEGORY[appCategory] ?? []) {
      pushRole(role);
    }
  }
  for (const role of ROLE_RULES_BY_OSM[establishment.osm_category] ?? []) {
    pushRole(role);
  }

  if (!roles.length) {
    pushRole("unclear");
  }
  if (roles.includes("food_grocery") || roles.includes("health_care") || roles.includes("specialist_retail")) {
    pushRole("sells_physical_products");
  }
  if (roles.includes("repair_service") || roles.includes("beauty_personal_care")) {
    pushRole("sells_services");
  }

  return roles.slice(0, 4);
}

function primaryRoleFromRoles(roles) {
  if (roles.includes("repair_service")) return "repair_service";
  if (roles.includes("health_care")) return "health_care";
  if (roles.includes("food_grocery")) return "food_grocery";
  if (roles.includes("beauty_personal_care")) return "beauty_personal_care";
  if (roles.length) return roles[0];
  return "unclear";
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING_USD_PER_MILLION[model] ?? MODEL_PRICING_USD_PER_MILLION["gpt-4.1-mini"];
  const inCost = (Number(inputTokens) / 1_000_000) * pricing.input;
  const outCost = (Number(outputTokens) / 1_000_000) * pricing.output;
  return Number((inCost + outCost).toFixed(6));
}

async function fetchDailyAiCostUsd() {
  const sql = `
select coalesce(sum(estimated_cost_usd), 0)::numeric(12,6) as daily_cost
from ai_enrichment_runs
where started_at >= date_trunc('day', now())
  and status in ('running', 'completed', 'stopped_budget');
`;

  try {
    const res = await runSupabaseQuery({ sql, output: "json" });
    return Number(res.parsed.rows?.[0]?.daily_cost ?? 0);
  } catch (error) {
    const message = String(error ?? "").toLowerCase();
    if (message.includes("does not exist") || message.includes("relation")) {
      return 0;
    }
    throw error;
  }
}

async function createAiRunRecord(payload) {
  const sql = `
insert into ai_enrichment_runs (
  status,
  district_scope,
  model,
  mode,
  max_cost_usd_per_run,
  max_cost_usd_per_day,
  max_establishments,
  max_recommendations,
  require_website_signals,
  only_ambiguous,
  force_heuristic,
  used_llm,
  checkpoint_from_id,
  notes
)
values (
  'running',
  ${sqlLiteral(payload.district_scope)},
  ${sqlLiteral(payload.model)},
  ${sqlLiteral(payload.mode)},
  ${sqlLiteral(payload.max_cost_usd_per_run)},
  ${sqlLiteral(payload.max_cost_usd_per_day)},
  ${sqlLiteral(payload.max_establishments)},
  ${sqlLiteral(payload.max_recommendations)},
  ${sqlLiteral(payload.require_website_signals)},
  ${sqlLiteral(payload.only_ambiguous)},
  ${sqlLiteral(payload.force_heuristic)},
  ${sqlLiteral(payload.used_llm)},
  ${sqlLiteral(payload.checkpoint_from_id)},
  ${sqlLiteral(payload.notes)}
)
returning id;
`;

  try {
    const res = await runSupabaseQuery({ sql, output: "json" });
    return Number(res.parsed.rows?.[0]?.id ?? 0) || null;
  } catch (error) {
    const message = String(error ?? "").toLowerCase();
    if (message.includes("does not exist") || message.includes("relation")) {
      return null;
    }
    throw error;
  }
}

async function appendAiRunItems(runId, rows) {
  if (!runId || !rows.length) return;
  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(runId),
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.district),
        sqlLiteral(row.eligible_for_llm),
        sqlLiteral(row.is_ambiguous),
        sqlLiteral(row.used_llm),
        sqlLiteral(row.llm_skipped_reason),
        sqlLiteral(row.prompt_hash),
        sqlLiteral(row.product_pool_size),
        sqlLiteral(row.website_candidates_count),
        sqlLiteral(row.llm_candidates_count),
        sqlLiteral(row.heuristic_candidates_count),
        sqlLiteral(row.selected_candidates_count),
        sqlLiteral(row.input_tokens),
        sqlLiteral(row.output_tokens),
        sqlLiteral(row.estimated_cost_usd),
        sqlLiteral(row.error_message)
      ].join(",")})`;
    })
    .join(",\n");

  const sql = `
insert into ai_enrichment_run_items (
  run_id,
  establishment_id,
  district,
  eligible_for_llm,
  is_ambiguous,
  used_llm,
  llm_skipped_reason,
  prompt_hash,
  product_pool_size,
  website_candidates_count,
  llm_candidates_count,
  heuristic_candidates_count,
  selected_candidates_count,
  input_tokens,
  output_tokens,
  estimated_cost_usd,
  error_message
)
values
${values}
on conflict (run_id, establishment_id)
do update set
  district = excluded.district,
  eligible_for_llm = excluded.eligible_for_llm,
  is_ambiguous = excluded.is_ambiguous,
  used_llm = excluded.used_llm,
  llm_skipped_reason = excluded.llm_skipped_reason,
  prompt_hash = excluded.prompt_hash,
  product_pool_size = excluded.product_pool_size,
  website_candidates_count = excluded.website_candidates_count,
  llm_candidates_count = excluded.llm_candidates_count,
  heuristic_candidates_count = excluded.heuristic_candidates_count,
  selected_candidates_count = excluded.selected_candidates_count,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  estimated_cost_usd = excluded.estimated_cost_usd,
  error_message = excluded.error_message;
`;
  await runSupabaseQuery({ sql, output: "json" });
}

async function finalizeAiRunRecord(runId, payload) {
  if (!runId) return;
  const sql = `
update ai_enrichment_runs
set
  status = ${sqlLiteral(payload.status)},
  processed_establishments = ${sqlLiteral(payload.processed_establishments)},
  eligible_establishments = ${sqlLiteral(payload.eligible_establishments)},
  ambiguous_establishments = ${sqlLiteral(payload.ambiguous_establishments)},
  llm_attempted_establishments = ${sqlLiteral(payload.llm_attempted_establishments)},
  llm_used_establishments = ${sqlLiteral(payload.llm_used_establishments)},
  website_only_establishments = ${sqlLiteral(payload.website_only_establishments)},
  heuristic_only_establishments = ${sqlLiteral(payload.heuristic_only_establishments)},
  website_extracted_candidates = ${sqlLiteral(payload.website_extracted_candidates)},
  ai_generated_candidates = ${sqlLiteral(payload.ai_generated_candidates)},
  rules_generated_candidates = ${sqlLiteral(payload.rules_generated_candidates)},
  total_upsert_rows = ${sqlLiteral(payload.total_upsert_rows)},
  affected_rows = ${sqlLiteral(payload.affected_rows)},
  errors_count = ${sqlLiteral(payload.errors_count)},
  tokens_input = ${sqlLiteral(payload.tokens_input)},
  tokens_output = ${sqlLiteral(payload.tokens_output)},
  estimated_cost_usd = ${sqlLiteral(payload.estimated_cost_usd)},
  checkpoint_to_id = ${sqlLiteral(payload.checkpoint_to_id)},
  notes = ${sqlLiteral(payload.notes)},
  completed_at = now(),
  updated_at = now()
where id = ${sqlLiteral(runId)};
`;
  await runSupabaseQuery({ sql, output: "json" });
}

async function fetchUnresolvedDemandByDistrict() {
  const sql = `
select
  lower(coalesce(nullif(btrim(district), ''), 'berlin')) as district_key,
  count(*)::int as unresolved_count
from searches
where has_results = false
  and timestamp >= now() - interval '30 day'
group by 1;
`;
  const res = await runSupabaseQuery({ sql, output: "json" });
  const out = new Map();
  for (const row of res.parsed.rows ?? []) {
    const key = stableNormalizeText(String(row.district_key ?? ""));
    if (!key) continue;
    out.set(key, Number(row.unresolved_count ?? 0));
  }
  return out;
}

function hasDistrictDemand(unresolvedDemandByDistrict, district) {
  const normalized = stableNormalizeText(district);
  if (!normalized) return false;
  return (unresolvedDemandByDistrict.get(normalized) ?? 0) >= 3;
}

function isAmbiguousEstablishment(establishment, unresolvedDemandByDistrict) {
  if (establishment.product_candidate_count >= 8) return true;
  if (establishment.service_candidate_count >= 6) return true;
  if (!establishment.websiteSignals) return true;
  if (hasDistrictDemand(unresolvedDemandByDistrict, establishment.district)) return true;
  return false;
}

async function fetchEstablishmentBatch(lastId, batchSize, districtNames = [], postalCodes = [], profileVersion = "v1") {
  const districtFilter =
    districtNames.length > 0
      ? `
  and lower(e.district) = any(array[${districtNames.map((name) => sqlLiteral(name.toLowerCase())).join(", ")}]::text[])
`
      : "";

  const postalFilter =
    postalCodes.length > 0
      ? `
  and coalesce(e.address, '') ilike any(array[${postalCodes.map((code) => sqlLiteral(`%${code}%`)).join(", ")}]::text[])
`
      : "";

  const sql = `
select
  e.id,
  e.name,
  e.address,
  e.district,
  e.osm_category,
  e.app_categories,
  e.website,
  e.freshness_score,
  w.source_url as website_source_url,
  w.http_status,
  w.page_title,
  w.meta_description,
  w.headings,
  w.visible_categories,
  w.visible_brands,
  w.schema_entities,
  w.eligible_for_llm,
  coalesce((
    select count(*)::int
    from establishment_product_merged m
    where m.establishment_id = e.id
      and m.validation_status <> 'rejected'
  ), 0) as product_candidate_count,
  coalesce((
    select count(*)::int
    from establishment_service_merged s
    where s.establishment_id = e.id
      and s.validation_status <> 'rejected'
  ), 0) as service_candidate_count,
  coalesce((
    select array_agg(x.normalized_name)
    from (
      select cp.normalized_name
      from establishment_product_merged m
      join canonical_products cp on cp.id = m.canonical_product_id
      where m.establishment_id = e.id
        and m.validation_status <> 'rejected'
      order by m.confidence desc
      limit 8
    ) x
  ), '{}'::text[]) as product_terms,
  coalesce((
    select array_agg(x.normalized_name)
    from (
      select cs.slug as normalized_name
      from establishment_service_merged s
      join canonical_services cs on cs.id = s.canonical_service_id
      where s.establishment_id = e.id
        and s.validation_status <> 'rejected'
      order by s.confidence desc
      limit 8
    ) x
  ), '{}'::text[]) as service_terms,
  p.updated_at as profile_updated_at,
  p.validation_status as profile_validation_status
from establishments e
left join establishment_website_enrichment w on w.establishment_id = e.id
left join store_capability_profiles p
  on p.establishment_id = e.id
  and p.profile_version = ${sqlLiteral(profileVersion)}
where e.external_source = 'osm-overpass'
  and e.id > ${Number(lastId)}
  and e.active_status in ('active', 'temporarily_closed')
  ${districtFilter}
  ${postalFilter}
order by e.id asc
limit ${Number(batchSize)};
`;

  const res = await runSupabaseQuery({ sql, output: "json" });
  return (res.parsed.rows ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    address: String(row.address ?? ""),
    district: String(row.district ?? "Berlin"),
    osm_category: String(row.osm_category ?? ""),
    app_categories: normalizeTextArray(row.app_categories),
    website: row.website ? String(row.website) : null,
    freshness_score: row.freshness_score == null ? null : Number(row.freshness_score),
    product_candidate_count: Number(row.product_candidate_count ?? 0),
    service_candidate_count: Number(row.service_candidate_count ?? 0),
    product_terms: normalizeKeywordArray(row.product_terms, 8),
    service_terms: normalizeKeywordArray(row.service_terms, 8),
    profile_updated_at: row.profile_updated_at ? String(row.profile_updated_at) : null,
    profile_validation_status: row.profile_validation_status ? String(row.profile_validation_status) : null,
    websiteSignals: row.website_source_url
      ? {
          source_url: String(row.website_source_url),
          http_status: row.http_status == null ? null : Number(row.http_status),
          page_title: row.page_title ? String(row.page_title) : null,
          meta_description: row.meta_description ? String(row.meta_description) : null,
          headings: normalizeTextArray(row.headings),
          visible_categories: normalizeTextArray(row.visible_categories),
          visible_brands: normalizeTextArray(row.visible_brands),
          schema_entities: Array.isArray(row.schema_entities) ? row.schema_entities : [],
          eligible_for_llm: Boolean(row.eligible_for_llm)
        }
      : null
  }));
}

function shouldSkipByStaleness(establishment, staleDays) {
  if (!establishment.profile_updated_at) return false;
  if (["validated", "rejected"].includes(establishment.profile_validation_status ?? "")) {
    return true;
  }
  const updatedAt = new Date(establishment.profile_updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return Date.now() - updatedAt < staleMs;
}

function buildPrompt(establishment) {
  const rolesHint = resolveRuleRoles(establishment);
  const websiteSnapshot = establishment.websiteSignals
    ? {
        title: establishment.websiteSignals.page_title,
        description: establishment.websiteSignals.meta_description,
        headings: establishment.websiteSignals.headings.slice(0, 6),
        visible_categories: establishment.websiteSignals.visible_categories.slice(0, 6),
        visible_brands: establishment.websiteSignals.visible_brands.slice(0, 8),
        schema_entities: establishment.websiteSignals.schema_entities
          .slice(0, 6)
          .map((entity) => ({ "@type": entity?.["@type"], name: entity?.name, category: entity?.category }))
      }
    : null;

  return [
    "Classify this Berlin establishment for local finder capability profiling.",
    "Do not invent exact stock. Infer plausibility only.",
    "Return strict JSON object with keys:",
    "store_type (string), business_roles (string[]), likely_products (string[]), likely_services (string[]), unlikely_terms (string[]), confidence (0..1), manual_review_needed (boolean), review_reason (string).",
    "Business roles must come from: sells_physical_products, sells_services, repair_service, food_prepared, food_grocery, health_care, beauty_personal_care, specialist_retail, unclear.",
    "Keep likely_products and likely_services concise (max 8 each).",
    JSON.stringify({
      name: establishment.name,
      address: establishment.address,
      district: establishment.district,
      osm_category: establishment.osm_category,
      app_categories: establishment.app_categories,
      inferred_role_hints: rolesHint,
      existing_product_terms: establishment.product_terms,
      existing_service_terms: establishment.service_terms,
      website: websiteSnapshot
    })
  ].join("\n");
}

function sanitizeProfile(parsed, establishment) {
  const ruleRoles = resolveRuleRoles(establishment);
  const llmRoles = normalizeTextArray(parsed.business_roles)
    .map((item) => stableNormalizeText(item))
    .filter((item) => ROLE_ENUM.has(item));

  const roles = [];
  for (const role of [...llmRoles, ...ruleRoles]) {
    if (!roles.includes(role) && ROLE_ENUM.has(role)) roles.push(role);
  }
  if (!roles.length) roles.push("unclear");

  const likelyProducts = normalizeKeywordArray(parsed.likely_products, 8);
  const likelyServices = normalizeKeywordArray(parsed.likely_services, 8);
  const unlikelyTerms = normalizeKeywordArray(parsed.unlikely_terms, 10);

  const confidenceRaw = Number(parsed.confidence ?? 0.6);
  const confidence = Number(clamp(confidenceRaw, 0.45, 0.92).toFixed(4));
  const manualReviewNeeded = parsed.manual_review_needed === undefined ? confidence < 0.82 : Boolean(parsed.manual_review_needed);

  return {
    store_type: String(parsed.store_type ?? primaryRoleFromRoles(roles)).slice(0, 120),
    business_roles: roles.slice(0, 4),
    likely_products: likelyProducts,
    likely_services: likelyServices,
    unlikely_terms: unlikelyTerms,
    confidence,
    manual_review_needed: manualReviewNeeded,
    review_reason: String(parsed.review_reason ?? (manualReviewNeeded ? "Needs human check." : "")).slice(0, 260)
  };
}

async function profileWithLlm(establishment, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildPrompt(establishment);
  const promptHash = createHash("sha1").update(prompt).digest("hex");
  const body = {
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You output strict JSON only for DB ingestion. No markdown."
      },
      { role: "user", content: prompt }
    ]
  };

  const maxAttempts = 4;
  let response = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000)
      });
    } catch (error) {
      const timeoutLike =
        String(error?.name ?? "").toLowerCase().includes("abort") ||
        String(error ?? "").toLowerCase().includes("timeout");
      if (attempt === maxAttempts || !timeoutLike) throw error;
      const backoffMs = 700 * 2 ** (attempt - 1) + Math.floor(Math.random() * 220);
      await sleep(backoffMs);
      continue;
    }

    if (response.ok) break;

    const status = Number(response.status);
    const isRetryable = status === 429 || status >= 500;
    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(`OpenAI API failed ${status}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 700 * 2 ** (attempt - 1) + Math.floor(Math.random() * 220);
    await sleep(backoffMs);
  }

  if (!response || !response.ok) {
    throw new Error("OpenAI API unavailable");
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include content");
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("OpenAI response was not JSON");
  }

  const parsed = JSON.parse(content.slice(start, end + 1));
  const profile = sanitizeProfile(parsed, establishment);

  const inputTokens = Number(payload.usage?.prompt_tokens ?? 0);
  const outputTokens = Number(payload.usage?.completion_tokens ?? 0);

  return {
    profile,
    promptHash,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens)
  };
}

function fallbackProfile(establishment) {
  const roles = resolveRuleRoles(establishment);
  const profile = {
    store_type: primaryRoleFromRoles(roles),
    business_roles: roles,
    likely_products: establishment.product_terms.slice(0, 6),
    likely_services: establishment.service_terms.slice(0, 6),
    unlikely_terms: [],
    confidence: 0.58,
    manual_review_needed: true,
    review_reason: "Rule-only fallback profile."
  };
  return profile;
}

function buildUpsertSql(rows, profileVersion) {
  if (!rows.length) {
    return "select 0::int as affected_rows;";
  }

  const values = rows
    .map((row) => {
      return `(${[
        sqlLiteral(row.establishment_id),
        sqlLiteral(row.source_type),
        sqlLiteral(row.extraction_method),
        sqlLiteral(row.model),
        sqlLiteral(row.prompt_hash),
        sqlLiteral(profileVersion),
        sqlLiteral(row.store_type),
        sqlArray(row.business_roles),
        sqlArray(row.likely_products),
        sqlArray(row.likely_services),
        sqlArray(row.unlikely_terms),
        sqlLiteral(row.confidence),
        sqlLiteral(row.validation_status),
        sqlLiteral(row.manual_review_needed),
        sqlLiteral(row.review_reason),
        sqlLiteral(row.source_url),
        sqlLiteral(row.input_snapshot),
        sqlLiteral(row.output_snapshot),
        `${sqlLiteral(row.last_checked_at)}::timestamptz`
      ].join(",")})`;
    })
    .join(",\n");

  return `
with incoming (
  establishment_id,
  source_type,
  extraction_method,
  model,
  prompt_hash,
  profile_version,
  store_type,
  business_roles,
  likely_products,
  likely_services,
  unlikely_terms,
  confidence,
  validation_status,
  manual_review_needed,
  review_reason,
  source_url,
  input_snapshot,
  output_snapshot,
  last_checked_at
) as (
  values
  ${values}
), upserted as (
  insert into store_capability_profiles (
    establishment_id,
    source_type,
    extraction_method,
    model,
    prompt_hash,
    profile_version,
    store_type,
    business_roles,
    likely_products,
    likely_services,
    unlikely_terms,
    confidence,
    validation_status,
    manual_review_needed,
    review_reason,
    source_url,
    input_snapshot,
    output_snapshot,
    last_checked_at
  )
  select * from incoming
  on conflict (establishment_id, profile_version)
  do update set
    source_type = excluded.source_type,
    extraction_method = excluded.extraction_method,
    model = excluded.model,
    prompt_hash = excluded.prompt_hash,
    store_type = excluded.store_type,
    business_roles = excluded.business_roles,
    likely_products = excluded.likely_products,
    likely_services = excluded.likely_services,
    unlikely_terms = excluded.unlikely_terms,
    confidence = excluded.confidence,
    validation_status = excluded.validation_status,
    manual_review_needed = excluded.manual_review_needed,
    review_reason = excluded.review_reason,
    source_url = excluded.source_url,
    input_snapshot = excluded.input_snapshot,
    output_snapshot = excluded.output_snapshot,
    last_checked_at = excluded.last_checked_at,
    updated_at = now()
  where store_capability_profiles.validation_status not in ('validated', 'rejected')
    and (
      store_capability_profiles.source_type is distinct from excluded.source_type
      or store_capability_profiles.extraction_method is distinct from excluded.extraction_method
      or store_capability_profiles.model is distinct from excluded.model
      or store_capability_profiles.prompt_hash is distinct from excluded.prompt_hash
      or store_capability_profiles.store_type is distinct from excluded.store_type
      or store_capability_profiles.business_roles is distinct from excluded.business_roles
      or store_capability_profiles.likely_products is distinct from excluded.likely_products
      or store_capability_profiles.likely_services is distinct from excluded.likely_services
      or store_capability_profiles.unlikely_terms is distinct from excluded.unlikely_terms
      or store_capability_profiles.confidence is distinct from excluded.confidence
      or store_capability_profiles.validation_status is distinct from excluded.validation_status
      or store_capability_profiles.manual_review_needed is distinct from excluded.manual_review_needed
      or store_capability_profiles.review_reason is distinct from excluded.review_reason
      or store_capability_profiles.source_url is distinct from excluded.source_url
      or store_capability_profiles.input_snapshot is distinct from excluded.input_snapshot
      or store_capability_profiles.output_snapshot is distinct from excluded.output_snapshot
      or store_capability_profiles.last_checked_at is distinct from excluded.last_checked_at
    )
  returning id
)
select count(*)::int as affected_rows from upserted;
`;
}

async function main() {
  loadLocalEnvFiles();
  const args = parseArgs(process.argv);

  const batchSize = Number(args["batch-size"] ?? 80);
  const profileVersion = String(args["profile-version"] ?? "v1");
  const resume = Boolean(args.resume);
  const forceHeuristic = Boolean(args["force-heuristic"]);
  const maxEstablishments = args["max-establishments"] ? Number(args["max-establishments"]) : null;
  const maxCostUsdPerRun = Number(args["max-cost-usd-per-run"] ?? 3);
  const maxCostUsdPerDay = Number(args["max-cost-usd-per-day"] ?? 2);
  const requireWebsiteSignals = parseBooleanArg(args["require-website-signals"], true);
  const onlyAmbiguous = parseBooleanArg(args["only-ambiguous"], true);
  const staleDays = Number(args["stale-days"] ?? 7);
  const districtScope = String(args["district-scope"] ?? "").trim();
  const districtNames = resolveDistrictScopeNames(districtScope);
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const postalCodes = resolvePostalCodeScope(postalCodeScope);
  const model = String(args.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini");

  const checkpoint = await loadCheckpoint();
  const state = checkpoint.profileStoresLlm ?? {};
  let cursor = resume ? Number(state.lastId ?? 0) : 0;

  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
  const useLlm = hasApiKey && !forceHeuristic;
  const dailyCostAtStart = await fetchDailyAiCostUsd();
  const unresolvedDemandByDistrict = await fetchUnresolvedDemandByDistrict();

  logInfo("Phase C - profile stores with LLM", {
    batchSize,
    profileVersion,
    maxEstablishments,
    maxCostUsdPerRun,
    maxCostUsdPerDay,
    requireWebsiteSignals,
    onlyAmbiguous,
    staleDays,
    districtScope: districtScope || null,
    districtNames,
    postalCodeScope: postalCodeScope || null,
    postalCodes,
    startFromId: cursor,
    checkpointFile: CHECKPOINT_FILE,
    useLlm,
    model,
    dailyCostAtStart
  });

  const runId = await createAiRunRecord({
    district_scope: districtScope || null,
    model,
    mode: useLlm ? "gpt_plus_website" : "rules_plus_website",
    max_cost_usd_per_run: maxCostUsdPerRun,
    max_cost_usd_per_day: maxCostUsdPerDay,
    max_establishments: maxEstablishments,
    max_recommendations: 1,
    require_website_signals: requireWebsiteSignals,
    only_ambiguous: onlyAmbiguous,
    force_heuristic: forceHeuristic,
    used_llm: useLlm,
    checkpoint_from_id: cursor,
    notes: [
      `pipeline=profile_stores_llm`,
      `profile_version=${profileVersion}`,
      districtScope ? `district_scope=${districtScope}` : null,
      postalCodeScope ? `postal_code_scope=${postalCodeScope}` : null
    ]
      .filter(Boolean)
      .join("; ")
  });

  let totalProcessed = 0;
  let totalAffected = 0;
  let totalUpsertRows = 0;
  let totalCostUsd = 0;
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let eligibleCount = 0;
  let ambiguousCount = 0;
  let llmAttemptedCount = 0;
  let llmUsedCount = 0;
  let websiteOnlyCount = 0;
  let heuristicOnlyCount = 0;
  let aiRowsCount = 0;
  let rulesRowsCount = 0;
  let errorsCount = 0;
  let skippedByStaleness = 0;
  let budgetStopReason = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (totalCostUsd >= maxCostUsdPerRun) {
      budgetStopReason = `Stopped by run budget cap (${maxCostUsdPerRun} USD).`;
      break;
    }
    if (dailyCostAtStart + totalCostUsd >= maxCostUsdPerDay) {
      budgetStopReason = `Stopped by daily budget cap (${maxCostUsdPerDay} USD).`;
      break;
    }

    let establishments = await fetchEstablishmentBatch(
      cursor,
      batchSize,
      districtNames,
      postalCodes,
      profileVersion
    );
    if (!establishments.length) break;

    if (maxEstablishments && totalProcessed + establishments.length > maxEstablishments) {
      const remaining = Math.max(0, maxEstablishments - totalProcessed);
      establishments = establishments.slice(0, remaining);
      if (!establishments.length) break;
    }

    const upsertRows = [];
    const runItems = [];

    for (const establishment of establishments) {
      const strongSignals = hasStrongWebsiteSignals(establishment);
      const ambiguous = isAmbiguousEstablishment(establishment, unresolvedDemandByDistrict);

      if (shouldSkipByStaleness(establishment, staleDays)) {
        skippedByStaleness += 1;
        runItems.push({
          establishment_id: establishment.id,
          district: establishment.district,
          eligible_for_llm: strongSignals,
          is_ambiguous: ambiguous,
          used_llm: false,
          llm_skipped_reason: "fresh_profile_not_stale",
          prompt_hash: null,
          product_pool_size: 0,
          website_candidates_count: 0,
          llm_candidates_count: 0,
          heuristic_candidates_count: 1,
          selected_candidates_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          error_message: null
        });
        continue;
      }

      if (strongSignals) eligibleCount += 1;
      if (ambiguous) ambiguousCount += 1;

      if (requireWebsiteSignals && !strongSignals) {
        runItems.push({
          establishment_id: establishment.id,
          district: establishment.district,
          eligible_for_llm: false,
          is_ambiguous: ambiguous,
          used_llm: false,
          llm_skipped_reason: "website_signals_not_strong",
          prompt_hash: null,
          product_pool_size: 0,
          website_candidates_count: 0,
          llm_candidates_count: 0,
          heuristic_candidates_count: 1,
          selected_candidates_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          error_message: null
        });
        continue;
      }

      if (onlyAmbiguous && !ambiguous) {
        runItems.push({
          establishment_id: establishment.id,
          district: establishment.district,
          eligible_for_llm: strongSignals,
          is_ambiguous: false,
          used_llm: false,
          llm_skipped_reason: "not_ambiguous",
          prompt_hash: null,
          product_pool_size: 0,
          website_candidates_count: 0,
          llm_candidates_count: 0,
          heuristic_candidates_count: 1,
          selected_candidates_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          error_message: null
        });
        continue;
      }

      const nowIso = new Date().toISOString();
      const inputSnapshot = {
        name: establishment.name,
        district: establishment.district,
        osm_category: establishment.osm_category,
        app_categories: establishment.app_categories,
        product_terms: establishment.product_terms,
        service_terms: establishment.service_terms,
        website_signal_strength: strongSignals
      };

      let sourceType = "rules_generated";
      let extractionMethod = "rules_store_profile_v1";
      let promptHash = null;
      let llmTokensIn = 0;
      let llmTokensOut = 0;
      let llmCostUsd = 0;
      let llmSkipReason = null;
      let llmError = null;
      let profile = fallbackProfile(establishment);

      if (useLlm) {
        if (!strongSignals) {
          llmSkipReason = "website_signals_not_strong";
        } else if (dailyCostAtStart + totalCostUsd >= maxCostUsdPerDay) {
          llmSkipReason = "daily_budget_cap_reached";
        } else if (totalCostUsd >= maxCostUsdPerRun) {
          llmSkipReason = "run_budget_cap_reached";
        } else {
          llmAttemptedCount += 1;
          try {
            const llmResult = await profileWithLlm(establishment, model);
            if (llmResult?.profile) {
              profile = llmResult.profile;
              sourceType = "ai_generated";
              extractionMethod = `openai_chat_completions_${model}`;
              promptHash = llmResult.promptHash;
              llmTokensIn = llmResult.inputTokens;
              llmTokensOut = llmResult.outputTokens;
              llmCostUsd = llmResult.estimatedCostUsd;
              totalTokensInput += llmTokensIn;
              totalTokensOutput += llmTokensOut;
              totalCostUsd = Number((totalCostUsd + llmCostUsd).toFixed(6));
              llmUsedCount += 1;
            }
          } catch (error) {
            llmError = String(error);
            errorsCount += 1;
            logWarn(`Store profile LLM failed for establishment ${establishment.id}, fallback to rules`, llmError);
          }
        }
      }

      if (sourceType === "ai_generated") {
        aiRowsCount += 1;
      } else {
        rulesRowsCount += 1;
      }

      if (sourceType === "ai_generated") {
        websiteOnlyCount += 1;
      } else {
        heuristicOnlyCount += 1;
      }

      upsertRows.push({
        establishment_id: establishment.id,
        source_type: sourceType,
        extraction_method: extractionMethod,
        model: sourceType === "ai_generated" ? model : null,
        prompt_hash: promptHash,
        store_type: profile.store_type,
        business_roles: profile.business_roles,
        likely_products: profile.likely_products,
        likely_services: profile.likely_services,
        unlikely_terms: profile.unlikely_terms,
        confidence: profile.confidence,
        validation_status: "likely",
        manual_review_needed: profile.manual_review_needed,
        review_reason: profile.review_reason,
        source_url: establishment.websiteSignals?.source_url ?? establishment.website ?? null,
        input_snapshot: inputSnapshot,
        output_snapshot: {
          ...profile,
          source_type: sourceType,
          no_real_time_stock_claim: true,
          generated_at: nowIso
        },
        last_checked_at: nowIso
      });

      runItems.push({
        establishment_id: establishment.id,
        district: establishment.district,
        eligible_for_llm: strongSignals,
        is_ambiguous: ambiguous,
        used_llm: sourceType === "ai_generated",
        llm_skipped_reason: llmSkipReason,
        prompt_hash: promptHash,
        product_pool_size: establishment.product_terms.length + establishment.service_terms.length,
        website_candidates_count: 0,
        llm_candidates_count: sourceType === "ai_generated" ? profile.likely_products.length + profile.likely_services.length : 0,
        heuristic_candidates_count: sourceType === "rules_generated" ? profile.likely_products.length + profile.likely_services.length : 0,
        selected_candidates_count: 1,
        input_tokens: llmTokensIn,
        output_tokens: llmTokensOut,
        estimated_cost_usd: llmCostUsd,
        error_message: llmError
      });
    }

    if (upsertRows.length) {
      const upsertSql = buildUpsertSql(upsertRows, profileVersion);
      const upsertResult = await runSupabaseQuery({ sql: upsertSql, output: "json" });
      const affectedRows = Number(upsertResult.parsed.rows?.[0]?.affected_rows ?? 0);
      totalAffected += affectedRows;
      totalUpsertRows += upsertRows.length;
    }

    await appendAiRunItems(runId, runItems);

    totalProcessed += establishments.length;
    cursor = establishments[establishments.length - 1].id;

    checkpoint.profileStoresLlm = {
      lastId: cursor,
      totalProcessed,
      totalAffected,
      totalUpsertRows,
      totalCostUsd,
      totalTokensInput,
      totalTokensOutput,
      llmAttemptedCount,
      llmUsedCount,
      skippedByStaleness,
      profileVersion,
      districtScope: districtScope || null,
      postalCodeScope: postalCodeScope || null,
      requireWebsiteSignals,
      onlyAmbiguous,
      updatedAt: new Date().toISOString()
    };
    await saveCheckpoint(checkpoint);

    logInfo("Store profile batch processed", {
      establishments: establishments.length,
      upsertRows: upsertRows.length,
      cursor,
      totalProcessed,
      totalAffected,
      totalCostUsd,
      llmAttemptedCount,
      llmUsedCount,
      skippedByStaleness
    });

    if (maxEstablishments && totalProcessed >= maxEstablishments) {
      logInfo("Stopping profile generation due to max-establishments cap", {
        maxEstablishments,
        totalProcessed
      });
      break;
    }
  }

  const status = budgetStopReason ? "stopped_budget" : "completed";

  checkpoint.profileStoresLlm = {
    lastId: cursor,
    totalProcessed,
    totalAffected,
    totalUpsertRows,
    totalCostUsd,
    totalTokensInput,
    totalTokensOutput,
    llmAttemptedCount,
    llmUsedCount,
    skippedByStaleness,
    profileVersion,
    districtScope: districtScope || null,
    postalCodeScope: postalCodeScope || null,
    requireWebsiteSignals,
    onlyAmbiguous,
    completed: status === "completed",
    stoppedByBudget: Boolean(budgetStopReason),
    stopReason: budgetStopReason,
    updatedAt: new Date().toISOString()
  };
  await saveCheckpoint(checkpoint);

  await finalizeAiRunRecord(runId, {
    status,
    processed_establishments: totalProcessed,
    eligible_establishments: eligibleCount,
    ambiguous_establishments: ambiguousCount,
    llm_attempted_establishments: llmAttemptedCount,
    llm_used_establishments: llmUsedCount,
    website_only_establishments: websiteOnlyCount,
    heuristic_only_establishments: heuristicOnlyCount,
    website_extracted_candidates: 0,
    ai_generated_candidates: aiRowsCount,
    rules_generated_candidates: rulesRowsCount,
    total_upsert_rows: totalUpsertRows,
    affected_rows: totalAffected,
    errors_count: errorsCount,
    tokens_input: totalTokensInput,
    tokens_output: totalTokensOutput,
    estimated_cost_usd: totalCostUsd,
    checkpoint_to_id: cursor,
    notes: budgetStopReason ?? "Store profile run completed."
  });

  logInfo("Phase C store profile completed", {
    totalProcessed,
    totalAffected,
    totalUpsertRows,
    totalCostUsd,
    totalTokensInput,
    totalTokensOutput,
    llmAttemptedCount,
    llmUsedCount,
    skippedByStaleness,
    status,
    budgetStopReason,
    model,
    useLlm
  });
}

main().catch((error) => {
  logWarn("Store profile generation failed", String(error));
  process.exit(1);
});
