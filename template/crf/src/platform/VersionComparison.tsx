import { useEffect, useState } from "react";
import { api, type Version } from "./api";

interface Difference { path: string; before: unknown; after: unknown }
interface Props { versions: Version[]; selected: Version; busy: boolean; run: (work: () => Promise<void>, success?: string) => Promise<void> }
export function VersionComparison({ versions, selected, busy, run }: Props) {
  const [baseline, setBaseline] = useState("");
  const [result, setResult] = useState<{ from: string; to: string; contractChanges: Difference[] }>();
  useEffect(() => { setResult(undefined); }, [baseline, selected.id, selected.revision]);
  const candidates = versions.filter(version => version.id !== selected.id);
  if (!candidates.length) return null;
  return <details className="panel"><summary>比較版本差異</summary><p className="muted">比較已儲存的完整契約，包含欄位、範圍、條件、計算及版面；尚未儲存的編輯不在比較範圍。</p>
    <div className="toolbar-wrap"><label>比較基準<select value={baseline} onChange={event => setBaseline(event.target.value)}><option value="">選擇較早版本</option>{candidates.map(version => <option key={version.id} value={version.id}>{version.version}</option>)}</select></label><button disabled={busy || !baseline} onClick={() => void run(async () => { setResult(await api(`/form-versions/${baseline}/diff/${selected.id}`)); }, "已取得版本差異。")}>比較已儲存版本</button></div>
    {result && <><p>{result.from} → {result.to} · {result.contractChanges.length} 項契約差異</p><div className="table-scroll"><table><thead><tr><th>契約路徑</th><th>基準版本</th><th>目前版本</th></tr></thead><tbody>{result.contractChanges.map(change => <tr key={change.path}><td><code>{change.path}</code></td><td><pre>{JSON.stringify(change.before, null, 2)}</pre></td><td><pre>{JSON.stringify(change.after, null, 2)}</pre></td></tr>)}</tbody></table></div></>}
  </details>;
}
