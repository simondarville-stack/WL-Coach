import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
}

/**
 * Framing A — standard content page.
 *
 * Used for: macro detail, exercise library, athlete list, settings.
 *
 * Structure:
 * - Off-white page background (--color-bg-page)
 * - White work surface card inset by 24px
 * - 8px radius, 0.5px hairline border
 * - Max width 1400px centered
 * - Children fill the work surface with their own padding
 */
export function StandardPage({ children }: StandardPageProps) {
  return (
    <div
      style={{
        background: 'var(--color-bg-page)',
        minHeight: '100%',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          maxWidth: 'var(--work-area-max-width)',
          margin: '0 auto',
          padding: 'var(--space-xl)',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--radius-lg)',
            minHeight: 'calc(100% - 2px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
