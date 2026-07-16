# **AirwayAI Clinical Trial Copilot: AI 與系統確定性邏輯分工架構書 V2**

在建立高合規要求的醫療級 Clinical Research Control Plane 時，最大的技術陷阱就是「把所有事情都交給 AI 處理」。本文件明確定義了 AirwayAI 專案中 **AI Agent (Codex/Gemini)** 與 **系統確定性邏輯 (Deterministic System)** 之間的分工界線，並詳細規劃了四個核心角色的 Codex Skills 組合與運作方式。核心理念為：**「AI 負責解析、生成與配置；系統負責邊界防守、邏輯運算與畫面渲染；最終由人類專家授權。」**

## **一、 AI (Codex & Agent) 負責的領域：彈性、解析與生成**

AI 擅長處理非結構化資料的轉換與繁瑣的代碼編寫，應將其定位為「具備強大工具箱的工程執行者」：

* **非結構化資料解析 (Protocol Parsing)：** 讀取 Word/PDF 臨床試驗計畫書，萃取臨床終點、收案條件與評估時程，轉化為機器可讀的 program.yaml。  
* **國際標準智能對齊 (CDISC Mapping)：** 根據醫學上下文，自動從 terminology.yaml 中挑選合適的 CDISC SDTM 變數代碼進行綁定。  
* **結構與測試生成 (Artifacts Generation)：** 根據上游變更，自動撰寫或更新 crf-schema.json、資料庫 Migration 腳本、以及邊界測試所需的模擬病人數據 (Synthetic Data)。  
* **沙盒編譯與自動化 PR (Sandbox & Git Automation)：** 在隔離的雲端沙盒中執行命令，修改多個關聯檔案後，自動建立 Git Pull Request、產出 Diff 報表，並在 changeLog.md 留下紀錄。

## **二、 系統 (Deterministic System) 負責的領域：確定性、渲染與防線**

系統邏輯負責處理必須 100% 準確、不可有幻覺的任務。這些是產品真正的技術護城河：

* **動態畫面渲染 (JSON-Driven Rendering)：** 前端 FormRenderer.tsx 不依賴 AI 寫 HTML。系統直接讀取 AI 產出的 crf-schema.json，根據預製的元件庫動態生成 eCRF 介面，達成「免重新編譯 (No Hardcoding)」且永不跑版。  
* **數值與統計運算 (Deterministic Calculation)：** AI 絕對不能「心算」臨床數據。所有的 AHI 下降率、Responder 判定、統計 P-value 都必須交由系統底層的 Python/R 程式或單元測試 (Pytest) 進行確定性運算。  
* **資料庫微觀版控與相容性 (Schema Drift Control)：** 系統強制解耦「填寫紀錄 (Data)」與「表單架構 (Schema)」。當版本升級 (v1.0 ➔ v2.0) 時，引擎負責加載對應歷史版本的 JSON 規格，確保舊病歷完美讀取。  
* **安全閘口與邏輯攔截 (Guardrails & Human-in-the-loop)：** 當偵測到 🚨 \[CROSS-AGENT IMPACT\] 標籤時，系統 CI/CD 自動鎖死合併權限，強制要求人類專家 (PI / 馬醫師) 審查簽章後才能放行。

## **三、 4 大角色 (Agents) 的 Codex Skills 組合與運作方式**

為了完美落實上述「AI 配置 vs 系統渲染」的架構，戰隊的 4 個 Agent 各自配備了專屬的 Codex Skills。AI 的任務不再是「寫網頁」，而是「決定臨床變數應對應哪一個預先寫好的系統元件」：

| 角色定位 | 專屬 Codex Skills 與運作行為   |
| :---- | :---- |
| **🧬 YuTing (Clinic Agent)** 臨床規格萃取與標準化 | **Skill 1: Protocol Parser (計畫書結構析取)**讀取上傳的 Word/PDF 計畫書，將文字轉化為機器可讀的 program.yaml，找出收案條件、Primary Endpoint (如 AHI) 與時程。 **Skill 2: CDISC Mapper (國際標準綁定)**調用 terminology.yaml，將找到的臨床變數自動對齊國際標準 (如判定「年齡」需加上 domain: "DM")。 |
| **📐 Ryan (SA Agent)** 元件映射與動態邏輯 | **Skill 3: UI Component Analyzer (元件映射與配置)**分析臨床變數型態，從預製的系統元件庫中挑選最適合的 UI 元件寫入 crf-schema.json。例如看到「SNB 點位三維座標」即指定使用 field\_type: "coordinate\_3d" 元件，絕不自己寫 HTML。 **Skill 4: Interdependence Builder (表單跳欄與依賴邏輯)**分析條件邏輯並轉化為 JSON 驅動的跳欄規則 (如 condition: "value \< 20" 則隱藏某元件)，由系統框架自動執行。 |
| **💾 Zozo (SD Agent)** 後端版控與系統過渡 | **Skill 5: Prompt Templating (精準提示詞工程)**撰寫與優化 LLM Prompt，確保 AI 解析計畫書時的穩定度。 **Skill 6: Schema Migration (資料庫遷移與版控)**當 Schema 變更時，自動產生對應的資料庫 Migration 腳本，確保系統在讀取舊病歷時能用舊版 Schema 完美呈現。 |
| **🧪 Ethan (QA Agent)** 邊界驗證與防線守護 | **Skill 7: Synthetic Data Generation (邊界測試資料合成)**根據 Schema 限制生成「正常」與「超出邊界」的模擬病人資料，測試系統攔截能力。 **Skill 8: Consistency Execution (沙盒一致性測試)**在 Codex 隔離沙盒中執行 test\_consistency.py，驗證 YAML、JSON 與資料庫三方是否一致，未通過則退回。 |

## **四、 完美協作範例：Protocol 變更傳導 (Change Propagation)**

以下為黑客松 Demo 中，4 個 Agent 的 Skills 與系統邏輯完美接力的工作流展示：

| 步驟 | 動作 | 負責方 (Agent/System)   |
| :---- | :---- | :---- |
| 1\. 觸發變更 | 使用者將主要評估時間從 Week 4 改為 Week 6 | **Human (PI)** |
| 2\. 規格與標準更新 | 解析新時程，重新對齊 CDISC 標準 | **YuTing (Skill 1, 2\)** |
| 3\. 介面配置修改 | 不寫 HTML，修改 crf-schema.json，將新欄位映射到系統現有的 UI 元件 | **Ryan (Skill 3, 4\)** |
| 4\. 產生遷移與測試 | 生成 Database Migration 腳本，並合成最新的測試數據集 | **Zozo (Skill 6\) & Ethan (Skill 7\)** |
| 5\. 執行驗證與申請 | 沙盒中跑過 Pytest，驗證無誤後，標記 🚨 \[CROSS-AGENT IMPACT\] 並開 PR | **Ethan (Skill 8\)** |
| 6\. 授權與鎖定機制 | 系統攔截 PR 不允許自動 Merge，等待 PI 點擊「Apply Approved Fix」 | **System (CI/CD)** |
| 7\. 動態表單重構 | PR 合併後，畫面免重新編譯，瞬間讀取新 JSON 重構含有 Week 6 欄位的 eCRF | **System (FormRenderer)** |

## **五、 總結**

這套多 Skills 協作架構完美展示了 **"Codex prepares, propagates, verifies and documents. Humans authorize."** 的原則。AI 不做科學決策、不自己算數學、不硬刻 HTML；它專注於繁瑣的規格轉換與代碼連動。而堅固的系統架構則負責接住 AI 的產出，透過確定性的渲染引擎、嚴格的資料庫版控與測試防線，確保醫療系統的 100% 安全與合規。