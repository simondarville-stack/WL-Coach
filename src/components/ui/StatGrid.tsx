import type { ReactNode } from 'react';

interface StatGridProps {
  columns?: 2 | 3 | 4 | 5;
  children: ReactNode;
}

export function StatGrid({ columns = 4, children }: StatGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '1px',
        background: 'var(--color-border-tertiary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}
