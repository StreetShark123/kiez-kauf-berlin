import { spawn } from "node:child_process";
import { logInfo, logWarn, parseArgs } from "./_utils.mjs";

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const resume = Boolean(args.resume);
  const forceHeuristic = Boolean(args["force-heuristic"]);
  const pruneKeepLatest = Number(args["prune-keep-latest"] ?? 2);
  const districtScope = String(args["district-scope"] ?? "").trim();
  const postalCodeScope = String(args["postal-code-scope"] ?? "").trim();
  const requireWebsiteSignals = parseBoolean(args["require-website-signals"], true);
  const onlyAmbiguous = parseBoolean(args["only-ambiguous"], true);
  const maxCostUsdPerRun = Number(args["max-cost-usd-per-run"] ?? 3);
  const maxCostUsdPerDay = Number(args["max-cost-usd-per-day"] ?? 2);
  const maxAiEstablishments = Number(args["max-ai-establishments"] ?? 250);
  const repairCoherence = parseBoolean(args["repair-coherence"], false);
  const runBenchmarkGate = parseBoolean(args["run-benchmark-gate"], true);
  const benchmarkMinHitRate = Number(args["benchmark-min-hit-rate"] ?? 0.4);
  const benchmarkFailOnBelowThreshold = parseBoolean(
    args["benchmark-fail-on-below-threshold"],
    false
  );
  const runDemandReport = parseBoolean(args["run-demand-report"], true);
  const runCurationLearning = parseBoolean(args["run-curation-learning"], true);
  const curationWindowDays = Number(args["curation-window-days"] ?? 120);
  const curationMinSupport = Number(args["curation-min-support"] ?? 30);
  const curationMinPositive = Number(args["curation-min-positive"] ?? 18);
  const curationMinPrecision = Number(args["curation-min-precision"] ?? 0.92);
  const curationMaxApply = Number(args["curation-max-apply"] ?? 60);

  const commonResumeArgs = resume ? ["--resume"] : [];
  const aiArgs = [
    "scripts/pipeline/generate-ai-candidates.mjs",
    ...commonResumeArgs,
    "--max-recommendations=5",
    `--max-establishments=${maxAiEstablishments}`,
    `--max-cost-usd-per-run=${maxCostUsdPerRun}`,
    `--max-cost-usd-per-day=${maxCostUsdPerDay}`,
    `--require-website-signals=${requireWebsiteSignals}`,
    `--only-ambiguous=${onlyAmbiguous}`,
    ...(districtScope ? [`--district-scope=${districtScope}`] : []),
    ...(postalCodeScope ? [`--postal-code-scope=${postalCodeScope}`] : []),
    ...(forceHeuristic ? ["--force-heuristic"] : [])
  ];
  const enrichArgs = [
    "scripts/pipeline/enrich-websites.mjs",
    ...commonResumeArgs,
    ...(districtScope ? [`--district-scope=${districtScope}`] : []),
    ...(postalCodeScope ? [`--postal-code-scope=${postalCodeScope}`] : [])
  ];
  const mergeArgs = [
    "scripts/pipeline/merge-candidates.mjs",
    ...commonResumeArgs,
    "--max-products-per-establishment=8"
  ];

  const steps = [
    ["node", ["scripts/pipeline/import-berlin.mjs", ...commonResumeArgs]],
    ["node", ["scripts/pipeline/classify-establishments.mjs", ...commonResumeArgs]],
    ["node", ["scripts/pipeline/seed-canonical-products.mjs"]],
    ["node", enrichArgs],
    ["node", ["scripts/pipeline/generate-rule-candidates.mjs", ...commonResumeArgs]],
    ["node", aiArgs],
    ["node", ["scripts/pipeline/cleanup-legacy-ai-labels.mjs"]],
    ["node", ["scripts/pipeline/cleanup-category-mismatch-candidates.mjs"]],
    ["node", mergeArgs],
    ...(repairCoherence
      ? [[
          "node",
          [
            "scripts/pipeline/repair-merged-candidate-coherence.mjs",
            ...(districtScope ? [`--district-scope=${districtScope}`] : []),
            ...(postalCodeScope ? [`--postal-code-scope=${postalCodeScope}`] : [])
          ]
        ]]
      : []),
    ["node", ["scripts/pipeline/prune-nonserving-candidates.mjs"]],
    ["node", ["scripts/pipeline/build-search-dataset.mjs"]],
    ...(runDemandReport
      ? [[
          "node",
          [
            "scripts/pipeline/report-zero-results-demand.mjs",
            `--window-days=${Math.max(14, curationWindowDays)}`,
            ...(districtScope ? [`--district-scope=${districtScope}`] : [])
          ]
        ]]
      : []),
    ...(runCurationLearning
      ? [
          [
            "node",
            [
              "scripts/pipeline/generate-curation-rule-suggestions.mjs",
              `--window-days=${curationWindowDays}`,
              `--min-support=${curationMinSupport}`,
              `--min-positive=${curationMinPositive}`,
              `--min-precision=${curationMinPrecision}`
            ]
          ],
          [
            "node",
            [
              "scripts/pipeline/apply-curation-rules.mjs",
              `--window-days=${curationWindowDays}`,
              `--min-support=${curationMinSupport}`,
              `--min-positive=${curationMinPositive}`,
              `--min-precision=${curationMinPrecision}`,
              `--max-apply=${curationMaxApply}`
            ]
          ]
        ]
      : []),
    ...(runBenchmarkGate
      ? [[
          "node",
          [
            "scripts/pipeline/benchmark-persona-suite.mjs",
            "--output=r0-persona-benchmark-gated.json",
            `--min-hit-rate=${benchmarkMinHitRate}`,
            `--fail-on-below-threshold=${benchmarkFailOnBelowThreshold}`
          ]
        ]]
      : []),
    [
      "node",
      [
        "scripts/pipeline/prune-audit.mjs",
        `--keep-latest-per-candidate=${pruneKeepLatest}`
      ]
    ]
  ];

  logInfo("Running Lean v1 Berlin refresh", {
    resume,
    forceHeuristic,
    districtScope: districtScope || null,
    postalCodeScope: postalCodeScope || null,
    requireWebsiteSignals,
    onlyAmbiguous,
    maxCostUsdPerRun,
    maxCostUsdPerDay,
    maxAiEstablishments,
    repairCoherence,
    runBenchmarkGate,
    benchmarkMinHitRate,
    benchmarkFailOnBelowThreshold,
    runDemandReport,
    runCurationLearning,
    curationWindowDays,
    curationMinSupport,
    curationMinPositive,
    curationMinPrecision,
    curationMaxApply,
    pruneKeepLatest,
    maxRecommendations: 5,
    maxProductsPerEstablishment: 8
  });

  for (const [command, commandArgs] of steps) {
    logInfo(`Running step: ${command} ${commandArgs.join(" ")}`);
    // eslint-disable-next-line no-await-in-loop
    await runStep(command, commandArgs);
  }

  logInfo("Lean v1 Berlin refresh completed");
}

main().catch((error) => {
  logWarn("Lean v1 refresh failed", String(error));
  process.exit(1);
});
