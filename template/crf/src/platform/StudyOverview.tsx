import { useEffect, useMemo, useState } from "react";
import { api, stateLabel, type Adoption, type Site, type Study, type Subject, type Template } from "./api";

interface Progress { subjectId: string; subjectCode: string; visitId: string; visitName: string; date: string; formName: string; version: string; started: number; submitted: number; notDone: number; missing: boolean; responses: { id: string; state: string; revision: number }[] }
interface Props { study: Study; refresh: number; onNavigate: (tab: string, focus?: { subjectId: string; visitId: string }) => void }
export function StudyOverview({ study, refresh, onNavigate }: Props) {
  const [data, setData] = useState<{ sites: Site[]; subjects: Subject[]; templates: Template[]; adoptions: Adoption[]; progress: Progress[] }>();
  const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all");
  useEffect(() => { let live = true; setError(""); void Promise.all([
    api<Site[]>(`/studies/${study.id}/sites`), api<Subject[]>(`/studies/${study.id}/subjects`), api<Template[]>(`/studies/${study.id}/templates`),
    api<Adoption[]>(`/studies/${study.id}/adoptions`), api<Progress[]>(`/studies/${study.id}/progress`),
  ]).then(([sites, subjects, templates, adoptions, progress]) => { if (live) setData({ sites, subjects, templates, adoptions, progress }); })
    .catch(e => { if (live) setError(e instanceof Error ? e.message : "無法載入研究資料。"); }); return () => { live = false; }; }, [study.id, refresh]);
  const rows = useMemo(() => (data?.progress ?? []).filter(row => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || `${row.subjectCode} ${row.visitName} ${row.formName}`.toLocaleLowerCase().includes(query)) &&
      (filter === "all" || filter === "missing" && row.missing || filter === "submitted" && row.responses.some(response => response.state === "submitted") || filter === "locked" && row.responses.some(response => response.state === "locked"));
  }), [data, search, filter]);
  const submitted = data?.progress.reduce((sum, row) => sum + row.responses.filter(response => response.state === "submitted").length, 0) ?? 0;
  const locked = data?.progress.reduce((sum, row) => sum + row.responses.filter(response => response.state === "locked").length, 0) ?? 0;
  const missing = data?.progress.filter(row => row.missing).length ?? 0;
  const stats = [["受試者", data?.subjects.length], ["合作院所", data?.sites.length], ["待填表單", data ? missing : undefined], ["待審閱", data ? submitted : undefined], ["已鎖定", data ? locked : undefined]] as const;
  return <div className="overview-workbench">
    {error && <div className="alert error" role="alert">{error}</div>}
    <dl className="stat-strip">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
    <div className="overview-grid"><section className="panel worklist-panel" aria-busy={!data && !error}>
      <div className="panel-heading"><div><h3>訪視工作清單</h3><span className="muted">已建立訪視 · 依目前院所授權顯示</span></div><span className="count-label">{data ? `${rows.length} / ${data.progress.length}` : "載入中"}</span></div>
      <div className="worklist-toolbar"><div className="filter-tabs" role="group" aria-label="工作清單狀態">{[["all", "全部"], ["missing", "待填寫"], ["submitted", "待審閱"], ["locked", "已鎖定"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="search-control"><span className="sr-only">搜尋工作清單</span><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8" cy="8" r="5.5" /><path d="m12 12 5 5" /></svg><input type="search" placeholder="搜尋代碼、訪視、表單…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="table-scroll" role="region" aria-label="訪視工作清單表格" tabIndex={0}><table className="worklist-table"><thead><tr><th>研究代碼／訪視</th><th>表單版本</th><th>狀態</th><th>日期</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.visitId}:${index}`}><td><strong className="mono">{row.subjectCode}</strong><small>{row.visitName}</small></td><td><strong>{row.formName}</strong><small className="mono">v{row.version}</small></td><td>{row.responses.length ? row.responses.map(response => <span key={response.id} className={`badge state-${response.state}`}>{stateLabel[response.state] ?? response.state}<span className="revision-label">r{response.revision}</span></span>) : <span className={`badge ${row.missing ? "state-pending" : ""}`}>{row.notDone ? "未執行" : "待填寫"}</span>}</td><td className="mono date-cell">{row.date}</td><td><button className="row-action" type="button" aria-label={`開啟 ${row.subjectCode} ${row.visitName}`} onClick={() => onNavigate("collect", { subjectId: row.subjectId, visitId: row.visitId })}>開啟 <span aria-hidden="true">↗</span></button></td></tr>)}</tbody></table></div>
      {!data && !error ? <div className="empty-state" role="status">正在載入訪視與表單…</div> : !error && !rows.length && <div className="empty-state"><strong>{search || filter !== "all" ? "沒有符合條件的工作" : "尚無訪視工作"}</strong><p>{search || filter !== "all" ? "調整搜尋文字或切換狀態篩選。" : "完成版本採用與依據確認後，即可建立訪視及表單次別。"}</p><button onClick={() => search || filter !== "all" ? (setSearch(""), setFilter("all")) : onNavigate("collect")}>{search || filter !== "all" ? "清除篩選" : "前往資料收集"}</button></div>}
      <div className="panel-footnote"><span className="scroll-hint">左右捲動表格檢視完整欄位，或點選右側「開啟」。</span>顯示已建立訪視的應收表單；尚未建立的訪視不納入待填數量。</div>
    </section>
    <aside className="overview-aside"><section className="panel"><div className="panel-heading"><h3>研究設定</h3><span className="eyebrow">CONTEXT</span></div><dl className="context-list"><div><dt>研究代碼</dt><dd>{study.code}</dd></div><div><dt>脈絡來源</dt><dd>{study.contextAuthority === "platform" ? "本平台" : "CTMS"}</dd></div><div><dt>ICF 保管</dt><dd>{study.icfCustody === "site" ? "院端保管" : "集中保管設定"}</dd></div><div><dt>採用版本</dt><dd>{data?.adoptions.filter(adoption => adoption.active).length ?? "—"}</dd></div><div><dt>表單範本</dt><dd>{data?.templates.length ?? "—"}</dd></div></dl><button className="full-width" onClick={() => onNavigate("settings")}>管理研究與授權 <span aria-hidden="true">→</span></button></section>
      <section className="panel"><div className="panel-heading"><h3>研究工作流程</h3><span className="eyebrow">WORKFLOW</span></div><ol className="workflow-list">{[["design", "設計與發布", "表單草稿、版本與獨立核准"], ["consent", "確認收集依據", "ICF 版本及同意／免同意依據"], ["collect", "收集與審閱", "填答、更正、Query 與鎖定"], ["reporting", "查核與匯出", "授權範圍進度與修訂快照"]].map(([tab, title, detail], index) => <li key={tab}><button onClick={() => onNavigate(tab)}><span className="step-index">0{index + 1}</span><span><strong>{title}</strong><small>{detail}</small></span><span className="step-arrow" aria-hidden="true">›</span></button></li>)}</ol></section>
      <div className="scope-note"><span className="scope-marker" aria-hidden="true" />資料範圍由研究與院所授權決定。跨院審閱與已簽 ICF 存取分別授權。</div>
    </aside></div>
  </div>;
}
