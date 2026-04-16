import type { ReactNode } from 'react';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;  // The big number
  unit?: string;     // Optional unit (e.g. "kg", "t", "%")
  delta?: ReactNode; // Optional line below (trend, subtext)
}

export function StatCard({ label, value, unit, delta }: StatCardProps) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--color-bg-secondary)' }}>
      <div
        style={{
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-secondary)',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '22px',
          fontWeight: 500,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-primary)',
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && (
          <sub
            style={{
              fontSize: 'var(--text-label)',
              color: 'var(--color-text-tertiary)',
              fontWeight: 400,
              fontFamily: 'var(--font-sans)',
              marginLeft: '3px',
              verticalAlign: 'baseline',
            }}
          >
            {unit}
          </sub>
        )}
      </div>
      {delta && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            marginTop: '4px',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
