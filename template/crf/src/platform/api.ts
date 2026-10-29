let developmentUser = "dev-operator";
let csrfToken: string | undefined;
let useDevelopmentIdentity = false;
export function selectDevelopmentUser(subject: string) { developmentUser = subject; }
export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (method !== "GET" && !useDevelopmentIdentity && csrfToken === undefined) {
    const csrf = await fetch("/api/csrf", { credentials: "same-origin" });
    csrfToken = csrf.ok ? ((await csrf.json()) as { token: string }).token : "";
  }
  const response = await fetch(`/api${path}`, {
    method, credentials: "same-origin", headers: {
      "X-Development-User": developmentUser,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ title: "請求無法完成。", code: `HTTP_${response.status}` }));
    throw new ApiError(error.code, error.title ?? "請求無法完成。", error.details);
  }
  const result: unknown = await response.json();
  if (path === "/runtime" && result && typeof result === "object" && "developmentIdentity" in result)
    useDevelopmentIdentity = result.developmentIdentity === true;
  return result as T;
}
export interface Entity { id: string; revision: number }
export interface Study extends Entity { code: string; name: string; contextAuthority: string; icfCustody: string; requiredMappings: string; active: boolean }
export interface Site extends Entity { code: string; name: string; studyId: string }
export interface Subject extends Entity { code: string; siteId: string; studyId: string }
export interface Visit extends Entity { name: string; date: string; definitionId: string | null; unscheduled: boolean }
export interface Template extends Entity { name: string; kind: string }
export interface Version extends Entity { version: string; state: string; contractJson: string; contentHash: string; sourceYaml: string; templateId: string }
export interface Adoption extends Entity { formVersionId: string; visitDefinitionId: string | null; maximumOccurrences: number; active: boolean }
export interface Basis extends Entity { kind: string; reference: string; purpose: string; state: string; signedOn: string | null; icfVersionId: string | null }
export interface Icf extends Entity { state: string; locale: string; approvalHash: string | null; name: string; version: string; content: string; approvalReference: string; active: boolean; siteId: string | null }
export interface ResponseRecord extends Entity { state: string; data: Record<string, unknown>; formVersionId: string; occurrenceId: string; updatedAt: string }
export interface Occurrence extends Entity { adoptionId: string; number: number; notDoneReason: string | null; response: Pick<ResponseRecord, "id" | "state" | "revision"> | null }
export interface Grant extends Entity { userId: string; siteId: string | null; crossSite: boolean; permissions: number; expiresAt: string | null }
export interface Actor { id: string; name: string; isOperator: boolean; grants: (Grant & { studyId: string })[] }
export const P = { manage: 1, design: 2, publish: 4, collect: 8, review: 16, lock: 32, basis: 64, icf: 128, read: 256, export: 512, integrate: 1024 };
export const stateLabel: Record<string, string> = { draft: "草稿", submitted: "待審閱", published: "正式發布", "test-published": "測試發布", retired: "已停用", reviewed: "已審閱", locked: "已鎖定", "needs-correction": "待修正", confirmed: "已確認", pending: "待確認", withdrawn: "已撤回" };
