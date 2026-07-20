export type CodingStatus = "matched" | "not-applicable" | "unresolved";
export type ApprovalStatus = "pending" | "approved";
export type FieldDataType = "string" | "number" | "integer" | "boolean" | "date" | "unresolved";

export interface ProgramSourceRef {
  locator: string;
  confidence: "high" | "medium" | "low";
}

export interface ProgramTerm {
  value: string;
  submission_value: string;
  system: string;
  ncit_code: string;
  label: string;
  version?: string;
}

export interface ProgramCodelist {
  name: string;
  submission_value: string;
  ncit_code: string;
  extensible: boolean;
}

export interface ProgramCoding {
  status: CodingStatus;
  rationale?: string | null;
  standard?: "CDISC";
  model?: string;
  implementation_guide?: string;
  domain?: string;
  variable?: string;
  version?: string;
  source_url?: string;
  mapping_confidence_percent?: number;
  codelist?: ProgramCodelist;
  terms?: ProgramTerm[];
}

export interface ProgramOption {
  value: string;
  label: string;
}

export interface ProgramField {
  concept_id: string;
  label: string;
  purpose?: string;
  data_type: FieldDataType | string;
  required: boolean | "unresolved";
  unit?: string | null;
  range?: {
    minimum?: number | null;
    maximum?: number | null;
  };
  options: Array<string | number | boolean | ProgramOption>;
  source_refs: ProgramSourceRef[];
  notes?: string[];
  inference?: {
    kind: "protocol_explicit" | "inferred_supporting_field";
    rationale?: string | null;
    confidence_percent: number;
  };
  coding: ProgramCoding;
}

export interface ProgramYaml {
  contract_version: string;
  project_id: string;
  source: {
    file_name: string;
    sha256: string;
    protocol_title: string;
    protocol_version: string;
    protocol_date?: string;
    extraction_method: "native-text" | "ocr" | "mixed";
    extracted_at: string;
  };
  terminology_sources: Array<{
    standard: string;
    model: string;
    publication: string;
    version: string;
    source_url: string;
    retrieved_at: string;
  }>;
  candidate_forms: Array<Record<string, unknown>>;
  selected_form: {
    candidate_id: string;
    title: string;
    purpose?: string;
    visit?: string;
    approval_status: ApprovalStatus;
    form_id: string;
    schema_version: string;
    schema_path?: string;
    validation_report_path?: string;
    fields: ProgramField[];
  };
  unresolved_items: Array<{
    id: string;
    severity: "blocking" | "warning";
    question: string;
    affected_concepts: string[];
    source_refs?: Array<{ locator: string }>;
    resolution?: string | null;
    resolved_by?: string | null;
    resolved_at?: string | null;
  }>;
  approvals: {
    clinical_meaning: {
      status: ApprovalStatus;
      approved_by?: string | null;
      approved_at?: string | null;
    };
    form_contract: {
      status: ApprovalStatus;
      approved_by?: string | null;
      approved_at?: string | null;
    };
  };
}

export interface CdiscCandidate {
  code: string;
  codelistCode: string;
  codelistName: string;
  codelistSubmissionValue: string;
  codelistExtensible: boolean;
  submissionValue: string;
  synonyms: string;
  definition: string;
  preferredTerm: string;
  version: string;
  sourceUrl: string;
  score: number;
  isCodelist: boolean;
}
