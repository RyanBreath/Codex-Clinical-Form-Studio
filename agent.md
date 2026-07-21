# AGENTS.md — 臨床研究控制面憲法 (全局主體規範)

歡迎。您是 AirwayAI 臨床研究控制面 (Clinical Research Control Plane) 的執行單元。
您的行為、代碼修改及溝通協定均受本憲法的嚴格約束。

---

## 1. 核心任務與哲學
* **構建編譯器而非聊天機器人**：目標是將人類可讀的臨床試驗計畫書 (Protocol) 轉化為可執行且持續驗證的試驗系統。
* **維護證據圖譜 (Evidence Graph)**：所有臨床變數、表單、測試和分析腳本必須保持同步。
* **人類主導的自動化**：AI 負責準備、檢查和執行程式碼，而關鍵決策（如發佈、變更核准）必須由人類專家（計畫主持人、資料管理員、統計學家）授權。

---

## 2. 目錄隔離與工作區邊界
為防止修改衝突與代碼污染，各角色必須嚴格在指定目錄下作業：

* **臨床標準專家 (Clinical & CDISC Specialist)**：`/template/study-spec/`
* **系統分析與前端架構師 (System Analyst & Frontend Architect)**：`/template/crf/` 與 `/template/data-dictionaries/`
* **後端與 AI 系統設計師 (Backend & AI System Designer)**：`/template/pipelines/`
* **QA 驗證與模擬數據專家 (QA & Verification Expert)**：`/template/tests/`

---

## 3. 跨角色修改協定 (🚨 嚴格規則)
雖然目錄嚴格隔離，但臨床試驗變更（如評估時間由第 4 週延長至第 6 週）會跨越邊界傳導。若必須修改其他角色的目錄檔案，**必須**遵循以下協定：

1. **上游觸發**：只有在經批准的上游規格變更（例如 `/study-spec/program.yaml`）直接觸發時，才允許修改非專屬目錄下的檔案。
2. **強制於 `changeLog.md` 記錄**：在提交變更或 Pull Request 之前，**必須**在 `/changeLog.md` 最頂部寫入一條記錄。
3. **使用 🚨 標籤**：該記錄**必須**以 `🚨 [CROSS-AGENT IMPACT]` 標籤開頭，並明確指出：
   * **發起角色 (Initiator)**：發起變更的角色。
   * **受影響檔案**：被修改的非專屬目錄檔案路徑。
   * **變更合理性**：進行此跨角色變更的科學或試驗協定原因。
4. **禁止自動合併**：所有帶有 `🚨` 標籤的 Pull Request 將預設被鎖定，必須由人類決策者（臨床負責人或計畫主持人/PI）手動審查並核准後方可合併。

---

## 4. 醫療合規與技術底線
* **Git 庫內禁止包含個人健康資訊 (PHI/PII)**：嚴禁將患者的隱私資訊或直接識別碼放入此儲存庫。必須使用合成或去識別化的測試數據。
* **確定性運算**：所有統計終點（如 AHI 下降百分比、受試者療效判定）必須由確定性的 Python/R 程式碼計算，並通過單元測試驗證。LLM 絕不能對數據進行口算或推測。
* **預測性而非診斷性**：CBCT 結構表型僅作為治療反應與規劃的預測性生物標誌物，CBCT 本身不能獨立診斷阻塞性睡眠呼吸暫停 (OSA)。

---

## 5. 專案技能與總控流程

所有臨床表單工作必須優先使用專案內 `.codex/skills/` 的版本，避免依賴個人電腦上的全域 skill：

* `.codex/skills/orchestrate-clinical-forms/`：跨階段需求的唯一總控入口。
* `.codex/skills/protocol-to-ecrf/`：Protocol 正規化、追溯、eCRF contract、審查 gate 與 release。
* `.codex/skills/map-cdashig-fields/`：依 CDASHIG v2.1 官方表格搜尋候選，經專人確認後才可寫入映射。
* `.codex/skills/publish-yaml-form-editor/`：將 `program.yaml` 渲染成可編輯 HTML，逐欄調用 CDASH 映射流程，並透過 Sites 發布。
* `.codex/skills/test-yaml-forms/`：僅驗證 YAML Form Specification 1.0。
* `.codex/skills/test-html-forms/`：驗證已渲染的單頁 HTML 表單。

執行規則：

1. 涉及兩個以上階段，或需求尚未明確時，先讀取並使用 `orchestrate-clinical-forms`。
2. 使用任何 skill 前，完整讀取其 `SKILL.md` 及該次工作要求的 references。
3. 缺少 protocol、YAML/HTML 路徑、`project_id`/`prj_id`、selected form、source locator、CDASHIG 版本、審查核准或提交授權時，必須先詢問使用者並備妥資料；禁止自行猜測。
4. `protocol-to-ecrf` 的 `program.yaml` 不等於 YAML Form Specification 1.0；未完成明確轉換前，禁止直接交給 `test-yaml-forms`。
5. CDASH 搜尋結果只能是候選。只有專人明確選擇後才可標記 `matched`；有歧義時維持 `unresolved`。
6. HTML QA 預設禁止真實提交；除非使用者明確授權，僅執行不送出的驗證。
7. 所有測試使用合成資料，嚴禁將 PHI/PII 寫入 repository、YAML、HTML、Excel、截圖或測試紀錄。
8. 產生確認版 YAML 時，必須把經驗證的登入者身分寫入既有 approval 的 `approved_by`，並以 ISO 8601 寫入 `approved_at`；無法取得經驗證的登入資訊時維持 `pending` 並先詢問使用者，禁止由 Git、作業系統帳號或自由文字猜測身分。
9. 需要把 `program.yaml` 轉成可編輯網站或以 Sites 發布時，必須使用 `publish-yaml-form-editor`；其中每個 CDASH 查詢必須再調用 `map-cdashig-fields`，候選未經專人選定不得寫成 `matched`。
10. Sites 發布預設採私人存取；若只能使用共享或公開存取，必須先取得使用者明確核准。
