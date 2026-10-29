import type {CSSProperties, ReactNode} from 'react';

export const SafeArea = ({children, style}: {children: ReactNode; style?: CSSProperties}) => (
  <div
    style={{
      position: 'absolute',
      left: 54,
      right: 54,
      top: 42,
      bottom: 138,
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);
