import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  /** Accessible group name for screen readers. */
  ariaLabel?: string;
  /** Each option flexes to fill the row equally. */
  fullWidth?: boolean;
}

/**
 * The single "pick one of N" primitive. Replaces the ad-hoc toggle button
 * groups (scope, compare, normalize, view, build/monitor) so they look and
 * behave identically and are accessible: `role="radiogroup"` + `aria-checked`,
 * token-driven 150ms transitions, full keyboard reachability.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  ariaLabel,
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const padding = size === 'sm' ? '4px 10px' : '6px 12px';
  const fontSize = size === 'sm' ? 'var(--text-caption)' : 'var(--text-label)';

  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.id)}
            className="emos-btn"
            style={{
              padding,
              fontSize,
              borderRadius: 'var(--radius-md)',
              background: active ? 'var(--color-accent)' : 'var(--color-bg-primary)',
              color: active ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
              border: active ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
              fontWeight: active ? 500 : 400,
              transition: 'background var(--transition-base), color var(--transition-base), border-color var(--transition-base)',
              flex: fullWidth ? '1 1 0' : undefined,
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
