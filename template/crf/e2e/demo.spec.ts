import { expect, test, type Page } from "@playwright/test";

async function completeRequiredFields(page: Page) {
  await page.getByRole("spinbutton", { name: /年齡/ }).fill("42");
  await page.getByRole("radio", { name: "未知／不提供" }).check();

  const essQuestions = [
    /坐著閱讀時打瞌睡的可能性/,
    /看電視時打瞌睡的可能性/,
    /在公共場所靜坐時打瞌睡的可能性/,
    /連續乘車一小時時打瞌睡的可能性/,
    /下午躺下休息時打瞌睡的可能性/,
    /坐著與人交談時打瞌睡的可能性/,
    /午餐後靜坐時打瞌睡的可能性/,
    /駕車等紅燈時打瞌睡的可能性/,
  ];
  for (const question of essQuestions) {
    await page
      .getByRole("radiogroup", { name: question })
      .getByRole("radio", { name: "1｜輕微" })
      .check();
  }

  await page.getByRole("checkbox", { name: /我確認此頁只使用合成 Demo 資料/ }).check();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AirwayAI 基線評估" })).toBeVisible();
});

test("條件欄位只在規則成立時顯示", async ({ page }) => {
  const sleepStudy = page.getByRole("checkbox", { name: /是否已有睡眠檢查結果/ });
  await expect(page.getByText("呼吸中止低通氣指數（AHI）")).toBeHidden();

  await sleepStudy.check();
  await expect(page.getByRole("spinbutton", { name: /呼吸中止低通氣指數/ })).toBeVisible();
  await page.getByRole("spinbutton", { name: /呼吸中止低通氣指數/ }).fill("18.5");

  await sleepStudy.uncheck();
  await expect(page.getByText("呼吸中止低通氣指數（AHI）")).toBeHidden();
  await expect(page.getByText(/"ahi"/)).toHaveCount(0);
});

test("完成表單後送出 schema-bound payload 與 ESS 衍生值", async ({ page }) => {
  await completeRequiredFields(page);
  await expect(page.getByText("8", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "驗證並送出" }).click();

  await expect(page.getByText("Host 已接收")).toBeVisible();
  const lastSubmission = page
    .getByRole("complementary", { name: "開發診斷資訊" })
    .locator("section")
    .nth(1);
  await expect(lastSubmission).toContainText('"schemaVersion": "1.0.0"');
  await expect(lastSubmission).toContainText('"total": 8');
  await expect(lastSubmission).toContainText('"/ess/total"');
});

test("Host 拒絕送出時保留輸入內容", async ({ page }) => {
  await completeRequiredFields(page);
  await page.getByRole("checkbox", { name: "下次送出模擬失敗" }).check();
  const participantCode = page.getByRole("textbox", { name: /合成受試者代碼/ });
  await participantCode.fill("DEMO-202");

  await page.getByRole("button", { name: "驗證並送出" }).click();

  await expect(page.getByText(/Demo Host 模擬儲存失敗/)).toBeVisible();
  await expect(participantCode).toHaveValue("DEMO-202");
});

test("可切換唯讀歷史紀錄", async ({ page }) => {
  await page.getByRole("button", { name: "唯讀模式" }).click();

  await expect(page.getByText("唯讀紀錄", { exact: true })).toBeVisible();
  await expect(page.getByText("DEMO-008")).toBeVisible();
  await expect(page.getByText(/X 12.4 · Y -3.8 · Z 22.1 mm/)).toBeVisible();
  await expect(page.getByRole("button", { name: "驗證並送出" })).toHaveCount(0);
});
