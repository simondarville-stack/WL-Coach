import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type SidePanelWidth = 'detail' | 'editor';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: SidePanelWidth;
  children: ReactNode;
  footer?: ReactNode;
}

const WIDTHS: Record<SidePanelWidth, string> = {
  detail: '320px',
  editor: '480px',
};

export function SidePanel({ isOpen, onClose, title, width = 'detail', children, footer }: SidePanelProps) {
  if (!isOpen) return null;

  return (
    <div
      className="animate-sidebar-in"
      style={{
        width: WIDTHS[width],
        flexShrink: 0,
        background: 'var(--color-bg-primary)',
        borderLeft: '0.5px solid var(--color-border-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-md) var(--space-lg)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-section)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              minWidth: 0,
              flex: 1,
            }}
          >
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 }}>
        {children}
      </div>
      {footer && (
        <div
          style={{
            padding: 'var(--space-md) var(--space-lg)',
            borderTop: '0.5px solid var(--color-border-tertiary)',
            display: 'flex',
            gap: 'var(--space-sm)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
