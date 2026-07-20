# Clinical form workflow routing

| Request or input | Required skill | Blocking input to request |
| --- | --- | --- |
| Protocol PDF/DOCX/MD/TXT to eCRF | `protocol-to-ecrf` | Sole protocol source; selected form; Gate A/B approvals |
| Search or confirm CDASH fields | `map-cdashig-fields` | Reviewed fields; protocol locators; project/form identity; CDASHIG v2.1 |
| Validate YAML Form Specification 1.0 | `test-yaml-forms` | Local YAML path; `prj_id` |
| Validate rendered HTML form | `test-html-forms` | HTML path or public URL; `prj_id`; submission authorization if applicable |
| End-to-end clinical form workflow | Orchestrator sequence | All stage-specific inputs above |

If the supplied YAML is `program.yaml`, OpenAPI, JSON Schema, or vendor YAML, do not route it to `test-yaml-forms` until an explicit mapping produces YAML Form Specification 1.0.
