async page => {
  const base = new URL('/api/', page.url()).href;
  const runtime = await (await page.request.get(base + 'runtime')).json();
  if (!runtime.developmentIdentity || !runtime.syntheticOnly) throw new Error('僅限本機合成資料 MVP 驗收');
  const call = async (path, actor = 'dev-operator', data) => {
    const options = { headers: { 'X-Development-User': actor }, ...(data ? { data } : {}) };
    const result = data ? await page.request.post(base + path, options) : await page.request.get(base + path, options);
    if (!result.ok()) throw new Error(`${path}: ${await result.text()}`); return result.json();
  };
  const study = await call('studies', 'dev-operator', { code: `SYNTH-MVP-${Date.now()}`, name: 'MVP 合成驗收研究' });
  const site = await call(`studies/${study.id}/sites`, 'dev-operator', { code: 'A', name: 'MVP 甲院' });
  const users = await call('users');
  for (const [name, permissions, siteId, crossSite] of [['表單設計者', 258, null, false], ['獨立核准／審閱者', 884, null, true], ['甲院研究人員', 264, site.id, false]]) {
    await call(`studies/${study.id}/grants`, 'dev-operator', { userId: users.find(user => user.name === name).id, permissions, siteId, crossSite, reason: 'MVP 合成驗收授權' });
  }
  const subject = await call(`studies/${study.id}/subjects`, 'dev-site-a', { siteId: site.id, code: 'SYNTH-MVP-A001' });
  const visit = await call(`subjects/${subject.id}/visits`, 'dev-site-a', { name: 'MVP 初次訪視', date: '2026-10-28', unscheduled: true });
  const template = await call(`studies/${study.id}/templates`, 'dev-designer', { name: 'MVP 生命徵象', kind: 'ecrf' });
  // Synthetic fixture mirrors template/data-dictionaries/platform-vitals.json.
  const contract = {
      "$schema":"https://json-schema.org/draft/2020-12/schema", "$id":"https://example.test/forms/vitals/1.0.0",
      "type":"object", "additionalProperties":false, "properties":{
        "weight":{"type":"number","minimum":1,"maximum":300},
        "height":{"type":"number","minimum":30,"maximum":250},
        "bmi":{"type":"number","readOnly":true},
        "symptom":{"type":"boolean"}, "detail":{"type":"string","maxLength":50}
      },"required":["weight","height"],
      "x-airwayai":{"contractVersion":"1.2.0","formId":"vitals","schemaVersion":"1.0.0","status":"draft",
        "defaultLocale":"zh-TW","locales":["zh-TW"],"title":{"zh-TW":"生命徵象"},
        "fields":{
          "/weight":{"label":{"zh-TW":"體重"},"widget":"number","coding":{"status":"unresolved"}},
          "/height":{"label":{"zh-TW":"身高"},"widget":"number","coding":{"status":"unresolved"}},
          "/bmi":{"label":{"zh-TW":"BMI"},"widget":"computed","coding":{"status":"unresolved"}},
          "/symptom":{"label":{"zh-TW":"有症狀"},"widget":"boolean","coding":{"status":"unresolved"}},
          "/detail":{"label":{"zh-TW":"說明"},"widget":"text","visibleWhen":{"op":"eq","path":"/symptom","value":true},"requiredWhen":{"op":"eq","path":"/symptom","value":true},"coding":{"status":"unresolved"}}
        },"layout":[{"type":"section","id":"main","title":{"zh-TW":"生命徵象"},"items":[{"type":"field","path":"/weight"},{"type":"field","path":"/height"},{"type":"field","path":"/bmi"},{"type":"field","path":"/symptom"},{"type":"field","path":"/detail"}]}],
        "computed":{"/bmi":{"op":"divide","args":[{"op":"path","path":"/weight"},{"op":"multiply","args":[{"op":"divide","args":[{"op":"path","path":"/height"},{"op":"value","value":100}]},{"op":"divide","args":[{"op":"path","path":"/height"},{"op":"value","value":100}]}]}]}}
      }
    };
  let version = await call(`templates/${template.id}/versions`, 'dev-designer', { version: '1.0.0', contract, sourceYaml: '' });
  version = await call(`form-versions/${version.id}/submit`, 'dev-designer', { expectedRevision: version.revision, reason: '合成表單送審' });
  version = await call(`form-versions/${version.id}/publish`, 'dev-reviewer', { expectedRevision: version.revision, reason: '獨立核准合成表單' });
  const adoption = await call(`studies/${study.id}/adoptions`, 'dev-reviewer', { formVersionId: version.id, maximumOccurrences: 1, reason: 'MVP 固定版本採用' });
  await page.goto(new URL('/platform.html', page.url()).href);
  const identity = page.getByRole('combobox', { name: '開發身分', exact: true });
  const selectActor = async actor => {
    await identity.selectOption(actor);
    await page.getByRole('combobox', { name: '目前研究', exact: true }).selectOption(study.id);
  };
  await selectActor('dev-designer');
  await page.getByRole('button', { name: '04ICF 與收集依據', exact: true }).click();
  await page.getByRole('textbox', { name: 'ICF 名稱', exact: true }).fill('MVP 受試者同意書');
  await page.getByRole('textbox', { name: 'ICF 版本編號', exact: true }).fill('1.0');
  await page.getByRole('textbox', { name: '外部／IRB 核准依據', exact: true }).fill('SYNTH-IRB-MVP');
  await page.getByRole('textbox', { name: 'ICF 文件內容', exact: true }).fill('僅供合成資料驗收的研究說明與同意文件。');
  await page.getByRole('button', { name: '儲存 ICF 草稿', exact: true }).click();
  await page.getByRole('button', { name: '送交 ICF 核准', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'ICF 操作理由', exact: true }).fill('已完成合成文件設計');
  await page.getByRole('button', { name: '送交 ICF 核准', exact: true }).click();
  const icf = (await call(`studies/${study.id}/icfs`, 'dev-reviewer'))[0];
  await selectActor('dev-reviewer');
  await page.getByRole('combobox', { name: 'ICF 文件版本', exact: true }).selectOption(icf.id);
  await page.getByRole('textbox', { name: 'ICF 操作理由', exact: true }).fill('已獨立核對合成核准依據');
  await page.getByRole('button', { name: '獨立核准 ICF', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已儲存' }).waitFor();
  await selectActor('dev-site-a');
  await page.getByRole('combobox', { name: '依據種類', exact: true }).selectOption('consent');
  await page.getByRole('textbox', { name: '院端文件編號／核准依據', exact: true }).fill('SYNTH-SIGNED-ICF-MVP');
  await page.getByRole('combobox', { name: '適用 ICF 版本', exact: true }).selectOption(icf.id);
  await page.getByLabel('簽署日期', { exact: true }).fill('2026-10-28');
  await page.getByRole('button', { name: '登錄並等待確認', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已儲存' }).waitFor();
  await selectActor('dev-reviewer');
  page.once('dialog', dialog => dialog.accept('已核對院端合成簽署文件'));
  await page.getByRole('button', { name: '確認適用依據', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已儲存' }).waitFor();
  const occurrence = await call(`visits/${visit.id}/occurrences`, 'dev-site-a', { adoptionId: adoption.id, number: 1 });
  await page.goto(new URL('/platform.html?integration-demo=1', page.url()).href);
  await page.getByRole('textbox', { name: '表單次別 ID', exact: true }).fill(occurrence.id);
  await page.getByRole('button', { name: '開啟嵌入表單', exact: true }).click();
  const embedded = page.frameLocator('iframe');
  await embedded.getByRole('combobox', { name: '合成資料開發身分', exact: true }).selectOption('dev-site-a');
  await embedded.getByRole('spinbutton', { name: '體重（必填）', exact: true }).fill('65');
  await embedded.getByRole('spinbutton', { name: '身高（必填）', exact: true }).fill('170');
  await embedded.getByRole('button', { name: '驗證並送出', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '平台已保存' }).waitFor();
  const context = await call(`occurrences/${occurrence.id}/context`, 'dev-site-a');
  const response = await call(`responses/${context.response.id}`, 'dev-site-a');
  if (response.state !== 'submitted' || Math.abs(response.data.bmi - 22.49134948) > 0.001) throw new Error('嵌入資料與後端計算結果不一致');
  await page.screenshot({ path: 'output/playwright/platform-20261028/mvp-embedded.png', fullPage: true });
  await page.goto(new URL('/platform.html', page.url()).href);
  await selectActor('dev-reviewer');
  await page.getByRole('button', { name: '03資料收集', exact: true }).click();
  await page.getByRole('textbox', { name: '操作／更正理由', exact: true }).fill('MVP 獨立審閱');
  await page.getByRole('button', { name: '確認審閱', exact: true }).click();
  await page.getByRole('button', { name: '鎖定資料', exact: true }).click();
  await page.getByRole('button', { name: '06資料查核與匯出', exact: true }).click();
  await page.getByRole('textbox', { name: '匯出理由', exact: true }).fill('MVP 合成資料驗收');
  await page.getByRole('button', { name: '建立匯出快照', exact: true }).click();
  await page.getByRole('button', { name: '下載 JSON 快照', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/platform-20261028/mvp-reviewed-export.png', fullPage: true });
  return { studyId: study.id, occurrenceId: occurrence.id, responseId: response.id, completedAt: new Date().toISOString(), status: 'passed', checks: ['icf-draft-independent-approval', 'consent-basis-confirmation', 'embedded-form-save-and-server-computation', 'parent-origin-message', 'review-lock-export'] };
}
