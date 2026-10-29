# Codex Clinical Form Studio — 三分鐘展示文案

## 0:00–0:28｜臨床試驗資料的問題

**旁白：**

臨床試驗需要準確、標準化，而且可以追溯的資料。

但將一份臨床試驗計畫書轉換成電子病例報告表，也就是 eCRF，至今仍然需要大量人工處理。

臨床團隊必須閱讀計畫書、找出需要收集的資料、設計欄位、設定驗證規則，並將資料對應到 CDISC CDASH 等標準。

當計畫書改版時，即使只修改一項條件，也可能同時影響多張表單、欄位定義、驗證規則與後續資料分析。

**畫面：**

Protocol → Excel 表格 → 人工建立表單 → 分散的 Mapping 文件。

---

## 0:28–0:52｜我們建立的解決方案

**旁白：**

我們建立了 Codex Clinical Form Studio。

它不是一個單次產生表單的 Prompt，而是一個由多個 Skills 組成的 Plugin。

使用者只需要上傳 Protocol，Orchestrator Skill 就會判斷目前的工作階段，依序引導使用者完成 Protocol 分析、表單設計、CDASH Mapping、臨床審核、自動測試與部署。

每一個步驟都有明確的輸入、輸出與人工核准點。

**畫面：**

Clinical Form Studio Plugin → Orchestrator → 專業 Skills 流程圖。

---

## 0:52–1:20｜GPT-5.6 與 Protocol Analysis Skill

**旁白：**

第一個階段是解析臨床試驗計畫書。

Orchestrator 會呼叫 Protocol Analysis Skill，並由 GPT-5.6 負責醫療內容與邏輯推理。

GPT-5.6 從 Protocol 中找出可能的表單、欄位、資料型別、單位、必填條件、選項與驗證規則，再將結果整理成結構化 YAML。

這份 YAML 是整個系統的單一規格來源。

臨床人員可以透過網頁介面檢查和修改內容，不需要直接編輯程式碼。

**畫面：**

Protocol 內容標記 → GPT-5.6 分析 → YAML → Form Builder。

---

## 1:20–1:48｜臨床編輯與 CDASH Mapping

**旁白：**

臨床人員可以直接新增、刪除、排序或修改欄位，也可以調整欄位型別、必填條件、數值範圍與選項。

接著，Orchestrator 會呼叫 CDASH Mapping Skill。

系統查詢經授權的 CDISC 資料來源，GPT-5.6 再根據欄位定義與 Protocol 上下文，排序可能的 CDASH Mapping，並說明推薦原因。

AI 負責提出候選項目，但最後的 Mapping 決定仍由臨床專業人員核准。

**畫面：**

編輯 Weight 欄位 → 搜尋 CDASH → 候選排名 → 人工核准。

---

## 1:48–2:10｜產生可執行的 eCRF

**旁白：**

規格核准後，Form Generation Skill 會將 YAML 轉換成標準化 JSON。

JSON-to-HTML Renderer 再根據這份模型，產生可實際操作的 eCRF，包括欄位控制項、必填設定、允許值、數值範圍與驗證行為。

產生的表單會先部署到驗證環境，讓臨床人員直接檢查實際操作流程。

**畫面：**

YAML → JSON → Renderer → 可操作的 eCRF。

---

## 2:10–2:36｜Codex 工程代理與自動化 QA

**旁白：**

Codex 負責把核准後的臨床規格真正轉換成可維護的工程成果。

Orchestrator 會指示 Codex 修改程式碼、產生資料庫 Migration、建立 pytest 與 Playwright 測試，並在真實瀏覽器中執行驗證。

測試會確認必填欄位不能略過、數值限制正確、選項完整，而且無效資料會被拒絕。

當測試失敗時，Codex 會追蹤問題來自 YAML 規格、Renderer，還是應用程式實作，修正後再次執行測試。

**畫面：**

Codex 修改程式 → pytest → Playwright → 測試失敗 → 修正 → 全部通過。

---

## 2:36–2:49｜Protocol 版本比較

**旁白：**

當新的 Protocol 版本上傳時，Version Comparison Skill 會比較前後兩版 YAML。

系統會標示新增、刪除與修改的欄位，以及必填條件、驗證規則、選項和 CDASH Mapping 的差異。

這讓每一次 Protocol Amendment 都能被清楚審查與追蹤。

**畫面：**

Protocol 1.0 與 1.1 → 欄位層級差異畫面。

---

## 2:49–3:00｜GitHub 與部署

**旁白：**

在這個流程中，GPT-5.6 負責解析複雜的醫療計畫書與 CDISC Mapping 推理；Codex 則負責程式開發、自動測試、錯誤修正與 Pull Request。

通過臨床審核與 QA 後，Codex 建立 GitHub Pull Request，CI/CD Pipeline 再將核准的 eCRF 部署到正式環境。

Codex Clinical Form Studio 將完整的 eCRF 製作流程，封裝成一套可重複使用、可測試，而且由人類掌握關鍵決策的 Plugin。

**畫面：**

Pull Request → GitHub Actions → Production eCRF。
