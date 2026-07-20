import { useEffect, useMemo, useRef, useState } from "react";
import { parse } from "yaml";
import { FormRenderer } from "../FormRenderer";
import type { FormSubmission } from "../types";
import { compileProgram, type StudioDiagnostic } from "./compiler";
import { downloadBundle, downloadText, programToYaml } from "./export-bundle";
import type {
  ApprovalStatus,
  CdiscCandidate,
  CodingStatus,
  FieldDataType,
  ProgramField,
  ProgramOption,
  ProgramYaml,
} from "./model";
import { sampleProgram } from "./sample-program";

const storageKey = "airwayai-ecrf-studio-program-v1";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function initialProgram(): ProgramYaml {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as ProgramYaml) : clone(sampleProgram);
  } catch {
    return clone(sampleProgram);
  }
}

function newField(index: number): ProgramField {
  return {
    concept_id: `new_field_${index + 1}`,
    label: `新欄位 ${index + 1}`,
    purpose: "",
    data_type: "string",
    required: "unresolved",
    unit: null,
    range: { minimum: null, maximum: null },
    options: [],
    source_refs: [{ locator: "", confidence: "medium" }],
    notes: [],
    inference: { kind: "protocol_explicit", rationale: null, confidence_percent: 100 },
    coding: { status: "unresolved", rationale: null },
  };
}

function formatOptions(options: ProgramField["options"]): string {
  return options
    .map((option) =>
      typeof option === "object" ? `${option.value} | ${option.label}` : String(option),
    )
    .join("\n");
}

function parseOptions(value: string): ProgramField["options"] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [optionValue, ...labelParts] = line.split("|").map((part) => part.trim());
      return labelParts.length
        ? ({ value: optionValue, label: labelParts.join(" | ") } satisfies ProgramOption)
        : optionValue;
    });
}

function statusLabel(status: CodingStatus): string {
  if (status === "matched") return "已對應";
  if (status === "not-applicable") return "不適用";
  return "待確認";
}

interface CandidateResponse {
  results: CdiscCandidate[];
  version: string;
  sourceUrl: string;
  message?: string;
}

function FieldEditor({
  field,
  onChange,
  onDelete,
  onSearch,
  searchText,
  onSearchText,
  searching,
  candidates,
  onAdopt,
}: {
  field: ProgramField;
  onChange: (field: ProgramField) => void;
  onDelete: () => void;
  onSearch: () => void;
  searchText: string;
  onSearchText: (value: string) => void;
  searching: boolean;
  candidates: CdiscCandidate[];
  onAdopt: (candidate: CdiscCandidate) => void;
}) {
  const update = <K extends keyof ProgramField>(key: K, value: ProgramField[K]) =>
    onChange({ ...field, [key]: value });
  const updateCoding = (patch: Partial<ProgramField["coding"]>) =>
    onChange({ ...field, coding: { ...field.coding, ...patch } });
  const sourceRef = field.source_refs[0] ?? { locator: "", confidence: "medium" as const };

  return (
    <div className="editor-stack">
      <section className="editor-section" aria-labelledby="field-basic-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Field definition</span>
            <h2 id="field-basic-heading">欄位資訊</h2>
          </div>
          <button type="button" className="danger-ghost" onClick={onDelete}>
            刪除欄位
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>Concept ID</span>
            <input
              value={field.concept_id}
              onChange={(event) => update("concept_id", event.target.value)}
              spellCheck={false}
            />
            <small>使用 snake_case；會轉成 JSON field path。</small>
          </label>
          <label>
            <span>顯示名稱</span>
            <input value={field.label} onChange={(event) => update("label", event.target.value)} />
          </label>
          <label className="span-2">
            <span>欄位目的／臨床意義</span>
            <textarea
              value={field.purpose ?? ""}
              onChange={(event) => update("purpose", event.target.value)}
              rows={2}
            />
          </label>
          <label>
            <span>資料型別</span>
            <select
              value={field.data_type}
              onChange={(event) => update("data_type", event.target.value as FieldDataType)}
            >
              <option value="string">文字 string</option>
              <option value="integer">整數 integer</option>
              <option value="number">數值 number</option>
              <option value="boolean">是／否 boolean</option>
              <option value="date">日期 date</option>
              <option value="unresolved">待確認 unresolved</option>
            </select>
          </label>
          <label>
            <span>必填性</span>
            <select
              value={String(field.required)}
              onChange={(event) =>
                update(
                  "required",
                  event.target.value === "true"
                    ? true
                    : event.target.value === "false"
                      ? false
                      : "unresolved",
                )
              }
            >
              <option value="true">必填</option>
              <option value="false">選填</option>
              <option value="unresolved">待確認</option>
            </select>
          </label>
          <label>
            <span>單位</span>
            <input
              value={field.unit ?? ""}
              onChange={(event) => update("unit", event.target.value || null)}
              placeholder="例如 years、{events}/h"
            />
          </label>
          <div className="range-fields">
            <label>
              <span>最小值</span>
              <input
                type="number"
                value={field.range?.minimum ?? ""}
                onChange={(event) =>
                  update("range", {
                    ...field.range,
                    minimum: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>最大值</span>
              <input
                type="number"
                value={field.range?.maximum ?? ""}
                onChange={(event) =>
                  update("range", {
                    ...field.range,
                    maximum: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="span-2">
            <span>選項</span>
            <textarea
              value={formatOptions(field.options)}
              onChange={(event) => update("options", parseOptions(event.target.value))}
              rows={4}
              placeholder={"每行一個：F | 女\nM | 男"}
            />
            <small>左側是 submission value，右側是顯示文字；無選項可留白。</small>
          </label>
        </div>
      </section>

      <section className="editor-section" aria-labelledby="trace-heading">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Traceability</span>
            <h2 id="trace-heading">來源與推論</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="span-2">
            <span>Protocol 定位</span>
            <input
              value={sourceRef.locator}
              onChange={(event) =>
                update("source_refs", [{ ...sourceRef, locator: event.target.value }])
              }
              placeholder="Section 8.2, page 42, Table 6 row AHI"
            />
          </label>
          <label>
            <span>來源信心</span>
            <select
              value={sourceRef.confidence}
              onChange={(event) =>
                update("source_refs", [
                  {
                    ...sourceRef,
                    confidence: event.target.value as "high" | "medium" | "low",
                  },
                ])
              }
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span>概念來源</span>
            <select
              value={field.inference?.kind ?? "protocol_explicit"}
              onChange={(event) =>
                update("inference", {
                  kind: event.target.value as "protocol_explicit" | "inferred_supporting_field",
                  rationale: field.inference?.rationale ?? null,
                  confidence_percent: field.inference?.confidence_percent ?? 100,
                })
              }
            >
              <option value="protocol_explicit">Protocol 明示</option>
              <option value="inferred_supporting_field">推論輔助欄位</option>
            </select>
          </label>
          {field.inference?.kind === "inferred_supporting_field" && (
            <>
              <label className="span-2">
                <span>推論理由</span>
                <textarea
                  rows={2}
                  value={field.inference.rationale ?? ""}
                  onChange={(event) =>
                    update("inference", { ...field.inference!, rationale: event.target.value })
                  }
                />
              </label>
              <label>
                <span>推論信心（%）</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={field.inference.confidence_percent}
                  onChange={(event) =>
                    update("inference", {
                      ...field.inference!,
                      confidence_percent: Number(event.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      </section>

      <section className="editor-section coding-section" aria-labelledby="coding-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Review-gated mapping</span>
            <h2 id="coding-heading">CDISC 編碼</h2>
          </div>
        </div>
        <div className="mapping-note">
          搜尋結果來自官方 NCI‑EVS SDTM Controlled Terminology，只是候選；需由使用者確認後才寫回 YAML。
        </div>
        <div className="terminology-search">
          <label>
            <span>CDISC 搜尋字詞</span>
            <input
              value={searchText}
              onChange={(event) => onSearchText(event.target.value)}
              placeholder="例如 age unit、MMSE total score"
            />
          </label>
          <button type="button" className="primary" onClick={onSearch} disabled={searching || searchText.trim().length < 2}>
            {searching ? "正在讀取官方術語…" : "取得可能編碼"}
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>對應狀態</span>
            <select
              value={field.coding.status}
              onChange={(event) => updateCoding({ status: event.target.value as CodingStatus })}
            >
              <option value="unresolved">待確認 unresolved</option>
              <option value="matched">已確認 matched</option>
              <option value="not-applicable">不適用 not-applicable</option>
            </select>
          </label>
          <label>
            <span>Mapping 信心（%）</span>
            <input
              type="number"
              min={0}
              max={100}
              value={field.coding.mapping_confidence_percent ?? ""}
              onChange={(event) =>
                updateCoding({
                  mapping_confidence_percent:
                    event.target.value === "" ? undefined : Number(event.target.value),
                })
              }
            />
          </label>
          {field.coding.status === "not-applicable" ? (
            <label className="span-2">
              <span>不適用理由</span>
              <textarea
                rows={2}
                value={field.coding.rationale ?? ""}
                onChange={(event) => updateCoding({ rationale: event.target.value })}
              />
            </label>
          ) : (
            <>
              <label>
                <span>Model</span>
                <input
                  value={field.coding.model ?? ""}
                  onChange={(event) => updateCoding({ model: event.target.value })}
                  placeholder="SDTM"
                />
              </label>
              <label>
                <span>Implementation Guide</span>
                <input
                  value={field.coding.implementation_guide ?? ""}
                  onChange={(event) => updateCoding({ implementation_guide: event.target.value })}
                  placeholder="SDTMIG v3.4"
                />
              </label>
              <label>
                <span>Domain</span>
                <input
                  value={field.coding.domain ?? ""}
                  onChange={(event) => updateCoding({ domain: event.target.value.toUpperCase() })}
                  placeholder="DM"
                />
              </label>
              <label>
                <span>Variable</span>
                <input
                  value={field.coding.variable ?? ""}
                  onChange={(event) => updateCoding({ variable: event.target.value.toUpperCase() })}
                  placeholder="AGE"
                />
              </label>
              <label>
                <span>Terminology version</span>
                <input
                  value={field.coding.version ?? ""}
                  onChange={(event) => updateCoding({ version: event.target.value })}
                  placeholder="2026-03-27"
                />
              </label>
              <label>
                <span>Source URL</span>
                <input
                  type="url"
                  value={field.coding.source_url ?? ""}
                  onChange={(event) => updateCoding({ source_url: event.target.value })}
                  placeholder="https://…"
                />
              </label>
              <label>
                <span>Codelist name</span>
                <input
                  value={field.coding.codelist?.name ?? ""}
                  onChange={(event) =>
                    updateCoding({
                      codelist: {
                        name: event.target.value,
                        submission_value: field.coding.codelist?.submission_value ?? "",
                        ncit_code: field.coding.codelist?.ncit_code ?? "",
                        extensible: field.coding.codelist?.extensible ?? false,
                      },
                    })
                  }
                  placeholder="留白表示不使用 codelist"
                />
              </label>
              <label>
                <span>Codelist submission value / NCIt</span>
                <div className="joined-inputs">
                  <input
                    value={field.coding.codelist?.submission_value ?? ""}
                    onChange={(event) =>
                      updateCoding({
                        codelist: {
                          name: field.coding.codelist?.name ?? "",
                          submission_value: event.target.value,
                          ncit_code: field.coding.codelist?.ncit_code ?? "",
                          extensible: field.coding.codelist?.extensible ?? false,
                        },
                      })
                    }
                    placeholder="SEX"
                  />
                  <input
                    value={field.coding.codelist?.ncit_code ?? ""}
                    onChange={(event) =>
                      updateCoding({
                        codelist: {
                          name: field.coding.codelist?.name ?? "",
                          submission_value: field.coding.codelist?.submission_value ?? "",
                          ncit_code: event.target.value,
                          extensible: field.coding.codelist?.extensible ?? false,
                        },
                      })
                    }
                    placeholder="C66731"
                  />
                </div>
              </label>
              {field.coding.codelist && (
                <div className="codelist-tools span-2">
                  <span>已載入 {field.coding.terms?.length ?? 0} 個已確認 term code。</span>
                  <button
                    type="button"
                    className="danger-ghost"
                    onClick={() => updateCoding({ codelist: undefined, terms: [] })}
                  >
                    移除 codelist 與 term codes
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {candidates.length > 0 && (
          <div className="candidate-list" aria-live="polite">
            <div className="candidate-list-heading">
              <strong>可能的 CDISC／NCIt 候選</strong>
              <span>{candidates[0].version} · 依文字相關性排序，非自動判定</span>
            </div>
            {candidates.map((candidate) => (
              <article className="candidate" key={`${candidate.codelistCode}-${candidate.code}`}>
                <div className="candidate-main">
                  <div className="candidate-badges">
                    <span className="badge blue">{candidate.codelistSubmissionValue}</span>
                    <span className="badge neutral">{candidate.code}</span>
                    {candidate.isCodelist && <span className="badge amber">Codelist</span>}
                  </div>
                  <strong>{candidate.preferredTerm || candidate.codelistName}</strong>
                  <span>{candidate.submissionValue}</span>
                  <p>{candidate.definition}</p>
                  <small>{candidate.codelistName}</small>
                </div>
                <button type="button" className="secondary" onClick={() => onAdopt(candidate)}>
                  採用並寫入
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: StudioDiagnostic[] }) {
  if (!diagnostics.length) {
    return <div className="empty-state">尚無診斷訊息。</div>;
  }
  return (
    <div className="diagnostic-list">
      {diagnostics.map((diagnostic, index) => (
        <article className={`diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
          <div>
            <span>{diagnostic.severity === "error" ? "阻擋" : "提醒"}</span>
            <strong>{diagnostic.code}</strong>
          </div>
          <p>{diagnostic.message}</p>
          {diagnostic.path && <code>{diagnostic.path}</code>}
        </article>
      ))}
    </div>
  );
}

export function StudioApp() {
  const [program, setProgram] = useState<ProgramYaml>(initialProgram);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fieldFilter, setFieldFilter] = useState("");
  const [rightTab, setRightTab] = useState<"preview" | "diagnostics" | "submission">("preview");
  const [rawYamlOpen, setRawYamlOpen] = useState(false);
  const [rawYaml, setRawYaml] = useState("");
  const [rawYamlError, setRawYamlError] = useState("");
  const [searching, setSearching] = useState(false);
  const [cdiscSearchText, setCdiscSearchText] = useState(() =>
    initialProgram().selected_form.fields[0]?.concept_id.replaceAll("_", " ") ?? "",
  );
  const [candidates, setCandidates] = useState<CdiscCandidate[]>([]);
  const [lastSubmission, setLastSubmission] = useState<FormSubmission>();
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const compiled = useMemo(() => compileProgram(program), [program]);
  const fields = program.selected_form.fields;
  const activeField = fields[activeIndex];
  const errorCount = compiled.diagnostics.filter((item) => item.severity === "error").length;
  const pendingCoding = fields.filter((field) => field.coding.status === "unresolved").length;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(program));
  }, [program]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    setCandidates([]);
    setCdiscSearchText(fields[activeIndex]?.concept_id.replaceAll("_", " ") ?? "");
  }, [activeIndex]);

  const updateField = (field: ProgramField) => {
    setProgram((current) => {
      const next = clone(current);
      next.selected_form.fields[activeIndex] = field;
      return next;
    });
  };

  const setApproval = (gate: "clinical_meaning" | "form_contract", status: ApprovalStatus) => {
    setProgram((current) => {
      const next = clone(current);
      next.approvals[gate].status = status;
      next.approvals[gate].approved_by = status === "approved" ? "studio-user" : null;
      next.approvals[gate].approved_at = status === "approved" ? new Date().toISOString() : null;
      if (gate === "clinical_meaning") next.selected_form.approval_status = status;
      return next;
    });
  };

  const addField = () => {
    setProgram((current) => {
      const next = clone(current);
      next.selected_form.fields.push(newField(next.selected_form.fields.length));
      return next;
    });
    setActiveIndex(fields.length);
  };

  const deleteField = () => {
    if (!activeField || !window.confirm(`確定刪除「${activeField.label}」？`)) return;
    setProgram((current) => {
      const next = clone(current);
      next.selected_form.fields.splice(activeIndex, 1);
      return next;
    });
    setActiveIndex(Math.max(0, activeIndex - 1));
  };

  const searchCdisc = async () => {
    if (!activeField) return;
    setSearching(true);
    setCandidates([]);
    try {
      const query = cdiscSearchText.trim().slice(0, 200);
      const response = await fetch(`/api/cdisc/search?q=${encodeURIComponent(query)}`);
      const payload = (await response.json()) as CandidateResponse;
      if (!response.ok) throw new Error(payload.message ?? "官方術語查詢失敗。");
      setCandidates(payload.results);
      setToast(payload.results.length ? `找到 ${payload.results.length} 個候選。` : "沒有找到足夠相關的候選。請調整欄位名稱。" );
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "官方術語查詢失敗。");
    } finally {
      setSearching(false);
    }
  };

  const adoptCandidate = (candidate: CdiscCandidate) => {
    if (!activeField) return;
    const terms = [...(activeField.coding.terms ?? [])];
    if (!candidate.isCodelist && !terms.some((term) => term.ncit_code === candidate.code)) {
      terms.push({
        value: candidate.submissionValue,
        submission_value: candidate.submissionValue,
        system: "https://ncit.nci.nih.gov",
        ncit_code: candidate.code,
        label: candidate.preferredTerm,
        version: candidate.version,
      });
    }
    const options = [...activeField.options];
    if (
      !candidate.isCodelist &&
      !options.some((option) =>
        String(typeof option === "object" ? option.value : option) === candidate.submissionValue,
      )
    ) {
      options.push({ value: candidate.submissionValue, label: candidate.preferredTerm });
    }
    updateField({
      ...activeField,
      options,
      coding: {
        ...activeField.coding,
        status: "matched",
        standard: "CDISC",
        model: activeField.coding.model || "SDTM",
        version: candidate.version,
        source_url: candidate.sourceUrl,
        codelist: {
          name: candidate.codelistName,
          submission_value: candidate.codelistSubmissionValue,
          ncit_code: candidate.codelistCode,
          extensible: candidate.codelistExtensible,
        },
        terms,
      },
    });
    setToast("候選已寫入欄位；請再確認 Domain、Variable、選項與 mapping 信心。" );
  };

  const importFile = async (file: File) => {
    try {
      const imported = parse(await file.text()) as ProgramYaml;
      if (!imported?.selected_form?.fields) throw new Error("不是有效的 program.yaml。" );
      setProgram(imported);
      setActiveIndex(0);
      setToast(`已載入 ${file.name}`);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "無法載入 YAML。" );
    }
  };

  const openRawYaml = () => {
    setRawYaml(programToYaml(program));
    setRawYamlError("");
    setRawYamlOpen(true);
  };

  const applyRawYaml = () => {
    try {
      const parsed = parse(rawYaml) as ProgramYaml;
      if (!parsed?.selected_form?.fields) throw new Error("缺少 selected_form.fields。" );
      setProgram(parsed);
      setActiveIndex(0);
      setRawYamlOpen(false);
      setToast("YAML 變更已套用。" );
    } catch (cause) {
      setRawYamlError(cause instanceof Error ? cause.message : "YAML 格式錯誤。" );
    }
  };

  const exportPackage = async () => {
    if (!compiled.ok || !compiled.contract) {
      setRightTab("diagnostics");
      setToast("請先排除阻擋項目。" );
      return;
    }
    if (program.approvals.form_contract.status !== "approved") {
      setToast("Gate B 尚未核准，不能下載整包。" );
      return;
    }
    await downloadBundle(program, compiled.contract);
    setToast("已建立 YAML、JSON、HTML 與 manifest ZIP。" );
  };

  const filteredFields = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) =>
      `${field.label} ${field.concept_id}`.toLowerCase().includes(fieldFilter.toLowerCase()),
    );

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <strong>AirwayAI eCRF Studio</strong>
            <span>Protocol YAML → CDISC review → coded form</span>
          </div>
        </div>
        <div className="top-actions">
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".yaml,.yml,text/yaml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
          <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
            載入 YAML
          </button>
          <button type="button" className="ghost" onClick={openRawYaml}>編輯原始 YAML</button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              downloadText("program.yaml", programToYaml(program), "application/yaml;charset=utf-8")
            }
          >
            下載 YAML
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void exportPackage()}
            disabled={!compiled.ok || program.approvals.form_contract.status !== "approved"}
          >
            下載整包 ZIP
          </button>
        </div>
      </header>

      <div className="contextbar">
        <div>
          <span className="eyebrow">{program.project_id}</span>
          <h1>{program.selected_form.title}</h1>
          <p>{program.source.protocol_title}</p>
        </div>
        <div className="summary-row">
          <div><strong>{fields.length}</strong><span>欄位</span></div>
          <div><strong>{pendingCoding}</strong><span>待確認 mapping</span></div>
          <div className={errorCount ? "has-error" : "is-good"}><strong>{errorCount}</strong><span>阻擋項目</span></div>
        </div>
        <div className="gate-controls" aria-label="審核 Gate">
          <label>
            <span>Gate A · 臨床意義</span>
            <select
              value={program.approvals.clinical_meaning.status}
              onChange={(event) => setApproval("clinical_meaning", event.target.value as ApprovalStatus)}
            >
              <option value="pending">待核准</option>
              <option value="approved">已核准</option>
            </select>
          </label>
          <label>
            <span>Gate B · 表單合約</span>
            <select
              value={program.approvals.form_contract.status}
              onChange={(event) => setApproval("form_contract", event.target.value as ApprovalStatus)}
            >
              <option value="pending">待核准</option>
              <option value="approved">已核准</option>
            </select>
          </label>
        </div>
      </div>

      <main className="workspace">
        <aside className="field-sidebar" aria-label="欄位清單">
          <div className="sidebar-heading">
            <div><span className="eyebrow">Schema fields</span><h2>欄位清單</h2></div>
            <button type="button" className="icon-button" onClick={addField} aria-label="新增欄位">＋</button>
          </div>
          <label className="search-box">
            <span className="visually-hidden">搜尋欄位</span>
            <input
              value={fieldFilter}
              onChange={(event) => setFieldFilter(event.target.value)}
              placeholder="搜尋名稱或 ID"
            />
          </label>
          <nav className="field-list">
            {filteredFields.map(({ field, index }) => (
              <button
                type="button"
                key={`${field.concept_id}-${index}`}
                className={activeIndex === index ? "active" : ""}
                onClick={() => setActiveIndex(index)}
              >
                <span className={`status-dot ${field.coding.status}`} aria-hidden="true" />
                <span><strong>{field.label || "未命名欄位"}</strong><small>{field.concept_id}</small></span>
                <em>{statusLabel(field.coding.status)}</em>
              </button>
            ))}
          </nav>
          {!filteredFields.length && <div className="empty-state">找不到符合的欄位。</div>}
        </aside>

        <section className="editor-pane" aria-label="欄位編輯器">
          {activeField ? (
            <FieldEditor
              field={activeField}
              onChange={updateField}
              onDelete={deleteField}
              onSearch={() => void searchCdisc()}
              searchText={cdiscSearchText}
              onSearchText={setCdiscSearchText}
              searching={searching}
              candidates={candidates}
              onAdopt={adoptCandidate}
            />
          ) : (
            <div className="empty-state large"><h2>尚無欄位</h2><p>新增第一個欄位開始建立表單。</p><button className="primary" onClick={addField}>新增欄位</button></div>
          )}
        </section>

        <aside className="preview-pane" aria-label="預覽與驗證">
          <div className="tabs" role="tablist" aria-label="右側面板">
            <button type="button" role="tab" aria-selected={rightTab === "preview"} onClick={() => setRightTab("preview")}>表單預覽</button>
            <button type="button" role="tab" aria-selected={rightTab === "diagnostics"} onClick={() => setRightTab("diagnostics")}>
              驗證 <span className={errorCount ? "count error" : "count"}>{errorCount}</span>
            </button>
            <button type="button" role="tab" aria-selected={rightTab === "submission"} onClick={() => setRightTab("submission")}>Submission</button>
          </div>
          <div className="tab-content">
            {rightTab === "preview" && (
              compiled.ok && compiled.contract ? (
                <div className="renderer-frame">
                  <FormRenderer
                    key={`${compiled.contract["x-airwayai"].formId}-${JSON.stringify(compiled.contract.properties)}`}
                    schema={compiled.contract}
                    locale="zh-TW"
                    onSubmit={(submission) => {
                      setLastSubmission(submission);
                      setRightTab("submission");
                    }}
                  />
                </div>
              ) : (
                <div className="blocked-preview">
                  <div aria-hidden="true">!</div>
                  <h2>預覽尚未產生</h2>
                  <p>依 protocol-to-eCRF 規則，未核准的臨床意義、未決欄位或模糊 CDISC mapping 會阻擋 JSON 產生。</p>
                  <button className="secondary" onClick={() => setRightTab("diagnostics")}>查看阻擋項目</button>
                </div>
              )
            )}
            {rightTab === "diagnostics" && <Diagnostics diagnostics={compiled.diagnostics} />}
            {rightTab === "submission" && (
              <pre className="submission-view">{JSON.stringify(lastSubmission ?? { message: "尚未送出測試資料" }, null, 2)}</pre>
            )}
          </div>
        </aside>
      </main>

      {rawYamlOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRawYamlOpen(false)}>
          <section className="yaml-modal" role="dialog" aria-modal="true" aria-labelledby="yaml-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">Advanced editor</span><h2 id="yaml-title">編輯 program.yaml</h2></div><button className="icon-button" onClick={() => setRawYamlOpen(false)} aria-label="關閉">×</button></div>
            <p>直接修改 YAML 後套用。系統不會把「已產生檔案」視為臨床或 mapping 核准。</p>
            <textarea value={rawYaml} onChange={(event) => setRawYaml(event.target.value)} spellCheck={false} aria-label="program.yaml 內容" />
            {rawYamlError && <div className="inline-error">{rawYamlError}</div>}
            <div className="modal-actions"><button className="ghost" onClick={() => setRawYamlOpen(false)}>取消</button><button className="primary" onClick={applyRawYaml}>套用 YAML</button></div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
