import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out = path.resolve('output/video/mvp-20261029');
const recording = JSON.parse(fs.readFileSync(path.join(out,'recording.json'),'utf8'));
const frames = path.join(out,'source-check'); fs.mkdirSync(frames,{recursive:true});
for (const [index,shot] of recording.shots.entries()) {
  const time = shot.start + shot.duration*.65;
  execFileSync('ffmpeg',['-v','error','-y','-ss',String(time),'-i',path.join(out,'MVP1.webm'),'-frames:v','1',path.join(frames,`frame-${String(index).padStart(2,'0')}.png`)],{stdio:'pipe'});
}
execFileSync('ffmpeg',['-v','error','-y','-start_number','0','-i',path.join(frames,'frame-%02d.png'),'-vf','scale=640:360,tile=3x4','-frames:v','1',path.join(out,'source-contact-sheet.png')],{stdio:'pipe'});
console.log('Extracted all 11 source checkpoints.');
