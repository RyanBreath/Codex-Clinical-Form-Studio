// Replace only an overflowing technical response view with a readable excerpt
// derived from the actual recorded HTTP response. Never invent API results.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.TEMP,'clinical-mvp-video-tools/node_modules/playwright'));
const out=path.resolve('output/video/dev-20261029');
const evidence=JSON.parse(fs.readFileSync(path.join(out,'api-evidence.json'),'utf8'));
const trace=evidence.find(item=>item.method==='GET'&&/\/occurrences\/[^/]+\/form$/.test(item.path));
if(!trace||trace.status!==200)throw Error('Missing actual contract response');
const value=trace.response;
const text=[
'{',`  "id": "${value.id}",`,`  "version": "${value.version}",`,
`  "contentHash": "${value.contentHash}",`, '  "contract": {',
`    "$id": "${value.contract.$id}",`, '    "properties": {',
`      "weight": ${JSON.stringify(value.contract.properties.weight)},`,
`      "height": ${JSON.stringify(value.contract.properties.height)},`,
`      "bmi": ${JSON.stringify(value.contract.properties.bmi)}`,
'    },','    "x-airwayai": {',`      "formId": "${value.contract['x-airwayai'].formId}",`,
`      "schemaVersion": "${value.contract['x-airwayai'].schemaVersion}"`,'    }','  }','}',
].join('\n');
const escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.setContent(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f6f8fb;color:#29354a;font-family:'Microsoft JhengHei',sans-serif;padding:42px 64px}small{font:19px Consolas;color:#315fce}h1{font-size:43px;line-height:1.4;margin:14px 0 24px}.grid{display:grid;grid-template-columns:540px 1fr;gap:24px}section{background:white;padding:22px;border:1px solid #d7deea;border-radius:8px}h2{font-size:22px;color:#52647f;margin:0 0 16px}pre{font:23px/1.5 Consolas,'Microsoft JhengHei',monospace;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.note{font-size:23px;line-height:1.6;border-left:4px solid #315fce;background:#edf2fc;padding:16px 20px;margin-top:18px}</style><small>CLINICAL FORM / DEVELOPER GUIDE · RECORDED HTTP RESPONSE / 實際回應摘錄</small><h1>讀取固定契約：欄位與版本一起固定</h1><div class="grid"><section><h2>GET ${escape(trace.path)}</h2><pre>Development: dev-ctms\n\nHTTP ${trace.status}\n\n固定版本：${escape(value.version)}\n\n依據、院所與 Read 授權\n仍由平台檢查。</pre></section><section><h2>RESPONSE / 保留實際階層的欄位摘錄</h2><pre>${escape(text)}</pre></section></div><div class="note">右側僅節錄實際回應中的版本、雜湊與部分契約欄位；完整 request／response 另附 api-evidence.json。</div></html>`);
 await page.screenshot({path:path.join(out,'contract-readable.png')});
 await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
