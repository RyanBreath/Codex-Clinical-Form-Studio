import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import demoSchemaJson from "../../data-dictionaries/crf-schema.json";
import { downloadSubmissionArtifacts } from "./downloads";
import { FormRenderer } from "./FormRenderer";
import { FormSubmissionError, type CrfContract, type FormSubmission } from "./types";

vi.mock("./downloads", () => ({
  downloadSubmissionArtifacts: vi.fn(),
}));

const demoSchema = demoSchemaJson as unknown as CrfContract;

function validData() {
  return {
    participantCode: "DEMO-101",
    visitDate: "2026-07-15",
    visitType: "baseline",
    age: 42,
    biologicalSex: "unknown",
    symptoms: ["snoring"],
    sleepStudyCompleted: true,
    ahi: 12.3,
    ess: {
      q1: 1,
      q2: 1,
      q3: 1,
      q4: 1,
      q5: 1,
      q6: 1,
      q7: 1,
      q8: 1,
    },
    cbctAvailable: false,
    notes: "合成測試",
    consentConfirmed: true,
  };
}

afterEach(() => cleanup());

describe("FormRenderer", () => {
  it("renders the golden schema and reveals conditional fields", async () => {
    const user = userEvent.setup();
    render(
      <FormRenderer
        schema={demoSchema}
        initialData={{ sleepStudyCompleted: false }}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "AirwayAI 基線評估" })).toBeInTheDocument();
    expect(screen.queryByText("呼吸中止低通氣指數（AHI）")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /是否已有睡眠檢查結果？/ }));

    expect(screen.getByText("呼吸中止低通氣指數（AHI）")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /呼吸中止低通氣指數（AHI）/ })).toBeInTheDocument();
  });

  it("submits active data, omits a newly hidden value, and marks derived paths", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(submission: FormSubmission) => Promise<void>>().mockResolvedValue();
    render(<FormRenderer schema={demoSchema} initialData={validData()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("checkbox", { name: /是否已有睡眠檢查結果？/ }));
    expect(screen.queryByText("呼吸中止低通氣指數（AHI）")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "驗證並送出" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submission = onSubmit.mock.calls[0][0];
    expect(submission.data).not.toHaveProperty("ahi");
    expect(submission.data).toHaveProperty("ess.total", 8);
    expect(submission.derivedPaths).toEqual(["/ess/total"]);
    expect(submission.coding).toEqual({ standard: "CDISC", fields: {} });
    expect(submission).toMatchObject({
      formId: "airwayai-baseline",
      schemaVersion: "1.0.0",
      contractVersion: "1.0.0",
      rendererVersion: "0.2.0",
      locale: "zh-TW",
    });
    expect(downloadSubmissionArtifacts).toHaveBeenCalledWith(demoSchema, submission);
  });

  it("posts the active snapshot when an API URL is supplied", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<FormRenderer schema={demoSchema} initialData={validData()} onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("API URL:"), "https://example.test/active");
    await user.click(screen.getByRole("button", { name: "驗證並送出" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("https://example.test/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"coding":{"standard":"CDISC"'),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.data.participantCode).toBe("DEMO-101");
    expect(body.formId).toBe("airwayai-baseline");
    vi.unstubAllGlobals();
  });

  it("shows a summary on submit and moves focus to the first invalid field", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={demoSchema} initialData={{}} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "驗證並送出" }));

    expect(screen.getByRole("heading", { name: /尚有 .* 個欄位需要處理/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /合成受試者代碼/ })).toHaveFocus(),
    );
  });

  it("preserves entered data when the Host rejects submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new FormSubmissionError("測試儲存失敗。"));
    render(<FormRenderer schema={demoSchema} initialData={validData()} onSubmit={onSubmit} />);
    const codeInput = screen.getByRole("textbox", { name: /合成受試者代碼/ });

    await user.clear(codeInput);
    await user.type(codeInput, "DEMO-102");
    await user.click(screen.getByRole("button", { name: "驗證並送出" }));

    expect(await screen.findByText("測試儲存失敗。")).toBeInTheDocument();
    expect(codeInput).toHaveValue("DEMO-102");
  });

  it("renders invalid historical values without rewriting them", () => {
    render(
      <FormRenderer
        schema={demoSchema}
        initialData={{ ...validData(), age: 99 }}
        mode="readonly"
      />,
    );

    expect(screen.getByText("歷史資料不完全符合此版本 schema")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.getByText("12.30")).toBeInTheDocument();
    expect(screen.getByText("「年齡」超過允許範圍。")).toBeInTheDocument();
  });

  it("fails closed when initial data contains an unknown field", () => {
    render(
      <FormRenderer
        schema={demoSchema}
        initialData={{ ...validData(), unknownClinicalValue: "must not pass" }}
        mode="readonly"
      />,
    );

    expect(screen.getByRole("heading", { name: "表單合約無法載入" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AirwayAI 基線評估" })).not.toBeInTheDocument();
  });

  it("renders schema text as text rather than raw HTML", () => {
    const schema = structuredClone(demoSchema);
    schema["x-airwayai"].fields["/participantCode"].label["zh-TW"] =
      '<img src=x onerror="alert(1)">';

    const { container } = render(
      <FormRenderer schema={schema} initialData={validData()} mode="readonly" />,
    );

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("has no automatically detectable axe violations in readonly mode", async () => {
    const { container } = render(
      <FormRenderer schema={demoSchema} initialData={validData()} mode="readonly" />,
    );

    const result = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
  });

  it("shows the compatible coordinate fallback and emits a diagnostic", () => {
    const schema = structuredClone(demoSchema);
    delete schema["x-airwayai"].fields["/landmarkCoordinate"].coordinate;
    const onDiagnostic = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        initialData={{ ...validData(), cbctAvailable: true }}
        onSubmit={vi.fn()}
        onDiagnostic={onDiagnostic}
      />,
    );

    expect(screen.getByText("基本輸入模式")).toBeInTheDocument();
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ code: "coordinate-metadata-fallback", severity: "warning" }),
    );
  });
});
