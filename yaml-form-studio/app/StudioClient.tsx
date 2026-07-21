"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import { calculateBmi } from "./bmi.mjs";
import "./studio.css";

type Actor = { name: string; email: string } | null;
type RequiredValue = boolean | null | "unresolved";
type SourceRef = { locator?: string; confidence?: string; [key: string]: unknown };
type Coding = {
  status?: string;
  rationale?: string | null;
  standard?: string;
  model?: string;
  implementation_guide?: string;
  version?: string;
  domain?: string;
  variable?: string;
  source_url?: string;
  mapping_confidence_percent?: number | null;
  codelist?: { name?: string; submission_value?: string; ncit_code?: string; extensible?: boolean };
  [key: string]: unknown;
};
type FieldOption = {
  value?: string;
  label?: string;
  submission_value?: string;
  ncit_code?: string;
  [key: string]: unknown;
};
type BmiCalculation = {
  type: "bmi";
  height_concept_id: string;
  weight_concept_id: string;
  decimal_places: number;
};
type Field = {
  concept_id?: string;
  label?: string;
  purpose?: string;
  data_type?: string;
  required?: RequiredValue;
  unit?: string | null;
  range?: { minimum?: number | null; maximum?: number | null } | null;
  options?: FieldOption[];
  calculation?: BmiCalculation | null;
  source_refs?: SourceRef[];
  coding?: Coding;
  [key: string]: unknown;
};
type UnresolvedItem = {
  id?: string;
  severity?: string;
  question?: string;
  resolution?: unknown;
  [key: string]: unknown;
};
type CandidateForm = { candidate_id?: string; title?: string; [key: string]: unknown };
type Program = {
  project_id?: string;
  candidate_forms?: CandidateForm[];
  selected_form?: {
    candidate_id?: string;
    title?: string;
    approval_status?: string;
    fields?: Field[];
    [key: string]: unknown;
  };
  unresolved_items?: UnresolvedItem[];
  [key: string]: unknown;
};
type Review = { program: Program | null; fields: Field[]; issues: string[]; error: string };
type WritableFile = { write(data: string): Promise<void>; close(): Promise<void> };
type LocalFileHandle = { getFile(): Promise<File>; createWritable(): Promise<WritableFile> };

const blank = "# Open, upload, or paste a protocol-to-eCRF program.yaml.";
const MAX_YAML_BYTES = 2_000_000;
const copy = {
  en: {
    open: "Open YAML",
    save: "Save",
    download: "Download draft",
    confirm: "Confirm reviewed YAML",
    inventory: "Field inventory",
    preview: "Renderer preview",
    diagnostics: "Diagnostics",
    blockers: "BLOCKERS",
    required: "Required",
    optional: "Optional",
    unresolved: "Unresolved",
    mapping: "Search CDASHIG v2.1",
    applyOptions: "Apply options",
    parsed: "Parsed",
    invalid: "Invalid YAML",
  },
  zh: {
    open: "開啟 YAML",
    save: "儲存",
    download: "下載草稿",
    confirm: "確認已審閱 YAML",
    inventory: "欄位清單",
    preview: "表單預覽",
    diagnostics: "診斷資訊",
    blockers: "待解決項目",
    required: "必填",
    optional: "選填",
    unresolved: "未決定",
    mapping: "搜尋 CDASHIG v2.1",
    applyOptions: "套用選項",
    parsed: "解析成功",
    invalid: "YAML 無效",
  },
};

function unsafeYamlIssue(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_YAML_BYTES) return "YAML exceeds the 2 MiB limit.";
  if (/^\s*(?:%|---\s*$|\.\.\.\s*$)/m.test(raw)) return "YAML directives and multiple documents are not supported.";
  if (/(?:^|[\s[{,])(?:!<|![A-Za-z]|&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+|<<\s*:)/m.test(raw)) {
    return "Custom tags, anchors, aliases, and merge keys are not supported.";
  }
  return "";
}

function validate(raw: string): Review {
  try {
    const unsafe = unsafeYamlIssue(raw);
    if (unsafe) throw new Error(unsafe);
    const program = parse(raw, { uniqueKeys: true }) as Program;
    if (!program || typeof program !== "object" || Array.isArray(program)) throw new Error("A program.yaml mapping is required.");
    const fields = program.selected_form?.fields ?? [];
    const issues: string[] = [];
    if (!program.project_id) issues.push("project_id is required.");
    if (!program.selected_form?.candidate_id) issues.push("selected_form.candidate_id is required.");
    if (!fields.length) issues.push("selected_form.fields must contain at least one field.");

    const ids = new Set<string>();
    fields.forEach((field, index) => {
      const name = `Field ${index + 1}`;
      if (!field.concept_id) issues.push(`${name}: concept_id is required.`);
      else if (ids.has(field.concept_id)) issues.push(`${name}: duplicate concept_id '${field.concept_id}'.`);
      else ids.add(field.concept_id);
      if (!field.label) issues.push(`${name}: label is required.`);
      if (!field.data_type || field.data_type === "unresolved") issues.push(`${name}: data type is unresolved.`);
      if (field.required === undefined || field.required === null || field.required === "unresolved") {
        issues.push(`${name}: requiredness is unresolved.`);
      }
      if (!field.source_refs?.[0]?.locator) issues.push(`${name}: source locator is required.`);
      if (isBmiCalculation(field.calculation)) {
        if (field.data_type !== "number") issues.push(`${name}: BMI calculation requires number data type.`);
        if (field.calculation.decimal_places !== 2) issues.push(`${name}: BMI must be rounded to 2 decimal places.`);
        const height = fields.find((candidate) => candidate.concept_id === field.calculation?.height_concept_id);
        const weight = fields.find((candidate) => candidate.concept_id === field.calculation?.weight_concept_id);
        if (!height || height.data_type !== "number" || height.unit !== "cm") {
          issues.push(`${name}: BMI height source must be a number field measured in cm.`);
        }
        if (!weight || weight.data_type !== "number" || weight.unit !== "kg") {
          issues.push(`${name}: BMI weight source must be a number field measured in kg.`);
        }
      }
      const coding = field.coding;
      if (!coding?.status || coding.status === "unresolved") {
        issues.push(`${name}: CDISC status is unresolved.`);
      } else if (coding.status === "not-applicable" && !coding.rationale) {
        issues.push(`${name}: not-applicable requires a rationale.`);
      } else if (coding.status === "matched") {
        if (!coding.domain || !coding.variable) issues.push(`${name}: mapped domain and variable are required.`);
        if (!coding.standard || !coding.model || !coding.version) issues.push(`${name}: mapping standard, model, and version are required.`);
        if (!coding.source_url || !coding.rationale) issues.push(`${name}: mapping evidence URL and rationale are required.`);
        if (coding.mapping_confidence_percent == null) issues.push(`${name}: mapping confidence is required.`);
      }
    });

    (program.unresolved_items ?? [])
      .filter((item) => item.severity === "blocking" && !item.resolution)
      .forEach((item) => issues.push(`${item.id ?? "Blocking item"}: ${item.question ?? "Resolution required."}`));

    return { program, fields, issues, error: "" };
  } catch (error) {
    return { program: null, fields: [], issues: [], error: error instanceof Error ? error.message : "Invalid YAML." };
  }
}

function formTitle(program: Program | null) {
  const selected = program?.selected_form;
  if (selected?.title) return selected.title;
  return program?.candidate_forms?.find((form) => form.candidate_id === selected?.candidate_id)?.title ?? "YAML field review";
}

function fieldInputType(field: Field) {
  if (field.data_type === "date") return "date";
  if (field.data_type === "integer" || field.data_type === "number") return "number";
  return "text";
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isBmiCalculation(value: Field["calculation"]): value is BmiCalculation {
  return value?.type === "bmi";
}

function downloadText(text: string, fileName: string, type = "application/yaml") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function StudioClient() {
  const [yaml, setYaml] = useState(blank);
  const [selected, setSelected] = useState(0);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [note, setNote] = useState("");
  const [actor, setActor] = useState<Actor | undefined>(undefined);
  const [fileName, setFileName] = useState("program.yaml");
  const [fileHandle, setFileHandle] = useState<LocalFileHandle | null>(null);
  const [fieldFilter, setFieldFilter] = useState("");
  const [optionsDraft, setOptionsDraft] = useState("[]");
  const [optionsError, setOptionsError] = useState("");
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const review = useMemo(() => validate(yaml), [yaml]);
  const current = review.fields[selected] ?? review.fields[0];
  const t = copy[language];
  const ready = Boolean(actor && review.program && !review.error && !review.issues.length);
  const shownFields = review.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => `${field.concept_id ?? ""} ${field.label ?? ""}`.toLowerCase().includes(fieldFilter.toLowerCase()));
  const computedPreviewValues = useMemo(() => {
    const computed: Record<string, string> = {};
    review.fields.forEach((field) => {
      if (!field.concept_id || !isBmiCalculation(field.calculation)) return;
      computed[field.concept_id] = calculateBmi(
        previewValues[field.calculation.height_concept_id],
        previewValues[field.calculation.weight_concept_id],
        field.calculation.decimal_places,
      );
    });
    return computed;
  }, [review.fields, previewValues]);

  useEffect(() => {
    let active = true;
    void fetch("./program.yaml", { cache: "no-store" })
      .then(async (response) => {
        if (active && response.ok) {
          setYaml(await response.text());
          setFileName("program.yaml");
          setNote("Loaded the project Screening/Eligibility program.yaml.");
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
    setOptionsDraft(JSON.stringify(current?.options ?? [], null, 2));
    setOptionsError("");
  }, [selected, current?.concept_id, JSON.stringify(current?.options ?? [])]);

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

  const loadFile = async (file: File, handle: LocalFileHandle | null = null) => {
    setYaml(await file.text());
    setFileName(file.name || "program.yaml");
    setFileHandle(handle);
    setSelected(0);
    setPreviewValues({});
    setNote(`Loaded ${file.name}.`);
  };

  const openYaml = async () => {
    const pickerWindow = window as typeof window & {
      showOpenFilePicker?: (options: unknown) => Promise<LocalFileHandle[]>;
    };
    if (pickerWindow.showOpenFilePicker) {
      try {
        const [handle] = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: [{ description: "YAML", accept: { "application/yaml": [".yaml", ".yml"] } }],
        });
        if (handle) await loadFile(await handle.getFile(), handle);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    input.current?.click();
  };

  const saveYaml = async () => {
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(yaml);
      await writable.close();
      setNote(`Saved ${fileName}.`);
      return;
    }
    downloadText(yaml, `${review.program?.project_id ?? "program"}-draft.yaml`);
    setNote("Your browser downloaded a YAML draft because direct file saving is unavailable.");
  };

  const applyOptions = () => {
    try {
      const options = JSON.parse(optionsDraft) as unknown;
      if (!Array.isArray(options)) throw new Error("Options must be a JSON array.");
      if (options.some((option) => !option || typeof option !== "object" || Array.isArray(option))) {
        throw new Error("Every option must be an object.");
      }
      updateField({ options: options as FieldOption[] });
      setOptionsError("");
      setNote("Field options were written to YAML. This is a draft change, not approval.");
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : "Options are invalid.");
    }
  };

  const exportCdashRequest = () => {
    if (!current || !review.program) return;
    const request = {
      target: "CDASHIG v2.1",
      project_id: review.program.project_id,
      form_id: review.program.selected_form?.candidate_id,
      field: {
        concept_id: current.concept_id,
        label: current.label,
        purpose: current.purpose,
        data_type: current.data_type,
        unit: current.unit,
        options: current.options,
        source_refs: current.source_refs,
        current_coding: current.coding,
      },
      instruction: "Run the project map-cdashig-fields workflow and return candidates only. Do not write matched status without reviewer selection.",
    };
    downloadText(JSON.stringify(request, null, 2), `${current.concept_id ?? "field"}-cdashig-v2.1-request.json`, "application/json");
    setNote("Downloaded a metadata-only CDASHIG v2.1 review request. No mapping was changed.");
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

  const updateFirstSource = (locator: string) => {
    const refs = [...(current?.source_refs ?? [])];
    refs[0] = { ...(refs[0] ?? {}), locator };
    updateField({ source_refs: refs });
  };

  const updateCoding = (patch: Partial<Coding>) => updateField({ coding: { ...(current?.coding ?? {}), ...patch } });

  return (
    <div className="studio-shell" data-prj-id={review.program?.project_id ?? ""}>
      <header className="topbar">
        <div className="brand">
          <b>AirwayAI eCRF Studio</b>
          <small>Editable protocol-to-eCRF YAML review</small>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={() => void openYaml()}>{t.open}</button>
          <button type="button" className="ghost" disabled={!review.program} onClick={() => void saveYaml()}>{t.save}</button>
          <button type="button" className="primary" disabled={!ready} title={!ready ? "Resolve all blockers and sign in before confirmation." : undefined} onClick={() => void confirm()}>
            {t.confirm}
          </button>
          <button type="button" className="ghost" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>
            {language === "en" ? "繁體中文" : "English"}
          </button>
        </div>
        <input ref={input} className="hidden" type="file" accept=".yaml,.yml" onChange={(event) => event.target.files?.[0] && void loadFile(event.target.files[0])} />
      </header>

      <section className="contextbar">
        <div>
          <i>GATE A EDITOR</i>
          <h1>{formTitle(review.program)}</h1>
          <p>
            {actor === undefined ? "Checking reviewer identity…" : actor ? `Signed in as ${actor.name}` : "Draft editing is available. Sign-in is required only for confirmation."}
          </p>
        </div>
        <div className="summary">
          <b>{review.fields.length}<small>FIELDS</small></b>
          <b className={review.issues.length || review.error ? "bad" : "ok"}>{review.issues.length + (review.error ? 1 : 0)}<small>{t.blockers}</small></b>
        </div>
        <button type="button" className="secondary" disabled={!review.program} onClick={() => downloadText(yaml, `${review.program?.project_id ?? "program"}-draft.yaml`)}>{t.download}</button>
      </section>

      <main className="workspace">
        <aside>
          <h2>{t.inventory}</h2>
          <div className="field-filter"><input aria-label="Filter fields" placeholder="Filter fields…" value={fieldFilter} onChange={(event) => setFieldFilter(event.target.value)} /></div>
          {shownFields.map(({ field, index }) => (
            <button type="button" className={selected === index ? "field active" : "field"} onClick={() => setSelected(index)} key={`${field.concept_id}-${index}`}>
              <span className={`dot ${field.coding?.status ?? "unresolved"}`} />
              <b>{field.label ?? "Untitled field"}<small>{field.concept_id ?? "Missing concept ID"}</small></b>
              <em>{field.coding?.status ?? "unresolved"}</em>
            </button>
          ))}
        </aside>

        <section className="editor">
          <article>
            <header><div><i>SOURCE-CONTROLLED INPUT</i><h2>{fileName}</h2></div><b className={review.error ? "bad" : "ok"}>{review.error ? t.invalid : t.parsed}</b></header>
            <textarea aria-label="Raw YAML" value={yaml} onChange={(event) => setYaml(event.target.value)} spellCheck={false} />
          </article>

          {current && (
            <article>
              <header><div><i>FIELD DEFINITION</i><h2>{current.label}</h2></div><span className={`status-pill ${current.coding?.status ?? "unresolved"}`}>{current.coding?.status ?? "unresolved"}</span></header>
              <div className="grid">
                <label>Concept ID<input value={current.concept_id ?? ""} onChange={(event) => updateField({ concept_id: event.target.value })} /></label>
                <label>English display label<input value={current.label ?? ""} onChange={(event) => updateField({ label: event.target.value })} /></label>
                <label className="wide">Purpose<textarea value={current.purpose ?? ""} onChange={(event) => updateField({ purpose: event.target.value })} /></label>
                <label>Data type<select value={current.data_type ?? "unresolved"} onChange={(event) => updateField({ data_type: event.target.value })}>
                  <option>unresolved</option><option>string</option><option>integer</option><option>number</option><option>date</option><option>boolean</option>
                </select></label>
                <label>Requiredness<select value={current.required === true ? "true" : current.required === false ? "false" : "unresolved"} onChange={(event) => updateField({ required: event.target.value === "true" ? true : event.target.value === "false" ? false : null })}>
                  <option value="unresolved">{t.unresolved}</option><option value="true">{t.required}</option><option value="false">{t.optional}</option>
                </select></label>
                <label>Unit<input value={current.unit ?? ""} onChange={(event) => updateField({ unit: event.target.value || null })} /></label>
                <label>Minimum<input type="number" value={current.range?.minimum ?? ""} onChange={(event) => updateField({ range: { ...(current.range ?? {}), minimum: optionalNumber(event.target.value) } })} /></label>
                <label>Maximum<input type="number" value={current.range?.maximum ?? ""} onChange={(event) => updateField({ range: { ...(current.range ?? {}), maximum: optionalNumber(event.target.value) } })} /></label>
                <label className="wide">Source locator<input value={current.source_refs?.[0]?.locator ?? ""} onChange={(event) => updateFirstSource(event.target.value)} /></label>
                <label className="wide">Options (JSON array)<textarea className="options-editor" value={optionsDraft} onChange={(event) => setOptionsDraft(event.target.value)} /></label>
                <div className="wide inline-action"><button type="button" className="secondary" onClick={applyOptions}>{t.applyOptions}</button>{optionsError && <span className="bad">{optionsError}</span>}</div>
              </div>

              <div className="mapping-panel">
                <header><div><i>CDISC MAPPING</i><h2>Candidate review</h2></div><button type="button" className="secondary" onClick={exportCdashRequest}>{t.mapping}</button></header>
                <p className="mapping-note">This offline action exports field metadata for the project’s <code>map-cdashig-fields</code> workflow. It never invents or silently writes a mapping.</p>
                <div className="grid">
                  <label>CDISC status<select value={current.coding?.status ?? "unresolved"} onChange={(event) => updateCoding({ status: event.target.value })}><option>unresolved</option><option>matched</option><option>not-applicable</option></select></label>
                  <label>Mapping confidence (%)<input type="number" min="0" max="100" value={current.coding?.mapping_confidence_percent ?? ""} onChange={(event) => updateCoding({ mapping_confidence_percent: optionalNumber(event.target.value) })} /></label>
                  <label>Standard<input value={current.coding?.standard ?? ""} onChange={(event) => updateCoding({ standard: event.target.value || undefined })} /></label>
                  <label>Model<input value={current.coding?.model ?? ""} onChange={(event) => updateCoding({ model: event.target.value || undefined })} /></label>
                  <label>Implementation guide<input value={current.coding?.implementation_guide ?? ""} onChange={(event) => updateCoding({ implementation_guide: event.target.value || undefined })} /></label>
                  <label>Version<input value={current.coding?.version ?? ""} onChange={(event) => updateCoding({ version: event.target.value || undefined })} /></label>
                  <label>Domain<input value={current.coding?.domain ?? ""} onChange={(event) => updateCoding({ domain: event.target.value.toUpperCase() || undefined })} /></label>
                  <label>Variable<input value={current.coding?.variable ?? ""} onChange={(event) => updateCoding({ variable: event.target.value.toUpperCase() || undefined })} /></label>
                  <label className="wide">Evidence URL<input type="url" value={current.coding?.source_url ?? ""} onChange={(event) => updateCoding({ source_url: event.target.value || undefined })} /></label>
                  <label className="wide">Rationale<textarea value={current.coding?.rationale ?? ""} onChange={(event) => updateCoding({ rationale: event.target.value || null })} /></label>
                </div>
              </div>
            </article>
          )}
        </section>

        <aside className="preview">
          <nav>{t.preview}<span>{t.diagnostics} ({review.issues.length})</span></nav>
          {review.fields.length > 0 && (
            <form className="form" onSubmit={(event) => event.preventDefault()}>
              <i>PREVIEW ONLY · REVIEW-GATED</i>
              <h2>{formTitle(review.program)}</h2>
              {review.fields.map((field, index) => (
                <fieldset key={`${field.concept_id}-${index}`}>
                  <legend>{field.label}{field.required === true && <strong> *</strong>}</legend>
                  {field.options?.length ? (
                    field.options.length <= 4 ? <div className="choice-preview">{field.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`preview-${index}`} value={option.submission_value ?? option.value ?? ""} required={field.required === true} />{option.label ?? option.submission_value ?? option.value ?? `Option ${optionIndex + 1}`}</label>)}</div>
                    : <select aria-label={field.label} required={field.required === true} defaultValue=""><option value="" disabled>Select…</option>{field.options.map((option, optionIndex) => <option key={optionIndex} value={option.submission_value ?? option.value ?? ""}>{option.label ?? option.submission_value ?? option.value}</option>)}</select>
                  ) : field.data_type === "boolean" ? (
                    <div className="choice-preview"><label><input type="radio" name={`preview-${index}`} value="true" required={field.required === true} />Yes</label><label><input type="radio" name={`preview-${index}`} value="false" required={field.required === true} />No</label></div>
                  ) : isBmiCalculation(field.calculation) ? (
                    <input
                      aria-label={field.label}
                      className="computed-preview"
                      type="text"
                      inputMode="decimal"
                      value={field.concept_id ? computedPreviewValues[field.concept_id] ?? "" : ""}
                      placeholder="Calculated automatically"
                      readOnly
                    />
                  ) : <input
                    aria-label={field.label}
                    type={fieldInputType(field)}
                    required={field.required === true}
                    min={field.range?.minimum ?? undefined}
                    max={field.range?.maximum ?? undefined}
                    step={field.data_type === "number" ? "any" : undefined}
                    value={field.concept_id ? previewValues[field.concept_id] ?? "" : ""}
                    onChange={(event) => field.concept_id && setPreviewValues((values) => ({ ...values, [field.concept_id as string]: event.target.value }))}
                  />}
                  {field.unit && <small>Unit: {field.unit}</small>}
                  {isBmiCalculation(field.calculation) && (
                    <small aria-live="polite">
                      {computedPreviewValues[field.concept_id ?? ""]
                        ? `Calculated from ${review.fields.find((candidate) => candidate.concept_id === field.calculation?.weight_concept_id)?.label ?? field.calculation.weight_concept_id} and ${review.fields.find((candidate) => candidate.concept_id === field.calculation?.height_concept_id)?.label ?? field.calculation.height_concept_id}; rounded to ${field.calculation.decimal_places} decimal places.`
                        : "Enter height and weight to calculate BMI."}
                    </small>
                  )}
                  {field.source_refs?.[0]?.locator && <small>Source: {field.source_refs[0].locator}</small>}
                </fieldset>
              ))}
              <button type="submit" className="primary" disabled>Submit form</button>
            </form>
          )}
          <div className="diagnostics" aria-live="polite">
            {review.error && <p className="error">{review.error}</p>}
            {review.issues.map((issue, index) => <p className="error" key={`${issue}-${index}`}>{issue}</p>)}
            {actor === null && <p className="info">Authentication is required only for formal confirmation.</p>}
            {note && <p className="success">{note}</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}
