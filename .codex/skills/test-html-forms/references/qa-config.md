# qa-config.yaml

Use this optional file only for project-specific overrides. The bundled parser supports nested mappings, quoted or unquoted scalars, and inline arrays.

```yaml
prj_id: prj_demo-001
allow_submit: false
max_cases: 50
output_root: output/playwright

selectors:
  form: "#registration-form"
  submit_button: "button[type='submit']"
  success: "[data-testid='submit-success']"
  error: ".field-error, [role='alert']"

success_text: "儲存成功"
error_text: "請修正欄位"

ignore_fields:
  - csrf_token
  - debug_only
```

## Precedence

Command-line values override YAML values. YAML values override automatic detection.

## Submission authority

`allow_submit: true` authorizes real form submission. Do not set it automatically for a URL. Obtain explicit user confirmation first.

## Selectors

- `form`: Limit testing to one form. Omit to test all visible forms.
- `submit_button`: Override automatic submit-button detection.
- `success`: Visible element that proves success.
- `error`: Visible element that reports validation or submission failure.

## Ignored fields

Match `ignore_fields` against a field's `name`, `id`, stable selector, or generated field key. Ignored fields remain in `form-spec.json` but are excluded from test cases.
