// Fully synthetic, repeatable API demonstration. Never accepts production credentials.
// Run after starting scripts/dev-video/start-capture.ps1 in its own terminal.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('output/video/dev-20261029');
const config=JSON.parse(fs.readFileSync(path.join(out,'capture-env.json'),'utf8').replace(/^\uFEFF/,''));
if(config.baseUrl!=='http://127.0.0.1:5199'||config.databaseRemoved||!/^formplatform_capture_[a-f0-9]{32}$/.test(config.database))throw Error('Requires a fresh isolated capture environment, not the 5198 MVP');
const evidence=[];
const runKey=crypto.randomUUID();
async function api(route,actor='dev-operator',body,options={}) {
  const commandKey=options.key ? `${runKey}:${options.key}` : undefined;
  const method=options.method??(body===undefined?'GET':'POST');
  const response=await fetch(config.baseUrl+'/api'+route,{method,headers:{'X-Development-User':actor,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(commandKey?{'Idempotency-Key':commandKey}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const value=await response.json();
  evidence.push({method,path:'/api'+route,actor,idempotencyKey:commandKey??null,request:body??null,status:response.status,response:value});
  assert.equal(response.status,options.status??200,`${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
const runtime=await api('/runtime');assert.equal(runtime.syntheticOnly,true);assert.equal(runtime.developmentIdentity,true);
const study=await api('/studies','dev-operator',{code:`SYNTH-API-${Date.now()}`,name:'API 可重跑合成研究'});
const site=await api(`/studies/${study.id}/sites`,'dev-operator',{code:'A',name:'合成甲院'});
const users=await api('/users');
for(const [name,permissions,siteId,crossSite] of [['表單設計者',258,null,false],['獨立核准／審閱者',884,null,true],['甲院研究人員',264,site.id,false],['CTMS 合成整合程式',1288,site.id,false]])
  await api(`/studies/${study.id}/grants`,'dev-operator',{userId:users.find(user=>user.name===name).id,permissions,siteId,crossSite,reason:'合成介接範例'});
await api(`/studies/${study.id}/policy`,'dev-operator',{expectedRevision:study.revision,contextAuthority:'ctms',icfCustody:'site',requiredMappings:[],active:true,reason:'外部脈絡來源'},{method:'PUT'});
const subject=await api(`/integrations/studies/${study.id}/subjects`,'dev-ctms',{siteId:site.id,externalId:'EXTERNAL-SUB-001',code:'SYNTH-001'},{key:'subject-001'});
const visit=await api('/integrations/visits','dev-ctms',{subjectId:subject.id,externalId:'EXTERNAL-VISIT-001',name:'初次訪視',date:new Date().toISOString().slice(0,10),unscheduled:true},{key:'visit-001'});
const template=await api(`/studies/${study.id}/templates`,'dev-designer',{name:'生命徵象',kind:'ecrf'});
const contract=JSON.parse(fs.readFileSync('template/data-dictionaries/platform-vitals.json','utf8'));
let version=await api(`/templates/${template.id}/versions`,'dev-designer',{version:'1.0.0',contract,sourceYaml:''});
version=await api(`/form-versions/${version.id}/submit`,'dev-designer',{expectedRevision:version.revision,reason:'合成送審'});
version=await api(`/form-versions/${version.id}/publish`,'dev-reviewer',{expectedRevision:version.revision,reason:'合成獨立核准'});
const adoption=await api(`/studies/${study.id}/adoptions`,'dev-reviewer',{formVersionId:version.id,maximumOccurrences:1,reason:'採用固定版本'});
await api(`/visits/${visit.id}/occurrences`,'dev-site-a',{adoptionId:adoption.id,number:1},{status:409});
const basis=await api(`/subjects/${subject.id}/collection-bases`,'dev-site-a',{kind:'waiver',reference:'SYNTH-WAIVER-001',purpose:'research'});
await api(`/collection-bases/${basis.id}/confirm`,'dev-reviewer',{expectedRevision:basis.revision,reason:'核對合成依據'});
const occurrence=await api(`/visits/${visit.id}/occurrences`,'dev-site-a',{adoptionId:adoption.id,number:1});
await api(`/occurrences/${occurrence.id}/form`,'dev-ctms');
const body={occurrenceId:occurrence.id,externalRecordId:'EXTERNAL-RESPONSE-001',data:{weight:65,height:170,bmi:999}};
let response=await api('/integrations/responses','dev-ctms',body,{key:'response-001'});
assert.ok(Math.abs(response.data.bmi-22.49134948)<.001);assert.equal(response.state,'draft');
const replay=await api('/integrations/responses','dev-ctms',body,{key:'response-001'});assert.equal(replay.id,response.id);assert.equal(replay.revision,1);
const mismatch=await api('/integrations/responses','dev-ctms',{...body,data:{weight:66,height:170}},{key:'response-001',status:409});assert.equal(mismatch.code,'IDEMPOTENCY_MISMATCH');
const correction={expectedRevision:response.revision,externalRecordId:body.externalRecordId,data:{weight:66,height:170},reason:'來源系統合成更正'};
response=await api(`/integrations/responses/${response.id}`,'dev-ctms',correction,{method:'PUT',key:'correct-001'});
const stale=await api(`/integrations/responses/${response.id}`,'dev-ctms',correction,{method:'PUT',key:'correct-stale',status:409});assert.equal(stale.code,'REVISION_CONFLICT');
for(const [operation,actor] of [['submit','dev-site-a'],['review','dev-reviewer'],['lock','dev-reviewer']])
  response=await api(`/responses/${response.id}/${operation}`,actor,{expectedRevision:response.revision,reason:'合成流程 '+operation});
const locked=await api(`/integrations/responses/${response.id}`,'dev-ctms',{...correction,expectedRevision:response.revision},{method:'PUT',key:'correct-locked',status:422});assert.equal(locked.code,'RESPONSE_LOCKED');
const exportInfo=await api(`/studies/${study.id}/exports`,'dev-reviewer',{purpose:'research',reason:'合成範例匯出'});
const snapshot=await api(`/exports/${exportInfo.id}`,'dev-reviewer');assert.equal(snapshot.records[0].revision,response.revision);
const filename=path.join(out,`api-example-${Date.now()}.json`);fs.writeFileSync(filename,JSON.stringify({status:'passed',evidence},null,2));
console.log(`Synthetic example passed: ${evidence.length} HTTP requests. Evidence: ${filename}`);
