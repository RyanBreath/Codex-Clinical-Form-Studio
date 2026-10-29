import {interpolate, useCurrentFrame} from 'remotion';

export const CursorIndicator = ({x, y}: {x: number; y: number}) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame % 36, [0, 18, 35], [0.65, 1, 0.65]);
  return (
    <div style={{position: 'absolute', left: `${x}%`, top: `${y}%`, zIndex: 14, transform: 'translate(-50%, -50%)'}}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 99,
          border: '4px solid #00a8a8',
          background: 'rgba(255,255,255,.75)',
          transform: `scale(${pulse})`,
          boxShadow: '0 0 0 12px rgba(0,168,168,.18)',
        }}
      />
    </div>
  );
};
