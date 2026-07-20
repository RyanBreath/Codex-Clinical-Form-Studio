async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(250);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const collectState = async (discoveredBy = null) =>
    page.evaluate(({ discoveredBy }) => {
      const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const escapeAttribute = (value) =>
        String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const isVisible = (element) => {
        if (!element || element.hidden) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const selectorFor = (element) => {
        if (element.id) {
          const byId = `#${CSS.escape(element.id)}`;
          if (document.querySelectorAll(byId).length === 1) return byId;
        }

        const tag = element.tagName.toLowerCase();
        if (element.getAttribute("name")) {
          let byName = `${tag}[name="${escapeAttribute(element.getAttribute("name"))}"]`;
          if (element.getAttribute("type")) {
            byName += `[type="${escapeAttribute(element.getAttribute("type"))}"]`;
          }
          if (["radio", "checkbox"].includes(element.type) && element.value) {
            byName += `[value="${escapeAttribute(element.value)}"]`;
          }
          if (document.querySelectorAll(byName).length === 1) return byName;
        }

        const segments = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
          if (current.id) {
            segments.unshift(`#${CSS.escape(current.id)}`);
            break;
          }
          const currentTag = current.tagName.toLowerCase();
          const siblings = Array.from(current.parentElement?.children || []).filter(
            (candidate) => candidate.tagName === current.tagName,
          );
          const nth = siblings.indexOf(current) + 1;
          segments.unshift(`${currentTag}:nth-of-type(${nth})`);
          current = current.parentElement;
        }
        return segments.length ? segments.join(" > ") : tag;
      };
      const labelFor = (element) => {
        const labels = Array.from(element.labels || [])
          .map((label) => cleanText(label.textContent))
          .filter(Boolean);
        if (labels.length) return labels.join(" / ");
        const labelledBy = cleanText(element.getAttribute("aria-labelledby"));
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => cleanText(document.getElementById(id)?.textContent))
            .filter(Boolean)
            .join(" / ");
          if (text) return text;
        }
        return (
          cleanText(element.getAttribute("aria-label")) ||
          cleanText(element.getAttribute("placeholder")) ||
          cleanText(element.getAttribute("name")) ||
          cleanText(element.id)
        );
      };
      const helpFor = (element) => {
        const describedBy = cleanText(element.getAttribute("aria-describedby"));
        const described = describedBy
          ? describedBy
              .split(/\s+/)
              .map((id) => cleanText(document.getElementById(id)?.textContent))
              .filter(Boolean)
          : [];
        const nearby = Array.from(
          element.parentElement?.querySelectorAll(
            ":scope > small, :scope > .help, :scope > .hint, :scope > .description, :scope > [data-help]",
          ) || [],
        )
          .map((node) => cleanText(node.textContent || node.getAttribute("data-help")))
          .filter(Boolean);
        return [...new Set([...described, ...nearby])].join(" / ");
      };
      const projectId = () => {
        const meta =
          document.querySelector('meta[name="prj_id" i]') ||
          document.querySelector('meta[name="project_id" i]');
        if (cleanText(meta?.content)) return cleanText(meta.content);

        const input =
          document.querySelector('input[name="prj_id" i]') ||
          document.querySelector('input#prj_id') ||
          document.querySelector('input[name="project_id" i]') ||
          document.querySelector('input#project_id');
        if (cleanText(input?.value)) return cleanText(input.value);

        const dataElement = document.querySelector("[data-prj-id]");
        if (cleanText(dataElement?.getAttribute("data-prj-id"))) {
          return cleanText(dataElement.getAttribute("data-prj-id"));
        }

        const scriptText = Array.from(document.scripts)
          .map((script) => script.textContent || "")
          .join("\n");
        const match = scriptText.match(
          /(?:prj_id|project_id)\s*[:=]\s*["'`]([^"'`\s]{1,100})["'`]/i,
        );
        return cleanText(match?.[1]) || null;
      };
      const fieldFrom = (element, formIndex) => {
        const tag = element.tagName.toLowerCase();
        const type =
          tag === "textarea"
            ? "textarea"
            : tag === "select"
              ? element.multiple
                ? "select-multiple"
                : "select"
              : cleanText(element.getAttribute("type") || "text").toLowerCase();
        const label = labelFor(element);
        const helpText = helpFor(element);
        const placeholder = cleanText(element.getAttribute("placeholder"));
        const dataset = Object.fromEntries(
          Object.entries(element.dataset || {}).map(([key, value]) => [key, cleanText(value)]),
        );
        const explicitRules = [
          element.required ? "required" : "",
          element.getAttribute("min") ? `min=${element.getAttribute("min")}` : "",
          element.getAttribute("max") ? `max=${element.getAttribute("max")}` : "",
          element.getAttribute("step") ? `step=${element.getAttribute("step")}` : "",
          element.getAttribute("minlength")
            ? `minlength=${element.getAttribute("minlength")}`
            : "",
          element.getAttribute("maxlength")
            ? `maxlength=${element.getAttribute("maxlength")}`
            : "",
          element.getAttribute("pattern") ? `pattern=${element.getAttribute("pattern")}` : "",
        ].filter(Boolean);
        const inferredRuleText = [label, helpText, placeholder, ...Object.values(dataset)]
          .filter(Boolean)
          .join(" / ");

        return {
          formIndex,
          tag,
          type,
          widget:
            type === "checkbox"
              ? "checkbox"
              : type === "radio"
                ? "radio"
                : tag === "select"
                  ? element.multiple
                    ? "select-multiple"
                    : "select"
                  : tag === "textarea"
                    ? "textarea"
                    : "input",
          id: cleanText(element.id),
          name: cleanText(element.getAttribute("name")),
          selector: selectorFor(element),
          label,
          helpText,
          placeholder,
          value: type === "checkbox" || type === "radio" ? element.value : element.value,
          checked: Boolean(element.checked),
          required: Boolean(element.required),
          disabled: Boolean(element.disabled),
          readOnly: Boolean(element.readOnly),
          visible: isVisible(element),
          visibleEver: isVisible(element),
          hidden: type === "hidden" || !isVisible(element),
          min: element.getAttribute("min"),
          max: element.getAttribute("max"),
          step: element.getAttribute("step"),
          minLength:
            element.getAttribute("minlength") === null
              ? null
              : Number(element.getAttribute("minlength")),
          maxLength:
            element.getAttribute("maxlength") === null
              ? null
              : Number(element.getAttribute("maxlength")),
          pattern: element.getAttribute("pattern"),
          multiple: Boolean(element.multiple),
          autocomplete: cleanText(element.getAttribute("autocomplete")),
          accept: cleanText(element.getAttribute("accept")),
          ariaInvalid: cleanText(element.getAttribute("aria-invalid")),
          dataset,
          explicitRules,
          inferredRuleText,
          hasInferredRule:
            explicitRules.length === 0 &&
            /(必填|不得|必須|至少|最多|範圍|格式|長度|when|if|required|minimum|maximum)/i.test(
              inferredRuleText,
            ),
          unsupported:
            type === "file" ||
            ["signature", "camera", "captcha", "map"].some((keyword) =>
              inferredRuleText.toLowerCase().includes(keyword),
            ),
          options:
            tag === "select"
              ? Array.from(element.options).map((option, optionIndex) => ({
                  index: optionIndex,
                  value: option.value,
                  text: cleanText(option.textContent),
                  disabled: Boolean(option.disabled),
                  selected: Boolean(option.selected),
                }))
              : [],
          discoveredBy,
        };
      };
      const formFrom = (root, formIndex, virtual = false) => {
        const controls = virtual
          ? Array.from(document.querySelectorAll("input, textarea, select")).filter(
              (element) => !element.form,
            )
          : Array.from(root.querySelectorAll("input, textarea, select"));
        const buttons = Array.from(root.querySelectorAll("button, input[type='submit']"));
        const buttonText = buttons.map((button) =>
          cleanText(button.textContent || button.value || button.getAttribute("aria-label")),
        );
        const stepMarkers = root.querySelectorAll(
          "[data-step], [aria-current='step'], .wizard-step, .form-step",
        ).length;
        const hasStepNavigation = buttonText.some((text) =>
          /^(下一步|上一步|next|previous|back|continue)$/i.test(text),
        );
        const submit =
          root.querySelector("button[type='submit'], input[type='submit']") ||
          buttons.find((button) => /送出|提交|submit|save|儲存/i.test(cleanText(button.textContent)));

        return {
          index: formIndex,
          key: virtual ? "virtual_form" : selectorFor(root),
          selector: virtual ? "body" : selectorFor(root),
          id: virtual ? "" : cleanText(root.id),
          name: virtual ? "" : cleanText(root.getAttribute("name")),
          label:
            cleanText(root.getAttribute("aria-label")) ||
            cleanText(root.id) ||
            cleanText(root.getAttribute("name")) ||
            cleanText(root.querySelector("legend, h1, h2, h3")?.textContent) ||
            `form_${String(formIndex + 1).padStart(2, "0")}`,
          visible: virtual ? true : isVisible(root),
          multiStep: stepMarkers >= 2 || (stepMarkers >= 1 && hasStepNavigation),
          stepMarkers,
          submitSelector: submit ? selectorFor(submit) : null,
          fields: controls.map((element) => fieldFrom(element, formIndex)),
        };
      };

      const actualForms = Array.from(document.forms).map((form, index) => formFrom(form, index));
      const orphanControls = Array.from(
        document.querySelectorAll("input, textarea, select"),
      ).filter((element) => !element.form);
      const forms = [...actualForms];
      if (orphanControls.length) forms.push(formFrom(document.body, forms.length, true));

      return {
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || null,
        prjId: projectId(),
        outerHTML: document.documentElement.outerHTML,
        forms,
      };
    }, { discoveredBy });

  const initial = await collectState();
  const formMap = new Map(initial.forms.map((form) => [form.key, clone(form)]));
  const driverMap = new Map();

  for (const form of initial.forms) {
    for (const field of form.fields.filter(
      (candidate) => candidate.visible && !candidate.disabled && !candidate.unsupported,
    )) {
      if (field.type === "select" || field.type === "select-multiple") {
        driverMap.set(field.selector, {
          kind: "select",
          selector: field.selector,
          states: field.options
            .filter((option) => !option.disabled && option.value !== "")
            .slice(0, 6)
            .map((option) => ({ value: option.value, label: option.text })),
        });
      } else if (field.type === "radio") {
        const key = `${field.formIndex}:${field.name || field.selector}`;
        const current = driverMap.get(key) || { kind: "radio", selector: key, states: [] };
        current.states.push({
          selector: field.selector,
          value: field.value,
          label: field.label,
        });
        driverMap.set(key, current);
      } else if (field.type === "checkbox") {
        driverMap.set(field.selector, {
          kind: "checkbox",
          selector: field.selector,
          states: [
            { value: true, label: "true" },
            { value: false, label: "false" },
          ],
        });
      }
    }
  }

  const exploration = [];
  const warnings = [];
  const drivers = Array.from(driverMap.values()).slice(0, 24);

  const mergeState = (state, discoveredBy) => {
    for (const form of state.forms) {
      if (!formMap.has(form.key)) {
        const newForm = clone(form);
        newForm.fields = newForm.fields.map((field) => ({ ...field, discoveredBy }));
        formMap.set(form.key, newForm);
        continue;
      }
      const targetForm = formMap.get(form.key);
      const identity = (field) =>
        `${field.selector}|${field.type}|${
          ["radio", "checkbox"].includes(field.type) ? field.value ?? "" : ""
        }`;
      const fieldMap = new Map(targetForm.fields.map((field) => [identity(field), field]));
      for (const field of form.fields) {
        const key = identity(field);
        if (!fieldMap.has(key)) {
          targetForm.fields.push({
            ...field,
            visible: false,
            visibleEver: field.visible,
            hidden: true,
            discoveredBy,
          });
          continue;
        }
        const existing = fieldMap.get(key);
        existing.visibleEver = existing.visibleEver || field.visible;
        if (!existing.discoveredBy && !existing.visible && field.visible) {
          existing.discoveredBy = discoveredBy;
        }
      }
    }
  };

  for (const driver of drivers) {
    for (const state of driver.states) {
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(150);
        if (driver.kind === "select") {
          await page.locator(driver.selector).first().selectOption({ value: String(state.value) });
        } else if (driver.kind === "radio") {
          await page.locator(state.selector).first().check();
        } else if (state.value) {
          await page.locator(driver.selector).first().check();
        } else {
          await page.locator(driver.selector).first().uncheck();
        }
        await page.waitForTimeout(150);
        const discoveredBy = {
          kind: driver.kind,
          selector: driver.kind === "radio" ? state.selector : driver.selector,
          value: state.value,
          label: state.label,
        };
        const current = await collectState(discoveredBy);
        mergeState(current, discoveredBy);
        exploration.push({ ...discoveredBy, status: "ok" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Dynamic exploration failed for ${driver.selector}: ${message}`);
        exploration.push({
          kind: driver.kind,
          selector: driver.selector,
          value: state.value,
          status: "failed",
          message,
        });
      }
    }
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);

  return {
    capturedAt: new Date().toISOString(),
    url: initial.url,
    title: initial.title,
    lang: initial.lang,
    prjId: initial.prjId,
    outerHTML: initial.outerHTML,
    forms: Array.from(formMap.values()),
    exploration,
    warnings,
  };
}
