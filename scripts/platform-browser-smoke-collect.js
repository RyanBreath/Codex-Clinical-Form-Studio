async page => {
  const adoption = page.getByRole('combobox', { name: '採用版本', exact: true });
  await adoption.selectOption(await adoption.locator('option').nth(1).getAttribute('value'));
  await page.getByRole('button', { name: '建立表單次別', exact: true }).click();
  await page.getByRole('spinbutton', { name: '體重（必填）', exact: true }).fill('65');
  await page.getByLabel('操作／更正理由', { exact: true }).fill('確認合成資料送出');
  await page.getByRole('button', { name: '驗證並送出', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已送出並保存正式紀錄' }).waitFor();
  await page.reload();
  await page.getByLabel('開發身分', { exact: true }).selectOption('dev-site-a');
  await page.getByRole('button', { name: '03資料收集' }).click();
  const saved = page.getByRole('spinbutton', { name: '體重（必填）', exact: true });
  await saved.waitFor(); if (await saved.inputValue() !== '65') throw new Error('重新載入未取得伺服器保存的填答');
  await page.getByLabel('開發身分', { exact: true }).selectOption('dev-reviewer');
  await page.getByLabel('操作／更正理由', { exact: true }).fill('獨立核對合成紀錄');
  await page.getByRole('button', { name: '確認審閱', exact: true }).click();
  await page.getByRole('button', { name: '鎖定資料', exact: true }).click();
  await page.getByText('已鎖定', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '06資料查核與匯出' }).click();
  await page.getByLabel('匯出理由', { exact: true }).fill('合成研究瀏覽器驗收');
  await page.getByRole('button', { name: '建立匯出快照', exact: true }).click();
  await page.getByRole('button', { name: '下載 JSON 快照', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/platform-20261028/review-and-export.png', fullPage: true });
  console.log('已驗證：訪視填答、重載持久化、獨立審閱、鎖定及受控匯出快照。');
}
