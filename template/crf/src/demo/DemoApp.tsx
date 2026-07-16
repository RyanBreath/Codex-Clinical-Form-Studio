import { useMemo, useState } from "react";
import demoSchemaJson from "@airwayai/active-crf-schema";
import { FormRenderer } from "../FormRenderer";
import {
  FormSubmissionError,
  type CrfContract,
  type Diagnostic,
  type FormSnapshot,
  type FormSubmission,
} from "../types";

const demoSchema = demoSchemaJson as unknown as CrfContract;
const isBaselineDemo = demoSchema["x-airwayai"].formId === "airwayai-baseline";

const baselineEditInitialData = {
  participantCode: "DEMO-001",
  visitDate: "2026-07-15",
  visitType: "baseline",
  symptoms: [],
  sleepStudyCompleted: false,
  ess: {},
  cbctAvailable: false,
  consentConfirmed: false,
};

const baselineReadonlyData = {
  participantCode: "DEMO-008",
  visitDate: "2026-07-15",
  visitType: "baseline",
  age: 46,
  biologicalSex: "female",
  symptoms: ["snoring", "daytime-sleepiness"],
  sleepStudyCompleted: true,
  ahi: 18.2,
  ess: {
    q1: 1,
    q2: 2,
    q3: 1,
    q4: 1,
    q5: 2,
    q6: 0,
    q7: 1,
    q8: 0,
  },
  cbctAvailable: true,
  landmarkCoordinate: { x: 12.4, y: -3.8, z: 22.1, unit: "mm" },
  notes: "此為不含 PHI 的合成唯讀紀錄。",
  consentConfirmed: true,
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function DemoApp() {
  const [mode, setMode] = useState<"edit" | "readonly">("edit");
  const [failNextSubmit, setFailNextSubmit] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<FormSubmission>();
  const [snapshot, setSnapshot] = useState<FormSnapshot>();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const editInitialData = isBaselineDemo ? baselineEditInitialData : {};
  const readonlyData = isBaselineDemo ? baselineReadonlyData : {};

  const diagnosticKeySet = useMemo(
    () => new Set(diagnostics.map((item) => `${item.code}:${item.path ?? ""}:${item.message}`)),
    [diagnostics],
  );

  const captureDiagnostic = (diagnostic: Diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.path ?? ""}:${diagnostic.message}`;
    if (diagnosticKeySet.has(key)) return;
    setDiagnostics((current) => [...current, diagnostic]);
  };

  const handleSubmit = async (submission: FormSubmission) => {
    await delay(650);
    if (failNextSubmit) {
      setFailNextSubmit(false);
      throw new FormSubmissionError("Demo Host 模擬儲存失敗；可直接再次送出。示範資料沒有遺失。");
    }
    setLastSubmission(submission);
  };

  return (
    <div className="demo-shell">
      <header className="demo-toolbar">
        <div>
          <span className="demo-kicker">Clinical Research Control Plane</span>
          <strong>JSON-Driven eCRF Renderer</strong>
        </div>
        <div className="demo-actions" aria-label="Demo 控制">
          <div className="segmented" aria-label="顯示模式">
            <button
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              填寫模式
            </button>
            <button
              type="button"
              aria-pressed={mode === "readonly"}
              onClick={() => setMode("readonly")}
            >
              唯讀模式
            </button>
          </div>
          <label className="failure-toggle">
            <input
              type="checkbox"
              checked={failNextSubmit}
              disabled={mode === "readonly"}
              onChange={(event) => setFailNextSubmit(event.target.checked)}
            />
            下次送出模擬失敗
          </label>
        </div>
      </header>

      <main className="demo-layout">
        <section className="demo-stage" aria-label="eCRF Demo">
          {mode === "edit" ? (
            <FormRenderer
              schema={demoSchema}
              initialData={editInitialData}
              locale="zh-TW"
              onChange={setSnapshot}
              onSubmit={handleSubmit}
              onDiagnostic={captureDiagnostic}
            />
          ) : (
            <FormRenderer
              schema={demoSchema}
              initialData={readonlyData}
              mode="readonly"
              locale="zh-TW"
              onDiagnostic={captureDiagnostic}
            />
          )}
        </section>

        <aside className="demo-inspector" aria-label="開發診斷資訊">
          <section>
            <div className="inspector-heading">
              <span>Active snapshot</span>
              <strong>{snapshot ? Object.keys(snapshot.data).length : 0} 個根層欄位</strong>
            </div>
            <pre>{JSON.stringify(snapshot ?? { message: "尚無變更" }, null, 2)}</pre>
          </section>

          <section>
            <div className="inspector-heading">
              <span>Last submission</span>
              <strong>{lastSubmission ? "Host 已接收" : "等待送出"}</strong>
            </div>
            <pre>{JSON.stringify(lastSubmission ?? { message: "尚未成功送出" }, null, 2)}</pre>
          </section>

          <details>
            <summary>Schema diagnostics ({diagnostics.length})</summary>
            {diagnostics.length ? (
              <ul>
                {diagnostics.map((item, index) => (
                  <li key={`${item.code}-${item.path ?? index}`}>
                    <strong>{item.severity}</strong> · {item.code}
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>目前沒有診斷訊息。</p>
            )}
          </details>
        </aside>
      </main>
    </div>
  );
}
