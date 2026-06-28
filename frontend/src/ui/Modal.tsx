import type { ReactNode } from 'react';
import './casino.css';

export function Modal({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="cz-overlay" onClick={onClose}>
      <div className="cz-frame" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <button className="cz-close" onClick={onClose} aria-label="close">
          ✕
        </button>
        <div className="cz-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
