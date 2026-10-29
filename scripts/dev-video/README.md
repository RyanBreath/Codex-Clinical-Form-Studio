# 開發介接技術影片

唯一原稿：`Docs/planning/開發介接技術影片腳本.md`，使用者已確認。輸出：`output/video/dev-20261029/`，不覆寫前一支 MVP 情境影片。

## 執行順序

在 repository 根目錄：

```powershell
node scripts/dev-video/prepare.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mvp-video/voice.ps1 -OutputDirectory output/video/dev-20261029
node scripts/dev-video/prepare.mjs --measure
```

另一終端執行 `pwsh -NoProfile -File scripts/dev-video/start-capture.ps1`。沿用本專案 PostgreSQL 容器，但建立隨機命名的獨立錄製資料庫與 5199 API，不修改既有 5198 MVP 資料。

```powershell
dotnet test tests/FormPlatform.IntegrationTests --no-build --filter FullyQualifiedName~BearerAuthenticationTests --logger "trx;LogFileName=bearer-technical.trx" --results-directory output/video/dev-20261029/test-evidence --verbosity quiet
node scripts/dev-video/record.cjs
node scripts/dev-video/verify-evidence.mjs
node scripts/dev-video/source-check.mjs
node scripts/dev-video/contract-overlay.cjs
node scripts/dev-video/build.mjs
pwsh -NoProfile -File scripts/dev-video/render.ps1
node scripts/dev-video/verify.mjs
```

音訊先產生，錄影依音訊長度及技術閱讀停留時間排鏡頭。契約回應較長的段落以 contract-overlay.cjs 從實際 HTTP 證據產生可閱讀的欄位摘錄，合成時只覆蓋原本過長的技術展示區段，不修改 API 結果；其他操作維持實錄。來源程式片段讀取當前原始碼，請求與回應由實際 API 呼叫取得。瀏覽器用於呈現可閱讀的技術走讀畫面及實際嵌入入口；它不是產品新增的 API console。

## 證據與範例

- `api-evidence.json`：錄製時各請求的 method、路徑、合成身分、request、HTTP status 與 response。
- `scenario-result.json`：錄製流程的最後 ID、修訂、鎖定、匯出及去重檢查結果。
- `bearer-test-summary.json`：由實際 TRX 成功結果衍生的檢查摘要，不顯示電腦名稱、個人帳號或原始 token。
- `recording.json`：各鏡頭起訖及旁白長度。
- `verification-report.json`：成片格式、完整解碼、音量及逐段抽幀結果。

`node scripts/dev-video/api-example.mjs` 是可獨立重跑的合成 API 範例，需要啟動中的本次錄製環境；每次建立新的合成研究，執行去重、衝突、鎖定與匯出斷言，不需要旁白或瀏覽器。不可改成對正式系統送出，也不接受生產憑證。每次執行使用獨立的 command key 前綴，所以不同次範例不會誤撞同一整合帳號的全域去重識別。

## 認證界線

影片一般 API 實錄使用 Development 合成身分標頭，畫面明確標示；正式 Bearer 的 issuer／audience／簽章及停用檢查由獨立 middleware 測試驗證。測試使用本機 RSA 簽章與固定設定，不宣稱已完成外部 IdP 或實際 CTMS 聯調。

範例包括 platform 角色準備表單及收集依據，不能把這些操作偽裝成整合帳號擁有研究核准或同意確認權限。`integrations/responses` 建立 draft，不自動送審。

## 清理

錄畢關閉自己啟動的 5199 API，再執行 `pwsh -NoProfile -File scripts/dev-video/cleanup-capture.ps1`，只清理該次隨機命名的錄製資料庫。原始 WebM／音訊保留作本機媒體證據，不公開、不上傳。

工具沿用上一支影片的 repository 外 Playwright 1.61.1、GSAP 3.14.2、HyperFrames 0.8.150，及本機 Hanhan 繁中語音。詳見 `scripts/mvp-video/README.md`。

## 另外輸出 SRT 同步女聲 MP3

```powershell
node scripts/dev-video/voice-variant.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-video/voice-variant.ps1
node scripts/dev-video/mix-voice-variant.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-video/check-voice-variant.ps1
```

輸出固定放在 `output/video/dev-20261029/voice-neutral-tw/`，保留原 MP4、SRT 與原音軌。直接讀既有 SRT，不另複製旁白原稿；技術名詞的口語讀法、適度重點與 SSML 設定在 `voice-variant.mjs`。使用本機成人女聲 Hanhan（zh-TW），基準語速 −5%、音高 −2%，不使用雲端 TTS 或背景音樂。桌面合成聲音的自然度有限，不宣稱等同真人或神經語音。

每則語音移除首尾合成靜音後，用保留音高的 `atempo` 適配原字幕時槽，逐句在原開始時間置入，保留章節空白；不截斷內容、不修改字幕文字或時間碼。多數句子維持平穩節奏，但原字幕第 22、25、26、70 則短句需要較明顯壓縮，不能同時保證全段偏慢。最大時間壓縮約 1.624 倍，詳見 `verification.json`。

成品為 48 kHz／192 kbps／單聲道 MP3，384.1 秒。檢查包括 86 則語音未超出字幕時槽、完整 MP3 解碼、音量與時長，以及 7 則關鍵句本機辨識抽查；辨識有同音字與專有名詞誤差，僅輔助檢查，不代表人工聽審通過。`試聽-開場與架構.mp3` 提供前 27 秒試聽。
