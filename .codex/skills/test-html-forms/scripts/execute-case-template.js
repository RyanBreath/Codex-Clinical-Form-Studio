async (page) => {
  const testCase = __TEST_CASE_JSON__;
  const config = __CONFIG_JSON__;
  const allowSubmit = __ALLOW_SUBMIT__;
  const actionLog = [];
  const beforeUrl = page.url();

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(120);

  const setRadioEmpty = async (options) => {
    for (const option of options || []) {
      await page
        .locator(option.selector)
        .first()
        .evaluate((element) => {
          element.checked = false;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }
  };

  for (const action of testCase.actions || []) {
    const locator = page.locator(action.selector).first();
    await locator.waitFor({ state: "attached", timeout: 5000 });
    if (!["radio", "checkbox-group"].includes(action.widget)) {
      await locator.waitFor({ state: "visible", timeout: 5000 });
    }

    if (action.widget === "radio") {
      if (action.value === null || action.value === undefined || action.value === "") {
        await setRadioEmpty(action.options);
      } else {
        const option = (action.options || []).find(
          (candidate) => String(candidate.value) === String(action.value),
        );
        if (!option) throw new Error(`Radio option not found for ${action.fieldKey}: ${action.value}`);
        await page.locator(option.selector).first().check();
      }
    } else if (action.widget === "checkbox-group") {
      const desired = new Set((action.value || []).map((value) => String(value)));
      for (const option of action.options || []) {
        const optionLocator = page.locator(option.selector).first();
        if (desired.has(String(option.value))) await optionLocator.check();
        else await optionLocator.uncheck();
      }
    } else if (action.widget === "checkbox") {
      if (Boolean(action.value)) await locator.check();
      else await locator.uncheck();
    } else if (action.widget === "select-multiple") {
      const values = (action.value || []).map((value) => String(value));
      await locator.selectOption(values);
    } else if (action.widget === "select") {
      if (action.value === null || action.value === undefined) {
        await locator.evaluate((element) => {
          element.selectedIndex = -1;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        });
      } else {
        await locator.selectOption({ value: String(action.value) });
      }
    } else {
      await locator.fill(action.value === null || action.value === undefined ? "" : String(action.value));
    }

    await locator.blur().catch(() => {});
    actionLog.push({
      fieldKey: action.fieldKey,
      selector: action.selector,
      value: action.value,
      status: "filled",
    });
    await page.waitForTimeout(40);
  }

  const formLocator = page.locator(testCase.formSelector || "body").first();
  await formLocator.waitFor({ state: "attached", timeout: 5000 });

  const nativeState = await formLocator.evaluate((root) => {
    const isVisible = (element) => {
      if (!element || element.hidden) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controls = Array.from(root.querySelectorAll("input, textarea, select")).filter(
      (element) =>
        element.type !== "hidden" &&
        element.type !== "file" &&
        !element.disabled &&
        isVisible(element),
    );
    const invalid = controls
      .filter((element) => typeof element.checkValidity === "function" && !element.checkValidity())
      .map((element) => ({
        id: element.id || null,
        name: element.name || null,
        type: element.type || element.tagName.toLowerCase(),
        message: element.validationMessage || null,
        value: element.value,
        validity: {
          valueMissing: element.validity?.valueMissing || false,
          typeMismatch: element.validity?.typeMismatch || false,
          patternMismatch: element.validity?.patternMismatch || false,
          tooLong: element.validity?.tooLong || false,
          tooShort: element.validity?.tooShort || false,
          rangeUnderflow: element.validity?.rangeUnderflow || false,
          rangeOverflow: element.validity?.rangeOverflow || false,
          stepMismatch: element.validity?.stepMismatch || false,
          customError: element.validity?.customError || false,
        },
      }));
    const valid =
      root instanceof HTMLFormElement
        ? root.checkValidity()
        : controls.every(
            (element) => typeof element.checkValidity !== "function" || element.checkValidity(),
          );
    return { valid, invalid, controlCount: controls.length };
  });

  if (!allowSubmit) {
    await formLocator.evaluate((root) => {
      if (root instanceof HTMLFormElement) root.reportValidity();
      else {
        for (const element of root.querySelectorAll("input, textarea, select")) {
          if (!element.disabled && typeof element.reportValidity === "function") {
            element.reportValidity();
          }
        }
      }
    });
    await page.waitForTimeout(120);
  }

  const errorSelector =
    config.selectors?.error ||
    "[aria-invalid='true'], [role='alert'], .field-error, .invalid-feedback";
  const visibleErrors = await page.locator(errorSelector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim())
      .filter(Boolean),
  );

  let submitted = false;
  let submitSignal = false;
  let submitNote = allowSubmit ? "" : "未取得正式送出授權，僅執行送出前驗證。";

  if (allowSubmit && testCase.expected.kind !== "readonly") {
    const submitSelector =
      config.selectors?.submit_button || testCase.submitSelector || "button[type='submit'], input[type='submit']";
    const submitButton = page.locator(submitSelector).first();
    if ((await submitButton.count()) > 0 && (await submitButton.isVisible())) {
      await submitButton.click();
      submitted = true;
      await page.waitForTimeout(700);
      const successBySelector = config.selectors?.success
        ? await page.locator(config.selectors.success).first().isVisible().catch(() => false)
        : false;
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const successByText = config.success_text
        ? bodyText.includes(String(config.success_text))
        : false;
      submitSignal = successBySelector || successByText || page.url() !== beforeUrl;
      submitNote = submitSignal
        ? "偵測到成功 selector、成功文字或 URL 變更。"
        : "已送出但沒有足夠的成功訊號。";
    } else {
      submitNote = "找不到可見的送出按鈕，需人工確認。";
    }
  }

  const readonlyChecks = [];
  if (testCase.expected.kind === "readonly") {
    for (const selector of testCase.targetSelectors || []) {
      const locator = page.locator(selector).first();
      readonlyChecks.push({
        selector,
        editable: await locator.isEditable().catch(() => false),
        disabled: await locator.isDisabled().catch(() => false),
      });
    }
  }

  const afterUrl = page.url();
  const hasInvalidEvidence = !nativeState.valid || nativeState.invalid.length > 0 || visibleErrors.length > 0;
  let status = "需人工確認";

  if (testCase.expected.kind === "manual") {
    status = "需人工確認";
  } else if (testCase.expected.kind === "readonly") {
    status = readonlyChecks.every((check) => !check.editable || check.disabled) ? "PASS" : "FAIL";
  } else if (testCase.expected.kind === "invalid") {
    status = hasInvalidEvidence && !submitSignal ? "PASS" : "FAIL";
  } else if (testCase.expected.kind === "valid") {
    if (hasInvalidEvidence) status = "FAIL";
    else if (!allowSubmit) status = "PASS";
    else if (!submitted || !submitSignal) status = "需人工確認";
    else status = "PASS";
  }

  const actualResult = [
    nativeState.valid ? "HTML 原生驗證通過" : `HTML 原生驗證失敗 ${nativeState.invalid.length} 欄`,
    visibleErrors.length ? `可見錯誤訊息 ${visibleErrors.length} 筆` : "未偵測到可見錯誤訊息",
    submitNote,
  ].join("；");

  return {
    id: testCase.id,
    status,
    actualResult,
    note:
      status === "需人工確認"
        ? testCase.expected.manualReason || submitNote
        : visibleErrors.join(" | "),
    expected: testCase.expected,
    nativeState,
    visibleErrors,
    actionLog,
    readonlyChecks,
    submitted,
    submissionAuthorized: allowSubmit,
    submitSignal,
    beforeUrl,
    afterUrl,
    testedAt: new Date().toISOString(),
  };
}
