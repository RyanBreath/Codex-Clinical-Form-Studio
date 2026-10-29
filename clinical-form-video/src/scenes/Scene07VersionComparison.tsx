import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-07')!;
export const Scene07VersionComparison = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={7} burnCaptions={burnCaptions} />;
