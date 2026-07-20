---
name: test-html-forms
description: Analyze local HTML files or publicly accessible single-page web forms, extract fields and validation constraints, generate risk-prioritized synthetic QA cases, execute them through Playwright CLI, capture screenshots and traces, and create test-data.xlsx plus a copied test-results.xlsx with actual results. Use when Codex must test HTML form validation, create Excel QA data from form controls, verify required/type/range/length/pattern/choice rules, or document browser-based form testing.
---

# Test HTML Forms

Generate and execute traceable QA cases for ordinary single-page HTML forms. Keep every run under `output/playwright/{prj_id}/{yyyyMMdd-HHmmss}/`.

## Required capabilities

1. Read and follow the installed `playwright` skill. Use Playwright CLI, not `@playwright/test`.
2. Read and follow the `Spreadsheets` skill. Call `load_workspace_dependencies` and use its Node executable and `node_modules` path. Do not replace `@oai/artifact-tool` with another XLSX library.
3. Verify `npx` exists before running. If it is missing, stop and provide the Node.js/npm installation steps required by the Playwright skill.
4. Use Chromium at `1440x900`. Run headless unless visual diagnosis requires headed mode.

## Supported scope

- Accept a local `.html` file or a publicly accessible `http://` or `https://` URL.
- Test all visible single-page forms. Treat controls outside a `<form>` as one virtual form.
- Explore select, radio, and checkbox states to discover conditional controls.
- Skip authenticated pages, multi-step forms, CAPTCHA, signature/camera/map widgets, and file inputs. Record every skip.
- Use synthetic deterministic data only. Do not use real personal or patient data.
- Do not add SQL injection or XSS payloads unless the user explicitly requests security testing.

## Safety

- Default `allow_submit` to `false`.
- For URL sources, do not perform a real submission unless the user explicitly confirms it or `qa-config.yaml` sets `allow_submit: true`.
- Without submission authority, fill fields, trigger blur/change validation, call native validation, and record the pre-submit outcome.
- Continue after a failed case. Retry technical failures once; do not retry an assertion mismatch.
- Reload before every case to prevent state leakage.

## Workflow

### 1. Resolve inputs

Obtain the HTML path or URL and an optional `qa-config.yaml`. Read [qa-config.md](references/qa-config.md) only when configuration is needed.

Resolve `prj_id` in this order:

1. Explicit `-PrjId`
2. `qa-config.yaml`
3. `<meta name="prj_id">`
4. `<input name="prj_id">` or `<input id="prj_id">`
5. `data-prj-id`
6. JavaScript text containing `prj_id` or `project_id`

If none exists, ask the user to enter it. Never invent one.

### 2. Run the bundled workflow

Use the dependency paths returned by `load_workspace_dependencies`:

```powershell
$skill = Join-Path (Get-Location) ".codex\skills\test-html-forms"
& "$skill\scripts\run-qa.ps1" `
  -Source "C:\path\form.html" `
  -Config "C:\path\qa-config.yaml" `
  -NodeExe "<bundled Node.js executable>" `
  -NodeModules "<bundled Node.js packages>" `
  -PythonExe "<bundled Python executable>"
```

Omit `-Config` when no project overrides are needed. Use `-PrjId`, `-MaxCases`, `-OutputRoot`, `-AllowSubmit`, or `-Headed` only when explicitly required.

The runner starts a temporary localhost server for local HTML, closes it afterward, snapshots before automated interactions, executes data-driven cases through Playwright CLI, and creates the Excel files with `@oai/artifact-tool`.

### 3. Apply the coverage policy

Read [coverage-policy.md](references/coverage-policy.md) when reviewing generated cases or changing prioritization.

Required defaults:

- Test every non-Boolean input field.
- If there are at most three single Boolean controls, test all. If there are more than three, select the first, middle, and last, and test both `true` and `false`.
- Use a valid baseline, one-rule-at-a-time negative cases, boundary cases, conditional cases, and valid pairwise combinations.
- Define a simple form as at most ten non-Boolean fields with no conditional, cross-field, or multi-step behavior.
- Limit simple forms to 50 cases and other forms to 100 cases unless overridden.
- Preserve skipped/cut cases and pairwise coverage notes in the summary.

### 4. Review the oracle

Determine outcomes in this order:

1. Native HTML validity and `checkValidity()`
2. `aria-invalid`, `role="alert"`, configured error selectors, and visible validation messages
3. Configured success selector/text, URL change, and submit/network result when submission is allowed
4. Mark `需人工確認` when the result cannot be determined reliably

Never convert uncertainty into PASS.

### 5. Verify outputs

Require these artifacts:

```text
output/playwright/{prj_id}/{yyyyMMdd-HHmmss}/
├─ test-data.xlsx
├─ test-results.xlsx
├─ form-spec.json
├─ test-cases.json
├─ execution-log.json
├─ source.html or dom-snapshot.html
├─ source.sha256
├─ playwright-trace.zip
├─ console-log.json
├─ network-log.json
├─ screenshots/
└─ workbook-preview/
```

`test-data.xlsx` must end each case row with `預期測試結果`. `test-results.xlsx` must be imported from that workbook and append `實際測試結果`, `PASS/FAIL/需人工確認`, `錯誤或備註`, `截圖檔名`, and `測試時間`.

Open the generated preview images and inspect every workbook sheet. Confirm headers are visible, field columns are usable, and status formatting is legible before reporting completion.

## Reporting

Reply in Traditional Chinese. State the run folder, case counts, PASS/FAIL/manual/technical totals, skipped scope, and whether real submission was disabled. Link both final Excel files.
