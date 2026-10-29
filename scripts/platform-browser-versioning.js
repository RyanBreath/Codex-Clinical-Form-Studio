async page => {
  const runtime = await (await page.request.get(new URL('/api/runtime', page.url()).href)).json();
  if (!runtime.developmentIdentity || !runtime.syntheticOnly) throw new Error('僅允許合成資料驗收');
  await page.getByRole('button', { name: '另建新版本', exact: true }).click();
  await page.getByRole('textbox', { name: '版本編號', exact: true }).fill('2.0.0');
  await page.getByRole('spinbutton', { name: '最大值', exact: true }).fill('250');
  await page.getByRole('button', { name: '儲存草稿', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已儲存' }).waitFor();
  await page.getByText('比較版本差異', { exact: true }).click();
  const baseline = page.getByRole('combobox', { name: '比較基準', exact: true });
  await baseline.selectOption({ label: '1.0.0' });
  await page.getByRole('button', { name: '比較已儲存版本', exact: true }).click();
  await page.getByRole('cell', { name: '/properties/field1/maximum', exact: true }).waitFor();
  await page.getByRole('cell', { name: '/x-airwayai/schemaVersion', exact: true }).waitFor();
  const version = await page.getByRole('textbox', { name: '版本編號', exact: true }).inputValue();
  if (version !== '2.0.0') throw new Error('版本編號未保存');
  await page.screenshot({ path: 'output/playwright/platform-20261028/version-comparison.png', fullPage: true });
  console.log('已驗證另建版本、保存及數值限制／契約版本差異。');
}
