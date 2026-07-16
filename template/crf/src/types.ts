export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, unknown>;

export type LocalizedText = Record<string, string>;

export interface StructuredLink {
  label: LocalizedText;
  href: string;
}

export type ComparisonOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "contains";

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { op: "exists"; path: string }
  | { op: ComparisonOperator; path: string; value: JsonPrimitive | JsonPrimitive[] };

export type FieldWidget =
  | "text"
  | "textarea"
  | "integer"
  | "number"
  | "date"
  | "radio"
  | "select"
  | "checkbox_group"
  | "boolean"
  | "computed"
  | "coordinate_3d";

export interface FieldOption {
  value: JsonPrimitive;
  label: LocalizedText;
}

export interface FieldConfig {
  label: LocalizedText;
  description?: LocalizedText;
  help?: LocalizedText;
  placeholder?: LocalizedText;
  widget: FieldWidget;
  options?: FieldOption[];
  unit?: {
    code: string;
    display: LocalizedText;
  };
  links?: StructuredLink[];
  visibleWhen?: Predicate;
  enabledWhen?: Predicate;
  requiredWhen?: Predicate;
  coordinate?: {
    axes: ["x", "y", "z"];
    unitPath: string;
  };
}

export interface FieldLayout {
  type: "field";
  path: string;
  span?: 1 | 2 | 3;
}

export interface GroupLayout {
  type: "group";
  id: string;
  title?: LocalizedText;
  columns?: 1 | 2 | 3;
  items: FieldLayout[];
}

export interface SectionLayout {
  type: "section";
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  collapsible?: boolean;
  items: Array<FieldLayout | GroupLayout>;
}

export type NumericExpression =
  | { op: "value"; value: number }
  | { op: "path"; path: string }
  | {
      op: "add" | "subtract" | "multiply" | "divide";
      args: [NumericExpression, NumericExpression, ...NumericExpression[]];
    };

export interface AirwayAiExtension {
  contractVersion: "1.0.0";
  formId: string;
  schemaVersion: string;
  status: "demo" | "draft" | "released" | "retired";
  defaultLocale: string;
  locales: string[];
  title: LocalizedText;
  description?: LocalizedText;
  disclaimer?: LocalizedText;
  fields: Record<string, FieldConfig>;
  layout: SectionLayout[];
  computed: Record<string, NumericExpression>;
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaProperty;
  enum?: JsonPrimitive[];
  const?: JsonPrimitive;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  uniqueItems?: boolean;
  readOnly?: boolean;
  [keyword: string]: unknown;
}

export interface CrfContract {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  $id: string;
  title?: string;
  description?: string;
  type: "object";
  additionalProperties: false;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  "x-airwayai": AirwayAiExtension;
  [keyword: string]: unknown;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface FieldState {
  visible: boolean;
  enabled: boolean;
  required: boolean;
}

export interface DerivedFormState {
  displayData: JsonRecord;
  activeData: JsonRecord;
  fieldStates: Record<string, FieldState>;
  derivedPaths: string[];
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface FormSnapshot {
  data: JsonRecord;
  derivedPaths: string[];
  isValid: boolean;
}

export interface FormSubmission {
  formId: string;
  schemaVersion: string;
  contractVersion: "1.0.0";
  rendererVersion: string;
  locale: string;
  data: JsonRecord;
  derivedPaths: string[];
}

interface SharedRendererProps {
  schema: CrfContract;
  locale?: string;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export type FormRendererProps =
  | (SharedRendererProps & {
      mode?: "edit";
      initialData?: unknown;
      onChange?: (snapshot: FormSnapshot) => void;
      onSubmit: (submission: FormSubmission) => void | Promise<void>;
    })
  | (SharedRendererProps & {
      mode: "readonly";
      initialData: unknown;
      onChange?: never;
      onSubmit?: never;
    });

export class FormSubmissionError extends Error {
  public readonly displayMessage: string;

  public constructor(displayMessage: string, options?: ErrorOptions) {
    super(displayMessage, options);
    this.name = "FormSubmissionError";
    this.displayMessage = displayMessage;
  }
}
