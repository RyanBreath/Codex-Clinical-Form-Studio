import {createHash} from 'node:crypto';
import {existsSync, writeFileSync} from 'node:fs';
import {platform} from 'node:os';
import {resolve} from 'node:path';
import {config} from 'dotenv';
import {combineNarration} from './combine-audio';
import {durationOf, ensureDir, outDir, projectRoot, publicDir, readJson, run, writeJson} from './lib';

config({path: resolve(projectRoot, '.env.local'), quiet: true});
config({path: resolve(projectRoot, '.env'), quiet: true});

type NarrationScene = {id: string; title: string; segments: string[]};
type VoiceManifest = {hash?: string};
const narration = readJson<NarrationScene[]>(resolve(projectRoot, 'src/data/narration-en.json'));
const voice = process.env.LOCAL_TTS_VOICE || 'Microsoft David Desktop';
const rate = Number(process.env.LOCAL_TTS_RATE ?? 2);
const provider = 'local';
const hash = createHash('sha256').update(JSON.stringify({narration, voice, rate, provider})).digest('hex');
const manifestPath = resolve(outDir, 'voice-manifest.json');
const existingManifest = existsSync(manifestPath) ? readJson<VoiceManifest>(manifestPath) : {};
const generatedDir = resolve(publicDir, 'audio/generated');
const workDir = resolve(outDir, '.voice-work', String(Date.now()));
ensureDir(generatedDir);
ensureDir(outDir);
ensureDir(workDir);

const speechText = (text: string) =>
  text
    .replaceAll('GPT-5.6', 'G P T five point six')
    .replaceAll('eCRF', 'e C R F')
    .replaceAll('CDISC', 'C disc')
    .replaceAll('CDASH', 'C dash')
    .replaceAll('YAML', 'YAM-el')
    .replaceAll('JSON', 'JAY-son')
    .replaceAll('pytest', 'pie test')
    .replaceAll('CI/CD', 'C I C D');

const outputs = narration.map((scene, index) => resolve(generatedDir, `scene-${String(index + 1).padStart(2, '0')}.mp3`));
if (existingManifest.hash === hash && outputs.every(existsSync)) {
  console.log('Local narration is current; reusing existing scene audio.');
  combineNarration();
  process.exit(0);
}

if (platform() === 'win32') {
  const ttsScript = resolve(projectRoot, 'scripts/windows-tts.ps1');
  narration.forEach((scene, index) => {
    const stem = `scene-${String(index + 1).padStart(2, '0')}`;
    const textPath = resolve(workDir, `${stem}.txt`);
    const wavePath = resolve(workDir, `${stem}.wav`);
    const output = resolve(generatedDir, `${stem}.mp3`);
    writeFileSync(textPath, speechText(scene.segments.join(' ')), 'utf8');
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ttsScript,
      '-InputTextFile',
      textPath,
      '-OutputWaveFile',
      wavePath,
      '-Voice',
      voice,
      '-Rate',
      String(rate),
    ], {quiet: true});
    run('ffmpeg', ['-y', '-v', 'error', '-i', wavePath, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', output], {quiet: true});
    console.log(`${stem}: ${durationOf(output).toFixed(3)} seconds`);
  });
} else {
  const espeak = ['espeak-ng', 'espeak'].find((command) => {
    try {
      run(command, ['--version'], {quiet: true});
      return true;
    } catch {
      return false;
    }
  });
  if (!espeak) {
    console.warn('No local TTS engine found. Creating audible preview narration placeholders. Install espeak-ng for spoken narration.');
    narration.forEach((scene, index) => {
      const output = outputs[index];
      const seconds = Math.max(8, scene.segments.join(' ').split(/\s+/).length / 2.4);
      run('ffmpeg', [
        '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds),
        '-af', 'volume=0.025', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', output,
      ]);
    });
  } else {
    narration.forEach((scene, index) => {
      const wavePath = resolve(outDir, `${scene.id}.wav`);
      run(espeak, ['-v', 'en-us', '-s', '142', '-w', wavePath, speechText(scene.segments.join(' '))]);
      run('ffmpeg', ['-y', '-v', 'error', '-i', wavePath, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', outputs[index]]);
    });
  }
}

combineNarration();
writeJson(manifestPath, {
  generatedAt: new Date().toISOString(),
  provider,
  voice,
  rate,
  hash,
  files: outputs.map((file) => ({file: file.replace(projectRoot, '').replace(/^[/\\]/, '').replaceAll('\\', '/'), durationSeconds: durationOf(file)})),
});
console.log('English narration generated with the local TTS provider.');
