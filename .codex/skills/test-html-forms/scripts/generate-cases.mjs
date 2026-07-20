import fs from "node:fs/promises";
import path from "node:path";
import {
  displayFieldName,
  parseArgs,
  readConfig,
  sanitizeSheetName,
  stableFieldKey,
  writeJson,
} from "./qa-core.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.spec || !args.output) {
  throw new Error("Usage: generate-cases.mjs --spec form-spec.json --output test-cases.json [--config config.json] [--max-cases N]");
}

const spec = JSON.parse(await fs.readFile(path.resolve(args.spec), "utf8"));
const config = args.config ? await readConfig(path.resolve(args.config)) : {};
const explicitMax = args["max-cases"] ? Number(args["max-cases"]) : Number(config.max_cases || 0);
const ignored = new Set((config.ignore_fields || []).map((value) => String(value)));

function clone(value) {
  return structuredClone(value);
}

function unique(values) {
  return [...new Set(values.map((value) => JSON.stringify(value)))].map((value) =>
    JSON.parse(value),
  );
}

function normalizeFieldGroups(form) {
  const rawFields = form.fields || [];
  const checkboxCounts = new Map();
  for (const field of rawFields.filter((candidate) => candidate.type === "checkbox")) {
    const groupKey = field.name || field.selector;
    checkboxCounts.set(groupKey, (checkboxCounts.get(groupKey) || 0) + 1);
  }

  const result = [];
  const grouped = new Map();

  for (const rawField of rawFields) {
    if (rawField.type === "hidden") continue;
    const groupKey =
      rawField.type === "radio"
        ? `radio:${rawField.name || rawField.selector}`
        : rawField.type === "checkbox" &&
            checkboxCounts.get(rawField.name || rawField.selector) > 1
          ? `checkbox-group:${rawField.name || rawField.selector}`
          : null;

    if (!groupKey) {
      result.push({ ...clone(rawField), options: clone(rawField.options || []) });
      continue;
    }

    if (!grouped.has(groupKey)) {
      const widget = rawField.type === "radio" ? "radio" : "checkbox-group";
      const group = {
        ...clone(rawField),
        type: widget,
        widget,
        selector: rawField.selector,
        options: [],
        visible: false,
        visibleEver: false,
        required: false,
        disabled: true,
        readOnly: false,
        discoveredBy: rawField.discoveredBy || null,
      };
      grouped.set(groupKey, group);
      result.push(group);
    }

    const group = grouped.get(groupKey);
    group.options.push({
      selector: rawField.selector,
      value: rawField.value,
      text: rawField.label || rawField.value,
      disabled: rawField.disabled,
      checked: rawField.checked,
    });
    group.visible = group.visible || rawField.visible;
    group.visibleEver = group.visibleEver || rawField.visibleEver;
    group.required = group.required || rawField.required;
    group.disabled = group.disabled && rawField.disabled;
    if (!group.discoveredBy && rawField.discoveredBy) group.discoveredBy = rawField.discoveredBy;
  }

  const keyCounts = new Map();
  return result.map((field, index) => {
    const baseKey = stableFieldKey(field, index);
    const count = (keyCounts.get(baseKey) || 0) + 1;
    keyCounts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}_${count}`;
    return {
      ...field,
      key,
      column: displayFieldName({ ...field, name: key }, index),
      boolean: field.type === "checkbox" && checkboxCounts.get(field.name || field.selector) <= 1,
    };
  });
}

function fieldMatchesIgnore(field) {
  return [field.key, field.name, field.id, field.selector].filter(Boolean).some((value) =>
    ignored.has(String(value)),
  );
}

function semanticHint(field) {
  return [field.label, field.name, field.id, field.placeholder, field.autocomplete]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function numericBounds(field) {
  const min = field.min === null || field.min === "" ? null : Number(field.min);
  const max = field.max === null || field.max === "" ? null : Number(field.max);
  const step =
    field.step === null || field.step === "" || field.step === "any" ? null : Number(field.step);
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    step: Number.isFinite(step) && step > 0 ? step : null,
  };
}

function clampText(value, field) {
  let output = String(value);
  const minLength = Number.isFinite(field.minLength) ? field.minLength : 0;
  const maxLength = Number.isFinite(field.maxLength) && field.maxLength >= 0 ? field.maxLength : null;
  while (output.length < minLength) output += "A";
  if (maxLength !== null) output = output.slice(0, maxLength);
  return output;
}

function patternValue(pattern, fallback) {
  if (!pattern) return { value: fallback, confident: true };
  const candidates = [
    fallback,
    "ABC123",
    "QA-0001",
    "123456",
    "0912345678",
    "qa.user@example.test",
    "測試資料",
  ];
  try {
    const expression = new RegExp(`^(?:${pattern})$`);
    const match = candidates.find((candidate) => expression.test(candidate));
    return match
      ? { value: match, confident: true }
      : { value: fallback, confident: false };
  } catch {
    return { value: fallback, confident: false };
  }
}

function baselineValue(field) {
  if (field.readOnly || field.disabled) return field.value ?? null;
  if (field.type === "select" || field.type === "select-multiple") {
    const options = (field.options || []).filter(
      (option) => !option.disabled && option.value !== "",
    );
    if (field.type === "select-multiple") {
      return options.length ? [options[0].value] : [];
    }
    return options[0]?.value ?? "";
  }
  if (field.type === "radio") {
    return (field.options || []).find((option) => !option.disabled)?.value ?? null;
  }
  if (field.type === "checkbox-group") {
    const first = (field.options || []).find((option) => !option.disabled)?.value;
    return field.required && first !== undefined ? [first] : [];
  }
  if (field.boolean) return field.required ? true : false;

  const hint = semanticHint(field);
  const { min, max, step } = numericBounds(field);
  if (["number", "range"].includes(field.type)) {
    let value = min !== null && max !== null ? (min + max) / 2 : min ?? max ?? 10;
    if (step) value = Math.round(value / step) * step;
    return field.type === "number" && Number(field.step) === 1 ? Math.round(value) : value;
  }
  if (field.type === "date") return field.min || field.max || "2026-01-15";
  if (field.type === "datetime-local") return field.min || field.max || "2026-01-15T10:30";
  if (field.type === "month") return field.min || field.max || "2026-01";
  if (field.type === "week") return field.min || field.max || "2026-W03";
  if (field.type === "time") return field.min || field.max || "10:30";
  if (field.type === "email" || /email|電子郵件|信箱/.test(hint)) {
    return "qa.user@example.test";
  }
  if (field.type === "url" || /url|網址|網站/.test(hint)) return "https://example.test";
  if (field.type === "tel" || /phone|mobile|tel|電話|手機/.test(hint)) return "0912345678";
  if (field.type === "password" || /password|密碼/.test(hint)) return "Qa!12345678";
  let textValue = "測試資料";
  if (/姓名|name/.test(hint)) textValue = "測試使用者";
  else if (/編號|代碼|code|identifier|id\b/.test(hint)) textValue = "QA-0001";
  else if (field.type === "textarea") textValue = "這是合成測試資料。";
  const patterned = patternValue(field.pattern, clampText(textValue, field));
  return clampText(patterned.value, field);
}

function validVariants(field) {
  const baseline = baselineValue(field);
  if (field.type === "select" || field.type === "radio") {
    return unique(
      (field.options || [])
        .filter((option) => !option.disabled && option.value !== "")
        .slice(0, 3)
        .map((option) => option.value),
    );
  }
  if (field.type === "select-multiple" || field.type === "checkbox-group") {
    const allowed = (field.options || [])
      .filter((option) => !option.disabled && option.value !== "")
      .slice(0, 3)
      .map((option) => option.value);
    const variants = [];
    if (!field.required) variants.push([]);
    if (allowed[0] !== undefined) variants.push([allowed[0]]);
    if (allowed.length >= 2) variants.push([allowed[0], allowed[1]]);
    return unique(variants);
  }
  if (field.boolean) return [false, true];
  if (["number", "range"].includes(field.type)) {
    const { min, max } = numericBounds(field);
    return unique([baseline, min, max].filter((value) => value !== null));
  }
  if (["date", "datetime-local", "month", "week", "time"].includes(field.type)) {
    return unique([baseline, field.min, field.max].filter(Boolean));
  }
  return unique([baseline, clampText(`${baseline}A`, field)]);
}

function findDriverField(fields, discoveredBy) {
  if (!discoveredBy) return null;
  if (discoveredBy.kind === "radio") {
    return fields.find(
      (field) =>
        field.type === "radio" &&
        (field.options || []).some((option) => option.selector === discoveredBy.selector),
    );
  }
  return fields.find((field) => field.selector === discoveredBy.selector);
}

function actionFor(field, value) {
  return {
    fieldKey: field.key,
    selector: field.selector,
    widget: field.type,
    value,
    options: clone(field.options || []),
    label: field.label || field.key,
  };
}

function makeCandidateFactory(form, fields, baseValues) {
  return ({
    type,
    description,
    expectedKind,
    expectedResult,
    mutations = {},
    targets = [],
    priority,
    manualReason = null,
  }) => {
    const values = clone(baseValues);
    const activeKeys = new Set(
      fields
        .filter((field) => field.visible && !field.unsupported)
        .map((field) => field.key),
    );
    const conflicts = [];

    const activate = (field) => {
      if (!field || activeKeys.has(field.key)) return;
      if (field.discoveredBy) {
        const driver = findDriverField(fields, field.discoveredBy);
        if (driver) {
          activate(driver);
          const previous = values[driver.key];
          const next =
            field.discoveredBy.kind === "checkbox"
              ? Boolean(field.discoveredBy.value)
              : field.discoveredBy.value;
          if (
            previous !== null &&
            previous !== undefined &&
            JSON.stringify(previous) !== JSON.stringify(next) &&
            targets.some((target) => target !== field.key)
          ) {
            conflicts.push(`${driver.key}: ${JSON.stringify(previous)} -> ${JSON.stringify(next)}`);
          }
          values[driver.key] = next;
        }
      }
      activeKeys.add(field.key);
      if (values[field.key] === null || values[field.key] === undefined) {
        values[field.key] = baselineValue(field);
      }
    };

    for (const target of targets) activate(fields.find((field) => field.key === target));
    for (const [key, value] of Object.entries(mutations)) {
      const field = fields.find((candidate) => candidate.key === key);
      activate(field);
      values[key] = value;
    }

    for (const field of fields) {
      if (!activeKeys.has(field.key)) values[field.key] = null;
    }

    const actions = fields
      .filter(
        (field) =>
          activeKeys.has(field.key) &&
          !field.disabled &&
          !field.readOnly &&
          !field.unsupported,
      )
      .sort((left, right) => Number(Boolean(left.discoveredBy)) - Number(Boolean(right.discoveredBy)))
      .map((field) => actionFor(field, values[field.key]));

    const targetFields = targets
      .map((key) => fields.find((field) => field.key === key))
      .filter(Boolean);

    return {
      formIndex: form.index,
      formSelector: form.selector,
      formLabel: form.label,
      submitSelector: form.submitSelector,
      testType: type,
      description,
      expected: {
        kind: conflicts.length ? "manual" : expectedKind,
        result: conflicts.length
          ? `條件欄位啟用狀態衝突，需人工確認：${conflicts.join("; ")}`
          : expectedResult,
        manualReason: conflicts.length ? conflicts.join("; ") : manualReason,
      },
      values,
      actions,
      targetFieldKeys: targets,
      targetSelectors: targetFields.map((field) => field.selector),
      priority,
    };
  };
}

function pairKey(leftIndex, leftValueIndex, rightIndex, rightValueIndex) {
  return `${leftIndex}:${leftValueIndex}|${rightIndex}:${rightValueIndex}`;
}

function pairwiseRows(domains, maximumRows = 30) {
  if (domains.length < 2) return { rows: [], totalPairs: 0, coveredPairs: 0 };
  const uncovered = new Set();
  for (let left = 0; left < domains.length; left += 1) {
    for (let right = left + 1; right < domains.length; right += 1) {
      for (let leftValue = 0; leftValue < domains[left].values.length; leftValue += 1) {
        for (let rightValue = 0; rightValue < domains[right].values.length; rightValue += 1) {
          uncovered.add(pairKey(left, leftValue, right, rightValue));
        }
      }
    }
  }

  const totalPairs = uncovered.size;
  const pool = [];
  let seed = 20260716;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const addRow = (indexes) => {
    const signature = indexes.join(",");
    if (!pool.some((candidate) => candidate.signature === signature)) {
      pool.push({ indexes, signature });
    }
  };

  addRow(domains.map(() => 0));
  for (let count = 0; count < 600; count += 1) {
    addRow(domains.map((domain) => Math.floor(random() * domain.values.length)));
  }
  for (let left = 0; left < domains.length; left += 1) {
    for (let right = left + 1; right < domains.length; right += 1) {
      for (let leftValue = 0; leftValue < domains[left].values.length; leftValue += 1) {
        for (let rightValue = 0; rightValue < domains[right].values.length; rightValue += 1) {
          const indexes = domains.map(() => 0);
          indexes[left] = leftValue;
          indexes[right] = rightValue;
          addRow(indexes);
        }
      }
    }
  }

  const coveredBy = (indexes) => {
    const covered = [];
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const key = pairKey(left, indexes[left], right, indexes[right]);
        if (uncovered.has(key)) covered.push(key);
      }
    }
    return covered;
  };

  const selected = [];
  while (uncovered.size && selected.length < maximumRows) {
    let best = null;
    for (const candidate of pool) {
      if (candidate.selected) continue;
      const covered = coveredBy(candidate.indexes);
      if (!best || covered.length > best.covered.length) best = { candidate, covered };
    }
    if (!best || best.covered.length === 0) break;
    best.candidate.selected = true;
    selected.push(best.candidate.indexes);
    best.covered.forEach((key) => uncovered.delete(key));
  }

  return {
    rows: selected.map((indexes) =>
      Object.fromEntries(
        indexes.map((valueIndex, fieldIndex) => [
          domains[fieldIndex].field.key,
          domains[fieldIndex].values[valueIndex],
        ]),
      ),
    ),
    totalPairs,
    coveredPairs: totalPairs - uncovered.size,
    uncoveredPairs: uncovered.size,
  };
}

const generatedForms = [];
const globalSkips = [];
const configuredFormSelector = config.selectors?.form;
const sourceForms = (spec.forms || []).filter((form) => {
  if (!configuredFormSelector) return true;
  return (
    form.selector === configuredFormSelector ||
    `#${form.id}` === configuredFormSelector ||
    form.name === configuredFormSelector
  );
});

for (const form of sourceForms) {
  if (form.multiStep) {
    globalSkips.push({
      form: form.label,
      reason: "偵測為多步驟表單，第一版依規格跳過。",
    });
    continue;
  }
  if (!form.visible) {
    globalSkips.push({ form: form.label, reason: "表單不可見，已跳過。" });
    continue;
  }

  const fields = normalizeFieldGroups(form).filter((field) => !fieldMatchesIgnore(field));
  const unsupported = fields.filter((field) => field.unsupported);
  unsupported.forEach((field) =>
    globalSkips.push({
      form: form.label,
      field: field.column,
      reason: field.type === "file" ? "檔案上傳欄位依規格跳過。" : "特殊元件需人工確認。",
    }),
  );
  const testableFields = fields.filter(
    (field) => field.visibleEver && !field.unsupported,
  );
  const booleanFields = testableFields.filter((field) => field.boolean);
  const sampledBooleans =
    booleanFields.length <= 3
      ? booleanFields
      : [booleanFields[0], booleanFields[Math.floor((booleanFields.length - 1) / 2)], booleanFields.at(-1)];
  const sampledBooleanKeys = new Set(sampledBooleans.map((field) => field.key));
  booleanFields
    .filter((field) => !sampledBooleanKeys.has(field.key))
    .forEach((field) =>
      globalSkips.push({
        form: form.label,
        field: field.column,
        reason: "單一布林欄位超過 3 個，依規格僅抽測第一、中間、最後三個。",
      }),
    );

  const baseValues = Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.visible && !field.unsupported ? baselineValue(field) : null,
    ]),
  );
  const createCandidate = makeCandidateFactory(form, fields, baseValues);
  const candidates = [];

  candidates.push(
    createCandidate({
      type: "合法基準",
      description: "以合成合法資料填寫所有目前可見且可編輯欄位。",
      expectedKind: fields.some(
        (field) => field.visible && field.pattern && !patternValue(field.pattern, baselineValue(field)).confident,
      )
        ? "manual"
        : "valid",
      expectedResult: "所有已知欄位限制應通過；未獲送出授權時僅驗證至送出前。",
      priority: 1,
    }),
  );

  for (const field of testableFields) {
    if (field.boolean && !sampledBooleanKeys.has(field.key)) continue;
    if (field.disabled || field.readOnly) {
      candidates.push(
        createCandidate({
          type: "唯讀或停用",
          description: `確認「${field.column}」不可由使用者編輯。`,
          expectedKind: "readonly",
          expectedResult: "欄位應維持唯讀或停用，Playwright 不應能編輯。",
          targets: [field.key],
          priority: 4,
        }),
      );
      continue;
    }

    if (field.boolean) {
      for (const value of [true, false]) {
        candidates.push(
          createCandidate({
            type: "布林抽樣",
            description: `將「${field.column}」設定為 ${value}。`,
            expectedKind: field.required && value === false ? "invalid" : "valid",
            expectedResult:
              field.required && value === false
                ? "必填布林欄位未勾選時應阻止送出或顯示錯誤。"
                : "布林值應被接受並維持正確狀態。",
            mutations: { [field.key]: value },
            targets: [field.key],
            priority: field.required && value === false ? 2 : 5,
          }),
        );
      }
      continue;
    }

    if (field.required) {
      const emptyValue =
        ["checkbox-group", "select-multiple"].includes(field.type) ? [] : null;
      candidates.push(
        createCandidate({
          type: "必填",
          description: `清空必填欄位「${field.column}」。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出或顯示必填錯誤。",
          mutations: { [field.key]: emptyValue },
          targets: [field.key],
          priority: 2,
        }),
      );
    }

    if (field.type === "email") {
      candidates.push(
        createCandidate({
          type: "格式",
          description: `在「${field.column}」輸入不合法 Email。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出或顯示 Email 格式錯誤。",
          mutations: { [field.key]: "not-an-email" },
          targets: [field.key],
          priority: 2,
        }),
      );
    }
    if (field.type === "url") {
      candidates.push(
        createCandidate({
          type: "格式",
          description: `在「${field.column}」輸入不合法 URL。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出或顯示 URL 格式錯誤。",
          mutations: { [field.key]: "not a url" },
          targets: [field.key],
          priority: 2,
        }),
      );
    }

    if (["number", "range", "date", "datetime-local", "month", "week", "time"].includes(field.type)) {
      const { min, max, step } = numericBounds(field);
      if (field.min !== null && field.min !== "") {
        candidates.push(
          createCandidate({
            type: "邊界值",
            description: `將「${field.column}」設為最小值 ${field.min}。`,
            expectedKind: "valid",
            expectedResult: "最小邊界值應通過驗證。",
            mutations: { [field.key]: field.min },
            targets: [field.key],
            priority: 5,
          }),
        );
        const below =
          min !== null ? min - (step || 1) : field.type === "date" ? "1900-01-01" : null;
        if (below !== null) {
          candidates.push(
            createCandidate({
              type: "邊界值",
              description: `將「${field.column}」設為低於最小值。`,
              expectedKind: "invalid",
              expectedResult: "應阻止送出或顯示低於最小值錯誤。",
              mutations: { [field.key]: below },
              targets: [field.key],
              priority: 2,
            }),
          );
        }
      }
      if (field.max !== null && field.max !== "") {
        candidates.push(
          createCandidate({
            type: "邊界值",
            description: `將「${field.column}」設為最大值 ${field.max}。`,
            expectedKind: "valid",
            expectedResult: "最大邊界值應通過驗證。",
            mutations: { [field.key]: field.max },
            targets: [field.key],
            priority: 5,
          }),
        );
        const above =
          max !== null ? max + (step || 1) : field.type === "date" ? "2999-12-31" : null;
        if (above !== null) {
          candidates.push(
            createCandidate({
              type: "邊界值",
              description: `將「${field.column}」設為高於最大值。`,
              expectedKind: "invalid",
              expectedResult: "應阻止送出或顯示高於最大值錯誤。",
              mutations: { [field.key]: above },
              targets: [field.key],
              priority: 2,
            }),
          );
        }
      }
      if (["number", "range"].includes(field.type) && step && step !== 1) {
        const baseline = Number(baselineValue(field));
        candidates.push(
          createCandidate({
            type: "步進值",
            description: `將「${field.column}」設為不符合 step=${step} 的值。`,
            expectedKind: "invalid",
            expectedResult: "應阻止送出或顯示步進值錯誤。",
            mutations: { [field.key]: baseline + step / 2 },
            targets: [field.key],
            priority: 2,
          }),
        );
      }
    }

    if (Number.isFinite(field.minLength) && field.minLength > 0) {
      candidates.push(
        createCandidate({
          type: "長度",
          description: `在「${field.column}」輸入少於 minlength=${field.minLength} 的文字。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出或顯示文字過短錯誤。",
          mutations: { [field.key]: "A".repeat(Math.max(0, field.minLength - 1)) },
          targets: [field.key],
          priority: 2,
        }),
      );
      candidates.push(
        createCandidate({
          type: "邊界值",
          description: `在「${field.column}」輸入剛好 minlength=${field.minLength} 的文字。`,
          expectedKind: "valid",
          expectedResult: "最小長度邊界應通過驗證。",
          mutations: { [field.key]: "A".repeat(field.minLength) },
          targets: [field.key],
          priority: 5,
        }),
      );
    }
    if (Number.isFinite(field.maxLength) && field.maxLength >= 0) {
      candidates.push(
        createCandidate({
          type: "邊界值",
          description: `在「${field.column}」輸入剛好 maxlength=${field.maxLength} 的文字。`,
          expectedKind: "valid",
          expectedResult: "最大長度邊界應通過驗證。",
          mutations: { [field.key]: "A".repeat(field.maxLength) },
          targets: [field.key],
          priority: 5,
        }),
      );
      candidates.push(
        createCandidate({
          type: "長度",
          description: `在「${field.column}」輸入超過 maxlength=${field.maxLength} 的文字。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出、截斷輸入或顯示文字過長錯誤。",
          mutations: { [field.key]: "A".repeat(field.maxLength + 1) },
          targets: [field.key],
          priority: 2,
        }),
      );
    }
    if (field.pattern) {
      candidates.push(
        createCandidate({
          type: "格式",
          description: `在「${field.column}」輸入不符合 pattern 的文字。`,
          expectedKind: "invalid",
          expectedResult: "應阻止送出或顯示格式錯誤。",
          mutations: { [field.key]: "INVALID!測試" },
          targets: [field.key],
          priority: 2,
        }),
      );
    }
    if (field.hasInferredRule) {
      candidates.push(
        createCandidate({
          type: "推測規則",
          description: `根據「${field.column}」附近說明文字建立人工覆核案例。`,
          expectedKind: "manual",
          expectedResult: "規則來自自然語言推測，需人工確認預期與實際結果。",
          targets: [field.key],
          priority: 3,
          manualReason: field.inferredRuleText,
        }),
      );
    }
    if (field.discoveredBy) {
      candidates.push(
        createCandidate({
          type: "條件式欄位",
          description: `啟用條件後填寫動態欄位「${field.column}」。`,
          expectedKind: "valid",
          expectedResult: "條件式欄位應出現、可操作，且合法資料應通過驗證。",
          targets: [field.key],
          priority: 3,
        }),
      );
    }
    if (["input", "textarea", "text", "search", "tel"].includes(field.widget) || field.type === "textarea") {
      candidates.push(
        createCandidate({
          type: "Unicode",
          description: `在「${field.column}」輸入安全的 Unicode 合成文字。`,
          expectedKind: field.pattern ? "manual" : "valid",
          expectedResult: field.pattern
            ? "欄位含 pattern，Unicode 是否允許需人工確認。"
            : "Unicode 合成文字應被正常接受。",
          mutations: { [field.key]: clampText("測試ＡＢＣ１２３", field) },
          targets: [field.key],
          priority: 7,
        }),
      );
      candidates.push(
        createCandidate({
          type: "前後空白",
          description: `在「${field.column}」輸入含前後空白的資料。`,
          expectedKind: "manual",
          expectedResult: "應依頁面規範保留或去除空白，需人工確認。",
          mutations: { [field.key]: clampText("  測試資料  ", field) },
          targets: [field.key],
          priority: 7,
        }),
      );
    }
  }

  const pairwiseFields = testableFields.filter(
    (field) =>
      !field.boolean &&
      !field.disabled &&
      !field.readOnly &&
      !field.discoveredBy &&
      !field.hasInferredRule &&
      validVariants(field).length >= 2,
  );
  const domains = pairwiseFields.map((field) => ({
    field,
    values: validVariants(field).slice(0, 3),
  }));
  const pairwise = pairwiseRows(domains, 30);
  for (const row of pairwise.rows) {
    candidates.push(
      createCandidate({
        type: "Pairwise",
        description: "使用成對組合覆蓋多欄位合法值互動。",
        expectedKind: "valid",
        expectedResult: "所有 pairwise 合法值組合應通過驗證。",
        mutations: row,
        targets: Object.keys(row),
        priority: 6,
      }),
    );
  }

  const seen = new Set();
  const deduplicated = candidates.filter((candidate) => {
    const signature = JSON.stringify([
      candidate.expected.kind,
      candidate.values,
      candidate.targetFieldKeys,
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });

  const nonBooleanCount = testableFields.filter((field) => !field.boolean).length;
  const hasConditional = testableFields.some((field) => field.discoveredBy);
  const hasCrossField = testableFields.some((field) => field.hasInferredRule);
  const simple = nonBooleanCount <= 10 && !hasConditional && !hasCrossField && !form.multiStep;
  const maxCases = explicitMax > 0 ? explicitMax : simple ? 50 : 100;
  const ordered = deduplicated
    .map((candidate, originalIndex) => ({ ...candidate, originalIndex }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex);
  const retained = ordered.slice(0, maxCases);
  const cut = ordered.slice(maxCases);
  cut.forEach((candidate) =>
    globalSkips.push({
      form: form.label,
      case: candidate.description,
      reason: `超過 ${maxCases} 筆案例上限，依風險優先順序裁減。`,
    }),
  );

  const sheetName = sanitizeSheetName(`form_${String(form.index + 1).padStart(2, "0")}`);
  retained.forEach((candidate, index) => {
    candidate.id = `F${String(form.index + 1).padStart(2, "0")}-TC${String(index + 1).padStart(3, "0")}`;
    candidate.sheetName = sheetName;
    candidate.slug = `${candidate.id}_${candidate.targetFieldKeys[0] || candidate.testType}`;
    delete candidate.priority;
    delete candidate.originalIndex;
  });

  generatedForms.push({
    form: {
      index: form.index,
      selector: form.selector,
      label: form.label,
      sheetName,
      submitSelector: form.submitSelector,
    },
    fields: fields.map((field) => ({
      key: field.key,
      column: field.column,
      type: field.type,
      label: field.label,
      selector: field.selector,
      required: field.required,
      disabled: field.disabled,
      readOnly: field.readOnly,
      discoveredBy: field.discoveredBy,
      unsupported: field.unsupported,
    })),
    cases: retained,
    limits: {
      simple,
      maxCases,
      generatedCandidates: deduplicated.length,
      retainedCases: retained.length,
      cutCases: cut.length,
    },
    booleanSampling: {
      total: booleanFields.length,
      sampled: sampledBooleans.map((field) => field.key),
      omitted: booleanFields
        .filter((field) => !sampledBooleanKeys.has(field.key))
        .map((field) => field.key),
    },
    pairwise: {
      fields: domains.map((domain) => domain.field.key),
      totalPairs: pairwise.totalPairs,
      coveredPairsBeforeCaseCap: pairwise.coveredPairs,
      uncoveredPairsBeforeCaseCap: pairwise.uncoveredPairs,
      generatedRows: pairwise.rows.length,
      retainedRows: retained.filter((candidate) => candidate.testType === "Pairwise").length,
    },
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  prjId: spec.prjId,
  source: spec.source,
  policy: {
    simpleFormMaxCases: 50,
    complexFormMaxCases: 100,
    explicitMaxCases: explicitMax || null,
    booleanSamplingThreshold: 3,
  },
  forms: generatedForms,
  skipped: globalSkips,
  totals: {
    forms: generatedForms.length,
    fields: generatedForms.reduce((sum, form) => sum + form.fields.length, 0),
    cases: generatedForms.reduce((sum, form) => sum + form.cases.length, 0),
    skipped: globalSkips.length,
  },
};

await writeJson(path.resolve(args.output), output);
console.log(JSON.stringify(output.totals));
