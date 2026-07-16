import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const schemaPath = process.env.AIRWAYAI_CRF_SCHEMA_PATH;
const schema = schemaPath ? (JSON.parse(readFileSync(schemaPath, "utf8")) as {
  "x-airwayai": {
    defaultLocale: string;
    title: Record<string, string>;
    status: string;
  };
}) : undefined;
const extension = schema?.["x-airwayai"];
const expectedTitle = extension?.title[extension.defaultLocale] ?? "";

test.skip(!schemaPath, "只在版本化 release pipeline 執行");

test("版本化 schema 可在靜態 release 中渲染", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { name: expectedTitle })).toBeVisible();
  await expect(page.locator("form")).toBeVisible();
  await expect(page.getByText(/無法載入表單合約|合約驗證失敗/)).toHaveCount(0);
});
