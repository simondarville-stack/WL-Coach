import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: ReactNode;
  caption?: ReactNode; // Optional right-aligned subdued text
  className?: string;
}

export function SectionHeader({ title, caption, className = '' }: SectionHeaderProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: 'var(--space-xl)',
        marginBottom: 'var(--space-md)',
        gap: 'var(--space-md)',
      }}
    >
      <h2
        style={{
          fontSize: 'var(--text-section)',
          fontWeight: 500,
          letterSpacing: 'var(--tracking-section)',
          lineHeight: 'var(--leading-section)',
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
      >
        {title}
      </h2>
      {caption && (
        <span
          style={{
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}
