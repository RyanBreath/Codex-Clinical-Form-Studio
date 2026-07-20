"use client";

import { useMemo, useState } from "react";
import "./studio.css";

type Field = { name: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string };
type FormSpec = { title: string; description: string; submitLabel: string; fields: Field[] };

const starterYaml = `title: Visit Assessment
description: Complete the participant assessment below.
submitLabel: Save assessment
fields:
  - name: participant_id
    label: Participant ID
    type: text
    required: true
    placeholder: e.g. PT-001
  - name: visit_date
    label: Visit date
    type: date
    required: true
  - name: symptom_severity
    label: Symptom severity
    type: select
    options: [None, Mild, Moderate, Severe]
  - name: clinical_notes
    label: Clinical notes
    type: textarea
    placeholder: Enter observations`;

const copy = {
  en: { badge: "YAML → HTML", title: "Form Studio", subtitle: "Turn a YAML definition into a ready-to-use HTML form.", editor: "YAML definition", preview: "Live preview", fields: "fields", download: "Download HTML", reset: "Reset example", status: "Ready to generate", language: "中文", help: "Use text, email, number, date, textarea, checkbox, or select." },
  zh: { badge: "YAML → HTML", title: "表單工作室", subtitle: "將 YAML 定義轉換成可直接使用的 HTML 表單。", editor: "YAML 定義", preview: "即時預覽", fields: "個欄位", download: "下載 HTML", reset: "還原範例", status: "已可產生 HTML", language: "English", help: "支援 text、email、number、date、textarea、checkbox 與 select。" },
};

function scalar(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\[.*\]$/.test(trimmed)) return trimmed.slice(1, -1).split(",").map((v) => v.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  return trimmed;
}

function parseYaml(source: string): FormSpec {
  if (source.trim().startsWith("{")) return JSON.parse(source) as FormSpec;
  const result: Record<string, unknown> = { fields: [] };
  let active: Record<string, unknown> | null = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("- ")) {
      active = {};
      (result.fields as Record<string, unknown>[]).push(active);
      const [key, ...rest] = line.slice(2).split(":");
      if (key && rest.length) active[key.trim()] = scalar(rest.join(":"));
      continue;
    }
    const [key, ...rest] = line.split(":");
    if (!key || !rest.length) continue;
    const value = scalar(rest.join(":"));
    if (raw.startsWith(" ") && active) active[key.trim()] = value;
    else if (key.trim() !== "fields") result[key.trim()] = value;
  }
  const fields = (result.fields as Field[]).filter((field) => field.name && field.label && field.type);
  if (!fields.length) throw new Error("Add at least one field with name, label, and type.");
  return { title: String(result.title || "Untitled form"), description: String(result.description || ""), submitLabel: String(result.submitLabel || "Submit"), fields };
}

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);

function makeHtml(form: FormSpec) {
  const renderField = (field: Field) => {
    const required = field.required ? " required" : "";
    const label = `<label for="${escapeHtml(field.name)}">${escapeHtml(field.label)}${field.required ? " <span>*</span>" : ""}</label>`;
    if (field.type === "textarea") return `<div class="field">${label}<textarea id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || "")}"${required}></textarea></div>`;
    if (field.type === "select") return `<div class="field">${label}<select id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}"${required}><option value="">Select an option</option>${(field.options || []).map((option) => `<option>${escapeHtml(option)}</option>`).join("")}</select></div>`;
    if (field.type === "checkbox") return `<div class="check"><input id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" type="checkbox"${required}><label for="${escapeHtml(field.name)}">${escapeHtml(field.label)}</label></div>`;
    return `<div class="field">${label}<input id="${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" type="${escapeHtml(field.type)}" placeholder="${escapeHtml(field.placeholder || "")}"${required}></div>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(form.title)}</title><style>body{margin:0;background:#f4f7fb;color:#17223b;font:16px system-ui,sans-serif}.card{max-width:680px;margin:48px auto;background:white;padding:36px;border-radius:18px;box-shadow:0 12px 36px #19365a18}h1{margin:0;font-size:28px}.intro{color:#5c6c84;margin:10px 0 28px}.field{display:grid;gap:8px;margin:18px 0}label{font-weight:650}label span{color:#d1495b}input,textarea,select{font:inherit;border:1px solid #cbd5e1;border-radius:9px;padding:12px;box-sizing:border-box;width:100%}textarea{min-height:110px;resize:vertical}.check{display:flex;gap:9px;align-items:center;margin:18px 0}.check input{width:auto}button{border:0;border-radius:9px;padding:13px 18px;background:#0969da;color:#fff;font-weight:700;font:inherit;cursor:pointer}</style></head><body><main class="card"><h1>${escapeHtml(form.title)}</h1>${form.description ? `<p class="intro">${escapeHtml(form.description)}</p>` : ""}<form>${form.fields.map(renderField).join("")}<button type="submit">${escapeHtml(form.submitLabel)}</button></form></main></body></html>`;
}

export default function Home() {
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [yaml, setYaml] = useState(starterYaml);
  const parsed = useMemo(() => { try { return { form: parseYaml(yaml), error: "" }; } catch (issue) { return { form: null, error: issue instanceof Error ? issue.message : "Invalid YAML" }; } }, [yaml]);
  const form = parsed.form;
  const html = form ? makeHtml(form) : "";
  const t = copy[language];
  const download = () => { const blob = new Blob([html], { type: "text/html" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${(form?.title || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`; link.click(); URL.revokeObjectURL(url); };
  return <main className="studio-shell">
    <header className="topbar"><div><p className="eyebrow">{t.badge}</p><h1>{t.title}</h1><p className="subtitle">{t.subtitle}</p></div><button className="language" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{t.language}</button></header>
    <section className="workspace">
      <article className="panel editor-panel"><div className="panel-heading"><div><span className="step">01</span><h2>{t.editor}</h2></div><button className="text-button" onClick={() => setYaml(starterYaml)}>{t.reset}</button></div><textarea aria-label={t.editor} value={yaml} onChange={(event) => setYaml(event.target.value)} spellCheck="false" /><p className="hint">{t.help}</p>{parsed.error ? <p className="error">{parsed.error}</p> : <p className="ready">● {t.status}</p>}</article>
      <article className="panel preview-panel"><div className="panel-heading"><div><span className="step">02</span><h2>{t.preview}</h2></div>{form && <span className="count">{form.fields.length} {t.fields}</span>}</div>{form ? <iframe title="Generated form preview" srcDoc={html} sandbox="allow-forms" /> : <div className="empty">Fix the YAML to restore the preview.</div>}<button className="download" onClick={download} disabled={!form}>{t.download} <span>↓</span></button></article>
    </section>
  </main>;
}
