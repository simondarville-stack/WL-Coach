/**
 * TrendsView — one athlete's analysed lifts, over time and against load.
 *
 * Design §8 ranks this second among comparison needs: after "why did that one
 * fail when the one last month made it" comes "is the second pull getting
 * faster over the block". The data is the cache the viewer writes on every
 * save, read through the analysis adapter — a season of reps in one read,
 * no pipeline re-run.
 *
 * Three decisions carry the honesty of the chart:
 *
 *   - **Velocity is never shown without load.** A bar that moved faster on a
 *     lighter day tells the coach nothing about the athlete. So the time view
 *     stacks a load panel under the metric on the same time axis — two panels,
 *     one axis each, never two scales on one plot — and the load view puts the
 *     metric against the kilograms directly, which is the shape a coach knows
 *     as a load–velocity profile.
 *   - **Quality is on the mark, not in a colour.** Each rep is drawn as its
 *     grade: a filled dot for A, a ring for B, a diamond for C, a cross for
 *     ungraded. Colour is never the only carrier of meaning (design brief), and
 *     with one athlete on screen there is nothing else for colour to do.
 *   - **A rep with no stored number is counted, not hidden.** A trend of nine
 *     dots out of twelve reps says so in a caption, because the three missing
 *     are usually the oldest — analysed before the cache existed — and a coach
 *     reading a rising line deserves to know where it starts from.
 *
 * Labels live in HTML over a stretched SVG, exactly as the comparison view
 * does, and for the same reason: `preserveAspectRatio="none"` is right for
 * marks and fatal for glyphs.
 */
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Select, Spinner } from '../../components/ui';
import { formatDateShort } from '../../lib/dateUtils';
import { METRIC_CATALOGUE, metricById } from '../engine/metricCatalogue';
import { loadKinemosLiftRecords, type KinemosLiftRecord } from '../lib/analysisAdapter';
import { isStale, refreshStoredMetrics, type RefreshOutcome } from '../lib/recompute';
import { referenceOf } from '../lib/referenceService';
import { num } from '../lib/viewerFormat';
import { LoadVelocityPanel } from './LoadVelocityPanel';

/** The lift on screen, drawn as the comparison view draws it. */
const CURRENT_COLOR = '#185FA5';
/** Every other rep of the athlete. One series, one colour. */
const SERIES_COLOR = '#3E6E9E';

type Scope = 'exercise' | 'athlete';
type Against = 'time' | 'load';
type Range = '3m' | '6m' | '12m' | 'all';

const SCOPE_LABEL: Record<Scope, string> = { exercise: 'This exercise', athlete: 'All exercises' };
const AGAINST_LABEL: Record<Against, string> = { time: 'Over time', load: 'Against load' };
const RANGE_LABEL: Record<Range, string> = { '3m': '3 m', '6m': '6 m', '12m': '12 m', all: 'All' };
const RANGE_MONTHS: Record<Range, number | null> = { '3m': 3, '6m': 6, '12m': 12, all: null };

interface TrendsViewProps {
  athleteId: string | null;
  athleteName: string | null;
  exerciseName: string | null;
  /** The analysis on screen, when it has been stored — drawn with a ring. */
  currentAnalysisId: string | null;
  onClose: () => void;
  /** Open another rep. Routing is the viewer's to do. */
  onOpen: (record: KinemosLiftRecord) => void;
  /** Injected for tests; the adapter's loader otherwise. */
  load?: typeof loadKinemosLiftRecords;
  /** Injected for tests; the cache refresh otherwise. */
  refresh?: typeof refreshStoredMetrics;
}

export function TrendsView({
  athleteId,
  athleteName,
  exerciseName,
  currentAnalysisId,
  onClose,
  onOpen,
  load = loadKinemosLiftRecords,
  refresh = refreshStoredMetrics,
}: TrendsViewProps) {
  const [metricId, setMetricId] = useState('peakVelocity');
  const [scope, setScope] = useState<Scope>('exercise');
  const [against, setAgainst] = useState<Against>('time');
  const [range, setRange] = useState<Range>('all');

  const [records, setRecords] = useState<KinemosLiftRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<KinemosLiftRecord | null>(null);

  // Bumped to read the history again — after a cache refresh has rewritten it.
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState<{ done: number; total: number } | null>(null);
  const [refreshed, setRefreshed] = useState<RefreshOutcome | null>(null);

  useEffect(() => {
    if (!athleteId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    if (generation === 0) setRecords(null);
    load({ athleteIds: [athleteId] })
      .then(found => {
        if (!cancelled) setRecords(found);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the history.');
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, load, generation]);

  const metric = metricById(metricId) ?? METRIC_CATALOGUE[0];

  // Scope, then range, then the metric's own availability — in that order so
  // the caption can say how many of the reps IN VIEW have no number.
  const inScope = useMemo(() => {
    if (!records) return [];
    const wanted = (exerciseName ?? '').toLowerCase();
    const scoped =
      scope === 'exercise' && wanted
        ? records.filter(r => (r.exerciseName ?? '').toLowerCase() === wanted)
        : records;
    const months = RANGE_MONTHS[range];
    if (months === null) return scoped;
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    const fromIso = from.toISOString().slice(0, 10);
    return scoped.filter(r => r.date !== null && r.date >= fromIso);
  }, [records, scope, range, exerciseName]);

  // `!= null` and finite, not `!== null`: the adapter fills every catalogue id,
  // but a record built elsewhere may simply lack the key, and an undefined
  // plotted as a y is a NaN in the SVG.
  const plotted = useMemo(
    () => inScope.filter(r => isFinite(r.values[metric.id]) && r.date !== null),
    [inScope, metric.id],
  );
  const withLoad = useMemo(() => plotted.filter(r => isFinite(r.loadKg)), [plotted]);

  /** This exercise's reps regardless of the scope toggle — what a
   *  load–velocity line may be fitted over. */
  const sameExercise = useMemo(() => {
    if (!records) return [];
    const wanted = (exerciseName ?? '').toLowerCase();
    return wanted ? records.filter(r => (r.exerciseName ?? '').toLowerCase() === wanted) : records;
  }, [records, exerciseName]);
  const missing = inScope.length - plotted.length;

  /**
   * The athlete's reference lift for THIS exercise, drawn as a line to read
   * the others against — whatever the scope or range, because the reference
   * is a standard, not a data point in the window. Only when it has a value
   * for the metric on screen; a line at nothing is worse than no line.
   */
  const reference = useMemo(() => {
    const rec = records ? referenceOf(records, exerciseName) : null;
    const value = rec ? rec.values[metric.id] : null;
    return rec && value != null && Number.isFinite(value) ? { record: rec, value } : null;
  }, [records, exerciseName, metric.id]);
  const referenceLine = reference
    ? {
        value: reference.value,
        label: `reference ${num(reference.value, metric.decimals)}${
          reference.record.loadKg !== null ? ` @ ${num(reference.record.loadKg, 0)} kg` : ''
        }`,
      }
    : null;
  /** Reps in view whose cache predates the current schema — the ones a
   *  recompute would give numbers, or newer numbers. */
  const stale = useMemo(() => inScope.filter(isStale), [inScope]);

  const runRefresh = async () => {
    if (refreshing || stale.length === 0) return;
    setRefreshed(null);
    setRefreshing({ done: 0, total: stale.length });
    try {
      const outcome = await refresh(stale, {
        onProgress: (done, total) => setRefreshing({ done, total }),
      });
      setRefreshed(outcome);
    } finally {
      setRefreshing(null);
      setGeneration(g => g + 1);
    }
  };

  const metricUnit = `${metric.label} · ${metric.unit}`;

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-page)',
      }}
    >
      {/* Controls */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          padding: 'var(--space-sm) var(--space-lg)',
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-tertiary)',
          flexWrap: 'wrap',
        }}
      >
        <span style={label}>METRIC</span>
        <Select
          value={metric.id}
          onChange={e => setMetricId(e.target.value)}
          title={metric.why}
          style={{ minWidth: 180 }}
        >
          {METRIC_CATALOGUE.map(m => (
            <option key={m.id} value={m.id} title={m.why}>
              {m.label} ({m.unit})
            </option>
          ))}
        </Select>

        <span style={label}>SHOW</span>
        <Segmented
          value={scope}
          onChange={setScope}
          options={(Object.keys(SCOPE_LABEL) as Scope[]).map(key => ({
            value: key,
            label: SCOPE_LABEL[key],
            title:
              key === 'exercise'
                ? `Only ${exerciseName ?? 'this exercise'}. Reps of one exercise are joined into a line.`
                : 'Every analysed lift of this athlete. Different exercises are not joined — the hover names each.',
          }))}
        />

        <span style={label}>AGAINST</span>
        <Segmented
          value={against}
          onChange={setAgainst}
          options={(Object.keys(AGAINST_LABEL) as Against[]).map(key => ({
            value: key,
            label: AGAINST_LABEL[key],
            title:
              key === 'time'
                ? 'The metric by date, with the load each rep was done at underneath.'
                : 'The metric against the load it was done at — the load–velocity shape.',
          }))}
        />

        <span style={label}>RANGE</span>
        <Segmented
          value={range}
          onChange={setRange}
          options={(Object.keys(RANGE_LABEL) as Range[]).map(key => ({
            value: key,
            label: RANGE_LABEL[key],
          }))}
        />

        <button type="button" onClick={onClose} title="Back to the lift" style={backButton}>
          <X size={13} /> Back to the lift
        </button>
      </div>

      {!athleteId && (
        <Note>
          This clip has no athlete, so there is no history to put it against. Set the athlete on the
          clip in the library and the trend will appear here.
        </Note>
      )}

      {athleteId && error && <Note>{error}</Note>}

      {athleteId && !error && records === null && (
        <div style={{ display: 'grid', placeItems: 'center', flexGrow: 1 }}>
          <Spinner />
        </div>
      )}

      {athleteId && !error && records !== null && inScope.length === 0 && (
        <Note>
          {records.length === 0
            ? `Nothing analysed for ${athleteName ?? 'this athlete'} yet. Each rep you mark and calibrate becomes a point here.`
            : scope === 'exercise'
              ? `No analysed ${exerciseName ?? 'lift'} in this range. Widen the range, or show all exercises.`
              : 'No analysed lift in this range.'}
        </Note>
      )}

      {athleteId && !error && records !== null && inScope.length > 0 && (
        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-md)',
            padding: 'var(--space-md)',
            overflowY: 'auto',
          }}
        >
          <section style={{ ...card, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
            <header style={cardHeader}>
              <span style={label}>{metricUnit.toUpperCase()}</span>
              {hover ? (
                <HoverReadout record={hover} metricId={metric.id} decimals={metric.decimals} unit={metric.unit} />
              ) : (
                <GradeLegend />
              )}
            </header>
            {plotted.length === 0 ? null : against === 'time' ? (
              <DotChart
                records={plotted}
                x={r => dayOf(r.date!)}
                y={r => r.values[metric.id]!}
                xTicks={dateTicks}
                xLabel={t => formatDateShort(isoOf(t))}
                yLabel={v => num(v, metric.decimals)}
                joined={scope === 'exercise'}
                joinLabel="line: the day's mean"
                referenceY={referenceLine}
                height={220}
                currentId={currentAnalysisId}
                hover={hover}
                onHover={setHover}
                onOpen={onOpen}
              />
            ) : withLoad.length === 0 ? (
              <p style={{ ...caption, margin: 0, lineHeight: 1.5 }}>
                None of these reps has a logged load, so there is nothing to put the {metric.label.toLowerCase()} against.
              </p>
            ) : (
              <DotChart
                records={withLoad}
                x={r => r.loadKg!}
                y={r => r.values[metric.id]!}
                xTicks={niceTicks}
                xLabel={(kg, last) => `${num(kg, 0)}${last ? ' kg' : ''}`}
                yLabel={v => num(v, metric.decimals)}
                joined={false}
                referenceY={referenceLine}
                height={300}
                currentId={currentAnalysisId}
                hover={hover}
                onHover={setHover}
                onOpen={onOpen}
              />
            )}
            {(missing > 0 ||
              stale.length > 0 ||
              refreshed ||
              (against === 'load' && withLoad.length < plotted.length)) && (
              <p
                style={{
                  ...caption,
                  margin: 'var(--space-sm) 0 0',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--space-sm)',
                  flexWrap: 'wrap',
                }}
              >
                {missing > 0 && (
                  <span>
                    {`${missing} of ${inScope.length} reps in view have no stored ${metric.label.toLowerCase()}`}
                    {stale.length > 0
                      ? ' — analysed before these numbers were kept.'
                      : ' — usually a rep without the phase or the mass this needs.'}
                  </span>
                )}
                {stale.length > 0 && (
                  <RecomputeButton
                    count={stale.length}
                    progress={refreshing}
                    onClick={() => void runRefresh()}
                  />
                )}
                {refreshed && <RefreshSummary outcome={refreshed} />}
                {against === 'load' && withLoad.length < plotted.length && (
                  <span>{`${plotted.length - withLoad.length} more have no logged load and are not on this chart.`}</span>
                )}
              </p>
            )}
          </section>

          {against === 'time' && plotted.length > 0 && (
            <section style={{ ...card, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
              <header style={cardHeader}>
                <span style={label}>LOAD · KG</span>
                <span style={caption}>
                  {withLoad.length === plotted.length
                    ? 'the bar each rep was done with, same dates as above'
                    : `${plotted.length - withLoad.length} of ${plotted.length} reps have no logged load`}
                </span>
              </header>
              {withLoad.length === 0 ? (
                <p style={{ ...caption, margin: 0 }}>No logged loads on these clips.</p>
              ) : (
                <DotChart
                  records={withLoad}
                  x={r => dayOf(r.date!)}
                  y={r => r.loadKg!}
                  // Same x domain as the metric panel, so the two line up.
                  xDomain={domainOf(plotted.map(r => dayOf(r.date!)))}
                  xTicks={dateTicks}
                  xLabel={t => formatDateShort(isoOf(t))}
                  yLabel={kg => num(kg, 0)}
                  joined={false}
                  height={110}
                  currentId={currentAnalysisId}
                  hover={hover}
                  onHover={setHover}
                  onOpen={onOpen}
                />
              )}
            </section>
          )}

          <section style={{ ...card, flex: '0 0 auto' }}>
            <header style={cardHeader}>
              <span style={label}>REPS</span>
              <span style={caption}>{`${inScope.length} in view · click a row to open it`}</span>
            </header>
            <RepTable
              records={inScope}
              metricId={metric.id}
              decimals={metric.decimals}
              currentId={currentAnalysisId}
              hover={hover}
              onHover={setHover}
              onOpen={onOpen}
            />
          </section>

          {/* Design §12's end-game, in its display-only form (P5a). Fitted
              over this exercise alone whatever the scope above is set to: a
              line through the snatch and the clean together would be two
              lines fitted as one. */}
          <section style={card}>
            <LoadVelocityPanel records={sameExercise} exerciseName={exerciseName} />
          </section>
        </div>
      )}
    </div>
  );
}

function isFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ── Time helpers ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Days since the epoch, from YYYY-MM-DD. A number the chart can scale. */
function dayOf(iso: string): number {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function domainOf(values: readonly number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Date ticks at a spacing the span can carry: Mondays for a couple of months,
 * month starts for a year, quarter starts beyond. Never more than ~8 labels —
 * a date axis with twenty labels is a date axis nobody reads.
 */
function dateTicks(min: number, max: number): number[] {
  const span = max - min;
  const out: number[] = [];
  const start = new Date(min * DAY_MS);
  if (span <= 70) {
    // Back up to the Monday on or before the start.
    const monday = new Date(start);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const step = span <= 35 ? 7 : 14;
    for (let d = dayOf(monday.toISOString()); d <= max; d += step) if (d >= min) out.push(d);
    return out;
  }
  const monthStep = span <= 400 ? 1 : span <= 800 ? 3 : 6;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (dayOf(cursor.toISOString()) <= max) {
    const d = dayOf(cursor.toISOString());
    if (d >= min) out.push(d);
    cursor.setUTCMonth(cursor.getUTCMonth() + monthStep);
  }
  return out;
}

/** Round-number ticks for a numeric axis, five or so of them. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min || 1;
  const rough = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // No 2,5 multiplier: a 0,025 step prints as 1,77 / 1,80 / 1,82 at two
  // decimals, which reads as uneven spacing and is.
  const step = [1, 2, 5, 10].map(m => m * magnitude).find(s => span / s <= 6) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// ── The chart ───────────────────────────────────────────────────────────────

interface DotChartProps {
  records: readonly KinemosLiftRecord[];
  x: (r: KinemosLiftRecord) => number;
  y: (r: KinemosLiftRecord) => number;
  xDomain?: [number, number];
  xTicks: (min: number, max: number) => number[];
  xLabel: (v: number, last: boolean) => string;
  yLabel: (v: number) => string;
  /**
   * Join the marks with a thin line through the MEAN of each x — only when
   * they are one exercise, because a line through a snatch and a clean is a
   * lie. Through the mean, not through every rep: three reps of one set drawn
   * as a vertical zigzag say nothing about the block, and the marks are still
   * there for the spread.
   */
  joined: boolean;
  /** What the line is, said once under the chart. */
  joinLabel?: string;
  /** A horizontal line to read the marks against — the reference lift's value. */
  referenceY?: { value: number; label: string } | null;
  height: number;
  currentId: string | null;
  hover: KinemosLiftRecord | null;
  onHover: (r: KinemosLiftRecord | null) => void;
  onOpen: (r: KinemosLiftRecord) => void;
}

const W = 1000;
const H = 200;
/** Marker radius in screen pixels, converted to viewBox units per axis. */
const MARK_PX = 4.5;

function DotChart({
  records,
  x,
  y,
  xDomain,
  xTicks,
  xLabel,
  yLabel,
  joined,
  joinLabel,
  referenceY,
  height,
  currentId,
  hover,
  onHover,
  onOpen,
}: DotChartProps) {
  const xs = records.map(x);
  const ys = records.map(y);
  const [minX0, maxX0] = xDomain ?? domainOf(xs);
  // A single point, or one day: give it room either side rather than a zero span.
  const padX = maxX0 - minX0 > 0 ? (maxX0 - minX0) * 0.04 : 1;
  const minX = minX0 - padX;
  const maxX = maxX0 + padX;
  const [minY0, maxY0] = domainOf(referenceY ? [...ys, referenceY.value] : ys);
  const padY = maxY0 - minY0 > 0 ? (maxY0 - minY0) * 0.15 : Math.abs(maxY0) * 0.1 || 1;
  const minY = minY0 - padY;
  const maxY = maxY0 + padY;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // Marks are drawn in screen pixels: the SVG is stretched to its box, so a
  // circle in viewBox units would become an ellipse. The same measurement
  // gives the plot a fixed left inset in pixels, so the y labels sit beside
  // the first marks rather than on top of them.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const sx = box.width > 0 ? W / box.width : 1; // viewBox units per pixel, x
  const sy = box.height > 0 ? H / box.height : 1;
  const insetL = 52 * sx;
  const insetR = 16 * sx;

  const px = (v: number) => insetL + ((v - minX) / spanX) * (W - insetL - insetR);
  const py = (v: number) => H - ((v - minY) / spanY) * H;

  const ticksX = xTicks(minX0, maxX0);
  const ticksY = niceTicks(minY0, maxY0);

  // One point per distinct x for the line: the mean of the reps there.
  const joinPath = useMemo(() => {
    if (!joined) return null;
    const byX = new Map<number, number[]>();
    records.forEach((_, i) => {
      const arr = byX.get(xs[i]) ?? [];
      arr.push(ys[i]);
      byX.set(xs[i], arr);
    });
    const pts = [...byX.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([x, values]) => [x, values.reduce((a, b) => a + b, 0) / values.length] as const);
    return pts.length > 1 ? pts : null;
  }, [joined, records, xs, ys]);

  const readPointer = (clientX: number, clientY: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    // Nearest mark in screen space, within a generous reach — a hit target
    // bigger than the mark, as the interaction rules ask.
    let bestRecord: KinemosLiftRecord | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < records.length; i++) {
      const dx = (px(xs[i]) / W - fx) * rect.width;
      const dy = (py(ys[i]) / H - fy) * rect.height;
      const d = Math.hypot(dx, dy);
      if (d < bestDistance) {
        bestDistance = d;
        bestRecord = records[i];
      }
    }
    onHover(bestDistance <= 24 ? bestRecord : null);
  };

  return (
    <div
      ref={boxRef}
      onPointerMove={e => readPointer(e.clientX, e.clientY)}
      onPointerLeave={() => onHover(null)}
      onClick={() => {
        if (hover) onOpen(hover);
      }}
      role="img"
      aria-label={`${records.length} reps plotted`}
      style={{
        position: 'relative',
        height,
        display: 'flex',
        cursor: hover ? 'pointer' : 'crosshair',
        touchAction: 'none',
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {ticksY.map(v => (
          <line
            key={`y${v}`}
            x1={0}
            y1={py(v)}
            x2={W}
            y2={py(v)}
            stroke="var(--color-border-tertiary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ticksX.map(v => (
          <line
            key={`x${v}`}
            x1={px(v)}
            y1={0}
            x2={px(v)}
            y2={H}
            stroke="var(--color-border-tertiary)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {joinPath && (
          <polyline
            points={joinPath.map(([x, y]) => `${px(x).toFixed(2)},${py(y).toFixed(2)}`).join(' ')}
            fill="none"
            stroke={SERIES_COLOR}
            strokeWidth={1.5}
            strokeOpacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {referenceY && (
          <line
            x1={0}
            y1={py(referenceY.value)}
            x2={W}
            y2={py(referenceY.value)}
            stroke={CURRENT_COLOR}
            strokeWidth={1}
            strokeDasharray="6 4"
            strokeOpacity={0.7}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {records.map((r, i) => (
          <GradeMark
            key={r.analysisId}
            cx={px(xs[i])}
            cy={py(ys[i])}
            rx={MARK_PX * sx}
            ry={MARK_PX * sy}
            grade={r.grade}
            color={r.analysisId === currentId ? CURRENT_COLOR : SERIES_COLOR}
            emphasised={r.analysisId === currentId || r === hover}
          />
        ))}
      </svg>

      {ticksY.map(v => (
        <AxisLabel key={`yl${v}`} style={{ left: 4, top: `${(py(v) / H) * 100}%`, transform: 'translateY(-100%)' }}>
          {yLabel(v)}
        </AxisLabel>
      ))}
      {ticksX.map((v, i) => (
        <AxisLabel
          key={`xl${v}`}
          style={{ left: `${(px(v) / W) * 100}%`, bottom: 2, transform: 'translateX(-50%)' }}
        >
          {xLabel(v, i === ticksX.length - 1)}
        </AxisLabel>
      ))}
      {/* Bottom right, clear of the reference label, which sits at its own
          y and is usually near the top. */}
      {joinPath && joinLabel && (
        <AxisLabel style={{ right: 4, bottom: 16 }}>{joinLabel}</AxisLabel>
      )}
      {referenceY && (
        <AxisLabel
          style={{
            right: 4,
            top: `${(py(referenceY.value) / H) * 100}%`,
            transform: 'translateY(-100%)',
            color: CURRENT_COLOR,
          }}
        >
          {referenceY.label}
        </AxisLabel>
      )}
    </div>
  );
}

/**
 * One rep, drawn as its grade. Shape carries the quality; the viewBox is
 * stretched, so the radii are given per axis to come out round on screen.
 */
function GradeMark({
  cx,
  cy,
  rx,
  ry,
  grade,
  color,
  emphasised,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  grade: 'A' | 'B' | 'C' | null;
  color: string;
  emphasised: boolean;
}) {
  const ring = emphasised ? (
    <ellipse cx={cx} cy={cy} rx={rx * 2.2} ry={ry * 2.2} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
  ) : null;
  if (grade === 'A') {
    return (
      <>
        {ring}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={color} stroke="var(--color-bg-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </>
    );
  }
  if (grade === 'B') {
    return (
      <>
        {ring}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="var(--color-bg-primary)" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </>
    );
  }
  if (grade === 'C') {
    const d = `M${cx} ${cy - ry * 1.3} L${cx + rx * 1.3} ${cy} L${cx} ${cy + ry * 1.3} L${cx - rx * 1.3} ${cy} Z`;
    return (
      <>
        {ring}
        <path d={d} fill="var(--color-bg-primary)" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </>
    );
  }
  return (
    <>
      {ring}
      <path
        d={`M${cx - rx} ${cy - ry} L${cx + rx} ${cy + ry} M${cx - rx} ${cy + ry} L${cx + rx} ${cy - ry}`}
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

/** What each shape means, said once in the header. */
function GradeLegend() {
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--space-md)', ...caption }} title="The quality grade of each rep, as its shape. Grade A is an error of about 0,03 m/s or less on peak velocity; C is above 0,06 m/s.">
      {(['A', 'B', 'C', null] as const).map(g => (
        <span key={g ?? 'none'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden>
            <GradeMark cx={6} cy={6} rx={3.5} ry={3.5} grade={g} color={SERIES_COLOR} emphasised={false} />
          </svg>
          {g ? `grade ${g}` : 'ungraded'}
        </span>
      ))}
    </span>
  );
}

/** The rep under the pointer, read out in the header rather than in a box over the marks. */
function HoverReadout({
  record,
  metricId,
  decimals,
  unit,
}: {
  record: KinemosLiftRecord;
  metricId: string;
  decimals: number;
  unit: string;
}) {
  const value = record.values[metricId];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--space-sm)',
        fontSize: 'var(--text-caption)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ color: 'var(--color-text-tertiary)' }}>
        {record.date ? formatDateShort(record.date) : '—'}
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {[record.exerciseName, record.repIndex > 1 ? `rep ${record.repIndex}` : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {record.loadKg === null ? 'no load' : `${num(record.loadKg, 0)} kg`}
      </span>
      <span style={{ fontWeight: 600 }}>{value === null ? '—' : `${num(value, decimals)} ${unit}`}</span>
      <span style={{ color: 'var(--color-text-tertiary)' }}>
        {record.grade
          ? `grade ${record.grade}${record.gradeErrorMs !== null ? ` · ±${num(record.gradeErrorMs, 2)} m/s` : ''}`
          : 'ungraded'}
      </span>
    </span>
  );
}

// ── The table ───────────────────────────────────────────────────────────────

function RepTable({
  records,
  metricId,
  decimals,
  currentId,
  hover,
  onHover,
  onOpen,
}: {
  records: readonly KinemosLiftRecord[];
  metricId: string;
  decimals: number;
  currentId: string | null;
  hover: KinemosLiftRecord | null;
  onHover: (r: KinemosLiftRecord | null) => void;
  onOpen: (r: KinemosLiftRecord) => void;
}) {
  const metric = metricById(metricId);
  // Newest first: the table answers "what did the last few look like".
  const rows = [...records].reverse();
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
      <thead>
        <tr>
          <Th align="left">Date</Th>
          <Th align="left">Exercise</Th>
          <Th>Load</Th>
          <Th>Rep</Th>
          <Th>Grade</Th>
          <Th>{metric ? `${metric.label} (${metric.unit})` : 'Value'}</Th>
          <Th>± m/s</Th>
        </tr>
      </thead>
      <tbody onPointerLeave={() => onHover(null)}>
        {rows.map(r => {
          const value = r.values[metricId];
          const isCurrent = r.analysisId === currentId;
          return (
            <tr
              key={r.analysisId}
              onPointerEnter={() => onHover(r)}
              onClick={() => onOpen(r)}
              title={isCurrent ? 'The rep on screen' : 'Open this rep'}
              style={{
                cursor: 'pointer',
                background:
                  r === hover ? 'var(--color-accent-muted)' : isCurrent ? 'var(--color-bg-secondary)' : undefined,
              }}
            >
              <Td align="left" muted>
                {r.date ? formatDateShort(r.date) : '—'}
              </Td>
              <Td align="left" muted>
                {r.exerciseName ?? 'Clip'}
                {isCurrent ? <span style={{ ...caption, marginLeft: 6, color: CURRENT_COLOR }}>this rep</span> : null}
                {r.isReference ? <span style={{ ...caption, marginLeft: 6 }}>★ reference</span> : null}
              </Td>
              <Td>{r.loadKg === null ? '—' : num(r.loadKg, 0)}</Td>
              <Td>{r.repIndex}</Td>
              <Td>{r.grade ?? '—'}</Td>
              <Td strong={value !== null}>{value === null ? '—' : num(value, decimals)}</Td>
              <Td muted>{r.gradeErrorMs === null ? '—' : num(r.gradeErrorMs, 2)}</Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Cache refresh ───────────────────────────────────────────────────────────

/**
 * The one action on this screen. A rep analysed before the metrics cache
 * existed has a track and a calibration but no stored numbers; running the
 * pipeline over it once puts it on the chart. The button says how many, and
 * counts while it runs.
 */
function RecomputeButton({
  count,
  progress,
  onClick,
}: {
  count: number;
  progress: { done: number; total: number } | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={progress !== null}
      title="Run the measurement pipeline over each of these reps and store the result, exactly as opening the rep would. The grade is left as it is."
      style={{
        height: 22,
        padding: '0 8px',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontSize: 'var(--text-micro)',
        fontFamily: 'inherit',
        fontWeight: 600,
        letterSpacing: '0.04em',
        cursor: progress ? 'progress' : 'pointer',
      }}
    >
      {progress ? `RECOMPUTING ${progress.done} / ${progress.total}` : `RECOMPUTE ${count} ${count === 1 ? 'REP' : 'REPS'}`}
    </button>
  );
}

/** What the refresh did, and what it could not do, in one line. */
function RefreshSummary({ outcome }: { outcome: RefreshOutcome }) {
  const reasons = new Map<string, number>();
  for (const s of outcome.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  const skipped = [...reasons.entries()].map(([reason, n]) => `${n} ${reason}`).join(', ');
  return (
    <span style={{ color: outcome.skipped.length > 0 ? 'var(--color-warning-text)' : undefined }}>
      {`${outcome.refreshed.length} recomputed${skipped ? `; skipped ${skipped}` : ''}.`}
    </span>
  );
}

// ── Small parts ─────────────────────────────────────────────────────────────

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 560 }}>
      <p style={{ margin: 0, fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; title?: string }>;
}) {
  return (
    <span style={{ display: 'inline-flex' }}>
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={option.title}
          aria-pressed={value === option.value}
          style={{
            height: 22,
            padding: '0 8px',
            border: '1px solid var(--color-border-secondary)',
            borderLeftWidth: i === 0 ? 1 : 0,
            borderTopLeftRadius: i === 0 ? 'var(--radius-sm)' : 0,
            borderBottomLeftRadius: i === 0 ? 'var(--radius-sm)' : 0,
            borderTopRightRadius: i === options.length - 1 ? 'var(--radius-sm)' : 0,
            borderBottomRightRadius: i === options.length - 1 ? 'var(--radius-sm)' : 0,
            background: value === option.value ? 'var(--color-accent)' : 'var(--color-bg-primary)',
            color: value === option.value ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
            fontSize: 'var(--text-micro)',
            fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            cursor: 'pointer',
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

function AxisLabel({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <span
      style={{
        position: 'absolute',
        fontSize: 'var(--text-micro)',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--color-text-tertiary)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function Th({ children, align = 'right' }: { children?: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '2px 6px 4px 0',
        fontSize: 'var(--text-micro)',
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: 'var(--color-text-tertiary)',
        borderBottom: '1px solid var(--color-border-tertiary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'right',
  muted,
  strong,
}: {
  children?: ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '3px 6px 3px 0',
        fontSize: 'var(--text-label)',
        fontWeight: strong ? 600 : 400,
        color: muted ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
      }}
    >
      {children}
    </td>
  );
}

const backButton: CSSProperties = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 10px',
  border: '1px solid var(--color-border-secondary)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg-primary)',
  fontSize: 'var(--text-caption)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const card: CSSProperties = {
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-md)',
};

const cardHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-sm)',
  marginBottom: 'var(--space-sm)',
  flexWrap: 'wrap',
};

const label: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const caption: CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-tertiary)',
};
