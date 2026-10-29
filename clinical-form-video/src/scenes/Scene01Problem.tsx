import scenes from '../data/scenes.json';
import type {SceneDefinition} from '../types';
import {SceneTemplate} from '../components/SceneTemplate';

const scene = (scenes as SceneDefinition[]).find((item) => item.id === 'scene-01')!;
export const Scene01Problem = ({burnCaptions}: {burnCaptions: boolean}) => <SceneTemplate scene={scene} index={1} burnCaptions={burnCaptions} />;
