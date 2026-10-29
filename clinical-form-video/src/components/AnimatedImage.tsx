import {Img, interpolate, staticFile, useCurrentFrame} from 'remotion';

type Props = {
  src: string;
  startScale?: number;
  endScale?: number;
  panX?: number;
  panY?: number;
  opacity?: number;
  objectFit?: 'contain' | 'cover';
};

export const AnimatedImage = ({
  src,
  startScale = 1,
  endScale = 1.045,
  panX = 0,
  panY = 0,
  opacity = 1,
  objectFit = 'contain',
}: Props) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 240], [startScale, endScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateX = interpolate(frame, [0, 240], [0, panX], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(frame, [0, 240], [0, panY], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Img
      src={staticFile(src)}
      style={{
        width: '100%',
        height: '100%',
        objectFit,
        opacity,
        transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
      }}
    />
  );
};
