# Protocol to eCRF Skill：操作、審核與發布 SOP

> 本文件說明如何在 Codex 指定一份 Protocol，依序產生 `program.yaml`、AirwayAI eCRF JSON、React 靜態網站與選配的 IIS／NGINX 部署包。所有產出一律是 **Demo 工程產物**，不可視為臨床核准、Production release 或 QMS validation 證據。

## 一、目前是否已能完成整條流程？

可以，但必須區分 AI 工作與確定性工具：

| 階段 | 執行者 | 目前能力 |
| --- | --- | --- |
| 指定 Protocol | 使用者／Codex | 支援本機或附件中的 PDF、DOCX、Markdown、TXT |
| 解析 Protocol | Codex Skill | 擷取候選表單、欄位、時程、條件與來源位置；不確定內容列入 unresolved item |
| 產生 `program.yaml` | Codex Skill | 建立可追溯的中介臨床規格，先停下等待人工確認 |
| 產生 `crf-schema.json` | Codex Skill | 只把已確認內容映射成 JSON Schema 與 `x-airwayai` UI 合約 |
| 合約與程式檢查 | npm／Vitest／AJV | 檢查 JSON Schema、AirwayAI meta-schema、語意規則、型別與 Renderer 行為 |
| React HTML 建置 | Vite | 將選定 schema 編譯進可攜式靜態網站 |
| 瀏覽器驗收 | Playwright | 對 Chromium、Firefox、WebKit 執行 release smoke test |
| IIS／NGINX 包裝 | release script | 產生 `site/`、設定範本、manifest、驗證報告與 ZIP |
| 外部部署 | 使用者／維運人員 | Skill 不會自行登入或複製到正式伺服器；必須另行授權與執行 |

這不是「瀏覽器上傳平台」。它是 Codex 內的受控開發流程：使用者指定 Protocol 後，Codex 讀取、分析、詢問、產檔並呼叫專案內的測試與建置工具。

## 二、Skill 安裝位置與啟動方式

Skill 已安裝在：

```text
C:\Users\ryan\.codex\skills\protocol-to-ecrf\
```

典型啟動提示：

```text
使用 $protocol-to-ecrf 處理
C:\Protocols\Study-ABC-Protocol-v2.1.pdf

Repository：
C:\Users\ryan\我的雲端硬碟\專案\Hackathon-ClinicalTrail
```

也可以把 Protocol 附加到 Codex，然後說：

```text
使用 $protocol-to-ecrf 處理我剛附加的 Protocol。
```

啟動前請確認：

- Node.js 24 與 npm 11 可用。
- `template/crf/node_modules/` 尚未安裝時，先在 `template/crf/` 執行 `npm ci`。
- Protocol 不含 PHI 或直接識別資訊。
- PDF 若是掃描影像，OCR 結果必須額外審查。

## 三、每次執行的獨立專案工作包

Skill 會執行：

```powershell
& 'C:\Users\ryan\.codex\skills\protocol-to-ecrf\scripts\new-project.ps1' `
  -RepositoryRoot 'C:\Users\ryan\我的雲端硬碟\專案\Hackathon-ClinicalTrail' `
  -ProtocolPath 'C:\Protocols\Study-ABC-Protocol-v2.1.pdf'
```

然後建立分鐘級時間戳目錄：

```text
2.SA/projects/
└─ prj_yyyyMMdd-HHmm/
   ├─ source/
   │  ├─ <原始 Protocol 檔案>
   │  └─ source-manifest.json
   ├─ analysis/
   │  ├─ program.yaml
   │  ├─ source-traceability.md
   │  └─ unresolved-items.md
   ├─ forms/
   │  └─ <formId>/<schemaVersion>/
   │     ├─ crf-schema.json
   │     └─ validation-report.md
   └─ releases/
      └─ <formId>/<schemaVersion>/
         ├─ site/
         ├─ web.config
         ├─ nginx.conf.example
         ├─ crf-schema.json
         ├─ program.yaml
         ├─ release-manifest.json
         ├─ release-validation-report.md
         ├─ DEPLOYMENT.md
         └─ <formId>-<schemaVersion>.zip
```

`source-manifest.json` 保存原檔名、大小、SHA-256 與複製時間，用來證明分析時使用哪一份來源。Skill 不修改原始 Protocol，也不覆寫已存在的 `prj_...`。

`2.SA/projects/` 已加入 `.gitignore`。原因是 Protocol 與分析結果可能包含機密試驗內容；只有明確確認為合成或已去識別的檔案，才可由使用者另外決定是否納入版本控制。

## 四、完整流程與兩道人工作業關卡

```mermaid
flowchart TD
    A["指定 Protocol"] --> B["建立 prj_yyyyMMdd-HHmm 工作包"]
    B --> C["擷取內容與來源位置"]
    C --> D["program.yaml + traceability + unresolved items"]
    D --> E{"Gate A：臨床語意確認"}
    E -- "退回" --> C
    E -- "核准" --> F["選一張表單並產生 crf-schema.json"]
    F --> G["合約、型別、單元與 build 驗證"]
    G --> H{"Gate B：表單契約確認"}
    H -- "退回" --> F
    H -- "核准" --> I{"詢問發布方式"}
    I -- "本機預覽" --> J["Vite dev server"]
    I -- "IIS／NGINX／both" --> K["release site + config + ZIP"]
```

### 步驟 1：解析 Protocol

Codex 應擷取並追溯：

- Protocol 標題、版本與日期。
- 研究目的、endpoint、visit／timepoint 與 assessment。
- Protocol 中可辨識的候選表單。
- 每個欄位的資料型別、必填性、單位、範圍、選項、條件與計算。
- 來源章節、頁碼、表格或段落位置。
- 擷取方式是 native text、OCR 或 mixed。
- 信心為 high、medium 或 low；信心不等於核准。

不可從常識自行補上 Protocol 沒有明確支持的單位、範圍、選項、時間點或公式。

### 步驟 2：建立 `program.yaml`

`program.yaml` 是 Protocol 與 React JSON 之間的必要中介層。核心內容包括：

```yaml
contract_version: "1.0.0"
project_id: "prj_yyyyMMdd-HHmm"
source:
  file_name: "protocol.pdf"
  sha256: "..."
  protocol_title: "..."
  protocol_version: "..."
  extraction_method: "native-text"

candidate_forms:
  - candidate_id: "baseline-assessment"
    title: "Baseline assessment"
    source_refs:
      - locator: "Section 8.2, page 42"
        confidence: "high"

selected_form:
  candidate_id: "baseline-assessment"
  approval_status: "pending"
  fields: []

unresolved_items: []

approvals:
  clinical_meaning:
    status: "pending"
  form_contract:
    status: "pending"
```

完整欄位契約位於 Skill 的 `references/program-yaml-contract.md`。

### Gate A：確認臨床語意

Codex 一次只處理一張 eCRF。它會先列出候選表單，請使用者選擇，再呈現：

- 表單用途與所屬 visit。
- 欄位、型別、必填性、單位、範圍與選項。
- 顯示／啟用／動態必填條件。
- 計算欄位與來源欄位。
- 來源定位、信心與矛盾。
- 所有 unresolved items。

只要還有未解決且會影響資料契約的 `blocking` item，就不能產生正式 JSON。使用者確認後，才將 `approvals.clinical_meaning.status` 更新為 `approved`。

### 步驟 3：產生版本化 eCRF JSON

新 Demo 表單預設：

- `contractVersion: "1.0.0"`
- `schemaVersion: "0.1.0"`
- `status: "demo"`
- `defaultLocale: "zh-TW"`
- 顯示非正式臨床使用 disclaimer
- `additionalProperties: false`

輸出位置固定為：

```text
forms/<formId>/<schemaVersion>/crf-schema.json
```

Skill 只使用現有固定 widget 與 Predicate／computed AST。無法安全映射時會阻擋，不會為單一 Protocol 偷改共用 `FormRenderer`。

### 步驟 4：驗證目標 JSON

在 PowerShell 執行：

```powershell
Set-Location 'C:\Users\ryan\我的雲端硬碟\專案\Hackathon-ClinicalTrail\template\crf'

npm run validate:schema -- --schema '<crf-schema.json 絕對路徑>'
npm run check
npm test

$env:AIRWAYAI_CRF_SCHEMA_PATH = '<crf-schema.json 絕對路徑>'
npm run build
Remove-Item Env:\AIRWAYAI_CRF_SCHEMA_PATH
```

各指令意義：

| 指令 | 證明內容 |
| --- | --- |
| `validate:schema` | 指定 JSON 通過 Draft 2020-12、AirwayAI meta-schema 與語意編譯器 |
| `check` | TypeScript、合約與規則引擎核心測試通過 |
| `test` | Renderer 元件、active data、條件、計算、readonly 與無障礙測試通過 |
| `build` | library 與指定 schema 的 Demo 均能建置 |

測試通過只代表軟體契約與 Renderer 可執行，不代表臨床語意正確。

### Gate B：確認表單契約

Codex 必須呈現欄位清單、條件路徑、計算路徑、warning、active-data 行為與測試結果。使用者核准後，才將 `approvals.form_contract.status` 更新為 `approved`。

Release 工具會重新解析 `program.yaml`；Gate A 或 Gate B 任一不是 `approved`、仍有未解決 blocking item、或缺少追溯／驗證文件時，會拒絕打包。

## 五、本機預覽

若只要看畫面、不產生 release：

```powershell
Set-Location 'C:\Users\ryan\我的雲端硬碟\專案\Hackathon-ClinicalTrail\template\crf'
$env:AIRWAYAI_CRF_SCHEMA_PATH = '<crf-schema.json 絕對路徑>'
npm run dev
```

開啟終端機顯示的 `http://127.0.0.1:4173/`。結束時按 `Ctrl+C`，再執行：

```powershell
Remove-Item Env:\AIRWAYAI_CRF_SCHEMA_PATH
```

不可直接雙擊 `index.html`，因為 `file://` 無法提供 Vite／ES Module 所需的 HTTP origin。

## 六、建立 IIS／NGINX 部署包

Gate B 核准後，Skill 必須先問：

1. 是否需要部署包。
2. 目標為 IIS、NGINX、兩者或只要一般靜態包。
3. 掛載在網站根目錄 `/` 或子路徑，例如 `/forms/baseline/`。

使用者回答後執行：

```powershell
Set-Location 'C:\Users\ryan\我的雲端硬碟\專案\Hackathon-ClinicalTrail\template\crf'

npm run release -- `
  --schema '<crf-schema.json 絕對路徑>' `
  --project '<prj_yyyyMMdd-HHmm 絕對路徑>' `
  --target both `
  --mount-path '/forms/baseline/'
```

`--target` 可用：

| 值 | 產出 |
| --- | --- |
| `none` | 一般靜態 `site/`、證據與 ZIP，不附 server config |
| `iis` | 加入 `web.config`，並在 `site/` 內放置可直接使用的副本 |
| `nginx` | 加入 `nginx.conf.example` |
| `both` | 同時加入 IIS 與 NGINX 範本 |

Release 會重新執行：

- 目標 schema 合約驗證。
- TypeScript 與規則引擎檢查。
- 全部 Vitest／React Testing Library 測試。
- 可匯入 library build。
- 指定 schema 靜態 build。
- Chromium、Firefox、WebKit release smoke test。

任一步驟失敗都不會建立正式 release 目錄。

## 七、部署到 IIS

1. 建立 IIS Website、Application 或 Virtual Directory。
2. 將 release 中 `site/` 的**內容**複製到實際 web root。
3. 確認 IIS Static Content 功能已啟用。
4. 若產出包含 `web.config`，保留 `site/web.config`。
5. 以實際 HTTP／HTTPS 網址開啟，不要用 `file://`。
6. 若放在子路徑，使用建立 release 時相同的 `--mount-path` 進行驗收。

此 Demo 沒有後端 API、登入、資料庫、audit trail 或正式安全邊界；不得直接當成正式臨床收案系統。

## 八、部署到 NGINX

1. 將 `site/` 複製到伺服器的唯讀靜態目錄。
2. 開啟 `nginx.conf.example`。
3. 將 `alias` 改為伺服器上的 `site/` 絕對路徑。
4. 將 `location` 保持為建置時指定的 mount path。
5. 執行 `nginx -t`，確認設定正確後再 reload。
6. 以實際 HTTP／HTTPS 網址驗收表單與 `assets/` 載入。

Vite 建置後會把入口 asset URL 改為 `./assets/...`，因此同一份 `site/` 可部署在根目錄或子路徑。

## 九、版本、不覆寫與 Protocol amendment

- `prj_yyyyMMdd-HHmm` 是一次分析工作包，不覆寫舊專案。
- `<formId>/<schemaVersion>` 是不可變表單快照。
- Release 已存在時打包工具會停止，不會覆寫。
- 破壞欄位契約升 major；新增選填欄位升 minor；純文案修正升 patch。
- Protocol amendment 應建立新 `prj_...`，保留新來源 SHA-256，重新經過 Gate A 與 Gate B。

## 十、Fail-closed 情境

遇到下列情況，Skill 或 release 工具必須停止：

- Protocol 含疑似 PHI 或直接識別資訊。
- OCR 造成關鍵臨床敘述無法確認。
- Protocol 章節互相矛盾。
- 欄位單位、範圍、選項、時程、必填性或計算規則不明。
- 找不到可靠來源位置。
- 欄位無法映射到現有安全 widget。
- JSON 路徑懸空、型別不相容、ID 重複或計算循環。
- Gate A／Gate B 未核准。
- 任何自動測試、build 或三瀏覽器 smoke test 失敗。
- 同一版本的 release 已存在。

## 十一、交付檢查表

- [ ] Protocol 已複製到獨立 `prj_.../source/`，SHA-256 manifest 已產生。
- [ ] `program.yaml` 每個重要概念都有來源定位。
- [ ] 所有 blocking unresolved item 已解決。
- [ ] 使用者已選擇一張表單並通過 Gate A。
- [ ] JSON 是 Demo 狀態、版本化且未覆寫舊版。
- [ ] `validate:schema`、`check`、`test`、`build` 通過。
- [ ] 使用者已檢閱欄位、條件、計算與 active data，通過 Gate B。
- [ ] Skill 已詢問是否建立部署包及目標／mount path。
- [ ] Release manifest、驗證報告與 ZIP 已產生。
- [ ] 只把 `site/` 部署到 web root，Protocol 不進公開網站。
