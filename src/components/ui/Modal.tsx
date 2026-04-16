import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  footer?: ReactNode;
}

const SIZE_WIDTHS: Record<ModalSize, string> = {
  sm: '28rem',
  md: '32rem',
  lg: '42rem',
  xl: '56rem',
};

export function Modal({ isOpen, onClose, title, size = 'md', children, footer }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-backdrop-in"
      style={{ background: 'rgba(0, 0, 0, 0.15)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-dialog-in"
        style={{
          width: '100%',
          maxWidth: SIZE_WIDTHS[size],
          maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 'var(--radius-xl)',
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
              padding: 'var(--space-lg)',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
            }}
          >
            <h2
              style={{
                fontSize: 'var(--text-section)',
                fontWeight: 500,
                letterSpacing: 'var(--tracking-section)',
                margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
              }}
              aria-label="Close"
            >
              <X size={18} />
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
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
