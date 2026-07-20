import { stringify } from "yaml";
import type { CrfContract } from "../types";
import type { ProgramYaml } from "./model";

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function standaloneHtml(contract: CrfContract): string {
  const title = contract["x-airwayai"].title["zh-TW"] ?? contract.title ?? "eCRF";
  const schema = escapeScriptJson(contract);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23087f75'/%3E%3Cpath d='M18 47 29 16h7l11 31h-8l-2-7H27l-2 7Zm11-14h6l-3-10Z' fill='white'/%3E%3C/svg%3E">
  <title>${title.replaceAll("<", "&lt;")}</title>
  <style>
    :root{font-family:Inter,"Noto Sans TC",system-ui,sans-serif;color:#173044;background:#eef4f6}*{box-sizing:border-box}
    body{margin:0}.bar{background:#123b57;color:#fff;padding:18px 24px}.bar strong{font-size:18px}.bar span{display:block;font-size:12px;opacity:.76;margin-top:4px}
    main{max-width:900px;margin:28px auto;padding:0 20px}.notice{padding:14px 16px;border:1px solid #e2c368;background:#fff9df;border-radius:10px;margin-bottom:18px}
    section{background:#fff;border:1px solid #d8e2e8;border-radius:14px;padding:24px;box-shadow:0 8px 24px rgba(20,52,70,.07)}h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:0 0 18px}.sub{color:#5b7180;margin:0 0 24px}.field{margin:0 0 22px}.field label,.field legend{display:block;font-weight:650;margin-bottom:7px}.field input:not([type=checkbox]):not([type=radio]),.field select,.field textarea{width:100%;min-height:44px;border:1px solid #bccbd3;border-radius:9px;padding:10px 12px;font:inherit}.field textarea{min-height:100px}.choices{display:flex;flex-wrap:wrap;gap:10px}.choice{border:1px solid #d2dde2;border-radius:9px;padding:10px 12px}.coding{font-size:12px;color:#456577;margin-top:7px}.required{color:#a93b32}.actions{display:flex;justify-content:flex-end;border-top:1px solid #e1e9ed;padding-top:20px}.actions button{border:0;border-radius:9px;background:#087f75;color:white;font-weight:700;padding:12px 18px;cursor:pointer}.actions button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #5ec9be;outline-offset:2px}
  </style>
</head>
<body>
  <header class="bar"><strong>AirwayAI coded eCRF</strong><span>${contract["x-airwayai"].formId} · ${contract["x-airwayai"].schemaVersion}</span></header>
  <main>
    <div class="notice">這是離線審查用 Demo。請勿輸入直接識別資訊；臨床與 CDISC 正確性仍須由授權人員確認。</div>
    <section><h1>${title.replaceAll("<", "&lt;")}</h1><p class="sub">${(contract.description ?? "").replaceAll("<", "&lt;")}</p><form id="form"><div id="fields"></div><div class="actions"><button type="submit">下載 coded submission JSON</button></div></form></section>
  </main>
  <script id="schema" type="application/json">${schema}</script>
  <script>
  const schema=JSON.parse(document.getElementById('schema').textContent);const ext=schema['x-airwayai'];const root=document.getElementById('fields');
  const text=v=>v?.['zh-TW']||Object.values(v||{})[0]||'';const key=p=>p.slice(1);const required=new Set(schema.required||[]);
  function codingText(config){const c=config.coding;if(!c)return '';if(c.status==='not-applicable')return 'CDISC：不適用 · '+text(c.rationale);return ['CDISC '+(c.model||''),c.domain&&c.variable?c.domain+'.'+c.variable:c.variable,c.codelist?.submissionValue,c.codelist?.ncitCode].filter(Boolean).join(' · ')}
  function render(path){const config=ext.fields[path],prop=schema.properties[key(path)],wrap=document.createElement('div');wrap.className='field';wrap.dataset.path=path;const id='f-'+key(path);const label=document.createElement('label');label.htmlFor=id;label.innerHTML=text(config.label)+(required.has(key(path))?' <span class="required">（必填）</span>':'');wrap.append(label);let input;
    if(config.widget==='textarea'){input=document.createElement('textarea')}else if(config.widget==='select'){input=document.createElement('select');input.append(new Option('請選擇',''));(config.options||[]).forEach(o=>input.append(new Option(text(o.label),String(o.value))))}else if(config.widget==='radio'){const box=document.createElement('div');box.className='choices';(config.options||[]).forEach((o,i)=>{const item=document.createElement('label');item.className='choice';const radio=document.createElement('input');radio.type='radio';radio.name=key(path);radio.value=String(o.value);radio.id=id+'-'+i;item.append(radio,' '+text(o.label));box.append(item)});input=box}else if(config.widget==='boolean'){input=document.createElement('input');input.type='checkbox'}else{input=document.createElement('input');input.type=config.widget==='date'?'date':(['number','integer'].includes(config.widget)?'number':'text');if(prop.minimum!=null)input.min=prop.minimum;if(prop.maximum!=null)input.max=prop.maximum;if(config.widget==='integer')input.step='1'}
    input.id=id;if(input.tagName!=='DIV'){input.name=key(path);input.required=required.has(key(path))}wrap.append(input);if(config.description){const d=document.createElement('div');d.className='coding';d.textContent=text(config.description);wrap.append(d)}const c=document.createElement('div');c.className='coding';c.textContent=codingText(config);wrap.append(c);root.append(wrap)}
  ext.layout.flatMap(s=>s.items).flatMap(i=>i.type==='group'?i.items:[i]).forEach(i=>render(i.path));
  document.getElementById('form').addEventListener('submit',event=>{event.preventDefault();const data={},fields={};Object.entries(ext.fields).forEach(([path,config])=>{const name=key(path),prop=schema.properties[name];let value;if(config.widget==='radio'){value=document.querySelector('input[name="'+name+'"]:checked')?.value}else{const el=document.querySelector('[name="'+name+'"]');if(!el)return;if(config.widget==='boolean')value=el.checked;else if(['number','integer'].includes(config.widget))value=el.value===''?undefined:Number(el.value);else value=el.value||undefined}if(value!==undefined){data[name]=value;if(config.coding){const entry={mapping:config.coding};const option=(config.options||[]).find(o=>String(o.value)===String(value));if(option?.coding)entry.selectedTerms=[option.coding];fields[path]=entry}}});const payload={formId:ext.formId,schemaVersion:ext.schemaVersion,contractVersion:ext.contractVersion,rendererVersion:'studio-standalone-1.0.0',locale:'zh-TW',data,derivedPaths:[],coding:{standard:'CDISC',fields}};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=ext.formId+'-submission.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
  </script>
</body>
</html>`;
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function programToYaml(program: ProgramYaml): string {
  return stringify(program, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" });
}

export function downloadText(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function downloadBundle(program: ProgramYaml, contract: CrfContract): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const yaml = programToYaml(program);
  const json = `${JSON.stringify(contract, null, 2)}\n`;
  const html = standaloneHtml(contract);
  const schemaPath = `forms/${contract["x-airwayai"].formId}/${contract["x-airwayai"].schemaVersion}/crf-schema.json`;
  const manifest = {
    projectId: program.project_id,
    formId: contract["x-airwayai"].formId,
    schemaVersion: contract["x-airwayai"].schemaVersion,
    generatedAt: new Date().toISOString(),
    source: {
      fileName: program.source.file_name,
      sha256: program.source.sha256,
    },
    artifacts: [
      { path: "analysis/program.yaml", sha256: await sha256(yaml) },
      { path: schemaPath, sha256: await sha256(json) },
      { path: "preview.html", sha256: await sha256(html) },
    ],
  };
  const readme = `# ${program.selected_form.title}\n\n` +
    `- Project: ${program.project_id}\n- Form: ${contract["x-airwayai"].formId}\n- Schema: ${contract["x-airwayai"].schemaVersion}\n\n` +
    `直接開啟 preview.html 可進行離線審查與下載 coded submission。正式 Renderer 驗證請在 repository/template/crf 執行：\n\n` +
    `AIRWAYAI_CRF_SCHEMA_PATH=${schemaPath} npm run build\n\n` +
    `此包僅供 Demo／研究設計審查，不代表臨床正確性、法規提交適用性或 QMS 驗證完成。\n`;

  const zip = new JSZip();
  zip.file("analysis/program.yaml", yaml);
  zip.file(schemaPath, json);
  zip.file("preview.html", html);
  zip.file("artifact-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  zip.file("README.md", readme);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${contract["x-airwayai"].formId}-${contract["x-airwayai"].schemaVersion}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
