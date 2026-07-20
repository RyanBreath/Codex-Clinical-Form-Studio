import fs from "node:fs/promises";
import path from "node:path";

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const equalIndex = token.indexOf("=");
    if (equalIndex > 2) {
      result[token.slice(2, equalIndex)] = token.slice(equalIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && quote === null) return line.slice(0, index);
  }
  return line;
}

function splitInlineList(value) {
  const result = [];
  let quote = null;
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (!value) return {};
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInlineList(value.slice(1, -1)).map(parseScalar);
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^(null|~)$/i.test(value)) return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, container: root }];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const uncommented = stripComment(lines[lineNumber]).replace(/\s+$/, "");
    if (!uncommented.trim()) continue;
    const indent = uncommented.match(/^\s*/)[0].length;
    const content = uncommented.trim();

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).container;

    if (content.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error(`Unsupported YAML list at line ${lineNumber + 1}. Use an indented list under a key.`);
      }
      parent.push(parseScalar(content.slice(2)));
      continue;
    }

    const separator = content.indexOf(":");
    if (separator < 1) throw new Error(`Invalid YAML at line ${lineNumber + 1}.`);
    const key = content.slice(0, separator).trim();
    const rawValue = content.slice(separator + 1).trim();

    if (!rawValue) {
      const nextLine = lines.slice(lineNumber + 1).find((line) => stripComment(line).trim());
      const nextContent = nextLine ? stripComment(nextLine).trim() : "";
      const child = nextContent.startsWith("- ") ? [] : {};
      parent[key] = child;
      stack.push({ indent, container: child });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }
  return root;
}

export async function readConfig(filePath) {
  if (!filePath) return {};
  const text = await fs.readFile(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".json") return JSON.parse(text);
  return parseSimpleYaml(text);
}

export function sanitizePathSegment(value, fallback = "unnamed") {
  const sanitized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 100);
  return sanitized || fallback;
}

export function sanitizeSheetName(value, fallback = "form") {
  return sanitizePathSegment(value, fallback)
    .replace(/[\[\]:*?/\\]/g, "_")
    .slice(0, 31);
}

export function stableFieldKey(field, index = 0) {
  return field.name || field.id || field.selector || `field_${String(index + 1).padStart(2, "0")}`;
}

export function displayFieldName(field, index = 0) {
  const key = stableFieldKey(field, index);
  const label = String(field.label || field.placeholder || key).trim();
  return label === key ? key : `${label} [${key}]`;
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|1|yes|y)$/i.test(value)) return true;
    if (/^(false|0|no|n)$/i.test(value)) return false;
  }
  return fallback;
}
