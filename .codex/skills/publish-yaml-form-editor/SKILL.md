---
name: publish-yaml-form-editor
description: Convert a reviewed protocol-to-eCRF program.yaml into an English-default, Chinese-switchable React form editor, precompile its HTML, JavaScript, and CSS, optionally invoke CDASHIG v2.1 candidate mapping, and publish the validated static bundle with Sites. Use when Codex must turn YAML fields into an editable web form, update the repository's yaml-form-studio, deploy that editor, or let authenticated reviewers confirm and download approved YAML.
---

# Publish YAML Form Editor

Turn one supported `program.yaml` into an editable, review-gated React web experience, compile it into a production static bundle, and publish that exact validated bundle through Sites.

## Resolve inputs

Require:

- one local `program.yaml` or explicit YAML path;
- `project_id`, `selected_form`, and at least one `selected_form.fields` entry;
- protocol source locators for fields whose clinical meaning or coding may change;
- CDASHIG v2.1 confirmation before CDASH lookup;
- an authenticated reviewer before producing confirmed YAML.

Ask whether edits must persist across users or sessions only when durable shared drafts, history, or collaboration are requested. Default to an in-browser draft plus confirmed YAML download; do not add persistence speculatively.

Reject unsupported YAML instead of guessing a conversion. `program.yaml` is not YAML Form Specification 1.0. Read the canonical schema at [../protocol-to-ecrf/references/program-yaml-contract.md](../protocol-to-ecrf/references/program-yaml-contract.md) and the project rules at [references/editor-publishing-policy.md](references/editor-publishing-policy.md).

## Build the editor

Use the existing `yaml-form-studio/` Sites project and preserve its `.openai/hosting.json` project identity. Use `template/crf/` as the reference React／Vite static-build implementation. Preserve the package manager, lockfile, authentication behavior, and renderer style unless the static-build migration requires an intentional update.

The browser-facing editor must be precompiled before deployment:

```text
program.yaml + versioned React renderer
  → safe parse and validation
  → production frontend build
  → index.html + JavaScript + CSS + static assets
  → asset manifest and checksums
  → QA
  → Sites deployment
```

Do not use request-time React SSR／RSC, Worker HTML generation, or backend YAML-to-HTML conversion. A Sites Worker may serve static assets and non-rendering API routes only.

1. Parse YAML safely and display structural errors without dropping the user's source text.
2. Render each selected field as accessible HTML and provide a synchronized field editor and renderer preview.
3. Allow review of concept ID, English display label, data type, requiredness, source locator, coding status, rationale, CDASH domain, variable, and evidence URL when present.
4. Keep English as the default UI and form-content language. Provide an explicit Chinese switch and preserve bilingual YAML content when supplied.
5. Never add protocol-unsupported options, units, ranges, calculations, visits, conditions, or requiredness.
6. Keep preview and download behavior available without treating a draft as approved.
7. Make the production bundle use relative or Sites-compatible asset paths and record the renderer／build version.
8. Keep authentication, confirmation, CDASH lookup, and optional persistence as API concerns; none of them may render the form or transform YAML into HTML.

## Map CDASH fields

For each `Search CDASH` action, invoke the project-local `map-cdashig-fields` skill at `../map-cdashig-fields/SKILL.md` and follow it completely.

- Send only field definition metadata and source locators; never send participant data.
- Present official CDASHIG v2.1 results as candidates.
- Require explicit specialist selection before writing domain, variable, source, rationale, or `matched` status.
- Keep ambiguous or unavailable mappings `unresolved`.
- Do not use generative AI to invent a CDASH code.

## Confirm YAML

Require authentication on the server for confirmation. Populate the applicable existing approval records with the verified login identity in `approved_by` and an ISO 8601 timestamp in `approved_at`. Never trust a client-supplied reviewer identity or infer it from Git, the operating-system account, YAML text, or form input.

Preserve the original YAML until confirmation succeeds. Download the resulting file as a distinct confirmed artifact and retain unresolved items when any remain. Do not label an artifact approved merely because it rendered or downloaded.

## Validate and publish

Invoke `sites-building` for the existing `yaml-form-studio/` capability path, including its authentication guidance and persistence guidance when durable editing is requested. Run the React production build first and require a deployable bundle containing HTML, JavaScript, CSS, static assets, an asset manifest, and checksums. Fail if the page requires request-time YAML rendering, React SSR／RSC, or backend-generated HTML.

Run project tests against the built static bundle, not only the development server. Use `test-html-forms` when browser-form QA is requested or required by the orchestrator. Record the bundle manifest and checksum in the QA／release evidence.

After validation, invoke `sites-hosting`. Reuse the existing Sites `project_id` and deploy the same validated static bundle. If the source or bundle changes after QA, rebuild and repeat QA before hosting. Publish privately by default, and obtain explicit user approval before any shared or public deployment. Keep credentials and temporary archives out of source, YAML, logs, and responses.

Return the deployed Sites URL, static bundle manifest／checksum, rendering mode, supported YAML type, enabled editing and language behavior, authentication status, CDASH mapping limitations, unresolved items, and whether drafts are local or durable.

## Safety

Use synthetic or specification metadata only. Exclude PHI/PII. Treat automated parsing, mapping search, rendering, and browser tests as engineering checks rather than clinical, regulatory, or QMS approval.
