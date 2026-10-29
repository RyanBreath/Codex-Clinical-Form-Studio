import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out = path.resolve('output/video/dev-20261029');
const script = JSON.parse(fs.readFileSync(path.join(out, 'script.json'), 'utf8'));
const recording = JSON.parse(fs.readFileSync(path.join(out, 'recording.json'), 'utf8'));
if (recording.shots.length !== script.shots.length || recording.errors.length) throw new Error('Incomplete recording or browser errors');
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const total = recording.shots.at(-1).end;
const normalized = path.join(out,'DEV1-source.mp4');
if (!fs.existsSync(normalized)) execFileSync('ffmpeg',['-v','error','-y','-i',path.join(out,'DEV1.webm'),'-an','-c:v','libx264','-preset','fast','-crf','19','-r','30','-g','30','-keyint_min','30','-pix_fmt','yuv420p','-movflags','+faststart',normalized], { stdio:'inherit' });
const title = script.title;
const filename = 'DEV1-' + title.replace(/[\\/:*?"<>|：、，／\s]/g,'') + '.mp4';
const stamp = (seconds, ms = true) => {
  const time = Math.round(seconds * 1000); const h = Math.floor(time / 3600000), m = Math.floor(time / 60000) % 60, s = Math.floor(time / 1000) % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${ms ? ',' + String(time % 1000).padStart(3,'0') : ''}`;
};
const cues = [];
for (const shot of recording.shots) {
  const parts = shot.narration.match(/[^，。；：！？]+[，。；：！？]?/g) ?? [shot.narration];
  const lines = [];
  for (const part of parts) {
    if (part.length > 32) { for (let i=0;i<part.length;i+=28) lines.push(part.slice(i,i+28)); }
    else if (lines.length && part.length < 6 && lines.at(-1).length + part.length <= 32) lines[lines.length - 1] += part;
    else lines.push(part);
  }
  const weight = lines.reduce((sum,line) => sum + line.length, 0);
  let cursor = shot.start + .15;
  for (const line of lines) {
    const duration = shot.audioDuration * line.length / weight;
    cues.push({ start: cursor, end: cursor + duration, text: line, shot: shot.id }); cursor += duration;
  }
}
const chapters = [];
let previous = '';
for (const shot of recording.shots) if (shot.chapter !== previous) {
  chapters.push({ start: shot.start, title: shot.chapter }); previous = shot.chapter;
}
fs.mkdirSync(path.join(out,'assets'), { recursive: true });
fs.copyFileSync(path.join(process.env.TEMP,'clinical-mvp-video-tools/node_modules/gsap/dist/gsap.min.js'), path.join(out,'assets/gsap.min.js'));
const header = recording.shots.map((shot,index) => `<div class="clip chapter" data-start="${shot.start}" data-duration="${shot.end-shot.start}" data-track-index="2"><span class="brand">CF / DEVELOPER GUIDE</span><strong>${escape(shot.chapter)}</strong><span class="counter">${String(index+1).padStart(2,'0')} / ${String(recording.shots.length).padStart(2,'0')}</span></div>`).join('\n');
const audio = recording.shots.map(shot => `<audio src="audio/${shot.id}.wav" data-start="${shot.start+.15}" data-duration="${shot.audioDuration}" data-track-index="1" data-volume="1"></audio>`).join('\n');
const captions = cues.map(cue => `<div class="clip caption" data-start="${cue.start}" data-duration="${cue.end-cue.start}" data-track-index="5"><span>${escape(cue.text)}</span></div>`).join('\n');
const contractShot = recording.shots.find(shot => shot.id === 'DEV1-5');
const overlayStart = contractShot.start + 12.5;
const contractOverlay = fs.existsSync(path.join(out,'contract-readable.png')) ? `<img class="clip screen" src="contract-readable.png" data-start="${overlayStart}" data-duration="${contractShot.end-overlayStart}" data-track-index="4">` : '';
const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>
*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#f3f5f8}#root{position:relative;width:1920px;height:1080px;color:#263145;font-family:'Microsoft JhengHei','Noto Sans TC',sans-serif}.clip{position:absolute}.screen{left:64px;top:72px;width:1792px;height:1008px;object-fit:contain;background:white;border:1px solid #dce2eb;border-radius:6px}.chapter{left:0;top:0;width:1920px;height:72px;display:flex;align-items:center;gap:34px;padding:0 64px;border-bottom:1px solid #dce2eb;background:#fff}.brand{font:18px Consolas,monospace;color:#315fce;letter-spacing:1px}.chapter strong{font-size:23px;font-weight:600}.counter{margin-left:auto;font:18px Consolas;color:#69758a}.caption{left:0;top:0;width:1920px;height:1080px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:28px;pointer-events:none}.caption span{max-width:1660px;padding:10px 24px;border-radius:6px;color:#fff;background:#263145ed;font-size:33px;line-height:1.5;letter-spacing:.01em}.progress{position:absolute;left:0;top:69px;width:1920px;height:3px;background:#315fce;transform-origin:left center}
</style></head><body><div id="root" data-composition-id="dev1" data-start="0" data-duration="${total}" data-width="1920" data-height="1080"><video class="clip screen" src="DEV1-source.mp4" muted playsinline data-start="0" data-duration="${total}" data-media-start="0" data-track-index="0"></video>${contractOverlay}${audio}${header}${captions}<div class="progress"></div></div><script>const tl=gsap.timeline({paused:true});tl.fromTo('.progress',{scaleX:0},{scaleX:1,duration:${total},ease:'none'},0);window.__timelines={dev1:tl};</script></body></html>`;
fs.writeFileSync(path.join(out,'DEV1.html'),html);
fs.writeFileSync(path.join(out,'DEV1.srt'),cues.map((cue,index) => `${index+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n'));
fs.writeFileSync(path.join(out,'chapters.txt'),chapters.map(chapter => `${stamp(chapter.start,false).slice(3)} ${chapter.title}`).join('\n'));
fs.writeFileSync(path.join(out,'composition.json'),JSON.stringify({ title, filename, duration: total, narrationSegments: recording.shots.length, captions: cues.length, chapters, source: script.source },null,2));
console.log(`Composition: ${total.toFixed(2)} sec, ${cues.length} captions, ${recording.shots.length} narration segments; ${filename}`);
