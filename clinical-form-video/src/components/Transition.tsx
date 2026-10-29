import type {ReactNode} from 'react';
import {interpolate, useCurrentFrame} from 'remotion';

export const Transition = ({children, durationInFrames, fadeFrames = 15}: {children: ReactNode; durationInFrames: number; fadeFrames?: number}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, fadeFrames, Math.max(fadeFrames + 1, durationInFrames - fadeFrames), durationInFrames - 1],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  return <div style={{position: 'absolute', inset: 0, opacity}}>{children}</div>;
};
