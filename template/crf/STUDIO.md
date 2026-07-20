# AirwayAI eCRF Studio

`eCRF Studio` 是 `protocol-to-ecrf` review-gated 流程的本機 UI。它用來編輯既有的 `program.yaml`、查詢官方 NCI‑EVS CDISC SDTM Controlled Terminology 候選、由人工確認後寫回 YAML，並編譯為 AirwayAI `crf-schema.json` 與可離線審查的 HTML 表單。

## 啟動

在 repository root 執行：

```powershell
npm run studio
```

開啟：

```text
http://127.0.0.1:4174/studio.html
```

首次按「取得可能編碼」時，本機服務會從官方 NCI‑EVS 下載目前的 SDTM Controlled Terminology 文字檔（約 13 MB），並快取到作業系統暫存目錄 24 小時。查詢不會把 protocol 或欄位資料傳給第三方 AI；後端只以使用者輸入的搜尋字詞比對官方術語表。

## 建議操作順序

1. 按「載入 YAML」選取單一 `analysis/program.yaml`。
2. 逐欄確認資料型別、必填性、單位、範圍、選項與 protocol locator。
3. 輸入英文 CDISC 搜尋字詞，例如 `age unit` 或 `MMSE total score`，再按「取得可能編碼」。
4. 檢查候選的 codelist、submission value、NCIt code、定義與版本；只有按「採用並寫入」才會改動欄位。
5. 人工補齊並確認 Domain、Variable、Implementation Guide 與 mapping 信心。
6. 排除右側「驗證」的所有阻擋項目，完成 Gate A 後檢查即時表單。
7. 完成 Gate B 後按「下載整包 ZIP」。

## 匯出內容

```text
<formId>-<schemaVersion>.zip
├─ analysis/program.yaml
├─ forms/<formId>/<schemaVersion>/crf-schema.json
├─ preview.html
├─ artifact-manifest.json
└─ README.md
```

`preview.html` 是自包含的離線審查表單，可下載包含 `data` 與平行 `coding.fields` 的 coded submission JSON。正式 Renderer 驗證仍應使用 ZIP 內的 `crf-schema.json` 執行 repository 既有的 `validate:schema`、`check`、`test` 與 `build`。

## 安全與審核原則

- CDISC Controlled Terminology 只提供提交編碼候選，不補充 protocol 未定義的臨床單位、範圍、選項、時點或必填性。
- `unresolved` mapping、未解決的 blocking item、Gate A 未核准或缺少來源 locator 都會阻擋 JSON 產生。
- Gate B 未核准時可以在 Studio 內檢查表單，但不能下載整包。
- 不要在 YAML、表單或下載檔中放入直接識別資訊。
- 自動化檢查只驗證軟體合約與 Renderer 行為，不代表臨床正確性、法規提交適用性或 QMS validation。

## 測試與 production build

```powershell
npm run studio:test
npm run studio:build
npm --prefix template/crf run studio:preview
```
