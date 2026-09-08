/**
 * BarPathPanel — the bar path and velocity-over-height as ONE section.
 *
 * They share a vertical axis (bar height, cm), so a segmented control switches
 * between `Bar path`, `Velocity path` and `Combined` — the last a true overlay:
 * where the bar was, and how fast it was moving at that height, on one set of
 * gridlines. This is the German biomechanics reading, where V1, V2, Vmax and
 * S_max are found by eye (docs/KINEMOS_VIEWER_LAYOUT.md column 2).
 *
 * Every tick label lives INSIDE the SVG's viewBox as `<text>`. The plot is
 * height-constrained with a fixed aspect ratio, so its rendered width does not
 * match its flex parent's, and an HTML row of ticks cannot stay aligned to it.
 * Marker SHAPE separates the two series in Combined mode (diamonds on the bar
 * path, circles on the velocity curve), because marker colour encodes the
 * event and is reused across both.
 *
 * The plot is portrait — `0 0 200 540` — because the clip it sits beside is
 * portrait and the axis it shares with it is height.
 */
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { KinematicSeries, RepSummary } from '../engine/kinematics';
import { locateAnalyzerEvents, valueAt, type AnalyzerEvent, type AnalyzerMetrics, type PhaseSpan } from '../engine/phases';
import {
  BASE,
  EXAGGERATIONS,
  LABEL_X,
  TICK_ROW_1,
  TICK_ROW_2,
  TOP,
  VB_H,
  VB_W,
  X_MAX,
  X_MIN,
  barPathGeometry,
  type BarPathGeometry,
  type Exaggeration,
} from '../lib/barPathGeometry';
import { num } from '../lib/viewerFormat';

export type PathMode = 'path' | 'velocity' | 'both';

interface BarPathPanelProps {
  series: KinematicSeries | null;
  spans: PhaseSpan[];
  analyzer: AnalyzerMetrics | null;
  summary: RepSummary | null;
  currentT: number | null;
  onSeekT: (t: number) => void;
  /** Why there is nothing to draw, when there is nothing to draw. */
  emptyReason: string | null;
  /** The marked knee height, drawn as a height line the way S_max is. */
  kneeCm?: number | null;
}

// ── Series colours — DATA, not chrome ──────────────────────────────────────
const BAR_PATH_COLOR = '#185FA5';
const VELOCITY_COLOR = '#5B51C9';
const EVENT_COLORS = {
  v1: '#1D9E75',
  v2: '#EF9F27',
  vmax: '#5B51C9',
  vmin: '#D85A30',
} as const;

const MODES: Array<{ id: PathMode; label: string; title: string }> = [
  { id: 'path', label: 'Bar path', title: 'x vs height' },
  { id: 'velocity', label: 'Velocity path', title: 'v vs height' },
  { id: 'both', label: 'Combined', title: 'Both on one height axis' },
];

function BarPathPanelImpl({
  series,
  spans,
  analyzer,
  summary,
  currentT,
  onSeekT,
  emptyReason,
  kneeCm = null,
}: BarPathPanelProps) {
  const [mode, setMode] = useState<PathMode>('path');
  const [exaggeration, setExaggeration] = useState<Exaggeration>(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const showPath = mode !== 'velocity';
  const showVelocity = mode !== 'path';

  const geometry = useMemo(() => (series ? barPathGeometry(series, exaggeration) : null), [series, exaggeration]);
  const events = useMemo(() => (series ? locateAnalyzerEvents(series, spans) : null), [series, spans]);
  const here = useMemo(
    () => (series && currentT !== null ? nearestIndex(series.t, currentT) : null),
    [series, currentT],
  );

  /** A press seeks to the nearest sample of a visible curve, measured in the
   *  plot's own units so the two legs of a loop are told apart by where they
   *  are, not by when. */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!series || !geometry) return;
      const svg = svgRef.current;
      if (!svg) return;
      const point = toViewBox(svg, e.clientX, e.clientY);
      if (!point) return;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < series.t.length; i++) {
        const y = geometry.yOf(series.yCm[i]);
        if (showPath) {
          const dx = point.x - geometry.xOfPath(series.xCm[i]);
          const dy = point.y - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (showVelocity) {
          const dx = point.x - geometry.xOfVelocity(series.vyMs[i]);
          const dy = point.y - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) onSeekT(series.t[best]);
    },
    [series, geometry, showPath, showVelocity, onSeekT],
  );

  return (
    <section style={shell} aria-label="Bar path">
      <header style={headerRow}>
        <span style={{ fontSize: 'var(--text-label)', fontWeight: 600, letterSpacing: 'var(--tracking-section)' }}>
          Bar path
        </span>
        <span style={caption}>height on y</span>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        <div role="radiogroup" aria-label="Plot" style={{ display: 'flex', gap: 4 }}>
          {MODES.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              title={option.title}
              onClick={() => setMode(option.id)}
              disabled={!series}
              style={pill(mode === option.id, !series)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {showPath && (
          <div role="radiogroup" aria-label="Horizontal scale" title="Horizontal scale · ×1 is 1:1 with height" style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
            {EXAGGERATIONS.map(factor => (
              <button
                key={factor}
                type="button"
                role="radio"
                aria-checked={exaggeration === factor}
                onClick={() => setExaggeration(factor)}
                disabled={!series}
                style={{ ...pill(exaggeration === factor, !series), padding: '2px 6px', fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)' }}
              >
                {`×${factor}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', justifyContent: 'center', padding: '8px 10px 4px' }}>
        {series && geometry ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            onPointerDown={onPointerDown}
            style={plotStyle}
          >
            {/* Height reference lines: the analyzer's landmarks, and the knee. */}
            <HeightLine geometry={geometry} cm={analyzer?.sMaxCm ?? null} label="S_max" />
            <HeightLine geometry={geometry} cm={analyzer?.sVmaxCm ?? null} label="S_vmax" />
            <HeightLine geometry={geometry} cm={analyzer?.sSitCm ?? null} label="S_sit" />
            {kneeCm !== null && <HeightLine geometry={geometry} cm={kneeCm} label="knee" color="#5FB59B" />}
            {/* The baseline: the bar's start. */}
            <line x1={0} y1={BASE + 6} x2={VB_W} y2={BASE + 6} stroke="var(--color-border-secondary)" />

            {showVelocity && (
              <VelocityLayer
                series={series}
                geometry={geometry}
                events={events}
                tickRow={mode === 'both' ? TICK_ROW_2 : TICK_ROW_1}
                labelOrigin={mode === 'both'}
                here={here}
              />
            )}
            {showPath && (
              <PathLayer
                series={series}
                geometry={geometry}
                events={events}
                tickRow={TICK_ROW_1}
                labelOrigin={mode === 'both'}
                here={here}
                exaggeration={exaggeration}
              />
            )}
          </svg>
        ) : (
          <div style={{ ...plotStyle, display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box' }}>
            <p style={{ margin: 0, ...caption, textAlign: 'center' }}>{emptyReason ?? 'Nothing to plot.'}</p>
          </div>
        )}
      </div>

      {series && (
        <div style={legendRow}>
          {showVelocity && (
            <>
              <EventChip color={EVENT_COLORS.v1} label="V1" event={events?.v1 ?? null} />
              <EventChip color={EVENT_COLORS.v2} label="V2" event={events?.v2 ?? null} />
              <EventChip color={EVENT_COLORS.vmax} label="Vmax" event={events?.vmax ?? null} />
              <EventChip color={EVENT_COLORS.vmin} label="Vmin" event={events?.vmin ?? null} />
            </>
          )}
          {showPath && (
            <>
              <LegendChip color={BAR_PATH_COLOR}>◆ bar x</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`S_max ${cm(analyzer?.sMaxCm)}`}</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`S_sit ${cm(analyzer?.sSitCm)}`}</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`loop ${cm(summary?.loopWidthCm)}`}</LegendChip>
            </>
          )}
        </div>
      )}

    </section>
  );
}

// ── Layers ─────────────────────────────────────────────────────────────────

function PathLayer({
  series,
  geometry,
  events,
  tickRow,
  labelOrigin,
  here,
  exaggeration,
}: {
  series: KinematicSeries;
  geometry: BarPathGeometry;
  events: ReturnType<typeof locateAnalyzerEvents> | null;
  tickRow: number;
  labelOrigin: boolean;
  here: number | null;
  exaggeration: Exaggeration;
}) {
  const d = useMemo(() => {
    let path = '';
    for (let i = 0; i < series.t.length; i++) {
      path += `${i === 0 ? 'M' : 'L'}${geometry.xOfPath(series.xCm[i]).toFixed(2)} ${geometry.yOf(series.yCm[i]).toFixed(2)} `;
    }
    return path.trim();
  }, [series, geometry]);

  // The landmarks of the path itself: where the bar left the start, its
  // apex, and the deepest point of the catch — all in the series' colour,
  // as diamonds, so they never read as velocity events.
  const marks: Array<{ key: string; t: number; title: string }> = [
    { key: 'start', t: series.t[0], title: 'Bar off the start' },
  ];
  if (events?.apex) marks.push({ key: 'apex', t: events.apex.t, title: `S_max — ${num(events.apex.heightCm, 1)} cm` });
  if (events?.sit) marks.push({ key: 'sit', t: events.sit.t, title: `S_sit — ${num(events.sit.heightCm, 1)} cm` });

  return (
    <g>
      <line
        x1={geometry.pathZeroX}
        y1={TOP - 16}
        x2={geometry.pathZeroX}
        y2={BASE + 6}
        stroke="var(--color-border-secondary)"
        strokeDasharray="2 4"
      />
      <path d={d} fill="none" stroke={BAR_PATH_COLOR} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      {marks.map(m => {
        const x = geometry.xOfPath(valueAt(series.t, series.xCm, m.t) ?? 0);
        const y = geometry.yOf(valueAt(series.t, series.yCm, m.t) ?? 0);
        return (
          <rect
            key={m.key}
            x={x - 3.5}
            y={y - 3.5}
            width={7}
            height={7}
            fill={BAR_PATH_COLOR}
            transform={`rotate(45 ${x} ${y})`}
          >
            <title>{m.title}</title>
          </rect>
        );
      })}
      {geometry.pathTicks.map(tick => {
        const x = geometry.xOfPath(tick);
        if (x < X_MIN - 6 || x > X_MAX + 6) return null;
        return (
          <g key={tick}>
            <line x1={x} y1={BASE + 8} x2={x} y2={BASE + 14} stroke={BAR_PATH_COLOR} />
            <text x={x} y={tickRow} textAnchor="middle" style={tickText(BAR_PATH_COLOR)}>
              {tick === 0 ? '0' : `${tick > 0 ? '+' : '−'}${num(Math.abs(tick), 0)}`}
            </text>
          </g>
        );
      })}
      {/* The unit once, at the row's end, so no tick label has to carry it
          and grow into its neighbour. */}
      <text x={LABEL_X} y={tickRow} style={tickText(BAR_PATH_COLOR)}>
        cm
      </text>
      {labelOrigin && (
        <text x={geometry.pathZeroX + 4} y={TOP - 8} style={tickText(BAR_PATH_COLOR)}>
          x = 0
        </text>
      )}
      {exaggeration > 1 && (
        <text x={X_MIN} y={VB_H - 4} style={tickText(BAR_PATH_COLOR)}>
          {`x ×${exaggeration}`}
        </text>
      )}
      {here !== null && (
        <circle
          cx={geometry.xOfPath(series.xCm[here])}
          cy={geometry.yOf(series.yCm[here])}
          r={4.5}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth={1.6}
        />
      )}
    </g>
  );
}

function VelocityLayer({
  series,
  geometry,
  events,
  tickRow,
  labelOrigin,
  here,
}: {
  series: KinematicSeries;
  geometry: BarPathGeometry;
  events: ReturnType<typeof locateAnalyzerEvents> | null;
  tickRow: number;
  labelOrigin: boolean;
  here: number | null;
}) {
  const d = useMemo(() => {
    let path = '';
    for (let i = 0; i < series.t.length; i++) {
      path += `${i === 0 ? 'M' : 'L'}${geometry.xOfVelocity(series.vyMs[i]).toFixed(2)} ${geometry.yOf(series.yCm[i]).toFixed(2)} `;
    }
    return path.trim();
  }, [series, geometry]);

  const marks: Array<{ key: keyof typeof EVENT_COLORS; label: string; event: AnalyzerEvent | null }> = [
    { key: 'v1', label: 'V1', event: events?.v1 ?? null },
    { key: 'v2', label: 'V2', event: events?.v2 ?? null },
    { key: 'vmax', label: 'Vmax', event: events?.vmax ?? null },
    { key: 'vmin', label: 'Vmin', event: events?.vmin ?? null },
  ];
  const tickTop = tickRow === TICK_ROW_2 ? BASE + 18 : BASE + 8;

  return (
    <g>
      <line x1={geometry.velocityZeroX} y1={TOP - 16} x2={geometry.velocityZeroX} y2={BASE + 6} stroke="rgba(91,81,201,0.45)" />
      <path d={d} fill="none" stroke={VELOCITY_COLOR} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      {marks.map(m =>
        m.event ? (
          <circle
            key={m.key}
            cx={geometry.xOfVelocity(m.event.valueMs)}
            cy={geometry.yOf(m.event.heightCm)}
            r={3.5}
            fill={EVENT_COLORS[m.key]}
          >
            <title>{`${m.label} ${num(m.event.valueMs, 2)} m/s at ${num(m.event.heightCm, 1)} cm, ${num(m.event.t, 2)} s`}</title>
          </circle>
        ) : null,
      )}
      {geometry.velocityTicks.map(tick => {
        const x = geometry.xOfVelocity(tick);
        return (
          <g key={tick}>
            <line x1={x} y1={tickTop} x2={x} y2={tickTop + 6} stroke={VELOCITY_COLOR} />
            <text x={x} y={tickRow} textAnchor="middle" style={tickText(VELOCITY_COLOR)}>
              {num(tick, 1)}
            </text>
          </g>
        );
      })}
      <text x={LABEL_X} y={tickRow} style={tickText(VELOCITY_COLOR)}>
        m/s
      </text>
      {labelOrigin && (
        <text x={geometry.velocityZeroX - 4} y={TOP - 8} textAnchor="end" style={tickText(VELOCITY_COLOR)}>
          v = 0
        </text>
      )}
      {here !== null && (
        <circle
          cx={geometry.xOfVelocity(series.vyMs[here])}
          cy={geometry.yOf(series.yCm[here])}
          r={4.5}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth={1.6}
        />
      )}
    </g>
  );
}

function HeightLine({
  geometry,
  cm: value,
  label,
  color,
}: {
  geometry: BarPathGeometry;
  cm: number | null;
  label: string;
  color?: string;
}) {
  if (value === null || !Number.isFinite(value)) return null;
  const y = geometry.yOf(value);
  if (y < TOP - 4 || y > BASE + 4) return null;
  return (
    <g>
      <line
        x1={0}
        y1={y}
        x2={LABEL_X - 4}
        y2={y}
        stroke={color ?? 'var(--color-border-primary)'}
        strokeDasharray="4 3"
      />
      <text x={LABEL_X} y={y + 3.5} style={{ ...tickText(color ?? 'var(--color-text-secondary)'), fontSize: 10 }}>
        {label}
      </text>
    </g>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────

function EventChip({ color, label, event }: { color: string; label: string; event: AnalyzerEvent | null }) {
  return (
    <LegendChip color={color}>
      {event ? `${label} ${num(event.valueMs, 2)} @ ${num(event.heightCm, 1)}` : `${label} —`}
    </LegendChip>
  );
}

function LegendChip({ color, children }: { color: string; children: string }) {
  return (
    <span
      style={{
        fontSize: 'var(--text-caption)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-secondary)',
        border: `0.5px solid ${color}`,
        color: 'var(--color-text-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cm(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${num(value, 1)} cm`;
}

function nearestIndex(t: readonly number[], at: number): number {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - at) < Math.abs(t[best] - at)) best = i;
  return best;
}

/** Client coordinates → viewBox units, through the SVG's own transform so
 *  letterboxing under `meet` is accounted for. Null where the DOM cannot
 *  answer (jsdom). */
function toViewBox(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  if (typeof svg.getScreenCTM !== 'function' || typeof svg.createSVGPoint !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

function tickText(color: string): CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: color,
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
  };
}

function pill(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '3px 10px',
    borderRadius: 'var(--radius-md)',
    border: active ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
    background: active ? 'var(--color-accent)' : 'var(--color-bg-primary)',
    color: active ? 'var(--color-text-on-accent)' : disabled ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'var(--text-label)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

const shell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
};

const headerRow: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '7px 12px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
};

const plotStyle: CSSProperties = {
  height: '100%',
  maxWidth: '100%',
  aspectRatio: `${VB_W} / ${VB_H}`,
  background: 'var(--color-bg-secondary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  touchAction: 'none',
};

const legendRow: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  padding: '6px 10px',
  borderTop: '0.5px solid var(--color-border-tertiary)',
};

const caption: CSSProperties = {
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};

export const BarPathPanel = memo(BarPathPanelImpl);
