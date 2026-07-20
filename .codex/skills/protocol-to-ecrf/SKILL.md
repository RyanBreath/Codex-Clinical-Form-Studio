---
name: protocol-to-ecrf
description: Convert a local clinical trial protocol in PDF, DOCX, Markdown, or text into a traceable CDISC-mapped program.yaml draft, a review-gated AirwayAI JSON eCRF contract, coded HTML, coded download/API payloads, and an optional IIS/NGINX-ready React static release. Use when a user asks Codex to analyze a protocol, map fields to CDISC/NCIt terminology, generate one eCRF, validate an eCRF schema, preview the React form, or package the generated form for deployment.
---

# Protocol to eCRF

Turn one user-selected form from a clinical protocol into a versioned Demo eCRF project. Keep clinical interpretation and CDISC mapping review-gated. Fail closed on ambiguity.

## Before starting

1. Locate the AirwayAI repository containing `template/crf/` and `template/data-dictionaries/`.
2. Accept one local or attached `.pdf`, `.docx`, `.md`, or `.txt` protocol as the sole clinical source. Do not inspect sibling files, nearby workbooks, prior CRFs, or other repository artifacts unless the user explicitly supplies them.
3. Treat the protocol as confidential. Exclude direct identifiers from every generated artifact and user-facing summary.
4. Read [workflow.md](references/workflow.md), [program-yaml-contract.md](references/program-yaml-contract.md), and [cdisc-coding-contract.md](references/cdisc-coding-contract.md).
5. Read the repository's `template/data-dictionaries/README.md`, `crf-contract.meta-schema.json`, and baseline `crf-schema.json`.

## Create the isolated project

Run:

```powershell
& '<skill-dir>\scripts\new-project.ps1' `
  -RepositoryRoot '<repository-root>' `
  -ProtocolPath '<protocol-path>'
```

Use the emitted `2.SA/projects/prj_yyyyMMdd-HHmm/` directory for every artifact. Never overwrite an existing project, schema version, or baseline schema.

## Required traceability

- Preserve the emitted `projectId` in every generated artifact.
- Keep the protocol filename/SHA-256 in `program.yaml`, the root schema `$comment`, and `analysis/artifact-traceability.json`.
- Keep canonical `formId`, `schemaVersion`, schema path, and manifest path in `program.yaml`.
- Use only properties supported by the current meta-schema. Do not add custom JSON Schema keywords.
- Contract `1.1.0` stores field mapping/status in `x-airwayai.fields[*].coding` and option terminology in `x-airwayai.fields[*].options[*].coding`. Never encode CDISC identity only in labels, help text, or `$comment`.
- When a traceability or coding change alters `crf-schema.json`, issue a new immutable SemVer version, validate it, and update the canonical reference.
- Preserve original form/answers downloads. When tracking exports, create sibling `*-tracked.json` files with project/protocol/schema hashes and paths, never participant identifiers.

## Analyze the protocol

1. Extract content with page, section, table, or paragraph locators. Mark OCR-derived text explicitly.
2. Create `analysis/program.yaml`, `analysis/source-traceability.md`, and `analysis/unresolved-items.md`.
3. During normalization, compare every selected-form field and controlled option against authoritative CDISC/NCI EVS terminology. Terminology is mapping metadata, not an additional clinical source. Record the exact publication/version, retrieval time, and direct HTTPS source.
4. Give every field a `coding.status`:
   - `matched`: exact mapping supported by evidence;
   - `not-applicable`: mapping is inappropriate, with a rationale;
   - `unresolved`: a plausible mapping exists but remains ambiguous.
5. Never guess a domain, variable, codelist, submission value, NCIt code, terminology version, unit, range, schedule, requiredness, option, condition, or calculation.
6. Add an `inferred_supporting_field` only when directly implied by the protocol and confidence is at least 80%. Record rationale and confidence.
7. List candidate forms and ask the user to select exactly one form.
8. Present clinical meaning, field inventory, CDISC mapping inventory, terminology sources/versions, source locators, confidence, contradictions, supporting-field inferences, and unresolved items.
9. Stop for explicit Gate A approval. A clinical or CDISC-mapping unresolved item blocks JSON generation.

## Generate and review the eCRF contract

1. Propose a stable lowercase `formId` and immutable SemVer `schemaVersion`.
2. Compile only approved protocol concepts and approved CDISC mappings from `program.yaml`. JSON is the rendering/submission contract and must not introduce mappings absent from YAML.
3. Use `contractVersion: "1.1.0"` for CDISC-aware forms, `status: "demo"`, `defaultLocale: "zh-TW"`, and a non-production disclaimer.
4. Put field mapping/status in `fields[path].coding`. Put each controlled option's system URI, terminology code, and CDISC submission value in `options[*].coding`; option JSON `value` must equal the approved submission value.
5. Use only fixed widgets and Predicate/computed AST. Never emit JavaScript, arbitrary HTML, CSS, class names, or inline styles.
6. If a concept has no safe representation, add an unresolved item and stop. Never modify the shared Renderer for one protocol.
7. Write `forms/<formId>/<schemaVersion>/crf-schema.json` and a validation report.
8. Validate from `template/crf/`:

```powershell
npm run validate:schema -- --schema '<absolute-crf-schema-path>'
npm run check
npm test
$env:AIRWAYAI_CRF_SCHEMA_PATH = '<absolute-crf-schema-path>'
npm run build
Remove-Item Env:\AIRWAYAI_CRF_SCHEMA_PATH
```

9. Present schema identity, field and CDISC codelist inventories, conditions, calculations, diagnostics, active-data implications, and test/build results.
10. Confirm that HTML exposes coding and that `onSubmit`, downloaded answers JSON, and the built-in API body contain the same full coded `FormSubmission`.
11. Stop for explicit Gate B approval before preview/release.

## Preview or package

After Gate B approval, ask for:

- local preview only;
- IIS package;
- NGINX package; or
- both IIS and NGINX;

and ask for root or subpath mounting.

For local preview:

```powershell
$env:AIRWAYAI_CRF_SCHEMA_PATH = '<absolute-crf-schema-path>'
npm run dev
```

Remove the environment variable after the server stops. Visually verify model/domain/variable, codelist/NCIt identity, terminology version, and option codes. Submit a test record and verify `coding.fields` in the Last submission inspector and downloaded answers JSON. If testing the built-in API URL, verify the API receives the full `FormSubmission`, not bare active data.

For packaging:

```powershell
npm run release -- `
  --schema '<absolute-crf-schema-path>' `
  --project '<absolute-prj-directory>' `
  --target both `
  --mount-path '/forms/example/'
```

Use `iis`, `nginx`, `both`, or `none`. Never deploy externally or copy into a live web root without separate authorization.

## Completion report

Report absolute paths to:

- copied protocol and source hash manifest;
- approved `program.yaml`, terminology sources, and traceability files;
- generated schema and validation report;
- artifact manifest and tracked exports;
- CDISC mapping summary and coded submission structure;
- preview instructions and optional release artifacts.

State that automated checks validate the software contract and Renderer behavior, not clinical correctness, regulatory submission fitness, or QMS validation.

## Stop conditions

Stop rather than guessing when:

- a source locator cannot be established;
- OCR obscures a clinical statement;
- protocol sections conflict;
- clinical units, ranges, options, timepoints, requiredness, conditions, or calculations are ambiguous;
- a plausible CDISC domain, variable, codelist, submission value, NCIt code, terminology version, or mapping scope is ambiguous;
- direct identifiers cannot be excluded;
- a widget or rule cannot be represented safely;
- the target schema version already exists;
- schema validation, tests, build, or release smoke test fails.
