import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
  /**
   * When true, the work surface becomes edge-to-edge with no border/radius.
   * Use when a side panel is open — the panel becomes the dominant surface
   * and the underlying list recedes to background.
   * Defaults to false (framed card treatment).
   */
  hasSidePanel?: boolean;
}

/**
 * Framing A — standard content page.
 *
 * Used for: macro detail, exercise library, athlete list, settings.
 *
 * Default (framed):
 * - Off-white page background (--color-bg-page)
 * - White work surface card with hairline border and 8px radius
 * - Symmetric 24px vertical, 48px horizontal padding from viewport edges
 * - Work surface fills available width (no max-width cap)
 *
 * When hasSidePanel=true (edge-to-edge):
 * - Same off-white page background
 * - No border, no radius, no horizontal padding — list goes to the viewport edge
 * - Keeps 24px top/bottom padding for breathing room from chrome
 * - Signals that the panel is the dominant focus; this list is background
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
            ? 'var(--space-xl) 0'
            : 'var(--space-xl) 48px',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: hasSidePanel
              ? 'none'
              : '0.5px solid var(--color-border-tertiary)',
            borderRadius: hasSidePanel
              ? 0
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
