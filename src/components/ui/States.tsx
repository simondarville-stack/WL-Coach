import type { ReactNode } from 'react';

/** Shared empty/zero-data state. Replaces the per-component "Empty" copies. */
export function EmptyState({ title, message, action }: { title?: string; message: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ padding: 'var(--space-2xl)', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      {title && (
        <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 'var(--space-sm)' }}>
          {title}
        </div>
      )}
      <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{message}</div>
      {action && <div style={{ marginTop: 'var(--space-md)' }}>{action}</div>}
    </div>
  );
}

/** Shared error state with an optional retry. */
export function ErrorState({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  return (
    <div style={{ padding: 'var(--space-xl)', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-danger-text)', lineHeight: 1.5 }}>{message}</div>
      {onRetry && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <button
            type="button"
            onClick={onRetry}
            className="emos-btn emos-btn-secondary"
            style={{ padding: '6px 14px', fontSize: 'var(--text-label)', borderRadius: 'var(--radius-md)' }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
