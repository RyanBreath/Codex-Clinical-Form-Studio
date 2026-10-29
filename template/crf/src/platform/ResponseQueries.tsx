import { useEffect, useState } from "react";
import { api, P, type Entity } from "./api";
interface Query extends Entity { path: string; question: string; answer: string; state: string }
interface Props { responseId: string; permissions: number; refresh: number; busy: boolean; run: (work: () => Promise<void>, success?: string) => Promise<void>; paths: string[] }
export function ResponseQueries({ responseId, permissions, refresh, busy, run, paths }: Props) {
  const [queries, setQueries] = useState<Query[]>([]); const [answers, setAnswers] = useState<Record<string, string>>({});
  const [path, setPath] = useState(paths[0] ?? ""); const [question, setQuestion] = useState("");
  useEffect(() => { let live = true; void api<Query[]>(`/responses/${responseId}/queries`).then(q => { if (live) { setQueries(q); setAnswers(Object.fromEntries(q.map(x => [x.id, x.answer]))); } }).catch(e => void run(async () => { throw e; })); return () => { live = false; }; }, [responseId, refresh]);
  return <section className="panel"><h3>資料疑問與回覆</h3>
    {queries.length ? queries.map(query => <article key={query.id} className="query-card"><div className="section-heading"><strong>{query.path}</strong><span className="badge">{query.state === "closed" ? "已結案" : query.state === "answered" ? "已回覆待確認" : "待回覆"}</span></div><p>{query.question}</p>
      {query.state !== "closed" && (permissions & P.collect) !== 0 ? <><label>院端回覆<textarea value={answers[query.id] ?? ""} maxLength={2000} onChange={e => setAnswers(a => ({ ...a, [query.id]: e.target.value }))} /></label><button disabled={busy || !answers[query.id]?.trim()} onClick={() => void run(async () => { await api(`/queries/${query.id}/answer`, "POST", { expectedRevision: query.revision, answer: answers[query.id] }); }, "資料疑問已回覆。")}>送出回覆</button></> : <p className="document-content">{query.answer || "尚未回覆"}</p>}
      {query.state === "answered" && (permissions & P.review) !== 0 && <button disabled={busy} onClick={() => void run(async () => { await api(`/queries/${query.id}/close`, "POST", { expectedRevision: query.revision, answer: "" }); }, "資料疑問已結案。")}>確認回覆並結案</button>}
    </article>) : <p className="muted">目前沒有資料疑問。</p>}
    {(permissions & P.review) !== 0 && <details><summary>開立欄位疑問</summary><div className="stack"><label>欄位<select value={path} onChange={e => setPath(e.target.value)}>{paths.map(p => <option value={p} key={p}>{p}</option>)}</select></label><label>疑問內容<textarea value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} /></label><button disabled={busy || !question.trim()} onClick={() => void run(async () => { await api(`/responses/${responseId}/queries`, "POST", { path, question }); setQuestion(""); }, "資料疑問已開立，填答須重新審閱。")}>開立資料疑問</button></div></details>}
  </section>;
}
