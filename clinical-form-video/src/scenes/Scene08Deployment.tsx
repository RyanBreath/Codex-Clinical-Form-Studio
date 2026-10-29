import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-08')!;
export const Scene08Deployment = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={8} burnCaptions={burnCaptions} />;
