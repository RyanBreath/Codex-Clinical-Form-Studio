import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-05')!;
export const Scene05ECRFGeneration = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={5} burnCaptions={burnCaptions} />;
