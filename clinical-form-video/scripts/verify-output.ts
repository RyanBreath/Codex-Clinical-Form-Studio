import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import type {SceneDefinition} from '../src/types';
import {ffprobe, outDir, projectRoot, readJson, writeJson} from './lib';

const outputs = [
  resolve(outDir, 'clinical-form-studio-demo.mp4'),
  resolve(outDir, 'clinical-form-studio-demo-no-captions.mp4'),
];
const errors: string[] = [];
const warnings: string[] = [];

const inspectVideo = (file: string) => {
  if (!existsSync(file) || statSync(file).size === 0) {
    errors.push(`Missing or empty output: ${file}`);
    return null;
  }
  const metadata = ffprobe(file);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  const audio = metadata.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(metadata.format.duration ?? 0);
  const frameRateParts = (video?.avg_frame_rate ?? video?.r_frame_rate ?? '0/1').split('/').map(Number);
  const frameRate = frameRateParts[1] ? frameRateParts[0] / frameRateParts[1] : 0;
  if (video?.width !== 1920 || video?.height !== 1080) errors.push(`${file}: expected 1920x1080.`);
  if (Math.abs(frameRate - 30) > 0.001) errors.push(`${file}: expected 30 FPS, got ${frameRate}.`);
  if (video?.codec_name !== 'h264') errors.push(`${file}: expected H.264, got ${video?.codec_name}.`);
  if (video?.pix_fmt !== 'yuv420p') errors.push(`${file}: expected yuv420p, got ${video?.pix_fmt}.`);
  if (!audio) errors.push(`${file}: audio stream missing.`);
  if (audio?.codec_name !== 'aac') errors.push(`${file}: expected AAC audio, got ${audio?.codec_name}.`);
  if (audio?.sample_rate !== '48000') errors.push(`${file}: expected 48 kHz audio, got ${audio?.sample_rate}.`);
  if (duration >= 180 || duration > 179) errors.push(`${file}: duration ${duration.toFixed(3)} exceeds the enforced limit.`);
  if (duration < 165 || duration > 175) warnings.push(`${file}: duration ${duration.toFixed(3)} is outside the preferred 165–175 second range.`);
  const volume = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], {encoding: 'utf8', windowsHide: true});
  const volumeText = `${volume.stdout ?? ''}\n${volume.stderr ?? ''}`;
  const meanMatch = volumeText.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const meanVolumeDb = meanMatch ? Number(meanMatch[1]) : null;
  if (meanVolumeDb === null || meanVolumeDb < -55) errors.push(`${file}: audio appears silent or could not be measured.`);
  return {
    file: file.replace(projectRoot, '').replace(/^[/\\]/, '').replaceAll('\\', '/'),
    bytes: statSync(file).size,
    durationSeconds: Number(duration.toFixed(3)),
    videoCodec: video?.codec_name,
    pixelFormat: video?.pix_fmt,
    width: video?.width,
    height: video?.height,
    frameRate,
    audioCodec: audio?.codec_name,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    meanVolumeDb,
  };
};

const parseSrt = (file: string) => {
  if (!existsSync(file)) {
    errors.push(`Missing subtitle: ${file}`);
    return {entries: 0, lastEndSeconds: 0, overlaps: 0};
  }
  const text = readFileSync(file, 'utf8');
  const matches = [...text.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g)];
  const seconds = (parts: string[]) => Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]) + Number(parts[3]) / 1000;
  let previousEnd = -Infinity;
  let overlaps = 0;
  let lastEnd = 0;
  for (const match of matches) {
    const start = seconds(match.slice(1, 5));
    const end = seconds(match.slice(5, 9));
    if (start < previousEnd + 0.049) overlaps++;
    previousEnd = end;
    lastEnd = end;
  }
  if (overlaps) errors.push(`${file}: ${overlaps} subtitle overlap or insufficient-gap issue(s).`);
  return {entries: matches.length, lastEndSeconds: lastEnd, overlaps};
};

const videos = outputs.map(inspectVideo).filter(Boolean);
const englishSrt = parseSrt(resolve(outDir, 'subtitles-en.srt'));
const chineseSrt = parseSrt(resolve(outDir, 'subtitles-zh-TW.srt'));
if (englishSrt.entries !== chineseSrt.entries) errors.push('English and Traditional Chinese subtitle counts do not match.');
const videoDuration = videos[0]?.durationSeconds ?? 0;
if (englishSrt.lastEndSeconds >= videoDuration) errors.push('Last subtitle does not end before the video.');

const scenes = readJson<SceneDefinition[]>(resolve(projectRoot, 'src/data/scenes.json'));
if (scenes.length !== 8) errors.push(`Expected 8 scenes, found ${scenes.length}.`);
const framesDir = resolve(outDir, 'frames');
const frameFiles = existsSync(framesDir) ? readdirSync(framesDir).filter((file) => file.endsWith('.png')) : [];
if (frameFiles.length !== 24) errors.push(`Expected 24 scene verification frames, found ${frameFiles.length}.`);
if (!existsSync(resolve(outDir, 'contact-sheet.png'))) errors.push('Contact sheet is missing.');

if (outputs[0] && existsSync(outputs[0])) {
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', outputs[0], '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], {encoding: 'utf8', windowsHide: true});
  if (decode.status !== 0) errors.push(`Final MP4 decode failed: ${decode.stderr}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  valid: errors.length === 0,
  errors,
  warnings,
  videos,
  subtitles: {english: englishSrt, traditionalChinese: chineseSrt},
  sceneCount: scenes.length,
  verificationFrameCount: frameFiles.length,
  contactSheetExists: existsSync(resolve(outDir, 'contact-sheet.png')),
};
writeJson(resolve(outDir, 'verification-report.json'), report);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Verification passed. Duration: ${videoDuration.toFixed(3)}s; 1920x1080; 30 FPS; H.264/AAC; audio present.`);
for (const warning of warnings) console.warn(warning);
