import {existsSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ensureDir, projectRoot, publicDir, run} from './lib';

export const combineNarration = () => {
  const generatedDir = resolve(publicDir, 'audio/generated');
  const files = Array.from({length: 8}, (_, index) => resolve(generatedDir, `scene-${String(index + 1).padStart(2, '0')}.mp3`));
  if (files.some((file) => !existsSync(file))) {
    console.warn('Narration combine skipped because one or more scene audio files are missing.');
    return false;
  }
  ensureDir(resolve(publicDir, 'audio'));
  const listPath = resolve(projectRoot, 'out/narration-concat.txt');
  writeFileSync(listPath, files.map((file) => `file '${file.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'), 'utf8');
  run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:a',
    'libmp3lame',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '192k',
    resolve(publicDir, 'audio/narration-en.mp3'),
  ]);
  return true;
};

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) combineNarration();
