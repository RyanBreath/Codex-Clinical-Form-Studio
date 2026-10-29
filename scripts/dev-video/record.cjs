const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium } = require(path.join(process.env.TEMP, 'clinical-mvp-video-tools/node_modules/playwright'));
const root = process.cwd(), out = path.join(root,'output/video/dev-20261029');
const script = JSON.parse(fs.readFileSync(path.join(out,'script.json'),'utf8'));
const environment = JSON.parse(fs.readFileSync(path.join(out,'capture-env.json'),'utf8').replace(/^\uFEFF/,''));
const base = environment.baseUrl;
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const escaped = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const json = value => JSON.stringify(value,null,2);
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const snippet = (file,begin,end) => { const value = source(file); const start = value.indexOf(begin); if(start<0)throw Error('Missing source anchor'); const stop = value.indexOf(end,start+begin.length); return value.slice(start,stop<0 ? start+700 : stop).trim(); };
const traces = [];
async function call(route, actor='dev-operator', data, options={}) {
  const method = options.method ?? (data === undefined ? 'GET' : 'POST');
  const headers = {'X-Development-User':actor,...(data!==undefined ? {'Content-Type':'application/json'} : {}),...(options.key ? {'Idempotency-Key':options.key} : {})};
  const response = await fetch(base+'/api'+route,{method,headers,...(data!==undefined ? {body:json(data)} : {})});
  const result = await response.json();
  const trace={sequence:traces.length+1,recordedAt:new Date().toISOString(),method,path:'/api'+route,authentication:'Development synthetic identity; NOT production Bearer',actor,headers,request:data??null,status:response.status,response:result};
  traces.push(trace); fs.writeFileSync(path.join(out,'api-evidence.json'),json(traces));
  if(options.status && response.status!==options.status)throw Error(`${route}: expected ${options.status}, received ${response.status}: ${json(result)}`);
  if(!options.status && !response.ok)throw Error(`${route}: ${response.status}: ${json(result)}`);
  return {value:result,trace};
}
function panel(label,body,kind='') { return `<section class="pane ${kind}"><h2>${escaped(label)}</h2>${body}</section>`; }
function code(value) { return `<pre>${escaped(typeof value==='string'?value:json(value))}</pre>`; }
function note(value) { return `<div class="note">${escaped(value)}</div>`; }
function table(rows) { return '<table>'+rows.map(row=>'<tr>'+row.map((cell,i)=>`<${i?'td':'th'}>${escaped(cell)}</${i?'td':'th'}>`).join('')+'</tr>').join('')+'</table>'; }
function evidence(trace,requestOverride,responseOverride) {
  return `<div class="request-line"><span>${escaped(trace.method)}</span> ${escaped(trace.path)}</div><div class="grid">${panel('REQUEST / 合成身分實錄',code(requestOverride??{...(trace.headers['Idempotency-Key']?{'Idempotency-Key':trace.headers['Idempotency-Key']} : {}),body:trace.request}))}${panel(`RESPONSE / HTTP ${trace.status}`,code(responseOverride??trace.response))}</div>`;
}
(async()=>{
  if(new URL(base).port!=='5199' || !/^formplatform_capture_[a-f0-9]{32}$/.test(environment.database))throw Error('Isolated environment required');
  const runtime=(await call('/runtime')).value; if(!runtime.syntheticOnly||!runtime.developmentIdentity)throw Error('Synthetic guard failed');
  const study=(await call('/studies','dev-operator',{code:'DEV-VIDEO-20261029',name:'CTMS 技術介接合成研究'})).value;
  const site=(await call(`/studies/${study.id}/sites`,'dev-operator',{code:'SITE-A',name:'介接示範甲院'})).value;
  const siteB=(await call(`/studies/${study.id}/sites`,'dev-operator',{code:'SITE-B',name:'介接示範乙院'})).value;
  const users=(await call('/users')).value;
  for(const [name,permissions,siteId,crossSite] of [['表單設計者',258,null,false],['獨立核准／審閱者',884,null,true],['甲院研究人員',264,site.id,false],['乙院研究人員',264,siteB.id,false],['CTMS 合成整合程式',1288,site.id,false]])
    await call(`/studies/${study.id}/grants`,'dev-operator',{userId:users.find(user=>user.name===name).id,permissions,siteId,crossSite,reason:'獨立技術錄製環境合成授權'});
  await call(`/studies/${study.id}/policy`,'dev-operator',{expectedRevision:study.revision,contextAuthority:'ctms',icfCustody:'site',requiredMappings:[],active:true,reason:'指定 CTMS 維護脈絡'},{method:'PUT'});
  const template=(await call(`/studies/${study.id}/templates`,'dev-designer',{name:'介接生命徵象',kind:'ecrf'})).value;
  const contract=JSON.parse(source('template/data-dictionaries/platform-vitals.json'));
  let version=(await call(`/templates/${template.id}/versions`,'dev-designer',{version:'1.0.0',contract,sourceYaml:''})).value;
  version=(await call(`/form-versions/${version.id}/submit`,'dev-designer',{expectedRevision:version.revision,reason:'合成範例送審'})).value;
  version=(await call(`/form-versions/${version.id}/publish`,'dev-reviewer',{expectedRevision:version.revision,reason:'獨立核准合成範例'})).value;
  const adoption=(await call(`/studies/${study.id}/adoptions`,'dev-reviewer',{formVersionId:version.id,maximumOccurrences:1,reason:'介接示範固定版本'})).value;
  const bearerTrx=source('output/video/dev-20261029/test-evidence/bearer-technical.trx');
  if(!bearerTrx.includes('outcome="Passed"'))throw Error('Bearer test evidence missing');
  const bearerProof={test:'Signed_service_tokens_validate_issuer_audience_and_account_revocation',outcome:'Passed',checkedAt:new Date().toISOString(),source:'tests/FormPlatform.IntegrationTests/BearerAuthenticationTests.cs',assertions:[{case:'wrong audience',expected:401},{case:'wrong issuer',expected:401},{case:'valid signed token / registered account',expected:'200 me'},{case:'Bearer POST without CSRF reaches resource authorization',expected:404},{case:'account disabled with still-valid token',expected:403}],scope:'Locally signed RSA token; no live external IdP integration claimed'};
  fs.writeFileSync(path.join(out,'bearer-test-summary.json'),json(bearerProof));
  let subject,visit,occurrence,response,revisions,exportInfo;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:path.join(out,'raw'),size:{width:1920,height:1080}},locale:'zh-TW',timezoneId:'Asia/Taipei'});
  const page=await context.newPage(); page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const start=performance.now(), shots=[]; const clock=()=> (performance.now()-start)/1000;
  async function screen(title,content,label='SOURCE WALKTHROUGH / 原始碼與架構') {
    await page.setContent(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f6f8fb;color:#29354a;font-family:'Microsoft JhengHei',sans-serif}.wrap{padding:42px 64px 115px}.meta{font:19px Consolas;color:#315fce;letter-spacing:1px}h1{font-size:43px;letter-spacing:-1px;line-height:1.4;margin:14px 0 24px}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.pane{min-width:0;border:1px solid #d7deea;border-radius:8px;padding:22px;background:white}h2{font-size:22px;margin:0 0 15px;color:#52647f}pre{font:23px/1.55 Consolas,'Microsoft JhengHei',monospace;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}.small pre{font-size:20px}.note{font-size:23px;line-height:1.65;background:#edf2fc;border-left:4px solid #315fce;padding:16px 20px;margin-top:20px}.request-line{font:22px/1.5 Consolas;margin-bottom:16px;overflow-wrap:anywhere}.request-line span{display:inline-block;background:#315fce;color:white;border-radius:4px;padding:3px 10px}.flow{display:flex;align-items:center;gap:18px;margin:26px 0}.node{flex:1;text-align:center;border:1px solid #cbd6e9;background:white;border-radius:8px;padding:25px 12px;font-size:29px;line-height:1.6}.arrow{font-size:30px;color:#315fce}.sub{font-size:20px;color:#63758f}.big{font-size:33px;line-height:1.9}.chips{display:flex;gap:12px;flex-wrap:wrap}.chips span{border:1px solid #d2def2;border-radius:6px;padding:10px 14px;font:23px Consolas;background:white}table{width:100%;border-collapse:collapse;font-size:23px;line-height:1.65}th,td{text-align:left;padding:12px;border-bottom:1px solid #e1e6ef}th{width:37%;font-weight:500;color:#31578f}.compact table{font-size:20px}#live{min-height:700px}</style><main class="wrap"><div class="meta">CLINICAL FORM / DEVELOPER GUIDE · ${escaped(label)}</div><h1>${escaped(title)}</h1>${content}</main></html>`);
  }
  async function shot(index,work) {
    const item=script.shots[index],begin=clock(); console.log('Recording '+item.id);
    await work();
    const target=Math.max(item.audioDuration+1.4,index===0?24:36);
    if(clock()-begin<target)await wait((target-(clock()-begin))*1000);
    const end=clock(); shots.push({...item,start:begin,end,duration:end-begin});
    fs.writeFileSync(path.join(out,'recording-progress.json'),json({shots,errors}));
  }
  try {
    await shot(0,async()=>{
      await screen(script.title,panel('工程師會看到什麼',`<div class="big">系統架構與權威資料<br>可信身分、研究與院所授權<br>真實 API 請求、去重與修訂衝突<br>固定版本、嵌入通訊與部署邊界</div>`)+note('全程合成資料／獨立 5199 環境；無有效 token、Cookie 或機密憑證。'),'TECHNICAL WALKTHROUGH / 開發介接篇');
    });
    await shot(1,async()=>{
      const flow='<div class="flow"><div class="node">CTMS／平台入口<br><span class="sub">React / 嵌入 renderer</span></div><span class="arrow">→</span><div class="node">ASP.NET Core API<br><span class="sub">Access + ResponseWriter</span></div><span class="arrow">→</span><div class="node">PostgreSQL<br><span class="sub">資料／修訂／授權</span></div></div>';
      await screen('01 / 入口共用驗證，正式資料由平台保存',flow+'<div class="grid">'+panel('共用契約與呈現',code('template/data-dictionaries/\n  crf-contract.meta-schema.json\n\ntemplate/crf/src/\n  FormRenderer.tsx\n  platform/EmbeddedForm.tsx'))+panel('後端責任邊界',code('backend/FormPlatform.Api/\n  Core/Access.cs\n  Modules/ContractEngine.cs\n  Modules/ResponseWriter.cs\n  Data/PlatformDb.cs'))+'</div>'+note('交易內：填答 + ResponseRevision + Audit + Outbox。Outbox 事件派送尚未交付。'));
      await wait(19000);
      await screen('Serializable 交易：成功才提交',panel('Core/WriteTransactionFilter.cs · 實際來源片段',code(snippet('backend/FormPlatform.Api/Core/WriteTransactionFilter.cs','await using var transaction','\n    }')))+note('此處是程式碼走讀，不代表資料庫管理員層級的不可竄改部署已完成。'));
    });
    await shot(2,async()=>{
      await screen('02 / 平台 ID、外部代碼與修訂號各有用途','<div class="flow"><div class="node">Study → Site<br><span class="sub">研究與院所範圍</span></div><span class="arrow">→</span><div class="node">Subject → Visit<br><span class="sub">CTMS 可維護脈絡</span></div><span class="arrow">→</span><div class="node">Occurrence<br><span class="sub">一個應收表單次別</span></div></div>'+table([['Adoption','研究明確採用 FormVersion；固定 contentHash'],['Response','一個次別的填答；關聯固定 FormVersion'],['Revision','同一份填答的修訂；expectedRevision 控制變更'],['ExternalIdentifierMapping','sourceSystem + study/site + entityType + externalId'],['Idempotency-Key','一次寫入命令；不是 subject ID，也不是 revision']])+note('研究 contextAuthority = ctms；正式填答與修訂仍保存在本平台。'));
    });
    await shot(3,async()=>{
      await screen('03 / 認證成功，仍需研究與院所授權','<div class="grid">'+panel('瀏覽器',code('OIDC Code + PKCE\n  → Secure / HttpOnly Cookie\n  → mutation: X-CSRF-Token\n  → Access.Require(study, permission, site)'))+panel('服務帳號',code('Authorization: Bearer <redacted>\n  → issuer + audience + signature\n  → explicit issuer|subject account\n  → integrationSource binding\n  → Integrate + Collect (+ Read)'))+'</div>'+note('正式 Bearer 驗證與下段 Development API 實錄分開；token 不攜帶自動授權。'));
      await wait(16000);
      await screen('Bearer 驗證：本次實際測試結果',panel('BearerAuthenticationTests.cs · 本次測試 Passed',table(bearerProof.assertions.map(row=>[row.case,String(row.expected)])))+note('使用本機 RSA 簽章及固定 issuer 設定進行 middleware 整合測試；不是已完成外部 IdP 聯調。'),'EXECUTED TEST / 實際測試證據');
    });
    await shot(4,async()=>{
      await screen('04 / 建立 CTMS 受試者對應',note('正在向獨立錄製環境實際送出請求…'),'LIVE API / Development 合成身分');
      const created=await call(`/integrations/studies/${study.id}/subjects`,'dev-ctms',{siteId:site.id,externalId:'CTMS-SUB-001',code:'SYNTH-DEV-001'},{key:'dev-subject-001'});subject=created.value;
      await screen('CTMS 建檔：來源由帳號綁定',evidence(created.trace)+note('source = ctms-demo；外部代碼與平台 UUID 分開，不以姓名或病歷號作 ID。'),'LIVE API / Development 合成身分');
      await wait(12500);
      const createdVisit=await call('/integrations/visits','dev-ctms',{subjectId:subject.id,externalId:'CTMS-VISIT-001',name:'初次介接訪視',date:new Date().toISOString().slice(0,10),unscheduled:true},{key:'dev-visit-001'});visit=createdVisit.value;
      await screen('外部訪視對應：POST /api/integrations/visits',evidence(createdVisit.trace),'LIVE API / Development 合成身分');
      await wait(9000);
      const blocked=await call(`/subjects/${subject.id}/visits`,'dev-site-a',{name:'不應手動建立',date:new Date().toISOString().slice(0,10),unscheduled:true},{status:422});
      await screen('避免雙方維護：平台手動建檔被拒絕',evidence(blocked.trace)+note('依 response.code = CTMS_AUTHORITY 判斷；不是連線中斷，不能盲目重試。'),'LIVE API / Development 合成身分');
    });
    await shot(5,async()=>{
      const blocked=await call(`/visits/${visit.id}/occurrences`,'dev-site-a',{adoptionId:adoption.id,number:1},{status:409});
      await screen('05 / 先核准表單，再確認收集依據',evidence(blocked.trace)+note('已發布版本與採用設定已在鏡頭外準備；此刻依據尚未確認，所以拒絕建立次別。'),'LIVE API / Development 合成身分');
      await wait(11000);
      const basis=(await call(`/subjects/${subject.id}/collection-bases`,'dev-site-a',{kind:'waiver',reference:'SYNTH-WAIVER-001 合成免同意依據',purpose:'research'})).value;
      await call(`/collection-bases/${basis.id}/confirm`,'dev-reviewer',{expectedRevision:basis.revision,reason:'核對合成用途與範圍'});
      occurrence=(await call(`/visits/${visit.id}/occurrences`,'dev-site-a',{adoptionId:adoption.id,number:1})).value;
      const form=await call(`/occurrences/${occurrence.id}/form`,'dev-ctms');
      const ctx=await call(`/occurrences/${occurrence.id}/context`,'dev-ctms');
      const wrong=await call(`/occurrences/${occurrence.id}/context`,'dev-site-b',undefined,{status:404});
      await screen('讀取固定契約與次別脈絡',evidence(form.trace,{method:'GET',context:'/api/occurrences/{id}/context',actor:'dev-ctms / scoped Read'}, {id:form.value.id,version:form.value.version,contentHash:form.value.contentHash,contract:{'x-airwayai':{formId:'vitals',schemaVersion:'1.0.0'},properties:{weight:{type:'number'},height:{type:'number'},bmi:{readOnly:true}}}})+note(`實際 context.canCollect = ${ctx.value.canCollect}；乙院讀取甲院相同次別：HTTP ${wrong.trace.status}。`),'LIVE API / 回應摘錄，完整證據另存');
    });
    await shot(6,async()=>{
      const created=await call('/integrations/responses','dev-ctms',{occurrenceId:occurrence.id,externalRecordId:'CTMS-RESPONSE-001',data:{weight:65,height:170,bmi:999}},{key:'dev-response-create-001'});response=created.value;
      if(response.state!=='draft'||Math.abs(response.data.bmi-22.49134948)>.001)throw Error('Server computation or draft assertion failed');
      await screen('06 / 寫入填答：後端重新計算',evidence(created.trace,{headers:{'Idempotency-Key':'dev-response-create-001'},body:created.trace.request},{id:response.id,state:response.state,revision:response.revision,data:response.data})+note('建立的是 draft。source 從整合帳號取得；bmi: 999 被伺服器重算。'),'LIVE API / Development 合成身分');
      await wait(16000);
      const read=await call(`/responses/${response.id}`,'dev-ctms');
      await screen('同一份正式保存資料：GET /api/responses/{id}',evidence(read.trace)+note('讀取需要 Read。成功建立草稿不等於已 submit／review／lock。'),'LIVE API / Development 合成身分');
    });
    await shot(7,async()=>{
      const payload={occurrenceId:occurrence.id,externalRecordId:'CTMS-RESPONSE-001',data:{weight:65,height:170,bmi:999}};
      const replay=await call('/integrations/responses','dev-ctms',payload,{key:'dev-response-create-001'});
      if(replay.value.id!==response.id||replay.value.revision!==1)throw Error('Idempotent replay failed');
      await screen('07 / 同 key、同內容：回傳原結果',evidence(replay.trace,{key:'dev-response-create-001',body:payload},{id:replay.value.id,revision:replay.value.revision,state:replay.value.state})+note('實際比對：response ID 相同、revision 仍是 1，沒有重複建檔。'),'LIVE API / Development 合成身分');
      await wait(12000);
      const mismatch=await call('/integrations/responses','dev-ctms',{...payload,data:{weight:66,height:170}},{key:'dev-response-create-001',status:409});
      await screen('相同去重識別，不能換另一個命令',evidence(mismatch.trace)+note('真正需要更正時，使用 PUT 更正端點、新 key、最新 expectedRevision 與 reason。'),'LIVE API / Development 合成身分');
      await wait(11000);
      const bypass=await call(`/responses/${response.id}`,'dev-ctms',{expectedRevision:1,data:{weight:66,height:170},reason:'不能繞過整合端點'},{method:'PUT',status:422});
      const receipt=await call('/integrations/receipts/dev-response-create-001','dev-ctms');
      await screen('來源不能繞過；收據只提供 metadata','<div class="grid">'+panel('一般 portal 更新路由 → HTTP 422',code({code:bypass.value.code,title:bypass.value.title}))+panel('去重收據 metadata',code(receipt.value))+'</div>'+note('外部帳號必須使用 integrations 路由；收據查詢不回傳過去的完整填答快照。'),'LIVE API / 實際回應摘錄');
    });
    await shot(8,async()=>{
      const correction={expectedRevision:response.revision,externalRecordId:'CTMS-RESPONSE-001',data:{weight:66,height:170},reason:'來源系統更正合成體重'};
      const changed=await call(`/integrations/responses/${response.id}`,'dev-ctms',correction,{method:'PUT',key:'dev-correction-001'});response=changed.value;
      await screen('08 / 更正需修訂號、來源與理由',evidence(changed.trace,{headers:{'Idempotency-Key':'dev-correction-001'},body:correction},{id:response.id,revision:response.revision,state:response.state,data:response.data}),'LIVE API / Development 合成身分');
      await wait(11000);
      const stale=await call(`/integrations/responses/${response.id}`,'dev-ctms',{...correction,expectedRevision:1},{method:'PUT',key:'dev-correction-stale',status:409});
      await screen('過時修訂：409 REVISION_CONFLICT',evidence(stale.trace)+note('先 GET 最新資料、比對差異；不要將預期修訂號無條件替換後覆寫。'),'LIVE API / Development 合成身分');
      await wait(10500);
      for(const [operation,actor] of [['submit','dev-site-a'],['review','dev-reviewer'],['lock','dev-reviewer']])
        response=(await call(`/responses/${response.id}/${operation}`,actor,{expectedRevision:response.revision,reason:'合成流程 '+operation})).value;
      const locked=await call(`/integrations/responses/${response.id}`,'dev-ctms',{...correction,expectedRevision:response.revision},{method:'PUT',key:'dev-correction-locked',status:422});
      revisions=(await call(`/responses/${response.id}/revisions`,'dev-reviewer')).value;
      await screen('鎖定拒絕與錯誤分類', '<div class="grid">'+panel(`鎖定後更正 → HTTP ${locked.trace.status}`,code({code:locked.value.code,title:locked.value.title,currentRevision:response.revision}))+panel('依錯誤碼決定處理方式',table([['REVISION_CONFLICT','讀最新、比較差異'],['IDEMPOTENCY_MISMATCH','修正 key／命令設計'],['TRANSACTION_CONFLICT','有限次重試同一命令'],['422 規則／狀態錯誤','修正內容或完成授權流程']]))+'</div>'+note(`實際保存 ${revisions.length} 筆修訂；第一筆 source = ${revisions[0].source}，externalRecordId = ${revisions[0].externalRecordId}。`),'LIVE API / 實際拒絕與修訂證據');
    });
    await shot(9,async()=>{
      await page.goto(base+'/platform.html?integration-demo=1');
      await page.getByRole('textbox',{name:'表單次別 ID',exact:true}).fill(occurrence.id);
      await page.getByRole('button',{name:'開啟嵌入表單',exact:true}).click();
      const frame=page.frameLocator('iframe');
      await frame.getByRole('combobox',{name:'合成資料開發身分',exact:true}).selectOption('dev-reviewer');
      await frame.getByText('已鎖定',{exact:false}).first().waitFor();
      await page.getByRole('status').filter({hasText:'表單已開啟'}).waitFor();
      await page.screenshot({path:path.join(out,'embedded-live.png')});
      await wait(12000);
      const csp=await fetch(base+'/platform.html').then(res=>res.headers.get('content-security-policy'));
      const originCode=snippet('template/crf/src/platform/EmbeddedForm.tsx','if (event.origin','\n  }; window.addEventListener');
      await screen('09 / 嵌入通訊：四項檢查缺一不可',panel('EmbeddedForm.tsx · 實際來源片段',code(originCode),'small')+note(`實際 CSP：${csp}\nURL 只帶 occurrence 與 parentOrigin，不能帶 token；跨站 Cookie／SSO 仍需聯調。`),'SOURCE + LIVE / 同源嵌入已實錄');
    });
    await shot(10,async()=>{
      exportInfo=(await call(`/studies/${study.id}/exports`,'dev-reviewer',{purpose:'research',reason:'開發介接教學合成快照'})).value;
      const exported=(await call(`/exports/${exportInfo.id}`,'dev-reviewer')).value;
      const row=exported.records[0];
      if(row.revision!==response.revision||row.state!=='locked')throw Error('Export revision mismatch');
      const backupFiles=fs.readdirSync(path.join(root,'.platform-data/backups')).filter(name=>name.endsWith('.report.json')).sort();
      const backups=backupFiles.map(name=>JSON.parse(source('.platform-data/backups/'+name))).filter(report=>report.status==='restored-and-queried-local-copy');
      const backup=backups.at(-1);
      await screen('10 / 固定匯出修訂與復原範圍','<div class="grid">'+panel('本次實際匯出證據',code({exportId:exportInfo.id,count:exportInfo.count,contentHash:exportInfo.contentHash,record:{responseId:row.responseId,revision:row.revision,state:row.state}}),'small')+panel('既有本機還原演練報告',code({status:backup?.status,restoredAt:backup?.restoredAt,restoredCounts:backup?.restoredCounts,scope:backup?.scope}),'small')+'</div>'+note('匯出與還原報告是不同時間的證據；還原僅涵蓋資料庫，不含附件、IdP、Data Protection 金鑰。'),'LIVE API + EXISTING REPORT / 範圍明確區分');
      await wait(17000);
      await screen('介接交付清單與尚待完成範圍','<div class="grid">'+panel('本機發行與試跑',code('npm run platform:db\nnpm run platform:package\nnpm run platform:mvp\n\n正式：OIDC / HTTPS / key persistence\n研究授權 / 資料政策 / 上線驗收'))+panel('目前邊界',table([['匯出','同步 JSON，最多 1000 筆'],['嵌入','同源已驗證；跨站待聯調'],['事件','Outbox 已保存；派送未交付'],['附件／CBCT','尚未完成實際串接'],['AI','依使用者決定延後']]))+'</div>'+note('影片、SRT、章節表與可重跑的合成 API 範例一併本機交付；不代表正式系統上線。'));
    });
    fs.writeFileSync(path.join(out,'scenario-result.json'),json({status:'passed',studyId:study.id,subjectId:subject.id,visitId:visit.id,occurrenceId:occurrence.id,responseId:response.id,responseRevision:response.revision,responseState:response.state,exportId:exportInfo.id,recordedApiRequests:traces.length,bearerTest:'passed'}));
  } finally {
    await context.close(); await page.video().saveAs(path.join(out,'DEV1.webm')); await browser.close();
    fs.writeFileSync(path.join(out,'recording.json'),json({shots,errors,elapsed:clock(),source:script.source,apiEvidence:'api-evidence.json',environment:{baseUrl:base,database:environment.database}}));
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
