import {Audio} from '@remotion/media';
import {AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import manifestJson from '../data/assets-manifest.json';
import type {AssetManifestEntry, SceneDefinition} from '../types';
import {AnimatedImage} from './AnimatedImage';
import {BrowserFrame} from './BrowserFrame';
import {Caption} from './Caption';
import {CursorIndicator} from './CursorIndicator';
import {HighlightBox} from './HighlightBox';
import {SafeArea} from './SafeArea';
import {SceneHeader} from './SceneHeader';
import {Transition} from './Transition';

type Manifest = {assets: AssetManifestEntry[]};
const manifest = manifestJson as Manifest;
const available = new Set(manifest.assets.map((asset) => asset.relativePath.replaceAll('\\', '/')));

const isAvailable = (asset: string) => available.has(asset.replaceAll('\\', '/'));

const OverlayPills = ({items}: {items: string[]}) => (
  <div style={{position: 'absolute', right: 72, top: 57, display: 'flex', gap: 12, zIndex: 20}}>
    {items.slice(0, 2).map((item) => (
      <div
        key={item}
        style={{
          padding: '11px 17px',
          borderRadius: 999,
          color: '#075c66',
          background: 'rgba(230,250,249,.94)',
          border: '1px solid rgba(0,137,143,.28)',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 800,
          fontSize: 18,
          boxShadow: '0 8px 20px rgba(12,86,100,.1)',
        }}
      >
        {item}
      </div>
    ))}
  </div>
);

const EndCard = () => (
  <AbsoluteFill
    style={{
      zIndex: 40,
      background: 'linear-gradient(135deg, #f7fbff 0%, #e8f7f6 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      color: '#082a4a',
      fontFamily: 'Arial, sans-serif',
      textAlign: 'center',
    }}
  >
    <div style={{fontSize: 30, color: '#00858c', letterSpacing: 5, fontWeight: 800}}>FROM PROTOCOL TO PRODUCTION</div>
    <div style={{fontSize: 78, fontWeight: 900, marginTop: 22}}>Codex Clinical Form Studio</div>
    <div style={{fontSize: 36, color: '#315a78', marginTop: 22}}>Reusable Plugin · Orchestrated Skills · Production-ready eCRF</div>
    <div
      style={{
        fontSize: 31,
        fontWeight: 800,
        color: '#fff',
        background: 'linear-gradient(90deg, #075bb7, #008d8e)',
        borderRadius: 18,
        padding: '18px 32px',
        marginTop: 50,
      }}
    >
      Human approval at every critical clinical decision.
    </div>
  </AbsoluteFill>
);

export const SceneTemplate = ({scene, index, burnCaptions}: {scene: SceneDefinition; index: number; burnCaptions: boolean}) => {
  const frame = useCurrentFrame();
  const fade = scene.transitions.durationFrames;
  const screenshots = scene.screenshots.filter(isAvailable);
  const recordings = scene.recordings.filter(isAvailable);
  const hasOperationVisual = screenshots.length > 0 || recordings.length > 0;
  const switchFrame = hasOperationVisual ? Math.round(scene.durationInFrames * 0.48) : scene.durationInFrames + fade;
  const infographicOpacity = interpolate(frame, [switchFrame - fade, switchFrame + fade], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });
  const operationOpacity = 1 - infographicOpacity;
  const visualFrames = Math.max(1, scene.durationInFrames - switchFrame);
  const screenshotIndex = Math.min(
    Math.max(0, screenshots.length - 1),
    Math.floor(((frame - switchFrame) / visualFrames) * Math.max(1, screenshots.length)),
  );
  const selectedScreenshot = screenshots[screenshotIndex] ?? scene.fallbackAssets.find(isAvailable) ?? 'placeholders/missing-visual.svg';
  const selectedRecording = recordings[0];
  const activeHighlight = scene.highlights[Math.min(scene.highlights.length - 1, Math.floor((frame / Math.max(1, switchFrame)) * scene.highlights.length))];
  const zoom = scene.zoomRegions[0] ?? {start: 1, end: 1.04, panX: 0, panY: 0};
  const showEndCard = scene.id === 'scene-08' && frame >= scene.durationInFrames - 72;

  return (
    <Transition durationInFrames={scene.durationInFrames} fadeFrames={fade}>
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at 12% 12%, #eefaff 0, #f9fcff 42%, #edf7f8 100%)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'linear-gradient(rgba(8,80,120,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(8,80,120,.035) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <SceneHeader index={index} title={scene.title} />
        <OverlayPills items={scene.overlays} />
        <SafeArea style={{top: 128}}>
          <div style={{position: 'absolute', inset: 0, opacity: infographicOpacity}}>
            <AnimatedImage
              src={scene.infographic}
              startScale={zoom.start}
              endScale={zoom.end}
              panX={zoom.panX}
              panY={zoom.panY}
            />
            {activeHighlight ? <HighlightBox highlight={activeHighlight} /> : null}
          </div>
          <div style={{position: 'absolute', inset: '10px 70px 4px', opacity: operationOpacity}}>
            <BrowserFrame label={selectedRecording ? 'Recorded system operation' : 'Actual system operation'}>
              {selectedRecording ? (
                <OffthreadVideo src={staticFile(selectedRecording)} muted style={{width: '100%', height: '100%', objectFit: 'contain'}} />
              ) : (
                <AnimatedImage src={selectedScreenshot} startScale={1} endScale={1.025} objectFit="contain" />
              )}
            </BrowserFrame>
            {frame > switchFrame + 20 ? <CursorIndicator x={76} y={62} /> : null}
          </div>
        </SafeArea>
        <Audio src={staticFile(scene.narrationAudio)} />
        {burnCaptions ? <Caption sceneId={scene.id} /> : null}
        {showEndCard ? <EndCard /> : null}
      </AbsoluteFill>
    </Transition>
  );
};
