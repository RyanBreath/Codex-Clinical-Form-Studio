import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, P, selectDevelopmentUser, stateLabel, type Actor, type Adoption, type Basis, type Entity, type Grant, type Icf, type Occurrence, type ResponseRecord, type Site, type Study, type Subject, type Template, type Version, type Visit } from "./api";
import { contractForNewVersion } from "./versioning";
import { emptyContract, FormDesigner } from "./FormDesigner";
import { FormRenderer } from "../FormRenderer";
import { compileContract } from "../contract";
import { ResponseQueries } from "./ResponseQueries";
import { StudyOverview } from "./StudyOverview";
import { Reporting } from "./Reporting";
import { AccountAdministration } from "./AccountAdministration";
import { TemplateLibrary } from "./TemplateLibrary";
import { IcfWorkspace } from "./IcfWorkspace";
import { VersionComparison } from "./VersionComparison";
import { SessionControls } from "./SessionControls";
import type { CrfContract, FormSnapshot } from "../types";

type Run = (work: () => Promise<void>, success?: string) => Promise<void>;
interface WorkspaceProps { study: Study; actor: Actor; refresh: number; run: Run; busy: boolean }
function Badge({ state }: { state: string }) { return <span className={`badge state-${state}`}>{stateLabel[state] ?? state}</span>; }
function Empty({ children }: { children: ReactNode }) { return <div className="empty-state">{children}</div>; }
function ActionForm({ children, label, onSubmit, disabled = false }: { children: ReactNode; label: string; onSubmit: (data: FormData) => Promise<void>; disabled?: boolean }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; void onSubmit(new FormData(form)); };
  return <form className="stack" onSubmit={submit}><fieldset disabled={disabled}>{children}<button className="primary" type="submit">{label}</button></fieldset></form>;
}
function Input({ label, name, type = "text", required = true, value }: { label: string; name: string; type?: string; required?: boolean; value?: string }) { return <label>{label}<input name={name} type={type} required={required} defaultValue={value} maxLength={type === "text" ? 2000 : undefined} /></label>; }
function text(data: FormData, name: string) { return String(data.get(name) ?? ""); }

export function PlatformApp() {
  const [actor, setActor] = useState<Actor>(); const [studies, setStudies] = useState<Study[]>([]); const [studyId, setStudyId] = useState(() => new URLSearchParams(window.location.search).get("studyId") ?? "");
  const [tab, setTab] = useState("overview"); const [refresh, setRefresh] = useState(0); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [development, setDevelopment] = useState(false);
  const [accounts, setAccounts] = useState<{ subject: string; name: string }[]>([]); const [identity, setIdentity] = useState("dev-operator");
  const [authNeeded, setAuthNeeded] = useState(false);
  const [collectionFocus, setCollectionFocus] = useState<{ subjectId: string; visitId: string }>();
  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && ["HTTP_401", "LOGIN_REQUIRED"].includes(e.code)) { setActor(undefined); setStudies([]); setAuthNeeded(true); setError(""); return; }
    if (e instanceof ApiError && e.code === "ACCOUNT_NOT_AUTHORIZED") { setActor(undefined); setStudies([]); }
    setError(e instanceof ApiError ? `${e.message}${e.details ? " · " + JSON.stringify(e.details) : ""}（${e.code}）` : e instanceof Error ? e.message : "操作失敗。");
  }, []);
  const run: Run = async (work, success = "已儲存。") => { if (busy) return; setBusy(true); setError(""); setMessage(""); try { await work(); setRefresh(r => r + 1); setMessage(success); } catch (e) { report(e); } finally { setBusy(false); } };
  useEffect(() => { let live = true; void api<{ developmentIdentity: boolean }>("/runtime").then(async runtime => {
    if (!live) return; setDevelopment(runtime.developmentIdentity);
    if (runtime.developmentIdentity) { const result = await api<{ subject: string; name: string }[]>("/development/accounts"); if (live) setAccounts(result); }
  }).catch(report); return () => { live = false; }; }, [report]);
  useEffect(() => { let live = true; void Promise.all([api<Actor>("/me"), api<Study[]>("/studies")]).then(([me, list]) => {
    if (!live) return; setActor(me); setAuthNeeded(false); setStudies(list); setStudyId(current => list.some(s => s.id === current) ? current : list[0]?.id ?? "");
  }).catch(e => { if (live) report(e); }); return () => { live = false; }; }, [refresh, identity, report]);
  const study = studies.find(s => s.id === studyId);
  const tabs = [["overview", "研究總覽"], ["design", "表單設計"], ["collect", "資料收集"], ["consent", "ICF 與收集依據"], ["settings", "研究與授權"], ["reporting", "資料查核與匯出"], ...(actor?.isOperator ? [["accounts", "平台帳號管理"]] : [])];
  return <div className="platform-shell">
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <aside className="platform-sidebar"><a href="/platform.html" className="brand"><span className="brand-mark">CF</span><span>Clinical Form<span className="brand-sub">RESEARCH WORKSPACE</span></span></a>
      <label className="study-selector">目前研究<select value={studyId} onChange={e => { setStudyId(e.target.value); setError(""); setMessage(""); }}><option value="">{actor?.isOperator ? "新增／選擇研究" : "選擇研究"}</option>{studies.map(s => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
      <div className="sidebar-section-label">工作區</div><nav aria-label="工作區">{tabs.map(([key, label], i) => <button key={key} type="button" aria-label={`0${i + 1}${label}`} aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setError(""); setMessage(""); }}><span className="nav-number">0{i + 1}</span>{label}</button>)}</nav>
      <div className="sidebar-bottom"><span className="status-dot" />{actor?.name ?? "尚未登入"}<p>權限依研究與院所指派</p></div>
    </aside>
    <div className="platform-main">
      <header className="platform-topbar"><div><span className="eyebrow">工作區 / {study?.code ?? "Clinical Form"}</span><h1>{tabs.find(([key]) => key === tab)?.[1]}</h1></div>
        <div className="toolbar-actions">{development && <label className="compact">合成資料開發身分<select aria-label="開發身分" disabled={busy} value={identity} onChange={e => { selectDevelopmentUser(e.target.value); setActor(undefined); setStudies([]); setStudyId(""); setIdentity(e.target.value); setError(""); setMessage(""); }}>{accounts.map(a => <option value={a.subject} key={a.subject}>{a.name}</option>)}</select></label>}<button type="button" onClick={() => setRefresh(r => r + 1)} disabled={busy}>重新載入</button>{!development && actor && <SessionControls />}</div>
      </header>
      {development && <div className="development-banner">開發模式 · 僅使用合成資料，開發身分切換不適用正式環境</div>}
      <main className="workspace" id="main-content" tabIndex={-1}>
        {error && <div className="alert error" role="alert">{error}{!actor && <a href="/auth/login">前往登入</a>}</div>}
        {message && <div className="alert success" role="status">{message}</div>}
        {!actor ? authNeeded ? <section className="panel narrow"><h2>登入研究表單平台</h2><p>使用授權帳號登入後，即可開啟所屬研究與院所的工作區。</p><a className="login-action" href="/auth/login">登入工作區</a></section> : <Empty>{error ? "帳號或連線無法確認，請依訊息處理後重新載入。" : "正在確認身分與研究授權…"}</Empty> : tab === "accounts" && actor.isOperator ? <AccountAdministration actor={actor} refresh={refresh} busy={busy} run={run} /> : !study ? <section className="panel narrow"><h2>建立第一個研究</h2><p className="muted">先定義研究，再指派院所、表單設計與審閱人員。</p>{actor.isOperator ? <ActionForm label="建立研究" disabled={busy} onSubmit={data => run(async () => { await api("/studies", "POST", { code: text(data, "code"), name: text(data, "name") }); })}><Input label="研究代碼" name="code" /><Input label="研究名稱" name="name" /></ActionForm> : <Empty>此帳號尚未取得研究指派，請由研究負責人授權。</Empty>}</section> : <>
          <div className="study-heading"><div><span className="eyebrow">{study.code}</span><h2>{study.name}</h2></div><span className="badge">{study.active ? "進行中" : "已停用"}</span></div>
          {tab === "overview" && <StudyOverview key={studyId + identity} study={study} refresh={refresh} onNavigate={(nextTab, focus) => { setCollectionFocus(focus); setTab(nextTab); }} />}
          {tab === "design" && <Design key={studyId + identity} study={study} actor={actor} refresh={refresh} run={run} busy={busy} />}
          {tab === "collect" && <Collect key={studyId + identity} initialSubjectId={collectionFocus?.subjectId} initialVisitId={collectionFocus?.visitId} study={study} actor={actor} refresh={refresh} run={run} busy={busy} />}
          {tab === "consent" && <Consent key={studyId + identity} study={study} actor={actor} refresh={refresh} run={run} busy={busy} />}
          {tab === "settings" && <Settings key={studyId + identity} study={study} actor={actor} refresh={refresh} run={run} busy={busy} />}
          {tab === "reporting" && <Reporting key={studyId + identity} study={study} actor={actor} refresh={refresh} run={run} busy={busy} />}
        </>}
      </main>
    </div>
  </div>;
}

function Design({ study, actor, refresh, run, busy }: WorkspaceProps) {
  const [templates, setTemplates] = useState<Template[]>([]); const [templateId, setTemplateId] = useState("");
  const [versions, setVersions] = useState<Version[]>([]); const [versionId, setVersionId] = useState("");
  const [contract, setContract] = useState<CrfContract>(() => emptyContract()); const [sourceYaml, setSourceYaml] = useState(""); const [versionName, setVersionName] = useState("1.0.0");
  const [reason, setReason] = useState(""); const [dirty, setDirty] = useState(false);
  const [visitDefinitions, setVisitDefinitions] = useState<(Entity & { name: string })[]>([]);
  useEffect(() => { let live = true; void api<(Entity & { name: string })[]>(`/studies/${study.id}/visit-definitions`).then(list => { if (live) setVisitDefinitions(list); }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [study.id, refresh]);
  const version = versions.find(v => v.id === versionId);
  const permissions = actor.grants.filter(g => g.studyId === study.id && !g.siteId).reduce((n, g) => n | g.permissions, 0);
  const canDesign = (permissions & P.design) !== 0; const canPublish = (permissions & P.publish) !== 0;
  const editable = canDesign && (!version || ["draft", "submitted"].includes(version.state));
  useEffect(() => { let live = true; void api<Template[]>(`/studies/${study.id}/templates`).then(list => { if (live) { setTemplates(list); setTemplateId(current => list.some(t => t.id === current) ? current : list[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [study.id, refresh]);
  useEffect(() => { let live = true; if (!templateId) { setVersions([]); return; } void api<Version[]>(`/templates/${templateId}/versions`).then(list => { if (live) { setVersions(list); setVersionId(current => list.some(v => v.id === current) ? current : list[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [templateId, refresh]);
  useEffect(() => { if (version) { setContract(JSON.parse(version.contractJson) as CrfContract); setSourceYaml(version.sourceYaml); setVersionName(version.version); setDirty(false); } }, [version?.id, version?.revision]);
  const save = () => run(async () => {
    const savedContract = version ? contract : contractForNewVersion(contract, versionName);
    const compiled = compileContract(savedContract); if (!compiled.ok) throw new Error(compiled.diagnostics.map(d => d.message).join("；"));
    if (version) await api(`/form-versions/${version.id}`, "PUT", { expectedRevision: version.revision, contract, sourceYaml, reason });
    else { const created = await api<Version>(`/templates/${templateId}/versions`, "POST", { version: versionName.trim(), contract: savedContract, sourceYaml }); setVersionId(created.id); }
    setDirty(false);
  });
  const transition = (operation: string) => run(async () => { if (!version) return; await api(`/form-versions/${version.id}/${operation}`, "POST", { expectedRevision: version.revision, reason }); });
  return <div className="stack">
    {canPublish && <TemplateLibrary studyId={study.id} refresh={refresh} busy={busy} run={run} />}
    <section className="panel"><div className="toolbar-wrap"><label>範本<select value={templateId} onChange={e => { setTemplateId(e.target.value); setVersionId(""); setDirty(false); }}><option value="">選擇範本</option>{templates.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>版本<select value={versionId} onChange={e => { if (dirty && !window.confirm("尚未儲存的修改會被捨棄，繼續？")) return; setVersionId(e.target.value); }}><option value="">新版本草稿</option>{versions.map(v => <option key={v.id} value={v.id}>{v.version} · {stateLabel[v.state] ?? v.state}</option>)}</select></label>{version && <Badge state={version.state} />}</div>
      {canDesign && <details><summary>建立範本</summary><ActionForm label="建立範本" disabled={busy} onSubmit={data => run(async () => { const t = await api<Template>(`/studies/${study.id}/templates`, "POST", { name: text(data, "name"), kind: "ecrf" }); setTemplateId(t.id); setVersionId(""); setContract(emptyContract(t.name)); setSourceYaml(""); })}><Input name="name" label="範本名稱" /></ActionForm></details>}
    </section>
    {templateId ? <><section className="panel"><div className="toolbar-wrap"><label>表單名稱<input disabled={!editable} value={contract["x-airwayai"].title["zh-TW"] ?? ""} onChange={e => { const next = structuredClone(contract); next["x-airwayai"].title["zh-TW"] = e.target.value; setContract(next); setDirty(true); }} /></label><label>版本編號<input disabled={!!version || !canDesign} value={versionName} onChange={e => setVersionName(e.target.value)} /></label><label>操作／更正理由<input value={reason} onChange={e => setReason(e.target.value)} placeholder="正式操作與修改須填理由" /></label></div><div className="toolbar-wrap">
      {editable && <button type="button" className="primary" disabled={busy} onClick={() => void save()}>儲存草稿</button>}
      {version && canDesign && <button type="button" disabled={busy || dirty || !["draft", "submitted"].includes(version.state)} onClick={() => void transition("submit")}>送交獨立核准</button>}
      {version && canPublish && <button type="button" className="primary" disabled={busy || dirty || version.state !== "submitted"} onClick={() => void transition("publish")}>核准並正式發布</button>}
      {version && canDesign && <button type="button" disabled={busy} onClick={() => { setVersionId(""); setVersionName(""); setDirty(true); }}>另建新版本</button>}
      {version?.state === "published" && canPublish && <details><summary>此研究採用版本</summary><ActionForm label="確認採用固定版本" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/adoptions`, "POST", { formVersionId: version.id, visitDefinitionId: text(data, "visitDefinition") || null, maximumOccurrences: Number(text(data, "maximumOccurrences")), reason: text(data, "adoptionReason") }); }, "已採用此固定版本，可於適用訪視建立填答。")}><label>適用訪視<select name="visitDefinition"><option value="">所有訪視</option>{visitDefinitions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>每次訪視最多填寫次數<input name="maximumOccurrences" type="number" min={1} max={100} step={1} defaultValue={1} required /></label><Input name="adoptionReason" label="採用理由" /></ActionForm></details>}
      {dirty && <span className="badge">尚未儲存</span>}
    </div></section>{version && <VersionComparison versions={versions} selected={version} busy={busy} run={run} />}{!!contract["x-airwayai"].reviewIssues?.length && <section className="panel"><h3>來源草稿待決事項</h3><p className="muted">可先編輯與保存；阻擋項目須記錄決策後才能送交正式核准。</p>{contract["x-airwayai"].reviewIssues!.map((issue, i) => <label key={issue.id}>{issue.severity === "blocking" ? "必要確認" : "提醒"} · {issue.question}<textarea disabled={!editable || busy} value={issue.resolution ?? ""} maxLength={4000} onChange={e => { const next = structuredClone(contract); next["x-airwayai"].reviewIssues![i].resolution = e.target.value; setContract(next); setDirty(true); }} /></label>)}</section>}<FormDesigner contract={contract} onChange={next => { setContract(next); setDirty(true); }} onImportSource={setSourceYaml} disabled={!editable || busy} /></> : <Empty>先建立範本，即可從空白或文件草稿開始設計。</Empty>}
  </div>;
}

function Collect({ study, refresh, run, busy, actor, initialSubjectId, initialVisitId }: WorkspaceProps & { initialSubjectId?: string; initialVisitId?: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([]); const [subjectId, setSubjectId] = useState(initialSubjectId ?? ""); const [visits, setVisits] = useState<Visit[]>([]); const [visitId, setVisitId] = useState(initialVisitId ?? "");
  const [definitions, setDefinitions] = useState<(Entity & { name: string })[]>([]); const [adoptions, setAdoptions] = useState<Adoption[]>([]); const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [occurrenceId, setOccurrenceId] = useState(""); const [response, setResponse] = useState<ResponseRecord>(); const [contract, setContract] = useState<CrfContract>(); const [snapshot, setSnapshot] = useState<FormSnapshot>(); const [reason, setReason] = useState("");
  const occurrence = occurrences.find(o => o.id === occurrenceId); const subject = subjects.find(s => s.id === subjectId);
  const permissions = actor.grants.filter(g => g.studyId === study.id && (g.siteId === subject?.siteId || !g.siteId && g.crossSite)).reduce((n, g) => n | g.permissions, 0);
  useEffect(() => { let live = true; void Promise.all([api<Subject[]>(`/studies/${study.id}/subjects`), api<Adoption[]>(`/studies/${study.id}/adoptions`), api<(Entity & { name: string })[]>(`/studies/${study.id}/visit-definitions`)]).then(([s, a, d]) => { if (live) { setSubjects(s); setAdoptions(a); setDefinitions(d); setSubjectId(current => s.some(x => x.id === current) ? current : s[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [study.id, refresh]);
  useEffect(() => { let live = true; if (subjectId) void api<Visit[]>(`/subjects/${subjectId}/visits`).then(v => { if (live) { setVisits(v); setVisitId(current => v.some(item => item.id === current) ? current : v[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [subjectId, refresh]);
  useEffect(() => { let live = true; if (visitId) void api<Occurrence[]>(`/visits/${visitId}/occurrences`).then(o => { if (live) { setOccurrences(o); setOccurrenceId(current => o.some(item => item.id === current) ? current : o[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [visitId, refresh]);
  useEffect(() => { let live = true; setResponse(undefined); setContract(undefined); setSnapshot(undefined); if (!occurrenceId) return () => { live = false; };
    void (async () => {
      const selected = occurrences.find(o => o.id === occurrenceId); if (!selected || selected.notDoneReason) return; let record: ResponseRecord | undefined;
      if (selected?.response) record = await api<ResponseRecord>(`/responses/${selected.response.id}`);
      const form = await api<{ contract: CrfContract }>(record ? `/responses/${record.id}/form` : `/occurrences/${occurrenceId}/form`);
      if (live) { setResponse(record); setContract(form.contract); }
    })().catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [occurrenceId, refresh, occurrence?.notDoneReason, occurrence?.response?.id]);
  const save = async (data: Record<string, unknown>, submit: boolean) => {
    let record = response;
    if (record) record = await api<ResponseRecord>(`/responses/${record.id}`, "PUT", { expectedRevision: record.revision, data, reason });
    else record = await api<ResponseRecord>(`/occurrences/${occurrenceId}/responses`, "POST", { data });
    setResponse(record);
    if (submit && ["draft", "needs-correction"].includes(record.state)) record = await api<ResponseRecord>(`/responses/${record.id}/submit`, "POST", { expectedRevision: record.revision, reason: reason || "確認填答送出" });
    setResponse(record);
  };
  const transition = (operation: string) => run(async () => { if (!response) return; setResponse(await api<ResponseRecord>(`/responses/${response.id}/${operation}`, "POST", { expectedRevision: response.revision, reason })); });
  return <div className="stack"><section className="panel"><div className="toolbar-wrap"><label>受試者研究代碼<select value={subjectId} onChange={e => { setSubjectId(e.target.value); setVisits([]); setVisitId(""); setOccurrences([]); setOccurrenceId(""); setResponse(undefined); setContract(undefined); }}><option value="">選擇受試者</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label><label>訪視<select value={visitId} onChange={e => { setVisitId(e.target.value); setOccurrences([]); setOccurrenceId(""); setResponse(undefined); setContract(undefined); }}><option value="">選擇訪視</option>{visits.map(v => <option value={v.id} key={v.id}>{v.name} · {v.date}</option>)}</select></label><label>表單次別<select value={occurrenceId} onChange={e => { setOccurrenceId(e.target.value); setResponse(undefined); setContract(undefined); setSnapshot(undefined); }}><option value="">選擇表單</option>{occurrences.map((o, i) => <option key={o.id} value={o.id}>表單 {i + 1} · 第 {o.number} 次 · {o.notDoneReason ? "未執行" : stateLabel[o.response?.state ?? "draft"]}</option>)}</select></label></div></section>
    {subjectId && (permissions & P.collect) !== 0 && <div className="two-columns"><details className="panel"><summary>新增訪視</summary><ActionForm label="建立訪視" disabled={busy} onSubmit={data => run(async () => { const definitionId = text(data, "definition"); await api(`/subjects/${subjectId}/visits`, "POST", { definitionId: definitionId || null, name: text(data, "name"), date: text(data, "date"), unscheduled: !definitionId }); })}><Input label="訪視名稱" name="name" /><Input label="日期" name="date" type="date" /><label>預定訪視定義<select name="definition"><option value="">非預定訪視</option>{definitions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label></ActionForm></details>{visitId && <details className="panel"><summary>新增應收表單</summary><ActionForm label="建立表單次別" disabled={busy} onSubmit={data => run(async () => { const created = await api<Occurrence>(`/visits/${visitId}/occurrences`, "POST", { adoptionId: text(data, "adoption"), number: Number(text(data, "number")) }); setOccurrenceId(created.id); })}><label>採用版本<select name="adoption" required><option value="">選擇固定版本</option>{adoptions.filter(a => a.active && (!a.visitDefinitionId || a.visitDefinitionId === visits.find(v => v.id === visitId)?.definitionId)).map(a => <option key={a.id} value={a.id}>{a.formVersionId.slice(0, 8)} · 上限 {a.maximumOccurrences} 次</option>)}</select></label><Input label="填寫次別" name="number" type="number" value="1" /></ActionForm></details>}</div>}
    {occurrence && !occurrence.response && (permissions & P.collect) !== 0 && <section className="panel"><h3>{occurrence.notDoneReason ? "此表單未執行" : "登錄未執行原因"}</h3>{occurrence.notDoneReason && <p>{occurrence.notDoneReason}</p>}<ActionForm key={`${occurrence.id}:${occurrence.revision}`} label={occurrence.notDoneReason ? "恢復收集" : "標記未執行"} disabled={busy} onSubmit={data => run(async () => { await api(`/occurrences/${occurrence.id}/${occurrence.notDoneReason ? "resume" : "not-done"}`, "POST", { expectedRevision: occurrence.revision, reason: text(data, "reason") }); }, occurrence.notDoneReason ? "已恢復收集；原未執行紀錄保留於稽核。" : "已記錄未執行原因。")}><Input name="reason" label={occurrence.notDoneReason ? "恢復收集理由" : "未執行理由"} /></ActionForm></section>}
    {contract && occurrence ? <section className="panel response-stage"><div className="section-heading"><h3>{contract["x-airwayai"].title["zh-TW"] ?? "研究表單"}</h3><Badge state={response?.state ?? "draft"} /></div><p className="muted">表單次別 ID：<code>{occurrence.id}</code> · <a href={`/platform.html?occurrence=${occurrence.id}`} target="_blank" rel="noreferrer">獨立表單入口</a> · <a href="/platform.html?integration-demo=1" target="_blank" rel="noreferrer">嵌入示範</a></p><p className="muted">固定表單版本 {contract["x-airwayai"].schemaVersion} · 填答修訂 {response?.revision ?? "尚未儲存"}</p>
      <label>操作／更正理由<input value={reason} onChange={e => setReason(e.target.value)} /></label>
      {response?.state !== "locked" && (permissions & P.collect) !== 0 ? <><FormRenderer key={`${occurrence.id}:${response?.revision ?? 0}`} schema={contract} context="platform" locale="zh-TW" initialData={response?.data ?? {}} onChange={setSnapshot} onSubmit={submission => run(() => save(submission.data, true), "已送出並保存正式紀錄。")} /><button type="button" disabled={busy || !snapshot} onClick={() => void run(() => save(snapshot?.data ?? {}, false))}>{response && response.state !== "draft" ? "保存更正（需重新審閱）" : "儲存草稿"}</button></> : <FormRenderer key={`${occurrence.id}:${response?.revision ?? 0}`} schema={contract} context="platform" locale="zh-TW" mode="readonly" initialData={response?.data ?? {}} />}
      {response && <div className="toolbar-wrap response-actions">{(permissions & P.review) !== 0 && <><button disabled={busy || response.state !== "submitted"} onClick={() => void transition("review")}>確認審閱</button><button disabled={busy || !["submitted", "reviewed"].includes(response.state)} onClick={() => void transition("return")}>退回修正</button></>}{(permissions & P.lock) !== 0 && <><button disabled={busy || response.state !== "reviewed"} onClick={() => void transition("lock")}>鎖定資料</button><button disabled={busy || response.state !== "locked"} onClick={() => void transition("unlock")}>授權解鎖</button></>}
        <button disabled={busy} onClick={() => void run(async () => { const revisions = await api<unknown[]>(`/responses/${response.id}/revisions`); const blob = new Blob([JSON.stringify(revisions, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `response-${response.id}-revisions.json`; a.click(); URL.revokeObjectURL(url); }, "已取得修訂歷程。")}>下載修訂歷程</button>
      </div>}
    </section> : occurrence?.notDoneReason ? null : <Empty>{subjects.length ? "選擇訪視與表單；新增收集前須先確認同意或免同意依據。" : "尚無可見受試者，請先至研究與授權建立。"}</Empty>}
    {response && contract && <ResponseQueries responseId={response.id} permissions={permissions} refresh={refresh} busy={busy} run={run} paths={Object.keys(contract["x-airwayai"].fields)} />}
  </div>;
}

function Consent({ study, actor, refresh, run, busy }: WorkspaceProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]); const [subjectId, setSubjectId] = useState(""); const [icfs, setIcfs] = useState<Icf[]>([]); const [bases, setBases] = useState<Basis[]>([]); const [kind, setKind] = useState("waiver");
  const subject = subjects.find(s => s.id === subjectId); const permissions = actor.grants.filter(g => g.studyId === study.id && (g.siteId === subject?.siteId || !g.siteId && g.crossSite)).reduce((n, g) => n | g.permissions, 0);
  useEffect(() => { let live = true; void Promise.all([api<Subject[]>(`/studies/${study.id}/subjects`), api<Icf[]>(`/studies/${study.id}/icfs`)]).then(([s, i]) => { if (live) { setSubjects(s); setIcfs(i); setSubjectId(current => s.some(x => x.id === current) ? current : s[0]?.id ?? ""); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [study.id, refresh]);
  useEffect(() => { let live = true; setBases([]); if (subjectId) void api<Basis[]>(`/subjects/${subjectId}/collection-bases`).then(b => { if (live) setBases(b); }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [subjectId, refresh]);
  return <div className="stack"><div className="alert info">已簽文件{study.icfCustody === "site" ? "預設留在院端" : "依研究政策集中保管"}。文件收件不等於有效同意，須由授權人員確認適用依據。</div>
    <section className="panel"><label>受試者研究代碼<select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">選擇受試者</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label></section>
    {subjectId && <div className="two-columns"><section className="panel"><h3>收集依據</h3>{bases.length ? bases.map(b => <article className="record-row" key={b.id}><div><strong>{b.kind === "waiver" ? "核准免同意" : "受試者同意"}</strong><p>{b.reference}</p><small>用途：{b.purpose}</small></div><div className="stack"><Badge state={b.state} />{(permissions & P.basis) !== 0 && <>{b.state === "pending" && <button disabled={busy} onClick={() => { const reason = window.prompt("確認依據的理由"); if (reason) void run(async () => { await api(`/collection-bases/${b.id}/confirm`, "POST", { expectedRevision: b.revision, reason }); }); }}>確認適用依據</button>}{b.state === "confirmed" && <button disabled={busy} onClick={() => { const reason = window.prompt("撤回或限制收集的理由"); if (reason) void run(async () => { await api(`/collection-bases/${b.id}/withdraw`, "POST", { expectedRevision: b.revision, reason }); }); }}>撤回後續收集</button>}</>}</div></article>) : <Empty>尚未登錄收集依據。</Empty>}</section>
      {(permissions & P.collect) !== 0 && <section className="panel"><h3>登錄同意／免同意依據</h3><ActionForm label="登錄並等待確認" disabled={busy} onSubmit={data => run(async () => { await api(`/subjects/${subjectId}/collection-bases`, "POST", { kind, reference: text(data, "reference"), purpose: text(data, "purpose"), icfVersionId: kind === "consent" ? text(data, "icf") : null, signedOn: kind === "consent" ? text(data, "date") : null }); })}><label>依據種類<select value={kind} onChange={e => setKind(e.target.value)}><option value="waiver">核准免同意依據</option><option value="consent">已取得受試者同意</option></select></label><Input label="院端文件編號／核准依據" name="reference" /><Input label="適用用途" name="purpose" value="research" />{kind === "consent" && <><label>適用 ICF 版本<select name="icf" required><option value="">選擇核准版本</option>{icfs.filter(i => i.active && i.state === "published" && (!i.siteId || i.siteId === subject?.siteId)).map(i => <option key={i.id} value={i.id}>{i.name} · {i.version}</option>)}</select></label><Input label="簽署日期" name="date" type="date" /></>}</ActionForm></section>}
    </div>}
    <IcfWorkspace study={study} actor={actor} icfs={icfs} busy={busy} run={run} />
  </div>;
}

function Settings({ study, actor, refresh, run, busy }: WorkspaceProps) {
  const [sites, setSites] = useState<Site[]>([]); const [users, setUsers] = useState<(Entity & { name: string })[]>([]); const [grants, setGrants] = useState<Grant[]>([]);
  const manager = actor.grants.some(g => g.studyId === study.id && !g.siteId && (g.permissions & P.manage) !== 0);
  useEffect(() => { let live = true; void api<Site[]>(`/studies/${study.id}/sites`).then(s => { if (live) setSites(s); }).catch(e => void run(async () => { throw e; })); if (manager) void Promise.all([api<(Entity & { name: string })[]>("/users"), api<Grant[]>(`/studies/${study.id}/grants`)]).then(([u, g]) => { if (live) { setUsers(u); setGrants(g); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [study.id, refresh, manager]);
  return <div className="stack"><div className="two-columns"><section className="panel"><h3>合作院所</h3>{sites.map(s => <div className="record-row" key={s.id}><strong>{s.name}</strong><code>{s.code}</code></div>)}{manager && <ActionForm label="新增院所" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/sites`, "POST", { code: text(data, "code"), name: text(data, "name") }); })}><Input label="院所代碼" name="code" /><Input label="院所名稱" name="name" /></ActionForm>}</section>
      <section className="panel"><h3>建立受試者研究代碼</h3><ActionForm label="建立研究代碼" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/subjects`, "POST", { siteId: text(data, "site"), code: text(data, "code") }); })}><label>所屬院所<select name="site" required><option value="">選擇院所</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><Input label="研究代碼（不填姓名／病歷號）" name="code" /></ActionForm></section></div>
    {manager && <><div className="two-columns"><section className="panel"><h3>人員指派</h3><ActionForm label="新增授權" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/grants`, "POST", { userId: text(data, "user"), siteId: text(data, "site") || null, crossSite: data.has("crossSite"), permissions: data.getAll("permissions").reduce((sum, n) => sum | Number(n), 0), reason: text(data, "reason") }); })}><label>人員<select name="user" required>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>院所範圍<select name="site"><option value="">研究層級</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="check"><input name="crossSite" type="checkbox" />明確授權跨院（僅研究層級）</label><div className="permissions-grid">{[[P.manage, "研究管理"], [P.design, "表單設計"], [P.publish, "正式核准"], [P.read, "讀取資料"], [P.collect, "填寫資料"], [P.review, "審閱資料"], [P.lock, "鎖定／解鎖"], [P.basis, "確認收集依據"], [P.icf, "讀取已簽 ICF"], [P.export, "資料匯出"], [P.integrate, "系統整合"]].map(([value, label]) => <label className="check" key={value}><input type="checkbox" name="permissions" value={value} />{label}</label>)}</div><Input label="授權理由" name="reason" /></ActionForm></section>
      <section className="panel"><h3>預定訪視</h3><ActionForm label="新增訪視定義" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/visit-definitions`, "POST", { code: text(data, "code"), name: text(data, "name") }); })}><Input label="訪視代碼" name="code" /><Input label="訪視名稱" name="name" /></ActionForm><h3>研究政策</h3><ActionForm label="保存政策變更" disabled={busy} onSubmit={data => run(async () => { await api(`/studies/${study.id}/policy`, "PUT", { expectedRevision: study.revision, contextAuthority: text(data, "authority"), icfCustody: text(data, "custody"), requiredMappings: text(data, "mapping").split("\n").map(s => s.trim()).filter(Boolean), active: true, reason: text(data, "reason") }); })}><label>脈絡維護來源<select name="authority" defaultValue={study.contextAuthority}><option value="platform">本平台</option><option value="ctms">CTMS</option></select></label><label>已簽 ICF 保管<select name="custody" defaultValue={study.icfCustody}><option value="site">院端保管</option><option value="central">受控集中保管</option></select></label><label>必要 CDISC 欄位路徑（每行一個）<textarea name="mapping" defaultValue={(JSON.parse(study.requiredMappings) as string[]).join("\n")} /></label><Input label="變更理由" name="reason" /></ActionForm></section></div>
      <section className="panel"><h3>現有授權</h3><div className="table-scroll"><table><thead><tr><th>人員</th><th>範圍</th><th>權限</th><th>操作</th></tr></thead><tbody>{grants.map(g => <tr key={g.id}><td>{users.find(u => u.id === g.userId)?.name ?? g.userId}</td><td>{g.siteId ? sites.find(s => s.id === g.siteId)?.name : g.crossSite ? "明確跨院" : "研究設定"}</td><td>{g.permissions}</td><td>{g.expiresAt && new Date(g.expiresAt) < new Date() ? "已撤銷／到期" : <button disabled={busy} onClick={() => { const reason = window.prompt("撤銷授權理由"); if (reason) void run(async () => { await api(`/studies/${study.id}/grants/${g.id}/revoke`, "POST", { reason }); }); }}>撤銷</button>}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
