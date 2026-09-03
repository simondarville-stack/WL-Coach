/**
 * LoadVelocityPanel — what this athlete's bar speed says about their loads.
 *
 * Design §12's end-game, in its first and deliberately smallest form:
 * **display, not prescription**. The panel fits the athlete's own analysed
 * reps, draws the line, and reads three things off it — the velocity a load
 * should move at, the load for a target velocity, and where the maximum
 * probably is. It writes nothing to the planner. Design §3's non-goal is
 * explicit that metrics-into-planner display comes before
 * metrics-driving-planner logic, and this is the display.
 *
 * Everything the fit is unsure about is on screen next to the number it
 * affects, because in Olympic lifting this line is noisier than the
 * literature it comes from and a bare "1RM: 122 kg" would be the most
 * confidently wrong thing KinEMOS has ever printed:
 *
 *   - the load range the line was fitted over, and how far past it any
 *     estimate reaches;
 *   - whether the minimal velocity threshold was MEASURED from a near-maximal
 *     attempt of this athlete's or merely assumed;
 *   - r² and the residual scatter, so a coach can see how tight the line is.
 */
import { useMemo, useState } from 'react';
import type { KinemosLiftRecord } from '../lib/analysisAdapter';
import {
  estimateOneRepMax,
  extrapolation,
  fitLoadVelocityProfile,
  loadForVelocity,
  repAtLossCutoff,
  thresholdFrom,
  velocityAtLoad,
  velocityLoss,
  type LoadVelocityPoint,
} from '../engine/loadVelocity';
import { num } from '../lib/viewerFormat';

/** Where a snatch's maximum tends to move, absent a measured attempt of this
 *  athlete's. A starting point that the panel always labels as assumed —
 *  the real threshold is personal, and differs between the lifts.
 *  COACH-CONFIG candidate. */
const ASSUMED_THRESHOLD_MS = 1.5;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function LoadVelocityPanel({
  records,
  exerciseName,
}: {
  /** The athlete's analysed reps of ONE exercise. A profile across the
   *  snatch and the clean would be two lines fitted as one. */
  records: readonly KinemosLiftRecord[];
  exerciseName: string | null;
}) {
  const [targetVelocity, setTargetVelocity] = useState(1.6);
  const [assumedThreshold, setAssumedThreshold] = useState(ASSUMED_THRESHOLD_MS);

  const points = useMemo<LoadVelocityPoint[]>(
    () =>
      records
        .map(r => ({
          loadKg: r.massKg ?? r.loadKg ?? NaN,
          velocityMs: r.values.peakVelocity ?? NaN,
          grade: r.grade,
          date: r.date,
          analysisId: r.analysisId,
        }))
        .filter(p => Number.isFinite(p.loadKg) && Number.isFinite(p.velocityMs)),
    [records],
  );

  const profile = useMemo(() => fitLoadVelocityProfile(points), [points]);

  /**
   * The most recent set worth the name: the newest clip whose reps number
   * more than one. A set is one clip — the reps of a double or a triple, in
   * the order they were lifted — which is exactly what `trackSet` writes.
   */
  const lastSet = useMemo(() => {
    const byClip = new Map<string, KinemosLiftRecord[]>();
    for (const r of records) {
      if (!isFiniteNumber(r.values.peakVelocity)) continue;
      const group = byClip.get(r.clipKey);
      if (group) group.push(r);
      else byClip.set(r.clipKey, [r]);
    }
    const sets = [...byClip.values()]
      .filter(g => g.length > 1)
      .sort((a, b) => (b[0].date ?? '').localeCompare(a[0].date ?? ''));
    const newest = sets[0];
    if (!newest) return null;
    const ordered = [...newest].sort((a, b) => a.repIndex - b.repIndex);
    const velocities = ordered.map(r => r.values.peakVelocity as number);
    const loss = velocityLoss(velocities);
    return loss ? { loss, date: ordered[0].date, cutoffRep: repAtLossCutoff(velocities, 10) } : null;
  }, [records]);
  const estimate = useMemo(() => {
    if (!profile) return null;
    const threshold = thresholdFrom(points) ?? { velocityMs: assumedThreshold, source: 'assumed' as const };
    return estimateOneRepMax(profile, threshold);
  }, [profile, points, assumedThreshold]);
  const prescribed = useMemo(
    () => (profile ? loadForVelocity(profile, targetVelocity) : null),
    [profile, targetVelocity],
  );

  if (!profile) {
    return (
      <section style={shell}>
        <header style={header}>
          <span style={label}>LOAD &amp; VELOCITY</span>
        </header>
        <p style={hint}>
          {points.length < 4
            ? `Not enough analysed reps of ${exerciseName ?? 'this exercise'} yet — a profile needs four, across a spread of loads.`
            : 'These reps do not span enough of a load range to fit a line worth reading. A profile wants a light day and a heavy one, not five sets at the same weight.'}
        </p>
      </section>
    );
  }

  const reach = prescribed === null ? 0 : extrapolation(profile, prescribed);

  return (
    <section style={shell}>
      <header style={header}>
        <span style={label}>LOAD &amp; VELOCITY</span>
        <span style={{ ...label, letterSpacing: 0 }} title="Fitted from this athlete's own analysed reps of this exercise. It describes them; it does not prescribe anything.">
          {`${profile.n} reps · ${num(profile.minLoadKg, 0)}–${num(profile.maxLoadKg, 0)} kg`}
        </span>
      </header>

      <Plot profile={profile} points={points} target={prescribed} />

      <dl style={{ margin: 'var(--space-sm) 0 0', display: 'grid', gap: 2 }}>
        <Row
          term="The line"
          value={`${num(profile.interceptMs, 2)} − ${num(Math.abs(profile.slopeMsPerKg) * 10, 3)} m/s per 10 kg`}
          hint="Peak bar velocity against load. In Olympic lifting this is a guide rather than a law — technique changes with load in a way it does not in a squat."
        />
        <Row
          term="Fit"
          value={`r² ${num(profile.r2, 2)} · ±${num(profile.residualMs, 2)} m/s`}
          hint="How tightly the reps sit on the line, and how far a typical rep falls from it. A loose fit is not a broken measurement — it is a lifter whose technique varies with load."
        />
      </dl>

      <div style={{ marginTop: 'var(--space-sm)', display: 'grid', gap: 'var(--space-xs)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--text-label)' }}>
          <span style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}>Load for</span>
          <input
            type="number"
            step="0.05"
            min="0.5"
            max="3"
            value={targetVelocity}
            onChange={e => setTargetVelocity(Number(e.target.value))}
            className="emos-input"
            style={{ width: 72, height: 26, fontSize: 'var(--text-caption)' }}
          />
          <span style={{ color: 'var(--color-text-secondary)' }}>m/s</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {prescribed === null ? '—' : `${num(prescribed, 1)} kg`}
          </span>
        </label>
        {reach > 0 && (
          <p style={hint}>
            {reach > 0.5
              ? `That is well outside the loads this line was fitted over — the number is an opinion, not a reading. Analyse a rep near it and the line will know.`
              : `Slightly outside the fitted loads (${num(profile.minLoadKg, 0)}–${num(profile.maxLoadKg, 0)} kg).`}
          </p>
        )}
      </div>

      {lastSet && (
        <div style={{ marginTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 'var(--space-sm)' }}>
          <Row
            term={`Velocity loss · last set${lastSet.date ? `, ${lastSet.date}` : ''}`}
            value={`${num(lastSet.loss.worstLossPct, 0)} % over ${lastSet.loss.reps} reps`}
            hint="How far the bar slowed within one set, measured from the best rep rather than the first — a second rep is routinely faster than a first, and measuring from the first would call that a gain. The most-used autoregulation cue there is: when the bar has slowed this far, the set has done its work."
          />
          <p style={hint}>
            {`Best ${num(lastSet.loss.bestMs, 2)} m/s on rep ${lastSet.loss.bestIndex + 1}, last ${num(lastSet.loss.lastMs, 2)} m/s.` +
              (lastSet.cutoffRep !== null
                ? ` A 10 % cutoff would have ended it on rep ${lastSet.cutoffRep}.`
                : ' It never dropped 10 % — the set had more in it.')}
          </p>
        </div>
      )}

      {estimate && (
        <div style={{ marginTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 'var(--space-sm)' }}>
          <Row
            term="Maximum, estimated"
            value={`${num(estimate.loadKg, 1)} kg at ${num(estimate.thresholdMs, 2)} m/s`}
            hint="The load at which the bar would move at the speed this athlete's maximum actually moves. It is the line extended, not a test — and it is only as good as the threshold beside it."
            strong
          />
          <p style={hint}>
            {estimate.thresholdSource === 'measured'
              ? `The threshold is measured: the slowest of this athlete's near-maximal reps moved at ${num(estimate.thresholdMs, 2)} m/s.`
              : 'The threshold is assumed, not measured — no near-maximal rep of this athlete has been analysed. Until one has, treat the estimate as a shape, not a number.'}
            {estimate.extrapolation > 0.5 &&
              ' The line is also being extended well past the loads it was fitted over.'}
          </p>
          {estimate.thresholdSource === 'assumed' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--text-label)', marginTop: 'var(--space-xs)' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Assume</span>
              <input
                type="number"
                step="0.05"
                min="0.5"
                max="3"
                value={assumedThreshold}
                onChange={e => setAssumedThreshold(Number(e.target.value))}
                className="emos-input"
                style={{ width: 72, height: 26, fontSize: 'var(--text-caption)' }}
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>m/s at maximum</span>
            </label>
          )}
        </div>
      )}
    </section>
  );
}

/** The reps and the line they fit, load across, velocity up. Hand-rolled SVG
 *  for the same reason the analysis panel is: two axes and a straight line
 *  are fewer lines drawn than configured. */
function Plot({
  profile,
  points,
  target,
}: {
  profile: NonNullable<ReturnType<typeof fitLoadVelocityProfile>>;
  points: readonly LoadVelocityPoint[];
  target: number | null;
}) {
  const W = 1000;
  const H = 260;
  const PAD = 30;
  // Padded a little past the fitted loads so an extrapolated target has
  // somewhere to sit and is visibly outside the data.
  const loadLo = Math.min(profile.minLoadKg, target ?? profile.minLoadKg) * 0.96;
  const loadHi = Math.max(profile.maxLoadKg, target ?? profile.maxLoadKg) * 1.04;
  const vs = points.map(p => p.velocityMs);
  const vLo = Math.min(...vs, velocityAtLoad(profile, loadHi)) * 0.94;
  const vHi = Math.max(...vs, velocityAtLoad(profile, loadLo)) * 1.06;
  const x = (load: number) => PAD + ((load - loadLo) / (loadHi - loadLo || 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - vLo) / (vHi - vLo || 1)) * (H - 2 * PAD);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 130, display: 'block', background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-sm)' }}
    >
      {/* The span the line was actually fitted over — everything outside it
          is extrapolation, and the drawing says so rather than a caption. */}
      <rect
        x={x(profile.minLoadKg)}
        y={PAD / 2}
        width={Math.max(0, x(profile.maxLoadKg) - x(profile.minLoadKg))}
        height={H - PAD}
        fill="var(--color-accent-muted)"
        opacity={0.5}
      />
      <line
        x1={x(loadLo)}
        y1={y(velocityAtLoad(profile, loadLo))}
        x2={x(loadHi)}
        y2={y(velocityAtLoad(profile, loadHi))}
        stroke="var(--color-accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => (
        <circle
          key={p.analysisId ?? i}
          cx={x(p.loadKg)}
          cy={y(p.velocityMs)}
          r={4}
          fill={p.grade === 'C' ? 'var(--color-text-tertiary)' : 'var(--color-accent)'}
          opacity={p.grade === 'C' ? 0.4 : 0.9}
        >
          <title>{`${num(p.loadKg, 1)} kg · ${num(p.velocityMs, 2)} m/s${p.date ? ` · ${p.date}` : ''}${p.grade ? ` · grade ${p.grade}` : ''}`}</title>
        </circle>
      ))}
      {target !== null && target > loadLo && target < loadHi && (
        <line
          x1={x(target)}
          y1={PAD / 2}
          x2={x(target)}
          y2={H - PAD}
          stroke="var(--color-text-primary)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function Row({ term, value, hint: title, strong }: { term: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }} title={title}>
      <dt style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>{term}</dt>
      <dd
        style={{
          margin: 0,
          fontSize: strong ? 'var(--text-section)' : 'var(--text-label)',
          fontWeight: strong ? 600 : 400,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const shell = {
  padding: 'var(--space-md)',
  borderTop: '1px solid var(--color-border-secondary)',
};

const header = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 'var(--space-xs)',
};

const label = {
  fontSize: 'var(--text-micro)',
  letterSpacing: '0.06em',
  color: 'var(--color-text-tertiary)',
};

const hint = {
  margin: 'var(--space-xs) 0 0',
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-secondary)',
  maxWidth: '68ch',
};
