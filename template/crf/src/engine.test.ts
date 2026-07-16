// @vitest-environment node

import demoSchemaJson from "../../data-dictionaries/crf-schema.json";
import { compileContract } from "./contract";
import {
  deriveFormState,
  evaluatePredicate,
  validateDerivedState,
} from "./engine";
import type { CrfContract, JsonRecord, Predicate } from "./types";

const demoSchema = demoSchemaJson as unknown as CrfContract;
const compiledResult = compileContract(demoSchema);
if (!compiledResult.ok) throw new Error("Golden schema must compile for engine tests.");
const compiled = compiledResult.value;

describe("evaluatePredicate", () => {
  const data = {
    age: 46,
    status: "ready",
    symptoms: ["snoring", "other"],
    nested: { present: true },
  };

  it.each<[Predicate, boolean]>([
    [{ op: "eq", path: "/status", value: "ready" }, true],
    [{ op: "neq", path: "/status", value: "closed" }, true],
    [{ op: "lt", path: "/age", value: 50 }, true],
    [{ op: "lte", path: "/age", value: 46 }, true],
    [{ op: "gt", path: "/age", value: 40 }, true],
    [{ op: "gte", path: "/age", value: 46 }, true],
    [{ op: "in", path: "/status", value: ["ready", "closed"] }, true],
    [{ op: "contains", path: "/symptoms", value: "other" }, true],
    [{ op: "exists", path: "/nested/present" }, true],
    [{ all: [{ op: "gt", path: "/age", value: 18 }, { op: "eq", path: "/status", value: "ready" }] }, true],
    [{ any: [{ op: "eq", path: "/status", value: "closed" }, { op: "eq", path: "/status", value: "ready" }] }, true],
    [{ not: { op: "eq", path: "/status", value: "closed" } }, true],
    [{ op: "eq", path: "/missing", value: "anything" }, false],
  ])("evaluates a whitelisted predicate", (predicate, expected) => {
    expect(evaluatePredicate(predicate, data)).toBe(expected);
  });
});

describe("deriveFormState", () => {
  function withComputedExpression(expression: unknown): CrfContract {
    const schema = structuredClone(demoSchema);
    schema.properties.bmi = { type: "number", readOnly: true };
    schema["x-airwayai"].fields["/bmi"] = {
      label: { "zh-TW": "BMI" },
      widget: "computed",
    };
    schema["x-airwayai"].layout[1].items.push({ type: "field", path: "/bmi" });
    schema["x-airwayai"].computed["/bmi"] = expression as never;
    return schema;
  }

  function essData(score = 1) {
    return {
      q1: score,
      q2: score,
      q3: score,
      q4: score,
      q5: score,
      q6: score,
      q7: score,
      q8: score,
    };
  }

  it("keeps a hidden value in display data but excludes it from active data", () => {
    const state = deriveFormState(demoSchema, {
      sleepStudyCompleted: false,
      ahi: 19.4,
    });

    expect(state.displayData.ahi).toBe(19.4);
    expect(state.activeData).not.toHaveProperty("ahi");
    expect(state.fieldStates["/ahi"]).toMatchObject({ visible: false, required: false });
  });

  it("omits condition-disabled values", () => {
    const schema = structuredClone(demoSchema);
    schema["x-airwayai"].fields["/notes"].enabledWhen = {
      op: "eq",
      path: "/sleepStudyCompleted",
      value: true,
    };

    const state = deriveFormState(schema, {
      sleepStudyCompleted: false,
      notes: "retained but inactive",
    });

    expect(state.displayData.notes).toBe("retained but inactive");
    expect(state.activeData).not.toHaveProperty("notes");
    expect(state.fieldStates["/notes"].enabled).toBe(false);
  });

  it("calculates ESS only when every source is valid", () => {
    const complete = deriveFormState(demoSchema, { ess: essData(2) });
    const incomplete = deriveFormState(demoSchema, { ess: { ...essData(1), q8: undefined } });

    expect(complete.activeData).toHaveProperty("ess.total", 16);
    expect(complete.derivedPaths).toEqual(["/ess/total"]);
    expect(incomplete.activeData).not.toHaveProperty("ess.total");
    expect(incomplete.derivedPaths).toEqual([]);
  });

  it("calculates nested add, subtract, multiply, and divide expressions", () => {
    const schema = withComputedExpression({
      op: "divide",
      args: [
        { op: "subtract", args: [{ op: "path", path: "/weightKg" }, { op: "value", value: 0 }] },
        {
          op: "multiply",
          args: [
            { op: "path", path: "/heightCm" },
            { op: "path", path: "/heightCm" },
            { op: "value", value: 0.0001 },
          ],
        },
      ],
    });
    schema.properties.heightCm = { type: "number" };
    schema.properties.weightKg = { type: "number" };
    schema["x-airwayai"].fields["/heightCm"] = {
      label: { "zh-TW": "身高" },
      widget: "number",
    };
    schema["x-airwayai"].fields["/weightKg"] = {
      label: { "zh-TW": "體重" },
      widget: "number",
    };
    schema["x-airwayai"].layout[1].items.push(
      { type: "field", path: "/heightCm" },
      { type: "field", path: "/weightKg" },
    );

    const state = deriveFormState(schema, { heightCm: 170, weightKg: 72 });

    expect(state.activeData).toHaveProperty("bmi", expect.closeTo(24.9135, 4));
    expect(state.derivedPaths).toEqual(["/bmi"]);
  });

  it("omits a computed value when division has a zero divisor", () => {
    const schema = withComputedExpression({
      op: "divide",
      args: [{ op: "value", value: 1 }, { op: "value", value: 0 }],
    });

    const state = deriveFormState(schema, {});

    expect(state.activeData).not.toHaveProperty("bmi");
    expect(state.derivedPaths).toEqual([]);
  });

  it("enforces requiredWhen only while its predicate is active", () => {
    const visibleState = deriveFormState(demoSchema, { sleepStudyCompleted: true });
    const hiddenState = deriveFormState(demoSchema, { sleepStudyCompleted: false });

    expect(validateDerivedState(compiled, visibleState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/ahi", code: "requiredWhen" }),
      ]),
    );
    expect(validateDerivedState(compiled, hiddenState)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/ahi" })]),
    );
  });

  it("projects a complete submission with a marked derived path", () => {
    const data: JsonRecord = {
      participantCode: "DEMO-020",
      visitDate: "2026-07-15",
      visitType: "baseline",
      age: 50,
      biologicalSex: "unknown",
      sleepStudyCompleted: false,
      ess: essData(1),
      cbctAvailable: false,
      consentConfirmed: true,
    };

    const state = deriveFormState(demoSchema, data);
    const issues = validateDerivedState(compiled, state);

    expect(issues).toEqual([]);
    expect(state.activeData).toHaveProperty("ess.total", 8);
    expect(state.derivedPaths).toEqual(["/ess/total"]);
  });
});
