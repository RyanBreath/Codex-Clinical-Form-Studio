# CDISC coding contract

## Source policy

- Search authoritative CDISC/NCI EVS resources during protocol normalization.
- Prefer the current dated CDISC controlled terminology publication and official implementation guides.
- Record publication/version, retrieval time, and direct HTTPS source.
- Treat terminology as mapping metadata only. It must not supply missing clinical facts, schedules, ranges, or answer choices.

## Mapping decisions

For every selected-form field, record one status:

- `matched`: exact mapping supported by terminology or implementation-guide evidence.
- `not-applicable`: no CDISC mapping is appropriate; include a concise rationale.
- `unresolved`: a plausible mapping exists but cannot be selected safely; create a blocking unresolved item.

For `matched`, record the applicable model, implementation guide, domain, variable, terminology version/source, mapping confidence, and codelist when relevant. For controlled options, record system URI, terminology code, CDISC submission value, label, and version.

Never invent a study-specific test code, domain, variable, codelist, term, or NCIt code. Do not treat fuzzy textual similarity as an exact match.

## Compilation

Compile approved YAML into contract `1.1.0`:

- `x-airwayai.fields[path].coding` carries field status and mapping.
- `x-airwayai.fields[path].options[*].coding` carries controlled-term identity.
- Option JSON `value` equals its CDISC submission value.
- The Renderer displays field and option coding in HTML.
- `FormSubmission.coding.fields` carries active field mappings and selected terms.
- `onSubmit`, downloaded answers JSON, and the built-in API POST use the same full `FormSubmission`.

The plain `data` object remains the clinical value tree. Coding metadata is parallel to it so existing field paths and JSON Schema validation remain stable.
