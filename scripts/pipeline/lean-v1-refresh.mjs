import { spawn } from "node:child_process";
import { logInfo, logWarn, parseArgs } from "./_utils.mjs";

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

  const commonResumeArgs = resume ? ["--resume"] : [];
  const aiArgs = [
    "scripts/pipeline/generate-ai-candidates.mjs",
    ...commonResumeArgs,
    "--max-recommendations=5",
    ...(forceHeuristic ? ["--force-heuristic"] : [])
  ];
  const mergeArgs = [
    "scripts/pipeline/merge-candidates.mjs",
    ...commonResumeArgs,
    "--max-products-per-establishment=12"
  ];

  const steps = [
    ["node", ["scripts/pipeline/import-berlin.mjs", ...commonResumeArgs]],
    ["node", ["scripts/pipeline/classify-establishments.mjs", ...commonResumeArgs]],
    ["node", ["scripts/pipeline/seed-canonical-products.mjs"]],
    ["node", ["scripts/pipeline/enrich-websites.mjs", ...commonResumeArgs]],
    ["node", ["scripts/pipeline/generate-rule-candidates.mjs", ...commonResumeArgs]],
    ["node", aiArgs],
    ["node", ["scripts/pipeline/cleanup-legacy-ai-labels.mjs"]],
    ["node", ["scripts/pipeline/cleanup-category-mismatch-candidates.mjs"]],
    ["node", mergeArgs],
    ["node", ["scripts/pipeline/build-search-dataset.mjs"]],
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
    pruneKeepLatest,
    maxRecommendations: 5,
    maxProductsPerEstablishment: 12
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
