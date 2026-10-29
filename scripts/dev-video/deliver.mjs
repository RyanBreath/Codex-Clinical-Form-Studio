import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const out=path.resolve('output/video/dev-20261029');
const verification=JSON.parse(fs.readFileSync(path.join(out,'verification-report.json'),'utf8'));
const api=JSON.parse(fs.readFileSync(path.join(out,'api-verification.json'),'utf8'));
const composition=JSON.parse(fs.readFileSync(path.join(out,'composition.json'),'utf8'));
const environment=JSON.parse(fs.readFileSync(path.join(out,'capture-env.json'),'utf8').replace(/^\uFEFF/,''));
if(verification.decode!=='passed'||api.status!=='passed'||!environment.databaseRemoved)throw Error('Delivery requires video/API verification and cleanup');
const duration=`${Math.floor(verification.duration/60)} 分 ${Math.round(verification.duration%60)} 秒`;
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,verification.file))).digest('hex');
const timestamp=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const chapters=composition.chapters.map(chapter=>`| ${timestamp(chapter.start)} | ${chapter.title} |`).join('\n');
const guide=`# 開發介接技術影片導覽

更新：2026-10-29。對象：平台與 CTMS／院端系統開發、介接工程師。第一版完成，待使用者觀看；成品只在本機交付，未公開或上傳外部服務。

## 播放及配套資料

- [開發介接技術影片 MP4](../../output/video/dev-20261029/${verification.file})：${duration}，1080p／30fps，繁中電腦女聲及燒錄字幕，無背景音樂。
- [字幕 SRT](../../output/video/dev-20261029/DEV1.srt)／[章節表](../../output/video/dev-20261029/chapters.txt)。
- [可重跑的合成 API 範例](../../scripts/dev-video/api-example.mjs)／[執行說明](../../scripts/dev-video/README.md)。
- [錄製期間的完整 HTTP 證據](../../output/video/dev-20261029/api-evidence.json)／[API 檢查結果](../../output/video/dev-20261029/api-verification.json)。
- [核准分鏡原稿](../planning/開發介接技術影片腳本.md)。

## 本片回答的問題

如何區分研究、院所、受試者、訪視、採用、次別、填答及修訂？正式登入與研究授權的責任在哪裡？CTMS 如何建立外部對應與填答草稿？如何處理重送、修訂衝突、鎖定、來源追溯及嵌入通訊？哪些部署與整合工作尚未完成？

| 時間 | 內容 |
| --- | --- |
${chapters}

## 實際執行證據

錄製時實際送出 ${api.requests} 個 HTTP 請求，包含前置授權與版本準備。驗證 CTMS 脈絡限制、收集依據關卡、院所隔離、伺服器重算、draft 建立、相同請求去重、key 內容衝突、來源路由限制、過時修訂、鎖定拒絕、修訂來源及固定匯出修訂。影片中的 JSON 為實際回應或明標摘錄，不是偽造成功文字。

Bearer 驗證以本機 RSA 簽章 token 執行真正的 middleware 整合測試，檢查錯 issuer／audience、已註冊有效身分、無 Cookie 的 Bearer 請求及帳號停用後拒絕；這不是實際外部 IdP 聯調。一般 API 實錄使用明標的 Development 合成身分，不展示有效 token、Cookie 或資料庫密碼。

前置的核准表單、採用與免同意依據由各自的授權人員準備，沒有把整合帳號升級成可核准研究或同意的角色。外部建立填答先保存 draft，submit／review／lock 仍由平台角色執行。

## 驗證與限制

- 已完成全部 ${verification.checkpoints.length} 段抽幀、音軌存在與音量、1920×1080／30fps 格式、完整 MP4 解碼及 API 斷言檢查。
- 繁中旁白在本機合成及語音辨識比對，字幕仍依核准原稿；讀音及節奏仍供使用者實際聆聽。
- 程式碼與架構為目前實作；技術展示頁只是錄製用視覺化，不是產品新增的 API console。較長契約段落以實際 response 產生可閱讀摘錄，完整 JSON 在附檔中。
- 只驗證同源嵌入；實際 CTMS／IdP、跨站 Cookie／SSO、事件派送、集中附件／CBCT、正式安全部署與容量驗收仍待完成。
- 最後的還原報告是既有本機資料庫演練證據，影片有標示；不是這次錄製環境的災難復原。它不包含附件、IdP 或 Data Protection 金鑰。
- 錄製專用 5199 服務已停止，該次錄製資料庫已驗證清理；未修改 5198 MVP 資料。
- 成片 SHA-256：\`${hash}\`。

對應：[架構與資料控制](02-架構與資料控制.md)、[外部整合與 MVP 試用](03-外部整合與MVP試用.md)、[使用者操作影片](04-MVP操作影片導覽.md)。\n`;
fs.writeFileSync('Docs/notebooklm/05-開發介接技術影片導覽.md',guide);
const readme='Docs/notebooklm/README.md';let index=fs.readFileSync(readme,'utf8');
if(!index.includes('05-開發介接技術影片導覽.md'))index=index.replace('- [MVP 交付與驗收]','- [開發介接技術影片](05-開發介接技術影片導覽.md)\n- [MVP 交付與驗收]');
fs.writeFileSync(readme,index);
const source='Docs/planning/開發介接技術影片腳本.md';let storyboard=fs.readFileSync(source,'utf8');
storyboard=storyboard.replace('狀態：使用者已確認照稿製作；分鏡定稿，製作中。',`狀態：第一版完成，待使用者檢視；成片 ${duration}，本機交付。`).replace('| 技術篇第一批 | 分鏡定稿，製作中 |','| 技術篇第一批 | 第一版完成（2026-10-29），待檢視 |');fs.writeFileSync(source,storyboard);
const changelog='Docs/sync-changelog/2026-10.md';let changes=fs.readFileSync(changelog,'utf8');
if(!changes.includes('20261029-002'))changes+='\n## 2026-10-29｜交付開發介接技術影片\n- 變更編號：20261029-002\n- 文件：Docs/notebooklm/README.md、Docs/notebooklm/05-開發介接技術影片導覽.md、Docs/planning/開發介接技術影片腳本.md\n- 變動摘要：新增架構與 CTMS 介接影片、本機播放連結、字幕及章節、合成 API 範例與 HTTP 證據，記錄認證、去重、衝突、鎖定及部署界線。\n- 變動原因：使用者要求給開發介接人員觀看的技術內容並確認分鏡，影片與 API 檢查完成後提供本機交付。\n';
fs.writeFileSync(changelog,changes);
fs.writeFileSync(path.join(out,'delivery.json'),JSON.stringify({file:verification.file,duration:verification.duration,sha256:hash,apiRequests:api.requests,localOnly:true,guide:'Docs/notebooklm/05-開發介接技術影片導覽.md',deliveredAt:new Date().toISOString()},null,2));
console.log(`${duration}: ${verification.file}`);
