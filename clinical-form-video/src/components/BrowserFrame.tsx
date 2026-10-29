import type {ReactNode} from 'react';

export const BrowserFrame = ({children, label = 'Actual system operation'}: {children: ReactNode; label?: string}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      borderRadius: 22,
      overflow: 'hidden',
      background: '#fff',
      border: '1px solid rgba(8,42,74,.18)',
      boxShadow: '0 26px 70px rgba(8,42,74,.18)',
    }}
  >
    <div
      style={{
        height: 46,
        background: '#eaf1f7',
        borderBottom: '1px solid #ccdae7',
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 10,
        fontFamily: 'Arial, sans-serif',
        color: '#41627e',
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#ef6b6b'}} />
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#edbd54'}} />
      <span style={{width: 12, height: 12, borderRadius: 99, background: '#4dbb83'}} />
      <span style={{marginLeft: 12}}>{label}</span>
    </div>
    <div style={{height: 'calc(100% - 46px)', overflow: 'hidden'}}>{children}</div>
  </div>
);
