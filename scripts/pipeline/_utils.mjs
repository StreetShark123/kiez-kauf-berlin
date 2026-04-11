import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, "data", "berlin");
export const CHECKPOINT_FILE = path.join(DATA_DIR, ".pipeline-state.json");

export function timestamp() {
  return new Date().toISOString();
}

export function logInfo(message, details = undefined) {
  if (details === undefined) {
    console.log(`[${timestamp()}] ${message}`);
    return;
  }
  console.log(`[${timestamp()}] ${message}`, details);
}

export function logWarn(message, details = undefined) {
  if (details === undefined) {
    console.warn(`[${timestamp()}] WARN: ${message}`);
    return;
  }
  console.warn(`[${timestamp()}] WARN: ${message}`, details);
}

export function logError(message, details = undefined) {
  if (details === undefined) {
    console.error(`[${timestamp()}] ERROR: ${message}`);
    return;
  }
  console.error(`[${timestamp()}] ERROR: ${message}`, details);
}

export async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

export function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function parseArgs(argv) {
  const args = { _: [] };

  for (const token of argv.slice(2)) {
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const body = token.slice(2);
    if (!body) {
      continue;
    }

    if (!body.includes("=")) {
      args[body] = true;
      continue;
    }

    const [key, ...rest] = body.split("=");
    args[key] = rest.join("=");
  }

  return args;
}

export async function loadCheckpoint() {
  try {
    const raw = await readFile(CHECKPOINT_FILE, "utf8");
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data == null) {
      return {};
    }
    return data;
  } catch {
    return {};
  }
}

export async function saveCheckpoint(state) {
  await ensureDataDir();
  await writeFile(CHECKPOINT_FILE, JSON.stringify(state, null, 2), "utf8");
}

function parseSupabaseJson(stdout) {
  const index = stdout.indexOf("{");
  if (index < 0) {
    return { rows: [] };
  }

  const jsonText = stdout.slice(index).trim();
  const parsed = JSON.parse(jsonText);

  if (Array.isArray(parsed)) {
    return { rows: parsed };
  }

  if (parsed && Array.isArray(parsed.rows)) {
    return parsed;
  }

  return { rows: [] };
}

export async function runSupabaseQuery({ sql, file = null, output = "json" }) {
  const args = ["db", "query", "--linked", "--output", output];

  if (file) {
    args.push("--file", file);
  } else if (sql) {
    args.push(sql);
  } else {
    throw new Error("runSupabaseQuery requires sql or file");
  }

  return await new Promise((resolve, reject) => {
    const child = spawn("supabase", args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`supabase db query failed (${code})\n${stdout}\n${stderr}`));
        return;
      }

      if (output === "json") {
        try {
          const parsed = parseSupabaseJson(stdout);
          resolve({ stdout, stderr, parsed });
        } catch (error) {
          reject(
            new Error(`Failed to parse Supabase JSON output: ${String(error)}\nRaw output:\n${stdout}`)
          );
        }
        return;
      }

      resolve({ stdout, stderr, parsed: null });
    });
  });
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "null";
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return sqlArray(value);
  }

  if (typeof value === "object") {
    const json = JSON.stringify(value).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }

  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

export function sqlArray(values) {
  const safeValues = values.map((item) => {
    const itemText = String(item ?? "").replace(/"/g, '\\"');
    return `"${itemText}"`;
  });

  return `'${`{${safeValues.join(",")}}`}'::text[]`;
}

export async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function stableNormalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
