import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-04')!;
export const Scene04CDASHMapping = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={4} burnCaptions={burnCaptions} />;
