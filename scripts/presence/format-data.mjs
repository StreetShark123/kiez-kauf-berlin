// Keeps data/presence/*.json and data/eval/*.json readable in diffs: one entry per line.
import fs from "node:fs";

const files = {
  "data/presence/product-types.v1.json": ["types", "modifiers"],
  "data/presence/category-priors.v1.json": ["brands"],
  "data/eval/gold-queries.v1.json": ["queries"]
};

for (const [file, listKeys] of Object.entries(files)) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const lines = ["{"];
  const entries = Object.entries(data);
  entries.forEach(([key, value], index) => {
    const comma = index < entries.length - 1 ? "," : "";
    if (listKeys.includes(key) && Array.isArray(value)) {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((item, itemIndex) => {
        lines.push(`    ${JSON.stringify(item)}${itemIndex < value.length - 1 ? "," : ""}`);
      });
      lines.push(`  ]${comma}`);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      lines.push(`  ${JSON.stringify(key)}: {`);
      const inner = Object.entries(value);
      inner.forEach(([innerKey, innerValue], innerIndex) => {
        lines.push(`    ${JSON.stringify(innerKey)}: ${JSON.stringify(innerValue)}${innerIndex < inner.length - 1 ? "," : ""}`);
      });
      lines.push(`  }${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push("}");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(`formatted ${file}`);
}
