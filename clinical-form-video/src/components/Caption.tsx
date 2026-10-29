import {useCurrentFrame, useVideoConfig} from 'remotion';
import captionsJson from '../data/captions.json';
import type {CaptionEntry} from '../types';

const captions = captionsJson as CaptionEntry[];

export const Caption = ({sceneId}: {sceneId: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const current = captions.find(
    (caption) => caption.sceneId === sceneId && seconds >= caption.localStartSeconds && seconds <= caption.localEndSeconds,
  );

  if (!current) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 210,
        right: 210,
        bottom: 34,
        minHeight: 82,
        zIndex: 30,
        display: 'grid',
        placeItems: 'center',
        padding: '8px 26px',
        color: '#fff',
        background: 'rgba(4,24,43,.88)',
        borderRadius: 16,
        fontFamily: 'Arial, sans-serif',
        fontSize: 34,
        lineHeight: 1.22,
        fontWeight: 700,
        textAlign: 'center',
        boxShadow: '0 10px 32px rgba(0,0,0,.2)',
      }}
    >
      {current.en}
    </div>
  );
};
