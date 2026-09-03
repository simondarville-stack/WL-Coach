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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { KinematicSeries } from '../engine/kinematics';
import {
  forcePercentOf,
  kneeCrossing,
  locateAnalyzerEvents,
  type AnalyzerEvent,
  type AnalyzerEvents,
  type PhaseBoundary,
  type PhaseSpan,
} from '../engine/phases';
import { num } from '../lib/viewerFormat';

/** Which curve rides alongside vertical velocity. Velocity is always drawn —
 *  it is the one a coach reads — and the second slot is theirs to choose. */
export type SecondarySeries = 'horizontal' | 'height' | 'force' | 'power';

/**
 * What the x-axis is. Time is the timeline the phase band shares; height is
 * the German analyzer's Figure 9 — velocity, force and power against how far
 * the bar has risen, so "V2 at the knee" and "S_fly" are distances read off
 * an axis rather than moments to be timed. The curve doubles back after the
 * apex: the drop under runs from right to left.
 */
export type ChartDomain = 'time' | 'height';

const SECONDARY_LABEL: Record<SecondarySeries, string> = {
  horizontal: 'Horizontal displacement (cm)',
  height: 'Height (cm)',
  force: 'Force (% of load)',
  power: 'Power (W)',
};

const SECONDARY_SHORT: Record<SecondarySeries, string> = {
  horizontal: 'Horizontal',
  height: 'Height',
  force: 'Force',
  power: 'Power',
};

const VELOCITY_COLOR = '#185FA5';
const SECONDARY_COLOR = '#D08B2C';

/** The plot's unit box. Curves are drawn into it and stretched to the
 *  container; the marks overlay uses the same numbers as percentages. */
const W = 1000;
const H = 200;
/** Head room for the legend, which floats over the plot. Without it the
 *  velocity curve runs straight through the words at its peak — which is
 *  exactly where a coach is looking. */
const TOP = 26;

/** The analyzer's landmarks in the order they are drawn, with where the
 *  label sits relative to the dot. */
const EVENT_LABELS: Array<{ key: keyof AnalyzerEvents; label: string; below?: boolean }> = [
  { key: 'v1', label: 'V1' },
  { key: 'v2', label: 'V2', below: true },
  { key: 'vmax', label: 'Vmax' },
  // Vmin is the plot's floor by definition; a label under it would be clipped.
  { key: 'vmin', label: 'Vmin' },
];

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
  /** The marked knee height above the bar's start, cm — drawn as a line at
   *  that height against height, and at the moment the bar crosses it
   *  against time. */
  kneeCm?: number | null;
}


/**
 * Pointer capture, guarded.
 *
 * `setPointerCapture` throws `NotFoundError` when the pointer id is no longer
 * active — which happens for real when a pointer is released between the event
 * being queued and the handler running, and which would otherwise take the
 * whole gesture down with it. Failing to capture costs a drag that stops at the
 * element's edge; throwing costs the interaction entirely.
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Nothing to capture. The gesture still works inside the element.
  }
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
  kneeCm = null,
}: AnalysisPanelProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<number | null>(null);
  const [secondary, setSecondary] = useState<SecondarySeries>('horizontal');
  const [domain, setDomain] = useState<ChartDomain>('time');

  const t0 = series?.t[0] ?? 0;
  const t1 = series?.t[series.t.length - 1] ?? 1;
  const span = t1 - t0 || 1;

  const fractionOf = useCallback((t: number) => (t - t0) / span, [t0, span]);

  const forcePct = useMemo(() => (series ? forcePercentOf(series) : null), [series]);
  const events = useMemo(() => (series ? locateAnalyzerEvents(series, spans) : null), [series, spans]);
  const knee = useMemo(
    () => (series && kneeCm !== null ? kneeCrossing(series, kneeCm) : null),
    [series, kneeCm],
  );

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
      capturePointer(e.currentTarget, e.pointerId);
      return;
    }
    // A press anywhere else on the band scrubs, so the band doubles as a
    // timeline rather than being a thing you can only drag edges on.
    capturePointer(e.currentTarget, e.pointerId);
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

  // Against height, height itself and the horizontal path are not curves to
  // ride alongside — the axis is the one and the other is the bar path, which
  // the stage draws. Force stands in for them.
  const shown: SecondarySeries =
    domain === 'height' && (secondary === 'horizontal' || secondary === 'height') ? 'force' : secondary;
  const secondaryValues =
    shown === 'horizontal'
      ? series.xCm
      : shown === 'height'
        ? series.yCm
        : shown === 'force'
          ? forcePct
          : series.powerW;
  const secondaryDisabled = (option: SecondarySeries): string | null =>
    option === 'power' && !series.powerW
      ? 'Enter the bar mass to see power'
      : domain === 'height' && (option === 'horizontal' || option === 'height')
        ? 'Height is the axis here'
        : null;

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
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }} title="What the curves are drawn against">
            {(['time', 'height'] as ChartDomain[]).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setDomain(option)}
                style={pickerButton(option === domain, false)}
              >
                {option === 'time' ? 'vs time' : 'vs height'}
              </button>
            ))}
          </div>
          <span style={{ width: 1, height: 12, background: 'var(--color-border-secondary)' }} />
          <div style={{ display: 'flex', gap: 2 }}>
            {(Object.keys(SECONDARY_LABEL) as SecondarySeries[]).map(option => {
              const why = secondaryDisabled(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSecondary(option)}
                  disabled={why !== null}
                  title={why ?? undefined}
                  style={pickerButton(option === shown, why !== null)}
                >
                  {SECONDARY_SHORT[option]}
                </button>
              );
            })}
          </div>
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
        {domain === 'time' ? (
          <Curves
            series={series}
            secondary={shown}
            secondaryValues={secondaryValues}
            boundaries={boundaries}
            fractionOf={fractionOf}
            currentT={currentT}
            onSeekT={onSeekT}
          />
        ) : (
          <HeightCurves
            series={series}
            spans={spans}
            secondary={shown}
            secondaryValues={secondaryValues}
            currentT={currentT}
            onSeekT={onSeekT}
          />
        )}
        {/* The knee: a height against height, a moment against time. Only
            drawn against time when the bar actually crossed it. */}
        {kneeCm !== null && (domain === 'height' || knee) && (
          <KneeLine
            x={domain === 'height' ? heightFraction(series.yCm, kneeCm) : fractionOf(knee!.t)}
            title={
              domain === 'height'
                ? `Knee height — ${num(kneeCm, 1)} cm above the bar's start`
                : `The bar passes the knee (${num(kneeCm, 1)} cm) at ${num(knee!.t, 2)} s, ${num(knee!.valueMs, 2)} m/s`
            }
          />
        )}
        {events && (
          <EventMarks
            events={events}
            place={
              domain === 'time'
                ? e => ({ x: fractionOf(e.t), y: velocityFraction(series.vyMs, e.valueMs) })
                : e => ({ x: heightFraction(series.yCm, e.heightCm), y: velocityFraction(series.vyMs, e.valueMs) })
            }
          />
        )}
        <div style={{ position: 'absolute', left: 8, top: 5, display: 'flex', gap: 'var(--space-md)' }}>
          <LegendKey
            color={VELOCITY_COLOR}
            label={domain === 'height' && spans.length > 0 ? 'Vertical velocity (m/s), coloured by phase' : 'Vertical velocity (m/s)'}
          />
          {secondaryValues && <LegendKey color={SECONDARY_COLOR} label={SECONDARY_LABEL[shown]} dashed />}
        </div>
        {/* The velocity axis, as two numbers rather than a ruler. A gridded
            axis would cost a third of this strip's height; the extremes are
            what make the curve's shape readable, and the playhead readout
            covers everything between them. */}
        <AxisExtremes values={series.vyMs} />
        {domain === 'height' && <HeightAxis values={series.yCm} />}
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

/** The shared button look of the two pickers above the band. */
function pickerButton(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '2px 7px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    fontSize: 'var(--text-micro)',
    background: active ? 'var(--color-accent-muted)' : 'transparent',
    color: disabled ? 'var(--color-text-tertiary)' : active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
  };
}

/** Where a velocity sits in the plot, as a fraction of its height from the
 *  top — the same mapping `pathFor` draws with, so a mark lands on the line. */
function velocityFraction(values: readonly number[], v: number): number {
  const { min, span } = rangeOf(values);
  return (H - ((v - min) / span) * (H - TOP)) / H;
}

/** The height axis is padded a little either side so the ends of the curve
 *  are not on the frame. */
function heightRange(values: readonly number[]): { lo: number; hi: number } {
  const { min, max, span } = rangeOf(values);
  return { lo: min - span * 0.03, hi: max + span * 0.03 };
}

function heightFraction(values: readonly number[], h: number): number {
  const { lo, hi } = heightRange(values);
  return (h - lo) / (hi - lo || 1);
}

/**
 * The analyzer's landmarks as dots on the velocity curve with their names,
 * placed by the caller's mapping so the same overlay serves both domains.
 * Drawn in HTML rather than into the stretched SVG, where a circle would be
 * an ellipse and a letter a smear.
 */
function EventMarks({
  events,
  place,
}: {
  events: AnalyzerEvents;
  place: (e: AnalyzerEvent) => { x: number; y: number };
}) {
  return (
    <>
      {EVENT_LABELS.map(({ key, label, below }) => {
        const e = events[key];
        if (!e) return null;
        const { x, y } = place(e);
        const title = `${label} ${num(e.valueMs, 2)} m/s — ${num(e.heightCm, 1)} cm up, ${num(e.t, 2)} s`;
        return (
          <span
            key={key}
            title={title}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: -3.5,
                top: -3.5,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--color-bg-primary)',
                border: `2px solid ${VELOCITY_COLOR}`,
                boxSizing: 'border-box',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: 5,
                top: below ? 3 : -15,
                fontSize: 'var(--text-micro)',
                fontWeight: 600,
                lineHeight: 1,
                color: VELOCITY_COLOR,
                whiteSpace: 'nowrap',
                pointerEvents: 'auto',
              }}
            >
              {label}
            </span>
          </span>
        );
      })}
    </>
  );
}

/** A vertical dashed line with "knee" at its foot, at a fraction of the
 *  plot's width. The same colour as the knee line on the stage. */
function KneeLine({ x, title }: { x: number; title: string }) {
  if (!(x >= 0 && x <= 1)) return null;
  return (
    <span
      title={title}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: 0,
        bottom: 0,
        width: 0,
        borderLeft: '1.5px dashed #5FB59B',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 4,
          bottom: 14,
          fontSize: 'var(--text-micro)',
          fontWeight: 600,
          color: '#5FB59B',
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        }}
      >
        knee
      </span>
    </span>
  );
}

function HeightAxis({ values }: { values: readonly number[] }) {
  const range = rangeOf(values);
  // Rounded first, so a rest a few millimetres under the first mark does not
  // print as "−0".
  const min = Math.round(range.min) || 0;
  const max = Math.round(range.max) || 0;
  return (
    <span
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 4,
        transform: 'translateX(-50%)',
        fontSize: 'var(--text-micro)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--color-text-tertiary)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {`height ${num(min, 0)} … ${num(max, 0)} cm →`}
    </span>
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
  onSeekT,
}: {
  series: KinematicSeries;
  secondary: SecondarySeries;
  secondaryValues: number[] | null;
  boundaries: PhaseBoundary[];
  fractionOf: (t: number) => number;
  currentT: number | null;
  onSeekT: (t: number) => void;
}) {
  const vPath = pathFor(series.t, series.vyMs, fractionOf, W, H, TOP);
  const sPath = secondaryValues ? pathFor(series.t, secondaryValues, fractionOf, W, H, TOP) : null;

  // Where zero velocity sits, so "the bar is coming back down" is visible as a
  // crossing rather than having to be read off an axis.
  const vRange = rangeOf(series.vyMs);
  const zeroY = vRange.span > 0 ? H - ((0 - vRange.min) / vRange.span) * (H - TOP) : null;

  const t0 = series.t[0];
  const t1 = series.t[series.t.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
      onPointerDown={e => {
        // A press on the plot scrubs, like one on the band.
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        onSeekT(t0 + fraction * (t1 - t0));
      }}
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

/**
 * The same curves against bar height — the analyzer's Figure 9. The velocity
 * curve is drawn a span at a time in the span's colour, because the phase
 * band above is a timeline and says nothing about where on this axis a phase
 * is. Time still runs along the curve: up the pull from left to right, then
 * back leftwards through the drop under. A press seeks to the nearest sample
 * of the curve.
 */
function HeightCurves({
  series,
  spans,
  secondary,
  secondaryValues,
  currentT,
  onSeekT,
}: {
  series: KinematicSeries;
  spans: PhaseSpan[];
  secondary: SecondarySeries;
  secondaryValues: number[] | null;
  currentT: number | null;
  onSeekT: (t: number) => void;
}) {
  const xOf = (i: number) => heightFraction(series.yCm, series.yCm[i]) * W;
  const vRange = rangeOf(series.vyMs);
  const yOf = (values: readonly number[], range: { min: number; span: number }, i: number) =>
    H - ((values[i] - range.min) / range.span) * (H - TOP);
  const pathOver = (values: readonly number[], from: number, to: number): string => {
    const range = rangeOf(values);
    let d = '';
    for (let i = from; i <= to; i++) d += `${i === from ? 'M' : 'L'}${xOf(i).toFixed(2)} ${yOf(values, range, i).toFixed(2)} `;
    return d.trim();
  };
  const n = series.t.length;
  const last = n - 1;
  // Each span's run of samples, overlapping its neighbour by one so the
  // coloured pieces join without a gap.
  const pieces = spans
    .map(s => {
      let from = series.t.findIndex(t => t >= s.fromT);
      if (from < 0) return null;
      from = Math.max(0, from - 1);
      let to = last;
      for (let i = from; i <= last; i++) {
        if (series.t[i] > s.toT) {
          to = i;
          break;
        }
      }
      return to > from ? { color: s.definition.color, d: pathOver(series.vyMs, from, to) } : null;
    })
    .filter((p): p is { color: string; d: string } => p !== null);
  const sPath = secondaryValues ? pathOver(secondaryValues, 0, last) : null;
  const zeroY = vRange.span > 0 ? H - ((0 - vRange.min) / vRange.span) * (H - TOP) : null;
  const here = currentT !== null ? nearestIndex(series.t, currentT) : null;

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
        onPointerDown={e => {
          // The nearest sample in the plot's own proportions, so a press on
          // the drop-under leg finds the drop-under, not the pull beneath it.
          const rect = e.currentTarget.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width;
          const py = (e.clientY - rect.top) / rect.height;
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < n; i++) {
            const dx = px - xOf(i) / W;
            const dy = py - yOf(series.vyMs, vRange, i) / H;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          onSeekT(series.t[best]);
        }}
      >
        {zeroY !== null && zeroY >= 0 && zeroY <= H && (
          <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="var(--color-border-secondary)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {sPath && (
          <path d={sPath} fill="none" stroke={SECONDARY_COLOR} strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        )}
        {pieces.length === 0 ? (
          <path d={pathOver(series.vyMs, 0, last)} fill="none" stroke={VELOCITY_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ) : (
          pieces.map((p, i) => (
            <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))
        )}
        <desc>{secondary}</desc>
      </svg>
      {here !== null && (
        <span
          style={{
            position: 'absolute',
            left: `${(xOf(here) / W) * 100}%`,
            top: `${(yOf(series.vyMs, vRange, here) / H) * 100}%`,
            width: 9,
            height: 9,
            marginLeft: -4.5,
            marginTop: -4.5,
            borderRadius: '50%',
            background: 'var(--color-text-primary)',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}

function nearestIndex(t: readonly number[], at: number): number {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - at) < Math.abs(t[best] - at)) best = i;
  return best;
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
