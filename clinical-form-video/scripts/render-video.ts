import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {SceneDefinition} from '../src/types';
import {durationOf, ensureDir, outDir, projectRoot, publicDir, readJson, run, writeJson} from './lib';

const scenes = readJson<SceneDefinition[]>(resolve(projectRoot, 'src/data/scenes.json'));
const fps = Number(process.env.VIDEO_FPS ?? 30);
const duration = scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) / fps;
const rawVideo = resolve(outDir, 'clinical-form-studio-demo.raw.mp4');
const noCaptions = resolve(outDir, 'clinical-form-studio-demo-no-captions.mp4');
const withCaptions = resolve(outDir, 'clinical-form-studio-demo.mp4');
const background = resolve(publicDir, 'audio/background.mp3');
const finalizeOnly = process.argv.includes('--finalize-only');
ensureDir(outDir);

if (!finalizeOnly) {
  console.log('Rendering the no-caption master with Remotion...');
  run(process.execPath, [
    resolve(projectRoot, 'node_modules/@remotion/cli/remotion-cli.js'),
    'render',
    'src/index.ts',
    'ClinicalFormStudioNoCaptions',
    rawVideo,
    '--codec=h264',
    '--pixel-format=yuv420p',
    '--crf=20',
    '--audio-codec=aac',
    '--audio-bitrate=192k',
    '--concurrency=6',
    '--overwrite',
  ], {cwd: projectRoot});
} else if (!existsSync(rawVideo)) {
  throw new Error('Cannot use --finalize-only because the Remotion raw master is missing.');
}

console.log('Finalizing 48 kHz AAC narration and optional background mix...');
if (existsSync(background)) {
  run('ffmpeg', [
    '-y', '-v', 'error', '-i', rawVideo, '-stream_loop', '-1', '-i', background,
    '-filter_complex', `[0:a]volume=1.0[n];[1:a]volume=0.065,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, duration - 2).toFixed(3)}:d=2[m];[n][m]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    '-map', '0:v:0', '-map', '[a]', '-vf', 'scale=1920:1080:in_range=full:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
    '-t', duration.toFixed(3), '-movflags', '+faststart', noCaptions,
  ]);
} else {
  run('ffmpeg', [
    '-y', '-v', 'error', '-i', rawVideo, '-map', '0:v:0', '-map', '0:a:0',
    '-vf', 'scale=1920:1080:in_range=full:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart', noCaptions,
  ]);
}

console.log('Burning the synchronized English subtitle track...');
const subtitleFilter = "subtitles=public/subtitles/subtitles-en.srt:force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H0010253A,BorderStyle=1,Outline=2,Shadow=0,MarginV=24,Alignment=2',scale=1920:1080:in_range=auto:out_range=tv,format=yuv420p";
run('ffmpeg', [
  '-y', '-v', 'error', '-i', noCaptions, '-vf', subtitleFilter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:a', 'copy', '-movflags', '+faststart', withCaptions,
], {cwd: projectRoot});

const framesDir = resolve(outDir, 'frames');
ensureDir(framesDir);
let sceneStart = 0;
let frameNumber = 1;
const frameChecks: Array<{sceneId: string; position: string; timeSeconds: number; file: string}> = [];
for (const scene of scenes) {
  const sceneDuration = scene.durationInFrames / fps;
  const checks = [
    {position: 'first', time: sceneStart + 0.3},
    {position: 'middle', time: sceneStart + sceneDuration / 2},
    {position: 'last', time: sceneStart + Math.max(0.3, sceneDuration - 0.35)},
  ];
  for (const check of checks) {
    const file = resolve(framesDir, `frame-${String(frameNumber).padStart(2, '0')}.png`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', check.time.toFixed(3), '-i', withCaptions, '-frames:v', '1', file]);
    frameChecks.push({sceneId: scene.id, position: check.position, timeSeconds: Number(check.time.toFixed(3)), file: file.replace(projectRoot, '').replace(/^[/\\]/, '').replaceAll('\\', '/')});
    frameNumber++;
  }
  sceneStart += sceneDuration;
}

run('ffmpeg', [
  '-y', '-v', 'error', '-framerate', '1', '-start_number', '1', '-i', resolve(framesDir, 'frame-%02d.png'),
  '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=white,tile=4x6:padding=4:margin=4',
  '-frames:v', '1', resolve(outDir, 'contact-sheet.png'),
]);

writeJson(resolve(outDir, 'render-report.json'), {
  generatedAt: new Date().toISOString(),
  remotionComposition: 'ClinicalFormStudioNoCaptions',
  finalizeOnly,
  durationSeconds: Number(durationOf(withCaptions).toFixed(3)),
  outputs: [
    'out/clinical-form-studio-demo.mp4',
    'out/clinical-form-studio-demo-no-captions.mp4',
    'out/contact-sheet.png',
  ],
  frames: frameChecks,
  backgroundMusicIncluded: existsSync(background),
  subtitleBurnMethod: 'FFmpeg libass from generated English SRT',
});
console.log('Rendered both final MP4 variants, retained the raw master, and generated the contact sheet.');
