import { spawn } from "node:child_process";
import { loadLocalEnvFiles, logInfo, logWarn, parseArgs } from "./_utils.mjs";

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
  loadLocalEnvFiles();
  const args = parseArgs(process.argv);
  const resume = Boolean(args.resume);
  const districtScope = String(args["district-scope"] ?? "moabit").trim() || "moabit";
  const postalCodeScope = String(args["postal-code-scope"] ?? "10553").trim() || "10553";
  const batchSize = Number(args["batch-size"] ?? 250);
  const maxAiEstablishments = Number(args["max-establishments"] ?? 250);
  const maxCostUsdPerRun = Number(args["max-cost-usd-per-run"] ?? 1.2);
  const maxCostUsdPerDay = Number(args["max-cost-usd-per-day"] ?? 2);
  const maxRecommendations = Number(args["max-recommendations"] ?? 5);
  const requireWebsiteSignals = parseBoolean(args["require-website-signals"], true);
  const onlyAmbiguous = parseBoolean(args["only-ambiguous"], true);
  const pruneKeepLatest = Number(args["prune-keep-latest"] ?? 2);
  const runBenchmarkGate = parseBoolean(args["run-benchmark-gate"], true);
  const benchmarkMinHitRate = Number(args["benchmark-min-hit-rate"] ?? 0.42);
  const benchmarkFailOnBelowThreshold = parseBoolean(
    args["benchmark-fail-on-below-threshold"],
    true
  );
  const runDemandReport = parseBoolean(args["run-demand-report"], true);
  const runCurationLearning = parseBoolean(args["run-curation-learning"], true);
  const curationWindowDays = Number(args["curation-window-days"] ?? 120);
  const curationMinSupport = Number(args["curation-min-support"] ?? 30);
  const curationMinPositive = Number(args["curation-min-positive"] ?? 18);
  const curationMinPrecision = Number(args["curation-min-precision"] ?? 0.92);
  const curationMaxApply = Number(args["curation-max-apply"] ?? 40);

  const commonScopeArgs = [
    `--district-scope=${districtScope}`,
    `--postal-code-scope=${postalCodeScope}`,
    `--batch-size=${batchSize}`
  ];
  const resumeArgs = resume ? ["--resume"] : [];

  const steps = [
    ["node", ["scripts/pipeline/classify-store-roles.mjs", ...commonScopeArgs, ...resumeArgs]],
    ["node", ["scripts/pipeline/generate-rule-candidates.mjs", ...commonScopeArgs, ...resumeArgs]],
    [
      "node",
      [
        "scripts/pipeline/generate-rule-service-candidates.mjs",
        ...commonScopeArgs,
        ...resumeArgs,
        "--max-services-per-store=8"
      ]
    ],
    ["node", ["scripts/pipeline/enrich-websites.mjs", ...commonScopeArgs, ...resumeArgs]],
    [
      "node",
      [
        "scripts/pipeline/generate-ai-candidates.mjs",
        ...commonScopeArgs,
        ...resumeArgs,
        "--model=gpt-4.1-mini",
        `--max-recommendations=${maxRecommendations}`,
        `--max-establishments=${maxAiEstablishments}`,
        `--max-cost-usd-per-run=${maxCostUsdPerRun}`,
        `--max-cost-usd-per-day=${maxCostUsdPerDay}`,
        `--require-website-signals=${requireWebsiteSignals}`,
        `--only-ambiguous=${onlyAmbiguous}`
      ]
    ],
    [
      "node",
      [
        "scripts/pipeline/profile-stores-llm.mjs",
        ...commonScopeArgs,
        ...resumeArgs,
        "--model=gpt-4.1-mini",
        `--max-establishments=${maxAiEstablishments}`,
        `--max-cost-usd-per-run=${maxCostUsdPerRun}`,
        `--max-cost-usd-per-day=${maxCostUsdPerDay}`,
        `--require-website-signals=${requireWebsiteSignals}`,
        `--only-ambiguous=${onlyAmbiguous}`,
        "--profile-version=v1"
      ]
    ],
    [
      "node",
      [
        "scripts/pipeline/merge-candidates.mjs",
        ...commonScopeArgs,
        ...resumeArgs,
        "--max-products-per-establishment=8"
      ]
    ],
    ["node", ["scripts/pipeline/merge-service-candidates.mjs", ...commonScopeArgs, ...resumeArgs]],
    ["node", ["scripts/pipeline/build-search-dataset.mjs"]],
    ["node", ["scripts/pipeline/prune-audit.mjs", `--keep-latest-per-candidate=${pruneKeepLatest}`]],
    [
      "node",
      [
        "scripts/pipeline/prune-nonserving-candidates.mjs",
        ...commonScopeArgs,
        "--keep-latest-per-establishment=2"
      ]
    ],
    ...(runDemandReport
      ? [[
          "node",
          [
            "scripts/pipeline/report-zero-results-demand.mjs",
            `--window-days=${Math.max(7, curationWindowDays)}`,
            `--district-scope=${districtScope}`
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
      : [])
  ];

  logInfo("Moabit 10553 progressive curation run started", {
    districtScope,
    postalCodeScope,
    batchSize,
    maxAiEstablishments,
    maxRecommendations,
    maxCostUsdPerRun,
    maxCostUsdPerDay,
    requireWebsiteSignals,
    onlyAmbiguous,
    pruneKeepLatest,
    resume,
    runBenchmarkGate,
    benchmarkMinHitRate,
    benchmarkFailOnBelowThreshold,
    runDemandReport,
    runCurationLearning,
    curationWindowDays,
    curationMinSupport,
    curationMinPositive,
    curationMinPrecision,
    curationMaxApply
  });

  for (const [command, commandArgs] of steps) {
    logInfo(`Running step: ${command} ${commandArgs.join(" ")}`);
    // eslint-disable-next-line no-await-in-loop
    await runStep(command, commandArgs);
  }

  logInfo("Moabit 10553 progressive curation run completed");
}

main().catch((error) => {
  logWarn("Moabit 10553 progressive curation run failed", String(error));
  process.exit(1);
});
