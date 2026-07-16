# **AirwayAI Clinical Trial Copilot: 樣板協作架構與規範 V2**

---

本文件為 AirwayAI Clinical Trial Copilot 團隊（YuTing、Ryan、Zozo、Ethan，以及指導者馬醫師）的「通用樣板協作規範」。架構核心除了透過 AGENTS.md 作為全域 Master 規範、置頂 changeLog.md 紀錄跨界變更外，更納入了 **5 個獨立的 agent-\*.md 設定檔定位與規範**，讓 AI Agent 或開發者能精準讀取、遵循合規邊界。

## **一、 通用樣板專案資料夾結構 (Template Directory Layout)**

---

此結構為通用研究專案之樣板。每個角色在自己定位的專屬目錄下擁有主要修改權限，並需遵循對應的 agent-\*.md 規範定義。

`airwayai-copilot-template/           # 專案根目錄 (通用樣板)`  
`├── AGENTS.md                        # 全域 Master 規範 (定義角色邊界與跨界修訂規範)`  
`├── changeLog.md                     # 置頂變更日誌 (強烈凸顯「跨角色變更」與「臨床變更傳導」)`  
`│`  
`├── agent.md                         # 【全域 Master 規範】定義專案架構、技術標準與協同溝通合約`  
`├── agent-clinic.md                  # 【YuTing (Clinic) 規範】臨床領域與 CDISC 欄位規格專家定義`  
`├── agent-SA.md                      # 【Ryan (SA) 規範】JSON Schema 設計與動態渲染引擎架構專家定義`  
`├── agent-SD.md                      # 【Zozo (SD) 規範】Gemini API 提示詞與後端版控 API 開發專家定義`  
`├── agent-QA.md                      # 【Ethan (QA) 規範】測試資料生成與跨版本相容性驗證專家定義`  
`│`  
`└── template/                        # 通用樣板主目錄`  
    `├── study-spec/                  # ─── 【YuTing (Clinic) 專屬領地】 ───`  
    `│   ├── program.yaml             # 臨床研究計畫書結構化規格 (例如收案與評估時間)`  
    `│   └── terminology.yaml         # CDISC 控制詞彙與欄位標準`  
    `├── crf/                         # ─── 【Ryan (SA) 專屬領地 (UI)】 ───`  
    `│   └── FormRenderer.tsx         # 動態表單渲染元件核心`  
    `├── data-dictionaries/           # ─── 【Ryan (SA) 專屬領地 (合約)】 ───`  
    `│   └── crf-schema.json          # 根據研究規格編譯出的 JSON Schema`  
    `├── pipelines/                   # ─── 【Zozo (SD) 專屬領地】 ───`  
    `│   ├── ai-compiler/             # Gemini 擷取與編譯 Protocol 之 Prompt 模板`  
    `│   └── migrations/              # 資料庫 schema 遷移與版本控制腳本`  
    `└── tests/                       # ─── 【Ethan (QA) 專屬領地】 ───`  
        `├── synthetic-data/          # 模擬病人測試數據集 (CSV/JSON)`  
        `└── test_consistency.py      # 臨床規格、CRF、與後端資料的一致性驗證測試`

## **二、 五個 agent\*.md 定位與規格規範**

---

為了使各個 Agent 能夠在各自的專業領域中自主、安全地運作，我們定義了以下 5 個規範檔案。這些檔案是 AI 在讀取儲存庫（Repository）時用來初始化其行為的「系統指令」或「角色合約」：

### **1\. agent.md (全域 Master 規範)**

* **定位：** 整體架構大腦與「通訊協定」。  
* **職責：**  
  * 定義專案的整體目錄結構、底層技術棧規範。  
  * 定義跨 Agent 變更的傳導機制與衝突檢索策略。  
  * 宣告「人類審查與授權（馬醫師）」為最高決策點，AI 不得自主 Merge 標有 🚨 的代碼。

### **2\. agent-clinic.md (YuTing / Clinic Expert)**

* **定位：** 臨床領域、醫學規範與 CDISC 欄位規格專家。  
* **職責：**  
  * 指導 Protocol（試驗計畫書）的結構化（輸出 program.yaml）。  
  * 確保表單欄位名稱與單位符合 CDISC 標準，並維護 terminology.yaml。  
  * 制定隨訪事件（Visits）與臨床評估時間點（例如 Week 4 / Week 6）。

### **3\. agent-SA.md (Ryan / SA & UI Expert)**

* **定位：** JSON Schema 設計與前端動態表單渲染架構專家。  
* **職責：**  
  * 將 study-spec/ 下的臨床規格轉譯為標準的 JSON Schema（crf-schema.json）。  
  * 開發並維護能夠吃 JSON 規格、不需硬編碼（No Hardcoding）即可動態渲染表單的前端引擎（FormRenderer.tsx）。  
  * 設計動態跳欄、邏輯校驗（Validation rules）的渲染與綁定。

### **4\. agent-SD.md (Zozo / Backend & LLM Developer)**

* **定位：** Gemini API 提示詞設計、數據遷移（Migration）與版控 API 專家。  
* **職責：**  
  * 編寫與優化用來自動從 PDF 計畫書中析取（Extract）資訊的 Gemini Prompt 模板。  
  * 開發微觀版本控制邏輯，處理破壞性與非破壞性 schema 變更（Migration 腳本）。  
  * 確保歷史數據讀取時的架構回溯與相容。

### **5\. agent-QA.md (Ethan / Verification & Testing Expert)**

* **定位：** 測試資料（Synthetic Data）生成與跨版本資料一致性驗證專家。  
* **職責：**  
  * 根據 crf-schema.json 與 terminology.yaml 動態生成符合邊界條件的模擬病人測試數據。  
  * 撰寫 test\_consistency.py 等腳本，驗證臨床規格與最終程式碼、資料庫中的欄位設定是否 100% 一致（如主評估時間變更時的完整傳導校驗）。

## **三、 跨角色協作之 changeLog.md 高亮凸顯機制**

---

在快節奏的開發階段，若因臨床規格變更（如 Protocol Amendment）需要進行跨越專屬目錄的修改時，Agent **必須在最上層的 changeLog.md 中進行申報：**

### **1\. 變更申報規則**

* **一般內部變更：** 若變更僅限於 Agent 自身專屬目錄，使用常規日誌格式記錄即可。  
* **跨界變更（Cross-Agent Impact）：** 若修改非專屬目錄下的檔案，**必須**在日誌最頂部以 🚨 \[CROSS-AGENT IMPACT\] 標籤進行強烈高亮視覺凸顯，並標註觸發源（Initiator）與異動原因。

### **2\. changeLog.md 實例**

`# Clinical Copilot Template Change Log`

`This log tracks all executable design changes, schema updates, and cross-agent modifications.`  
`If your change affects files outside your assigned workspace, you **MUST** flag it with the 🚨 icon and detail the reason.`

`---`

`## [Active Draft / Pending Approval]`

`### 🚨 [CROSS-AGENT IMPACT] Protocol Amendment: Primary Endpoint Evaluation Extended to Week 6`  
``* **Initiator:** `agent-clinic` (YuTing / guided by `agent-clinic.md`)``  
`* **Date:** 2026-07-14`  
`* **Trigger Event:** Decision to shift primary endpoint evaluation time window from Week 4 to Week 6.`  
`* **Cross-Agent Changes Executed:**`  
  ``* 🔴 **`agent-clinic` (YuTing)** modified `/template/study-spec/program.yaml` to update `duration_weeks: 6`.``  
  ``* ⚠️ **`agent-SA` (Ryan)** auto-triggered to update `/template/data-dictionaries/crf-schema.json` to alter visit mappings.``  
  ``* ⚠️ **`agent-SD` (Zozo)** updated database migration schema for safe transition.``  
  ``* ⚠️ **`agent-QA` (Ethan)** adjusted consistency test scripts to generate week 6 synthetic parameters.``  
``* **Human Approval Status:** `[PENDING]` (Requires PI/馬醫師 sign-off before Git merge).``

## **四、 全域憲法 AGENTS.md 隔離與安全閘口**

1. ---

   **上游觸發 (Trigger-based Edit)：** Agent 僅在有上游（例如 /study-spec/）臨床規格變更為前提下，才被允許去提議修改其他角色的目錄檔案。  
2. **角色對齊：** 所有的程式碼變更與自主 PR 提交時，Agent 必須讀取對應的 agent-\*.md 規則，並在 Commit message 或 PR 說明中宣告對齊其職責定位。  
3. **安全閘口：** 含有 🚨 標籤的變更將被 CI/CD 自動掛起並鎖定，必須由人類決策者（馬醫師 / PI）手動簽名核准（Human-in-the-loop）方可合入 Main 分支。