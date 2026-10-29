import { useEffect, useState } from "react";
import { api, P, stateLabel, type Actor, type Icf, type Site, type Study } from "./api";

interface Props { study: Study; actor: Actor; icfs: Icf[]; busy: boolean; run: (work: () => Promise<void>, success?: string) => Promise<void> }
const blank = () => ({ name: "", version: "", locale: "zh-TW", content: "", approvalReference: "", siteId: "" });
export function IcfWorkspace({ study, actor, icfs, busy, run }: Props) {
  const [id, setId] = useState(""); const [draft, setDraft] = useState(blank); const [reason, setReason] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const selected = icfs.find(icf => icf.id === id);
  const permissions = actor.grants.filter(grant => grant.studyId === study.id && !grant.siteId).reduce((all, grant) => all | grant.permissions, 0);
  const design = (permissions & P.design) !== 0; const approve = (permissions & P.publish) !== 0;
  const editable = design && (!selected || ["draft", "submitted"].includes(selected.state));
  useEffect(() => { let live = true; void api<Site[]>(`/studies/${study.id}/sites`).then(rows => { if (live) setSites(rows); }).catch(error => void run(async () => { throw error; })); return () => { live = false; }; }, [study.id]);
  useEffect(() => { if (selected) setDraft({ name: selected.name, version: selected.version, locale: selected.locale, content: selected.content, approvalReference: selected.approvalReference, siteId: selected.siteId ?? "" }); }, [selected?.id, selected?.revision]);
  const dirty = !!selected && (draft.name !== selected.name || draft.version !== selected.version || draft.locale !== selected.locale || draft.content !== selected.content || draft.approvalReference !== selected.approvalReference);
  const action = (operation: string) => run(async () => {
    if (!selected) return;
    await api(`/icfs/${selected.id}/${operation === "retire" ? "retire" : `workflow/${operation}`}`, "POST", { expectedRevision: selected.revision, reason });
  });
  return <section className="panel stack"><h3>ICF 文件設計與核准</h3><p className="muted">管理文件版本與外部核准依據。文件須由設計參與人以外的授權人核准後，才能作為收集依據；已簽文件仍依研究保管政策保存。</p>
    <div className="toolbar-wrap"><label>ICF 文件版本<select value={id} onChange={event => { setId(event.target.value); if (!event.target.value) setDraft(blank()); }}><option value="">{design ? "建立新文件草稿" : "選擇文件"}</option>{icfs.map(icf => <option key={icf.id} value={icf.id}>{icf.name} · {icf.version} · {stateLabel[icf.state] ?? icf.state}</option>)}</select></label>{selected && <span className="badge">{stateLabel[selected.state] ?? selected.state}</span>}{selected && design && <button disabled={busy} onClick={() => { setDraft({ ...draft, version: "" }); setId(""); }}>複製為新版本</button>}</div>
    {(selected || design) && <form className="stack" onSubmit={event => { event.preventDefault(); void run(async () => {
      const payload = { ...draft, siteId: draft.siteId || null };
      if (selected) await api(`/icfs/${selected.id}/draft`, "PUT", { ...payload, expectedRevision: selected.revision, reason });
      else { const created = await api<Icf>(`/studies/${study.id}/icfs`, "POST", payload); setId(created.id); }
    }, "已保存 ICF 草稿，尚未核准供收集使用。"); }}>
      <fieldset disabled={busy || !editable}><div className="toolbar-wrap"><label>ICF 名稱<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>ICF 版本編號<input required maxLength={60} value={draft.version} onChange={e => setDraft({ ...draft, version: e.target.value })} /></label><label>文件語言<input required value={draft.locale} onChange={e => setDraft({ ...draft, locale: e.target.value })} /></label></div>
      <label>適用院所<select disabled={!!selected || !editable} value={draft.siteId} onChange={e => setDraft({ ...draft, siteId: e.target.value })}><option value="">全研究</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label>外部／IRB 核准依據<input required maxLength={2000} value={draft.approvalReference} onChange={e => setDraft({ ...draft, approvalReference: e.target.value })} /></label><label>ICF 文件內容<textarea required rows={12} maxLength={100000} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></label>
      </fieldset><label>ICF 操作理由<input value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="toolbar-wrap">{editable && <button className="primary" disabled={busy || !!selected && !reason.trim()} type="submit">儲存 ICF 草稿</button>}{selected?.state === "draft" && design && <button disabled={busy || dirty || !reason.trim()} type="button" onClick={() => void action("submit")}>送交 ICF 核准</button>}{selected?.state === "submitted" && approve && <button disabled={busy || dirty || !reason.trim()} type="button" onClick={() => void action("approve")}>獨立核准 ICF</button>}{selected?.state === "published" && approve && <button disabled={busy || dirty || !reason.trim()} type="button" onClick={() => void action("retire")}>停用 ICF 版本</button>}</div>
      {selected?.approvalHash && <small className="muted">核准內容雜湊：{selected.approvalHash}</small>}
    </form>}
  </section>;
}
