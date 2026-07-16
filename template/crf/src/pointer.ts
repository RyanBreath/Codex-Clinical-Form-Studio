import type { JsonRecord, JsonSchemaProperty } from "./types";

function decodeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function encodeToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }
  return pointer.slice(1).split("/").map(decodeToken);
}

export function joinPointer(base: string, token: string): string {
  return `${base}/${encodeToken(token)}`;
}

export function hasAtPointer(value: unknown, pointer: string): boolean {
  let current = value;
  for (const token of parsePointer(pointer)) {
    if (typeof current !== "object" || current === null || !(token in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return true;
}

export function getAtPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const token of parsePointer(pointer)) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function setAtPointer(target: JsonRecord, pointer: string, value: unknown): void {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new Error("The root JSON Pointer cannot be assigned by this helper.");
  }

  let current: JsonRecord = target;
  tokens.forEach((token, index) => {
    const isLast = index === tokens.length - 1;
    if (isLast) {
      current[token] = value;
      return;
    }
    const next = current[token];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[token] = {};
    }
    current = current[token] as JsonRecord;
  });
}

export function deleteAtPointer(target: JsonRecord, pointer: string): void {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return;

  const parents: Array<{ object: JsonRecord; token: string }> = [];
  let current: JsonRecord = target;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = current[token];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return;
    parents.push({ object: current, token });
    current = next as JsonRecord;
  }

  delete current[tokens.at(-1)!];

  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const { object, token } = parents[index];
    const child = object[token];
    if (
      typeof child === "object" &&
      child !== null &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      delete object[token];
    } else {
      break;
    }
  }
}

export function pointerToFieldName(pointer: string): string {
  return parsePointer(pointer).join(".");
}

export function pointerToDomId(pointer: string): string {
  return `field-${parsePointer(pointer)
    .map((token) => token.replaceAll(/[^a-zA-Z0-9_-]/g, "-"))
    .join("-")}`;
}

export function resolveSchemaProperty(
  properties: Record<string, JsonSchemaProperty>,
  pointer: string,
): JsonSchemaProperty | undefined {
  const tokens = parsePointer(pointer);
  let current: JsonSchemaProperty | undefined;
  let currentProperties = properties;

  for (const token of tokens) {
    current = currentProperties[token];
    if (!current) return undefined;
    currentProperties = current.properties ?? {};
  }
  return current;
}

export function cloneRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return structuredClone(value) as JsonRecord;
}
