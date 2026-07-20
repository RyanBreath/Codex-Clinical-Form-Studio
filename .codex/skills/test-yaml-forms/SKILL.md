---
name: test-yaml-forms
description: Validate local YAML form specifications, detect structural and semantic rule defects, generate deterministic risk-prioritized synthetic QA cases, evaluate those cases against the declared contract, and create test-data.xlsx plus test-results.xlsx. Use when Codex needs to review a .yaml or .yml form definition, verify field types/options/defaults/constraints/conditions/cross-field rules, convert a form contract into QA data, or document specification-level form testing without a browser UI.
---

# Test YAML Forms

Validate a YAML form contract and generate traceable specification-level QA artifacts. Keep every run under `output/yaml-qa/{prj_id}/{yyyyMMdd-HHmmss}/`.

## Required capabilities

1. Read and follow the installed `Spreadsheets` skill.
2. Call `load_workspace_dependencies`; use only its Node.js executable and `node_modules` path.
3. Use `@oai/artifact-tool` for XLSX authoring. Do not replace it with another workbook library.
4. Read [yaml-form-spec.md](references/yaml-form-spec.md) before mapping or validating a source file.

## Supported scope

- Accept one local `.yaml` or `.yml` file that follows YAML Form Specification 1.0.
- Perform contract QA: YAML syntax, schema shape, identifiers, types, options, defaults, constraints, conditional references, structured cross-field rules, case generation, and local oracle evaluation.
- Use deterministic synthetic data only. Never copy real personal, patient, credential, or production data into cases.
- Treat arbitrary application YAML, OpenAPI, JSON Schema, survey exports, or vendor-specific YAML as unsupported until it is explicitly mapped to this specification.
- Do not claim that static contract QA proves browser rendering, accessibility, backend validation, persistence, or submission behavior. Use `test-html-forms` separately when a rendered HTML form also needs browser execution.

## YAML safety boundary

- Parse only the documented safe YAML 1.2 Core subset.
- Reject custom tags, anchors, aliases, merge keys, directives, duplicate mapping keys, tabs used for indentation, multiple YAML documents, and block scalars.
- Never evaluate code or free-form expressions from YAML.
- Accept cross-field behavior only through the structured operators documented in the specification.
- Cap input at 2 MiB, 50 forms, and 200 fields per form.

## Workflow

### 1. Resolve inputs

Obtain the local YAML path. Resolve `prj_id` in this order:

1. Explicit `-PrjId`
2. Top-level `prj_id` in the YAML

If neither exists, ask the user for `prj_id`. Never invent one.

Use [assets/example-form.yaml](assets/example-form.yaml) only as a structural example. Use [assets/yaml-form.schema.json](assets/yaml-form.schema.json) as the machine-readable contract when implementing a converter.

### 2. Run the bundled workflow

Use the dependency paths returned by `load_workspace_dependencies`:

```powershell
$skill = Join-Path (Get-Location) ".codex\skills\test-yaml-forms"
& "$skill\scripts\run-qa.ps1" `
  -Source "C:\path\form.yaml" `
  -NodeExe "<bundled Node.js executable>" `
  -NodeModules "<bundled Node.js packages>"
```

Use `-PrjId`, `-MaxCases`, or `-OutputRoot` only when explicitly required. The runner creates a temporary dependency junction, removes it after execution, snapshots the source, calculates SHA-256, validates the specification, generates cases, evaluates the local oracle, renders every workbook sheet, and exports both Excel files.

### 3. Review findings

Treat severities as follows:

- `ERROR`: the declared contract is invalid or ambiguous enough to block reliable use.
- `WARNING`: the contract is usable but has a quality, portability, or testability risk.
- `INFO`: a traceability or maintainability improvement.

Do not hide findings because case generation succeeded. If the source is syntactically invalid or missing `prj_id`, stop and report the exact blocker.

### 4. Apply the coverage policy

Read [coverage-policy.md](references/coverage-policy.md) when reviewing generated cases or changing priorities.

Required defaults:

- Create one valid baseline per form.
- Vary one declared rule at a time for negative cases.
- Cover required, type/format, length, numeric/date boundaries, choice membership, defaults, conditional required behavior, and structured cross-field rules.
- Cap simple forms at 50 cases and other forms at 100 cases unless overridden.
- Preserve every cut candidate and its reason in `qa-report.json`.

### 5. Interpret the oracle

The local oracle validates generated values against the YAML contract only:

- `PASS`: the observed contract result matches the expected valid or invalid outcome.
- `FAIL`: the generated case contradicts the declared contract; inspect the generator, baseline, or rule interaction.
- `需人工確認`: static validation cannot establish the declared behavior, including read-only/disabled UI behavior.

Never convert uncertainty into `PASS`.

### 6. Verify outputs

The run directory contains:

```text
output/yaml-qa/{prj_id}/{yyyyMMdd-HHmmss}/
├── test-data.xlsx
├── test-results.xlsx
├── qa-report.json
├── source.yaml
├── source.sha256
└── workbook-preview/
```

Open every image in `workbook-preview/`. Confirm titles, headers, field columns, findings, and status formatting are legible. Check the verification JSON files and do not report completion if formula errors are present.

## Reporting

Reply in Traditional Chinese. State the run folder, form/field/case counts, ERROR/WARNING totals, PASS/FAIL/manual totals, cut-case count, and the limitation that results are specification-level rather than browser/runtime validation. Link both final Excel files.
