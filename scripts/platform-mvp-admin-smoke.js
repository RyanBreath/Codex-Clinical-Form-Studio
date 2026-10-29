async page => {
  const runtime = await (await page.request.get(new URL('/api/runtime', page.url()).href)).json();
  if (!runtime.developmentIdentity || !runtime.syntheticOnly) throw new Error('僅限本機合成驗收');
  await page.getByRole('combobox', { name: '開發身分', exact: true }).selectOption('dev-operator');
  await page.getByRole('button', { name: '07平台帳號管理', exact: true }).click();
  const name = `MVP 合成帳號 ${Date.now()}`;
  await page.getByRole('textbox', { name: '帳號顯示名稱', exact: true }).fill(name);
  await page.getByRole('textbox', { name: '供應商識別 issuer|subject', exact: true }).fill(`https://identity.synthetic.invalid|${Date.now()}`);
  await page.getByRole('button', { name: '註冊帳號', exact: true }).click();
  await page.getByRole('cell', { name, exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/platform-20261028/mvp-account-administration.png', fullPage: true });
  await page.goto(new URL('/platform.html?occurrence=00000000-0000-0000-0000-000000000000&parentOrigin=https%3A%2F%2Funapproved.synthetic.invalid', page.url()).href);
  await page.getByRole('alert').filter({ hasText: '父頁來源未在平台允許名單' }).waitFor();
  if (await page.getByRole('button', { name: '驗證並送出', exact: true }).count()) throw new Error('不允許的父頁仍能開啟填答');
}
