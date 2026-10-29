import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out = path.resolve('output/video/mvp-20261029');
const report = JSON.parse(fs.readFileSync(path.join(out,'verification-report.json'),'utf8'));
const composition = JSON.parse(fs.readFileSync(path.join(out,'composition.json'),'utf8'));
const environment = JSON.parse(fs.readFileSync(path.join(out,'capture-env.json'),'utf8').replace(/^\uFEFF/,''));
if (report.decode !== 'passed' || !environment.databaseRemoved) throw new Error('Verification or environment cleanup not complete');
const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(out,report.file))).digest('hex');
const duration = `${Math.floor(report.duration/60)} 分 ${Math.round(report.duration%60)} 秒`;
const relative = `../../output/video/mvp-20261029/${report.file}`;
const timestamp = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const chapters = composition.chapters.map(chapter => `| ${timestamp(chapter.start)} | ${chapter.title} |`).join('\n');
const guide = `# MVP 實際操作影片導覽

更新：2026-10-29。這是目前灰階／冷藍 MVP 的新版實際操作影片，與七月的舊展示影片不同。第一版已完成，待使用者觀看；本機交付，未上傳 Drive 或公開平台。

## 播放與下載

- [播放／下載 MP4](${relative})：${duration}，1920×1080、30fps，繁中電腦女聲與燒錄中文字幕，無背景音樂。
- [中文字幕 SRT](../../output/video/mvp-20261029/MVP1.srt)。
- [章節時間表](../../output/video/mvp-20261029/chapters.txt)。
- [已確認的分鏡原稿](../planning/MVP情境影片腳本.md)。

## 適合回答的問題

這個系統如何由設計、獨立核准進入研究收集？ICF 核准與院端簽署證據如何區分？草稿是否真的儲存在伺服器？誰負責審閱及鎖定？如何建立固定修訂快照，以及在同源其他系統開啟相同紀錄？影片依序實際操作上述流程。

| 時間 | 步驟 |
| --- | --- |
${chapters}

## 示範界線

全部使用獨立錄製環境及合成研究、院所與受試者資料。角色切換是 Development 示範身分，不宣稱已展示正式登入或 MFA。ICF 為文件核准與院端證據登錄，不是電子簽署。AI、集中附件、CBCT 傳輸及實際跨站 SSO 不在本片示範範圍；正式收集真實資料前仍需完成上線驗收。

## 對應手冊與驗證

- [開發與本機操作](01-開發與本機操作.md)：研究總覽工作台、合成資料開發身分、操作順序。
- [外部整合與 MVP 試用](03-外部整合與MVP試用.md)：固定表單入口與嵌入。
- 已完成 ${report.narrationSegments} 段旁白、${report.captionCount} 則字幕、全部 ${report.checkpoints.length} 段畫面檢查、H.264／音訊格式及完整解碼檢查。
- 旁白採本機 Microsoft Hanhan Desktop，本機繁中語音辨識僅作比對，未以辨識誤字改寫字幕；仍請使用者實際聆聽語速及讀音。
- 錄製用 5199 服務已關閉，該次隨機命名資料庫已清理；既有 MVP 資料庫未更動。
- 成片 SHA-256：\`${hash}\`。

可重跑產線位於 scripts/mvp-video/，原始錄影、旁白、字幕及驗證報告放在忽略版控的 output/video/mvp-20261029/。\n`;
fs.writeFileSync('Docs/notebooklm/04-MVP操作影片導覽.md',guide);
const readme = 'Docs/notebooklm/README.md'; let index = fs.readFileSync(readme,'utf8');
if (!index.includes('04-MVP操作影片導覽.md')) index = index.replace('- [MVP 交付與驗收]', '- [MVP 實際操作影片](04-MVP操作影片導覽.md)\n- [MVP 交付與驗收]');
fs.writeFileSync(readme,index);
const source = 'Docs/planning/MVP情境影片腳本.md'; let storyboard = fs.readFileSync(source,'utf8');
storyboard = storyboard.replace(/日期：2026-10-29。狀態：[^\n]+/,`日期：2026-10-29。狀態：第一版完成，待使用者檢視；成片 ${duration}，本機交付。`).replace('| 第一批 | 分鏡定稿，製作中 |','| 第一批 | 第一版完成（2026-10-29），待檢視 |');
fs.writeFileSync(source,storyboard);
const changelog = 'Docs/sync-changelog/2026-10.md'; let changes = fs.readFileSync(changelog,'utf8');
if (!changes.includes('20261029-001')) changes += '\n## 2026-10-29｜交付新版 MVP 實際操作影片\n- 變更編號：20261029-001\n- 文件：Docs/notebooklm/README.md、Docs/notebooklm/04-MVP操作影片導覽.md、Docs/planning/MVP情境影片腳本.md\n- 變動摘要：加入新版繁中實錄影片、本機播放連結、字幕、章節時間表、角色流程與驗證界線，將已確認分鏡更新為第一版完成待檢視。\n- 變動原因：使用者要求觀看 MVP 實際操作情境並已確認腳本，影片完成製作及檢查後提供本機交付。\n';
fs.writeFileSync(changelog,changes);
fs.writeFileSync(path.join(out,'delivery.json'),JSON.stringify({ file:report.file,duration:report.duration,sha256:hash,localOnly:true,guide:'Docs/notebooklm/04-MVP操作影片導覽.md',captureDatabaseRemoved:true,deliveredAt:new Date().toISOString() },null,2));
console.log(`${duration}: ${report.file}`);
