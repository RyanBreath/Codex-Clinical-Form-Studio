# 外部整合與 MVP 試用

## 本機發行版

在專案根目錄執行 `npm run platform:db`、`npm run platform:package`，再執行 `npm run platform:mvp`。開啟 `http://127.0.0.1:5198/platform.html`。發行包同時提供 API 與前端，不需 Vite。

發行腳本先做型別與核心前端檢查、編譯前端，再發行 .NET；依 Vite manifest 複製必要資產並建立 SHA-256 清單。包裝不是部署，啟動腳本僅提供 loopback 合成資料試跑。使用 PowerShell 7。

## 固定表單入口與嵌入

資料收集區顯示表單次別 ID，並提供獨立入口及嵌入示範連結。工作區入口可帶 studyId 預選已獲授權的研究；選單同時顯示研究代碼，避免名稱相同時混淆。

- 獨立入口：`/platform.html?occurrence=<表單次別ID>`。
- 同源父頁示範：`/platform.html?integration-demo=1`。
- 嵌入入口可帶 `parentOrigin`，值須與平台自身 origin 相同或在 `Embedding:AllowedOrigins` 設定中。不可帶任意 API 主機、帳密或 token。
- 部署端的 `Embedding:AllowedOrigins` 接受明確 HTTPS origin，不接受萬用字元或路徑；Development 另允許 loopback HTTP。發行包以 CSP frame-ancestors 限制可嵌入的父頁。

父頁只接收 `clinical-form.v1` 協定的 ready／saved、表單次別 ID 及狀態，不接收填答內容。接收端須同時檢查 `event.origin`、`event.source`、協定與次別 ID。表單仍使用平台登入、研究／院所權限、固定版本及後端收集關卡。

已驗證同源嵌入。跨站 Cookie 或 IdP 不一定能在 iframe 中登入，實際 CTMS 應先驗證同源反向代理或另開登入頁等部署方式；允許 origin 不等於已完成 SSO 整合。

## 系統間 API

正式系統帳號使用可信 IdP 簽發、issuer／audience 正確的 Bearer token。管理員需先註冊 issuer|subject、綁定 integrationSource，並另指派研究／院所的 Integrate、Collect 及需要的 Read 權限。平台不因 token 帶有角色或 Email 就自動授權。

| 操作 | API |
| --- | --- |
| 建立／取得外部受試者對應 | POST `/api/integrations/studies/{studyId}/subjects` |
| 建立外部訪視對應 | POST `/api/integrations/visits` |
| 外部建立填答 | POST `/api/integrations/responses` |
| 外部更正填答 | PUT `/api/integrations/responses/{responseId}` |
| 查去重收據 metadata | GET `/api/integrations/receipts/{key}` |
| 查表單次別脈絡 | GET `/api/occurrences/{id}/context` |
| 讀固定表單／填答 | GET `/api/occurrences/{id}/form`、`/api/responses/{id}`、`/api/responses/{id}/form` |

外部寫入必須提供 Idempotency-Key；相同識別搭配不同內容會回 409。更正須提供 expectedRevision、externalRecordId、data 與 reason。院所、版本、依據、鎖定、重新審閱與伺服器計算控制與平台入口相同。

研究指定 CTMS 為脈絡來源時，受試者及訪視使用外部端點，平台手動建立會被拒絕。外部研究／訪視代碼不應含姓名或病歷號。事件推送及完整對帳尚未提供。

## 備份還原演練

執行 `npm run platform:restore-rehearsal`，只操作本專案 Compose 的開發資料庫。腳本建立 custom-format 備份與獨立隨機名稱的還原資料庫，還原後查詢填答、版本、ICF、稽核及 migrations，保存備份雜湊與結果，再移除該次還原資料庫。

本機備份及報告在 `.platform-data/backups/`。此演練不包含附件、IdP 或正式環境金鑰，不能據此宣稱正式災難復原已驗收。

完整證據與待辦見 [MVP 交付紀錄](../planning/mvp-acceptance.md)。雲端同步未啟用。
