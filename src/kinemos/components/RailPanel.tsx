/**
 * RailPanel — one collapsible panel of the viewer's rail.
 *
 * The header row is the click target and carries the panel's HEADLINE — the
 * one value that should be readable without opening it (peak velocity, the
 * count of flagged frames, the calibration's scale), so a collapsed panel is
 * never a mystery box. The headline stays in the header when the panel is
 * open too: it is the panel's summary, not a substitute for its content.
 *
 * A real `<button>` with `aria-expanded`, so the rail reads as what it is to
 * a keyboard and a screen reader; the chevron label says the verb rather than
 * leaving a glyph to carry it.
 */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface RailPanelProps {
  title: ReactNode;
  /** The value that stands for the panel when it is collapsed. */
  headline?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Something that must not toggle the panel when pressed — a Trash button
   *  in the header. Rendered outside the toggle button. */
  actions?: ReactNode;
}

export const RailPanel = forwardRef<HTMLElement, RailPanelProps>(function RailPanel(
  { title, headline, open, onToggle, children, actions },
  ref,
) {
  return (
    <section ref={ref} style={panel}>
      <div style={headerRow}>
        <button type="button" onClick={onToggle} aria-expanded={open} style={toggleButton} className="kinemos-rail-toggle">
          <span style={titleStyle}>{title}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {headline}
            <span style={chevron}>
              {open ? 'Collapse' : 'Open'}
              {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </span>
          </span>
        </button>
        {actions && <span style={{ display: 'inline-flex', alignItems: 'center', paddingRight: 8 }}>{actions}</span>}
      </div>
      {open && <div style={{ minHeight: 0 }}>{children}</div>}
    </section>
  );
});

/** The little value chip a headline usually is. Tone follows the app's four
 *  semantic states; `mono` for a number. */
export function HeadlineChip({
  children,
  tone = 'neutral',
  mono = false,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  mono?: boolean;
  title?: string;
}) {
  const tones: Record<NonNullable<typeof tone>, CSSProperties> = {
    neutral: {
      background: 'var(--color-bg-secondary)',
      color: 'var(--color-text-secondary)',
      borderColor: 'var(--color-border-tertiary)',
    },
    success: {
      background: 'var(--color-success-bg)',
      color: 'var(--color-success-text)',
      borderColor: 'var(--color-success-border)',
    },
    warning: {
      background: 'var(--color-warning-bg)',
      color: 'var(--color-warning-text)',
      borderColor: 'var(--color-warning-border)',
    },
    danger: {
      background: 'var(--color-danger-bg)',
      color: 'var(--color-danger-text)',
      borderColor: 'var(--color-danger-border)',
    },
    accent: {
      background: 'var(--color-accent-muted)',
      color: 'var(--color-accent-hover)',
      borderColor: 'var(--color-accent-border)',
    },
  };
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        border: '0.5px solid',
        fontSize: 'var(--text-caption)',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}

const panel: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
};

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
};

const toggleButton: CSSProperties = {
  flexGrow: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '7px 12px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

const titleStyle: CSSProperties = {
  fontSize: 'var(--text-label)',
  fontWeight: 600,
  letterSpacing: 'var(--tracking-section)',
  whiteSpace: 'nowrap',
};

const chevron: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 'var(--text-caption)',
  color: 'var(--color-accent)',
  whiteSpace: 'nowrap',
};
