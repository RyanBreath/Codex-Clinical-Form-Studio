export type Highlight = {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type SceneDefinition = {
  id: string;
  title: string;
  narrationText: string;
  narrationAudio: string;
  infographic: string;
  screenshots: string[];
  recordings: string[];
  fallbackAssets: string[];
  maxDurationSeconds: number;
  actualDurationSeconds: number;
  durationInFrames: number;
  overlays: string[];
  highlights: Highlight[];
  cropRegions: Array<{x: number; y: number; width: number; height: number}>;
  zoomRegions: Array<{start: number; end: number; panX: number; panY: number}>;
  transitions: {type: 'fade' | 'crossfade'; durationFrames: number};
  captionPosition: 'top' | 'bottom';
  backgroundMusicLevel: number;
};

export type CaptionEntry = {
  id: number;
  sceneId: string;
  localStartSeconds: number;
  localEndSeconds: number;
  globalStartSeconds: number;
  globalEndSeconds: number;
  en: string;
  zhTW: string;
};

export type AssetManifestEntry = {
  relativePath: string;
  kind: 'image' | 'video' | 'audio';
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  durationSeconds: number | null;
  codec: string | null;
  frameRate: number | null;
  fileSize: number;
  placeholder: boolean;
};
