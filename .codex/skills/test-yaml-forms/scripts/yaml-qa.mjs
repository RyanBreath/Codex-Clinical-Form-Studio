import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PROJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FIELD_TYPES = new Set([
  "text", "textarea", "email", "tel", "url", "integer", "number",
  "date", "time", "datetime", "select", "radio", "checkbox", "boolean",
]);
const CONDITION_OPERATORS = new Set([
  "equals", "not_equals", "in", "not_in", "is_empty", "not_empty",
  "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal",
]);
const COMPARE_OPERATORS = new Set([
  "equals", "not_equals", "greater_than", "greater_than_or_equal",
  "less_than", "less_than_or_equal",
]);

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function yamlError(message, line) {
  const suffix = line ? `（第 ${line} 行）` : "";
  const error = new Error(`YAML 解析失敗${suffix}：${message}`);
  error.code = "YAML_PARSE_ERROR";
  return error;
}

function stripComment(text) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(text[index - 1]))) return text.slice(0, index);
  }
  if (quote) throw yamlError("不支援跨行 quoted scalar，或引號未關閉");
  return text;
}

function findMappingColon(text) {
  let quote = null;
  let escaped = false;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === ":" && square === 0 && curly === 0 && (index === text.length - 1 || /\s/.test(text[index + 1]))) return index;
  }
  return -1;
}

function splitFlow(text, line) {
  const parts = [];
  let quote = null;
  let escaped = false;
  let square = 0;
  let curly = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === "," && square === 0 && curly === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
    if (square < 0 || curly < 0) throw yamlError("flow collection 括號不成對", line);
  }
  if (quote || square !== 0 || curly !== 0) throw yamlError("flow collection 未關閉", line);
  parts.push(text.slice(start).trim());
  return parts;
}

function parseKey(raw, line) {
  const value = parseScalar(raw, line, true);
  if (typeof value !== "string" || !value) throw yamlError("mapping key 必須是非空字串", line);
  if (value === "<<") throw yamlError("不支援 YAML merge key", line);
  return value;
}

function rejectUnsafePlain(value, line) {
  if (/^[!&*]/.test(value) || /(^|\s)[&*][A-Za-z0-9_-]+(?:\s|$)/.test(value)) {
    throw yamlError("不支援 tag、anchor 或 alias", line);
  }
  if (/^(?:\.?(?:nan|inf)|[-+]\.inf)$/i.test(value)) throw yamlError("不支援 NaN 或 Infinity", line);
  if (value === "|" || value === ">" || /^[|>][+-]?$/.test(value)) throw yamlError("不支援 block scalar", line);
}

function parseScalar(raw, line, keyMode = false) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw yamlError("雙引號字串未關閉", line);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not string");
      return parsed;
    } catch {
      throw yamlError("雙引號字串不是有效的 JSON/YAML escape", line);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw yamlError("單引號字串未關閉", line);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw yamlError("flow sequence 未關閉", line);
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlow(inner, line).map((item) => parseScalar(item, line));
  }
  if (value.startsWith("{")) {
    if (!value.endsWith("}")) throw yamlError("flow mapping 未關閉", line);
    const object = {};
    const inner = value.slice(1, -1).trim();
    if (!inner) return object;
    for (const item of splitFlow(inner, line)) {
      const colon = findMappingColon(item);
      if (colon < 1) throw yamlError("flow mapping 項目缺少冒號", line);
      const key = parseKey(item.slice(0, colon), line);
      if (Object.hasOwn(object, key)) throw yamlError(`重複的 mapping key：${key}`, line);
      object[key] = parseScalar(item.slice(colon + 1), line);
    }
    return object;
  }
  rejectUnsafePlain(value, line);
  if (keyMode) return value;
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)$/.test(value)) return Number(value);
  if (/^-?(?:0|[1-9]\d*)\.\d+(?:[eE][-+]?\d+)?$/.test(value) || /^-?(?:0|[1-9]\d*)[eE][-+]?\d+$/.test(value)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw yamlError("數字超出有限範圍", line);
    return number;
  }
  if (/^[\[\]{}]/.test(value) || /[\[\]{}]$/.test(value)) throw yamlError("flow collection 語法不完整", line);
  return value;
}

function tokenizeYaml(text) {
  const tokens = [];
  let documentStarted = false;
  let contentSeen = false;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const indentText = original.match(/^[ \t]*/)?.[0] || "";
    if (indentText.includes("\t")) throw yamlError("縮排不得使用 tab", index + 1);
    const uncommented = stripComment(original).replace(/\s+$/, "");
    const content = uncommented.trim();
    if (!content) continue;
    if (content === "---") {
      if (documentStarted || contentSeen) throw yamlError("只允許一份 YAML 文件", index + 1);
      documentStarted = true;
      continue;
    }
    if (content === "..." || content.startsWith("%")) throw yamlError("不支援文件結束標記、directive 或多文件", index + 1);
    contentSeen = true;
    const indent = indentText.length;
    if (content.startsWith("- ")) {
      const rest = content.slice(2).trim();
      const colon = findMappingColon(rest);
      if (colon > 0 && !rest.startsWith("{") && !rest.startsWith("[")) {
        tokens.push({ indent, content: "-", line: index + 1 });
        tokens.push({ indent: indent + 2, content: rest, line: index + 1, synthetic: true });
        continue;
      }
    }
    tokens.push({ indent, content, line: index + 1 });
  }
  if (!tokens.length) throw yamlError("文件沒有內容");
  return tokens;
}

function parseBlock(tokens, start, indent) {
  if (start >= tokens.length || tokens[start].indent !== indent) throw yamlError("縮排層級不一致", tokens[start]?.line);
  if (tokens[start].content === "-" || tokens[start].content.startsWith("- ")) return parseSequence(tokens, start, indent);
  return parseMapping(tokens, start, indent);
}

function parseSequence(tokens, start, indent) {
  const array = [];
  let index = start;
  while (index < tokens.length && tokens[index].indent === indent) {
    const token = tokens[index];
    if (!(token.content === "-" || token.content.startsWith("- "))) throw yamlError("同一縮排層級不可混用 sequence 與 mapping", token.line);
    const rest = token.content.slice(1).trim();
    index += 1;
    if (rest) {
      array.push(parseScalar(rest, token.line));
      if (index < tokens.length && tokens[index].indent > indent) throw yamlError("scalar sequence 項目後不可接巢狀區塊", tokens[index].line);
    } else if (index < tokens.length && tokens[index].indent > indent) {
      const parsed = parseBlock(tokens, index, tokens[index].indent);
      array.push(parsed.value);
      index = parsed.next;
    } else array.push(null);
  }
  return { value: array, next: index };
}

function parseMapping(tokens, start, indent) {
  const object = {};
  let index = start;
  while (index < tokens.length && tokens[index].indent === indent) {
    const token = tokens[index];
    if (token.content === "-" || token.content.startsWith("- ")) throw yamlError("同一縮排層級不可混用 mapping 與 sequence", token.line);
    const colon = findMappingColon(token.content);
    if (colon < 1) throw yamlError("mapping 項目缺少冒號", token.line);
    const key = parseKey(token.content.slice(0, colon), token.line);
    if (Object.hasOwn(object, key)) throw yamlError(`重複的 mapping key：${key}`, token.line);
    const rest = token.content.slice(colon + 1).trim();
    index += 1;
    if (rest) {
      object[key] = parseScalar(rest, token.line);
      if (index < tokens.length && tokens[index].indent > indent) throw yamlError("有值的 mapping 項目後不可接巢狀區塊", tokens[index].line);
    } else if (index < tokens.length && tokens[index].indent > indent) {
      const parsed = parseBlock(tokens, index, tokens[index].indent);
      object[key] = parsed.value;
      index = parsed.next;
    } else object[key] = null;
  }
  return { value: object, next: index };
}

function parseSafeYaml(text) {
  const tokens = tokenizeYaml(text);
  if (tokens[0].indent !== 0) throw yamlError("根節點必須從第 1 欄開始", tokens[0].line);
  const parsed = parseBlock(tokens, 0, 0);
  if (parsed.next !== tokens.length) throw yamlError("存在無法解析的縮排區塊", tokens[parsed.next]?.line);
  return parsed.value;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueKey(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function addFinding(findings, severity, code, targetPath, message, suggestion = "") {
  findings.push({ severity, code, path: targetPath, message, suggestion });
}

function checkKeys(object, allowed, targetPath, findings) {
  if (!isObject(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.has(key) && !key.startsWith("x-")) {
      addFinding(findings, "ERROR", "UNKNOWN_KEY", `${targetPath}.${key}`, `不支援的 key：${key}`, "移除、改用規格內 key，或以前綴 x- 保存 extension。 ");
    }
  }
}

function normalizeOption(option, targetPath, findings) {
  if (["string", "number", "boolean"].includes(typeof option)) return { value: option, label: String(option), disabled: false };
  if (!isObject(option)) {
    addFinding(findings, "ERROR", "OPTION_SHAPE", targetPath, "option 必須是 scalar 或 mapping。", "提供 value、label 與 optional disabled。");
    return null;
  }
  checkKeys(option, new Set(["value", "label", "disabled"]), targetPath, findings);
  if (!Object.hasOwn(option, "value") || !["string", "number", "boolean"].includes(typeof option.value)) {
    addFinding(findings, "ERROR", "OPTION_VALUE", `${targetPath}.value`, "option.value 必須是字串、數字或 Boolean。", "提供可序列化的單一值。");
    return null;
  }
  if (option.disabled !== undefined && typeof option.disabled !== "boolean") addFinding(findings, "ERROR", "OPTION_DISABLED_TYPE", `${targetPath}.disabled`, "disabled 必須是 Boolean。");
  return { value: option.value, label: typeof option.label === "string" ? option.label : String(option.value), disabled: option.disabled === true };
}

function booleanValue(object, key, targetPath, findings) {
  if (object[key] === undefined) return false;
  if (typeof object[key] !== "boolean") {
    addFinding(findings, "ERROR", "BOOLEAN_TYPE", `${targetPath}.${key}`, `${key} 必須是 Boolean。`, "使用 true 或 false，不要加引號。");
    return false;
  }
  return object[key];
}

function normalizeCondition(raw, targetPath, fieldId, fieldIds, findings) {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) {
    addFinding(findings, "ERROR", "CONDITION_SHAPE", targetPath, "條件必須是 mapping。", "提供 field、operator 與需要時的 value。");
    return null;
  }
  checkKeys(raw, new Set(["field", "operator", "value"]), targetPath, findings);
  if (typeof raw.field !== "string" || !fieldIds.has(raw.field)) addFinding(findings, "ERROR", "CONDITION_FIELD", `${targetPath}.field`, `條件引用不存在的欄位：${String(raw.field)}`, "改成同一份表單內的 field id。");
  if (raw.field === fieldId) addFinding(findings, "ERROR", "CONDITION_SELF_REFERENCE", `${targetPath}.field`, "條件不得自我參照。", "改由另一個 driver 欄位控制。");
  if (!CONDITION_OPERATORS.has(raw.operator)) addFinding(findings, "ERROR", "CONDITION_OPERATOR", `${targetPath}.operator`, `不支援的條件 operator：${String(raw.operator)}`);
  if (["in", "not_in"].includes(raw.operator) && !Array.isArray(raw.value)) addFinding(findings, "ERROR", "CONDITION_VALUE", `${targetPath}.value`, `${raw.operator} 的 value 必須是 sequence。`);
  if (!["is_empty", "not_empty"].includes(raw.operator) && !Object.hasOwn(raw, "value")) addFinding(findings, "ERROR", "CONDITION_VALUE_MISSING", `${targetPath}.value`, `${String(raw.operator)} 需要 value。`);
  return { field: raw.field, operator: raw.operator, value: raw.value };
}

function normalizeConstraints(raw, fieldType, targetPath, findings) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) {
    addFinding(findings, "ERROR", "CONSTRAINTS_SHAPE", targetPath, "constraints 必須是 mapping。");
    return {};
  }
  const allowed = new Set(["min_length", "max_length", "pattern", "minimum", "maximum", "exclusive_minimum", "exclusive_maximum", "multiple_of", "min_items", "max_items"]);
  checkKeys(raw, allowed, targetPath, findings);
  const constraints = {};
  const integerKeys = ["min_length", "max_length", "min_items", "max_items"];
  for (const key of integerKeys) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < 0) addFinding(findings, "ERROR", "CONSTRAINT_INTEGER", `${targetPath}.${key}`, `${key} 必須是大於等於 0 的整數。`);
    else constraints[key] = raw[key];
  }
  if (raw.pattern !== undefined) {
    if (typeof raw.pattern !== "string") addFinding(findings, "ERROR", "PATTERN_TYPE", `${targetPath}.pattern`, "pattern 必須是字串。");
    else {
      try {
        new RegExp(raw.pattern);
        constraints.pattern = raw.pattern;
      } catch (error) {
        addFinding(findings, "ERROR", "PATTERN_INVALID", `${targetPath}.pattern`, `無效的 regular expression：${error.message}`, "移除 /.../ delimiter 並修正語法。");
      }
    }
  }
  for (const key of ["exclusive_minimum", "exclusive_maximum"]) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") addFinding(findings, "ERROR", "CONSTRAINT_BOOLEAN", `${targetPath}.${key}`, `${key} 必須是 Boolean。`);
    else constraints[key] = raw[key];
  }
  const temporal = ["date", "time", "datetime"].includes(fieldType);
  for (const key of ["minimum", "maximum"]) {
    if (raw[key] === undefined) continue;
    if (temporal ? typeof raw[key] !== "string" : typeof raw[key] !== "number" || !Number.isFinite(raw[key])) addFinding(findings, "ERROR", "BOUND_TYPE", `${targetPath}.${key}`, temporal ? `${key} 必須是 ISO 字串。` : `${key} 必須是有限數字。`);
    else constraints[key] = raw[key];
  }
  if (raw.multiple_of !== undefined) {
    if (typeof raw.multiple_of !== "number" || !Number.isFinite(raw.multiple_of) || raw.multiple_of <= 0) addFinding(findings, "ERROR", "MULTIPLE_OF", `${targetPath}.multiple_of`, "multiple_of 必須是大於 0 的有限數字。");
    else constraints.multiple_of = raw.multiple_of;
  }
  const textType = ["text", "textarea", "email", "tel", "url"].includes(fieldType);
  const numberType = ["integer", "number"].includes(fieldType);
  for (const key of Object.keys(constraints)) {
    if (["min_length", "max_length", "pattern"].includes(key) && !textType) addFinding(findings, "ERROR", "CONSTRAINT_NOT_APPLICABLE", `${targetPath}.${key}`, `${key} 不適用於 ${fieldType}。`);
    if (["minimum", "maximum", "exclusive_minimum", "exclusive_maximum"].includes(key) && !(numberType || temporal)) addFinding(findings, "ERROR", "CONSTRAINT_NOT_APPLICABLE", `${targetPath}.${key}`, `${key} 不適用於 ${fieldType}。`);
    if (key === "multiple_of" && !numberType) addFinding(findings, "ERROR", "CONSTRAINT_NOT_APPLICABLE", `${targetPath}.${key}`, `multiple_of 不適用於 ${fieldType}。`);
    if (["min_items", "max_items"].includes(key) && fieldType !== "checkbox") addFinding(findings, "ERROR", "CONSTRAINT_NOT_APPLICABLE", `${targetPath}.${key}`, `${key} 只適用於 checkbox。`);
  }
  if (constraints.min_length > constraints.max_length) addFinding(findings, "ERROR", "LENGTH_ORDER", targetPath, "min_length 不得大於 max_length。");
  if (constraints.min_items > constraints.max_items) addFinding(findings, "ERROR", "ITEM_ORDER", targetPath, "min_items 不得大於 max_items。");
  if (constraints.minimum !== undefined && constraints.maximum !== undefined && compareScalar(constraints.minimum, constraints.maximum) > 0) addFinding(findings, "ERROR", "BOUND_ORDER", targetPath, "minimum 不得大於 maximum。");
  return constraints;
}

function normalizeRule(raw, targetPath, fieldIds, findings) {
  if (!isObject(raw)) {
    addFinding(findings, "ERROR", "RULE_SHAPE", targetPath, "rule 必須是 mapping。");
    return null;
  }
  checkKeys(raw, new Set(["id", "type", "left", "operator", "right", "fields", "message"]), targetPath, findings);
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) addFinding(findings, "ERROR", "RULE_ID", `${targetPath}.id`, "rule id 必須符合 ^[A-Za-z][A-Za-z0-9_-]{0,63}$。");
  if (!["compare", "at_least_one", "all_or_none"].includes(raw.type)) addFinding(findings, "ERROR", "RULE_TYPE", `${targetPath}.type`, `不支援的 rule type：${String(raw.type)}`);
  if (raw.type === "compare") {
    for (const side of ["left", "right"]) if (typeof raw[side] !== "string" || !fieldIds.has(raw[side])) addFinding(findings, "ERROR", "RULE_FIELD", `${targetPath}.${side}`, `${side} 必須引用同一份表單內的欄位。`);
    if (!COMPARE_OPERATORS.has(raw.operator)) addFinding(findings, "ERROR", "RULE_OPERATOR", `${targetPath}.operator`, `不支援的 compare operator：${String(raw.operator)}`);
  } else if (!["at_least_one", "all_or_none"].includes(raw.type) || !Array.isArray(raw.fields) || raw.fields.length < 2) addFinding(findings, "ERROR", "RULE_FIELDS", `${targetPath}.fields`, `${String(raw.type)} 需要至少兩個 field id。`);
  if (Array.isArray(raw.fields)) for (const field of raw.fields) if (typeof field !== "string" || !fieldIds.has(field)) addFinding(findings, "ERROR", "RULE_FIELD", `${targetPath}.fields`, `規則引用不存在的欄位：${String(field)}`);
  return { id: raw.id, type: raw.type, left: raw.left, operator: raw.operator, right: raw.right, fields: raw.fields, message: raw.message };
}

function validateAndNormalize(raw, overrideProjectId) {
  const findings = [];
  if (!isObject(raw)) throw new Error("YAML 根節點必須是 mapping。");
  checkKeys(raw, new Set(["spec_version", "prj_id", "title", "locale", "description", "forms", "metadata"]), "$", findings);
  if (raw.spec_version !== "1.0") addFinding(findings, "ERROR", "SPEC_VERSION", "$.spec_version", "spec_version 必須是字串 \"1.0\"。", "請加上雙引號，避免被解析成數字。");
  const projectId = overrideProjectId || raw.prj_id;
  if (!projectId) throw new Error("缺少 prj_id；請在 YAML 根節點提供，或明確傳入 -PrjId。");
  if (typeof projectId !== "string" || !PROJECT_PATTERN.test(projectId)) throw new Error("prj_id 必須符合 ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$。");
  if (overrideProjectId && raw.prj_id && overrideProjectId !== raw.prj_id) addFinding(findings, "INFO", "PROJECT_OVERRIDE", "$.prj_id", `CLI prj_id ${overrideProjectId} 已覆寫 YAML 值 ${raw.prj_id}。`);
  if (raw.title !== undefined && typeof raw.title !== "string") addFinding(findings, "ERROR", "TITLE_TYPE", "$.title", "title 必須是字串。");
  if (raw.title === undefined) addFinding(findings, "INFO", "TITLE_MISSING", "$.title", "建議提供文件 title，提升報告可讀性。");
  if (!Array.isArray(raw.forms) || raw.forms.length === 0) addFinding(findings, "ERROR", "FORMS_REQUIRED", "$.forms", "forms 必須是非空 sequence。");
  if (Array.isArray(raw.forms) && raw.forms.length > 50) addFinding(findings, "ERROR", "FORM_LIMIT", "$.forms", "表單數超過 50 的安全上限。");

  const forms = [];
  const formIds = new Set();
  for (const [formIndex, rawForm] of (Array.isArray(raw.forms) ? raw.forms.slice(0, 50) : []).entries()) {
    const formPath = `$.forms[${formIndex}]`;
    if (!isObject(rawForm)) {
      addFinding(findings, "ERROR", "FORM_SHAPE", formPath, "form 必須是 mapping。");
      continue;
    }
    checkKeys(rawForm, new Set(["id", "title", "description", "fields", "rules", "metadata"]), formPath, findings);
    const formId = typeof rawForm.id === "string" ? rawForm.id : `__invalid_form_${formIndex + 1}`;
    if (!ID_PATTERN.test(formId)) addFinding(findings, "ERROR", "FORM_ID", `${formPath}.id`, "form id 必須符合 ^[A-Za-z][A-Za-z0-9_-]{0,63}$。");
    if (formIds.has(formId)) addFinding(findings, "ERROR", "FORM_ID_DUPLICATE", `${formPath}.id`, `重複的 form id：${formId}`);
    formIds.add(formId);
    if (!Array.isArray(rawForm.fields) || rawForm.fields.length === 0) addFinding(findings, "ERROR", "FIELDS_REQUIRED", `${formPath}.fields`, "fields 必須是非空 sequence。");
    if (Array.isArray(rawForm.fields) && rawForm.fields.length > 200) addFinding(findings, "ERROR", "FIELD_LIMIT", `${formPath}.fields`, "欄位數超過 200 的安全上限。");
    const fields = [];
    const fieldIds = new Set();
    for (const [fieldIndex, rawField] of (Array.isArray(rawForm.fields) ? rawForm.fields.slice(0, 200) : []).entries()) {
      const fieldPath = `${formPath}.fields[${fieldIndex}]`;
      if (!isObject(rawField)) {
        addFinding(findings, "ERROR", "FIELD_SHAPE", fieldPath, "field 必須是 mapping。");
        continue;
      }
      checkKeys(rawField, new Set(["id", "label", "type", "description", "required", "read_only", "disabled", "sensitive", "default", "placeholder", "options", "constraints", "visible_when", "required_when", "metadata"]), fieldPath, findings);
      const fieldId = typeof rawField.id === "string" ? rawField.id : `__invalid_field_${fieldIndex + 1}`;
      if (!ID_PATTERN.test(fieldId)) addFinding(findings, "ERROR", "FIELD_ID", `${fieldPath}.id`, "field id 必須符合 ^[A-Za-z][A-Za-z0-9_-]{0,63}$。");
      if (fieldIds.has(fieldId)) addFinding(findings, "ERROR", "FIELD_ID_DUPLICATE", `${fieldPath}.id`, `重複的 field id：${fieldId}`);
      fieldIds.add(fieldId);
      if (!FIELD_TYPES.has(rawField.type)) addFinding(findings, "ERROR", "FIELD_TYPE", `${fieldPath}.type`, `不支援的欄位 type：${String(rawField.type)}`);
      if (rawField.label !== undefined && typeof rawField.label !== "string") addFinding(findings, "ERROR", "LABEL_TYPE", `${fieldPath}.label`, "label 必須是字串。");
      if (rawField.label === undefined) addFinding(findings, "WARNING", "LABEL_MISSING", `${fieldPath}.label`, `欄位 ${fieldId} 沒有 label。`, "提供使用者可讀的 label。");
      const options = Array.isArray(rawField.options) ? rawField.options.map((option, optionIndex) => normalizeOption(option, `${fieldPath}.options[${optionIndex}]`, findings)).filter(Boolean) : [];
      if (rawField.options !== undefined && !Array.isArray(rawField.options)) addFinding(findings, "ERROR", "OPTIONS_SHAPE", `${fieldPath}.options`, "options 必須是 sequence。");
      if (["select", "radio", "checkbox"].includes(rawField.type) && options.length === 0) addFinding(findings, "ERROR", "OPTIONS_REQUIRED", `${fieldPath}.options`, `${rawField.type} 至少需要一個 option。`);
      if (!["select", "radio", "checkbox"].includes(rawField.type) && rawField.options !== undefined) addFinding(findings, "ERROR", "OPTIONS_NOT_APPLICABLE", `${fieldPath}.options`, `options 不適用於 ${String(rawField.type)}。`);
      const optionKeys = new Set();
      for (const option of options) {
        const key = JSON.stringify(option.value);
        if (optionKeys.has(key)) addFinding(findings, "ERROR", "OPTION_DUPLICATE", `${fieldPath}.options`, `重複的 option value：${String(option.value)}`);
        optionKeys.add(key);
      }
      const readOnly = booleanValue(rawField, "read_only", fieldPath, findings);
      const disabled = booleanValue(rawField, "disabled", fieldPath, findings);
      if (readOnly && disabled) addFinding(findings, "ERROR", "FIELD_STATE_CONFLICT", fieldPath, "read_only 與 disabled 不得同時為 true。");
      fields.push({
        id: fieldId,
        label: typeof rawField.label === "string" ? rawField.label : fieldId,
        type: rawField.type,
        required: booleanValue(rawField, "required", fieldPath, findings),
        read_only: readOnly,
        disabled,
        sensitive: booleanValue(rawField, "sensitive", fieldPath, findings),
        hasDefault: Object.hasOwn(rawField, "default"),
        default: rawField.default,
        placeholder: rawField.placeholder,
        options,
        constraints: normalizeConstraints(rawField.constraints, rawField.type, `${fieldPath}.constraints`, findings),
        rawVisibleWhen: rawField.visible_when,
        rawRequiredWhen: rawField.required_when,
        sourcePath: fieldPath,
      });
    }
    for (const field of fields) {
      field.visible_when = normalizeCondition(field.rawVisibleWhen, `${field.sourcePath}.visible_when`, field.id, fieldIds, findings);
      field.required_when = normalizeCondition(field.rawRequiredWhen, `${field.sourcePath}.required_when`, field.id, fieldIds, findings);
      delete field.rawVisibleWhen;
      delete field.rawRequiredWhen;
    }
    const ruleIds = new Set();
    const rules = [];
    if (rawForm.rules !== undefined && !Array.isArray(rawForm.rules)) addFinding(findings, "ERROR", "RULES_SHAPE", `${formPath}.rules`, "rules 必須是 sequence。");
    for (const [ruleIndex, rawRule] of (Array.isArray(rawForm.rules) ? rawForm.rules : []).entries()) {
      const rule = normalizeRule(rawRule, `${formPath}.rules[${ruleIndex}]`, fieldIds, findings);
      if (!rule) continue;
      if (ruleIds.has(rule.id)) addFinding(findings, "ERROR", "RULE_ID_DUPLICATE", `${formPath}.rules[${ruleIndex}].id`, `重複的 rule id：${String(rule.id)}`);
      ruleIds.add(rule.id);
      rules.push(rule);
    }
    forms.push({ id: formId, title: typeof rawForm.title === "string" ? rawForm.title : formId, fields, rules });
  }
  const spec = { spec_version: raw.spec_version, prj_id: projectId, title: typeof raw.title === "string" ? raw.title : projectId, locale: raw.locale, forms };
  for (const form of forms) {
    for (const field of form.fields) {
      if (!field.hasDefault) continue;
      const errors = validateFieldValue(field, field.default, false);
      if (errors.length) addFinding(findings, "ERROR", "DEFAULT_INVALID", `${field.sourcePath}.default`, `default 不符合欄位規則：${errors.join("；")}`, "修正 default 或移除它。");
    }
  }
  return { spec, findings };
}

function isEmpty(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function compareScalar(left, right) {
  if (typeof left === "number" && typeof right === "number") return left === right ? 0 : left < right ? -1 : 1;
  const l = String(left);
  const r = String(right);
  return l === r ? 0 : l < r ? -1 : 1;
}

function conditionMatches(condition, values) {
  if (!condition || typeof condition.field !== "string") return false;
  const current = values[condition.field];
  switch (condition.operator) {
    case "equals": return JSON.stringify(current) === JSON.stringify(condition.value);
    case "not_equals": return JSON.stringify(current) !== JSON.stringify(condition.value);
    case "in": return Array.isArray(condition.value) && condition.value.some((item) => JSON.stringify(item) === JSON.stringify(current));
    case "not_in": return Array.isArray(condition.value) && !condition.value.some((item) => JSON.stringify(item) === JSON.stringify(current));
    case "is_empty": return isEmpty(current);
    case "not_empty": return !isEmpty(current);
    case "greater_than": return compareScalar(current, condition.value) > 0;
    case "greater_than_or_equal": return compareScalar(current, condition.value) >= 0;
    case "less_than": return compareScalar(current, condition.value) < 0;
    case "less_than_or_equal": return compareScalar(current, condition.value) <= 0;
    default: return false;
  }
}

function parseTemporal(type, value) {
  if (typeof value !== "string") return null;
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isNaN(time) ? null : time;
  }
  if (type === "time" && /^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    const [hour, minute, second = 0] = value.split(":").map(Number);
    return hour <= 23 && minute <= 59 && second <= 59 ? hour * 3600 + minute * 60 + second : null;
  }
  if (type === "datetime" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    const time = Date.parse(normalized);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function validateFieldValue(field, value, required) {
  const errors = [];
  if (isEmpty(value)) {
    if (required) errors.push(`${field.id} 為必填`);
    return errors;
  }
  const type = field.type;
  const c = field.constraints || {};
  const textType = ["text", "textarea", "email", "tel", "url"].includes(type);
  if (textType) {
    if (typeof value !== "string") errors.push(`${field.id} 必須是字串`);
    else {
      if (c.min_length !== undefined && value.length < c.min_length) errors.push(`${field.id} 少於 min_length`);
      if (c.max_length !== undefined && value.length > c.max_length) errors.push(`${field.id} 超過 max_length`);
      if (c.pattern && !new RegExp(c.pattern).test(value)) errors.push(`${field.id} 不符合 pattern`);
      if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`${field.id} 不是合法 email`);
      if (type === "tel" && !/^\+?[0-9 ()-]{7,20}$/.test(value)) errors.push(`${field.id} 不是合法 tel`);
      if (type === "url") {
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol)) errors.push(`${field.id} 不是 http/https URL`);
        } catch { errors.push(`${field.id} 不是合法 URL`); }
      }
    }
  } else if (["integer", "number"].includes(type)) {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) errors.push(`${field.id} 型別不符`);
    else {
      if (c.minimum !== undefined && (c.exclusive_minimum ? value <= c.minimum : value < c.minimum)) errors.push(`${field.id} 低於 minimum`);
      if (c.maximum !== undefined && (c.exclusive_maximum ? value >= c.maximum : value > c.maximum)) errors.push(`${field.id} 高於 maximum`);
      if (c.multiple_of !== undefined && Math.abs(value / c.multiple_of - Math.round(value / c.multiple_of)) > 1e-9) errors.push(`${field.id} 不符合 multiple_of`);
    }
  } else if (["date", "time", "datetime"].includes(type)) {
    const parsed = parseTemporal(type, value);
    if (parsed === null) errors.push(`${field.id} 不是合法 ${type}`);
    else {
      const minimum = c.minimum === undefined ? null : parseTemporal(type, c.minimum);
      const maximum = c.maximum === undefined ? null : parseTemporal(type, c.maximum);
      if (minimum !== null && (c.exclusive_minimum ? parsed <= minimum : parsed < minimum)) errors.push(`${field.id} 低於 minimum`);
      if (maximum !== null && (c.exclusive_maximum ? parsed >= maximum : parsed > maximum)) errors.push(`${field.id} 高於 maximum`);
    }
  } else if (["select", "radio"].includes(type)) {
    if (!field.options.some((option) => !option.disabled && JSON.stringify(option.value) === JSON.stringify(value))) errors.push(`${field.id} 不是允許的 option`);
  } else if (type === "checkbox") {
    if (!Array.isArray(value)) errors.push(`${field.id} 必須是 sequence`);
    else {
      if (c.min_items !== undefined && value.length < c.min_items) errors.push(`${field.id} 少於 min_items`);
      if (c.max_items !== undefined && value.length > c.max_items) errors.push(`${field.id} 超過 max_items`);
      for (const item of value) if (!field.options.some((option) => !option.disabled && JSON.stringify(option.value) === JSON.stringify(item))) errors.push(`${field.id} 含非允許 option`);
    }
  } else if (type === "boolean" && typeof value !== "boolean") errors.push(`${field.id} 必須是 Boolean`);
  return errors;
}

function validateValues(form, values) {
  const errors = [];
  for (const field of form.fields) {
    if (field.disabled) continue;
    const active = !field.visible_when || conditionMatches(field.visible_when, values);
    if (!active) continue;
    const required = field.required || (field.required_when && conditionMatches(field.required_when, values));
    errors.push(...validateFieldValue(field, values[field.id], required));
  }
  for (const rule of form.rules) {
    if (rule.type === "compare") {
      const left = values[rule.left];
      const right = values[rule.right];
      if (isEmpty(left) || isEmpty(right)) continue;
      const comparison = compareScalar(left, right);
      const pass = rule.operator === "equals" ? comparison === 0 : rule.operator === "not_equals" ? comparison !== 0 : rule.operator === "greater_than" ? comparison > 0 : rule.operator === "greater_than_or_equal" ? comparison >= 0 : rule.operator === "less_than" ? comparison < 0 : comparison <= 0;
      if (!pass) errors.push(rule.message || `違反規則 ${rule.id}`);
    } else if (rule.type === "at_least_one" && !rule.fields.some((fieldId) => !isEmpty(values[fieldId]))) errors.push(rule.message || `違反規則 ${rule.id}`);
    else if (rule.type === "all_or_none") {
      const count = rule.fields.filter((fieldId) => !isEmpty(values[fieldId])).length;
      if (count !== 0 && count !== rule.fields.length) errors.push(rule.message || `違反規則 ${rule.id}`);
    }
  }
  return errors;
}

function clone(value) {
  return structuredClone(value);
}

function shiftTemporal(type, value, amount) {
  if (type === "time") {
    const seconds = parseTemporal("time", value);
    if (seconds === null) return value;
    const shifted = Math.max(0, Math.min(86399, seconds + amount * 60));
    const hour = String(Math.floor(shifted / 3600)).padStart(2, "0");
    const minute = String(Math.floor((shifted % 3600) / 60)).padStart(2, "0");
    return `${hour}:${minute}`;
  }
  const timestamp = parseTemporal(type, value);
  if (timestamp === null) return value;
  const shifted = new Date(timestamp + amount * (type === "date" ? 86400000 : 60000));
  return type === "date" ? shifted.toISOString().slice(0, 10) : shifted.toISOString().slice(0, 16);
}

function fitText(value, field) {
  const minimum = field.constraints.min_length || 0;
  const maximum = field.constraints.max_length ?? 200;
  let result = String(value);
  if (result.length < minimum) result += "A".repeat(minimum - result.length);
  if (result.length > maximum) result = result.slice(0, maximum);
  return result;
}

function validText(field) {
  const candidates = field.type === "email" ? ["qa@example.test"]
    : field.type === "tel" ? ["0912345678", "+886912345678"]
      : field.type === "url" ? ["https://example.test/form"]
        : ["QA-001", "TEST001", "abc123", "測試資料", field.id];
  for (const candidate of candidates) {
    const fitted = fitText(candidate, field);
    if (validateFieldValue(field, fitted, false).length === 0) return fitted;
  }
  return fitText(candidates[0], field);
}

function numericBaseline(field) {
  const c = field.constraints;
  const step = c.multiple_of || (field.type === "integer" ? 1 : 0.5);
  let value = c.minimum !== undefined ? c.minimum + (c.exclusive_minimum ? step : 0) : 10;
  if (c.multiple_of) value = Math.ceil(value / c.multiple_of - 1e-10) * c.multiple_of;
  if (field.type === "integer") value = Math.ceil(value);
  if (c.maximum !== undefined && (value > c.maximum || (c.exclusive_maximum && value >= c.maximum))) value = c.maximum - (c.exclusive_maximum ? step : 0);
  return value;
}

function temporalBaseline(field) {
  const c = field.constraints;
  const fallback = field.type === "date" ? "2026-01-15" : field.type === "time" ? "09:30" : "2026-01-15T09:30";
  if (c.minimum !== undefined) return c.exclusive_minimum ? shiftTemporal(field.type, c.minimum, 1) : c.minimum;
  if (c.maximum !== undefined) return c.exclusive_maximum ? shiftTemporal(field.type, c.maximum, -1) : c.maximum;
  return fallback;
}

function baselineValue(field) {
  if (field.hasDefault && validateFieldValue(field, field.default, false).length === 0) return clone(field.default);
  if (["text", "textarea", "email", "tel", "url"].includes(field.type)) return validText(field);
  if (["integer", "number"].includes(field.type)) return numericBaseline(field);
  if (["date", "time", "datetime"].includes(field.type)) return temporalBaseline(field);
  if (["select", "radio"].includes(field.type)) return field.options.find((option) => !option.disabled)?.value ?? null;
  if (field.type === "checkbox") {
    const available = field.options.filter((option) => !option.disabled).map((option) => option.value);
    const count = Math.max(field.required ? 1 : 0, field.constraints.min_items || 0);
    return available.slice(0, count || Math.min(1, available.length));
  }
  if (field.type === "boolean") return false;
  return null;
}

function alternateValue(current) {
  if (typeof current === "boolean") return !current;
  if (typeof current === "number") return current + 1;
  if (Array.isArray(current)) return [];
  return `${String(current ?? "value")}_other`;
}

function applyCondition(values, condition, shouldMatch) {
  if (!condition || typeof condition.field !== "string") return;
  const op = condition.operator;
  if (op === "equals") values[condition.field] = shouldMatch ? clone(condition.value) : alternateValue(condition.value);
  else if (op === "not_equals") values[condition.field] = shouldMatch ? alternateValue(condition.value) : clone(condition.value);
  else if (op === "in") values[condition.field] = shouldMatch ? clone(condition.value?.[0]) : "__outside__";
  else if (op === "not_in") values[condition.field] = shouldMatch ? "__outside__" : clone(condition.value?.[0]);
  else if (op === "is_empty") values[condition.field] = shouldMatch ? null : "QA";
  else if (op === "not_empty") values[condition.field] = shouldMatch ? "QA" : null;
  else if (typeof condition.value === "number") {
    const greater = ["greater_than", "greater_than_or_equal"].includes(op);
    values[condition.field] = shouldMatch === greater ? condition.value + 1 : condition.value - 1;
  } else values[condition.field] = shouldMatch ? `${String(condition.value)}z` : `${String(condition.value)}a`;
}

function pairValues(field) {
  if (["integer", "number"].includes(field?.type)) return [1, 2];
  if (field?.type === "date") return ["2026-01-01", "2026-01-02"];
  if (field?.type === "time") return ["09:00", "10:00"];
  if (field?.type === "datetime") return ["2026-01-01T09:00", "2026-01-01T10:00"];
  return ["A", "B"];
}

function stabilizeBaseline(form, values) {
  for (const field of form.fields) {
    if (field.visible_when) applyCondition(values, field.visible_when, true);
    if (field.required_when) applyCondition(values, field.required_when, true);
  }
  for (const rule of form.rules) {
    if (rule.type === "at_least_one" && !rule.fields.some((fieldId) => !isEmpty(values[fieldId]))) {
      const field = form.fields.find((item) => item.id === rule.fields[0]);
      if (field) values[field.id] = baselineValue(field);
    } else if (rule.type === "all_or_none") {
      for (const fieldId of rule.fields) {
        const field = form.fields.find((item) => item.id === fieldId);
        if (field) values[fieldId] = baselineValue(field);
      }
    } else if (rule.type === "compare") {
      const field = form.fields.find((item) => item.id === rule.left);
      const [low, high] = pairValues(field);
      if (rule.operator === "equals") values[rule.left] = values[rule.right] = low;
      else if (rule.operator === "not_equals") { values[rule.left] = low; values[rule.right] = high; }
      else if (["less_than", "less_than_or_equal"].includes(rule.operator)) { values[rule.left] = low; values[rule.right] = high; }
      else { values[rule.left] = high; values[rule.right] = low; }
    }
  }
  return values;
}

function addCandidate(candidates, testType, target, description, values, expected, priority = 5) {
  candidates.push({ testType, target, description, values: clone(values), expected, priority });
}

function generateFormCases(form, requestedMax) {
  const baseline = stabilizeBaseline(form, Object.fromEntries(form.fields.map((field) => [field.id, baselineValue(field)])));
  const candidates = [];
  addCandidate(candidates, "合法基準", form.id, "所有欄位使用符合契約的合成基準值", baseline, "valid", 1);
  for (const field of form.fields) {
    if (field.read_only || field.disabled) addCandidate(candidates, "唯讀或停用", field.id, `${field.label} 的互動狀態需由 UI/runtime 驗證`, baseline, "manual", 6);
    const requiredCase = field.required || field.required_when;
    if (requiredCase) {
      const values = clone(baseline);
      if (field.required_when) applyCondition(values, field.required_when, true);
      values[field.id] = null;
      addCandidate(candidates, field.required_when ? "條件式必填" : "必填", field.id, `${field.label} 在必填條件成立時留空`, values, "invalid", 2);
    }
    if (field.visible_when) {
      const shown = clone(baseline);
      applyCondition(shown, field.visible_when, true);
      addCandidate(candidates, "條件式顯示", field.id, `${field.label} 的 visible_when 成立，顯示行為需人工確認`, shown, "manual", 5);
      const hidden = clone(baseline);
      applyCondition(hidden, field.visible_when, false);
      addCandidate(candidates, "條件式顯示", field.id, `${field.label} 的 visible_when 不成立，隱藏行為需人工確認`, hidden, "manual", 5);
    }
    if (["text", "textarea", "email", "tel", "url"].includes(field.type)) {
      const wrongType = clone(baseline); wrongType[field.id] = 12345;
      addCandidate(candidates, "型別", field.id, `${field.label} 使用非字串值`, wrongType, "invalid", 2);
      const c = field.constraints;
      if (c.min_length !== undefined) {
        const valid = clone(baseline); valid[field.id] = "A".repeat(c.min_length);
        addCandidate(candidates, "長度邊界", field.id, `${field.label} 等於 min_length`, valid, "valid", 4);
        if (c.min_length > 0) { const invalid = clone(baseline); invalid[field.id] = "A".repeat(c.min_length - 1); addCandidate(candidates, "長度", field.id, `${field.label} 少於 min_length`, invalid, "invalid", 2); }
      }
      if (c.max_length !== undefined) {
        const valid = clone(baseline); valid[field.id] = "A".repeat(c.max_length);
        addCandidate(candidates, "長度邊界", field.id, `${field.label} 等於 max_length`, valid, "valid", 4);
        const invalid = clone(baseline); invalid[field.id] = "A".repeat(c.max_length + 1);
        addCandidate(candidates, "長度", field.id, `${field.label} 超過 max_length`, invalid, "invalid", 2);
      }
      if (c.pattern) { const invalid = clone(baseline); invalid[field.id] = "@@INVALID@@"; addCandidate(candidates, "格式", field.id, `${field.label} 不符合 pattern`, invalid, "invalid", 2); }
      if (["email", "tel", "url"].includes(field.type)) { const invalid = clone(baseline); invalid[field.id] = "not-a-valid-value"; addCandidate(candidates, "格式", field.id, `${field.label} 使用無效 ${field.type} 格式`, invalid, "invalid", 2); }
      const unicode = clone(baseline); unicode[field.id] = fitText("測試資料Ａ", field); addCandidate(candidates, "Unicode", field.id, `${field.label} 使用 Unicode 合成值`, unicode, validateFieldValue(field, unicode[field.id], false).length ? "invalid" : "valid", 7);
      const whitespace = clone(baseline);
      if (field.required_when) applyCondition(whitespace, field.required_when, true);
      whitespace[field.id] = "   ";
      addCandidate(candidates, "前後空白", field.id, `${field.label} 僅含空白`, whitespace, requiredCase ? "invalid" : "valid", 7);
    } else if (["integer", "number"].includes(field.type)) {
      const wrongType = clone(baseline); wrongType[field.id] = "123"; addCandidate(candidates, "型別", field.id, `${field.label} 使用字串數字`, wrongType, "invalid", 2);
      const c = field.constraints; const delta = field.type === "integer" ? 1 : (c.multiple_of || 0.1);
      if (c.minimum !== undefined) {
        const boundary = clone(baseline); boundary[field.id] = c.minimum; addCandidate(candidates, "邊界值", field.id, `${field.label} 等於 minimum`, boundary, c.exclusive_minimum ? "invalid" : "valid", 3);
        const below = clone(baseline); below[field.id] = c.minimum - delta; addCandidate(candidates, "邊界值", field.id, `${field.label} 低於 minimum`, below, "invalid", 2);
      }
      if (c.maximum !== undefined) {
        const boundary = clone(baseline); boundary[field.id] = c.maximum; addCandidate(candidates, "邊界值", field.id, `${field.label} 等於 maximum`, boundary, c.exclusive_maximum ? "invalid" : "valid", 3);
        const above = clone(baseline); above[field.id] = c.maximum + delta; addCandidate(candidates, "邊界值", field.id, `${field.label} 高於 maximum`, above, "invalid", 2);
      }
      if (c.multiple_of !== undefined) { const invalid = clone(baseline); invalid[field.id] = baseline[field.id] + c.multiple_of / 2; addCandidate(candidates, "步進值", field.id, `${field.label} 不符合 multiple_of`, invalid, "invalid", 3); }
    } else if (["date", "time", "datetime"].includes(field.type)) {
      const wrongType = clone(baseline); wrongType[field.id] = "not-a-date"; addCandidate(candidates, "格式", field.id, `${field.label} 使用無效 ${field.type}`, wrongType, "invalid", 2);
      const c = field.constraints;
      if (c.minimum !== undefined) { const boundary = clone(baseline); boundary[field.id] = c.minimum; addCandidate(candidates, "邊界值", field.id, `${field.label} 等於 minimum`, boundary, c.exclusive_minimum ? "invalid" : "valid", 3); const below = clone(baseline); below[field.id] = shiftTemporal(field.type, c.minimum, -1); addCandidate(candidates, "邊界值", field.id, `${field.label} 低於 minimum`, below, "invalid", 2); }
      if (c.maximum !== undefined) { const boundary = clone(baseline); boundary[field.id] = c.maximum; addCandidate(candidates, "邊界值", field.id, `${field.label} 等於 maximum`, boundary, c.exclusive_maximum ? "invalid" : "valid", 3); const above = clone(baseline); above[field.id] = shiftTemporal(field.type, c.maximum, 1); addCandidate(candidates, "邊界值", field.id, `${field.label} 高於 maximum`, above, "invalid", 2); }
    } else if (["select", "radio"].includes(field.type)) {
      for (const option of field.options.filter((item) => !item.disabled).slice(0, 10)) { const values = clone(baseline); values[field.id] = option.value; addCandidate(candidates, "合法選項", field.id, `${field.label} 選擇 ${option.label}`, values, "valid", 5); }
      const invalid = clone(baseline); invalid[field.id] = "__not_an_option__"; addCandidate(candidates, "無效選項", field.id, `${field.label} 使用非成員值`, invalid, "invalid", 2);
    } else if (field.type === "checkbox") {
      const invalidType = clone(baseline); invalidType[field.id] = "not-a-list"; addCandidate(candidates, "型別", field.id, `${field.label} 使用非 sequence 值`, invalidType, "invalid", 2);
      const invalidOption = clone(baseline); invalidOption[field.id] = ["__not_an_option__"]; addCandidate(candidates, "無效選項", field.id, `${field.label} 包含非成員值`, invalidOption, "invalid", 2);
      const available = field.options.filter((item) => !item.disabled).map((item) => item.value);
      if (field.constraints.min_items !== undefined && field.constraints.min_items > 0) { const values = clone(baseline); values[field.id] = available.slice(0, field.constraints.min_items - 1); addCandidate(candidates, "數量邊界", field.id, `${field.label} 少於 min_items`, values, "invalid", 3); }
      if (field.constraints.max_items !== undefined && available.length > field.constraints.max_items) { const values = clone(baseline); values[field.id] = available.slice(0, field.constraints.max_items + 1); addCandidate(candidates, "數量邊界", field.id, `${field.label} 超過 max_items`, values, "invalid", 3); }
    } else if (field.type === "boolean") {
      for (const value of [true, false]) { const values = clone(baseline); values[field.id] = value; addCandidate(candidates, "Boolean", field.id, `${field.label} = ${value}`, values, "valid", 5); }
      const invalid = clone(baseline); invalid[field.id] = "true"; addCandidate(candidates, "型別", field.id, `${field.label} 使用字串 true`, invalid, "invalid", 2);
    }
  }
  for (const rule of form.rules) {
    const values = clone(baseline);
    if (rule.type === "at_least_one") for (const fieldId of rule.fields) values[fieldId] = null;
    else if (rule.type === "all_or_none") { values[rule.fields[0]] = null; for (const fieldId of rule.fields.slice(1)) if (isEmpty(values[fieldId])) { const field = form.fields.find((item) => item.id === fieldId); if (field) values[fieldId] = baselineValue(field); } }
    else if (rule.type === "compare") {
      const field = form.fields.find((item) => item.id === rule.left); const [low, high] = pairValues(field);
      if (rule.operator === "equals") { values[rule.left] = low; values[rule.right] = high; }
      else if (rule.operator === "not_equals") values[rule.left] = values[rule.right] = low;
      else if (["less_than", "less_than_or_equal"].includes(rule.operator)) { values[rule.left] = high; values[rule.right] = low; }
      else { values[rule.left] = low; values[rule.right] = high; }
    }
    addCandidate(candidates, "跨欄位規則", rule.id, `違反規則 ${rule.id}：${rule.message || rule.type}`, values, "invalid", 3);
  }
  const deduplicated = [];
  const seen = new Set();
  for (const candidate of candidates.sort((left, right) => left.priority - right.priority)) {
    const key = JSON.stringify([candidate.testType, candidate.target, candidate.values, candidate.expected]);
    if (!seen.has(key)) { seen.add(key); deduplicated.push(candidate); }
  }
  const simple = form.fields.length <= 10 && !form.fields.some((field) => field.visible_when || field.required_when) && form.rules.length === 0;
  const cap = requestedMax || (simple ? 50 : 100);
  const kept = deduplicated.slice(0, cap);
  const cut = deduplicated.slice(cap).map((item) => ({ form: form.id, target: item.target, description: item.description, reason: `超過案例上限 ${cap}` }));
  const cases = kept.map((item, index) => {
    const errors = item.expected === "manual" ? [] : validateValues(form, item.values);
    const actual = item.expected === "manual" ? "manual" : errors.length ? "invalid" : "valid";
    const status = item.expected === "manual" ? "需人工確認" : item.expected === actual ? "PASS" : "FAIL";
    return { id: `${form.id}-TC-${String(index + 1).padStart(3, "0")}`, ...item, actual, status, errors, testedAt: new Date().toISOString() };
  });
  return { ...form, cases, cut, simple, candidateCount: deduplicated.length, cap };
}

function sanitizeSegment(value) {
  const sanitized = String(value).normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_").replace(/\.+$/g, "").slice(0, 100);
  return sanitized || "unnamed";
}

function sanitizeSheetName(value, used) {
  const base = sanitizeSegment(value).replace(/[\[\]:*?/\\']/g, "_").slice(0, 31) || "form";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) { const tail = `_${suffix}`; candidate = `${base.slice(0, 31 - tail.length)}${tail}`; suffix += 1; }
  used.add(candidate);
  return candidate;
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && value.startsWith("=")) return `'${value}`;
  return value;
}

const COLORS = {
  navy: "#17324D", teal: "#0F766E", white: "#FFFFFF", text: "#1F2937",
  line: "#CBD5E1", paleBlue: "#E8F1FA", pass: "#DCFCE7", fail: "#FEE2E2",
  manual: "#FEF3C7", error: "#FEE2E2", warning: "#FEF3C7", info: "#DBEAFE",
};

function styleTitle(sheet, width, text) {
  const range = sheet.getRange(`A1:${columnName(Math.max(0, width - 1))}1`);
  range.merge(); range.values = [[text]];
  range.format = { fill: COLORS.navy, font: { bold: true, color: COLORS.white, size: 16 }, verticalAlignment: "center", horizontalAlignment: "left" };
  range.format.rowHeight = 32;
}

function styleHeader(range) {
  range.format = { fill: COLORS.teal, font: { bold: true, color: COLORS.white }, verticalAlignment: "center", horizontalAlignment: "center", wrapText: true, borders: { preset: "outside", style: "thin", color: COLORS.line } };
  range.format.rowHeight = 30;
}

function styleBody(range) {
  range.format = { font: { color: COLORS.text }, verticalAlignment: "top", wrapText: true, borders: { insideHorizontal: { style: "thin", color: "#E5EAF0" }, bottom: { style: "thin", color: COLORS.line } } };
}

function formulaCountIf(forms, columnByForm, criterion) {
  const parts = forms.filter((form) => form.cases.length).map((form) => `COUNTIF('${form.sheetName}'!$${columnByForm(form)}$4:$${columnByForm(form)}$${form.cases.length + 3},"${criterion}")`);
  return parts.length ? `=SUM(${parts.join(",")})` : "=0";
}

function addConditionalColors(range, kind) {
  if (kind === "status") {
    range.conditionalFormats.add("containsText", { text: "PASS", format: { fill: COLORS.pass, font: { color: "#166534", bold: true } } });
    range.conditionalFormats.add("containsText", { text: "FAIL", format: { fill: COLORS.fail, font: { color: "#991B1B", bold: true } } });
    range.conditionalFormats.add("containsText", { text: "需人工確認", format: { fill: COLORS.manual, font: { color: "#92400E", bold: true } } });
  } else {
    range.conditionalFormats.add("containsText", { text: "ERROR", format: { fill: COLORS.error, font: { color: "#991B1B", bold: true } } });
    range.conditionalFormats.add("containsText", { text: "WARNING", format: { fill: COLORS.warning, font: { color: "#92400E", bold: true } } });
    range.conditionalFormats.add("containsText", { text: "INFO", format: { fill: COLORS.info, font: { color: "#1E40AF", bold: true } } });
  }
}

async function buildWorkbook(report, mode, outputPath, previewDir, artifactTool) {
  const { Workbook, SpreadsheetFile } = artifactTool;
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("測試摘要");
  const findingsSheet = workbook.worksheets.add("規格發現");
  for (const form of report.forms) workbook.worksheets.add(form.sheetName);
  summary.showGridLines = false;
  styleTitle(summary, 8, "YAML 表單 QA 測試報告");
  const metadata = [
    ["項目", "內容"], ["prj_id", report.projectId], ["標題", report.title], ["來源", report.source],
    ["YAML SHA-256", report.sha256], ["產生時間", new Date(report.generatedAt)], ["表單數", report.totals.forms],
    ["欄位數", report.totals.fields], ["測試案例數", report.totals.cases], ["裁減案例數", report.totals.cut],
    ["驗證層級", "YAML 契約靜態 QA（非瀏覽器／後端執行）"],
  ];
  summary.getRange(`A3:B${metadata.length + 2}`).values = metadata;
  styleHeader(summary.getRange("A3:B3")); styleBody(summary.getRange(`A4:B${metadata.length + 2}`));
  summary.getRange("B8").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  summary.getRange("D3:E3").values = [["Finding", "數量"]]; styleHeader(summary.getRange("D3:E3"));
  summary.getRange("D4:D6").values = [["ERROR"], ["WARNING"], ["INFO"]];
  const findingEnd = Math.max(4, report.findings.length + 3);
  summary.getRange("E4:E6").formulas = ["ERROR", "WARNING", "INFO"].map((severity) => [`=COUNTIF('規格發現'!$A$4:$A$${findingEnd},"${severity}")`]);
  styleBody(summary.getRange("D4:E6")); addConditionalColors(summary.getRange("D4:D6"), "finding");
  const categories = [...new Set(report.forms.flatMap((form) => form.cases.map((testCase) => testCase.testType)))];
  summary.getRange("G3:H3").values = [["測試類型", "案例數"]]; styleHeader(summary.getRange("G3:H3"));
  if (categories.length) {
    summary.getRangeByIndexes(3, 6, categories.length, 1).values = categories.map((category) => [category]);
    summary.getRangeByIndexes(3, 7, categories.length, 1).formulas = categories.map((category) => [formulaCountIf(report.forms, () => "B", category)]);
    styleBody(summary.getRangeByIndexes(3, 6, categories.length, 2));
  }
  if (mode === "results") {
    const start = Math.max(9, categories.length + 5);
    summary.getRange(`D${start}:E${start}`).values = [["執行狀態", "案例數"]]; styleHeader(summary.getRange(`D${start}:E${start}`));
    const statuses = ["PASS", "FAIL", "需人工確認"];
    summary.getRange(`D${start + 1}:D${start + 3}`).values = statuses.map((status) => [status]);
    summary.getRange(`E${start + 1}:E${start + 3}`).formulas = statuses.map((status) => [formulaCountIf(report.forms, (form) => columnName(3 + form.fields.length + 2), status)]);
    styleBody(summary.getRange(`D${start + 1}:E${start + 3}`)); addConditionalColors(summary.getRange(`D${start + 1}:D${start + 3}`), "status");
  }
  summary.freezePanes.freezeRows(1);
  for (const [column, width] of [["A", 20], ["B", 54], ["C", 4], ["D", 20], ["E", 14], ["F", 4], ["G", 22], ["H", 14]]) summary.getRange(`${column}:${column}`).format.columnWidth = width;
  summary.getUsedRange().format.autofitRows();

  findingsSheet.showGridLines = false; styleTitle(findingsSheet, 5, "YAML 規格發現");
  const findingHeaders = ["嚴重度", "代碼", "YAML 路徑", "問題", "建議"];
  findingsSheet.getRange("A3:E3").values = [findingHeaders]; styleHeader(findingsSheet.getRange("A3:E3"));
  const findingRows = report.findings.length ? report.findings.map((finding) => [finding.severity, finding.code, finding.path, finding.message, finding.suggestion]) : [["INFO", "NO_FINDINGS", "$", "未發現規格問題。", ""]];
  findingsSheet.getRangeByIndexes(3, 0, findingRows.length, 5).values = findingRows; styleBody(findingsSheet.getRangeByIndexes(3, 0, findingRows.length, 5)); addConditionalColors(findingsSheet.getRangeByIndexes(3, 0, findingRows.length, 1), "finding");
  findingsSheet.freezePanes.freezeRows(3);
  for (const [column, width] of [["A", 14], ["B", 24], ["C", 38], ["D", 56], ["E", 48]]) findingsSheet.getRange(`${column}:${column}`).format.columnWidth = width;
  findingsSheet.getUsedRange().format.autofitRows();

  for (const form of report.forms) {
    const sheet = workbook.worksheets.getItem(form.sheetName); sheet.showGridLines = false;
    const headers = ["案例編號", "測試類型", "測試說明", ...form.fields.map((field) => `${field.label} [${field.id}]`), "預期結果"];
    if (mode === "results") headers.push("契約驗證結果", "狀態", "錯誤或備註", "測試時間");
    styleTitle(sheet, headers.length, `${form.title}－YAML 契約 QA`);
    sheet.getRangeByIndexes(2, 0, 1, headers.length).values = [headers]; styleHeader(sheet.getRangeByIndexes(2, 0, 1, headers.length));
    const rows = form.cases.map((testCase) => {
      const row = [testCase.id, testCase.testType, testCase.description, ...form.fields.map((field) => cellValue(testCase.values[field.id])), testCase.expected];
      if (mode === "results") row.push(testCase.actual, testCase.status, testCase.errors.join("；"), new Date(testCase.testedAt));
      return row;
    });
    if (rows.length) {
      sheet.getRangeByIndexes(3, 0, rows.length, headers.length).values = rows;
      styleBody(sheet.getRangeByIndexes(3, 0, rows.length, headers.length));
      sheet.getRangeByIndexes(3, 3 + form.fields.length, rows.length, 1).format.fill = COLORS.paleBlue;
      if (mode === "results") {
        const statusIndex = 3 + form.fields.length + 2;
        addConditionalColors(sheet.getRangeByIndexes(3, statusIndex, rows.length, 1), "status");
        sheet.getRangeByIndexes(3, statusIndex + 2, rows.length, 1).format.numberFormat = "yyyy-mm-dd hh:mm:ss";
      }
    }
    sheet.freezePanes.freezeRows(3); sheet.freezePanes.freezeColumns(3);
    sheet.getRange("A:A").format.columnWidth = 18; sheet.getRange("B:B").format.columnWidth = 18; sheet.getRange("C:C").format.columnWidth = 42;
    for (let index = 3; index < 3 + form.fields.length; index += 1) sheet.getRange(`${columnName(index)}:${columnName(index)}`).format.columnWidth = 20;
    for (let index = 3 + form.fields.length; index < headers.length; index += 1) sheet.getRange(`${columnName(index)}:${columnName(index)}`).format.columnWidth = index === headers.length - 2 ? 48 : 22;
    sheet.getUsedRange().format.autofitRows();
  }

  await fs.mkdir(previewDir, { recursive: true });
  const verification = { mode, sheets: [], formulaErrors: "" };
  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange();
    const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
    const previewPath = path.join(previewDir, `${mode}-${sanitizeSegment(sheet.name)}.png`);
    await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
    const inspect = await workbook.inspect({ kind: "table", sheetId: sheet.name, range: `A1:${columnName(Math.min(11, used.columnCount - 1))}${Math.min(20, used.rowCount)}`, include: "values,formulas", tableMaxRows: 20, tableMaxCols: 12, maxChars: 5000 });
    verification.sheets.push({ name: sheet.name, rows: used.rowCount, columns: used.columnCount, preview: previewPath, inspect: inspect.ndjson });
  }
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan", maxChars: 5000 });
  verification.formulaErrors = errors.ndjson;
  await fs.writeFile(path.join(previewDir, `${mode}-verification.json`), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  const exported = await SpreadsheetFile.exportXlsx(workbook); await exported.save(outputPath);
}

async function uniqueRunDirectory(outputRoot, projectId) {
  const base = path.join(path.resolve(outputRoot), sanitizeSegment(projectId));
  await fs.mkdir(base, { recursive: true });
  const stamp = localTimestamp();
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = path.join(base, attempt === 1 ? stamp : `${stamp}-${attempt}`);
    try { await fs.mkdir(candidate); return candidate; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  throw new Error("無法建立唯一的執行目錄。");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args["output-root"]) throw new Error("Usage: yaml-qa.mjs --source form.yaml --output-root output/yaml-qa [--prj-id id] [--max-cases N]");
  const sourcePath = path.resolve(args.source);
  if (![".yaml", ".yml"].includes(path.extname(sourcePath).toLowerCase())) throw new Error("Source 必須是 .yaml 或 .yml 檔案。");
  const sourceBuffer = await fs.readFile(sourcePath);
  if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) throw new Error("YAML 檔案超過 2 MiB 安全上限。");
  const sourceText = sourceBuffer.toString("utf8");
  const raw = parseSafeYaml(sourceText);
  const { spec, findings } = validateAndNormalize(raw, args["prj-id"]);
  const parsedMax = args["max-cases"] === undefined ? null : Number(args["max-cases"]);
  if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1 || parsedMax > 500)) throw new Error("max-cases 必須是 1 到 500 的整數。");
  const usedSheets = new Set(["測試摘要", "規格發現"]);
  const forms = spec.forms.map((form) => ({ ...generateFormCases(form, parsedMax), sheetName: sanitizeSheetName(form.title || form.id, usedSheets) }));
  const sha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
  const runDirectory = await uniqueRunDirectory(args["output-root"], spec.prj_id);
  const report = {
    specification: "YAML Form Specification 1.0", projectId: spec.prj_id, title: spec.title,
    source: sourcePath, sha256, generatedAt: new Date().toISOString(), findings, forms,
    cutCases: forms.flatMap((form) => form.cut),
    totals: {
      forms: forms.length, fields: forms.reduce((sum, form) => sum + form.fields.length, 0),
      cases: forms.reduce((sum, form) => sum + form.cases.length, 0), cut: forms.reduce((sum, form) => sum + form.cut.length, 0),
      errors: findings.filter((finding) => finding.severity === "ERROR").length,
      warnings: findings.filter((finding) => finding.severity === "WARNING").length,
      info: findings.filter((finding) => finding.severity === "INFO").length,
      pass: forms.flatMap((form) => form.cases).filter((testCase) => testCase.status === "PASS").length,
      fail: forms.flatMap((form) => form.cases).filter((testCase) => testCase.status === "FAIL").length,
      manual: forms.flatMap((form) => form.cases).filter((testCase) => testCase.status === "需人工確認").length,
    },
  };
  await fs.writeFile(path.join(runDirectory, "source.yaml"), sourceBuffer);
  await fs.writeFile(path.join(runDirectory, "source.sha256"), `${sha256}  source.yaml\n`, "utf8");
  await fs.writeFile(path.join(runDirectory, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const requireFromWorkingDirectory = createRequire(path.join(process.cwd(), "package.json"));
  const artifactTool = requireFromWorkingDirectory("@oai/artifact-tool");
  const previewDir = path.join(runDirectory, "workbook-preview");
  const testData = path.join(runDirectory, "test-data.xlsx");
  const testResults = path.join(runDirectory, "test-results.xlsx");
  await buildWorkbook(report, "test-data", testData, previewDir, artifactTool);
  await buildWorkbook(report, "results", testResults, previewDir, artifactTool);
  console.log(JSON.stringify({ runDirectory, testData, testResults, totals: report.totals }));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
