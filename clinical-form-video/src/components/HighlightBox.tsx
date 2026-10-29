import {interpolate, useCurrentFrame} from 'remotion';
import type {Highlight} from '../types';

export const HighlightBox = ({highlight}: {highlight: Highlight}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame % 90, [0, 12, 68, 89], [0.2, 1, 1, 0.3]);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${highlight.x}%`,
        top: `${highlight.y}%`,
        width: `${highlight.width}%`,
        height: `${highlight.height}%`,
        border: '4px solid #00a8a8',
        borderRadius: 16,
        boxShadow: '0 0 0 5px rgba(0,168,168,.13), 0 10px 32px rgba(0,85,130,.22)',
        opacity,
        pointerEvents: 'none',
      }}
    >
      {highlight.label ? (
        <span
          style={{
            position: 'absolute',
            left: 10,
            top: -38,
            background: '#007d86',
            color: 'white',
            padding: '7px 13px',
            borderRadius: 10,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 800,
            fontSize: 18,
            whiteSpace: 'nowrap',
          }}
        >
          {highlight.label}
        </span>
      ) : null}
    </div>
  );
};
