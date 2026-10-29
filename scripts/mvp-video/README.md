# MVP 情境影片產線

唯一原稿為 `Docs/planning/MVP情境影片腳本.md`，使用者於 2026-10-29 核准。影片與錄影、旁白、字幕、驗證報告在 `output/video/mvp-20261029/`，不納入版本控制。既有 `clinical-form-video/` 的七月影片不覆寫。

工具：Node.js、PowerShell 7、Windows PowerShell 的 System.Speech、FFmpeg／FFprobe、Chrome。外部工具 Playwright 1.61.1、GSAP 3.14.2 安裝於 `%TEMP%/clinical-mvp-video-tools/`；HyperFrames 固定 0.8.150，由 npx 執行，已停用遙測。旁白使用使用者同意的本機 Microsoft Hanhan Desktop，不需要或傳送雲端配音金鑰。

在 repository 根目錄執行：

```powershell
node scripts/mvp-video/prepare.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mvp-video/voice.ps1 -OutputDirectory output/video/mvp-20261029
```

旁白產生後執行 `node scripts/mvp-video/prepare.mjs --measure`，以 ffprobe 自動量測各鏡頭音訊長度；之後再錄影。獨立終端執行 `pwsh -NoProfile -File scripts/mvp-video/start-capture.ps1`，它以新資料庫與 loopback 5199 啟動既有 MVP 發行包，不停止 5198。

```powershell
node scripts/mvp-video/record.cjs
node scripts/mvp-video/build.mjs
pwsh -NoProfile -File scripts/mvp-video/render.ps1
node scripts/mvp-video/verify.mjs
```

錄影程式在鏡頭外建立合成研究與角色，實際操作預置草稿的編輯／發布、ICF 核准、收集依據、訪視、填答、審閱、鎖定、匯出與唯讀嵌入。每鏡頭等待配音長度，輸出 WebM 與鏡頭 JSON。合成輸出 MP4、SRT 及章節表，渲染以 `artifact validated` 為成功條件，仍須執行解碼與逐鏡頭畫面檢查。

可用 `check-voice.ps1` 執行本機繁中語音辨識比對；辨識會誤判同音字和數字單位，不能以辨識結果自動改寫核准旁白。影片第一版仍交使用者用耳朵檢視。

錄製環境完成任務後，關閉自己啟動的 5199 程序，再執行 `pwsh -NoProfile -File scripts/mvp-video/cleanup-capture.ps1`。它驗證錄製用資料庫名稱及設定，只清理本次錄製資料庫。原始 WebM 與媒體資產保留供檢查與重剪；不使用全域或跨 shell 的遞迴清除。
