import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow?: ReactNode;   // Small context above title (e.g. "Macrocycle III")
  title: ReactNode;      // Main page title
  subtitle?: ReactNode;  // Small description below
  metadata?: ReactNode;  // Right-aligned meta (e.g. date range)
}

export function PageHeader({ eyebrow, title, subtitle, metadata }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingBottom: 'var(--space-lg)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        marginBottom: 'var(--space-xl)',
        gap: 'var(--space-lg)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              marginBottom: '6px',
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          style={{
            fontSize: 'var(--text-page-title)',
            fontWeight: 500,
            letterSpacing: 'var(--tracking-page-title)',
            lineHeight: 'var(--leading-page-title)',
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--text-body)',
              color: 'var(--color-text-secondary)',
              marginTop: '4px',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {metadata && (
        <div
          style={{
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-secondary)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.7,
            flexShrink: 0,
          }}
        >
          {metadata}
        </div>
      )}
    </header>
  );
}
