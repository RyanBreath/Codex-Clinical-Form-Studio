export const SceneHeader = ({index, title}: {index: number; title: string}) => (
  <div
    style={{
      position: 'absolute',
      left: 72,
      top: 48,
      zIndex: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      color: '#082a4a',
      fontFamily: 'Arial, sans-serif',
    }}
  >
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 16,
        background: 'linear-gradient(135deg, #075bb7, #058f91)',
        color: 'white',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: 24,
        boxShadow: '0 10px 26px rgba(5,91,183,.22)',
      }}
    >
      {String(index).padStart(2, '0')}
    </div>
    <div>
      <div style={{fontSize: 15, textTransform: 'uppercase', letterSpacing: 3, color: '#078688', fontWeight: 800}}>
        Codex Clinical Form Studio
      </div>
      <div style={{fontSize: 31, fontWeight: 800, marginTop: 3}}>{title}</div>
    </div>
  </div>
);
