// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileContract } from "./contract";
import type { CrfContract } from "./types";

const requestedSchemaPath = process.env.AIRWAYAI_CRF_SCHEMA_PATH;
const describeTargetSchema = requestedSchemaPath ? describe : describe.skip;

describeTargetSchema("external CRF schema", () => {
  it("passes the full AirwayAI contract compiler", () => {
    const schemaPath = resolve(requestedSchemaPath!);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as CrfContract;
    const result = compileContract(schema);

    if (!result.ok) {
      throw new Error(`合約驗證失敗：\n${JSON.stringify(result.diagnostics, null, 2)}`);
    }

    for (const diagnostic of result.value.diagnostics) {
      console.warn(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
    expect(result.ok).toBe(true);
  });
});
