# Clinical form workflow routing

| Request or input | Required skill | Blocking input to request |
| --- | --- | --- |
| Protocol PDF/DOCX/MD/TXT to eCRF | `protocol-to-ecrf` | Sole protocol source; selected form; Gate A/B approvals |
| Search or confirm CDASH fields | `map-cdashig-fields` | Reviewed fields; protocol locators; project/form identity; CDASHIG v2.1 |
| Compile `program.yaml` as an editable React static site and publish | `publish-yaml-form-editor` → `sites-building` → `sites-hosting` | Local YAML path; project/form identity; static build manifest; login identity for confirmation; access approval if non-private |
| Compile approved JSON as a runtime React static site and publish | `protocol-to-ecrf` → `sites-building` → `sites-hosting` | Approved JSON contract; renderer/build version; static build manifest; QA evidence; release and access approval |
| Publish a completed runtime eCRF to a public GitHub project page | `publish-ecrf-github-pages` | Approved JSON/static bundle; QA result for exact Pages artifact; repository/branch; public-data screening; fresh post-QA push approval |
| Validate YAML Form Specification 1.0 | `test-yaml-forms` | Local YAML path; `prj_id` |
| Validate rendered HTML form | `test-html-forms` | HTML path or public URL; `prj_id`; submission authorization if applicable |
| End-to-end clinical form workflow | Orchestrator sequence | All stage-specific inputs above |

Route `protocol-to-ecrf` `program.yaml` to `publish-yaml-form-editor`, not directly to `test-yaml-forms`. If the supplied YAML is OpenAPI, JSON Schema, vendor YAML, or another unsupported format, require an explicit conversion before either workflow.

For YAML, JSON, Sites, and GitHub Pages routes, require a production React build that emits HTML, JavaScript, CSS, static assets, a manifest, and checksums. QA and hosting must use the exact same bundle. GitHub Pages publication must run only after QA and must always stop for a fresh push decision, regardless of QA outcome. Do not use request-time backend conversion or React SSR/RSC for form rendering.
