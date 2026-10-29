# MVP 交付與驗收紀錄

日期：2026-10-28。交付類型：可在本機使用合成資料試跑的 MVP。完整規劃及 ADR 0001–0019 繼續有效；本紀錄不表示所有後續整合及正式上線工作已完成。

## 可以試用的流程

1. 平台管理員建立研究、院所、帳號及明確研究授權。
2. 設計者從空白／YAML／JSON 編輯表單，儲存、送審，由另一位授權人正式核准。
3. 研究明確採用固定版本，設定訪視及重複次數；範本庫只列出有研究授權的來源版本。
4. 設計 ICF 草稿、送審及獨立核准，保存文件內容與外部／IRB 核准依據。院端登錄簽署文件參考，再確認適用收集依據。
5. 建立訪視及表單次別，在平台或同源嵌入頁填答。後端重新計算與驗證，保存正式資料及歷程。
6. 依流程送出、Query、更正、審閱、鎖定／解鎖，或記錄未執行及恢復；建立固定修訂 JSON 匯出。
7. CTMS 可使用綁定來源的帳號，受控建立外部研究代碼、訪視及填答／更正；以去重識別及預期修訂號控制重送與衝突。

## 驗收結果

| 項目 | 證據及結果 |
| --- | --- |
| 後端與 PostgreSQL | 22 個測試通過，含院所隔離、發布、ICF、依據、填答、Query、匯出、外部寫入、訪視、版本、帳號及實際簽章 Bearer token 驗證 |
| 前端 | 53 個測試通過、1 個條件式略過，另 3 個 Node 原生測試通過；型別檢查通過 |
| 瀏覽器 | 在 Vite 開發版及實際發行包上完成 ICF 設計／獨立核准、同意依據、嵌入填答、伺服器 BMI 重算、審閱、鎖定與匯出 |
| 嵌入控制 | 發行包回傳 frame-ancestors 'self'；不允許的 parentOrigin 不開放表單。父頁依 origin、source、protocol 與 occurrenceId 檢查狀態事件 |
| 帳號操作 | 已實際以介面註冊合成帳號；API 測試確認不自動授予研究權限、非管理員不可管理帳號及禁止自行停用 |
| OIDC | 先前隔離本機 Keycloak 登入、CSRF 寫入及登出通過；本批另驗證 Bearer issuer／audience、無 Cookie 的受控請求及帳號停用生效 |
| 發行 | `scripts/platform-package.ps1` 產生 .NET Release 與依 Vite manifest 選取的前端資產，保存 SHA-256 清單；已實際啟動及瀏覽器驗收 |
| 還原 | `scripts/platform-restore-rehearsal.ps1` 完成 pg_dump、自動建立獨立還原資料庫、pg_restore 及查詢；包含 4 個 migrations、填答、表單、ICF 與稽核。只刪除本次隨機命名的還原資料庫 |

最新測試報告：`output/platform-tests/mvp-current.trx`。瀏覽器證據：`output/playwright/platform-20261028/mvp-embedded.png`、`mvp-reviewed-export.png`、`mvp-account-administration.png`。本機發行與備份報告保存在忽略版控的 `.platform-data/`。

## 啟動試用

需要 .NET 10、Node.js 24、npm 11、PowerShell 7 與 Docker。首次執行 `npm --prefix template/crf ci`。在專案根目錄：

```powershell
npm run platform:db
npm run platform:package
npm run platform:mvp
```

開啟 `http://127.0.0.1:5198/platform.html`。可切換合成開發身分，但仍須有研究授權。`platform:mvp` 只綁定 loopback；此模式不供真實研究資料上線。

可重跑驗收的瀏覽器腳本為 `scripts/platform-mvp-smoke.js` 與 `scripts/platform-mvp-admin-smoke.js`，使用 Playwright CLI `run-code --filename`；前者每次建立獨立的合成研究，後者建立合成帳號。腳本有 syntheticOnly 與 developmentIdentity 檢查，不在正式環境執行。

## 保留的後續工作與限制

- 已簽 ICF 採院端保管與文件參考；集中附件保存、一般檔案傳輸及 CBCT／DICOM 實際串接尚未交付。
- 本次嵌入驗證為同源父頁；跨站 Cookie／SSO 與實際 CTMS 環境須另行驗收。可設定允許 origin，但這不自動解決瀏覽器登入限制。
- 目前提供同步、最多 1000 筆的 JSON 匯出。完整訪視預估、大量匯出、事件推送／對帳與保存期限管理尚待完成。
- 已完成的是資料庫還原演練；附件、IdP、Data Protection 金鑰與正式環境 RPO／RTO 尚未驗收。
- 正式 IdP／MFA、部署環境、容量／資安與院端使用驗收仍是正式收集前的必要工作。
- 即時 AI 依使用者決定延後；未建立金鑰或呼叫模型。
- 先前曾發生一個未重現的整合寫入測試失敗，後續完整測試通過；仍保留追查紀錄。
