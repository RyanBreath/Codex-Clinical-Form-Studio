# Review-gated workflow

## Phase 1 — Intake

- Confirm the repository root and protocol path.
- Confirm the source format is PDF, DOCX, Markdown, or text, and treat the user-selected protocol as the sole clinical source. Do not inspect or use sibling files, nearby workbooks, prior CRFs, or repository artifacts unless the user explicitly adds them as sources.
- Treat the source as confidential. Do not block local analysis solely because it contains direct identifiers; exclude them from all generated artifacts and user-facing summaries. If participant identifiers are present, use only the minimum protocol content needed for the eCRF.
- Create one immutable `2.SA/projects/prj_yyyyMMdd-HHmm/` work package.

## Phase 2 — Protocol normalization

- Extract protocol identity, version, date, objectives, endpoints, visits, assessments, eligibility references, forms, variables, units, ranges, controlled options, requiredness, branching, and calculations.
- Compare every field and controlled option with authoritative CDISC/NCI EVS terminology. Record the exact release and HTTPS source.
- Assign every field `coding.status: matched | not-applicable | unresolved`. An ambiguous plausible mapping is blocking.
- Add an `inferred_supporting_field` only when it is directly implied by a protocol concept and confidence is at least 80%. Record the protocol rationale and confidence; do not infer missing answer options, units, ranges, schedules, or requiredness.
- Record a source locator for every extracted concept.
- Use confidence values `high`, `medium`, or `low`; confidence is not approval.
- Write contradictions and missing decisions into `unresolved-items.md`.
- Present candidate forms and ask the user to select one.

## Gate A — Clinical meaning approval

Show:

- selected form purpose and visit;
- proposed fields and types;
- every inferred supporting field with its rationale and confidence;
- units, ranges, options, requiredness, conditions, and calculations;
- source locators and confidence;
- all unresolved items.
- every CDISC mapping, non-applicable rationale, terminology version/source, and mapping confidence.

Wait for explicit approval. A contract-affecting unresolved item blocks progress.

## Phase 3 — eCRF compilation

- Propose `formId` and `schemaVersion`.
- Generate one Demo-only contract `1.1.0` `crf-schema.json` from approved `program.yaml`.
- Compile YAML coding into `x-airwayai.fields[*].coding` and option terminology into `options[*].coding`.
- Follow the repository meta-schema and author guide exactly.
- Do not alter `FormRenderer` to accommodate one protocol.
- Validate the target schema and run the renderer test/build suite.

## Gate B — Form contract approval

Show:

- schema identity and version;
- field inventory;
- conditional and calculated paths;
- diagnostics and safe fallbacks;
- active-data behavior;
- HTML coding display and coded `onSubmit`/download/API behavior;
- test/build results.

Wait for explicit approval.

## Phase 4 — Static React build, preview, and optional Sites release

- Bind the approved `crf-schema.json` to the versioned React renderer and run the production build.
- Produce relative-asset `index.html`, JavaScript, CSS, static assets, an asset manifest, and checksums before QA.
- Do not perform JSON-to-HTML conversion, React SSR／RSC, or backend HTML generation at request time.
- Test the built static bundle from an HTTP static origin.
- Ask whether the user wants local preview only or OpenAI Sites deployment.
- For deployment, use `sites-building` and then `sites-hosting`; deploy the exact bundle that passed QA.
- Never invoke external deployment without separate authorization; prefer private Sites access.

## Project layout

```text
2.SA/projects/prj_yyyyMMdd-HHmm/
├─ source/
│  ├─ <original-protocol>
│  └─ source-manifest.json
├─ analysis/
│  ├─ program.yaml
│  ├─ source-traceability.md
│  └─ unresolved-items.md
├─ forms/<formId>/<schemaVersion>/
│  ├─ crf-schema.json
│  └─ validation-report.md
└─ releases/<formId>/<schemaVersion>/
   ├─ site/
   │  ├─ index.html
   │  └─ assets/
   ├─ asset-manifest.json
   ├─ checksums.json
   ├─ release-manifest.json
   └─ <formId>-<schemaVersion>.zip
```
