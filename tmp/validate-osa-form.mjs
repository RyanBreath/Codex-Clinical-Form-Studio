async (page) => {
  const form = page.locator("form");
  const fillValid = async () => {
    await page.locator('[name="informedConsentObtained"]').check();
    await page.locator('[name="allInclusionCriteriaMet"]').check();
    await page.locator('[name="noExclusionCriteriaPresent"]').check();
    await page.locator("#ageYears").fill("30");
    await page.locator('[name="sex"][value="F"]').check();
    await page.locator("#educationYears").fill("0");
  };

  await fillValid();
  const validBaseline = await form.evaluate((element) => element.checkValidity());
  await page.locator("#ageYears").fill("29");
  const ageBelowMinimum = await form.evaluate((element) => element.checkValidity());
  await page.locator("#ageYears").fill("66");
  const ageAboveMaximum = await form.evaluate((element) => element.checkValidity());
  await page.reload();
  await page.locator('[name="informedConsentObtained"]').check();
  await page.locator('[name="allInclusionCriteriaMet"]').check();
  await page.locator('[name="noExclusionCriteriaPresent"]').check();
  await page.locator("#ageYears").fill("30");
  const missingSex = await page.locator("form").evaluate((element) => element.checkValidity());
  return { validBaseline, ageBelowMinimum, ageAboveMaximum, missingSex };
}
