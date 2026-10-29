import {Audio} from '@remotion/media';
import {AbsoluteFill, Sequence, staticFile} from 'remotion';
import manifestJson from './data/assets-manifest.json';
import scenesJson from './data/scenes.json';
import {Scene01Problem} from './scenes/Scene01Problem';
import {Scene02Orchestrator} from './scenes/Scene02Orchestrator';
import {Scene03ProtocolAnalysis} from './scenes/Scene03ProtocolAnalysis';
import {Scene04CDASHMapping} from './scenes/Scene04CDASHMapping';
import {Scene05ECRFGeneration} from './scenes/Scene05ECRFGeneration';
import {Scene06AutomatedQA} from './scenes/Scene06AutomatedQA';
import {Scene07VersionComparison} from './scenes/Scene07VersionComparison';
import {Scene08Deployment} from './scenes/Scene08Deployment';
import type {AssetManifestEntry, SceneDefinition} from './types';

const scenes = scenesJson as SceneDefinition[];
const manifest = manifestJson as {assets: AssetManifestEntry[]};
const backgroundExists = manifest.assets.some((asset) => asset.relativePath.replaceAll('\\', '/') === 'audio/background.mp3');
const sceneComponents = [
  Scene01Problem,
  Scene02Orchestrator,
  Scene03ProtocolAnalysis,
  Scene04CDASHMapping,
  Scene05ECRFGeneration,
  Scene06AutomatedQA,
  Scene07VersionComparison,
  Scene08Deployment,
];

export const ClinicalFormStudioVideo = ({burnCaptions}: {burnCaptions: boolean}) => {
  let from = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#f5faff'}}>
      {scenes.map((scene, index) => {
        const start = from;
        from += scene.durationInFrames;
        const Scene = sceneComponents[index];
        return (
          <Sequence key={scene.id} from={start} durationInFrames={scene.durationInFrames} premountFor={30}>
            <Scene burnCaptions={burnCaptions} />
          </Sequence>
        );
      })}
      {backgroundExists ? (
        <Audio
          src={staticFile('audio/background.mp3')}
          loop
          volume={(frame) => {
            const fadeIn = Math.min(1, frame / 60);
            const totalFrames = scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
            const fadeOut = Math.min(1, Math.max(0, (totalFrames - frame) / 90));
            return 0.055 * fadeIn * fadeOut;
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
