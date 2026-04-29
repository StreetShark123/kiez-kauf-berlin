import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizeQuery } from "@/lib/maps";

export type QueryIntentType = "product" | "service" | "category" | "problem_to_solve" | "unknown";

export type QueryResolution = {
  requestId: string;
  originalQuery: string;
  resolvedQuery: string;
  intentType: QueryIntentType;
  confidence: number;
  canonicalTerms: string[];
  alternateQueries: string[];
  mustHaveTokens: string[];
  negativeTokens: string[];
  usedLlm: boolean;
  model: string | null;
  provider: string | null;
  promptHash: string | null;
  llmLatencyMs: number | null;
  llmInputTokens: number | null;
  llmOutputTokens: number | null;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
};

type ResolveQueryArgs = {
  query: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  requestId?: string;
};

type QueryResolutionLogArgs = {
  resolution: QueryResolution;
  lat: number;
  lng: number;
  radiusMeters: number;
  resultMode: string;
  resultsCount: number;
  serviceFallbackCount: number;
  endpoint: string | null;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_QUERY_MODEL ?? "gpt-4.1-mini";
const QUERY_TIMEOUT_MS = 5000;
const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 }
};
const LOCATION_STOPWORDS = new Set([
  "berlin",
  "mitte",
  "moabit",
  "wedding",
  "gesundbrunnen",
  "tiergarten",
  "hansaviertel"
]);

const SYSTEM_PROMPT = [
  "You resolve local shopping and service search queries for Berlin.",
  "Return strict JSON only.",
  "Do not invent stock.",
  "Normalize typos and short user text.",
  "Classify intent as one of: product, service, category, problem_to_solve, unknown.",
  "Provide one resolved_query optimized for local search.",
  "Keep resolved_query concise (max 4 words) and practical.",
  "Provide arrays canonical_terms, alternate_queries, must_have_tokens, negative_tokens.",
  "If confidence is low, keep resolved_query near original query.",
  "Prefer precision over verbosity."
].join(" ");

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function normalizeTokens(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeQuery(String(value ?? "")).trim())
        .filter((value) => value.length > 0)
    )
  ).slice(0, 20);
}

function sanitizeResolvedQuery(value: string): string {
  const normalized = normalizeQuery(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !LOCATION_STOPWORDS.has(token))
    .slice(0, 4)
    .join(" ")
    .trim();
}

function isIntentType(value: unknown): value is QueryIntentType {
  return ["product", "service", "category", "problem_to_solve", "unknown"].includes(
    String(value)
  );
}

function getPromptHash(systemPrompt: string, userPrompt: string) {
  return createHash("sha256").update(`${systemPrompt}\n${userPrompt}`).digest("hex");
}

function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null || outputTokens === null) {
    return null;
  }
  const pricing = MODEL_PRICING_USD_PER_MILLION[model] ?? MODEL_PRICING_USD_PER_MILLION["gpt-4.1-mini"];
  if (!pricing) return null;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}

function fallbackResolution(query: string, requestId?: string): QueryResolution {
  return {
    requestId: requestId ?? randomUUID(),
    originalQuery: query,
    resolvedQuery: query,
    intentType: "unknown",
    confidence: 0.45,
    canonicalTerms: [],
    alternateQueries: [],
    mustHaveTokens: [],
    negativeTokens: [],
    usedLlm: false,
    model: null,
    provider: null,
    promptHash: null,
    llmLatencyMs: null,
    llmInputTokens: null,
    llmOutputTokens: null,
    estimatedCostUsd: null,
    errorMessage: null
  };
}

function parseJsonContent(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function resolveQueryWithLlm(args: ResolveQueryArgs): Promise<QueryResolution> {
  const requestId = args.requestId ?? randomUUID();
  const originalQuery = String(args.query ?? "").trim();
  const fallback = fallbackResolution(originalQuery, requestId);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !originalQuery) {
    return fallback;
  }

  const model = DEFAULT_MODEL;
  const userPrompt = JSON.stringify({
    query: originalQuery,
    location: { lat: args.lat, lng: args.lng, radius_meters: args.radiusMeters }
  });
  const promptHash = getPromptHash(SYSTEM_PROMPT, userPrompt);

  const startedAt = Date.now();
  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ...fallback,
        model,
        provider: "openai",
        promptHash,
        errorMessage: `openai_http_${response.status}:${text.slice(0, 280)}`
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonContent(content);
    if (!parsed) {
      return {
        ...fallback,
        model,
        provider: "openai",
        promptHash,
        llmLatencyMs: Date.now() - startedAt,
        errorMessage: "invalid_json_response"
      };
    }

    const resolvedQueryRaw = sanitizeResolvedQuery(String(parsed.resolved_query ?? ""));
    const resolvedQuery = resolvedQueryRaw.length > 0 ? resolvedQueryRaw : originalQuery;
    const intentType = isIntentType(parsed.intent_type) ? parsed.intent_type : "unknown";
    const confidence = clampConfidence(parsed.confidence);
    const inputTokens = Number(payload.usage?.prompt_tokens ?? 0) || 0;
    const outputTokens = Number(payload.usage?.completion_tokens ?? 0) || 0;

    return {
      requestId,
      originalQuery,
      resolvedQuery,
      intentType,
      confidence,
      canonicalTerms: normalizeTokens(parsed.canonical_terms),
      alternateQueries: normalizeTokens(parsed.alternate_queries),
      mustHaveTokens: normalizeTokens(parsed.must_have_tokens),
      negativeTokens: normalizeTokens(parsed.negative_tokens),
      usedLlm: true,
      model,
      provider: "openai",
      promptHash,
      llmLatencyMs: Date.now() - startedAt,
      llmInputTokens: inputTokens,
      llmOutputTokens: outputTokens,
      estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens),
      errorMessage: null
    };
  } catch (error) {
    return {
      ...fallback,
      model,
      provider: "openai",
      promptHash,
      llmLatencyMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message.slice(0, 280) : "unknown_llm_error"
    };
  }
}

export function chooseEffectiveQuery(resolution: QueryResolution): string {
  if (!resolution.usedLlm) {
    return resolution.originalQuery;
  }

  if (!resolution.resolvedQuery) {
    return resolution.originalQuery;
  }

  const resolved = normalizeQuery(resolution.resolvedQuery);
  const original = normalizeQuery(resolution.originalQuery);
  const isSmallRewrite = resolved.length > 0 && original.length > 0 && Math.abs(resolved.length - original.length) <= 4;
  const isActionableIntent = resolution.intentType !== "unknown";
  const hasCanonicalSupport = resolution.canonicalTerms.some((term) => normalizeQuery(term) === resolved);

  if (resolution.confidence >= 0.6) {
    return resolution.resolvedQuery;
  }

  if (resolution.confidence >= 0.45 && isSmallRewrite && (isActionableIntent || hasCanonicalSupport)) {
    return resolution.resolvedQuery;
  }

  return resolution.originalQuery;
}

export async function persistQueryResolutionLog(args: QueryResolutionLogArgs): Promise<void> {
  try {
    const supabase = getSupabaseAdminClient();
    const { resolution } = args;

    const payload = {
      request_id: resolution.requestId,
      original_query: resolution.originalQuery,
      resolved_query: resolution.resolvedQuery,
      intent_type: resolution.intentType,
      confidence: Number(resolution.confidence.toFixed(4)),
      canonical_terms: resolution.canonicalTerms,
      alternate_queries: resolution.alternateQueries,
      must_have_tokens: resolution.mustHaveTokens,
      negative_tokens: resolution.negativeTokens,
      model: resolution.model,
      provider: resolution.provider,
      prompt_hash: resolution.promptHash,
      used_llm: resolution.usedLlm,
      llm_latency_ms: resolution.llmLatencyMs,
      llm_input_tokens: resolution.llmInputTokens,
      llm_output_tokens: resolution.llmOutputTokens,
      estimated_cost_usd: resolution.estimatedCostUsd,
      error_message: resolution.errorMessage,
      query_lat: args.lat,
      query_lng: args.lng,
      radius_meters: args.radiusMeters,
      result_mode: args.resultMode,
      results_count: args.resultsCount,
      service_fallback_count: args.serviceFallbackCount,
      endpoint: args.endpoint
    };

    const { error } = await supabase
      .from("query_resolution_log")
      .upsert(payload, { onConflict: "request_id" });

    if (error) {
      throw new Error(error.message);
    }
  } catch {
    // runtime analytics must never break search path
  }
}
