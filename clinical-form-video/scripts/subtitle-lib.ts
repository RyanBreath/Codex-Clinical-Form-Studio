import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {CaptionEntry, SceneDefinition} from '../src/types';
import {durationOf, ensureDir, outDir, projectRoot, publicDir, readJson, srtTime, writeJson} from './lib';

type NarrationScene = {id: string; segments: string[]};

const naturalSplit = (text: string, count: number) => {
  if (count <= 1) return [text.trim()];
  const chunks: string[] = [];
  let remaining = text.trim();
  for (let chunk = 0; chunk < count - 1; chunk++) {
    const remainingChunks = count - chunk;
    const target = Math.round(remaining.length / remainingChunks);
    let split = target;
    for (let distance = 0; distance < Math.min(18, target); distance++) {
      const left = target - distance;
      const right = target + distance;
      if (left > 0 && /[\s,，、;；:：.!。]/.test(remaining[left])) { split = left + 1; break; }
      if (right < remaining.length && /[\s,，、;；:：.!。]/.test(remaining[right])) { split = right + 1; break; }
    }
    chunks.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }
  chunks.push(remaining);
  return chunks;
};

const wrapEnglish = (text: string, max = 42) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).join('\n');
};

const wrapChinese = (text: string, max = 20) => {
  if (text.length <= max) return text;
  const firstTarget = Math.min(max, Math.ceil(text.length / 2));
  let split = firstTarget;
  for (let distance = 0; distance < 8; distance++) {
    const index = firstTarget - distance;
    if (index > 0 && /[，、；：。\s]/.test(text[index])) { split = index + 1; break; }
  }
  return `${text.slice(0, split).trim()}\n${text.slice(split).trim()}`;
};

export const generateSubtitles = () => {
  const scenesPath = resolve(projectRoot, 'src/data/scenes.json');
  const scenes = readJson<SceneDefinition[]>(scenesPath);
  const english = readJson<NarrationScene[]>(resolve(projectRoot, 'src/data/narration-en.json'));
  const chinese = readJson<NarrationScene[]>(resolve(projectRoot, 'src/data/narration-zh-TW.json'));
  const captions: CaptionEntry[] = [];
  let globalSceneStart = 0;
  let id = 1;

  scenes.forEach((scene, sceneIndex) => {
    const enScene = english.find((item) => item.id === scene.id)!;
    const zhScene = chinese.find((item) => item.id === scene.id)!;
    const audioPath = resolve(publicDir, scene.narrationAudio);
    const audioDuration = durationOf(audioPath);
    const pairs = enScene.segments.flatMap((en, index) => {
      const zh = zhScene.segments[index] ?? '';
      const chunkCount = Math.max(1, Math.ceil(en.length / 80), Math.ceil(zh.length / 36));
      const enChunks = naturalSplit(en, chunkCount);
      const zhChunks = naturalSplit(zh, chunkCount);
      return Array.from({length: chunkCount}, (_, chunkIndex) => ({
        en: enChunks[chunkIndex] ?? '',
        zh: zhChunks[chunkIndex] ?? '',
      }));
    });
    const weights = pairs.map((pair) => Math.max(1, pair.en.split(/\s+/).length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const gap = 0.05;
    const leadIn = 0.2;
    const usable = Math.max(0.5, audioDuration - leadIn - gap * Math.max(0, pairs.length - 1));
    let local = leadIn;
    pairs.forEach((pair, pairIndex) => {
      const duration = (usable * weights[pairIndex]) / totalWeight;
      const end = Math.min(audioDuration, local + duration);
      captions.push({
        id: id++,
        sceneId: scene.id,
        localStartSeconds: Number(local.toFixed(3)),
        localEndSeconds: Number(end.toFixed(3)),
        globalStartSeconds: Number((globalSceneStart + local).toFixed(3)),
        globalEndSeconds: Number((globalSceneStart + end).toFixed(3)),
        en: wrapEnglish(pair.en),
        zhTW: wrapChinese(pair.zh),
      });
      local = end + gap;
    });
    globalSceneStart += scene.actualDurationSeconds;
  });

  const toSrt = (language: 'en' | 'zhTW') =>
    captions
      .map((caption, index) => `${index + 1}\n${srtTime(caption.globalStartSeconds)} --> ${srtTime(caption.globalEndSeconds)}\n${caption[language]}\n`)
      .join('\n');
  const subtitleDir = resolve(publicDir, 'subtitles');
  ensureDir(subtitleDir);
  ensureDir(outDir);
  writeFileSync(resolve(subtitleDir, 'subtitles-en.srt'), toSrt('en'), 'utf8');
  writeFileSync(resolve(subtitleDir, 'subtitles-zh-TW.srt'), toSrt('zhTW'), 'utf8');
  writeFileSync(resolve(outDir, 'subtitles-en.srt'), toSrt('en'), 'utf8');
  writeFileSync(resolve(outDir, 'subtitles-zh-TW.srt'), toSrt('zhTW'), 'utf8');
  writeJson(resolve(projectRoot, 'src/data/captions.json'), captions);
  return captions;
};
