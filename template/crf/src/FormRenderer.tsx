import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { compileContract, type CompiledContract } from "./contract";
import {
  deriveFormState,
  findOptionLabel,
  isStructuralDataIssue,
  localizeText,
  validateDerivedState,
} from "./engine";
import {
  cloneRecord,
  getAtPointer,
  hasAtPointer,
  pointerToDomId,
  pointerToFieldName,
  resolveSchemaProperty,
} from "./pointer";
import type {
  CrfContract,
  DerivedFormState,
  Diagnostic,
  FieldConfig,
  FieldLayout,
  FormRendererProps,
  FormSubmission,
  GroupLayout,
  JsonPrimitive,
  JsonRecord,
  ValidationIssue,
} from "./types";
import { FormSubmissionError } from "./types";
import { downloadSubmissionArtifacts } from "./downloads";
import { RENDERER_VERSION } from "./renderer-version";
import styles from "./FormRenderer.module.css";

const EMPTY_DERIVED_STATE: DerivedFormState = {
  displayData: {},
  activeData: {},
  fieldStates: {},
  derivedPaths: [],
};

function optionEquals(left: unknown, right: unknown): boolean {
  return Object.is(left, right);
}

function issueMessage(
  contract: CrfContract,
  issue: ValidationIssue,
  locale: string,
): string {
  const extension = contract["x-airwayai"];
  const label =
    localizeText(extension.fields[issue.path]?.label, locale, extension.defaultLocale) ?? issue.path;

  switch (issue.code) {
    case "required":
    case "requiredWhen":
      return `請填寫「${label}」。`;
    case "minimum":
      return `「${label}」低於允許範圍。`;
    case "maximum":
      return `「${label}」超過允許範圍。`;
    case "minLength":
      return `「${label}」內容太短。`;
    case "maxLength":
      return `「${label}」內容太長。`;
    case "pattern":
      return `「${label}」格式不正確。`;
    case "format":
      return `「${label}」日期格式不正確。`;
    case "enum":
      return `「${label}」不是允許的選項。`;
    case "const":
      return `請確認「${label}」。`;
    case "type":
      return `「${label}」的資料型別不正確。`;
    default:
      return `「${label}」不符合資料合約。`;
  }
}

function ContractBlocker({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <section className={styles.blocker} role="alert" aria-labelledby="contract-error-title">
      <span className={styles.blockerEyebrow}>Schema blocked</span>
      <h1 id="contract-error-title">表單合約無法載入</h1>
      <p>為避免蒐集不可信資料，renderer 已停止顯示與送出。</p>
      <ul>
        {diagnostics.map((item, index) => (
          <li key={`${item.code}-${item.path ?? index}`}>
            <code>{item.code}</code> — {item.message}
            {item.path ? <span className={styles.diagnosticPath}> {item.path}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatReadonlyValue(
  value: unknown,
  config: FieldConfig,
  locale: string,
  defaultLocale: string,
): string {
  if (value === undefined || value === null || value === "") return "未填寫";
  if (config.widget === "boolean") return value === true ? "是" : value === false ? "否" : String(value);
  if (config.widget === "checkbox_group" && Array.isArray(value)) {
    return value
      .map((item) => findOptionLabel(config.options, item, locale, defaultLocale))
      .join("、");
  }
  if (["radio", "select"].includes(config.widget)) {
    return findOptionLabel(config.options, value, locale, defaultLocale);
  }
  if (config.widget === "coordinate_3d" && typeof value === "object" && value !== null) {
    const coordinate = value as Record<string, unknown>;
    const axis = ["x", "y", "z"].map((key) => `${key.toUpperCase()} ${coordinate[key] ?? "—"}`);
    return `${axis.join(" · ")} ${coordinate.unit ?? ""}`.trim();
  }
  if (typeof value === "number" && config.widget === "number") return value.toFixed(2);
  return String(value);
}

function normalizeNumericInput(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function FormRenderer(props: FormRendererProps) {
  const { schema, initialData, onDiagnostic } = props;
  const mode = props.mode ?? "edit";
  const compiledResult = useMemo(() => compileContract(schema), [schema]);
  const compiled = compiledResult.ok ? compiledResult.value : undefined;
  const initialKey = useMemo(() => JSON.stringify(cloneRecord(initialData)), [initialData]);

  const {
    control,
    getValues,
    register,
    reset,
  } = useForm<JsonRecord>({
    defaultValues: cloneRecord(initialData),
    shouldUnregister: false,
    mode: "onBlur",
  });
  const watchedData = useWatch({ control }) as JsonRecord | undefined;
  const retainedData = watchedData ?? getValues();

  useEffect(() => {
    reset(JSON.parse(initialKey) as JsonRecord);
  }, [initialKey, reset]);

  useEffect(() => {
    const diagnostics = compiledResult.ok
      ? compiledResult.value.diagnostics
      : compiledResult.diagnostics;
    diagnostics.forEach((item) => onDiagnostic?.(item));
  }, [compiledResult, onDiagnostic]);

  const locale = compiled
    ? compiled.contract["x-airwayai"].locales.includes(props.locale ?? "")
      ? props.locale!
      : compiled.contract["x-airwayai"].defaultLocale
    : props.locale ?? "zh-TW";

  const derivedState = useMemo(
    () => (compiled ? deriveFormState(compiled.contract, retainedData) : EMPTY_DERIVED_STATE),
    [compiled, retainedData],
  );
  const currentIssues = useMemo(
    () => (compiled ? validateDerivedState(compiled, derivedState) : []),
    [compiled, derivedState],
  );
  const initialIssues = useMemo(
    () => (compiled && initialData !== undefined ? compiled.validateData(initialData) : []),
    [compiled, initialData],
  );
  const structuralIssues = initialIssues.filter(isStructuralDataIssue);

  const [touchedPaths, setTouchedPaths] = useState<Set<string>>(() => new Set());
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [apiUrl, setApiUrl] = useState("");
  const previousSnapshotKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (mode === "readonly" || !props.onChange) return;
    const snapshot = {
      data: derivedState.activeData,
      derivedPaths: derivedState.derivedPaths,
      isValid: currentIssues.length === 0,
    };
    const key = JSON.stringify(snapshot);
    if (key === previousSnapshotKey.current) return;
    previousSnapshotKey.current = key;
    props.onChange(snapshot);
  }, [currentIssues.length, derivedState, mode, props]);

  const markTouched = useCallback((path: string) => {
    setTouchedPaths((current) => {
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }, []);

  const focusField = useCallback((path: string) => {
    const container = document.getElementById(pointerToDomId(path));
    const focusable = container?.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]",
    );
    focusable?.focus();
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!compiled || mode === "readonly" || isSubmitting) return;

      setHasSubmitted(true);
      setSubmitError(undefined);
      if (currentIssues.length > 0) {
        window.setTimeout(() => focusField(currentIssues[0].path), 0);
        return;
      }

      const submission: FormSubmission = {
        formId: compiled.contract["x-airwayai"].formId,
        schemaVersion: compiled.contract["x-airwayai"].schemaVersion,
        contractVersion: compiled.contract["x-airwayai"].contractVersion,
        rendererVersion: RENDERER_VERSION,
        locale,
        data: derivedState.activeData,
        derivedPaths: derivedState.derivedPaths,
      };

      setIsSubmitting(true);
      try {
        if (!props.onSubmit) return;
        await props.onSubmit(submission);
        downloadSubmissionArtifacts(compiled.contract, submission);
        if (apiUrl.trim()) {
          const response = await fetch(apiUrl.trim(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(derivedState.activeData),
          });
          if (!response.ok) {
            throw new Error(`API 回應失敗：${response.status}`);
          }
        }
      } catch (error) {
        if (error instanceof FormSubmissionError) {
          setSubmitError(error.displayMessage);
        } else {
          setSubmitError("資料暫時無法送出，填答內容已保留。請稍後再試。");
          onDiagnostic?.({
            severity: "error",
            code: "submit-failed",
            message: error instanceof Error ? error.message : "Host onSubmit 發生未知錯誤。",
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    }, [
      compiled,
      currentIssues,
      derivedState,
      focusField,
      isSubmitting,
      locale,
      mode,
      onDiagnostic,
      apiUrl,
      props,
    ],
  );

  if (!compiledResult.ok) {
    return <ContractBlocker diagnostics={compiledResult.diagnostics} />;
  }
  if (!compiled) return null;
  if (structuralIssues.length > 0) {
    return (
      <ContractBlocker
        diagnostics={structuralIssues.map((issue) => ({
          severity: "error",
          code: `initial-data-${issue.code}`,
          message: issue.message,
          path: issue.path,
        }))}
      />
    );
  }

  const contract = compiled.contract;
  const extension = contract["x-airwayai"];
  const loc = (text: Record<string, string> | undefined) =>
    localizeText(text, locale, extension.defaultLocale);
  const issueForPath = (path: string) => {
    const issue = currentIssues.find((item) => item.path === path);
    if (!issue) return undefined;
    return mode === "readonly" || hasSubmitted || touchedPaths.has(path) ? issue : undefined;
  };

  const renderField = (layout: FieldLayout) => {
    const { path } = layout;
    const config = extension.fields[path];
    const state = derivedState.fieldStates[path];
    if (!config || !state?.visible) return null;

    const property = resolveSchemaProperty(contract.properties, path);
    if (!property) return null;
    const label = loc(config.label) ?? path;
    const description = loc(config.description);
    const help = loc(config.help);
    const placeholder = loc(config.placeholder);
    const unit = loc(config.unit?.display);
    const issue = issueForPath(path);
    const message = issue ? issueMessage(contract, issue, locale) : undefined;
    const fieldId = pointerToDomId(path);
    const inputId = `${fieldId}-input`;
    const labelId = `${fieldId}-label`;
    const helpId = `${fieldId}-help`;
    const errorId = `${fieldId}-error`;
    const describedBy = [help ? helpId : undefined, message ? errorId : undefined]
      .filter(Boolean)
      .join(" ");
    const name = pointerToFieldName(path);
    const value = getAtPointer(derivedState.displayData, path);
    const disabled = !state.enabled;
    const spanStyle = {
      "--field-span": layout.span ?? 1,
    } as CSSProperties;

    const commonAria = {
      "aria-labelledby": labelId,
      "aria-describedby": describedBy || undefined,
      "aria-invalid": message ? (true as const) : undefined,
    };

    const renderControl = () => {
      if (mode === "readonly") {
        return (
          <output className={styles.readonlyValue} aria-labelledby={labelId}>
            {formatReadonlyValue(value, config, locale, extension.defaultLocale)}
            {unit && value !== undefined ? <span className={styles.unit}> {unit}</span> : null}
          </output>
        );
      }

      if (["text", "date", "integer", "number"].includes(config.widget)) {
        const numeric = config.widget === "integer" || config.widget === "number";
        return (
          <div className={styles.inputWithUnit}>
            <input
              id={inputId}
              className={styles.input}
              type={
                config.widget === "date"
                  ? "date"
                  : numeric
                    ? "number"
                    : "text"
              }
              step={config.widget === "integer" ? 1 : numeric ? "0.01" : undefined}
              min={property.minimum}
              max={property.maximum}
              maxLength={property.maxLength}
              placeholder={placeholder}
              disabled={disabled}
              {...commonAria}
              {...register(name, {
                setValueAs: numeric ? normalizeNumericInput : undefined,
                onBlur: () => markTouched(path),
              })}
            />
            {unit ? <span className={styles.unitPill}>{unit}</span> : null}
          </div>
        );
      }

      if (config.widget === "textarea") {
        return (
          <textarea
            id={inputId}
            className={styles.textarea}
            rows={4}
            maxLength={property.maxLength}
            placeholder={placeholder}
            disabled={disabled}
            {...commonAria}
            {...register(name, { onBlur: () => markTouched(path) })}
          />
        );
      }

      if (config.widget === "select") {
        return (
          <Controller
            name={name}
            control={control}
            render={({ field }) => {
              const selectedIndex = config.options?.findIndex((option) =>
                optionEquals(option.value, field.value),
              );
              return (
                <select
                  id={inputId}
                  className={styles.select}
                  ref={field.ref}
                  name={field.name}
                  value={selectedIndex === undefined || selectedIndex < 0 ? "" : String(selectedIndex)}
                  disabled={disabled}
                  onBlur={() => {
                    field.onBlur();
                    markTouched(path);
                  }}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    field.onChange(Number.isInteger(index) ? config.options?.[index]?.value : undefined);
                  }}
                  {...commonAria}
                >
                  <option value="">請選擇</option>
                  {config.options?.map((option, index) => (
                    <option key={`${path}-${index}`} value={index}>
                      {loc(option.label)}
                    </option>
                  ))}
                </select>
              );
            }}
          />
        );
      }

      if (config.widget === "radio") {
        return (
          <Controller
            name={name}
            control={control}
            render={({ field }) => (
              <div className={styles.choiceGrid} role="radiogroup" {...commonAria}>
                {config.options?.map((option, index) => (
                  <label className={styles.choice} key={`${path}-${index}`}>
                    <input
                      ref={index === 0 ? field.ref : undefined}
                      type="radio"
                      name={field.name}
                      checked={optionEquals(field.value, option.value)}
                      disabled={disabled}
                      onChange={() => field.onChange(option.value)}
                      onBlur={() => {
                        field.onBlur();
                        markTouched(path);
                      }}
                    />
                    <span>{loc(option.label)}</span>
                  </label>
                ))}
              </div>
            )}
          />
        );
      }

      if (config.widget === "checkbox_group") {
        return (
          <Controller
            name={name}
            control={control}
            render={({ field }) => {
              const selected = Array.isArray(field.value) ? field.value : [];
              return (
                <div className={styles.choiceGrid} role="group" {...commonAria}>
                  {config.options?.map((option, index) => {
                    const checked = selected.some((item) => optionEquals(item, option.value));
                    return (
                      <label className={styles.choice} key={`${path}-${index}`}>
                        <input
                          ref={index === 0 ? field.ref : undefined}
                          type="checkbox"
                          name={`${field.name}-${index}`}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((item) => !optionEquals(item, option.value))
                              : [...selected, option.value];
                            field.onChange(next);
                          }}
                          onBlur={() => {
                            field.onBlur();
                            markTouched(path);
                          }}
                        />
                        <span>{loc(option.label)}</span>
                      </label>
                    );
                  })}
                </div>
              );
            }}
          />
        );
      }

      if (config.widget === "boolean") {
        return (
          <Controller
            name={name}
            control={control}
            render={({ field }) => (
              <label className={styles.switchControl}>
                <input
                  id={inputId}
                  ref={field.ref}
                  type="checkbox"
                  name={field.name}
                  checked={field.value === true}
                  disabled={disabled}
                  onChange={(event) => field.onChange(event.target.checked)}
                  onBlur={() => {
                    field.onBlur();
                    markTouched(path);
                  }}
                  {...commonAria}
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
                <span>{field.value === true ? "是" : "否"}</span>
              </label>
            )}
          />
        );
      }

      if (config.widget === "computed") {
        return (
          <output className={styles.computedValue} aria-live="polite" aria-labelledby={labelId}>
            <strong>{typeof value === "number" ? value.toFixed(2) : "—"}</strong>
            <span>{typeof value === "number" ? unit : "尚未完成"}</span>
          </output>
        );
      }

      if (config.widget === "coordinate_3d") {
        const coordinateReady = Boolean(
          config.coordinate && resolveSchemaProperty(contract.properties, config.coordinate.unitPath),
        );
        const unitPath = config.coordinate?.unitPath ?? `${path}/unit`;
        const unitProperty = resolveSchemaProperty(contract.properties, unitPath);
        const defaultUnit = String(unitProperty?.enum?.[0] ?? "mm");
        return (
          <Controller
            name={name}
            control={control}
            render={({ field }) => {
              const coordinate =
                typeof field.value === "object" && field.value !== null
                  ? (field.value as Record<string, unknown>)
                  : {};
              return (
                <div className={styles.coordinatePanel} {...commonAria}>
                  <div className={styles.coordinateHeader}>
                    <span>{coordinateReady ? "三軸結構化輸入" : "基本輸入模式"}</span>
                    <span className={styles.unitPill}>{defaultUnit}</span>
                  </div>
                  <div className={styles.coordinateGrid}>
                    {(["x", "y", "z"] as const).map((axis, index) => {
                      const axisProperty = property.properties?.[axis];
                      return (
                        <label key={axis} className={styles.axisField}>
                          <span>{axis.toUpperCase()} 軸</span>
                          <input
                            ref={index === 0 ? field.ref : undefined}
                            type="number"
                            step="any"
                            min={axisProperty?.minimum}
                            max={axisProperty?.maximum}
                            value={typeof coordinate[axis] === "number" ? String(coordinate[axis]) : ""}
                            disabled={disabled}
                            aria-label={`${label} ${axis.toUpperCase()} 軸`}
                            onChange={(event) => {
                              const next: Record<string, unknown> = {
                                ...coordinate,
                                unit: defaultUnit,
                              };
                              const axisValue = normalizeNumericInput(event.target.value);
                              if (axisValue === undefined) delete next[axis];
                              else next[axis] = axisValue;
                              field.onChange(next);
                            }}
                            onBlur={() => {
                              field.onBlur();
                              markTouched(path);
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
        );
      }

      return null;
    };

    return (
      <div
        key={path}
        id={fieldId}
        className={`${styles.field} ${disabled ? styles.fieldDisabled : ""}`}
        style={spanStyle}
        data-field-path={path}
      >
        <div className={styles.fieldHeading}>
          <span id={labelId} className={styles.label}>
            {label}
            {state.required ? <span className={styles.required}>（必填）</span> : null}
          </span>
          {config.widget === "computed" ? <span className={styles.derivedBadge}>衍生值</span> : null}
        </div>
        {description ? <p className={styles.description}>{description}</p> : null}
        {renderControl()}
        {help ? (
          <p id={helpId} className={styles.help}>
            {help}
          </p>
        ) : null}
        {config.links?.length ? (
          <div className={styles.links}>
            {config.links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener">
                {loc(link.label)}
              </a>
            ))}
          </div>
        ) : null}
        {disabled ? <p className={styles.disabledNote}>目前條件下不可編輯，也不會送出。</p> : null}
        {message ? (
          <p id={errorId} className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
      </div>
    );
  };

  const renderGroup = (group: GroupLayout) => {
    const groupStyle = { "--grid-columns": group.columns ?? 1 } as CSSProperties;
    return (
      <div className={styles.group} key={group.id}>
        {group.title ? <h3>{loc(group.title)}</h3> : null}
        <div className={styles.fieldGrid} style={groupStyle}>
          {group.items.map(renderField)}
        </div>
      </div>
    );
  };

  const summaryIssues = hasSubmitted ? currentIssues : [];
  const readonlyHasInvalidValues = mode === "readonly" && initialIssues.length > 0;

  return (
    <form className={styles.renderer} noValidate onSubmit={submit} aria-busy={isSubmitting}>
      <header className={styles.header}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.demoBadge}>合成 Demo</span>
            <span className={styles.modeBadge}>{mode === "readonly" ? "唯讀紀錄" : "資料填寫"}</span>
          </div>
          <h1>{loc(extension.title)}</h1>
          {extension.description ? <p>{loc(extension.description)}</p> : null}
        </div>
        <dl className={styles.versionCard}>
          <div>
            <dt>表單</dt>
            <dd>{extension.formId}</dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>v{extension.schemaVersion}</dd>
          </div>
        </dl>
      </header>

      {extension.disclaimer ? (
        <div className={styles.disclaimer} role="note">
          <span aria-hidden="true">ⓘ</span>
          <p>{loc(extension.disclaimer)}</p>
        </div>
      ) : null}

      {readonlyHasInvalidValues ? (
        <div className={styles.dataWarning} role="status">
          <strong>歷史資料不完全符合此版本 schema</strong>
          <span>原值已保留顯示；renderer 不會自動轉型或清除。</span>
        </div>
      ) : null}

      {summaryIssues.length > 0 ? (
        <section className={styles.errorSummary} role="alert" aria-labelledby="error-summary-title">
          <h2 id="error-summary-title">尚有 {summaryIssues.length} 個欄位需要處理</h2>
          <p>選取項目可前往對應欄位。</p>
          <ul>
            {summaryIssues.map((issue) => (
              <li key={`${issue.path}-${issue.code}`}>
                <button type="button" onClick={() => focusField(issue.path)}>
                  {issueMessage(contract, issue, locale)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {submitError ? (
        <div className={styles.submitError} role="alert">
          <strong>送出未完成</strong>
          <span>{submitError}</span>
        </div>
      ) : null}

      <div className={styles.sections}>
        {extension.layout.map((section, sectionIndex) => (
          <section className={styles.section} key={section.id} aria-labelledby={`${section.id}-title`}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionNumber}>{String(sectionIndex + 1).padStart(2, "0")}</span>
              <div>
                <h2 id={`${section.id}-title`}>{loc(section.title)}</h2>
                {section.description ? <p>{loc(section.description)}</p> : null}
              </div>
            </div>
            <div className={styles.sectionBody}>
              {section.items.map((item) =>
                item.type === "group" ? renderGroup(item) : renderField(item),
              )}
            </div>
          </section>
        ))}
      </div>

      {mode === "edit" ? (
        <footer className={styles.footer}>
          <div>
            <strong>送出前會再次驗證所有目前有效欄位</strong>
            <span>隱藏或停用欄位不會包含在 payload。</span>
          </div>
          <div className={styles.footerActions}>
            <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
              {isSubmitting ? <span className={styles.spinner} aria-hidden="true" /> : null}
              {isSubmitting ? "送出中…" : "驗證並送出"}
            </button>
            <label className={styles.apiUrlLabel}>
              API URL:
              <input
                className={styles.apiUrlInput}
                type="url"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="https://example.com/api/forms"
                disabled={isSubmitting}
              />
            </label>
          </div>
        </footer>
      ) : null}
    </form>
  );
}
