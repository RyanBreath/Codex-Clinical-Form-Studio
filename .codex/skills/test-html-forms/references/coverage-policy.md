# Coverage and result policy

## Priority order

Keep cases in this order when the 50/100 limit applies:

1. One valid baseline per form
2. Required, native type, pattern, range, length, and invalid-choice cases
3. Conditional and cross-field cases
4. Read-only and disabled behavior
5. Valid boundary cases
6. Pairwise valid combinations
7. Repeated low-risk alternatives

Record every removed candidate and its reason.

## Field treatment

- Text-like controls: valid semantic value, required blank, min/max length, pattern mismatch, whitespace, Unicode, and a safe special-character case when space permits.
- Number/range controls: valid midpoint, exact minimum/maximum, just below/above, and step mismatch when applicable.
- Date/time controls: valid value, exact bounds, and outside bounds.
- Select/radio: allowed options, required empty state, disabled options, and pairwise combinations.
- Checkbox groups: empty, one selection, multiple selections, and required behavior.
- Single Boolean controls: sample only when more than three exist. Choose first, middle, and last and test both states.
- Hidden controls: record but do not fuzz.
- Read-only/disabled controls: verify they cannot be edited and do not treat them as ordinary input cases.
- File controls and multi-step forms: skip and report.

## Dynamic controls

Explore bounded states of select, radio, and checkbox drivers. When a new control appears, record the driver selector and value. Put the driver action before the conditional field action in generated cases.

## Pairwise

Use only valid variants. Generate candidate combinations deterministically and greedily cover uncovered value pairs. Report pair coverage and any pairs removed by the case cap.

## Expected and actual results

Expected values are one of:

- `valid`: all active constraints should pass.
- `invalid`: at least one known constraint should block or report an error.
- `readonly`: editing should be impossible.
- `manual`: the rule was inferred from ambiguous text or the oracle is insufficient.

Actual status is one of:

- `PASS`: observed behavior matches the expected result.
- `FAIL`: observed behavior contradicts the expected result.
- `需人工確認`: evidence is insufficient or the rule is inferred.
- `技術錯誤`: Playwright or page execution failed after one retry.

Do not treat a lack of obvious error text as proof that a real submission succeeded.
