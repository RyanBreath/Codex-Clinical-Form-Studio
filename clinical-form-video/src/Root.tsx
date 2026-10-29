import {Composition} from 'remotion';
import {ClinicalFormStudioVideo} from './ClinicalFormStudioVideo';
import scenesJson from './data/scenes.json';
import type {SceneDefinition} from './types';

const scenes = scenesJson as SceneDefinition[];
const fps = Number(process.env.VIDEO_FPS ?? 30);
const width = Number(process.env.VIDEO_WIDTH ?? 1920);
const height = Number(process.env.VIDEO_HEIGHT ?? 1080);
const durationInFrames = scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);

export const RemotionRoot = () => (
  <>
    <Composition
      id="ClinicalFormStudioWithCaptions"
      component={ClinicalFormStudioVideo}
      defaultProps={{burnCaptions: true}}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
    />
    <Composition
      id="ClinicalFormStudioNoCaptions"
      component={ClinicalFormStudioVideo}
      defaultProps={{burnCaptions: false}}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
    />
  </>
);
