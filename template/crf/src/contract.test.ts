// @vitest-environment node

import demoSchemaJson from "../../data-dictionaries/crf-schema.json";
import { compileContract } from "./contract";
import type { CrfContract } from "./types";

const demoSchema = demoSchemaJson as unknown as CrfContract;

function cloneSchema(): CrfContract {
  return structuredClone(demoSchema);
}

describe("compileContract", () => {
  it("compiles the synthetic golden contract without diagnostics", () => {
    const result = compileContract(demoSchema);

    expect(result.ok, JSON.stringify(!result.ok ? result.diagnostics : [], null, 2)).toBe(true);
    if (result.ok) expect(result.value.diagnostics).toEqual([]);
  });

  it("blocks a field path that does not exist in the data schema", () => {
    const schema = cloneSchema();
    schema["x-airwayai"].fields["/missing"] = {
      label: { "zh-TW": "不存在欄位" },
      widget: "text",
    };
    schema["x-airwayai"].layout[0].items.push({ type: "field", path: "/missing" });

    const result = compileContract(schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "dangling-field-path" })]),
      );
    }
  });

  it("accepts only contractVersion 1.0.0", () => {
    const schema = cloneSchema();
    (schema["x-airwayai"] as unknown as { contractVersion: string }).contractVersion = "2.0.0";

    const result = compileContract(schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some((item) => item.path?.includes("contractVersion"))).toBe(true);
    }
  });

  it("warns and keeps the contract usable when coordinate metadata is missing", () => {
    const schema = cloneSchema();
    delete schema["x-airwayai"].fields["/landmarkCoordinate"].coordinate;

    const result = compileContract(schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: "warning",
          code: "coordinate-metadata-fallback",
          path: "/landmarkCoordinate",
        }),
      );
    }
  });

  it("blocks computed cycles", () => {
    const schema = cloneSchema();
    (schema["x-airwayai"].computed["/ess/total"] as { args: unknown[] }).args.push({
      op: "path",
      path: "/ess/total",
    });

    const result = compileContract(schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "computed-cycle" })]),
      );
    }
  });

  it("blocks a computed expression that references a non-numeric source path", () => {
    const schema = cloneSchema();
    schema["x-airwayai"].computed["/ess/total"] = {
      op: "multiply",
      args: [{ op: "path", path: "/participantCode" }, { op: "value", value: 2 }],
    } as never;

    const result = compileContract(schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "computed-source-invalid" })]),
      );
    }
  });

  it("strictly rejects unknown data properties", () => {
    const result = compileContract(demoSchema);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const issues = result.value.validateData({ unexpected: "value" });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "additionalProperties", path: "/unexpected" }),
      ]),
    );
  });
});
