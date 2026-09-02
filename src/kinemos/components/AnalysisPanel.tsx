/**
 * AnalysisPanel — the phase band and the curves, under the stage.
 *
 * One x-axis, shared. That is the whole point of putting them in one component:
 * a phase edge dragged on the band moves the dashed line on the chart in the
 * same gesture, and the playhead sits at the same place in both. Two components
 * with two scales would drift the first time one of them padded its plot area.
 *
 * The band is where phase boundaries are CORRECTED. The engine proposes; a
 * coach who disagrees drags an edge and their value is the answer from then on
 * (`source: 'coach'`). An edge the engine could not find from a real signature
 * is drawn hatched rather than solid — the interface says "this is a guess"
 * instead of presenting a fallback as a measurement.
 *
 * Charts are hand-rolled SVG rather than Recharts. Recharts is in the stack and
 * would be the right call for a dashboard, but it lives in a 344 kB chunk this
 * route would then have to pull in, and none of its axis/legend/tooltip
 * machinery is wanted here: what is wanted is two polylines on a shared,
 * externally-controlled domain with a draggable overlay, which is fewer lines
 * drawn directly than configured through a library.
 */
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { KinematicSeries } from '../engine/kinematics';
import type { PhaseBoundary, PhaseSpan } from '../engine/phases';
import { num } from '../lib/viewerFormat';

/** Which curve rides alongside vertical velocity. Velocity is always drawn —
 *  it is the one a coach reads — and the second slot is theirs to choose. */
export type SecondarySeries = 'horizontal' | 'height' | 'power';

const SECONDARY_LABEL: Record<SecondarySeries, string> = {
  horizontal: 'Horizontal displacement (cm)',
  height: 'Height (cm)',
  power: 'Power (W)',
};

const VELOCITY_COLOR = '#185FA5';
const SECONDARY_COLOR = '#D08B2C';

interface AnalysisPanelProps {
  series: KinematicSeries | null;
  spans: PhaseSpan[];
  boundaries: PhaseBoundary[];
  /** Index of the boundary being moved, and where to. Interior edges only —
   *  the first and last are the clip's own ends. */
  onBoundaryDrag: (index: number, t: number) => void;
  onBoundaryCommit: () => void;
  currentT: number | null;
  onSeekT: (t: number) => void;
  /** Why there is nothing to draw, when there is nothing to draw. */
  emptyReason: string | null;
}

export function AnalysisPanel({
  series,
  spans,
  boundaries,
  onBoundaryDrag,
  onBoundaryCommit,
  currentT,
  onSeekT,
  emptyReason,
}: AnalysisPanelProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<number | null>(null);
  const [secondary, setSecondary] = useState<SecondarySeries>('horizontal');

  const t0 = series?.t[0] ?? 0;
  const t1 = series?.t[series.t.length - 1] ?? 1;
  const span = t1 - t0 || 1;

  const fractionOf = useCallback((t: number) => (t - t0) / span, [t0, span]);

  const timeFromClient = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return t0;
      const rect = el.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return t0 + fraction * span;
    },
    [t0, span],
  );

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== null) {
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // A press anywhere else on the band scrubs, so the band doubles as a
    // timeline rather than being a thing you can only drag edges on.
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeekT(timeFromClient(e.clientX));
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const index = draggingRef.current;
    if (index === null) return;
    onBoundaryDrag(index, timeFromClient(e.clientX));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current !== null) {
      draggingRef.current = null;
      onBoundaryCommit();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  if (!series) {
    return (
      <section style={shell}>
        <p style={{ margin: 0, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {emptyReason ?? 'Nothing to plot yet.'}
        </p>
      </section>
    );
  }

  const secondaryValues =
    secondary === 'horizontal' ? series.xCm : secondary === 'height' ? series.yCm : series.powerW;

  return (
    <section style={shell}>
      {/* Legend + secondary picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <span style={captionStyle}>PHASES — drag an edge to correct</span>
          {spans.map(s => (
            <span key={s.definition.id} style={{ ...captionStyle, display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-text-secondary)' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: s.definition.color,
                  // A guessed edge is drawn hollow in the legend too, so the
                  // caveat travels with the name.
                  opacity: s.source === 'fallback' ? 0.45 : 1,
                }}
              />
              {s.definition.label}
              {s.source === 'fallback' && <span title="Placed by proportion — the engine found no signature here">*</span>}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {(Object.keys(SECONDARY_LABEL) as SecondarySeries[]).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setSecondary(option)}
              disabled={option === 'power' && !series.powerW}
              title={option === 'power' && !series.powerW ? 'Enter the bar mass to see power' : undefined}
              style={{
                padding: '2px 7px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: option === 'power' && !series.powerW ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontSize: 'var(--text-micro)',
                background: option === secondary ? 'var(--color-accent-muted)' : 'transparent',
                color:
                  option === 'power' && !series.powerW
                    ? 'var(--color-text-tertiary)'
                    : option === secondary
                      ? 'var(--color-accent)'
                      : 'var(--color-text-secondary)',
              }}
            >
              {option === 'horizontal' ? 'Horizontal' : option === 'height' ? 'Height' : 'Power'}
            </button>
          ))}
        </div>
      </div>

      {/* Phase band */}
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative',
          height: 30,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-bg-secondary)',
          cursor: 'pointer',
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        {spans.map(s => {
          const left = fractionOf(s.fromT) * 100;
          const width = Math.max(0, (fractionOf(s.toT) - fractionOf(s.fromT)) * 100);
          if (width <= 0) return null;
          return (
            <div
              key={s.definition.id}
              title={`${s.definition.label} — ${num(s.toT - s.fromT, 2)} s${s.source === 'fallback' ? ' (edge placed by proportion)' : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${left}%`,
                width: `${width}%`,
                background: s.definition.color,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 6,
                overflow: 'hidden',
                // Hatching marks an edge the engine guessed at.
                backgroundImage:
                  s.source === 'fallback'
                    ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.22) 0 4px, transparent 4px 8px)'
                    : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 'var(--text-micro)',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.definition.shortLabel}
              </span>
            </div>
          );
        })}

        {/* Draggable interior edges. The first and last boundary are the clip's
            own ends and are not the coach's to move. */}
        {boundaries.map((b, i) => {
          if (i === 0 || i === boundaries.length - 1) return null;
          return (
            <div
              key={`${b.phaseId ?? 'end'}-${i}`}
              onPointerDown={() => {
                draggingRef.current = i;
              }}
              title={`${b.rule.replace(/-/g, ' ')} — ${b.source}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${fractionOf(b.t) * 100}%`,
                width: 9,
                marginLeft: -4,
                cursor: 'col-resize',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  width: 2,
                  background: b.source === 'coach' ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                }}
              />
            </div>
          );
        })}

        {currentT !== null && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${fractionOf(currentT) * 100}%`,
              width: 2,
              marginLeft: -1,
              background: 'var(--color-text-primary)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Charts */}
      <div
        style={{
          position: 'relative',
          flexGrow: 1,
          minHeight: 90,
          border: '1px solid var(--color-border-tertiary)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-bg-primary)',
        }}
      >
        <Curves
          series={series}
          secondary={secondary}
          secondaryValues={secondaryValues}
          boundaries={boundaries}
          fractionOf={fractionOf}
          currentT={currentT}
        />
        <div style={{ position: 'absolute', left: 8, top: 5, display: 'flex', gap: 'var(--space-md)' }}>
          <LegendKey color={VELOCITY_COLOR} label="Vertical velocity (m/s)" />
          {secondaryValues && <LegendKey color={SECONDARY_COLOR} label={SECONDARY_LABEL[secondary]} dashed />}
        </div>
        {/* The velocity axis, as two numbers rather than a ruler. A gridded
            axis would cost a third of this strip's height; the extremes are
            what make the curve's shape readable, and the playhead readout
            covers everything between them. */}
        <AxisExtremes values={series.vyMs} />
        {currentT !== null && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: 5,
              fontSize: 'var(--text-caption)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {`${num(valueAtTime(series.t, series.vyMs, currentT), 2)} m/s`}
          </span>
        )}
        {!series.filtered && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              bottom: 5,
              fontSize: 'var(--text-micro)',
              color: 'var(--color-warning-text)',
            }}
          >
            unsmoothed — this clip’s frame rate cannot carry the filter
          </span>
        )}
      </div>
    </section>
  );
}

function AxisExtremes({ values }: { values: readonly number[] }) {
  const { min, max } = rangeOf(values);
  const style: CSSProperties = {
    position: 'absolute',
    left: 6,
    fontSize: 'var(--text-micro)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--color-text-tertiary)',
    pointerEvents: 'none',
  };
  return (
    <>
      <span style={{ ...style, top: 26 }}>{num(max, 2)}</span>
      <span style={{ ...style, bottom: 4 }}>{num(min, 2)}</span>
    </>
  );
}

function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 'var(--text-micro)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span
        style={{
          width: 12,
          height: 0,
          borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      {label}
    </span>
  );
}

/**
 * The two curves, drawn into a unit viewBox and stretched to the container.
 * `vector-effect: non-scaling-stroke` keeps the lines an even width despite the
 * non-uniform scale — without it, stretching a 1000-unit box across 1300 px
 * makes every vertical stroke thicker than every horizontal one.
 */
function Curves({
  series,
  secondary,
  secondaryValues,
  boundaries,
  fractionOf,
  currentT,
}: {
  series: KinematicSeries;
  secondary: SecondarySeries;
  secondaryValues: number[] | null;
  boundaries: PhaseBoundary[];
  fractionOf: (t: number) => number;
  currentT: number | null;
}) {
  const W = 1000;
  const H = 200;
  /** Head room for the legend, which floats over the plot. Without it the
   *  velocity curve runs straight through the words at its peak — which is
   *  exactly where a coach is looking. */
  const TOP = 26;

  const vPath = pathFor(series.t, series.vyMs, fractionOf, W, H, TOP);
  const sPath = secondaryValues ? pathFor(series.t, secondaryValues, fractionOf, W, H, TOP) : null;

  // Where zero velocity sits, so "the bar is coming back down" is visible as a
  // crossing rather than having to be read off an axis.
  const vRange = rangeOf(series.vyMs);
  const zeroY = vRange.span > 0 ? H - ((0 - vRange.min) / vRange.span) * (H - TOP) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      {zeroY !== null && zeroY >= 0 && zeroY <= H && (
        <line
          x1={0}
          y1={zeroY}
          x2={W}
          y2={zeroY}
          stroke="var(--color-border-secondary)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {boundaries.map((b, i) => (
        <line
          key={`${b.rule}-${i}`}
          x1={fractionOf(b.t) * W}
          y1={0}
          x2={fractionOf(b.t) * W}
          y2={H}
          stroke="var(--color-border-secondary)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {sPath && (
        <path
          d={sPath}
          fill="none"
          stroke={SECONDARY_COLOR}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={vPath}
        fill="none"
        stroke={VELOCITY_COLOR}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      {currentT !== null && (
        <line
          x1={fractionOf(currentT) * W}
          y1={0}
          x2={fractionOf(currentT) * W}
          y2={H}
          stroke="var(--color-text-primary)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* `secondary` is read so the chart re-renders when the pick changes even
          if the values happen to be reference-equal. */}
      <desc>{secondary}</desc>
    </svg>
  );
}

function rangeOf(values: readonly number[]): { min: number; max: number; span: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1, span: 1 };
  // A flat series would divide by zero; give it a nominal band so it draws as
  // a line through the middle rather than vanishing.
  const span = max - min || 1;
  return { min, max, span };
}

function pathFor(
  t: readonly number[],
  values: readonly number[],
  fractionOf: (t: number) => number,
  W: number,
  H: number,
  top: number,
): string {
  const { min, span } = rangeOf(values);
  let d = '';
  for (let i = 0; i < t.length; i++) {
    const x = fractionOf(t[i]) * W;
    const y = H - ((values[i] - min) / span) * (H - top);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

/** Linear read of a series at an arbitrary time — the playhead's value. */
function valueAtTime(t: readonly number[], values: readonly number[], at: number): number {
  if (t.length === 0) return 0;
  if (at <= t[0]) return values[0];
  if (at >= t[t.length - 1]) return values[values.length - 1];
  for (let i = 1; i < t.length; i++) {
    if (t[i] >= at) {
      const gap = t[i] - t[i - 1];
      const frac = gap > 0 ? (at - t[i - 1]) / gap : 0;
      return values[i - 1] + (values[i] - values[i - 1]) * frac;
    }
  }
  return values[values.length - 1];
}

const shell = {
  flexShrink: 0,
  height: 190,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-sm)',
  padding: 'var(--space-md)',
  background: 'var(--color-bg-primary)',
  borderTop: '1px solid var(--color-border-secondary)',
  boxSizing: 'border-box' as const,
};

const captionStyle = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
};
