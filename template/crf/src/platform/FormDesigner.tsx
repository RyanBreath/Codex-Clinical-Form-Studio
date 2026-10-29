import { useMemo, useState } from "react";
import { parse } from "yaml";
import { compileContract } from "../contract";
import { FormRenderer } from "../FormRenderer";
import { resolveSchemaProperty } from "../pointer";
import { compileProgram } from "../studio/compiler";
import type { ProgramYaml } from "../studio/model";
import type { CrfContract, FieldConfig, JsonSchemaProperty } from "../types";

export function emptyContract(title = "新研究表單"): CrfContract {
  const formId = "form-" + crypto.randomUUID();
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://airwayai.example/forms/${formId}/1.0.0`,
    type: "object", additionalProperties: false, properties: { field1: { type: "string", maxLength: 500 } },
    "x-airwayai": {
      contractVersion: "1.2.0", formId, schemaVersion: "1.0.0", status: "draft", defaultLocale: "zh-TW", locales: ["zh-TW"], title: { "zh-TW": title },
      fields: { "/field1": { label: { "zh-TW": "新欄位" }, widget: "text", coding: { status: "unresolved" } } },
      layout: [{ type: "section", id: "main", title: { "zh-TW": "研究資料" }, items: [{ type: "field", path: "/field1" }] }], computed: {},
    },
  };
}
interface Props { contract: CrfContract; onChange: (next: CrfContract) => void; onImportSource: (source: string) => void; disabled: boolean }
export function FormDesigner({ contract, onChange, onImportSource, disabled }: Props) {
  const [selected, setSelected] = useState(Object.keys(contract["x-airwayai"].fields)[0]);
  const [importError, setImportError] = useState("");
  const compiled = useMemo(() => compileContract(contract), [contract]);
  const fields = contract["x-airwayai"].fields;
  const path = fields[selected] ? selected : Object.keys(fields)[0];
  const field = fields[path];
  const property = resolveSchemaProperty(contract.properties, path);
  const edit = (change: (next: CrfContract, config: FieldConfig, schema: JsonSchemaProperty) => void) => {
    const next = structuredClone(contract); const schema = resolveSchemaProperty(next.properties, path);
    if (!schema) return; change(next, next["x-airwayai"].fields[path], schema); onChange(next);
  };
  const add = () => {
    const next = structuredClone(contract); const key = "field_" + crypto.randomUUID().slice(0, 8); const p = "/" + key;
    next.properties[key] = { type: "string", maxLength: 500 };
    next["x-airwayai"].fields[p] = { label: { "zh-TW": "新欄位" }, widget: "text", coding: { status: "unresolved" } };
    next["x-airwayai"].layout[0].items.push({ type: "field", path: p }); onChange(next); setSelected(p);
  };
  const remove = () => {
    if (Object.keys(fields).length <= 1 || !window.confirm(`確定移除「${field.label["zh-TW"] ?? path}」？`)) return;
    const next = structuredClone(contract); const tokens = path.slice(1).split("/");
    if (tokens.length !== 1) { setImportError("巢狀欄位請透過來源規格修改，避免破壞群組關聯。"); return; }
    delete next.properties[tokens[0]]; delete next["x-airwayai"].fields[path]; delete next["x-airwayai"].computed[path];
    next.required = next.required?.filter(k => k !== tokens[0]);
    next["x-airwayai"].layout.forEach(section => {
      section.items = section.items.filter(item => item.type !== "field" || item.path !== path);
      section.items.forEach(item => { if (item.type === "group") item.items = item.items.filter(f => f.path !== path); });
    }); onChange(next);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("來源檔案不可超過 2 MB。");
      const text = await file.text(); let next: CrfContract;
      if (/\.ya?ml$/i.test(file.name)) {
        const result = compileProgram(parse(text, { maxAliasCount: 0 }) as ProgramYaml, { draft: true });
        if (!result.ok || !result.contract) throw new Error(result.diagnostics.map(x => x.message).join("\n"));
        next = result.contract; onImportSource(text);
      } else { next = JSON.parse(text) as CrfContract; onImportSource(""); }
      const result = compileContract(next); if (!result.ok) throw new Error(result.diagnostics.map(x => x.message).join("\n"));
      onChange(next); setSelected(Object.keys(next["x-airwayai"].fields)[0]); setImportError("");
    } catch (error) { setImportError(error instanceof Error ? error.message : "無法匯入。"); }
  };
  return <div className="designer-grid">
    <section className="panel designer-fields">
      <div className="section-heading"><h3>欄位清單</h3><button type="button" disabled={disabled} onClick={add}>＋ 新增欄位</button></div>
      <label className="upload-label">匯入 YAML／JSON 草稿<input type="file" disabled={disabled} accept=".yaml,.yml,.json" onChange={e => void importFile(e.target.files?.[0])} /></label>
      {importError && <p className="alert error" role="alert">{importError}</p>}
      <nav aria-label="表單欄位">{Object.entries(fields).map(([p, f]) => <button type="button" className={p === path ? "field-choice selected" : "field-choice"} key={p} onClick={() => setSelected(p)}><span>{f.label["zh-TW"] ?? f.label[contract["x-airwayai"].defaultLocale] ?? p}</span><small>{f.widget} · {f.coding?.status === "matched" ? "已確認對應" : "待對應"}</small></button>)}</nav>
    </section>
    <section className="panel">
      <h3>欄位設定</h3>
      {field && property && <fieldset disabled={disabled} className="stack">
        <label>顯示名稱<input value={field.label["zh-TW"] ?? ""} onChange={e => edit((_, f) => { f.label["zh-TW"] = e.target.value; })} /></label>
        <p className="muted">固定識別：<code>{path}</code>（更名不改變識別）</p>
        {!!field.sourceRefs?.length && <details><summary>欄位來源追溯</summary>{field.sourceRefs.map((ref, i) => <p key={i} className="muted">{ref.document} · {ref.locator}{ref.sha256 && <><br /><code>{ref.sha256}</code></>}</p>)}</details>}
        <label>欄位元件<select value={field.widget} onChange={e => edit((_, f, s) => {
          const widget = e.target.value as FieldConfig["widget"]; f.widget = widget;
          s.type = widget === "integer" ? "integer" : widget === "number" ? "number" : widget === "boolean" ? "boolean" : "string";
          if (widget === "date") s.format = "date"; else delete s.format;
          if (widget !== "select" && widget !== "radio") { delete f.options; delete s.enum; }
          if (s.type !== "number" && s.type !== "integer") { delete s.minimum; delete s.maximum; }
          if (s.type !== "string") { delete s.minLength; delete s.maxLength; delete s.pattern; }
        })}><option value="text">單行文字</option><option value="textarea">多行文字</option><option value="number">數值</option><option value="integer">整數</option><option value="date">日期</option><option value="boolean">是／否</option><option value="select">下拉選單</option><option value="radio">單選</option>{!["text", "textarea", "number", "integer", "date", "boolean", "select", "radio"].includes(field.widget) && <option value={field.widget}>{field.widget}（由來源設定）</option>}</select></label>
        {!path.slice(1).includes("/") && !field.visibleWhen && !field.enabledWhen && <label className="check"><input type="checkbox" checked={contract.required?.includes(path.slice(1)) ?? false} onChange={e => edit(next => { const required = new Set(next.required ?? []); if (e.target.checked) required.add(path.slice(1)); else required.delete(path.slice(1)); next.required = [...required]; })} />必填欄位</label>}
        {(property.type === "number" || property.type === "integer") && <div className="two-columns">{(["minimum", "maximum"] as const).map(key => <label key={key}>{key === "minimum" ? "最小值" : "最大值"}<input type="number" value={property[key] ?? ""} onChange={e => edit((_, __, s) => { if (e.target.value === "") delete s[key]; else s[key] = Number(e.target.value); })} /></label>)}</div>}
        {property.type === "string" && <label>字數上限<input type="number" min="1" value={property.maxLength ?? ""} onChange={e => edit((_, __, s) => { if (e.target.value === "") delete s.maxLength; else s.maxLength = Number(e.target.value); })} /></label>}
        {(field.widget === "select" || field.widget === "radio") && <label>選項（每行：代碼 | 顯示文字）<textarea rows={4} value={field.options?.map(o => `${o.value} | ${o.label["zh-TW"] ?? o.value}`).join("\n") ?? ""} onChange={e => edit((_, f, s) => {
          f.options = e.target.value.split("\n").filter(Boolean).map(line => { const [value, ...label] = line.split("|"); return { value: value.trim(), label: { "zh-TW": label.join("|").trim() || value.trim() } }; }); s.enum = f.options.map(o => o.value);
        })} /></label>}
        <label>說明<textarea value={field.description?.["zh-TW"] ?? ""} onChange={e => edit((_, f) => { f.description = { "zh-TW": e.target.value }; })} /></label>
        <details><summary>條件顯示</summary><label>當另一欄位等於指定值才顯示<select value={field.visibleWhen && "path" in field.visibleWhen ? field.visibleWhen.path : ""} onChange={e => edit((next, f) => {
          if (!e.target.value) { delete f.visibleWhen; delete f.requiredWhen; } else { f.visibleWhen = { op: "eq", path: e.target.value, value: true }; next.required = next.required?.filter(k => "/" + k !== path); }
        })}><option value="">一律顯示</option>{Object.keys(fields).filter(p => p !== path && fields[p].widget !== "computed").map(p => <option key={p} value={p}>{fields[p].label["zh-TW"] ?? p}</option>)}</select></label>
          {field.visibleWhen && "path" in field.visibleWhen && <><label>比較值<input value={String("value" in field.visibleWhen ? field.visibleWhen.value : "")} onChange={e => edit((_, f) => { if (f.visibleWhen && "path" in f.visibleWhen) { let value: string | number | boolean = e.target.value; try { const parsed: unknown = JSON.parse(value); if (["number", "boolean", "string"].includes(typeof parsed)) value = parsed as string | number | boolean; } catch { /* Keep text literal. */ } f.visibleWhen = { op: "eq", path: f.visibleWhen.path, value }; if (f.requiredWhen) f.requiredWhen = structuredClone(f.visibleWhen); } })} /></label><label className="check"><input type="checkbox" checked={!!field.requiredWhen} onChange={e => edit((_, f) => { if (e.target.checked && f.visibleWhen) f.requiredWhen = structuredClone(f.visibleWhen); else delete f.requiredWhen; })} />顯示時必填</label></>}
        </details>
        <details><summary>CDISC 對應（人工確認）</summary><label>對應狀態<select value={field.coding?.status ?? "unresolved"} onChange={e => edit((next, f) => { next["x-airwayai"].contractVersion = "1.2.0"; f.coding = { ...f.coding, status: e.target.value as "matched" | "unresolved" | "not-applicable", ...(e.target.value === "matched" ? { standard: "CDISC" as const } : {}) }; })}><option value="unresolved">待確認</option><option value="matched">已確認對應</option><option value="not-applicable">不適用（須理由）</option></select></label>
          {field.coding?.status === "matched" && ([ ["model", "模型（例如 CDASHIG）"], ["version", "標準版本"], ["domain", "Domain"], ["variable", "Variable"], ["source", "官方來源 URL"] ] as const).map(([key, label]) => <label key={key}>{label}<input value={field.coding?.[key] ?? ""} onChange={e => edit((_, f) => { f.coding = { ...(f.coding ?? { status: "unresolved" }), [key]: e.target.value }; })} /></label>)}
          <label>決策理由<textarea value={field.coding?.rationale?.["zh-TW"] ?? ""} onChange={e => edit((_, f) => { f.coding = { ...(f.coding ?? { status: "unresolved" }), rationale: { "zh-TW": e.target.value } }; })} /></label>
        </details>
        <button type="button" className="danger" disabled={Object.keys(fields).length <= 1} onClick={remove}>移除此欄位</button>
      </fieldset>}
    </section>
    <section className="panel designer-preview"><div className="section-heading"><h3>即時預覽</h3><span className="badge">不儲存填答</span></div>
      {compiled.ok ? <FormRenderer key={contract["x-airwayai"].formId} schema={contract} context="preview" locale="zh-TW" onSubmit={() => undefined} /> : <div className="alert error" role="alert"><strong>請修正規格後預覽</strong><ul>{compiled.diagnostics.map((d, i) => <li key={i}>{d.message}</li>)}</ul></div>}
    </section>
  </div>;
}
