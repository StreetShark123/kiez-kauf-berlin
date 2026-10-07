import { spawn } from "node:child_process";
import { parseArgs } from "./_utils.mjs";

const MITTE_SUBZONES = [
  "Mitte",
  "Moabit",
  "Wedding",
  "Gesundbrunnen",
  "Tiergarten",
  "Hansaviertel"
];

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function buildForwardArgs(args) {
  const out = [];
  const safePassThrough = [
    "batch-size",
    "limit",
    "offset",
    "resume",
    "close-candidate-grace-days",
    "batch-id",
    "snapshot-only"
  ];

  for (const key of safePassThrough) {
    const value = args[key];
    if (value === undefined) {
      continue;
    }
    if (value === true) {
      out.push(`--${key}`);
      continue;
    }
    out.push(`--${key}=${value}`);
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const forwardArgs = buildForwardArgs(args);

  for (const zone of MITTE_SUBZONES) {
    const importArgs = [
      "scripts/pipeline/import-berlin.mjs",
      `--area-name=${zone}`,
      `--force-district=${zone}`,
      "--mark-missing=false",
      ...forwardArgs
    ];

    console.log(`\n===== Importing Mitte subzone: ${zone} =====`);
    await runCommand("node", importArgs);
  }

  console.log("\nMitte subzone import completed.");
}

main().catch((error) => {
  console.error(`Mitte subzone import failed: ${String(error)}`);
  process.exit(1);
});
