import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type BadgeShape = 'rect' | 'pill';

interface BadgeProps {
  variant?: BadgeVariant;
  shape?: BadgeShape;
  children: ReactNode;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--color-success-text)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning-text)' },
  danger:  { bg: 'var(--color-danger-bg)',  color: 'var(--color-danger-text)'  },
  info:    { bg: 'var(--color-info-bg)',    color: 'var(--color-info-text)'    },
  neutral: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' },
};

export function Badge({ variant = 'neutral', shape = 'rect', children, className = '' }: BadgeProps) {
  const { bg, color } = VARIANT_STYLES[variant];

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: shape === 'pill' ? '999px' : 'var(--radius-sm)',
        fontSize: 'var(--text-caption)',
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        background: bg,
        color,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
