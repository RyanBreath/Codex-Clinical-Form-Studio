import { describe, expect, it } from "vitest";
import { compileProgram, conceptIdToProperty } from "./compiler";
import { sampleProgram } from "./sample-program";

describe("program.yaml compiler", () => {
  it("compiles an approved program into contract 1.1.0 with parallel coding metadata", () => {
    const result = compileProgram(structuredClone(sampleProgram));

    expect(result.ok).toBe(true);
    expect(result.contract?.["x-airwayai"].contractVersion).toBe("1.1.0");
    expect(result.contract?.properties.biologicalSex.enum).toEqual(["F", "M", "U"]);
    expect(result.contract?.["x-airwayai"].fields["/biologicalSex"].coding).toMatchObject({
      status: "matched",
      standard: "CDISC",
      domain: "DM",
      variable: "SEX",
      codelist: { submissionValue: "SEX", ncitCode: "C66731" },
    });
    expect(result.contract?.["x-airwayai"].fields["/biologicalSex"].options?.[0].coding).toMatchObject({
      code: "C16576",
      submissionValue: "F",
    });
    expect(result.diagnostics.some((item) => item.code === "gate-b-pending")).toBe(true);
  });

  it("fails closed when Gate A or a coding decision remains unresolved", () => {
    const program = structuredClone(sampleProgram);
    program.approvals.clinical_meaning.status = "pending";
    program.selected_form.approval_status = "pending";
    program.selected_form.fields[0].coding.status = "unresolved";

    const result = compileProgram(program);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "gate-a-form-not-approved",
        "gate-a-clinical-not-approved",
        "field-coding-unresolved",
      ]),
    );
  });

  it("blocks codelists whose options have not all been explicitly coded", () => {
    const program = structuredClone(sampleProgram);
    program.selected_form.fields[1].coding.terms = program.selected_form.fields[1].coding.terms?.slice(0, 1);

    const result = compileProgram(program);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("coded-options-required");
  });

  it("normalizes snake-case concept IDs into stable flat JSON property names", () => {
    expect(conceptIdToProperty("mmse_total_score")).toBe("mmseTotalScore");
    expect(conceptIdToProperty("3d-coordinate")).toBe("field3dCoordinate");
  });
});
