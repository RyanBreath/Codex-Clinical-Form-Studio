"use client";
import { useMemo, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import "./studio.css";

type Actor = { name: string; email: string } | null;
type CdashCandidate = {
  label: string;
  domain?: string;
  variable?: string;
  source?: string;
  confidence?: string;
};
type Field = {
  concept_id?: string;
  label?: string;
  data_type?: string;
  required?: boolean | "unresolved";
  source_refs?: { locator?: string }[];
  coding?: {
    status?: string;
    rationale?: string | null;
    standard?: string;
    model?: string;
    domain?: string;
    variable?: string;
    source?: string;
  };
  [key: string]: unknown;
};
type Program = {
  project_id?: string;
  selected_form?: {
    candidate_id?: string;
    title?: string;
    approval_status?: string;
    fields?: Field[];
  };
  approvals?: Record<string, unknown>;
  [key: string]: unknown;
};
const blank =
  "# Upload or paste a protocol-to-eCRF program.yaml.\n# YAML with selected_form.fields is required before review and confirmation.";
const example = `contract_version: "1.0.0"\nproject_id: "prj_demo-001"\nselected_form:\n  candidate_id: "baseline-assessment"\n  title: "Baseline assessment"\n  approval_status: pending\n  fields:\n    - concept_id: visit_date\n      label: Visit date\n      data_type: date\n      required: true\n      source_refs:\n        - locator: "Section 8.2, page 42"\n      coding:\n        status: not-applicable\n        rationale: "Operational date"\napprovals:\n  clinical_meaning:\n    status: pending\n  form_contract:\n    status: pending`;
const copy = {
  en: {
    upload: "Upload YAML",
    example: "Load example",
    confirm: "Confirm reviewed YAML",
    download: "Download YAML",
    gate: "REVIEW GATE",
    inventory: "Field inventory",
    input: "SOURCE-CONTROLLED INPUT",
    definition: "FIELD DEFINITION",
    search: "Search CDASH",
    searching: "Searching CDASH…",
    candidates: "CDASH candidates",
    choose: "Select candidate",
    preview: "Renderer preview",
    diagnostics: "Diagnostics",
    required: "Required",
    optional: "Optional",
    source: "Source locator",
    status: "CDISC status",
    rationale: "Rationale",
  },
  zh: {
    upload: "上傳 YAML",
    example: "載入範例",
    confirm: "確認審查後 YAML",
    download: "下載 YAML",
    gate: "審查關卡",
    inventory: "欄位清單",
    input: "受控來源輸入",
    definition: "欄位定義",
    search: "查詢 CDASH",
    searching: "正在查詢 CDASH…",
    candidates: "CDASH 候選項目",
    choose: "選擇此候選",
    preview: "Renderer 預覽",
    diagnostics: "診斷",
    required: "必填",
    optional: "選填",
    source: "來源定位",
    status: "CDISC 狀態",
    rationale: "理由",
  },
};
function review(raw: string) {
  try {
    const p = parse(raw) as Program;
    if (!p || typeof p !== "object") throw new Error("YAML must be an object.");
    const f = p.selected_form?.fields ?? [];
    const issues: string[] = [];
    if (!p.project_id) issues.push("project_id is required.");
    if (!p.selected_form?.candidate_id)
      issues.push("selected_form.candidate_id is required.");
    if (!f.length)
      issues.push("selected_form.fields must include at least one field.");
    f.forEach((x, i) => {
      const n = `Field ${i + 1}`;
      if (!x.concept_id) issues.push(`${n}: concept_id is required.`);
      if (!x.label) issues.push(`${n}: label is required.`);
      if (!x.data_type || x.data_type === "unresolved")
        issues.push(`${n}: data_type must be decided.`);
      if (x.required === undefined || x.required === "unresolved")
        issues.push(`${n}: requiredness must be decided.`);
      if (!x.source_refs?.[0]?.locator)
        issues.push(`${n}: source locator is required.`);
      if (!x.coding?.status || x.coding.status === "unresolved")
        issues.push(`${n}: CDISC coding status must be decided.`);
    });
    return { p, issues, error: "" };
  } catch (e) {
    return {
      p: null,
      issues: [],
      error: e instanceof Error ? e.message : "Invalid YAML.",
    };
  }
}
export default function StudioClient({ actor }: { actor: Actor }) {
  const [yaml, setYaml] = useState(blank),
    [selected, setSelected] = useState(0),
    [note, setNote] = useState(""),
    [language, setLanguage] = useState<"en" | "zh">("en"),
    [candidates, setCandidates] = useState<CdashCandidate[]>([]),
    [searching, setSearching] = useState(false),
    file = useRef<HTMLInputElement>(null);
  const t = copy[language];
  const r = useMemo(() => review(yaml), [yaml]);
  const fields = r.p?.selected_form?.fields ?? [],
    current = fields[selected] ?? fields[0],
    ready = !!r.p && !r.error && !r.issues.length && !!actor;
  const update = (patch: Partial<Field>) => {
    if (!r.p) return;
    const n = structuredClone(r.p),
      f = n.selected_form?.fields?.[selected];
    if (!f) return;
    Object.assign(f, patch);
    setYaml(stringify(n));
  };
  const load = async (f?: File) => {
    if (f) {
      setYaml(await f.text());
      setSelected(0);
      setNote(`Loaded ${f.name}. Review every field before confirmation.`);
    }
  };
  const confirm = () => {
    if (!r.p || !actor || !ready) return;
    const n = structuredClone(r.p),
      at = new Date().toISOString(),
      by = `${actor.name} <${actor.email}>`;
    n.selected_form = { ...n.selected_form, approval_status: "approved" };
    n.approvals = {
      clinical_meaning: {
        status: "approved",
        approved_by: by,
        approved_at: at,
      },
      form_contract: { status: "approved", approved_by: by, approved_at: at },
    };
    n.approval_actor = {
      display_name: actor.name,
      email: actor.email,
      confirmed_at: at,
    };
    setYaml(stringify(n));
    setNote("Confirmed YAML now includes the authenticated reviewer identity.");
  };
  const download = () => {
    const b = new Blob([yaml], { type: "application/yaml" }),
      u = URL.createObjectURL(b),
      a = document.createElement("a");
    a.href = u;
    a.download = `${r.p?.project_id ?? "program"}-confirmed.yaml`;
    a.click();
    URL.revokeObjectURL(u);
  };
  const searchCdash = async () => {
    if (!current?.label) return;
    setSearching(true);
    setCandidates([]);
    setNote("");
    try {
      const response = await fetch(
        `/api/cdash?query=${encodeURIComponent(`${current.label} ${current.concept_id ?? ""}`)}`,
      );
      const payload = (await response.json()) as {
        candidates?: CdashCandidate[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "CDASH lookup failed.");
      setCandidates(payload.candidates ?? []);
      setNote(
        payload.candidates?.length
          ? "Select a candidate after specialist review."
          : "No CDASH candidate was returned. Keep this field unresolved.",
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : "CDASH lookup failed.");
    } finally {
      setSearching(false);
    }
  };
  const selectCandidate = (candidate: CdashCandidate) => {
    update({
      coding: {
        ...current?.coding,
        status: "matched",
        standard: "CDISC",
        model: "CDASH",
        domain: candidate.domain,
        variable: candidate.variable,
        source: candidate.source,
        rationale: `Selected by reviewer from CDASH: ${candidate.label}`,
      },
    });
    setCandidates([]);
    setNote(
      `Candidate selected: ${candidate.label}. Reviewer confirmation is still required.`,
    );
  };
  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <b>AirwayAI eCRF Studio</b>
          <small>Protocol-to-eCRF review workspace</small>
        </div>
        <div>
          <button className="ghost" onClick={() => file.current?.click()}>
            {t.upload}
          </button>
          <button className="ghost" onClick={() => setYaml(example)}>
            {t.example}
          </button>
          <button className="primary" disabled={!ready} onClick={confirm}>
            {t.confirm}
          </button>
          <button
            className="ghost"
            onClick={() => setLanguage(language === "en" ? "zh" : "en")}
          >
            {language === "en" ? "中文" : "English"}
          </button>
        </div>
        <input
          ref={file}
          className="hidden"
          type="file"
          accept=".yaml,.yml"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </header>
      <section className="contextbar">
        <div>
          <i>{t.gate}</i>
          <h1>{r.p?.selected_form?.title ?? "YAML field review"}</h1>
          <p>
            {actor
              ? `Signed in as ${actor.name} (${actor.email})`
              : "Sign in is required to create confirmed YAML."}
          </p>
        </div>
        <div className="summary">
          <b>
            {fields.length}
            <small>FIELDS</small>
          </b>
          <b className={r.issues.length ? "bad" : "ok"}>
            {r.issues.length}
            <small>BLOCKERS</small>
          </b>
        </div>
        <button className="secondary" disabled={!r.p} onClick={download}>
          {t.download}
        </button>
      </section>
      <main className="workspace">
        <aside>
          <h2>{t.inventory}</h2>
          {fields.map((f, i) => (
            <button
              className={selected === i ? "field active" : "field"}
              onClick={() => setSelected(i)}
              key={`${f.concept_id}-${i}`}
            >
              <span className={`dot ${f.coding?.status ?? "unresolved"}`} />
              <b>
                {f.label ?? "Untitled field"}
                <small>{f.concept_id ?? "Missing concept_id"}</small>
              </b>
              <em>{f.coding?.status ?? "unresolved"}</em>
            </button>
          ))}
          {!fields.length && (
            <p className="empty">
              Upload YAML with <code>selected_form.fields</code>.
            </p>
          )}
        </aside>
        <section className="editor">
          <article>
            <header>
              <div>
                <i>{t.input}</i>
                <h2>program.yaml</h2>
              </div>
              <b className={r.error ? "bad" : "ok"}>
                {r.error ? "Invalid YAML" : "Parsed"}
              </b>
            </header>
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
            />
          </article>
          {current && (
            <article>
              <header>
                <div>
                  <i>{t.definition}</i>
                  <h2>{current.label ?? "Untitled field"}</h2>
                </div>
              </header>
              <div className="grid">
                <label>
                  Concept ID
                  <input
                    value={current.concept_id ?? ""}
                    onChange={(e) => update({ concept_id: e.target.value })}
                  />
                </label>
                <label>
                  Display label
                  <input
                    value={current.label ?? ""}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                </label>
                <label>
                  Data type
                  <select
                    value={current.data_type ?? "unresolved"}
                    onChange={(e) => update({ data_type: e.target.value })}
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
                    onChange={(e) =>
                      update({
                        required:
                          e.target.value === "true"
                            ? true
                            : e.target.value === "false"
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
                  {t.source}
                  <input
                    value={current.source_refs?.[0]?.locator ?? ""}
                    onChange={(e) =>
                      update({ source_refs: [{ locator: e.target.value }] })
                    }
                  />
                </label>
                <label>
                  {t.status}
                  <select
                    value={current.coding?.status ?? "unresolved"}
                    onChange={(e) =>
                      update({
                        coding: { ...current.coding, status: e.target.value },
                      })
                    }
                  >
                    <option>unresolved</option>
                    <option>matched</option>
                    <option>not-applicable</option>
                  </select>
                </label>
                <label>
                  {t.rationale}
                  <input
                    value={current.coding?.rationale ?? ""}
                    onChange={(e) =>
                      update({
                        coding: {
                          ...current.coding,
                          rationale: e.target.value || null,
                        },
                      })
                    }
                  />
                </label>
              </div>
              <div className="cdash-tools">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void searchCdash()}
                  disabled={searching}
                >
                  {searching ? t.searching : t.search}
                </button>
                {candidates.length > 0 && (
                  <div className="candidate-list">
                    <strong>{t.candidates}</strong>
                    {candidates.map((candidate, index) => (
                      <div
                        className="candidate"
                        key={`${candidate.label}-${index}`}
                      >
                        <span>
                          <b>{candidate.label}</b>
                          <small>
                            {[
                              candidate.domain,
                              candidate.variable,
                              candidate.confidence,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                        <button
                          className="primary"
                          type="button"
                          onClick={() => selectCandidate(candidate)}
                        >
                          {t.choose}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          )}
        </section>
        <aside className="preview">
          <nav>
            {t.preview}{" "}
            <span>
              {t.diagnostics} ({r.issues.length})
            </span>
          </nav>
          {fields.length ? (
            <article className="form">
              <i>PREVIEW ONLY · REVIEW-GATED</i>
              <h2>{r.p?.selected_form?.title ?? "eCRF form"}</h2>
              {fields.map((f, i) => (
                <label key={i}>
                  {f.data_type === "boolean" ? (
                    <>
                      <input type="checkbox" /> {f.label}
                    </>
                  ) : (
                    <>
                      {f.label}
                      {f.required === true && <strong> *</strong>}
                      <input
                        type={
                          f.data_type === "date"
                            ? "date"
                            : f.data_type === "number"
                              ? "number"
                              : "text"
                        }
                      />
                    </>
                  )}
                </label>
              ))}
              <button className="primary" disabled>
                Submit form
              </button>
            </article>
          ) : (
            <p className="empty">
              YAML is required before fields can be rendered.
            </p>
          )}
          <div className="diagnostics">
            {r.error && <p className="error">{r.error}</p>}
            {r.issues.map((x) => (
              <p className="error" key={x}>
                {x}
              </p>
            ))}
            {!actor && (
              <p className="error">
                Authentication required: confirmed YAML must include the
                signed-in reviewer.
              </p>
            )}
            {note && <p className="success">{note}</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}
