interface RestBadgeProps {
  hours: number | null;
  recoveryLevel: 'full' | 'partial' | 'short' | 'same-day' | null;
}

const RECOVERY_STYLE: Record<string, React.CSSProperties> = {
  'full':     { background: 'var(--color-success-bg)',  color: 'var(--color-success-text)' },
  'partial':  { background: 'var(--color-warning-bg)',  color: 'var(--color-warning-text)' },
  'short':    { background: 'var(--color-danger-bg)',   color: 'var(--color-danger-text)' },
  'same-day': { background: 'var(--color-info-bg)',     color: 'var(--color-info-text)' },
};

export function RestBadge({ hours, recoveryLevel }: RestBadgeProps) {
  if (hours === null || recoveryLevel === null) return null;

  const label = hours === 0 ? 'Same day'
    : hours < 1  ? `${Math.round(hours * 60)}min`
    : hours < 24 ? `${Math.round(hours)}h rest`
    : hours === 24 ? '24h rest'
    : hours === 48 ? '48h rest'
    : `${Math.round(hours / 24)}d rest`;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 99,
      ...RECOVERY_STYLE[recoveryLevel],
    }}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1"/>
        <path d="M4 2v2l1.5 1" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
      </svg>
      {label}
    </span>
  );
}
