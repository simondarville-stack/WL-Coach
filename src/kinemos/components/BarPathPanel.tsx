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
 * event and is reused across both. The analyzer's V1, V2, Vmax and Vmin are
 * drawn on BOTH curves — on the bar path at the place the bar was when each
 * happened — since where in the pull V2 falls is the reading, not only how
 * fast it was. They come from one search (`locateAnalyzerEvents`), so the
 * mark on the curve is the number in the table; when a phase edge was placed
 * by proportion rather than found, the mark is withheld and the legend chip
 * says so, rather than drawing a V1 that is about the fallback rule.
 *
 * How it is drawn is the coach's (`lib/displayPrefs`): which labels, a
 * plain line or one heated by velocity, points on the samples, the width.
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
import {
  DEFAULT_DISPLAY_PREFS,
  PLOT_LINE_WIDTHS,
  heatScaleMs,
  velocityColour,
  type PlotLabels,
  type PlotPrefs,
} from '../lib/displayPrefs';
import { DisplayOptions, type OptionRow } from './DisplayOptions';

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
  /** How the plots are drawn (`lib/displayPrefs`). Defaults when absent. */
  display?: PlotPrefs;
  /** The options popover in the header. Absent → no popover. */
  onDisplay?: (patch: Partial<PlotPrefs>) => void;
  onLabels?: (patch: Partial<PlotLabels>) => void;
  onDisplayReset?: () => void;
  displayModified?: boolean;
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
  display = DEFAULT_DISPLAY_PREFS.plot,
  onDisplay,
  onLabels,
  onDisplayReset,
  displayModified = false,
}: BarPathPanelProps) {
  const [mode, setMode] = useState<PathMode>('path');
  const [exaggeration, setExaggeration] = useState<Exaggeration>(1);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const showPath = mode !== 'velocity';
  const showVelocity = mode !== 'path';
  const labels = display.labels;

  const geometry = useMemo(() => (series ? barPathGeometry(series, exaggeration) : null), [series, exaggeration]);
  const events = useMemo(() => (series ? locateAnalyzerEvents(series, spans) : null), [series, spans]);
  /** Red on the heat line is this lift's own Vmax. */
  const heat = useMemo(() => (series && display.line === 'heatmap' ? heatScaleMs(series.vyMs) : null), [series, display.line]);
  /** Why a V1 or V2 is missing, for its legend chip. */
  const missing = useMemo(() => ({ v1: missingReason('v1', spans), v2: missingReason('v2', spans) }), [spans]);

  const optionRows: OptionRow[] | null = onDisplay && onLabels
    ? [
        {
          kind: 'toggles',
          label: 'Labels',
          items: [
            { key: 'v1', label: 'V1', value: labels.v1 },
            { key: 'v2', label: 'V2', value: labels.v2 },
            { key: 'vmax', label: 'Vmax', value: labels.vmax },
            { key: 'vmin', label: 'Vmin', value: labels.vmin },
            { key: 'pathMarks', label: 'start · S_max · S_sit', value: labels.pathMarks, title: 'The bar path\'s own landmarks' },
            { key: 'heightLines', label: 'height lines', value: labels.heightLines, title: 'S_max, S_vmax, S_sit across the plot' },
            { key: 'knee', label: 'knee', value: labels.knee },
            { key: 'ticks', label: 'ticks', value: labels.ticks },
          ],
          onChange: (key, value) => onLabels({ [key]: value } as Partial<PlotLabels>),
        },
        {
          kind: 'choice',
          label: 'Line',
          value: display.line,
          options: [
            { value: 'plain', label: 'one colour' },
            { value: 'heatmap', label: 'velocity heat', title: 'Blue falling · grey at rest · amber rising · red at this lift\'s Vmax' },
          ],
          onChange: (v: never) => onDisplay({ line: v }),
        },
        {
          kind: 'choice',
          label: 'Line width',
          value: display.lineWidth,
          options: PLOT_LINE_WIDTHS.map((w, i) => ({ value: w, label: ['thin', 'normal', 'thick'][i] })),
          onChange: (v: never) => onDisplay({ lineWidth: v }),
        },
        { kind: 'toggle', label: 'Points on the samples', value: display.points, onChange: v => onDisplay({ points: v }) },
        { kind: 'toggle', label: 'Ring at this frame', value: display.cursor, onChange: v => onDisplay({ cursor: v }) },
      ]
    : null;
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={caption}>height on y</span>
          {optionRows && (
            <DisplayOptions
              title="Bar path"
              align="right"
              rows={optionRows}
              modified={displayModified}
              onReset={() => onDisplayReset?.()}
            />
          )}
        </span>
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
            {labels.heightLines && (
              <>
                <HeightLine geometry={geometry} cm={analyzer?.sMaxCm ?? null} label="S_max" />
                <HeightLine geometry={geometry} cm={analyzer?.sVmaxCm ?? null} label="S_vmax" />
                <HeightLine geometry={geometry} cm={analyzer?.sSitCm ?? null} label="S_sit" />
              </>
            )}
            {labels.knee && kneeCm !== null && <HeightLine geometry={geometry} cm={kneeCm} label="knee" color="#5FB59B" />}
            {/* The baseline: the bar's start. */}
            <line x1={0} y1={BASE + 6} x2={VB_W} y2={BASE + 6} stroke="var(--color-border-secondary)" />

            {showVelocity && (
              <VelocityLayer
                series={series}
                geometry={geometry}
                events={events}
                tickRow={mode === 'both' ? TICK_ROW_2 : TICK_ROW_1}
                labelOrigin={mode === 'both'}
                here={display.cursor ? here : null}
                display={display}
                heat={heat}
              />
            )}
            {showPath && (
              <PathLayer
                series={series}
                geometry={geometry}
                events={events}
                tickRow={TICK_ROW_1}
                labelOrigin={mode === 'both'}
                here={display.cursor ? here : null}
                exaggeration={exaggeration}
                display={display}
                heat={heat}
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
          {labels.v1 && <EventChip color={EVENT_COLORS.v1} label="V1" event={events?.v1 ?? null} missing={missing.v1} />}
          {labels.v2 && <EventChip color={EVENT_COLORS.v2} label="V2" event={events?.v2 ?? null} missing={missing.v2} />}
          {labels.vmax && <EventChip color={EVENT_COLORS.vmax} label="Vmax" event={events?.vmax ?? null} missing="Vmax: the series never rises" />}
          {labels.vmin && <EventChip color={EVENT_COLORS.vmin} label="Vmin" event={events?.vmin ?? null} missing="Vmin: nothing after Vmax" />}
          {showPath && labels.pathMarks && (
            <>
              <LegendChip color={BAR_PATH_COLOR}>◆ bar x</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`S_max ${cm(analyzer?.sMaxCm)}`}</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`S_sit ${cm(analyzer?.sSitCm)}`}</LegendChip>
              <LegendChip color={BAR_PATH_COLOR}>{`loop ${cm(summary?.loopWidthCm)}`}</LegendChip>
            </>
          )}
          {heat !== null && (
            <LegendChip color={VELOCITY_COLOR}>{`heat · red at ${num(heat, 2)} m/s`}</LegendChip>
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
  display,
  heat,
}: {
  series: KinematicSeries;
  geometry: BarPathGeometry;
  events: ReturnType<typeof locateAnalyzerEvents> | null;
  tickRow: number;
  labelOrigin: boolean;
  here: number | null;
  exaggeration: Exaggeration;
  display: PlotPrefs;
  /** The heat scale, or null for a plain line. */
  heat: number | null;
}) {
  const xs = useMemo(() => series.xCm.map(x => geometry.xOfPath(x)), [series, geometry]);
  const ys = useMemo(() => series.yCm.map(y => geometry.yOf(y)), [series, geometry]);
  const d = useMemo(() => {
    let path = '';
    for (let i = 0; i < xs.length; i++) path += `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(2)} ${ys[i].toFixed(2)} `;
    return path.trim();
  }, [xs, ys]);
  const labels = display.labels;

  // The landmarks of the path itself: where the bar left the start, its
  // apex, and the deepest point of the catch — all in the series' colour,
  // as diamonds, so they never read as velocity events.
  const marks: Array<{ key: string; t: number; title: string }> = [];
  if (labels.pathMarks) {
    marks.push({ key: 'start', t: series.t[0], title: 'Bar off the start' });
    if (events?.apex) marks.push({ key: 'apex', t: events.apex.t, title: `S_max — ${num(events.apex.heightCm, 1)} cm` });
    if (events?.sit) marks.push({ key: 'sit', t: events.sit.t, title: `S_sit — ${num(events.sit.heightCm, 1)} cm` });
  }

  // The analyzer's events at the place on the path the bar was when each
  // happened — diamonds, the bar path's shape, in the event's colour.
  const eventMarks = analyzerMarks(events, labels).map(m => ({
    ...m,
    x: geometry.xOfPath(valueAt(series.t, series.xCm, m.event.t) ?? 0),
    y: geometry.yOf(m.event.heightCm),
  }));

  return (
    <g data-layer="path">
      <line
        x1={geometry.pathZeroX}
        y1={TOP - 16}
        x2={geometry.pathZeroX}
        y2={BASE + 6}
        stroke="var(--color-border-secondary)"
        strokeDasharray="2 4"
      />
      <Curve d={d} xs={xs} ys={ys} vy={series.vyMs} color={BAR_PATH_COLOR} width={display.lineWidth} heat={heat} points={display.points} />
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
      {eventMarks.map(m => (
        <rect
          key={m.key}
          data-event={m.key}
          x={m.x - 4}
          y={m.y - 4}
          width={8}
          height={8}
          fill={EVENT_COLORS[m.key]}
          stroke="var(--color-bg-primary)"
          strokeWidth={1}
          transform={`rotate(45 ${m.x} ${m.y})`}
        >
          <title>{`${m.label} ${num(m.event.valueMs, 2)} m/s at ${num(m.event.heightCm, 1)} cm, ${num(m.event.t, 2)} s`}</title>
        </rect>
      ))}
      {labels.ticks &&
        geometry.pathTicks.map(tick => {
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
      {labels.ticks && (
        <text x={LABEL_X} y={tickRow} style={tickText(BAR_PATH_COLOR)}>
          cm
        </text>
      )}
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
  display,
  heat,
}: {
  series: KinematicSeries;
  geometry: BarPathGeometry;
  events: ReturnType<typeof locateAnalyzerEvents> | null;
  tickRow: number;
  labelOrigin: boolean;
  here: number | null;
  display: PlotPrefs;
  heat: number | null;
}) {
  const xs = useMemo(() => series.vyMs.map(v => geometry.xOfVelocity(v)), [series, geometry]);
  const ys = useMemo(() => series.yCm.map(y => geometry.yOf(y)), [series, geometry]);
  const d = useMemo(() => {
    let path = '';
    for (let i = 0; i < xs.length; i++) path += `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(2)} ${ys[i].toFixed(2)} `;
    return path.trim();
  }, [xs, ys]);

  const marks = analyzerMarks(events, display.labels);
  const tickTop = tickRow === TICK_ROW_2 ? BASE + 18 : BASE + 8;

  return (
    <g data-layer="velocity">
      <line x1={geometry.velocityZeroX} y1={TOP - 16} x2={geometry.velocityZeroX} y2={BASE + 6} stroke="rgba(91,81,201,0.45)" />
      <Curve d={d} xs={xs} ys={ys} vy={series.vyMs} color={VELOCITY_COLOR} width={display.lineWidth} heat={heat} points={display.points} />
      {marks.map(m => (
        <circle
          key={m.key}
          data-event={m.key}
          cx={geometry.xOfVelocity(m.event.valueMs)}
          cy={geometry.yOf(m.event.heightCm)}
          r={3.5}
          fill={EVENT_COLORS[m.key]}
        >
          <title>{`${m.label} ${num(m.event.valueMs, 2)} m/s at ${num(m.event.heightCm, 1)} cm, ${num(m.event.t, 2)} s`}</title>
        </circle>
      ))}
      {display.labels.ticks &&
        geometry.velocityTicks.map(tick => {
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
      {display.labels.ticks && (
        <text x={LABEL_X} y={tickRow} style={tickText(VELOCITY_COLOR)}>
          m/s
        </text>
      )}
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

/**
 * One curve: a plain path, or — heated — one segment per sample pair in the
 * colour of the later sample's velocity, and optionally a dot on each sample.
 * Line joins are round so the segments read as one stroke.
 */
function Curve({
  d,
  xs,
  ys,
  vy,
  color,
  width,
  heat,
  points,
}: {
  d: string;
  xs: number[];
  ys: number[];
  vy: readonly number[];
  color: string;
  width: number;
  heat: number | null;
  points: boolean;
}) {
  return (
    <g data-curve={heat === null ? 'plain' : 'heat'}>
      {heat === null ? (
        <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        xs.slice(1).map((x, k) => (
          <line
            key={k}
            x1={xs[k]}
            y1={ys[k]}
            x2={x}
            y2={ys[k + 1]}
            stroke={velocityColour(vy[k + 1], heat)}
            strokeWidth={width}
            strokeLinecap="round"
          />
        ))
      )}
      {points &&
        xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={Math.max(0.8, width * 0.55)} fill={heat === null ? color : velocityColour(vy[i], heat)} />
        ))}
    </g>
  );
}

/** The analyzer events that exist AND are switched on, in drawing order. */
function analyzerMarks(
  events: ReturnType<typeof locateAnalyzerEvents> | null,
  labels: PlotLabels,
): Array<{ key: keyof typeof EVENT_COLORS; label: string; event: AnalyzerEvent }> {
  const all: Array<{ key: keyof typeof EVENT_COLORS; label: string; event: AnalyzerEvent | null; on: boolean }> = [
    { key: 'v1', label: 'V1', event: events?.v1 ?? null, on: labels.v1 },
    { key: 'v2', label: 'V2', event: events?.v2 ?? null, on: labels.v2 },
    { key: 'vmax', label: 'Vmax', event: events?.vmax ?? null, on: labels.vmax },
    { key: 'vmin', label: 'Vmin', event: events?.vmin ?? null, on: labels.vmin },
  ];
  return all.flatMap(m => (m.on && m.event ? [{ key: m.key, label: m.label, event: m.event }] : []));
}

/**
 * Why a V1 or V2 is not on the chart. A phase edge the engine only guessed at
 * (`source: 'fallback'`) yields no analyzer number on purpose — the coach can
 * set the edge on the timeline and the mark appears. Exported for the test.
 */
export function missingReason(kind: 'v1' | 'v2', spans: readonly PhaseSpan[]): string {
  const id = kind === 'v1' ? 'first_pull' : 'transition';
  const phase = kind === 'v1' ? 'first pull' : 'transition';
  const label = kind === 'v1' ? 'V1' : 'V2';
  const span = spans.find(s => s.definition.id === id);
  if (!span) return `${label} —: this lift has no ${phase} phase`;
  if (span.source === 'fallback') {
    return `${label} —: the ${phase} edge was placed by proportion, not found. Drag it on the timeline to read ${label}.`;
  }
  return `${label} —: nothing to read inside the ${phase}`;
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

function EventChip({ color, label, event, missing }: { color: string; label: string; event: AnalyzerEvent | null; missing: string }) {
  return (
    <LegendChip color={color} title={event ? `${label} at ${num(event.t, 2)} s` : missing}>
      {event ? `${label} ${num(event.valueMs, 2)} @ ${num(event.heightCm, 1)}` : `${label} —`}
    </LegendChip>
  );
}

function LegendChip({ color, children, title }: { color: string; children: string; title?: string }) {
  return (
    <span
      title={title}
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
