// Small presentational atoms shared across the v2 dashboard.
//
// Styled to match the rest of the EMOS app: rounded-full chips, sans-serif
// throughout (mono only for tabular numerics), generous spacing, soft
// gray-100/200 borders. The slightly denser bits (color-tinted backgrounds
// for RAW / week pills) stay, because they carry signal.

import { useEffect, useRef, useState } from 'react';
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
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function Avatar({
  name, size = 28, onClick, title,
}: { name: string; size?: number; onClick?: () => void; title?: string }) {
  const base = "inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 font-medium flex-shrink-0";
  const style = {
    width: size, height: size,
    fontSize: size <= 22 ? 10 : 11,
  };
  const content = initials(name);
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={title || `Open ${name}`}
        className={`${base} cursor-pointer transition-shadow hover:ring-2 hover:ring-blue-200 border-none p-0`}
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={base} style={style}>{content}</div>
  );
}

export function PhasePill({
  name, color, week, total, compact, onClick,
}: {
  name: string | null;
  color?: string | null;
  week: number | null;
  total: number | null;
  compact?: boolean;
  onClick?: () => void;
}) {
  const hasMacro = !!(name && week !== null && total !== null);
  if (!hasMacro) {
    return (
      <span className="inline-flex items-baseline gap-1.5 text-gray-400 italic"
            style={{ fontSize: compact ? 11 : 12 }}>
        No macrocycle
      </span>
    );
  }
  const bg = color ? color + '22' : '#F3F4F6';
  const fg = color || '#374151';
  const style = {
    background: bg, color: fg,
    padding: compact ? '1px 8px' : '2px 10px',
    fontSize: compact ? 11 : 12,
  };
  const inner = (
    <>
      <span className="font-medium">{name}</span>
      <span className="opacity-70 tabular-nums" style={{ fontFamily: 'var(--font-mono, ui-monospace), monospace' }}>
        W{week}/{total}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title="Open macro plan"
        className="inline-flex items-baseline gap-1.5 rounded-full cursor-pointer border-none hover:brightness-95 transition"
        style={style}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full" style={style}>
      {inner}
    </span>
  );
}

function weekTokens(state: WeekState) {
  if (state === 'planned') return { bg: 'bg-green-50',  text: 'text-green-700',  border: 'ring-green-200',  dot: 'bg-green-500', label: 'Planned' };
  if (state === 'partial') return { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'ring-amber-200',  dot: 'bg-amber-500', label: 'Partial' };
  return                          { bg: 'bg-red-50',    text: 'text-red-700',    border: 'ring-red-200',    dot: 'bg-red-500',   label: 'Missing' };
}

export function WeekPill({
  state, label, compact, onClick, title,
}: {
  state: WeekState;
  label?: string;
  compact?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const c = weekTokens(state);
  const className = `inline-flex items-center gap-1.5 rounded-full ring-1 ${c.bg} ${c.text} ${c.border} whitespace-nowrap`;
  const style = {
    padding: compact ? '1px 8px' : '2px 10px',
    fontSize: compact ? 11 : 12,
    fontWeight: 500,
  };
  const inner = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      <span>{label ?? c.label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={title}
        className={`${className} cursor-pointer border-none hover:brightness-95 transition`}
        style={style}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className={className} style={style}>{inner}</span>
  );
}

function rawTokens(avg: number | null) {
  if (avg === null) return { bg: 'bg-gray-50',    text: 'text-gray-400', ring: 'ring-gray-200'   };
  if (avg >= 10)    return { bg: 'bg-green-50',   text: 'text-green-700', ring: 'ring-green-200' };
  if (avg >= 7)     return { bg: 'bg-amber-50',   text: 'text-amber-700', ring: 'ring-amber-200' };
  return                   { bg: 'bg-red-50',     text: 'text-red-700',   ring: 'ring-red-200'   };
}

export function RawChip({
  pillars, avg, size = 'md',
}: { pillars: RawPillars | null; avg: number | null; size?: 'sm' | 'md' }) {
  const c = rawTokens(avg);
  const total = pillars?.total ?? null;
  const rawTitle = `Readiness (RAW wellness score): ${total !== null ? total : '–'}/12${avg !== null ? ` · avg ${avg.toFixed(1)}` : ''}`;
  return (
    <span
      title={rawTitle}
      className={`inline-flex items-baseline gap-1 rounded-full ring-1 ${c.bg} ${c.text} ${c.ring} whitespace-nowrap tabular-nums`}
      style={{
        padding: size === 'sm' ? '1px 8px' : '2px 10px',
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 500,
      }}
    >
      <span>{total !== null ? total : '–'}</span>
      <span className="opacity-60" style={{ fontSize: (size === 'sm' ? 11 : 12) - 1.5 }}>/12</span>
      {avg !== null && size !== 'sm' && (
        <span className="opacity-60 ml-0.5" style={{ fontSize: 10 }}>
          avg {avg.toFixed(1)}
        </span>
      )}
    </span>
  );
}

export function RawPillarsBreakdown({
  pillars, trend,
}: { pillars: RawPillars | null; trend: number[] }) {
  if (!pillars) {
    return (
      <span className="text-sm text-gray-400">
        No RAW submitted in the last 30 days
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
    <div className="flex gap-5 items-center flex-wrap">
      {rows.map(p => {
        const v = p.v;
        const barColor = v === null ? 'bg-gray-200'
          : v >= 3 ? 'bg-green-500'
          : v >= 2 ? 'bg-amber-500'
          : 'bg-red-500';
        const valueColor = v === null ? 'text-gray-400'
          : v >= 3 ? 'text-green-700'
          : v >= 2 ? 'text-amber-700'
          : 'text-red-700';
        return (
          <div key={p.k} className="flex flex-col gap-1 min-w-[64px]">
            <span className="text-[10px] text-gray-400 font-medium tracking-wide">
              {p.label}
            </span>
            <div className="flex gap-1 items-baseline">
              {[1, 2, 3].map(i => (
                <span
                  key={i}
                  className={`block rounded-sm ${v !== null && i <= v ? barColor : 'bg-gray-200'}`}
                  style={{ width: 14, height: 8 }}
                />
              ))}
              <span className={`ml-1 text-xs font-medium tabular-nums ${valueColor}`}>
                {v ?? '–'}
              </span>
            </div>
          </div>
        );
      })}
      {trend.length >= 2 && (
        <div className="ml-2 pl-4 border-l border-gray-200">
          <div className="text-[10px] text-gray-400 font-medium tracking-wide mb-1">
            RAW total trend
          </div>
          <Sparkline points={trend} max={12} width={72} height={20}
                     stroke="#185FA5" dotsLast />
        </div>
      )}
    </div>
  );
}

export function Sparkline({
  points, width = 60, height = 18, stroke = '#185FA5', max, dotsLast,
}: {
  points: number[]; width?: number; height?: number;
  stroke?: string; max?: number; dotsLast?: boolean;
}) {
  if (!points || points.length < 2) {
    return <div className="text-xs text-gray-300" style={{ width, height }}>—</div>;
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
    <svg width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} />
      {dotsLast && <circle cx={lastX} cy={lastY} r={2.2} fill={stroke} />}
    </svg>
  );
}

export function ComplianceSpark({
  values, width = 70, height = 20,
}: { values: (number | null)[]; width?: number; height?: number }) {
  // Only completed weeks have a graded compliance; the in-progress week is null
  // and is simply not plotted (it has no source-of-truth %).
  const graded = values.filter((v): v is number => v != null);
  if (!graded.length) return <span className="text-xs text-gray-300">—</span>;
  const last = graded[graded.length - 1];
  const stroke = last >= 95 ? '#1D9E75'
    : last >= 85 ? '#185FA5'
    : last >= 75 ? '#EF9F27'
    : '#E24B4A';
  return (
    <div className="inline-flex items-center gap-2">
      <Sparkline points={graded} max={100} width={width} height={height} stroke={stroke} dotsLast />
      <span className="text-xs font-medium tabular-nums" style={{ color: stroke }}>
        {Math.round(last)}%
      </span>
    </div>
  );
}

export function BwDelta({
  bw, expanded, onClick,
}: { bw: BwSummary | null; expanded?: boolean; onClick?: () => void }) {
  if (!bw) {
    const empty = <span className="text-xs text-gray-400">—</span>;
    return onClick ? (
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
        title="Open bodyweight history"
      >
        {empty}
      </button>
    ) : empty;
  }
  // Lead with the 7-day moving average — that's the number a coach
  // bases decisions on. The latest single reading sits next to it as
  // context; the delta arrow points to ma7's drift versus the 28-day
  // baseline (longer-term trend) when expanded, or versus latest in
  // the compact form so the arrow still feels live.
  const driftVs28 = bw.ma7 - bw.ma28;
  const up = bw.delta > 0.2, down = bw.delta < -0.2;
  const trendUp = driftVs28 > 0.2, trendDown = driftVs28 < -0.2;
  const tone = up ? 'text-red-600' : down ? 'text-green-600' : 'text-gray-400';
  const arrow = up ? '▲' : down ? '▼' : '·';
  const trendTone = trendUp ? 'text-red-500' : trendDown ? 'text-green-500' : 'text-gray-400';
  const trendArrow = trendUp ? '▲' : trendDown ? '▼' : '·';
  const inner = (
    <div className="inline-flex items-baseline gap-1.5 tabular-nums">
      <span className="text-sm text-gray-900">{bw.ma7.toFixed(1)}</span>
      <span className="text-[10px] text-gray-400">kg · 7d MA</span>
      <span className={`text-[11px] ${tone} ml-0.5`}>
        {arrow} {bw.delta > 0 ? '+' : ''}{bw.delta.toFixed(1)}
      </span>
      {expanded && (
        <span className="text-[10px] text-gray-400 ml-1">
          now {bw.now.toFixed(1)} · 28d {bw.ma28.toFixed(1)}
          <span className={`ml-1 ${trendTone}`}>
            {trendArrow} {driftVs28 > 0 ? '+' : ''}{driftVs28.toFixed(1)}
          </span>
        </span>
      )}
    </div>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 text-left"
        title="Open bodyweight history"
      >
        {inner}
      </button>
    );
  }
  return inner;
}

export function EventTag({
  name, kind, dateLabel, daysOut, compact, onClick,
}: {
  name: string;
  kind: 'comp' | 'camp';
  dateLabel?: string;
  daysOut: number;
  compact?: boolean;
  onClick?: () => void;
}) {
  const isComp = kind === 'comp';
  const c = isComp
    ? { bg: 'bg-orange-50',  text: 'text-orange-700', ring: 'ring-orange-200', tag: 'Comp' }
    : { bg: 'bg-sky-50',     text: 'text-sky-700',    ring: 'ring-sky-200',    tag: 'Camp' };
  const className = `inline-flex items-baseline gap-1.5 rounded-full ring-1 ${c.bg} ${c.text} ${c.ring} whitespace-nowrap overflow-hidden`;
  const style = {
    padding: compact ? '1px 8px' : '2px 10px',
    fontSize: compact ? 11 : 12,
    maxWidth: compact ? 160 : 220,
    textOverflow: 'ellipsis',
  };
  const inner = (
    <>
      <span className="text-[9.5px] font-medium uppercase tracking-wider">{c.tag}</span>
      <span className="overflow-hidden text-ellipsis">{name}</span>
      <span className="opacity-60 tabular-nums">· {daysOut}d</span>
    </>
  );
  const titleStr = `${name}${dateLabel ? ' · ' + dateLabel : ''}`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={titleStr}
        className={`${className} cursor-pointer border-none hover:brightness-95 transition`}
        style={style}
      >
        {inner}
      </button>
    );
  }
  return (
    <span title={titleStr} className={className} style={style}>{inner}</span>
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
  const dotClass = tone === 'danger' ? 'bg-red-500' : 'bg-amber-500';
  return (
    <span
      title={flags.map(f => FLAG_LABELS[f]?.label || f).join(' · ')}
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`}
    />
  );
}

export function FlagChip({ id }: { id: string }) {
  const meta = FLAG_LABELS[id];
  if (!meta) return null;
  const c = meta.tint === 'danger'
    ? { bg: 'bg-red-50',   text: 'text-red-700',   ring: 'ring-red-200',   dot: 'bg-red-500'   }
    : { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', dot: 'bg-amber-500' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ring-1 ${c.bg} ${c.text} ${c.ring} px-2.5 py-0.5 text-xs`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {meta.label}
    </span>
  );
}

// Planned vs Actual chart — bars for planned, line for actual. Soft Tailwind
// palette so it sits inside the rest of the EMOS panels. If no explicit
// width is passed the chart measures its container and re-renders on
// resize, so the bar count adapts to whatever space is available.
export function PlannedActualChart({
  planned, actual, labels, yMax,
  width, height = 130,
}: {
  planned: number[]; actual: number[]; labels: string[];
  yMax?: number; width?: number; height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(width ?? 460);

  useEffect(() => {
    if (width !== undefined) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setMeasuredWidth(Math.max(280, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const renderWidth = width ?? measuredWidth;
  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <PlannedActualChartInner
        planned={planned} actual={actual} labels={labels}
        yMax={yMax} width={renderWidth} height={height}
      />
    </div>
  );
}

function PlannedActualChartInner({
  planned, actual, labels, yMax,
  width, height,
}: {
  planned: number[]; actual: number[]; labels: string[];
  yMax?: number; width: number; height: number;
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
    <svg width={width} height={height} className="block overflow-visible">
      {[0, mx * 0.5, mx].map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={width - padR} y1={ys(v)} y2={ys(v)}
                stroke="#E5E7EB"
                strokeDasharray={i === 0 ? 'none' : '2,2'} />
          <text x={padL - 4} y={ys(v) + 3} textAnchor="end"
                className="fill-gray-400" fontSize="10">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {planned.map((v, i) => {
        const bw = (w / n) * 0.5;
        return (
          <rect key={i} x={xs(i) - bw / 2} y={ys(v)} width={bw} height={ys(0) - ys(v)}
                fill="#F3F4F6" stroke="#E5E7EB" rx={2} />
        );
      })}
      {actual.length >= 2 && (
        <polyline
          points={actual.map((v, i) => `${xs(i)},${ys(v)}`).join(' ')}
          fill="none" stroke="#185FA5" strokeWidth={2}
        />
      )}
      {actual.map((v, i) => (
        <circle key={i} cx={xs(i)} cy={ys(v)} r={3} fill="#185FA5" />
      ))}
      {labels.map((l, i) => (
        <text key={i} x={xs(i)} y={height - 6} textAnchor="middle"
              className="fill-gray-400" fontSize="11">{l}</text>
      ))}
    </svg>
  );
}

export function SectionHeader({
  children, right,
}: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <h2 className="text-base font-medium text-gray-900">{children}</h2>
      <span className="flex-1" />
      {right}
    </div>
  );
}
