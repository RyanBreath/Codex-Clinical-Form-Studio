---
name: orchestrate-clinical-forms
description: Orchestrate this repository's protocol-to-eCRF, CDASHIG v2.1 mapping, YAML-to-editable-HTML Sites publishing, YAML specification QA, and rendered HTML form QA skills. Use when a request spans multiple clinical-form stages, when Codex must choose the correct project skill, or when required protocol, YAML, HTML, project ID, approval, identity, deployment, or submission inputs may be missing.
---

# Orchestrate Clinical Forms

Route work through the smallest valid workflow and stop at human approval gates. Read [references/workflow-routing.md](references/workflow-routing.md) before selecting skills.

## Preflight

Identify the requested outcome and available artifacts. Ask only for missing blocking inputs:

- protocol conversion: one local PDF, DOCX, Markdown, or text protocol;
- CDASH mapping: reviewed field inventory or `program.yaml`, source locators, selected form, project ID, and CDASHIG v2.1 confirmation;
- YAML QA: one YAML Form Specification 1.0 file and `prj_id`;
- YAML editor publishing: one supported `program.yaml`, project/form identity, and authenticated reviewer context for confirmation;
- HTML QA: one local HTML file or public single-page URL and `prj_id`;
- browser submission: explicit submission permission;
- clinical or mapping approval: named human decision at the required gate.
- confirmed YAML: an authenticated login identity that can populate `approved_by` and the confirmation timestamp.

Never invent a project ID, source locator, approval, standard version, mapping, clinical value, or missing artifact.

## Route skills

Read the selected project-local `SKILL.md` completely and follow its required references and tools.

- Use `protocol-to-ecrf` for protocol normalization, traceability, contract compilation, preview, or release packaging.
- Use `map-cdashig-fields` for CDASHIG v2.1 table search and specialist-reviewed candidate selection.
- Use `publish-yaml-form-editor` to render supported YAML as an editable browser form and publish `yaml-form-studio` with Sites.
- Use `test-yaml-forms` only for YAML Form Specification 1.0 contract QA.
- Use `test-html-forms` for rendered single-page form/browser validation.

Do not pass `protocol-to-ecrf` `program.yaml` directly to `test-yaml-forms`; the formats differ. Require an explicit compatible conversion first.

## Full workflow

1. Normalize the protocol with `protocol-to-ecrf` and stop at Gate A.
2. Resolve CDASH candidates with `map-cdashig-fields`; keep ambiguous fields unresolved.
3. Obtain explicit clinical and mapping approval.
4. For a confirmed YAML, copy the verified login identity and confirmation time into the applicable approval record; if identity is unavailable, keep approval pending.
5. Compile and validate the eCRF contract with `protocol-to-ecrf`; stop at Gate B.
6. Use `publish-yaml-form-editor` when reviewers need a deployed field editor; route every CDASH lookup through `map-cdashig-fields`.
7. Run `test-yaml-forms` only when a YAML Form Specification 1.0 artifact exists.
8. Run `test-html-forms` on the rendered HTML when requested; keep real submission disabled unless authorized.
9. Report artifact paths, deployed URL, approvals, unresolved items, test limitations, and next required input.

## Safety

Use synthetic data only. Exclude PHI/PII. Do not describe automated contract or browser checks as clinical correctness, regulatory fitness, or QMS validation.
