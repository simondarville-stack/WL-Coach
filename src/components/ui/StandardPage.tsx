import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
  hasSidePanel?: boolean;
}

/**
 * Framing A — standard content page.
 *
 * Default (no panel):
 * - Off-white page background
 * - White work surface card with hairline border on all sides and 8px radius
 * - Symmetric 48px horizontal padding, 24px vertical padding
 *
 * When hasSidePanel=true:
 * - Work surface keeps left/top/bottom border and left radius
 * - Right side goes flush to viewport edge (no right border, no right radius)
 * - Left padding preserved (48px) so the list stays anchored to the sidebar
 * - Side panel docks flush to the right edge of the viewport
 */
export function StandardPage({ children, hasSidePanel = false }: StandardPageProps) {
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
          padding: hasSidePanel
            ? 'var(--space-xl) 0 var(--space-xl) 48px'
            : 'var(--space-xl) 48px',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRight: hasSidePanel ? 'none' : undefined,
            borderRadius: hasSidePanel
              ? 'var(--radius-lg) 0 0 var(--radius-lg)'
              : 'var(--radius-lg)',
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
