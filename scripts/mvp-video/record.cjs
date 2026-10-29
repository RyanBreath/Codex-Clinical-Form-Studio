const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium } = require(path.join(process.env.TEMP, 'clinical-mvp-video-tools/node_modules/playwright'));
const root = process.cwd();
const out = path.join(root, 'output/video/mvp-20261029');
const script = JSON.parse(fs.readFileSync(path.join(out, 'script.json'), 'utf8'));
const environment = JSON.parse(fs.readFileSync(path.join(out, 'capture-env.json'), 'utf8').replace(/^\uFEFF/, ''));
const base = environment.baseUrl;
if (new URL(base).hostname !== '127.0.0.1' || new URL(base).port !== '5199') throw new Error('Capture environment is not isolated');

(async () => {
  const request = async (route, actor = 'dev-operator', data) => {
    const response = await fetch(base + '/api' + route, { method: data ? 'POST' : 'GET', headers: { 'X-Development-User': actor, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    if (!response.ok) throw new Error(`${route} failed: ${response.status}`);
    return response.json();
  };
  const runtime = await request('/runtime');
  if (!runtime.developmentIdentity || !runtime.syntheticOnly || !/^formplatform_capture_[a-f0-9]{32}$/.test(environment.database)) throw new Error('Synthetic capture guard failed');
  const study = await request('/studies', 'dev-operator', { code: 'VIDEO-MVP-20261029', name: 'MVP 情境示範研究' });
  const site = await request(`/studies/${study.id}/sites`, 'dev-operator', { code: 'DEMO-A', name: '示範甲院' });
  const users = await request('/users');
  for (const [name, permissions, siteId, crossSite] of [['表單設計者',258,null,false],['獨立核准／審閱者',884,null,true],['甲院研究人員',264,site.id,false]])
    await request(`/studies/${study.id}/grants`, 'dev-operator', { userId: users.find(user => user.name === name).id, permissions, siteId, crossSite, reason: '獨立錄製環境合成角色' });
  const subject = await request(`/studies/${study.id}/subjects`, 'dev-site-a', { siteId: site.id, code: 'SYNTH-001' });
  const template = await request(`/studies/${study.id}/templates`, 'dev-designer', { name: '生命徵象', kind: 'ecrf' });
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'template/data-dictionaries/platform-vitals.json'), 'utf8'));
  const version = await request(`/templates/${template.id}/versions`, 'dev-designer', { version: '1.0.0', contract, sourceYaml: '' });
  const icf = await request(`/studies/${study.id}/icfs`, 'dev-designer', { name: '研究參與者同意書', version: '1.0', locale: 'zh-TW', content: '本文件僅供合成資料操作示範。\n\n研究目的：評估研究資料收集流程。\n資料範圍：生命徵象與研究訪視紀錄。\n參與方式：由研究人員依院端簽署證據登錄。\n退出與聯絡：依院端研究團隊核准流程辦理。\n\n此範例不代表真實 IRB 核准或受試者簽署。', approvalReference: 'SYNTH-IRB-2026-001' });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(out, 'raw'), size: { width: 1920, height: 1080 } }, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true });
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = String(1920 / 1440); });
  });
  const errors = [];
  const page = await context.newPage();
  const start = performance.now();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push({ kind: 'pageerror', message: error.message }));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/')) errors.push({ kind: 'http', status: response.status(), path: new URL(response.url()).pathname }); });
  page.on('dialog', dialog => dialog.accept('已核對院端合成簽署文件'));
  const shots = [];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clock = () => (performance.now() - start) / 1000;
  async function pointer(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) return;
    const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 20);
    await page.mouse.move(x, y, { steps: 12 });
    await page.evaluate(({x,y}) => {
      let node = document.getElementById('record-pointer');
      if (!node) { node = document.createElement('div'); node.id = 'record-pointer'; node.style.cssText = 'position:fixed;pointer-events:none;width:22px;height:22px;border:3px solid #315fce;border-radius:50%;background:#315fce22;z-index:2147483647;zoom:.75;'; document.body.append(node); }
      node.style.left = `${x - 11}px`; node.style.top = `${y - 11}px`;
    }, { x, y });
    await wait(170);
  }
  async function click(locator) { await pointer(locator); await locator.click(); await wait(220); }
  async function fill(locator, value) { await pointer(locator); await locator.fill(String(value)); await wait(250); }
  async function select(locator, value) { await pointer(locator); await locator.selectOption(value); await wait(300); }
  const role = () => page.getByRole('combobox', { name: '開發身分', exact: true });
  async function as(actor) {
    await select(role(), actor);
    await page.getByRole('combobox', { name: '目前研究', exact: true }).selectOption(study.id);
    await wait(250);
  }
  async function tab(name) { await click(page.getByRole('button', { name, exact: true })); }
  async function saved() { await page.getByRole('status').filter({ hasText: '已儲存' }).waitFor(); }
  async function shot(index, work) {
    const source = script.shots[index]; const begin = clock(); console.log('Recording ' + source.id);
    await work();
    const remaining = source.audioDuration + 1.1 - (clock() - begin);
    if (remaining > 0) await wait(remaining * 1000);
    shots.push({ ...source, start: begin, end: clock(), duration: clock() - begin });
    fs.writeFileSync(path.join(out, 'recording-progress.json'), JSON.stringify({ shots, errors }, null, 2));
  }
  async function card(last = false) {
    await page.setContent(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>html{zoom:1!important}*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;background:#f8f9fb;color:#252d3b;font-family:'Microsoft JhengHei',sans-serif;display:flex;align-items:center;justify-content:center}.box{width:1540px;border:1px solid #dfe4ec;background:white;border-radius:10px;padding:90px}.tag{font:24px Consolas;color:#315fce;letter-spacing:3px}h1{font-size:70px;letter-spacing:-2px;line-height:1.4;margin:30px 0}p{font-size:32px;color:#5d6b80;line-height:1.8}.bar{width:100px;height:6px;background:#315fce;margin:30px 0}.note{font-size:24px;color:#626d7e}</style></head><body><main class="box"><div class="tag">CLINICAL FORM / MVP</div><h1>${script.title.replace('：','<br>')}</h1><div class="bar"></div><p>${last ? '設計 → 核准 → 依據 → 填答 → 審閱 → 鎖定 → 匯出' : '多角色完整流程・實際系統操作'}</p><p class="note">${last ? '本機合成資料 MVP；AI、集中附件與 CBCT 尚未接入。' : '全程合成資料・無真實受試者資訊'}</p></main></body></html>`);
  }
  try {
    await shot(0, () => card());
    await shot(1, async () => {
      await page.goto(`${base}/platform.html?studyId=${study.id}`);
      await page.getByRole('heading', { name: '訪視工作清單', exact: true }).waitFor();
      await pointer(page.getByRole('heading', { name: '研究設定', exact: true }));
      await page.screenshot({ path: path.join(out, 'shot-01.png') });
    });
    await shot(2, async () => {
      await as('dev-designer'); await tab('02表單設計');
      await click(page.locator('.field-choice').filter({ hasText: '體重' }));
      await fill(page.getByRole('spinbutton', { name: '最大值', exact: true }), 250);
      await fill(page.locator('.designer-preview').getByRole('spinbutton', { name: '體重（必填）', exact: true }), 65);
      await fill(page.locator('.designer-preview').getByRole('spinbutton', { name: '身高（必填）', exact: true }), 170);
      await pointer(page.locator('.designer-preview').getByText('22.49', { exact: true }));
      await page.screenshot({ path: path.join(out, 'shot-02.png'), fullPage: true });
      await fill(page.getByRole('textbox', { name: '操作／更正理由', exact: true }), '調整合成研究合理範圍');
      await click(page.getByRole('button', { name: '儲存草稿', exact: true })); await saved();
      await click(page.getByRole('button', { name: '送交獨立核准', exact: true })); await saved();
    });
    await shot(3, async () => {
      await as('dev-reviewer');
      await fill(page.getByRole('textbox', { name: '操作／更正理由', exact: true }), '獨立核對合成表單');
      await click(page.getByRole('button', { name: '核准並正式發布', exact: true })); await saved();
      await click(page.getByText('此研究採用版本', { exact: true }));
      await fill(page.getByRole('spinbutton', { name: '每次訪視最多填寫次數', exact: true }), 1);
      await fill(page.getByRole('textbox', { name: '採用理由', exact: true }), '本研究採用生命徵象固定版本');
      await click(page.getByRole('button', { name: '確認採用固定版本', exact: true }));
      await page.getByRole('status').filter({ hasText: '已採用' }).waitFor();
      await page.screenshot({ path: path.join(out, 'shot-03.png') });
    });
    await shot(4, async () => {
      await as('dev-designer'); await tab('04ICF 與收集依據');
      await select(page.getByRole('combobox', { name: 'ICF 文件版本', exact: true }), icf.id);
      await pointer(page.getByRole('textbox', { name: 'ICF 文件內容', exact: true }));
      await fill(page.getByRole('textbox', { name: 'ICF 操作理由', exact: true }), '核對合成內容後送審');
      await click(page.getByRole('button', { name: '送交 ICF 核准', exact: true })); await saved();
      await as('dev-reviewer');
      await select(page.getByRole('combobox', { name: 'ICF 文件版本', exact: true }), icf.id);
      await fill(page.getByRole('textbox', { name: 'ICF 操作理由', exact: true }), '已獨立核對外部核准依據');
      await click(page.getByRole('button', { name: '獨立核准 ICF', exact: true })); await saved();
      await page.screenshot({ path: path.join(out, 'shot-04.png') });
    });
    await shot(5, async () => {
      await as('dev-site-a');
      await select(page.getByRole('combobox', { name: '依據種類', exact: true }), 'consent');
      await fill(page.getByRole('textbox', { name: '院端文件編號／核准依據', exact: true }), 'SYNTH-SIGNED-001');
      await select(page.getByRole('combobox', { name: '適用 ICF 版本', exact: true }), icf.id);
      await fill(page.getByLabel('簽署日期', { exact: true }), new Date().toISOString().slice(0,10));
      await click(page.getByRole('button', { name: '登錄並等待確認', exact: true })); await saved();
      await as('dev-reviewer');
      await click(page.getByRole('button', { name: '確認適用依據', exact: true })); await saved();
      await page.screenshot({ path: path.join(out, 'shot-05.png') });
    });
    await shot(6, async () => {
      await as('dev-site-a'); await tab('03資料收集');
      await click(page.getByText('新增訪視', { exact: true }));
      await fill(page.getByRole('textbox', { name: '訪視名稱', exact: true }), '初次訪視');
      await fill(page.getByLabel('日期', { exact: true }), new Date().toISOString().slice(0,10));
      await click(page.getByRole('button', { name: '建立訪視', exact: true })); await saved();
      await click(page.getByText('新增應收表單', { exact: true }));
      const adoptions = await request(`/studies/${study.id}/adoptions`, 'dev-site-a');
      await select(page.getByRole('combobox', { name: '採用版本', exact: true }), adoptions[0].id);
      await click(page.getByRole('button', { name: '建立表單次別', exact: true })); await saved();
      await fill(page.getByRole('spinbutton', { name: '體重（必填）', exact: true }), 65);
      await fill(page.getByRole('spinbutton', { name: '身高（必填）', exact: true }), 170);
      await pointer(page.getByText('22.49', { exact: true }));
      await click(page.getByRole('button', { name: '儲存草稿', exact: true })); await saved();
      await click(page.getByRole('button', { name: '重新載入', exact: true }));
      await page.getByRole('spinbutton', { name: '體重（必填）', exact: true }).waitFor();
      if (await page.getByRole('spinbutton', { name: '體重（必填）', exact: true }).inputValue() !== '65') throw new Error('Saved data missing');
      await fill(page.getByRole('textbox', { name: '操作／更正理由', exact: true }), '確認合成資料正確後送出');
      await click(page.getByRole('button', { name: '驗證並送出', exact: true }));
      await page.getByRole('status').filter({ hasText: '已送出' }).waitFor();
      await page.screenshot({ path: path.join(out, 'shot-06.png') });
    });
    await shot(7, async () => {
      await as('dev-reviewer'); await tab('01研究總覽');
      await click(page.getByRole('button', { name: '待審閱', exact: true }));
      await click(page.getByRole('button', { name: '開啟 SYNTH-001 初次訪視', exact: true }));
      await fill(page.getByRole('textbox', { name: '操作／更正理由', exact: true }), '已獨立核對合成生命徵象');
      await click(page.getByRole('button', { name: '確認審閱', exact: true })); await saved();
      await click(page.getByRole('button', { name: '鎖定資料', exact: true })); await saved();
      await page.getByText('已鎖定', { exact: true }).first().waitFor();
      await page.screenshot({ path: path.join(out, 'shot-07.png') });
    });
    await shot(8, async () => {
      await tab('06資料查核與匯出');
      await fill(page.getByRole('textbox', { name: '匯出理由', exact: true }), '合成研究資料檢視');
      await click(page.getByRole('button', { name: '建立匯出快照', exact: true }));
      await page.getByRole('button', { name: '下載 JSON 快照', exact: true }).waitFor();
      const downloadEvent = page.waitForEvent('download');
      await click(page.getByRole('button', { name: '下載 JSON 快照', exact: true }));
      await (await downloadEvent).saveAs(path.join(out, 'demo-export.json'));
      await pointer(page.getByText('完整性雜湊：', { exact: false }));
      await page.screenshot({ path: path.join(out, 'shot-08.png') });
    });
    const visits = await request(`/subjects/${subject.id}/visits`, 'dev-site-a');
    const occurrences = await request(`/visits/${visits[0].id}/occurrences`, 'dev-site-a');
    const response = await request(`/responses/${occurrences[0].response.id}`, 'dev-site-a');
    if (response.state !== 'locked' || Math.abs(response.data.bmi - 22.4913494809) > .001) throw new Error('Final record verification failed');
    await shot(9, async () => {
      await page.goto(`${base}/platform.html?integration-demo=1`);
      await fill(page.getByRole('textbox', { name: '表單次別 ID', exact: true }), occurrences[0].id);
      await click(page.getByRole('button', { name: '開啟嵌入表單', exact: true }));
      const frame = page.frameLocator('iframe');
      await frame.getByRole('combobox', { name: '合成資料開發身分', exact: true }).selectOption('dev-reviewer');
      await frame.getByText('已鎖定', { exact: false }).first().waitFor();
      await page.locator('iframe').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'shot-09.png') });
    });
    await shot(10, () => card(true));
  } finally {
    await context.close();
    await page.video().saveAs(path.join(out, 'MVP1.webm'));
    await browser.close();
    fs.writeFileSync(path.join(out, 'recording.json'), JSON.stringify({ shots, errors, elapsed: clock(), environment: { baseUrl: base, database: environment.database }, studyId: study.id }, null, 2));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
