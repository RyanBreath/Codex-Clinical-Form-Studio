import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const requestedPath = getArgument("--schema");
if (!requestedPath) {
  console.error("用法：npm run validate:schema -- --schema <crf-schema.json>");
  process.exit(2);
}

const schemaPath = resolve(requestedPath);
if (!existsSync(schemaPath)) {
  console.error(`找不到 schema：${schemaPath}`);
  process.exit(2);
}

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  console.error("找不到 npm_execpath；請透過 npm run validate:schema 執行此工具。");
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  [npmCliPath, "exec", "--", "vitest", "run", "src/schema-file.test.ts", "--reporter=verbose"],
  {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, AIRWAYAI_CRF_SCHEMA_PATH: schemaPath },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
