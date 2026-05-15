// Small presentational atoms shared across the v2 dashboard. All visual tokens
// resolve from the global EMOS CSS variables so the v2 dashboard inherits the
// app's theming and stays in sync with the rest of the system.

import type { ReactNode } from 'react';
import type { RawPillars, BwSummary } from '../../hooks/useCoachDashboardV2';

export type WeekState = 'planned' | 'partial' | 'missing';

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

export function lastTrainLabel(days: number | null): string {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

const GROUP_AVATAR_COLORS: Record<string, string> = {
  'Senior A': '#E58CA8',
  'Senior B': '#5891CB',
  'Junior':   '#5DBA94',
  'Masters':  '#B0AEA7',
};

function avatarColor(group: string | null | undefined): string {
  if (group && GROUP_AVATAR_COLORS[group]) return GROUP_AVATAR_COLORS[group];
  // Deterministic fallback so different group names get different tints.
  if (!group) return '#B0AEA7';
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) & 0xffff;
  const palette = ['#E58CA8', '#5891CB', '#5DBA94', '#B0AEA7', '#C99B6A', '#9A8BD9'];
  return palette[h % palette.length];
}

export function Avatar({
  name, size = 28, group,
}: { name: string; size?: number; group?: string | null }) {
  const c = avatarColor(group);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size / 2,
        background: c + '22',
        color: c, border: `1px solid ${c}55`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size <= 24 ? 9.5 : 10.5, fontWeight: 600, letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}

export function PhasePill({
  name, color, week, total, compact,
}: { name: string | null; color?: string | null; week: number | null; total: number | null; compact?: boolean }) {
  const hasMacro = !!(name && week !== null && total !== null);
  if (!hasMacro) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 6,
        padding: compact ? '1px 6px' : '2px 8px',
        background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)',
        borderRadius: 2,
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        fontSize: compact ? 10 : 11, letterSpacing: '0.02em',
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>No macro</span>
      </span>
    );
  }
  // Use the macro phase's color where defined; otherwise neutral tint.
  const bg = color ? color + '22' : 'var(--color-bg-secondary)';
  const fg = color || 'var(--color-text-secondary)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      padding: compact ? '1px 6px' : '2px 8px',
      background: bg, color: fg, borderRadius: 2,
      fontFamily: 'var(--font-mono, ui-monospace), monospace',
      fontSize: compact ? 10 : 11, letterSpacing: '0.02em',
    }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{name}</span>
      <span style={{ opacity: 0.7 }}>· W{week}/{total}</span>
    </span>
  );
}

function weekTokens(state: WeekState) {
  if (state === 'planned') return {
    bg: 'var(--color-success-bg)', text: 'var(--color-success-text)', border: 'var(--color-success-border)',
    label: 'Planned',
  };
  if (state === 'partial') return {
    bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)', border: 'var(--color-warning-border)',
    label: 'Partial',
  };
  return {
    bg: 'var(--color-danger-bg)', text: 'var(--color-danger-text)', border: 'var(--color-danger-border)',
    label: 'Missing',
  };
}

export function WeekPill({
  state, label, compact,
}: { state: WeekState; label?: string; compact?: boolean }) {
  const c = weekTokens(state);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: compact ? '1px 6px' : '2px 8px',
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 2, fontSize: compact ? 10.5 : 11, fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: c.border }} />
      <span>{label ?? c.label}</span>
    </span>
  );
}

function rawTokens(avg: number | null) {
  if (avg === null) return {
    bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-tertiary)', border: 'var(--color-border-secondary)',
  };
  if (avg >= 10) return {
    bg: 'var(--color-success-bg)', text: 'var(--color-success-text)', border: 'var(--color-success-border)',
  };
  if (avg >= 7) return {
    bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)', border: 'var(--color-warning-border)',
  };
  return {
    bg: 'var(--color-danger-bg)', text: 'var(--color-danger-text)', border: 'var(--color-danger-border)',
  };
}

export function RawChip({
  pillars, avg, size = 'md',
}: { pillars: RawPillars | null; avg: number | null; size?: 'sm' | 'md' }) {
  const c = rawTokens(avg);
  const fs = size === 'sm' ? 11 : 12;
  const total = pillars?.total ?? null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      padding: size === 'sm' ? '1px 6px' : '2px 8px',
      background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2,
      fontFamily: 'var(--font-mono, ui-monospace), monospace',
      fontSize: fs, fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      <span>{total !== null ? total : '–'}</span>
      <span style={{ opacity: 0.55, fontSize: fs - 1.5 }}>/12</span>
      {avg !== null && size !== 'sm' && (
        <span style={{ opacity: 0.55, marginLeft: 2, fontSize: fs - 1.5 }}>avg {avg.toFixed(1)}</span>
      )}
    </span>
  );
}

export function RawPillarsBreakdown({
  pillars, trend,
}: { pillars: RawPillars | null; trend: number[] }) {
  if (!pillars) {
    return (
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        No RAW submitted in last 30 days
      </span>
    );
  }
  const rows: { k: keyof Omit<RawPillars, 'total'>; label: string; v: number | null }[] = [
    { k: 'sleep',     label: 'Sleep',     v: pillars.sleep },
    { k: 'physical',  label: 'Physical',  v: pillars.physical },
    { k: 'mood',      label: 'Mood',      v: pillars.mood },
    { k: 'nutrition', label: 'Nutrition', v: pillars.nutrition },
  ];
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      {rows.map(p => {
        const v = p.v;
        const tone = v === null ? 'var(--color-text-tertiary)'
          : v >= 3 ? 'var(--color-success-border)'
          : v >= 2 ? 'var(--color-warning-border)'
          : 'var(--color-danger-border)';
        const toneText = v === null ? 'var(--color-text-tertiary)'
          : v >= 3 ? 'var(--color-success-text)'
          : v >= 2 ? 'var(--color-warning-text)'
          : 'var(--color-danger-text)';
        return (
          <div key={p.k} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 62 }}>
            <span style={{
              fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 9.5,
              color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>{p.label}</span>
            <div style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
              {[1, 2, 3].map(i => (
                <span key={i} style={{
                  width: 14, height: 8, borderRadius: 1,
                  background: v !== null && i <= v ? tone : 'var(--color-bg-tertiary)',
                }} />
              ))}
              <span style={{
                marginLeft: 4, fontSize: 11, color: toneText, fontWeight: 500,
                fontFamily: 'var(--font-mono, ui-monospace), monospace',
              }}>
                {v ?? '–'}
              </span>
            </div>
          </div>
        );
      })}
      {trend.length >= 2 && (
        <div style={{
          marginLeft: 8, paddingLeft: 14,
          borderLeft: '1px solid var(--color-border-secondary)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 9.5,
            color: 'var(--color-text-tertiary)', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 3,
          }}>RAW total trend</div>
          <Sparkline points={trend} max={12} width={72} height={20}
                     stroke="var(--color-accent)" dotsLast />
        </div>
      )}
    </div>
  );
}

export function Sparkline({
  points, width = 60, height = 18, stroke = 'var(--color-accent)', max, dotsLast,
}: {
  points: number[]; width?: number; height?: number;
  stroke?: string; max?: number; dotsLast?: boolean;
}) {
  if (!points || points.length < 2) {
    return <div style={{ width, height, fontSize: 10, color: 'var(--color-text-tertiary)' }}>—</div>;
  }
  const mx = max ?? Math.max(...points);
  const mn = Math.min(...points, 0);
  const range = mx - mn || 1;
  const xs = (i: number) => (i / (points.length - 1)) * (width - 4) + 2;
  const ys = (v: number) => height - 2 - ((v - mn) / range) * (height - 4);
  const pts = points.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const lastX = xs(points.length - 1);
  const lastY = ys(points[points.length - 1]);
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.4} />
      {dotsLast && <circle cx={lastX} cy={lastY} r={2.2} fill={stroke} />}
    </svg>
  );
}

export function ComplianceSpark({
  values, width = 70, height = 20,
}: { values: number[]; width?: number; height?: number }) {
  if (!values.length) {
    return <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>—</span>;
  }
  const last = values[values.length - 1];
  const stroke = last >= 95 ? 'var(--color-success-border)'
    : last >= 85 ? 'var(--color-accent)'
    : last >= 75 ? 'var(--color-warning-border)'
    : 'var(--color-danger-border)';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Sparkline points={values} max={100} width={width} height={height} stroke={stroke} dotsLast />
      <span style={{
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        fontSize: 11, color: stroke, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
      }}>{Math.round(last)}%</span>
    </div>
  );
}

export function BwDelta({
  bw, expanded,
}: { bw: BwSummary | null; expanded?: boolean }) {
  if (!bw) return <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>—</span>;
  const up = bw.delta > 0.2, down = bw.delta < -0.2;
  const tone = up ? '#A45828' : down ? '#1F7A4D' : 'var(--color-text-tertiary)';
  const arrow = up ? '▲' : down ? '▼' : '·';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      fontFamily: 'var(--font-mono, ui-monospace), monospace',
    }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{bw.now.toFixed(1)}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>kg</span>
      <span style={{ fontSize: 10, color: tone, marginLeft: 2 }}>
        {arrow} {bw.delta > 0 ? '+' : ''}{bw.delta.toFixed(1)}
      </span>
      {expanded && (
        <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
          7d avg {bw.ma7.toFixed(1)} · 28d avg {bw.ma28.toFixed(1)}
        </span>
      )}
    </div>
  );
}

export function EventTag({
  name, kind, dateLabel, daysOut, compact,
}: { name: string; kind: 'comp' | 'camp'; dateLabel?: string; daysOut: number; compact?: boolean }) {
  const isComp = kind === 'comp';
  const c = isComp
    ? { bg: '#FFF0EA', text: '#7C3A0E', border: '#E8A57F', tag: 'COMP' }
    : { bg: '#E6F1FB', text: '#0C447C', border: '#85B7EB', tag: 'CAMP' };
  return (
    <span
      title={`${name}${dateLabel ? ' · ' + dateLabel : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 5,
        padding: compact ? '1px 6px' : '2px 7px',
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 2, fontSize: compact ? 10 : 10.5,
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        whiteSpace: 'nowrap', maxWidth: compact ? 140 : 200,
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: compact ? 8.5 : 9 }}>
        {c.tag}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span style={{ opacity: 0.6 }}>· {daysOut}d</span>
    </span>
  );
}

const FLAG_TINT: Record<string, 'danger' | 'warn'> = {
  'raw-drop':       'danger',
  'this-week-gap':  'danger',
  'next-week-gap':  'warn',
  'compliance':     'warn',
  'missed-recent':  'danger',
};

export function rowAlertTone(flags: string[]): 'danger' | 'warn' | null {
  if (!flags.length) return null;
  if (flags.some(f => FLAG_TINT[f] === 'danger')) return 'danger';
  return 'warn';
}

export const FLAG_LABELS: Record<string, { label: string; tint: 'danger' | 'warn' }> = {
  'raw-drop':       { label: 'RAW dropping',      tint: 'danger' },
  'this-week-gap':  { label: 'No plan this week', tint: 'danger' },
  'next-week-gap':  { label: 'No plan next week', tint: 'warn' },
  'compliance':     { label: 'Compliance < 85%',  tint: 'warn' },
  'missed-recent':  { label: 'No training 5+ d',  tint: 'danger' },
};

export function FlagDot({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  const tone = rowAlertTone(flags);
  const border = tone === 'danger' ? 'var(--color-danger-border)' : 'var(--color-warning-border)';
  return (
    <span
      title={flags.map(f => FLAG_LABELS[f]?.label || f).join(' · ')}
      style={{
        width: 7, height: 7, borderRadius: 4,
        background: border, display: 'inline-block', flexShrink: 0,
      }}
    />
  );
}

export function FlagChip({ id }: { id: string }) {
  const meta = FLAG_LABELS[id];
  if (!meta) return null;
  const bg = meta.tint === 'danger' ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)';
  const fg = meta.tint === 'danger' ? 'var(--color-danger-text)' : 'var(--color-warning-text)';
  const bd = meta.tint === 'danger' ? 'var(--color-danger-border)' : 'var(--color-warning-border)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', background: bg, color: fg,
      border: `1px solid ${bd}`, borderRadius: 2, fontSize: 11,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: bd }} />
      {meta.label}
    </span>
  );
}

export function SectionHeader({
  children, right,
}: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
      <span style={{
        fontSize: 11, color: 'var(--color-text-tertiary)',
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--color-border-tertiary)' }} />
      {right}
    </div>
  );
}

// Planned vs Actual chart — bars for planned, line for actual. The shape mirrors
// the prototype but accepts arbitrary-length series so we can plug in any
// 4-bucket comparison (reps, compliance, RAW).
export function PlannedActualChart({
  planned, actual, labels, yMax,
  width = 460, height = 130,
}: {
  planned: number[]; actual: number[]; labels: string[];
  yMax?: number; width?: number; height?: number;
}) {
  const n = Math.max(planned.length, actual.length, labels.length);
  if (n === 0) return null;
  const all = [...planned, ...actual];
  const mx = yMax ?? (all.length ? Math.max(...all) * 1.1 || 1 : 1);
  const padL = 32, padR = 8, padT = 8, padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const xs = (i: number) => padL + (i + 0.5) * (w / n);
  const ys = (v: number) => padT + h - (v / mx) * h;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {[0, mx * 0.5, mx].map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={width - padR} y1={ys(v)} y2={ys(v)}
                stroke="var(--color-border-tertiary)"
                strokeDasharray={i === 0 ? 'none' : '2,2'} />
          <text x={padL - 4} y={ys(v) + 3} textAnchor="end" fontSize="9"
                fontFamily="var(--font-mono, ui-monospace), monospace"
                fill="var(--color-text-tertiary)">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {planned.map((v, i) => {
        const bw = (w / n) * 0.55;
        return (
          <rect key={i} x={xs(i) - bw / 2} y={ys(v)} width={bw} height={ys(0) - ys(v)}
                fill="var(--color-bg-tertiary)"
                stroke="var(--color-border-secondary)" />
        );
      })}
      {actual.length >= 2 && (
        <polyline
          points={actual.map((v, i) => `${xs(i)},${ys(v)}`).join(' ')}
          fill="none" stroke="var(--color-accent)" strokeWidth={1.8}
        />
      )}
      {actual.map((v, i) => (
        <circle key={i} cx={xs(i)} cy={ys(v)} r={3} fill="var(--color-accent)" />
      ))}
      {labels.map((l, i) => (
        <text key={i} x={xs(i)} y={height - 6} textAnchor="middle" fontSize="10"
              fontFamily="var(--font-mono, ui-monospace), monospace"
              fill="var(--color-text-tertiary)">{l}</text>
      ))}
    </svg>
  );
}
