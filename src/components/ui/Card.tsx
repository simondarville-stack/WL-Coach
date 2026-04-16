import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

const PADDING_MAP = {
  none: '0',
  sm: 'var(--space-md)',
  md: 'var(--space-lg)',
  lg: 'var(--space-xl)',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--radius-lg)',
        padding: PADDING_MAP[padding],
      }}
    >
      {children}
    </div>
  );
}
