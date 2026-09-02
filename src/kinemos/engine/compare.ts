/**
 * compare — two lifts, side by side and honestly.
 *
 * Design §8 ranks this first among comparison needs, ahead of trend lines and
 * ahead of a model lift. The coach's real question is never "what is the
 * number", it is "why did that one fail when the one last month made it", and
 * that needs two lifts on one screen.
 *
 * Two things make a comparison honest, and both are this module's job.
 *
 * **What the lifts are aligned on.** (Design §8: "sync by phase marker, e.g.
 * both at bar-off-floor".) Two clips
 * start at different moments — one includes the walk-up, the other begins with
 * the bar already loaded — so overlaying them from frame zero compares nothing.
 * Aligning on a shared PHYSICAL EVENT does. Lift-off is the default because it
 * is the one event every pull has, it is where the bar path starts, and it is
 * detected rather than guessed. Peak velocity is offered for reading the
 * turnover, where the interesting difference is often *after* the pull. The
 * anchor is stated on screen, because two curves aligned differently tell
 * different stories and the reader must know which they are being told.
 *
 * **Which direction is better.** A delta of +0,04 m/s on peak velocity is an
 * improvement; +0,04 m/s of velocity lost through the transition is not; +4 cm
 * of loop width is neither, it depends on the lifter. So every metric carries
 * `betterWhen`, and a metric where it genuinely depends carries null — which
 * the interface must render as a difference rather than as a verdict. Colour is
 * never allowed to be the only carrier of that.
 *
 * Engine purity: numbers in, numbers out.
 */
import type { KinematicSeries, RepSummary } from './kinematics';
import type { LiftMetrics, PhaseBoundary } from './phases';

/** The physical event two lifts are laid on top of each other at. */
export type AlignmentAnchor = 'clip-start' | 'liftoff' | 'peak-velocity' | 'apex';

export const ALIGNMENT_LABEL: Record<AlignmentAnchor, string> = {
  'clip-start': 'Start of clip',
  liftoff: 'Bar leaving the floor',
  'peak-velocity': 'Peak velocity',
  apex: 'Top of the pull',
};

/** Why each anchor exists, for the picker's tooltips. */
export const ALIGNMENT_WHY: Record<AlignmentAnchor, string> = {
  'clip-start':
    'No alignment at all. Only meaningful when both clips were trimmed to the same moment.',
  liftoff:
    'The one event every pull has, and where the bar path starts. The default, and the right choice for comparing pulls.',
  'peak-velocity':
    'Lays the two second pulls on top of each other. Use this when the difference you are chasing is in the turnover.',
  apex: 'Lays the two catches on top of each other.',
};

/** A series shifted so the anchor sits at t = 0 and at the origin. */
export interface AlignedSeries {
  /** Seconds relative to the anchor. Negative before it. */
  t: number[];
  /** Centimetres relative to the bar's position at the anchor. */
  xCm: number[];
  yCm: number[];
  vyMs: number[];
  powerW: number[] | null;
  /** Where the anchor was in the original clip, so a playhead can map back. */
  anchorT: number;
  /** False when the requested anchor was not present and the clip start was
   *  used instead — the interface must say so rather than implying alignment
   *  that did not happen. */
  anchored: boolean;
}

/** Time of an anchor within a series, or null when that event is not there. */
export function anchorTimeOf(
  series: KinematicSeries,
  boundaries: readonly PhaseBoundary[],
  anchor: AlignmentAnchor,
): number | null {
  if (series.t.length === 0) return null;
  if (anchor === 'clip-start') return series.t[0];

  const rule = anchor === 'liftoff' ? 'liftoff' : anchor === 'apex' ? 'apex' : 'peak-velocity';
  const found = boundaries.find(b => b.rule === rule);
  // A fallback boundary is a guess about where an event was; aligning two lifts
  // on two guesses would compare the guesses. Only a detected or
  // coach-corrected edge is good enough to lay two clips on top of each other.
  if (found && found.source !== 'fallback') return found.t;

  // Peak velocity needs no phase model — it is a property of the series.
  if (anchor === 'peak-velocity') {
    let best = 0;
    for (let i = 1; i < series.vyMs.length; i++) if (series.vyMs[i] > series.vyMs[best]) best = i;
    return series.t[best];
  }
  if (anchor === 'apex') {
    let best = 0;
    for (let i = 1; i < series.yCm.length; i++) if (series.yCm[i] > series.yCm[best]) best = i;
    return series.t[best];
  }
  return null;
}

/**
 * Shift a series so the anchor is the origin in both time and space.
 *
 * Position is normalised as well as time, because two lifts filmed from
 * different distances or with the bar in a different part of frame produce
 * paths that are the same shape in different places. Comparing the shapes is
 * the point; comparing where the camera happened to be is not.
 */
export function alignSeries(
  series: KinematicSeries,
  boundaries: readonly PhaseBoundary[],
  anchor: AlignmentAnchor,
): AlignedSeries {
  const found = anchorTimeOf(series, boundaries, anchor);
  const anchorT = found ?? series.t[0] ?? 0;

  // Position at the anchor, by linear read — the anchor rarely lands exactly on
  // a sample.
  const originX = readAt(series.t, series.xCm, anchorT);
  const originY = readAt(series.t, series.yCm, anchorT);

  return {
    t: series.t.map(t => t - anchorT),
    xCm: series.xCm.map(v => v - originX),
    yCm: series.yCm.map(v => v - originY),
    vyMs: [...series.vyMs],
    powerW: series.powerW ? [...series.powerW] : null,
    anchorT,
    anchored: found !== null,
  };
}

function readAt(t: readonly number[], values: readonly number[], at: number): number {
  const n = t.length;
  if (n === 0) return 0;
  if (at <= t[0]) return values[0];
  if (at >= t[n - 1]) return values[n - 1];
  for (let i = 1; i < n; i++) {
    if (t[i] >= at) {
      const gap = t[i] - t[i - 1];
      const frac = gap > 0 ? (at - t[i - 1]) / gap : 0;
      return values[i - 1] + (values[i] - values[i - 1]) * frac;
    }
  }
  return values[n - 1];
}

/** Which way is up, for a given metric. Null where it genuinely depends on the
 *  lifter and the interface must not pass judgement. */
export type BetterWhen = 'higher' | 'lower' | null;

export interface MetricDelta {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  a: number | null;
  b: number | null;
  /** b − a. Null when either side is missing. */
  delta: number | null;
  betterWhen: BetterWhen;
  /**
   * What the difference means, in words. `incomparable` is the important one:
   * a number that CAN be subtracted but should not be. Null when there is no
   * difference worth naming.
   */
  verdict: 'better' | 'worse' | 'same' | 'different' | 'incomparable' | null;
  /** Why this metric is worth comparing at all. */
  why: string;
}

/** Below these, a difference is inside the noise of an everyday analysis and is
 *  reported as "the same" rather than as a change. COACH-CONFIG in spirit —
 *  a hardcore-tier setup could tighten them. */
const SIGNIFICANT: Record<string, number> = {
  peakVelocity: 0.03,
  firstPull: 0.03,
  secondPull: 0.03,
  transitionLoss: 0.03,
  turnover: 0.03,
  peakHeight: 1,
  loopWidth: 1,
  peakPower: 40,
  duration: 0.05,
};

/**
 * The delta table. `a` is the reference lift (usually the older one) and `b` is
 * the one being judged, so a positive delta means "b is higher than a".
 */
export function compareMetrics(
  a: { metrics: LiftMetrics; summary: RepSummary },
  b: { metrics: LiftMetrics; summary: RepSummary },
  options: {
    /**
     * False when the two lifts were done with materially different bars. Power
     * is then still a subtraction and still not a comparison — and a table that
     * calls it "better" while the caveat below says it cannot be compared is
     * worse than one that says nothing.
     */
    massesComparable?: boolean;
  } = {},
): MetricDelta[] {
  const phase = (m: LiftMetrics, id: string) => m.phases.find(p => p.phaseId === id) ?? null;

  const rows: Array<Omit<MetricDelta, 'delta' | 'verdict'>> = [
    {
      id: 'peakVelocity',
      label: 'Peak velocity',
      unit: 'm/s',
      decimals: 2,
      a: a.metrics.peakVelocityMs,
      b: b.metrics.peakVelocityMs,
      betterWhen: 'higher',
      why: 'The headline number, and the one that decides whether a heavy attempt gets overhead.',
    },
    {
      id: 'firstPull',
      label: 'First pull',
      unit: 'm/s',
      decimals: 2,
      a: phase(a.metrics, 'first_pull')?.peakVelocityMs ?? null,
      b: phase(b.metrics, 'first_pull')?.peakVelocityMs ?? null,
      // Faster off the floor is not automatically better — many coaches teach a
      // patient first pull precisely so the second can be faster.
      betterWhen: null,
      why: 'How fast the bar left the floor. Faster is not automatically better: a patient first pull is a coaching choice.',
    },
    {
      id: 'secondPull',
      label: 'Second pull',
      unit: 'm/s',
      decimals: 2,
      a: phase(a.metrics, 'second_pull')?.peakVelocityMs ?? null,
      b: phase(b.metrics, 'second_pull')?.peakVelocityMs ?? null,
      betterWhen: 'higher',
      why: 'The extension. This is where a missed lift is usually lost.',
    },
    {
      id: 'transitionLoss',
      label: 'Loss 1st → 2nd',
      unit: 'm/s',
      decimals: 2,
      a: a.metrics.transitionVelocityLossMs,
      b: b.metrics.transitionVelocityLossMs,
      betterWhen: 'lower',
      why: 'How much speed the bar gave up through the transition. Less is generally better, though some dip is normal.',
    },
    {
      id: 'turnover',
      label: 'Turnover',
      unit: 'm/s',
      decimals: 2,
      a: a.metrics.turnoverVelocityMs,
      b: b.metrics.turnoverVelocityMs,
      betterWhen: 'higher',
      why: 'Mean upward velocity while the bar is being pulled under.',
    },
    {
      id: 'peakHeight',
      label: 'Peak height',
      unit: 'cm',
      decimals: 1,
      a: a.summary.peakHeightCm,
      b: b.summary.peakHeightCm,
      betterWhen: null,
      why: 'How high the bar got above its start. Higher costs energy; whether it is better depends on whether the lift was made.',
    },
    {
      id: 'loopWidth',
      label: 'Loop width',
      unit: 'cm',
      decimals: 1,
      a: a.summary.loopWidthCm,
      b: b.summary.loopWidthCm,
      betterWhen: null,
      why: 'Total horizontal spread of the path. A tighter path is not universally better — the loop is how the bar gets past the knees.',
    },
    {
      id: 'peakPower',
      label: 'Peak power',
      unit: 'W',
      decimals: 0,
      a: a.metrics.peakPowerW,
      b: b.metrics.peakPowerW,
      betterWhen: 'higher',
      why: 'Barbell power at its peak. Only comparable when both lifts carry a mass and the masses are close — a heavier bar moving slower can out-power a lighter bar moving faster, which says nothing about the lifter.',
    },
    {
      id: 'duration',
      label: 'Pull duration',
      unit: 's',
      decimals: 2,
      a: a.summary.durationS,
      b: b.summary.durationS,
      betterWhen: null,
      why: 'Time from the first marked frame to the last. Sensitive to how each clip was marked, so read it as context rather than as a result.',
    },
  ];

  const massesComparable = options.massesComparable ?? true;

  return rows.map(row => {
    const delta = row.a !== null && row.b !== null ? row.b - row.a : null;
    if (row.id === 'peakPower' && !massesComparable && delta !== null) {
      return { ...row, delta, betterWhen: null, verdict: 'incomparable' as const };
    }
    return { ...row, delta, verdict: verdictFor(row.id, delta, row.betterWhen) };
  });
}

function verdictFor(id: string, delta: number | null, betterWhen: BetterWhen): MetricDelta['verdict'] {
  if (delta === null) return null;
  const threshold = SIGNIFICANT[id] ?? 0;
  if (Math.abs(delta) <= threshold) return 'same';
  if (betterWhen === null) return 'different';
  const isBetter = betterWhen === 'higher' ? delta > 0 : delta < 0;
  return isBetter ? 'better' : 'worse';
}

/**
 * Whether two analyses can be compared without a caveat, and what the caveat is
 * when they cannot.
 *
 * Design §6.4 allows comparison across quality grades and requires it to be
 * flagged. Two other mismatches are worth the same treatment: a different bar
 * mass makes power incomparable, and a different phase model makes "second
 * pull" mean two different things.
 */
/** Whether two bar masses are close enough for power to mean anything across
 *  them. Half a kilo of collar difference is not a different bar. */
export function massesAreComparable(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= 0.5;
}

export function comparisonCaveats(
  a: { grade: string | null; massKg: number | null; phaseSetId: string },
  b: { grade: string | null; massKg: number | null; phaseSetId: string },
): string[] {
  const out: string[] = [];
  if (a.grade !== b.grade) {
    out.push(
      `These are graded differently (${a.grade ?? 'ungraded'} and ${b.grade ?? 'ungraded'}), so the two sets of numbers are not equally precise. Read a small difference with that in mind.`,
    );
  }
  if (a.massKg !== null && b.massKg !== null && !massesAreComparable(a.massKg, b.massKg)) {
    out.push(
      `The bars differ (${fmt(a.massKg)} and ${fmt(b.massKg)} kg). Velocities are comparable; power is not, and neither is velocity across a big jump in load.`,
    );
  } else if (a.massKg === null || b.massKg === null) {
    out.push('One of these has no bar mass, so power cannot be compared.');
  }
  if (a.phaseSetId !== b.phaseSetId) {
    out.push(
      'These were segmented with different phase models, so a phase in one does not mean the same thing as a phase in the other.',
    );
  }
  return out;
}

function fmt(value: number): string {
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)).replace('.', ',');
}
