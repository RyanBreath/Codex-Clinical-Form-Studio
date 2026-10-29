import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-03')!;
export const Scene03ProtocolAnalysis = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={3} burnCaptions={burnCaptions} />;
