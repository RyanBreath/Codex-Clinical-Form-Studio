import { useEffect, useRef, useState } from "react";
import { FormRenderer } from "../FormRenderer";
import type { CrfContract, FormSnapshot } from "../types";
import { api, ApiError, selectDevelopmentUser, stateLabel, type ResponseRecord } from "./api";

interface Context { id: string; subjectCode: string; visitName: string; number: number; notDoneReason: string | null; canCollect: boolean; response: { id: string } | null }
export function EmbeddedForm({ occurrenceId }: { occurrenceId: string }) {
  const [context, setContext] = useState<Context>(); const [form, setForm] = useState<CrfContract>(); const [record, setRecord] = useState<ResponseRecord>();
  const [snapshot, setSnapshot] = useState<FormSnapshot>(); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(true);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [refresh, setRefresh] = useState(0);
  const [accounts, setAccounts] = useState<{ subject: string; name: string }[]>([]); const [identity, setIdentity] = useState("dev-operator");
  const parentOrigin = useRef<string | undefined>(undefined);
  function notify(type: string, state?: string) {
    if (window.parent !== window && parentOrigin.current)
      window.parent.postMessage({ protocol: "clinical-form.v1", type, occurrenceId, ...(state ? { state } : {}) }, parentOrigin.current);
  }
  useEffect(() => {
    let live = true; setBusy(true); setError(""); setContext(undefined); setForm(undefined); setRecord(undefined); setSnapshot(undefined);
    void (async () => {
      const runtime = await api<{ developmentIdentity: boolean; embeddingOrigins: string[] }>("/runtime");
      const requestedOrigin = new URLSearchParams(window.location.search).get("parentOrigin");
      if (requestedOrigin && requestedOrigin !== window.location.origin && !runtime.embeddingOrigins.includes(requestedOrigin)) throw new Error("父頁來源未在平台允許名單。");
      parentOrigin.current = requestedOrigin ?? window.location.origin;
      if (runtime.developmentIdentity) { const rows = await api<{ subject: string; name: string }[]>("/development/accounts"); if (live) setAccounts(rows); }
      const selected = await api<Context>(`/occurrences/${occurrenceId}/context`);
      if (selected.notDoneReason) throw new Error("此表單已標記未執行，請由研究工作區恢復後使用。");
      const response = selected.response ? await api<ResponseRecord>(`/responses/${selected.response.id}`) : undefined;
      const result = await api<{ contract: CrfContract }>(response ? `/responses/${response.id}/form` : `/occurrences/${occurrenceId}/form`);
      if (live) { setContext(selected); setRecord(response); setForm(result.contract); notify("ready", response?.state ?? "draft"); }
    })().catch(e => { if (live) setError(e instanceof Error ? e.message : "無法開啟表單。"); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [occurrenceId, refresh, identity]);
  const save = async (data: Record<string, unknown>, submit: boolean) => {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try {
      let result = record ? await api<ResponseRecord>(`/responses/${record.id}`, "PUT", { expectedRevision: record.revision, data, reason })
        : await api<ResponseRecord>(`/occurrences/${occurrenceId}/responses`, "POST", { data });
      // Keep the successfully persisted revision even if a subsequent submit is rejected.
      setRecord(result);
      if (submit && ["draft", "needs-correction"].includes(result.state)) {
        result = await api<ResponseRecord>(`/responses/${result.id}/submit`, "POST", { expectedRevision: result.revision, reason: reason || "確認嵌入表單送出" });
        setRecord(result);
      }
      setMessage(submit ? "已送出，紀錄保存在研究表單平台。" : "已保存草稿。"); notify("saved", result.state);
    } catch (e) { setError(e instanceof ApiError ? `${e.message}（${e.code}）` : e instanceof Error ? e.message : "操作失敗。"); }
    finally { setBusy(false); }
  };
  const editable = context?.canCollect && record?.state !== "locked";
  return <main className="embedded-workspace stack"><header className="panel"><h1>研究表單</h1>{context && <p>{context.subjectCode} · {context.visitName} · 第 {context.number} 次 · {stateLabel[record?.state ?? "draft"]}</p>}<div className="toolbar-wrap">{!!accounts.length && <label>合成資料開發身分<select disabled={busy} value={identity} onChange={e => { selectDevelopmentUser(e.target.value); setIdentity(e.target.value); }}>{accounts.map(account => <option key={account.subject} value={account.subject}>{account.name}</option>)}</select></label>}<button disabled={busy} onClick={() => setRefresh(value => value + 1)}>重新載入表單</button><a href="/auth/login" target="_blank" rel="noreferrer">開啟登入頁</a><a href="/platform.html" target="_blank" rel="noreferrer">研究工作區</a></div></header>
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
    {form && context && <section className="panel">{editable && <label>操作／更正理由<input disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>}<fieldset disabled={busy}><FormRenderer key={`${occurrenceId}:${record?.revision ?? 0}`} schema={form} context="platform" locale="zh-TW" initialData={record?.data ?? {}} {...(editable ? { mode: "edit" as const, onChange: setSnapshot, onSubmit: (submission: import("../types").FormSubmission) => save(submission.data, true) } : { mode: "readonly" as const })} />{editable && <button disabled={!snapshot} onClick={() => void save(snapshot?.data ?? {}, false)}>儲存草稿／更正</button>}</fieldset></section>}
  </main>;
}

export function IntegrationDemo() {
  const [id, setId] = useState(""); const [launchId, setLaunchId] = useState(""); const [status, setStatus] = useState("等待開啟表單");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { const receive = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.protocol !== "clinical-form.v1" || event.data?.occurrenceId !== launchId) return;
    if (event.data.type === "ready" || event.data.type === "saved") setStatus(`${event.data.type === "ready" ? "表單已開啟" : "平台已保存"} · ${stateLabel[String(event.data.state)] ?? ""}`);
  }; window.addEventListener("message", receive); return () => window.removeEventListener("message", receive); }, [launchId]);
  return <main className="embedded-workspace stack"><section className="panel"><h1>外部系統嵌入示範</h1><p>此頁模擬同源 CTMS 父頁。表單與研究工作區共用登入、版本、授權及紀錄；父頁只接收就緒／保存狀態，不接收填答內容。</p><form onSubmit={e => { e.preventDefault(); setLaunchId(id.trim()); setStatus("正在開啟表單"); }}><label>表單次別 ID<input required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" value={id} onChange={e => setId(e.target.value)} /></label><button className="primary">開啟嵌入表單</button></form><p role="status">{status}</p><a href="/platform.html">回研究工作區</a></section>{launchId && <iframe ref={frame} title="研究表單嵌入視窗" src={`/platform.html?occurrence=${encodeURIComponent(launchId)}&parentOrigin=${encodeURIComponent(window.location.origin)}`} />}</main>;
}
