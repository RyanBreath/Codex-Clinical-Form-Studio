"use client";

import { useMemo, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import "./studio.css";

type Actor = { name: string; email: string } | null;
type Coding = { status?: string; rationale?: string | null; domain?: string; variable?: string; source_url?: string; [key: string]: unknown };
type Field = { concept_id?: string; label?: string; data_type?: string; required?: boolean | "unresolved"; source_refs?: { locator?: string }[]; coding?: Coding; [key: string]: unknown };
type Program = { project_id?: string; selected_form?: { candidate_id?: string; title?: string; fields?: Field[]; [key: string]: unknown }; [key: string]: unknown };

const blank = "# Upload or paste a protocol-to-eCRF program.yaml.";
const labels = {
  en: { upload: "Upload YAML", confirm: "Confirm reviewed YAML", download: "Download YAML", inventory: "Field inventory", preview: "Form preview", blockers: "BLOCKERS", required: "Required", optional: "Optional" },
  zh: { upload: "上傳 YAML", confirm: "確認已審閱 YAML", download: "下載 YAML", inventory: "欄位清單", preview: "表單預覽", blockers: "阻擋項目", required: "必填", optional: "選填" },
};

function validate(raw: string) {
  try {
    if (/^\s*(---|%|!|&|\*|<<:)/m.test(raw)) throw new Error("Unsafe YAML construct is not supported.");
    const program = parse(raw) as Program;
    const fields = program?.selected_form?.fields ?? [];
    const issues: string[] = [];
    if (!program?.project_id) issues.push("project_id is required.");
    if (!program?.selected_form?.candidate_id) issues.push("selected_form.candidate_id is required.");
    if (!fields.length) issues.push("selected_form.fields must contain at least one field.");
    fields.forEach((field, index) => {
      const name = `Field ${index + 1}`;
      if (!field.concept_id) issues.push(`${name}: concept_id is required.`);
      if (!field.label) issues.push(`${name}: label is required.`);
      if (!field.data_type || field.data_type === "unresolved") issues.push(`${name}: data type is unresolved.`);
      if (field.required === undefined || field.required === "unresolved") issues.push(`${name}: requiredness is unresolved.`);
      if (!field.source_refs?.[0]?.locator) issues.push(`${name}: source locator is required.`);
      if (!field.coding?.status || field.coding.status === "unresolved") issues.push(`${name}: CDISC status is unresolved.`);
    });
    return { program, fields, issues, error: "" };
  } catch (error) {
    return { program: null, fields: [], issues: [], error: error instanceof Error ? error.message : "Invalid YAML." };
  }
}

export default function StudioClient({ actor }: { actor: Actor }) {
  const [yaml, setYaml] = useState(blank);
  const [selected, setSelected] = useState(0);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const review = useMemo(() => validate(yaml), [yaml]);
  const current = review.fields[selected] ?? review.fields[0];
  const t = labels[language];
  const ready = Boolean(actor && review.program && !review.error && !review.issues.length);

  const updateField = (patch: Partial<Field>) => {
    if (!review.program) return;
    const program = structuredClone(review.program);
    const field = program.selected_form?.fields?.[selected];
    if (!field) return;
    Object.assign(field, patch);
    setYaml(stringify(program));
  };
  const load = async (file?: File) => {
    if (!file) return;
    setYaml(await file.text());
    setSelected(0);
    setNote(`Loaded ${file.name}.`);
  };
  const confirm = async () => {
    if (!ready) return;
    const response = await fetch("/api/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml }) });
    const result = (await response.json()) as { yaml?: string; error?: string };
    if (!response.ok || !result.yaml) return setNote(result.error ?? "Confirmation failed.");
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

  return <div className="studio-shell">
    <header className="topbar"><div className="brand"><b>AirwayAI eCRF Studio</b><small>Editable protocol-to-eCRF YAML review</small></div><div><button className="ghost" onClick={() => input.current?.click()}>{t.upload}</button><button className="primary" disabled={!ready} onClick={() => void confirm()}>{t.confirm}</button><button className="ghost" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{language === "en" ? "繁體中文" : "English"}</button></div><input ref={input} className="hidden" type="file" accept=".yaml,.yml" onChange={(event) => void load(event.target.files?.[0])}/></header>
    <section className="contextbar"><div><i>REVIEW GATE</i><h1>{review.program?.selected_form?.title ?? "YAML field review"}</h1><p>{actor ? `Signed in as ${actor.name}` : "Sign in is required to confirm YAML."}</p></div><div className="summary"><b>{review.fields.length}<small>FIELDS</small></b><b className={review.issues.length || review.error ? "bad" : "ok"}>{review.issues.length + (review.error ? 1 : 0)}<small>{t.blockers}</small></b></div><button className="secondary" disabled={!review.program} onClick={download}>{t.download}</button></section>
    <main className="workspace"><aside><h2>{t.inventory}</h2>{review.fields.map((field, index) => <button className={selected === index ? "field active" : "field"} onClick={() => setSelected(index)} key={`${field.concept_id}-${index}`}><span className={`dot ${field.coding?.status ?? "unresolved"}`}/><b>{field.label ?? "Untitled field"}<small>{field.concept_id ?? "Missing concept ID"}</small></b><em>{field.coding?.status ?? "unresolved"}</em></button>)}</aside>
      <section className="editor"><article><header><div><i>SOURCE-CONTROLLED INPUT</i><h2>program.yaml</h2></div><b className={review.error ? "bad" : "ok"}>{review.error ? "Invalid YAML" : "Parsed"}</b></header><textarea value={yaml} onChange={(event) => setYaml(event.target.value)} spellCheck={false}/></article>{current && <article><header><div><i>FIELD DEFINITION</i><h2>{current.label}</h2></div></header><div className="grid"><label>Concept ID<input value={current.concept_id ?? ""} onChange={(event) => updateField({ concept_id: event.target.value })}/></label><label>English display label<input value={current.label ?? ""} onChange={(event) => updateField({ label: event.target.value })}/></label><label>Data type<select value={current.data_type ?? "unresolved"} onChange={(event) => updateField({ data_type: event.target.value })}><option>unresolved</option><option>string</option><option>integer</option><option>number</option><option>date</option><option>boolean</option></select></label><label>{t.required}<select value={String(current.required ?? "unresolved")} onChange={(event) => updateField({ required: event.target.value === "true" ? true : event.target.value === "false" ? false : "unresolved" })}><option>unresolved</option><option value="true">{t.required}</option><option value="false">{t.optional}</option></select></label><label className="wide">Source locator<input value={current.source_refs?.[0]?.locator ?? ""} onChange={(event) => updateField({ source_refs: [{ locator: event.target.value }] })}/></label><label>CDISC status<select value={current.coding?.status ?? "unresolved"} onChange={(event) => updateField({ coding: { ...current.coding, status: event.target.value } })}><option>unresolved</option><option>matched</option><option>not-applicable</option></select></label><label>Rationale<input value={current.coding?.rationale ?? ""} onChange={(event) => updateField({ coding: { ...current.coding, rationale: event.target.value || null } })}/></label><label>CDASH domain<input value={current.coding?.domain ?? ""} onChange={(event) => updateField({ coding: { ...current.coding, domain: event.target.value.toUpperCase() || undefined } })}/></label><label>CDASH variable<input value={current.coding?.variable ?? ""} onChange={(event) => updateField({ coding: { ...current.coding, variable: event.target.value.toUpperCase() || undefined } })}/></label><label className="wide">Evidence URL<input value={current.coding?.source_url ?? ""} onChange={(event) => updateField({ coding: { ...current.coding, source_url: event.target.value || undefined } })}/></label></div></article>}</section>
      <aside className="preview"><nav>{t.preview}<span>Diagnostics ({review.issues.length})</span></nav>{review.fields.length > 0 && <article className="form"><i>PREVIEW ONLY · REVIEW-GATED</i><h2>{review.program?.selected_form?.title}</h2>{review.fields.map((field, index) => <label key={index}>{field.data_type === "boolean" ? <><input type="checkbox"/> {field.label}</> : <>{field.label}{field.required === true && <strong> *</strong>}<input type={field.data_type === "date" ? "date" : field.data_type === "integer" || field.data_type === "number" ? "number" : "text"}/></>}</label>)}<button className="primary" disabled>Submit form</button></article>}<div className="diagnostics">{review.error && <p className="error">{review.error}</p>}{review.issues.map((issue) => <p className="error" key={issue}>{issue}</p>)}{!actor && <p className="error">Authentication is required for confirmation.</p>}{note && <p className="success">{note}</p>}</div></aside></main>
  </div>;
}
