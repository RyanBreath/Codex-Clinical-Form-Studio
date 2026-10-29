import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-06')!;
export const Scene06AutomatedQA = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={6} burnCaptions={burnCaptions} />;
