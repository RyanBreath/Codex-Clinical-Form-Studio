import { useEffect, useState } from "react";
import { api, P, stateLabel, type Actor, type Entity, type Study } from "./api";
interface ProgressRow { subjectId: string; subjectCode: string; visitId: string; visitName: string; date: string; formName: string; version: string; started: number; submitted: number; notDone: number; missing: boolean; responses: { id: string; state: string; revision: number }[] }
interface Audit extends Entity { action: string; resource: string; reason: string; createdAt: string; actorId: string }
interface Props { study: Study; actor: Actor; refresh: number; busy: boolean; run: (work: () => Promise<void>, success?: string) => Promise<void> }
export function Reporting({ study, actor, refresh, busy, run }: Props) {
  const [rows, setRows] = useState<ProgressRow[]>([]); const [audit, setAudit] = useState<Audit[]>([]);
  const [reason, setReason] = useState(""); const [purpose, setPurpose] = useState("research");
  const [lastExport, setLastExport] = useState<{ id: string; contentHash: string; count: number; createdAt: string }>();
  const permissions = actor.grants.filter(g => g.studyId === study.id).reduce((all, g) => all | g.permissions, 0);
  useEffect(() => { let live = true; void api<ProgressRow[]>(`/studies/${study.id}/progress`).then(r => { if (live) setRows(r); }).catch(e => void run(async () => { throw e; }));
    if ((permissions & (P.manage | P.review)) !== 0) void api<Audit[]>(`/studies/${study.id}/audit`).then(a => { if (live) setAudit(a); }).catch(e => void run(async () => { throw e; }));
    return () => { live = false; }; }, [study.id, refresh, permissions]);
  const download = () => run(async () => {
    if (!lastExport) return; const content = await api<unknown>(`/exports/${lastExport.id}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `study-${study.code}-export-${lastExport.id}.json`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "已取得固定修訂的匯出快照。");
  return <div className="stack"><section className="panel"><h3>訪視與表單收集進度</h3><p className="muted">僅顯示授權院所。已建立訪視的應收表單會依採用設定列出；尚未建立的訪視排程不在本表推算。</p><div className="table-scroll"><table><thead><tr><th>研究代碼</th><th>訪視</th><th>表單版本</th><th>收集狀態</th><th>紀錄狀態</th></tr></thead><tbody>{rows.map((row, i) => <tr key={`${row.visitId}-${i}`}><td>{row.subjectCode}</td><td>{row.visitName}<br /><small>{row.date}</small></td><td>{row.formName} · {row.version}</td><td>{row.missing ? "尚未填寫" : row.notDone ? `未執行 ${row.notDone} 次` : `已開始 ${row.started}／已送出 ${row.submitted}`}</td><td>{row.responses.map(r => <span className="badge" key={r.id}>{stateLabel[r.state] ?? r.state} · 修訂 {r.revision}</span>)}</td></tr>)}</tbody></table>{!rows.length && <p className="empty-state">尚無可見的訪視收集進度。</p>}</div></section>
    {(permissions & P.export) !== 0 && <section className="panel"><h3>受控資料匯出</h3><p className="muted">建立固定修訂快照，僅包含授權院所的已送出／審閱／鎖定紀錄；下載時再次檢查權限與用途依據。目前每次上限 1000 筆。</p><div className="toolbar-wrap"><label>適用用途<input value={purpose} onChange={e => setPurpose(e.target.value)} /></label><label>匯出理由<input value={reason} onChange={e => setReason(e.target.value)} /></label><button className="primary" disabled={busy || !reason.trim() || !purpose.trim()} onClick={() => void run(async () => { setLastExport(await api(`/studies/${study.id}/exports`, "POST", { purpose, reason })); }, "已建立匯出快照。")}>建立匯出快照</button></div>{lastExport && <div className="export-result"><p>已固定 {lastExport.count} 筆紀錄 · {new Date(lastExport.createdAt).toLocaleString("zh-TW")}</p><p className="muted">完整性雜湊：<code>{lastExport.contentHash}</code></p><button disabled={busy} onClick={() => void download()}>下載 JSON 快照</button></div>}</section>}
    {(permissions & (P.manage | P.review)) !== 0 && <section className="panel"><h3>最近 200 筆授權範圍內稽核</h3><div className="table-scroll"><table><thead><tr><th>時間</th><th>操作</th><th>紀錄</th><th>理由</th></tr></thead><tbody>{audit.map(a => <tr key={a.id}><td>{new Date(a.createdAt).toLocaleString("zh-TW")}</td><td>{a.action}</td><td><code>{a.resource}</code></td><td>{a.reason || "—"}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
