import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('output/video/dev-20261029');
const out = path.join(source, 'voice-neutral-tw');
fs.mkdirSync(path.join(out, 'raw'), { recursive: true });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const time = value => { const [h,m,s] = value.replace(',', '.').split(':').map(Number); return h*3600+m*60+s; };
const aliases = {
  'ASP.NET Core': 'A S P 點 net core', PostgreSQL: '波斯特格雷斯 Q L',
  'Bearer token': '貝爾權杖', 'frame-ancestors': '父頁框架來源限制',
  React: '瑞艾克特', CTMS: 'C T M S', API: 'A P I',
  issuer: '簽發者', audience: '接收對象', Integrate: '整合權限',
  Collect: '收集權限', Read: '讀取權限', Cookie: '庫奇',
  token: '權杖', JSON: 'J S O N', Email: '電子郵件', HTTPS: 'H T T P S',
};
const emphasis = ['資料權限', '院所權限', '核准', '固定版本', '修訂號', '固定修訂', '權限', '依據', '鎖定', '去重衝突', '不可盲目覆寫', '後端重算', '不能無限重試'];
const tokens = [...Object.keys(aliases), ...emphasis].sort((a,b)=>b.length-a.length);
const re = new RegExp(tokens.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'), 'g');
const srt = fs.readFileSync(path.join(source,'DEV1.srt'),'utf8').replace(/^\uFEFF/,'').trim();
const cues = srt.split(/\r?\n\s*\r?\n/).map(block => {
  const [number, timing, ...lines] = block.split(/\r?\n/);
  const [start,end] = timing.split(' --> ').map(time);
  const text = lines.join(' ');
  let cursor=0; let body='';
  for (const match of text.matchAll(re)) {
    body += escape(text.slice(cursor,match.index));
    body += aliases[match[0]] ? `<sub alias="${escape(aliases[match[0]])}">${escape(match[0])}</sub>` : `<prosody rate="-4%" volume="+4%"><emphasis level="moderate">${escape(match[0])}</emphasis></prosody>`;
    cursor=match.index+match[0].length;
  }
  body += escape(text.slice(cursor));
  const id = String(number).padStart(3,'0');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW"><voice name="Microsoft Hanhan Desktop"><prosody rate="-5%" pitch="-2%">${body}</prosody></voice></speak>`;
  return {id, start,end,text,ssml,file:`raw/${id}.wav`};
});
if(cues.length!==86 || cues.some((cue,i)=>cue.end<=cue.start || i&&cue.start<cues[i-1].end)) throw Error('Invalid source SRT');
const specification = { language:'zh-TW', voice:'Microsoft Hanhan Desktop', engine:'Windows System.Speech (local)', style:'平穩、清晰的科技教學女聲；中等偏慢；關鍵流程適度強調', sourceSrt:'../DEV1.srt', duration:384.1, aliases, cues };
fs.writeFileSync(path.join(out,'specification.json'),JSON.stringify(specification,null,2));
fs.copyFileSync(path.join(source,'DEV1.srt'),path.join(out,'DEV1-中性女聲-SRT同步.srt'));
console.log(`Prepared ${cues.length} local narration cues`);
