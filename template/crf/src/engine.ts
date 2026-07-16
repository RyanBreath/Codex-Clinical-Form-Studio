import type { CompiledContract } from "./contract";
import {
  cloneRecord,
  deleteAtPointer,
  getAtPointer,
  hasAtPointer,
  parsePointer,
  setAtPointer,
} from "./pointer";
import type {
  CrfContract,
  DerivedFormState,
  FieldState,
  JsonPrimitive,
  JsonRecord,
  NumericExpression,
  Predicate,
  ValidationIssue,
} from "./types";

function primitiveEquals(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
    );
  }
  return Object.is(left, right);
}

export function evaluatePredicate(predicate: Predicate, data: unknown): boolean {
  if ("all" in predicate) return predicate.all.every((item) => evaluatePredicate(item, data));
  if ("any" in predicate) return predicate.any.some((item) => evaluatePredicate(item, data));
  if ("not" in predicate) return !evaluatePredicate(predicate.not, data);

  const exists = hasAtPointer(data, predicate.path);
  const current = getAtPointer(data, predicate.path);
  if (predicate.op === "exists") return exists && current !== null && current !== undefined;
  if (!exists || current === null || current === undefined) return false;

  switch (predicate.op) {
    case "eq":
      return primitiveEquals(current, predicate.value);
    case "neq":
      return !primitiveEquals(current, predicate.value);
    case "lt":
      return typeof current === "number" && typeof predicate.value === "number"
        ? current < predicate.value
        : false;
    case "lte":
      return typeof current === "number" && typeof predicate.value === "number"
        ? current <= predicate.value
        : false;
    case "gt":
      return typeof current === "number" && typeof predicate.value === "number"
        ? current > predicate.value
        : false;
    case "gte":
      return typeof current === "number" && typeof predicate.value === "number"
        ? current >= predicate.value
        : false;
    case "in":
      return Array.isArray(predicate.value)
        ? predicate.value.some((value) => primitiveEquals(value, current))
        : false;
    case "contains":
      if (Array.isArray(current)) {
        return current.some((value) => primitiveEquals(value, predicate.value));
      }
      return typeof current === "string" && typeof predicate.value === "string"
        ? current.includes(predicate.value)
        : false;
  }
}

function isStaticallyRequired(contract: CrfContract, path: string): boolean {
  const tokens = parsePointer(path);
  let properties = contract.properties;
  let required = contract.required ?? [];

  for (const token of tokens) {
    if (!required.includes(token)) return false;
    const property = properties[token];
    if (!property) return false;
    properties = property.properties ?? {};
    required = property.required ?? [];
  }
  return true;
}

function expressionPaths(expression: NumericExpression): string[] {
  if (expression.op === "path") return [expression.path];
  if (expression.op === "value") return [];
  return expression.args.flatMap(expressionPaths);
}

function evaluateExpression(expression: NumericExpression, data: JsonRecord): number | undefined {
  if (expression.op === "value") return Number.isFinite(expression.value) ? expression.value : undefined;
  if (expression.op === "path") {
    const value = getAtPointer(data, expression.path);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  const values = expression.args.map((argument) => evaluateExpression(argument, data));
  if (values.some((value) => value === undefined)) return undefined;
  const [first, ...rest] = values as number[];
  const result =
    expression.op === "add"
      ? rest.reduce((total, value) => total + value, first)
      : expression.op === "subtract"
        ? rest.reduce((total, value) => total - value, first)
        : expression.op === "multiply"
          ? rest.reduce((total, value) => total * value, first)
          : rest.some((value) => value === 0)
            ? undefined
            : rest.reduce((total, value) => total / value, first);
  return typeof result === "number" && Number.isFinite(result) ? result : undefined;
}

function calculateFields(contract: CrfContract, target: JsonRecord): string[] {
  const calculations = contract["x-airwayai"].computed;
  const derivedPaths: string[] = [];
  const resolving = new Set<string>();
  const resolved = new Set<string>();

  const resolve = (path: string): void => {
    if (resolved.has(path) || resolving.has(path)) return;
    resolving.add(path);
    const calculation = calculations[path];
    if (!calculation) return;

    expressionPaths(calculation).forEach((sourcePath) => {
      if (calculations[sourcePath]) resolve(sourcePath);
    });

    const value = evaluateExpression(calculation, target);
    if (value !== undefined) {
      setAtPointer(target, path, value);
      derivedPaths.push(path);
    } else {
      deleteAtPointer(target, path);
    }
    resolving.delete(path);
    resolved.add(path);
  };

  Object.keys(calculations).forEach(resolve);
  return derivedPaths;
}

function buildFieldStates(contract: CrfContract, data: JsonRecord): Record<string, FieldState> {
  const states: Record<string, FieldState> = {};
  for (const [path, config] of Object.entries(contract["x-airwayai"].fields)) {
    const visible = config.visibleWhen ? evaluatePredicate(config.visibleWhen, data) : true;
    const enabled = visible && (config.enabledWhen ? evaluatePredicate(config.enabledWhen, data) : true);
    const required =
      visible &&
      enabled &&
      (isStaticallyRequired(contract, path) ||
        (config.requiredWhen ? evaluatePredicate(config.requiredWhen, data) : false));
    states[path] = { visible, enabled, required };
  }
  return states;
}

export function deriveFormState(contract: CrfContract, retainedData: unknown): DerivedFormState {
  const displayData = cloneRecord(retainedData);
  calculateFields(contract, displayData);
  const fieldStates = buildFieldStates(contract, displayData);
  const activeData: JsonRecord = {};

  for (const [path, config] of Object.entries(contract["x-airwayai"].fields)) {
    const state = fieldStates[path];
    const isActive = state.visible && (state.enabled || config.widget === "computed");
    if (!isActive || !hasAtPointer(displayData, path)) continue;
    setAtPointer(activeData, path, structuredClone(getAtPointer(displayData, path)));
  }

  const derivedPaths = calculateFields(contract, activeData);
  for (const path of Object.keys(contract["x-airwayai"].computed)) {
    if (hasAtPointer(activeData, path)) {
      setAtPointer(displayData, path, getAtPointer(activeData, path));
    } else {
      deleteAtPointer(displayData, path);
    }
  }

  return { displayData, activeData, fieldStates, derivedPaths };
}

function isEmptyRequiredValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function owningFieldPath(contract: CrfContract, issuePath: string): string {
  const fieldPaths = Object.keys(contract["x-airwayai"].fields);
  if (fieldPaths.includes(issuePath)) return issuePath;

  const parent = fieldPaths
    .filter((fieldPath) => issuePath.startsWith(`${fieldPath}/`))
    .sort((left, right) => right.length - left.length)[0];
  if (parent) return parent;

  return (
    fieldPaths
      .filter((fieldPath) => fieldPath.startsWith(`${issuePath}/`))
      .sort((left, right) => left.length - right.length)[0] ?? issuePath
  );
}

export function validateDerivedState(
  compiled: CompiledContract,
  state: DerivedFormState,
): ValidationIssue[] {
  const contract = compiled.contract;
  const issues = compiled.validateData(state.activeData).map((issue) => ({
    ...issue,
    path: owningFieldPath(contract, issue.path),
  }));

  for (const [path, fieldState] of Object.entries(state.fieldStates)) {
    if (
      fieldState.required &&
      isEmptyRequiredValue(getAtPointer(state.activeData, path)) &&
      !issues.some((issue) => issue.path === path && issue.code === "required")
    ) {
      issues.push({ path, code: "requiredWhen", message: `${path} 為必填欄位。` });
    }
  }

  const unique = new Map<string, ValidationIssue>();
  issues.forEach((issue) => unique.set(`${issue.path}:${issue.code}`, issue));
  return [...unique.values()];
}

export function isStructuralDataIssue(issue: ValidationIssue): boolean {
  return issue.code === "additionalProperties" || (issue.code === "type" && issue.path === "/");
}

export function localizeText(
  text: Record<string, string> | undefined,
  locale: string,
  defaultLocale: string,
): string | undefined {
  return text?.[locale] ?? text?.[defaultLocale];
}

export function findOptionLabel(
  options: Array<{ value: JsonPrimitive; label: Record<string, string> }> | undefined,
  value: unknown,
  locale: string,
  defaultLocale: string,
): string {
  const option = options?.find((item) => primitiveEquals(item.value, value));
  return localizeText(option?.label, locale, defaultLocale) ?? String(value ?? "—");
}
