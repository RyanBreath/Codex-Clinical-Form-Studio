import { compileContract } from "../contract";
import type {
  CrfContract,
  Diagnostic,
  FieldConfig,
  FieldOption,
  FieldWidget,
  JsonPrimitive,
  JsonSchemaProperty,
} from "../types";
import type { ProgramCoding, ProgramField, ProgramOption, ProgramTerm, ProgramYaml } from "./model";

export interface StudioDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface ProgramCompileResult {
  ok: boolean;
  contract?: CrfContract;
  diagnostics: StudioDiagnostic[];
}

const supportedDataTypes = new Set(["string", "number", "integer", "boolean", "date"]);

function error(code: string, message: string, path?: string): StudioDiagnostic {
  return { severity: "error", code, message, path };
}

function warning(code: string, message: string, path?: string): StudioDiagnostic {
  return { severity: "warning", code, message, path };
}

export function conceptIdToProperty(conceptId: string): string {
  const words = conceptId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .split(/[-_]+/)
    .filter(Boolean);
  const [first = "field", ...rest] = words;
  const value = `${first.toLowerCase()}${rest
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("")}`;
  return /^[a-z]/.test(value) ? value : `field${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function widgetFor(field: ProgramField): FieldWidget {
  if (field.options.length > 0) return field.options.length <= 5 ? "radio" : "select";
  switch (field.data_type) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    default:
      return (field.purpose?.length ?? 0) > 120 ? "textarea" : "text";
  }
}

function optionParts(option: string | number | boolean | ProgramOption): {
  value: JsonPrimitive;
  label: string;
} {
  if (typeof option === "object") {
    return { value: option.value, label: option.label };
  }
  return { value: option, label: String(option) };
}

function findTerm(terms: ProgramTerm[], value: JsonPrimitive): ProgramTerm | undefined {
  return terms.find(
    (term) => term.value === String(value) || term.submission_value === String(value),
  );
}

function compileOptions(field: ProgramField): FieldOption[] | undefined {
  const terms = field.coding.terms ?? [];
  const sourceOptions = field.options.length
    ? field.options
    : terms.map((term) => ({ value: term.submission_value, label: term.label }));
  if (!sourceOptions.length) return undefined;

  return sourceOptions.map((sourceOption) => {
    const { value, label } = optionParts(sourceOption);
    const term = findTerm(terms, value);
    const submissionValue = term?.submission_value ?? value;
    return {
      value: submissionValue,
      label: { "zh-TW": label },
      ...(term
        ? {
            coding: {
              system: term.system,
              code: term.ncit_code,
              submissionValue: term.submission_value,
              display: { "zh-TW": term.label },
              version: term.version ?? field.coding.version,
            },
          }
        : {}),
    };
  });
}

function compileCoding(coding: ProgramCoding): FieldConfig["coding"] | undefined {
  if (coding.status === "unresolved") return undefined;
  if (coding.status === "not-applicable") {
    return {
      status: "not-applicable",
      ...(coding.rationale ? { rationale: { "zh-TW": coding.rationale } } : {}),
    };
  }
  return {
    status: "matched",
    standard: "CDISC",
    ...(coding.model ? { model: coding.model } : {}),
    ...(coding.implementation_guide ? { implementationGuide: coding.implementation_guide } : {}),
    ...(coding.domain ? { domain: coding.domain.toUpperCase() } : {}),
    ...(coding.variable ? { variable: coding.variable.toUpperCase() } : {}),
    ...(coding.version ? { version: coding.version } : {}),
    ...(coding.source_url ? { source: coding.source_url } : {}),
    ...(coding.codelist
      ? {
          codelist: {
            name: coding.codelist.name,
            submissionValue: coding.codelist.submission_value,
            ncitCode: coding.codelist.ncit_code,
            extensible: coding.codelist.extensible,
          },
        }
      : {}),
  };
}

function validateField(field: ProgramField, index: number): StudioDiagnostic[] {
  const diagnostics: StudioDiagnostic[] = [];
  const path = `/selected_form/fields/${index}`;
  if (!field.concept_id.trim()) diagnostics.push(error("concept-id-required", "欄位缺少 concept_id。", path));
  if (!field.label.trim()) diagnostics.push(error("field-label-required", "欄位缺少顯示名稱。", path));
  if (!supportedDataTypes.has(field.data_type)) {
    diagnostics.push(error("field-data-type-unresolved", `「${field.label}」的資料型別尚未決定。`, path));
  }
  if (field.required === "unresolved") {
    diagnostics.push(error("field-requiredness-unresolved", `「${field.label}」的必填性尚未決定。`, path));
  }
  if (!field.source_refs?.length || field.source_refs.some((ref) => !ref.locator.trim())) {
    diagnostics.push(error("field-source-required", `「${field.label}」缺少 protocol 來源定位。`, path));
  }
  if (!field.coding?.status || field.coding.status === "unresolved") {
    diagnostics.push(error("field-coding-unresolved", `「${field.label}」的 CDISC 對應尚未決定。`, path));
  }
  if (field.coding.status === "not-applicable" && !field.coding.rationale?.trim()) {
    diagnostics.push(error("coding-rationale-required", `「${field.label}」標為不適用時必須填寫理由。`, path));
  }
  if (field.coding.status === "matched") {
    const coding = field.coding;
    if (!coding.model || !coding.version || !coding.source_url || (!coding.variable && !coding.codelist)) {
      diagnostics.push(
        error(
          "coding-mapping-incomplete",
          `「${field.label}」的 matched 對應需包含 model、version、source URL，以及 variable 或 codelist。`,
          path,
        ),
      );
    }
    if (coding.codelist) {
      const options = compileOptions(field) ?? [];
      if (!options.length || options.some((option) => !option.coding)) {
        diagnostics.push(
          error(
            "coded-options-required",
            `「${field.label}」使用 codelist 時，每個選項都必須有已確認的 NCIt/CDISC 編碼。`,
            path,
          ),
        );
      }
    }
  }
  if (
    field.inference?.kind === "inferred_supporting_field" &&
    field.inference.confidence_percent < 80
  ) {
    diagnostics.push(
      error(
        "inference-confidence-too-low",
        `「${field.label}」是推論輔助欄位，但信心低於 80%。`,
        path,
      ),
    );
  }
  return diagnostics;
}

function compileProperty(field: ProgramField, options: FieldOption[] | undefined): JsonSchemaProperty {
  const property: JsonSchemaProperty = {};
  if (field.data_type === "date") {
    property.type = "string";
    property.format = "date";
  } else {
    property.type = field.data_type as JsonSchemaProperty["type"];
  }
  if (field.range?.minimum != null) property.minimum = field.range.minimum;
  if (field.range?.maximum != null) property.maximum = field.range.maximum;
  if (options?.length) property.enum = options.map((option) => option.value);
  return property;
}

function compileFieldConfig(field: ProgramField, options: FieldOption[] | undefined): FieldConfig {
  return {
    label: { "zh-TW": field.label },
    ...(field.purpose ? { description: { "zh-TW": field.purpose } } : {}),
    widget: widgetFor(field),
    ...(options ? { options } : {}),
    ...(field.unit
      ? { unit: { code: field.unit, display: { "zh-TW": field.unit } } }
      : {}),
    ...(compileCoding(field.coding) ? { coding: compileCoding(field.coding) } : {}),
  };
}

function mapContractDiagnostics(diagnostics: Diagnostic[]): StudioDiagnostic[] {
  return diagnostics.map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.message,
    path: item.path,
  }));
}

export function compileProgram(program: ProgramYaml): ProgramCompileResult {
  const diagnostics: StudioDiagnostic[] = [];
  if (!program || typeof program !== "object") {
    return { ok: false, diagnostics: [error("program-invalid", "YAML 根節點必須是物件。", "/")] };
  }
  if (!program.project_id?.trim()) diagnostics.push(error("project-id-required", "缺少 project_id。"));
  if (!program.source?.file_name || !program.source?.sha256) {
    diagnostics.push(error("source-traceability-required", "source.file_name 與 source.sha256 為必要追溯資訊。"));
  }
  if (program.selected_form?.approval_status !== "approved") {
    diagnostics.push(error("gate-a-form-not-approved", "selected_form.approval_status 尚未核准。"));
  }
  if (program.approvals?.clinical_meaning?.status !== "approved") {
    diagnostics.push(error("gate-a-clinical-not-approved", "Gate A 臨床意義尚未核准。"));
  }
  for (const item of program.unresolved_items ?? []) {
    if (item.severity === "blocking" && !item.resolution?.trim()) {
      diagnostics.push(error("blocking-unresolved-item", `${item.id}: ${item.question}`, "/unresolved_items"));
    }
  }
  const fields = program.selected_form?.fields ?? [];
  if (!fields.length) diagnostics.push(error("fields-required", "所選表單至少需要一個欄位。"));
  fields.forEach((field, index) => diagnostics.push(...validateField(field, index)));

  const propertyNames = fields.map((field) => conceptIdToProperty(field.concept_id));
  const duplicates = propertyNames.filter((name, index) => propertyNames.indexOf(name) !== index);
  if (duplicates.length) {
    diagnostics.push(error("duplicate-field-path", `欄位 ID 轉換後重複：${[...new Set(duplicates)].join(", ")}`));
  }
  if (diagnostics.some((item) => item.severity === "error")) return { ok: false, diagnostics };

  const properties: Record<string, JsonSchemaProperty> = {};
  const fieldConfigs: Record<string, FieldConfig> = {};
  const required: string[] = [];
  for (const [index, field] of fields.entries()) {
    const propertyName = propertyNames[index];
    const path = `/${propertyName}`;
    const options = compileOptions(field);
    properties[propertyName] = compileProperty(field, options);
    fieldConfigs[path] = compileFieldConfig(field, options);
    if (field.required === true) required.push(propertyName);
  }

  const formId = program.selected_form.form_id;
  const schemaVersion = program.selected_form.schema_version;
  const contract: CrfContract = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://airwayai.example/forms/${formId}/${schemaVersion}`,
    $comment: `projectId=${program.project_id}; protocol=${program.source.file_name}; sha256=${program.source.sha256}`,
    title: program.selected_form.title,
    description: program.selected_form.purpose,
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
    "x-airwayai": {
      contractVersion: "1.1.0",
      formId,
      schemaVersion,
      status: "demo",
      defaultLocale: "zh-TW",
      locales: ["zh-TW"],
      title: { "zh-TW": program.selected_form.title },
      ...(program.selected_form.purpose
        ? { description: { "zh-TW": program.selected_form.purpose } }
        : {}),
      disclaimer: {
        "zh-TW": "本表單僅供 Demo／研究設計審查，不代表臨床正確性、法規提交適用性或 QMS 驗證完成。",
      },
      fields: fieldConfigs,
      layout: [
        {
          type: "section",
          id: "collected-fields",
          title: { "zh-TW": program.selected_form.title },
          ...(program.selected_form.purpose
            ? { description: { "zh-TW": program.selected_form.purpose } }
            : {}),
          items: fields.map((_, index) => ({ type: "field", path: `/${propertyNames[index]}` })),
        },
      ],
      computed: {},
    },
  };

  const compiled = compileContract(contract);
  if (!compiled.ok) {
    diagnostics.push(...mapContractDiagnostics(compiled.diagnostics));
    return { ok: false, contract, diagnostics };
  }
  diagnostics.push(...mapContractDiagnostics(compiled.value.diagnostics));
  if (program.approvals.form_contract.status !== "approved") {
    diagnostics.push(warning("gate-b-pending", "Gate B 尚未核准；可預覽，但不可視為已核准的發布包。"));
  }
  return { ok: true, contract, diagnostics };
}
