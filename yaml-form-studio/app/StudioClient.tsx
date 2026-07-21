"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import {
  codingFromCandidate,
  companionFieldFromCandidate,
  rankCdashCandidates,
} from "./cdash.mjs";
import "./studio.css";

type Actor = { name: string; email: string } | null;
type Coding = {
  status?: string;
  rationale?: string | null;
  standard?: string;
  model?: string;
  implementation_guide?: string;
  version?: string;
  domain?: string;
  variable?: string;
  variable_label?: string;
  source_url?: string;
  mapping_confidence_percent?: number;
  sdtm_target?: string;
  codelist?: { name?: string; submission_value?: string; ncit_code?: string; extensible?: boolean };
  [key: string]: unknown;
};
type Field = {
  concept_id?: string;
  label?: string;
  purpose?: string;
  data_type?: string;
  required?: boolean | "unresolved";
  source_refs?: { locator?: string }[];
  coding?: Coding;
  [key: string]: unknown;
};
type Program = {
  project_id?: string;
  selected_form?: {
    candidate_id?: string;
    title?: string;
    fields?: Field[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type CdashRow = {
  version: string;
  className: string;
  domain: string;
  variable: string;
  label: string;
  definition: string;
  question: string;
  prompt: string;
  type: string;
  sdtmTarget: string;
  mappingInstructions: string;
  codelistCode: string;
  implementationNotes: string;
};
type Companion = CdashRow;
type Candidate = CdashRow & {
  resolvedVariable: string;
  score: number;
  confidence: "high" | "medium" | "low";
  matchedAttributes: string[];
  differences: string[];
  companions: Companion[];
};
type CdashDataset = {
  source: {
    version: string;
    sourceFile: string;
    sourceUrl: string;
    retrievedAt: string;
    rowCount: number;
  };
  rows: CdashRow[];
};
type LookupState = {
  status: "idle" | "loading" | "ready" | "error";
  candidates: Candidate[];
  message: string;
  selectedVariable?: string;
};

const blank = "# Upload or paste a protocol-to-eCRF program.yaml.";
const initialLookup: LookupState = { status: "idle", candidates: [], message: "" };
const copy = {
  en: {
    upload: "Upload YAML",
    confirm: "Confirm reviewed YAML",
    download: "Download YAML",
    inventory: "Field inventory",
    preview: "Renderer preview",
    blockers: "BLOCKERS",
    required: "Required",
    optional: "Optional",
    search: "Search CDASH",
    searching: "Searching CDASH Model v1.3…",
    use: "Use and write to YAML",
    selected: "Written to YAML",
    noMatch: "No sufficiently relevant CDASH Model v1.3 candidate was found. Keep this field unresolved.",
    candidates: "Review candidates",
    evidence: "Evidence and mapping details",
    differences: "Review differences",
    companion: "Companion field suggested by the metadata",
    addCompanion: "Add as unresolved field",
    companionWarning: "Protocol support, locator, and requiredness must be reviewed before confirmation.",
  },
  zh: {
    upload: "上傳 YAML",
    confirm: "確認已審閱 YAML",
    download: "下載 YAML",
    inventory: "欄位清單",
    preview: "轉譯器預覽",
    blockers: "阻擋項目",
    required: "必填",
    optional: "選填",
    search: "搜尋 CDASH",
    searching: "正在搜尋 CDASH Model v1.3…",
    use: "採用並寫入 YAML",
    selected: "已寫入 YAML",
    noMatch: "找不到相關性足夠的 CDASH Model v1.3 候選，請維持 unresolved。",
    candidates: "審閱候選",
    evidence: "證據與對應說明",
    differences: "待確認差異",
    companion: "Metadata 建議的伴隨欄位",
    addCompanion: "新增為 unresolved 欄位",
    companionWarning: "確認前仍須審閱 protocol 支持度、來源位置與必填設定。",
  },
};

function validate(raw: string) {
  try {
    if (/^\s*(---|%|!|&|\*|<<:)/m.test(raw)) {
      throw new Error("Unsafe YAML construct is not supported.");
    }
    const program = parse(raw) as Program;
    const fields = program?.selected_form?.fields ?? [];
    const issues: string[] = [];
    if (!program?.project_id) issues.push("project_id is required.");
    if (!program?.selected_form?.candidate_id) issues.push("selected_form.candidate_id is required.");
    if (!fields.length) issues.push("selected_form.fields must contain at least one field.");
    fields.forEach((field, index) => {
      const name = `Field ${index + 1}`;
      const coding = field.coding;
      if (!field.concept_id) issues.push(`${name}: concept_id is required.`);
      if (!field.label) issues.push(`${name}: label is required.`);
      if (!field.data_type || field.data_type === "unresolved") {
        issues.push(`${name}: data type is unresolved.`);
      }
      if (field.required === undefined || field.required === "unresolved") {
        issues.push(`${name}: requiredness is unresolved.`);
      }
      if (!field.source_refs?.[0]?.locator) issues.push(`${name}: source locator is required.`);
      if (!coding?.status || coding.status === "unresolved") {
        issues.push(`${name}: CDISC status is unresolved.`);
      } else if (coding.status === "not-applicable" && !coding.rationale) {
        issues.push(`${name}: not-applicable requires a rationale.`);
      } else if (coding.status === "matched") {
        if (!coding.domain || !coding.variable) issues.push(`${name}: CDASH domain and variable are required.`);
        if (!coding.standard || !coding.model || !coding.version) {
          issues.push(`${name}: CDASH standard, model, and version are required.`);
        }
        if (!coding.source_url || !coding.rationale) {
          issues.push(`${name}: CDASH evidence URL and rationale are required.`);
        }
      }
    });
    return { program, fields, issues, error: "" };
  } catch (error) {
    return {
      program: null,
      fields: [],
      issues: [],
      error: error instanceof Error ? error.message : "Invalid YAML.",
    };
  }
}

function fieldInputType(field: Field) {
  if (field.data_type === "date") return "date";
  if (field.data_type === "integer" || field.data_type === "number") return "number";
  return "text";
}

export default function StudioClient() {
  const [yaml, setYaml] = useState(blank);
  const [selected, setSelected] = useState(0);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [note, setNote] = useState("");
  const [actor, setActor] = useState<Actor | undefined>(undefined);
  const [lookup, setLookup] = useState<LookupState>(initialLookup);
  const input = useRef<HTMLInputElement>(null);
  const cdashData = useRef<CdashDataset | null>(null);
  const review = useMemo(() => validate(yaml), [yaml]);
  const current = review.fields[selected] ?? review.fields[0];
  const t = copy[language];
  const ready = Boolean(actor && review.program && !review.error && !review.issues.length);

  useEffect(() => {
    let active = true;
    void fetch("/api/me", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) return setActor(null);
        const result = (await response.json()) as { actor?: Actor };
        setActor(result.actor ?? null);
      })
      .catch(() => active && setActor(null));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setLookup(initialLookup);
  }, [selected]);

  const mutateProgram = (mutator: (program: Program) => void) => {
    if (!review.program) return;
    const program = structuredClone(review.program);
    mutator(program);
    setYaml(stringify(program));
  };

  const updateField = (patch: Partial<Field>) => {
    mutateProgram((program) => {
      const field = program.selected_form?.fields?.[selected];
      if (field) Object.assign(field, patch);
    });
  };

  const load = async (file?: File) => {
    if (!file) return;
    setYaml(await file.text());
    setSelected(0);
    setLookup(initialLookup);
    setNote(`Loaded ${file.name}.`);
  };

  const getCdashData = async () => {
    if (cdashData.current) return cdashData.current;
    const response = await fetch("/cdash-model-v1.3.json", { cache: "force-cache" });
    if (!response.ok) throw new Error("CDASH Model v1.3 metadata could not be loaded.");
    const dataset = (await response.json()) as CdashDataset;
    if (!dataset.rows?.length || dataset.source?.version !== "CDASH Model v1.3") {
      throw new Error("The CDASH metadata bundle is invalid or has an unexpected version.");
    }
    cdashData.current = dataset;
    return dataset;
  };

  const searchCdash = async () => {
    if (!current) return;
    if (!current.source_refs?.[0]?.locator) {
      setLookup({
        status: "error",
        candidates: [],
        message: "A protocol source locator is required before CDASH search.",
      });
      return;
    }
    setLookup({ status: "loading", candidates: [], message: "" });
    try {
      const dataset = await getCdashData();
      const candidates = rankCdashCandidates(current, dataset.rows, 2) as Candidate[];
      setLookup({
        status: "ready",
        candidates,
        message: candidates.length ? "" : t.noMatch,
      });
    } catch (error) {
      setLookup({
        status: "error",
        candidates: [],
        message: error instanceof Error ? error.message : "CDASH search failed.",
      });
    }
  };

  const adoptCandidate = async (candidate: Candidate) => {
    if (!current) return;
    const dataset = await getCdashData();
    const coding = codingFromCandidate(current, candidate, dataset.source) as Coding;
    updateField({ coding });
    setLookup((state) => ({ ...state, selectedVariable: candidate.resolvedVariable }));
    setNote(
      coding.status === "matched"
        ? `${candidate.resolvedVariable} was written to YAML. Review the evidence before final confirmation.`
        : `${candidate.variable} was written as unresolved because a concrete CDASH domain is still required.`,
    );
  };

  const addCompanion = async (companion: Companion) => {
    if (!current) return;
    const dataset = await getCdashData();
    const field = companionFieldFromCandidate(companion, current, dataset.source) as Field;
    let nextIndex = selected;
    mutateProgram((program) => {
      const fields = program.selected_form?.fields;
      if (!fields) return;
      const exists = fields.some(
        (item) => item.coding?.variable === field.coding?.variable && item.coding?.domain === field.coding?.domain,
      );
      if (exists) {
        nextIndex = fields.findIndex(
          (item) => item.coding?.variable === field.coding?.variable && item.coding?.domain === field.coding?.domain,
        );
        return;
      }
      fields.push(field);
      nextIndex = fields.length - 1;
    });
    setSelected(nextIndex);
    setNote(`${field.label} was added as unresolved. Complete protocol evidence before confirmation.`);
  };

  const confirm = async () => {
    if (!ready) return;
    const response = await fetch("/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml }),
    });
    const result = (await response.json()) as { yaml?: string; error?: string };
    if (!response.ok || !result.yaml) {
      setNote(result.error ?? "Confirmation failed.");
      return;
    }
    setYaml(result.yaml);
    setNote("Confirmed YAML was stamped with the server-verified reviewer identity.");
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${review.program?.project_id ?? "program"}-draft.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <b>AirwayAI eCRF Studio</b>
          <small>Editable protocol-to-eCRF YAML review</small>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={() => input.current?.click()}>
            {t.upload}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready}
            title={!ready ? "Resolve all blockers and sign in before confirmation." : undefined}
            onClick={() => void confirm()}
          >
            {t.confirm}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setLanguage(language === "en" ? "zh" : "en")}
          >
            {language === "en" ? "繁體中文" : "English"}
          </button>
        </div>
        <input
          ref={input}
          className="hidden"
          type="file"
          accept=".yaml,.yml"
          onChange={(event) => void load(event.target.files?.[0])}
        />
      </header>

      <section className="contextbar">
        <div>
          <i>REVIEW GATE</i>
          <h1>{review.program?.selected_form?.title ?? "YAML field review"}</h1>
          <p>
            {actor === undefined
              ? "Checking reviewer identity…"
              : actor
                ? `Signed in as ${actor.name}`
                : "Sign in is required to confirm YAML."}
          </p>
        </div>
        <div className="summary">
          <b>
            {review.fields.length}<small>FIELDS</small>
          </b>
          <b className={review.issues.length || review.error ? "bad" : "ok"}>
            {review.issues.length + (review.error ? 1 : 0)}<small>{t.blockers}</small>
          </b>
        </div>
        <button type="button" className="secondary" disabled={!review.program} onClick={download}>
          {t.download}
        </button>
      </section>

      <main className="workspace">
        <aside>
          <h2>{t.inventory}</h2>
          {review.fields.map((field, index) => (
            <button
              type="button"
              className={selected === index ? "field active" : "field"}
              onClick={() => setSelected(index)}
              key={`${field.concept_id}-${index}`}
            >
              <span className={`dot ${field.coding?.status ?? "unresolved"}`} />
              <b>
                {field.label ?? "Untitled field"}
                <small>{field.concept_id ?? "Missing concept ID"}</small>
              </b>
              <em>{field.coding?.status ?? "unresolved"}</em>
            </button>
          ))}
        </aside>

        <section className="editor">
          <article>
            <header>
              <div>
                <i>SOURCE-CONTROLLED INPUT</i>
                <h2>program.yaml</h2>
              </div>
              <b className={review.error ? "bad" : "ok"}>{review.error ? "Invalid YAML" : "Parsed"}</b>
            </header>
            <textarea value={yaml} onChange={(event) => setYaml(event.target.value)} spellCheck={false} />
          </article>

          {current && (
            <article>
              <header>
                <div>
                  <i>FIELD DEFINITION</i>
                  <h2>{current.label}</h2>
                </div>
              </header>
              <div className="grid">
                <label>
                  Concept ID
                  <input
                    value={current.concept_id ?? ""}
                    onChange={(event) => updateField({ concept_id: event.target.value })}
                  />
                </label>
                <label>
                  English display label
                  <input value={current.label ?? ""} onChange={(event) => updateField({ label: event.target.value })} />
                </label>
                <label>
                  Data type
                  <select
                    value={current.data_type ?? "unresolved"}
                    onChange={(event) => updateField({ data_type: event.target.value })}
                  >
                    <option>unresolved</option>
                    <option>string</option>
                    <option>integer</option>
                    <option>number</option>
                    <option>date</option>
                    <option>boolean</option>
                  </select>
                </label>
                <label>
                  {t.required}
                  <select
                    value={String(current.required ?? "unresolved")}
                    onChange={(event) =>
                      updateField({
                        required:
                          event.target.value === "true"
                            ? true
                            : event.target.value === "false"
                              ? false
                              : "unresolved",
                      })
                    }
                  >
                    <option>unresolved</option>
                    <option value="true">{t.required}</option>
                    <option value="false">{t.optional}</option>
                  </select>
                </label>
                <label className="wide">
                  Source locator
                  <input
                    value={current.source_refs?.[0]?.locator ?? ""}
                    onChange={(event) => updateField({ source_refs: [{ locator: event.target.value }] })}
                  />
                </label>
                <label>
                  CDISC status
                  <select
                    value={current.coding?.status ?? "unresolved"}
                    onChange={(event) =>
                      updateField({ coding: { ...current.coding, status: event.target.value } })
                    }
                  >
                    <option>unresolved</option>
                    <option>matched</option>
                    <option>not-applicable</option>
                  </select>
                </label>
                <label>
                  Rationale
                  <input
                    value={current.coding?.rationale ?? ""}
                    onChange={(event) =>
                      updateField({ coding: { ...current.coding, rationale: event.target.value || null } })
                    }
                  />
                </label>
                <label>
                  Standard / model
                  <input
                    value={[current.coding?.standard, current.coding?.model].filter(Boolean).join(" / ")}
                    readOnly
                    placeholder="Written after candidate selection"
                  />
                </label>
                <label>
                  CDASH version
                  <input value={current.coding?.version ?? ""} readOnly placeholder="Written after candidate selection" />
                </label>
                <label>
                  CDASH domain
                  <input
                    value={current.coding?.domain ?? ""}
                    onChange={(event) =>
                      updateField({ coding: { ...current.coding, domain: event.target.value.toUpperCase() || undefined } })
                    }
                  />
                </label>
                <label>
                  CDASH variable
                  <input
                    value={current.coding?.variable ?? ""}
                    onChange={(event) =>
                      updateField({ coding: { ...current.coding, variable: event.target.value.toUpperCase() || undefined } })
                    }
                  />
                </label>
                <label>
                  SDTM target
                  <input value={current.coding?.sdtm_target ?? ""} readOnly />
                </label>
                <label>
                  Controlled terminology
                  <input value={current.coding?.codelist?.ncit_code ?? ""} readOnly />
                </label>
                <label className="wide">
                  Evidence URL
                  <input
                    value={current.coding?.source_url ?? ""}
                    onChange={(event) =>
                      updateField({ coding: { ...current.coding, source_url: event.target.value || undefined } })
                    }
                  />
                </label>
              </div>

              <div className="cdash-tools">
                <div className="cdash-action-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={lookup.status === "loading"}
                    aria-controls="cdash-candidates"
                    onClick={() => void searchCdash()}
                  >
                    {lookup.status === "loading" ? t.searching : t.search}
                  </button>
                  <span>CDASH Model v1.3 · official CSV metadata · human selection required</span>
                </div>

                <div id="cdash-candidates" className="candidate-list" aria-live="polite">
                  {lookup.message && <p className={lookup.status === "error" ? "lookup-error" : "lookup-note"}>{lookup.message}</p>}
                  {lookup.candidates.length > 0 && <h3>{t.candidates} ({lookup.candidates.length})</h3>}
                  {lookup.candidates.map((candidate) => {
                    const candidateKey = `${candidate.domain}-${candidate.variable}`;
                    const applied = lookup.selectedVariable === candidate.resolvedVariable;
                    return (
                      <article className={applied ? "candidate applied" : "candidate"} key={candidateKey}>
                        <div className="candidate-heading">
                          <div>
                            <div className="candidate-badges">
                              <span>{candidate.domain || "Domain required"}</span>
                              <span>{candidate.resolvedVariable}</span>
                              <span>{candidate.type || "Type unspecified"}</span>
                              <span className={`confidence ${candidate.confidence}`}>{candidate.confidence} relevance</span>
                            </div>
                            <strong>{candidate.label}</strong>
                            <p>{candidate.question || candidate.definition}</p>
                          </div>
                          <button
                            type="button"
                            className={applied ? "mapping-selected" : "primary"}
                            disabled={applied}
                            onClick={() => void adoptCandidate(candidate)}
                          >
                            {applied ? t.selected : t.use}
                          </button>
                        </div>

                        {candidate.differences.length > 0 && (
                          <div className="candidate-warning">
                            <b>{t.differences}</b>
                            <ul>{candidate.differences.map((item) => <li key={item}>{item}</li>)}</ul>
                          </div>
                        )}

                        <details>
                          <summary>{t.evidence}</summary>
                          <dl>
                            <div><dt>Variable label</dt><dd>{candidate.label || "—"}</dd></div>
                            <div><dt>Prompt</dt><dd>{candidate.prompt || "—"}</dd></div>
                            <div><dt>SDTM target</dt><dd>{candidate.sdtmTarget || "—"}</dd></div>
                            <div><dt>Codelist</dt><dd>{candidate.codelistCode || "—"}</dd></div>
                            <div><dt>Matched attributes</dt><dd>{candidate.matchedAttributes.join(", ")}</dd></div>
                            <div><dt>Mapping instructions</dt><dd>{candidate.mappingInstructions || "—"}</dd></div>
                            <div><dt>Implementation notes</dt><dd>{candidate.implementationNotes || "—"}</dd></div>
                          </dl>
                        </details>

                        {candidate.companions.length > 0 && (
                          <div className="companion-list">
                            <b>{t.companion}</b>
                            <p>{t.companionWarning}</p>
                            {candidate.companions.map((companion) => (
                              <div className="companion" key={`${companion.domain}-${companion.variable}`}>
                                <span><strong>{companion.variable}</strong> · {companion.label}</span>
                                <button type="button" className="secondary" onClick={() => void addCompanion(companion)}>
                                  {t.addCompanion}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </article>
          )}
        </section>

        <aside className="preview">
          <nav>
            {t.preview}<span>Diagnostics ({review.issues.length})</span>
          </nav>
          {review.fields.length > 0 && (
            <article className="form">
              <i>PREVIEW ONLY · REVIEW-GATED</i>
              <h2>{review.program?.selected_form?.title}</h2>
              {review.fields.map((field, index) => (
                <label key={index}>
                  {field.data_type === "boolean" ? (
                    <span className="boolean-preview"><input type="checkbox" /> {field.label}</span>
                  ) : (
                    <>
                      {field.label}{field.required === true && <strong> *</strong>}
                      <input type={fieldInputType(field)} />
                    </>
                  )}
                </label>
              ))}
              <button type="button" className="primary" disabled>Submit form</button>
            </article>
          )}
          <div className="diagnostics">
            {review.error && <p className="error">{review.error}</p>}
            {review.issues.map((issue) => <p className="error" key={issue}>{issue}</p>)}
            {actor === null && <p className="error">Authentication is required for confirmation.</p>}
            {note && <p className="success">{note}</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}
