import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-02')!;
export const Scene02Orchestrator = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={2} burnCaptions={burnCaptions} />;
