import { describe, expect, it, vi } from "vitest";
import { compileContract } from "../contract";
import { deriveFormState, validateDerivedState } from "../engine";
import { compileProgram } from "../studio/compiler";
import { sampleProgram } from "../studio/sample-program";
import schemaJson from "../../../data-dictionaries/platform-vitals.json";
import type { CrfContract } from "../types";

const schema = schemaJson as unknown as CrfContract;
describe("平台契約 1.2 與後端共用案例", () => {
  it("未對應欄位可作為研究草稿，保留真正的 unresolved 狀態", () => {
    const result = compileContract(schema);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(schema["x-airwayai"].fields["/weight"].coding?.status).toBe("unresolved");
  });
  it("舊契約仍不接受 unresolved 狀態", () => {
    const old = structuredClone(schema); old["x-airwayai"].contractVersion = "1.1.0";
    const result = compileContract(old); expect(result.ok).toBe(false);
  });
  it("重算 BMI，移除隱藏資料，驗證條件必填", () => {
    const result = compileContract(schema); if (!result.ok) throw new Error("契約無效");
    const state = deriveFormState(schema, { weight: 65, height: 170, bmi: 999, symptom: false, detail: "隱藏值" });
    expect(state.activeData.bmi).toBeCloseTo(22.49134948);
    expect(state.activeData.detail).toBeUndefined(); expect(validateDerivedState(result.value, state)).toEqual([]);
    const required = deriveFormState(schema, { weight: 65, height: 170, symptom: true });
    expect(validateDerivedState(result.value, required).some(i => i.path === "/detail")).toBe(true);
  });
  it("文件草稿可編輯，但不改寫 Gate A 或偽造來源核准", () => {
    const source = structuredClone(sampleProgram);
    source.approvals.clinical_meaning.status = "pending"; source.selected_form.approval_status = "pending";
    source.selected_form.fields[0].coding = { status: "unresolved" };
    expect(compileProgram(source).ok).toBe(false);
    const result = compileProgram(source, { draft: true });
    expect(result.ok).toBe(true); expect(result.contract?.["x-airwayai"].contractVersion).toBe("1.2.0");
    expect(source.approvals.clinical_meaning.status).toBe("pending");
    expect(source.selected_form.approval_status).toBe("pending");
    expect(Object.values(result.contract!["x-airwayai"].fields).some(f => f.coding?.status === "unresolved")).toBe(true);
  });
});
