/**
 * DisplayOptions — one small popover of drawing choices, used by the clip
 * overlay and by the bar-path plots.
 *
 * A row is a choice (pills, one active), a toggle, or a group of toggles
 * (the plot's labels). Dense on purpose: a coach flips these while looking
 * at a lift, not in a settings page. The button that opens it carries a
 * dot while anything is off its default, so a thinned-out view is never a
 * mystery the next morning.
 */
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
}

export type OptionRow =
  | {
      kind: 'choice';
      label: string;
      value: string | number;
      options: ReadonlyArray<ChoiceOption<string | number>>;
      onChange: (value: never) => void;
      /** Greyed with a reason, e.g. a centimetre grid with no calibration. */
      disabledReason?: string | null;
    }
  | { kind: 'toggle'; label: string; value: boolean; onChange: (value: boolean) => void }
  | {
      kind: 'toggles';
      label: string;
      items: ReadonlyArray<{ key: string; label: string; value: boolean; title?: string }>;
      onChange: (key: string, value: boolean) => void;
    };

interface DisplayOptionsProps {
  /** Shown in the button's tooltip and the popover's header. */
  title: string;
  rows: OptionRow[];
  /** Whether anything differs from the defaults — draws the dot. */
  modified: boolean;
  onReset: () => void;
  /** Where the popover opens from the button. */
  align?: 'left' | 'right';
  /** Dark chip for the video stage, plain for a panel header. */
  tone?: 'stage' | 'panel';
  /** Extra content under the rows, e.g. a colour legend for the heat line. */
  footer?: ReactNode;
}

export function DisplayOptions({ title, rows, modified, onReset, align = 'left', tone = 'panel', footer }: DisplayOptionsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside press or Escape closes; a press inside — including on a pill —
  // keeps it open, so several choices can be flipped in one visit.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const stage = tone === 'stage';

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${title} · display options`}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          height: 24,
          padding: '0 7px',
          borderRadius: 'var(--radius-sm)',
          border: stage ? 'none' : `0.5px solid ${open ? 'var(--color-accent)' : 'var(--color-border-secondary)'}`,
          background: stage ? 'rgba(0,0,0,0.55)' : open ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
          color: stage ? '#FFFFFF' : 'var(--color-text-secondary)',
          fontSize: 'var(--text-caption)',
          cursor: 'pointer',
        }}
      >
        <SlidersHorizontal size={12} />
        {modified && (
          <span
            aria-label="changed from the defaults"
            style={{
              position: 'absolute',
              top: 3,
              right: 3,
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: stage ? '#F2C14E' : 'var(--color-accent)',
            }}
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${title} display options`}
          style={{
            position: 'absolute',
            top: 28,
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 20,
            width: 248,
            maxHeight: '70vh',
            overflowY: 'auto',
            padding: '8px 10px 10px',
            borderRadius: 'var(--radius-md)',
            border: '0.5px solid var(--color-border-secondary)',
            background: 'var(--color-bg-primary)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
            color: 'var(--color-text-primary)',
            textAlign: 'left',
            lineHeight: 1.3,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--text-label)', fontWeight: 600, letterSpacing: 'var(--tracking-section)' }}>{title}</span>
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <button
                type="button"
                onClick={onReset}
                disabled={!modified}
                title="Back to the defaults"
                style={{ ...iconButton, opacity: modified ? 1 : 0.4, cursor: modified ? 'pointer' : 'default' }}
              >
                <RotateCcw size={11} />
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Close" style={iconButton}>
                <X size={12} />
              </button>
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map(row => (
              <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {row.kind === 'toggle' ? (
                  <label style={toggleRow}>
                    <span style={rowLabel}>{row.label}</span>
                    <input type="checkbox" checked={row.value} onChange={e => row.onChange(e.target.checked)} />
                  </label>
                ) : (
                  <>
                    <span style={rowLabel} title={row.kind === 'choice' ? row.disabledReason ?? undefined : undefined}>
                      {row.label}
                      {row.kind === 'choice' && row.disabledReason ? <span style={{ color: 'var(--color-text-tertiary)' }}> · {row.disabledReason}</span> : null}
                    </span>
                    {row.kind === 'choice' ? (
                      <div role="radiogroup" aria-label={row.label} style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {row.options.map(option => {
                          const active = option.value === row.value;
                          return (
                            <button
                              key={String(option.value)}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              title={option.title}
                              disabled={!!row.disabledReason}
                              onClick={() => (row.onChange as (value: string | number) => void)(option.value)}
                              style={pill(active, !!row.disabledReason)}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {row.items.map(item => (
                          <button
                            key={item.key}
                            type="button"
                            role="checkbox"
                            aria-checked={item.value}
                            title={item.title}
                            onClick={() => row.onChange(item.key, !item.value)}
                            style={pill(item.value, false)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}

const rowLabel: CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-secondary)',
};

const toggleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  cursor: 'pointer',
};

const iconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

function pill(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '2px 8px',
    borderRadius: 'var(--radius-md)',
    border: active ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
    background: active ? 'var(--color-accent)' : 'var(--color-bg-primary)',
    color: active ? 'var(--color-text-on-accent)' : disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'var(--text-caption)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}
