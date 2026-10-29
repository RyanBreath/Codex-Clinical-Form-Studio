import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const source = 'Docs/planning/MVP情境影片腳本.md';
const text = fs.readFileSync(path.join(root, source), 'utf8');
const out = path.join(root, 'output/video/mvp-20261029');
fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
let chapter = '研究表單 MVP';
const shots = [];
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith('#### ')) chapter = line.slice(5).trim();
  if (/^\| MVP1-\d+ \|/.test(line)) {
    const [id, screen, narration, manual] = line.split('|').slice(1, -1).map(value => value.trim());
    shots.push({ id, screen, narration, manual, chapter });
  }
}
const title = text.split(/\r?\n/).find(line => line.startsWith('| MVP1 |')).split('|')[2].trim();
if (shots.length !== 11) throw new Error('Unexpected shot count');
if (process.argv.includes('--measure')) for (const shot of shots) shot.audioDuration = Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',path.join(out,'audio',shot.id+'.wav')], { encoding:'utf8' }));
fs.writeFileSync(path.join(out, 'script.json'), JSON.stringify({ title, source, voice: 'Microsoft Hanhan Desktop', shots }, null, 2));
console.log(`Parsed ${shots.length} approved shots; ${shots.reduce((sum, shot) => sum + shot.narration.length, 0)} narration characters.`);
