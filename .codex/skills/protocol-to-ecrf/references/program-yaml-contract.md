# `program.yaml` minimum contract

Use this normalized intermediate structure. Add fields only when the protocol supports them; never fill unknown clinical values with guesses.

```yaml
contract_version: "1.0.0"
project_id: "prj_yyyyMMdd-HHmm"
source:
  file_name: "protocol.pdf"
  sha256: "<from source-manifest.json>"
  protocol_title: "<title or unresolved>"
  protocol_version: "<version or unresolved>"
  protocol_date: "<ISO date or unresolved>"
  extraction_method: "native-text | ocr | mixed"
  extracted_at: "<ISO 8601>"

terminology_sources:
  - standard: "CDISC"
    model: "SDTM"
    publication: "CDISC SDTM Controlled Terminology"
    version: "<publication date/version>"
    source_url: "https://<authoritative-source>"
    retrieved_at: "<ISO 8601>"

candidate_forms:
  - candidate_id: "baseline-assessment"
    title: "Baseline assessment"
    purpose: "<paraphrase>"
    visit: "baseline"
    source_refs:
      - locator: "Section 8.2, page 42"
        confidence: "high"

selected_form:
  candidate_id: "baseline-assessment"
  approval_status: "pending | approved"
  fields:
    - concept_id: "ahi"
      label: "Apnea–Hypopnea Index"
      purpose: "<paraphrase>"
      data_type: "number"
      required: true
      unit: "events/hour"
      range:
        minimum: 0
        maximum: null
      options: []
      visible_when: null
      required_when: null
      calculation: null
      source_refs:
        - locator: "Section 8.2.1, page 43, Table 6 row AHI"
          confidence: "high"
      notes: []
      inference:
        kind: "protocol_explicit | inferred_supporting_field"
        rationale: null
        confidence_percent: 100
      coding:
        status: "matched | not-applicable | unresolved"
        rationale: null
        standard: "CDISC"
        model: "SDTM"
        implementation_guide: "<if applicable>"
        domain: "<for example DM>"
        variable: "<for example SEX>"
        version: "<terminology publication date/version>"
        source_url: "https://<authoritative-source>"
        mapping_confidence_percent: 100
        codelist:
          name: "Sex"
          submission_value: "SEX"
          ncit_code: "C66731"
          extensible: false
        terms:
          - value: "F"
            submission_value: "F"
            system: "https://ncit.nci.nih.gov"
            ncit_code: "C16576"
            label: "Female"

unresolved_items:
  - id: "U-001"
    severity: "blocking | warning"
    question: "<one answerable question>"
    affected_concepts: ["ahi"]
    source_refs:
      - locator: "Section 8.2.1, page 43"
    resolution: null
    resolved_by: null
    resolved_at: null

approvals:
  clinical_meaning:
    status: "pending | approved"
    approved_by: null
    approved_at: null
  form_contract:
    status: "pending | approved"
    approved_by: null
    approved_at: null
```

Rules:

- Keep `candidate_forms` even after one form is selected.
- Use `inferred_supporting_field` only when it is directly implied by the selected protocol with confidence of at least 80%. Record the inference, rationale, and confidence percentage; never use another local file as unstated evidence.
- A `blocking` unresolved item prevents JSON generation.
- Every selected-form field must have a coding status. `unresolved` prevents JSON generation when a plausible CDISC mapping remains undecided.
- `matched` requires evidence, version, source URL, mapping confidence, and the applicable model/domain/variable or codelist.
- `not-applicable` requires a rationale. Do not use it merely because a search was not performed.
- For controlled options, preserve CDISC submission values and terminology codes separately; compiled JSON option `value` must equal `submission_value`.
- Use source locators, not long verbatim copies of the protocol.
- Preserve protocol terminology in labels only when explicitly supported.
- Record user-supplied resolutions separately from protocol-derived facts.
- Never represent user approval merely because a file was generated.
