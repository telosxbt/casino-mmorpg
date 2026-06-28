import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...panel, width }} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ fontWeight: 700 }}>{title}</span>
          <button style={x} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#000a', display: 'grid', placeItems: 'center', zIndex: 20,
};
const panel: React.CSSProperties = {
  background: '#15151f', border: '1px solid #2a2a3a', borderRadius: 14, padding: 18, maxHeight: '86vh', overflowY: 'auto',
};
const head: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 14 };
const x: React.CSSProperties = { marginLeft: 'auto', background: 'transparent', color: '#aaa', border: 0, fontSize: 18, cursor: 'pointer' };

export const field: React.CSSProperties = {
  background: '#1c1c2a', color: '#fff', border: '1px solid #2a2a3a', borderRadius: 8, padding: '8px 10px', width: '100%',
};
export const action: React.CSSProperties = {
  background: '#e0c84b', color: '#111', border: 0, padding: '10px 16px', borderRadius: 10, fontWeight: 700, cursor: 'pointer',
};
export const fairnessNote: React.CSSProperties = { fontSize: 11, color: '#889', marginTop: 10, wordBreak: 'break-all' };
