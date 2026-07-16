import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import metaSchema from "../../data-dictionaries/crf-contract.meta-schema.json";
import { joinPointer, parsePointer, resolveSchemaProperty } from "./pointer";
import type {
  CrfContract,
  Diagnostic,
  FieldConfig,
  FieldWidget,
  JsonPrimitive,
  JsonSchemaProperty,
  LocalizedText,
  NumericExpression,
  Predicate,
  ValidationIssue,
} from "./types";

export interface CompiledContract {
  contract: CrfContract;
  diagnostics: Diagnostic[];
  validateData: (data: unknown) => ValidationIssue[];
}

export type ContractCompileResult =
  | { ok: true; value: CompiledContract }
  | { ok: false; diagnostics: Diagnostic[] };

const metaAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(metaAjv);
const validateContractEnvelope = metaAjv.compile(metaSchema);

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  path?: string,
): Diagnostic {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function formatAjvPath(error: ErrorObject): string {
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty: string }).missingProperty;
    return joinPointer(error.instancePath, missing);
  }
  if (error.keyword === "additionalProperties") {
    const extra = (error.params as { additionalProperty: string }).additionalProperty;
    return joinPointer(error.instancePath, extra);
  }
  return error.instancePath || "/";
}

function ajvErrorMessage(error: ErrorObject): string {
  const path = formatAjvPath(error);
  switch (error.keyword) {
    case "required":
      return `${path} 為必填欄位。`;
    case "additionalProperties":
      return `${path} 未在資料合約中宣告。`;
    case "type":
      return `${path} 的資料型別應為 ${(error.params as { type: string }).type}。`;
    case "format":
      return `${path} 不符合 ${(error.params as { format: string }).format} 格式。`;
    case "minimum":
      return `${path} 不可小於 ${(error.params as { limit: number }).limit}。`;
    case "maximum":
      return `${path} 不可大於 ${(error.params as { limit: number }).limit}。`;
    case "minLength":
      return `${path} 長度不足。`;
    case "maxLength":
      return `${path} 長度超過限制。`;
    case "pattern":
      return `${path} 格式不正確。`;
    case "enum":
      return `${path} 不是允許的選項。`;
    case "const":
      return `${path} 必須符合指定值。`;
    default:
      return `${path} ${error.message ?? "不符合資料合約。"}`;
  }
}

function mapValidationErrors(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: formatAjvPath(error),
    code: error.keyword,
    message: ajvErrorMessage(error),
  }));
}

function isPrimitiveEqual(left: JsonPrimitive, right: JsonPrimitive): boolean {
  return Object.is(left, right);
}

function optionValuesMatch(config: FieldConfig, property: JsonSchemaProperty): boolean {
  if (!config.options) return false;
  const schemaOptions =
    config.widget === "checkbox_group" ? property.items?.enum : property.enum;
  if (!schemaOptions || schemaOptions.length !== config.options.length) return false;

  return schemaOptions.every((schemaValue) =>
    config.options!.some((option) => isPrimitiveEqual(option.value, schemaValue)),
  );
}

const compatibleTypes: Record<FieldWidget, Array<JsonSchemaProperty["type"]>> = {
  text: ["string"],
  textarea: ["string"],
  integer: ["integer"],
  number: ["number", "integer"],
  date: ["string"],
  radio: ["string", "number", "integer", "boolean"],
  select: ["string", "number", "integer", "boolean"],
  checkbox_group: ["array"],
  boolean: ["boolean"],
  computed: ["number", "integer"],
  coordinate_3d: ["object"],
};

function collectPredicatePaths(predicate: Predicate): string[] {
  if ("all" in predicate) return predicate.all.flatMap(collectPredicatePaths);
  if ("any" in predicate) return predicate.any.flatMap(collectPredicatePaths);
  if ("not" in predicate) return collectPredicatePaths(predicate.not);
  return [predicate.path];
}

function collectExpressionPaths(expression: NumericExpression): string[] {
  if (expression.op === "path") return [expression.path];
  if (expression.op === "value") return [];
  return expression.args.flatMap(collectExpressionPaths);
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

function checkLocalizedText(
  diagnostics: Diagnostic[],
  value: LocalizedText | undefined,
  defaultLocale: string,
  path: string,
): void {
  if (value && !value[defaultLocale]) {
    diagnostics.push(
      diagnostic(
        "error",
        "missing-default-locale",
        `顯示文字缺少預設語系 ${defaultLocale}。`,
        path,
      ),
    );
  }
}

function validateSemanticContract(contract: CrfContract): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const extension = contract["x-airwayai"];
  const computedTargets = new Set(Object.keys(extension.computed));

  if (!extension.locales.includes(extension.defaultLocale)) {
    diagnostics.push(
      diagnostic(
        "error",
        "default-locale-not-declared",
        "defaultLocale 必須出現在 locales 中。",
        "/x-airwayai/defaultLocale",
      ),
    );
  }

  if (!contract.$id.endsWith(`/${extension.formId}/${extension.schemaVersion}`)) {
    diagnostics.push(
      diagnostic(
        "error",
        "schema-id-version-mismatch",
        "$id 必須以 formId/schemaVersion 結尾，才能形成不可變快照。",
        "/$id",
      ),
    );
  }

  checkLocalizedText(diagnostics, extension.title, extension.defaultLocale, "/x-airwayai/title");
  checkLocalizedText(
    diagnostics,
    extension.description,
    extension.defaultLocale,
    "/x-airwayai/description",
  );
  checkLocalizedText(
    diagnostics,
    extension.disclaimer,
    extension.defaultLocale,
    "/x-airwayai/disclaimer",
  );

  if (extension.status === "demo" && !extension.disclaimer) {
    diagnostics.push(
      diagnostic(
        "error",
        "demo-disclaimer-required",
        "Demo schema 必須提供 disclaimer。",
        "/x-airwayai/disclaimer",
      ),
    );
  }

  for (const [path, config] of Object.entries(extension.fields)) {
    const property = resolveSchemaProperty(contract.properties, path);
    if (!property) {
      diagnostics.push(
        diagnostic("error", "dangling-field-path", `欄位路徑 ${path} 不存在。`, path),
      );
      continue;
    }

    if (!compatibleTypes[config.widget].includes(property.type)) {
      diagnostics.push(
        diagnostic(
          "error",
          "widget-type-mismatch",
          `${config.widget} 與 JSON Schema 型別 ${property.type ?? "未指定"} 不相容。`,
          path,
        ),
      );
    }

    if (extension.contractVersion === "1.1.0" && !config.coding) {
      diagnostics.push(
        diagnostic(
          "error",
          "coding-status-required",
          "contractVersion 1.1.0 的每個欄位都必須記錄 CDISC coding status。",
          path,
        ),
      );
    }

    if (config.coding?.status === "not-applicable") {
      if (!config.coding.rationale) {
        diagnostics.push(
          diagnostic(
            "error",
            "coding-rationale-required",
            "CDISC coding 標示為 not-applicable 時必須提供理由。",
            path,
          ),
        );
      }
    }

    if (config.coding?.status === "matched") {
      const coding = config.coding;
      if (
        coding.standard !== "CDISC" ||
        !coding.model ||
        !coding.version ||
        !coding.source ||
        (!coding.variable && !coding.codelist)
      ) {
        diagnostics.push(
          diagnostic(
            "error",
            "coding-mapping-incomplete",
            "matched CDISC coding 必須包含 standard、model、version、source，以及 variable 或 codelist。",
            path,
          ),
        );
      }

      if (coding.codelist) {
        if (!config.options?.length) {
          diagnostics.push(
            diagnostic(
              "error",
              "coded-options-required",
              "有 CDISC codelist 的欄位必須提供受控選項。",
              path,
            ),
          );
        } else {
          config.options.forEach((option, index) => {
            if (!option.coding) {
              diagnostics.push(
                diagnostic(
                  "error",
                  "option-coding-required",
                  "CDISC codelist 的每個選項都必須提供 terminology coding。",
                  `${path}/options/${index}`,
                ),
              );
              return;
            }
            if (option.coding.submissionValue !== String(option.value)) {
              diagnostics.push(
                diagnostic(
                  "error",
                  "option-submission-value-mismatch",
                  "選項 value 必須與 CDISC submissionValue 完全一致。",
                  `${path}/options/${index}`,
                ),
              );
            }
          });
        }
      } else if (config.options?.some((option) => option.coding)) {
        diagnostics.push(
          diagnostic(
            "error",
            "option-coding-without-codelist",
            "選項 terminology coding 必須搭配欄位層級的 CDISC codelist。",
            path,
          ),
        );
      }
    }

    if (
      ["radio", "select", "checkbox_group"].includes(config.widget) &&
      !optionValuesMatch(config, property)
    ) {
      diagnostics.push(
        diagnostic(
          "error",
          "option-schema-mismatch",
          "UI 選項必須與 JSON Schema enum 完全一致。",
          path,
        ),
      );
    }

    if (config.widget === "date" && property.format !== "date") {
      diagnostics.push(
        diagnostic("error", "date-format-required", "date widget 必須使用 format: date。", path),
      );
    }

    if (config.widget === "computed" && !property.readOnly) {
      diagnostics.push(
        diagnostic("error", "computed-readonly-required", "計算欄位必須設 readOnly: true。", path),
      );
    }

    if (config.widget === "coordinate_3d") {
      const coordinateProperties = property.properties ?? {};
      const coordinateShapeValid =
        ["x", "y", "z"].every((axis) =>
          ["number", "integer"].includes(coordinateProperties[axis]?.type ?? ""),
        ) && coordinateProperties.unit?.type === "string";
      if (!coordinateShapeValid) {
        diagnostics.push(
          diagnostic(
            "error",
            "coordinate-shape-invalid",
            "coordinate_3d 必須是含 x、y、z 數值與 unit 字串的 object。",
            path,
          ),
        );
      } else if (!config.coordinate) {
        diagnostics.push(
          diagnostic(
            "warning",
            "coordinate-metadata-fallback",
            "3D metadata 不完整，將降級為型別相容的基本數值輸入。",
            path,
          ),
        );
      } else if (!resolveSchemaProperty(contract.properties, config.coordinate.unitPath)) {
        diagnostics.push(
          diagnostic(
            "warning",
            "coordinate-metadata-fallback",
            "3D unitPath 不存在，將降級為型別相容的基本數值輸入。",
            path,
          ),
        );
      }
    }

    checkLocalizedText(diagnostics, config.label, extension.defaultLocale, `${path}/label`);
    checkLocalizedText(diagnostics, config.description, extension.defaultLocale, `${path}/description`);
    checkLocalizedText(diagnostics, config.help, extension.defaultLocale, `${path}/help`);
    checkLocalizedText(diagnostics, config.placeholder, extension.defaultLocale, `${path}/placeholder`);
    checkLocalizedText(diagnostics, config.unit?.display, extension.defaultLocale, `${path}/unit/display`);
    checkLocalizedText(
      diagnostics,
      config.coding?.rationale,
      extension.defaultLocale,
      `${path}/coding/rationale`,
    );
    config.options?.forEach((option, index) =>
      checkLocalizedText(
        diagnostics,
        option.label,
        extension.defaultLocale,
        `${path}/options/${index}/label`,
      ),
    );
    config.options?.forEach((option, index) =>
      checkLocalizedText(
        diagnostics,
        option.coding?.display,
        extension.defaultLocale,
        `${path}/options/${index}/coding/display`,
      ),
    );
    config.links?.forEach((link, index) =>
      checkLocalizedText(
        diagnostics,
        link.label,
        extension.defaultLocale,
        `${path}/links/${index}/label`,
      ),
    );

    const predicates = [config.visibleWhen, config.enabledWhen, config.requiredWhen].filter(
      (value): value is Predicate => Boolean(value),
    );
    for (const predicate of predicates) {
      for (const dependencyPath of collectPredicatePaths(predicate)) {
        if (!resolveSchemaProperty(contract.properties, dependencyPath)) {
          diagnostics.push(
            diagnostic(
              "error",
              "dangling-predicate-path",
              `條件參照的路徑 ${dependencyPath} 不存在。`,
              path,
            ),
          );
        }
        if (computedTargets.has(dependencyPath)) {
          diagnostics.push(
            diagnostic(
              "error",
              "predicate-computed-dependency",
              "條件不可參照 computed 欄位。",
              path,
            ),
          );
        }
      }
    }

    if ((config.visibleWhen || config.enabledWhen) && isStaticallyRequired(contract, path)) {
      diagnostics.push(
        diagnostic(
          "error",
          "conditional-static-required",
          "條件顯示或停用的欄位不可同時出現在 JSON Schema required；請使用 requiredWhen。",
          path,
        ),
      );
    }
  }

  const layoutPaths = new Set<string>();
  const layoutIds = new Set<string>();
  for (const section of extension.layout) {
    if (layoutIds.has(section.id)) {
      diagnostics.push(
        diagnostic("error", "duplicate-layout-id", `重複的版面 ID：${section.id}。`, section.id),
      );
    }
    layoutIds.add(section.id);
    checkLocalizedText(
      diagnostics,
      section.title,
      extension.defaultLocale,
      `/x-airwayai/layout/${section.id}/title`,
    );
    checkLocalizedText(
      diagnostics,
      section.description,
      extension.defaultLocale,
      `/x-airwayai/layout/${section.id}/description`,
    );

    for (const item of section.items) {
      if (item.type === "group") {
        if (layoutIds.has(item.id)) {
          diagnostics.push(
            diagnostic("error", "duplicate-layout-id", `重複的版面 ID：${item.id}。`, item.id),
          );
        }
        layoutIds.add(item.id);
        checkLocalizedText(
          diagnostics,
          item.title,
          extension.defaultLocale,
          `/x-airwayai/layout/${item.id}/title`,
        );
        for (const field of item.items) {
          if (layoutPaths.has(field.path)) {
            diagnostics.push(
              diagnostic("error", "duplicate-layout-field", "欄位在版面中出現超過一次。", field.path),
            );
          }
          layoutPaths.add(field.path);
        }
      } else {
        if (layoutPaths.has(item.path)) {
          diagnostics.push(
            diagnostic("error", "duplicate-layout-field", "欄位在版面中出現超過一次。", item.path),
          );
        }
        layoutPaths.add(item.path);
      }
    }
  }

  for (const path of layoutPaths) {
    if (!extension.fields[path]) {
      diagnostics.push(
        diagnostic("error", "layout-field-not-configured", "版面欄位缺少 fields 設定。", path),
      );
    }
  }
  for (const path of Object.keys(extension.fields)) {
    if (!layoutPaths.has(path)) {
      diagnostics.push(
        diagnostic("error", "configured-field-not-laid-out", "已設定欄位未出現在版面中。", path),
      );
    }
  }

  for (const [targetPath, calculation] of Object.entries(extension.computed)) {
    const targetProperty = resolveSchemaProperty(contract.properties, targetPath);
    const targetConfig = extension.fields[targetPath];
    if (!targetProperty || targetConfig?.widget !== "computed") {
      diagnostics.push(
        diagnostic(
          "error",
          "computed-target-invalid",
          "computed 目標必須存在且使用 computed widget。",
          targetPath,
        ),
      );
    }
    for (const sourcePath of collectExpressionPaths(calculation)) {
      const source = resolveSchemaProperty(contract.properties, sourcePath);
      if (!source || !["number", "integer"].includes(source.type ?? "")) {
        diagnostics.push(
          diagnostic(
            "error",
            "computed-source-invalid",
            `計算來源 ${sourcePath} 必須是數值欄位。`,
            targetPath,
          ),
        );
      }
    }
  }
  for (const [path, config] of Object.entries(extension.fields)) {
    if (config.widget === "computed" && !extension.computed[path]) {
      diagnostics.push(
        diagnostic("error", "computed-definition-missing", "計算欄位缺少 computed 定義。", path),
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitComputed = (path: string): void => {
    if (visiting.has(path)) {
      diagnostics.push(
        diagnostic("error", "computed-cycle", "computed 欄位存在循環相依。", path),
      );
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    const calculation = extension.computed[path];
    calculation && collectExpressionPaths(calculation)
      .filter((source) => computedTargets.has(source))
      .forEach(visitComputed);
    visiting.delete(path);
    visited.add(path);
  };
  computedTargets.forEach(visitComputed);

  if (Object.keys(extension.fields).length > 50) {
    diagnostics.push(
      diagnostic(
        "warning",
        "form-size-target-exceeded",
        "欄位數超過首版約 50 欄的容量驗收目標。",
      ),
    );
  }

  return diagnostics;
}

function createDataValidator(contract: CrfContract): ValidateFunction {
  const dataSchema = structuredClone(contract) as Record<string, unknown>;
  delete dataSchema["x-airwayai"];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(dataSchema);
}

export function compileContract(input: unknown): ContractCompileResult {
  const diagnostics: Diagnostic[] = [];

  if (!metaAjv.validateSchema(input as Record<string, unknown>)) {
    diagnostics.push(
      ...(metaAjv.errors ?? []).map((error) =>
        diagnostic(
          "error",
          `json-schema-${error.keyword}`,
          `不是有效的 JSON Schema：${error.instancePath || "/"} ${error.message ?? ""}`.trim(),
          error.instancePath || "/",
        ),
      ),
    );
  }

  if (!validateContractEnvelope(input)) {
    diagnostics.push(
      ...(validateContractEnvelope.errors ?? []).map((error) =>
        diagnostic(
          "error",
          `contract-${error.keyword}`,
          `合約格式錯誤：${formatAjvPath(error)} ${error.message ?? ""}`.trim(),
          formatAjvPath(error),
        ),
      ),
    );
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const contract = input as CrfContract;
  diagnostics.push(...validateSemanticContract(contract));
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics };
  }

  let validator: ValidateFunction;
  try {
    validator = createDataValidator(contract);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "error",
          "data-schema-compile-failed",
          error instanceof Error ? error.message : "資料 schema 無法編譯。",
        ),
      ],
    };
  }

  return {
    ok: true,
    value: {
      contract,
      diagnostics,
      validateData(data: unknown): ValidationIssue[] {
        validator(data);
        return mapValidationErrors(validator.errors);
      },
    },
  };
}
