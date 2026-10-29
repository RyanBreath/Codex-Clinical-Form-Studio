import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {SceneDefinition} from '../src/types';
import {generateSubtitles} from './subtitle-lib';
import {durationOf, outDir, projectRoot, publicDir, readJson, writeJson} from './lib';

const scenesPath = resolve(projectRoot, 'src/data/scenes.json');
const scenes = readJson<SceneDefinition[]>(scenesPath);
const fps = Number(process.env.VIDEO_FPS ?? 30);
const target = Number(process.env.VIDEO_TARGET_SECONDS ?? 165);
const maximum = Number(process.env.VIDEO_MAX_SECONDS ?? 179);
const finalMode = process.argv.includes('--final');

const details = scenes.map((scene) => {
  const audioPath = resolve(publicDir, scene.narrationAudio);
  if (!existsSync(audioPath)) throw new Error(`Missing narration audio: ${scene.narrationAudio}`);
  const narrationSeconds = durationOf(audioPath);
  const required = narrationSeconds + 0.35;
  const allocated = Math.max(scene.maxDurationSeconds, required);
  scene.actualDurationSeconds = Number(allocated.toFixed(3));
  scene.durationInFrames = Math.ceil(allocated * fps);
  return {
    id: scene.id,
    title: scene.title,
    narrationSeconds: Number(narrationSeconds.toFixed(3)),
    allocatedSeconds: Number((scene.durationInFrames / fps).toFixed(3)),
    maximumBudgetSeconds: scene.maxDurationSeconds,
    pauseAndVisualHoldSeconds: Number((scene.durationInFrames / fps - narrationSeconds).toFixed(3)),
  };
});

writeJson(scenesPath, scenes);
generateSubtitles();

const plannedDuration = details.reduce((sum, scene) => sum + scene.allocatedSeconds, 0);
const finalPath = resolve(outDir, 'clinical-form-studio-demo.mp4');
const finalDuration = finalMode && existsSync(finalPath) ? durationOf(finalPath) : null;
const evaluatedDuration = finalDuration ?? plannedDuration;
const report = {
  generatedAt: new Date().toISOString(),
  fps,
  targetSeconds: target,
  maximumSeconds: maximum,
  hardMaximumSeconds: 180,
  plannedDurationSeconds: Number(plannedDuration.toFixed(3)),
  finalDurationSeconds: finalDuration === null ? null : Number(finalDuration.toFixed(3)),
  remainingSeconds: Number((maximum - evaluatedDuration).toFixed(3)),
  preferredRange: {minimum: 165, maximum: 175},
  withinPreferredRange: evaluatedDuration >= 165 && evaluatedDuration <= 175,
  valid: evaluatedDuration <= maximum && evaluatedDuration < 180,
  scenes: details,
};
writeJson(resolve(outDir, 'duration-report.json'), report);

for (const scene of details) {
  console.log(`${scene.id}: audio ${scene.narrationSeconds.toFixed(3)}s, scene ${scene.allocatedSeconds.toFixed(3)}s, hold ${scene.pauseAndVisualHoldSeconds.toFixed(3)}s`);
}
console.log(`Total video duration: ${evaluatedDuration.toFixed(3)} seconds`);
console.log(`Remaining before ${maximum.toFixed(3)} seconds: ${(maximum - evaluatedDuration).toFixed(3)} seconds`);

if (evaluatedDuration > maximum || evaluatedDuration >= 180) {
  throw new Error(`Duration ${evaluatedDuration.toFixed(3)}s exceeds the enforced maximum of ${maximum.toFixed(3)}s. Shorten narration and regenerate voice.`);
}
