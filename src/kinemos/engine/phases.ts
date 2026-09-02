/**
 * phases — where one part of the lift ends and the next begins.
 *
 * Coaches genuinely disagree about this. Some end the first pull when the bar
 * passes the knee, some at the first velocity peak, some at maximum knee
 * extension; the transition is called the double knee bend, the scoop, or
 * nothing at all. An `enum { FIRST_PULL, TRANSITION, … }` with the boundaries
 * welded into the detector would make KinEMOS's opinion the only opinion —
 * exactly the red flag CLAUDE.md names first.
 *
 * So a phase set is DATA: an ordered list of definitions, each naming the rule
 * that proposes its start and carrying that rule's thresholds. The default set
 * below is the common five-phase snatch/clean model, and it is a default, not
 * the model. Swapping in a four-phase set, renaming "transition" to "scoop", or
 * moving the second pull to begin at maximum knee extension is a change to this
 * array, not to the detector.
 *
 * Everything here is a PROPOSAL. The coach drags an edge and their value wins
 * forever after (`source: 'coach'`), which is the Kinovea principle applied to
 * segmentation: automation proposes, the coach disposes.
 *
 * Engine purity: numbers in, numbers out.
 */
import type { KinematicSeries } from './kinematics';
import { meanOver, peakOver } from './kinematics';

/**
 * How a boundary is found. Each rule reads the velocity/position series and
 * returns a time, or null when the signature it looks for is not there.
 */
export type BoundaryRuleId =
  | 'start-of-clip'
  | 'liftoff'
  | 'first-velocity-peak'
  | 'velocity-trough'
  | 'peak-velocity'
  | 'apex'
  | 'settle'
  | 'end-of-clip';

export interface PhaseDefinition {
  id: string;
  label: string;
  /** For the timeline band, where a full label will not fit. */
  shortLabel: string;
  /** DATA colour — it encodes which phase this is, and must not be flattened
   *  to a neutral token (design brief, hard conventions). */
  color: string;
  /** The rule that proposes where this phase begins. The phase ends where the
   *  next one starts; the last ends at `endRule`. */
  startRule: BoundaryRuleId;
}

/** Thresholds the rules read. COACH-CONFIG: every one of these is a judgement
 *  call a coach may want to move, and none of them is a law of physics. */
export interface PhaseThresholds {
  /** Upward velocity that counts as the bar having left the floor, m/s. */
  liftoffMs: number;
  /** How long it must stay above that to count, seconds — so one noisy frame
   *  does not declare lift-off. */
  liftoffHoldS: number;
  /** How much a local velocity peak must stand out from its surroundings to be
   *  believed as the end of the first pull, m/s. Below this the dip is noise or
   *  simply is not there. */
  minProminenceMs: number;
  /** Velocity below which the bar counts as settled after the catch, m/s. */
  settleMs: number;
}

export const DEFAULT_PHASE_THRESHOLDS: PhaseThresholds = {
  liftoffMs: 0.1,
  liftoffHoldS: 0.05,
  minProminenceMs: 0.05,
  settleMs: 0.15,
};

/**
 * The default five-phase model for a snatch or clean, in order.
 *
 * Colours are the ones the P1 design work settled on, dark enough to carry
 * white 10 px type in the timeline band.
 */
export const DEFAULT_PHASE_SET: PhaseDefinition[] = [
  { id: 'first_pull', label: 'First pull', shortLabel: 'FIRST PULL', color: '#3E6E9E', startRule: 'liftoff' },
  { id: 'transition', label: 'Transition', shortLabel: 'TRANS', color: '#6E6D67', startRule: 'first-velocity-peak' },
  { id: 'second_pull', label: 'Second pull', shortLabel: 'SECOND PULL', color: '#185FA5', startRule: 'velocity-trough' },
  { id: 'turnover', label: 'Turnover', shortLabel: 'TURN', color: '#A8681F', startRule: 'peak-velocity' },
  { id: 'catch', label: 'Catch', shortLabel: 'CATCH', color: '#3E6E3A', startRule: 'apex' },
];

/** Where the last phase ends. Kept beside the set so a different model can end
 *  somewhere else. */
export const DEFAULT_PHASE_END_RULE: BoundaryRuleId = 'settle';

/** Where a boundary's value came from — and therefore how much to trust it. */
export type BoundarySource = 'detected' | 'fallback' | 'coach';

export interface PhaseBoundary {
  /** The phase this time starts. The final entry is the end of the last phase
   *  and has `phaseId: null`. */
  phaseId: string | null;
  t: number;
  rule: BoundaryRuleId;
  source: BoundarySource;
}

export interface PhaseSpan {
  definition: PhaseDefinition;
  fromT: number;
  toT: number;
  /** The weaker of the two boundary sources — a span is only as trustworthy as
   *  the vaguer of its edges. */
  source: BoundarySource;
}

export interface PhaseMetrics {
  phaseId: string;
  label: string;
  durationS: number;
  meanVelocityMs: number | null;
  peakVelocityMs: number | null;
  peakVelocityT: number | null;
  heightGainedCm: number;
  peakPowerW: number | null;
}

export interface LiftMetrics {
  phases: PhaseMetrics[];
  /** Peak upward velocity anywhere in the lift. */
  peakVelocityMs: number | null;
  /**
   * The dip between the first pull's peak and the trough before the second
   * pull — "speed loss first → second" (design §7). Positive means the bar
   * genuinely slowed through the transition, which is normal; a large value is
   * a coaching signal, a negative one means no dip was found.
   */
  transitionVelocityLossMs: number | null;
  /** Mean upward velocity through the turnover — how fast the bar is being
   *  pulled under. */
  turnoverVelocityMs: number | null;
  peakPowerW: number | null;
}

/** Result of proposing boundaries: the times, plus whether the signatures were
 *  actually found or fallen back on. */
export interface PhaseProposal {
  boundaries: PhaseBoundary[];
  /** True when every boundary came from a real signature in the data. When
   *  false the UI must say the edges are guesses worth checking. */
  fullyDetected: boolean;
}

// ── Signature finders ───────────────────────────────────────────────────────

/**
 * First time the bar is genuinely moving up: velocity above the threshold and
 * still above it `holdS` later. The hold is what stops a single noisy frame
 * near the floor from declaring lift-off half a second early.
 */
function findLiftoff(series: KinematicSeries, th: PhaseThresholds): number | null {
  const holdSamples = Math.max(1, Math.round(th.liftoffHoldS / series.dt));
  for (let i = 0; i < series.vyMs.length - holdSamples; i++) {
    if (series.vyMs[i] < th.liftoffMs) continue;
    let held = true;
    for (let k = 1; k <= holdSamples; k++) {
      if (series.vyMs[i + k] < th.liftoffMs) {
        held = false;
        break;
      }
    }
    if (held) return series.t[i];
  }
  return null;
}

/** Index of the largest upward velocity. */
function peakVelocityIndex(series: KinematicSeries): number {
  let best = 0;
  for (let i = 1; i < series.vyMs.length; i++) if (series.vyMs[i] > series.vyMs[best]) best = i;
  return best;
}

/** Index of the highest the bar got. */
function apexIndex(series: KinematicSeries): number {
  let best = 0;
  for (let i = 1; i < series.yCm.length; i++) if (series.yCm[i] > series.yCm[best]) best = i;
  return best;
}

/**
 * The first pull's velocity peak: the earliest local maximum before the global
 * peak that stands out by at least `minProminence` from the trough that follows
 * it.
 *
 * Prominence, not merely "is a local maximum", because a filtered velocity
 * curve still wiggles. A dip of 2 cm/s is not a double knee bend; a dip of
 * 15 cm/s is. Returns null when the pull simply has no dip — some lifters, and
 * most pulls from the hang, do not show one, and inventing a boundary there
 * would be inventing a finding.
 */
function findFirstVelocityPeak(
  series: KinematicSeries,
  fromIndex: number,
  toIndex: number,
  th: PhaseThresholds,
): { peakIndex: number; troughIndex: number } | null {
  let best: { peakIndex: number; troughIndex: number; prominence: number } | null = null;

  for (let i = fromIndex + 1; i < toIndex - 1; i++) {
    const isLocalMax = series.vyMs[i] >= series.vyMs[i - 1] && series.vyMs[i] > series.vyMs[i + 1];
    if (!isLocalMax) continue;

    // How far does the curve fall after this peak before rising toward the
    // global one? That drop is the prominence.
    let troughIndex = i;
    let troughValue = series.vyMs[i];
    for (let j = i + 1; j <= toIndex; j++) {
      if (series.vyMs[j] < troughValue) {
        troughValue = series.vyMs[j];
        troughIndex = j;
      }
    }
    const prominence = series.vyMs[i] - troughValue;
    if (prominence < th.minProminenceMs) continue;
    // Earliest qualifying peak wins: the first pull is the first one.
    best = { peakIndex: i, troughIndex, prominence };
    break;
  }

  return best ? { peakIndex: best.peakIndex, troughIndex: best.troughIndex } : null;
}

/**
 * First time after the catch that the bar has actually stopped.
 *
 * The obvious rule — "first frame after the apex where |v| is small" — fires on
 * the apex itself, because the apex IS where velocity crosses zero. That
 * collapses the catch to nothing, which is exactly what it did before this
 * comment existed. So the search steps past the descent first: find the most
 * negative velocity after the apex (the bar dropping into the receiving
 * position), and only then look for the bar coming to rest.
 *
 * Null when the bar never settles inside the clip — footage cut at the catch,
 * which is common. The caller falls back to the end of the clip and marks the
 * edge as a guess.
 */
function findSettle(series: KinematicSeries, apexIndex: number, th: PhaseThresholds): number | null {
  let dropIndex = apexIndex;
  let dropValue = 0;
  for (let i = apexIndex; i < series.vyMs.length; i++) {
    if (series.vyMs[i] < dropValue) {
      dropValue = series.vyMs[i];
      dropIndex = i;
    }
  }
  // No descent at all: the clip ends at the apex, so there is nothing to find.
  if (dropValue > -th.settleMs) return null;

  for (let i = dropIndex; i < series.vyMs.length; i++) {
    if (Math.abs(series.vyMs[i]) < th.settleMs) return series.t[i];
  }
  return null;
}

// ── Proposal ────────────────────────────────────────────────────────────────

/**
 * Propose the boundaries of a phase set over a computed series.
 *
 * Returns one boundary per phase plus a closing one. Where a signature is not
 * present the boundary is still produced — placed proportionally through the
 * interval it belongs in — but marked `fallback`, so the interface can ask the
 * coach to look rather than presenting a guess as a measurement.
 */
export function proposePhases(
  series: KinematicSeries,
  phaseSet: readonly PhaseDefinition[] = DEFAULT_PHASE_SET,
  thresholds: PhaseThresholds = DEFAULT_PHASE_THRESHOLDS,
  endRule: BoundaryRuleId = DEFAULT_PHASE_END_RULE,
): PhaseProposal {
  const n = series.t.length;
  if (n < 4 || phaseSet.length === 0) {
    return { boundaries: [], fullyDetected: false };
  }

  const firstT = series.t[0];
  const lastT = series.t[n - 1];

  const liftoffT = findLiftoff(series, thresholds);
  const peakIdx = peakVelocityIndex(series);
  const apexIdx = apexIndex(series);
  const peakT = series.t[peakIdx];
  const apexT = series.t[Math.max(apexIdx, peakIdx)];

  const liftoffIdx = liftoffT === null ? 0 : series.t.findIndex(t => t >= liftoffT);
  const dip = findFirstVelocityPeak(series, Math.max(0, liftoffIdx), peakIdx, thresholds);
  const settleT = findSettle(series, Math.max(apexIdx, peakIdx), thresholds);

  const detected: Partial<Record<BoundaryRuleId, number>> = {
    'start-of-clip': firstT,
    'end-of-clip': lastT,
    liftoff: liftoffT ?? undefined,
    'peak-velocity': peakT,
    apex: apexT,
    'first-velocity-peak': dip ? series.t[dip.peakIndex] : undefined,
    'velocity-trough': dip ? series.t[dip.troughIndex] : undefined,
    settle: settleT ?? undefined,
  };

  // Fallback anchors, in rule order, so a missing boundary can be placed
  // between the ones either side of it rather than at an arbitrary time.
  const startFallback = liftoffT ?? firstT;
  const fallbacks: Partial<Record<BoundaryRuleId, number>> = {
    liftoff: startFallback,
    // No dip found: split the run-up to peak velocity at 55 % and 72 %, which
    // is roughly where a textbook pull puts them. Explicitly a guess.
    'first-velocity-peak': startFallback + (peakT - startFallback) * 0.55,
    'velocity-trough': startFallback + (peakT - startFallback) * 0.72,
    'peak-velocity': peakT,
    apex: apexT,
    settle: lastT,
  };

  const boundaries: PhaseBoundary[] = [];
  let fullyDetected = true;

  for (const phase of phaseSet) {
    const value = detected[phase.startRule];
    if (value !== undefined) {
      boundaries.push({ phaseId: phase.id, t: value, rule: phase.startRule, source: 'detected' });
    } else {
      fullyDetected = false;
      boundaries.push({
        phaseId: phase.id,
        t: fallbacks[phase.startRule] ?? firstT,
        rule: phase.startRule,
        source: 'fallback',
      });
    }
  }

  const endValue = detected[endRule];
  if (endValue === undefined) fullyDetected = false;
  boundaries.push({
    phaseId: null,
    t: endValue ?? fallbacks[endRule] ?? lastT,
    rule: endRule,
    source: endValue === undefined ? 'fallback' : 'detected',
  });

  return { boundaries: enforceMonotonic(boundaries, firstT, lastT), fullyDetected };
}

/**
 * Keep boundaries in order and inside the clip.
 *
 * A detector can propose a trough before the peak that precedes it when the
 * curve is odd, and a coach can drag one edge past another. Rather than
 * refusing, boundaries are clamped forward: a phase may collapse to zero
 * length, which reads honestly as "nothing here", where a crossed pair would
 * produce negative durations everywhere downstream.
 */
export function enforceMonotonic(
  boundaries: readonly PhaseBoundary[],
  minT: number,
  maxT: number,
): PhaseBoundary[] {
  const out: PhaseBoundary[] = [];
  let floor = minT;
  for (const b of boundaries) {
    const t = Math.min(maxT, Math.max(floor, b.t));
    out.push({ ...b, t });
    floor = t;
  }
  return out;
}

/** Turn boundaries into spans a timeline can draw. */
export function spansFrom(
  boundaries: readonly PhaseBoundary[],
  phaseSet: readonly PhaseDefinition[] = DEFAULT_PHASE_SET,
): PhaseSpan[] {
  const byId = new Map(phaseSet.map(p => [p.id, p]));
  const spans: PhaseSpan[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const definition = boundaries[i].phaseId ? byId.get(boundaries[i].phaseId!) : undefined;
    if (!definition) continue;
    const a = boundaries[i].source;
    const b = boundaries[i + 1].source;
    spans.push({
      definition,
      fromT: boundaries[i].t,
      toT: boundaries[i + 1].t,
      // A span inherits the vaguer of its two edges.
      source: a === 'fallback' || b === 'fallback' ? 'fallback' : a === 'coach' || b === 'coach' ? 'coach' : 'detected',
    });
  }
  return spans;
}

/** Per-phase and whole-lift metrics over a computed series. */
export function computeLiftMetrics(
  series: KinematicSeries,
  spans: readonly PhaseSpan[],
): LiftMetrics {
  const phases: PhaseMetrics[] = spans.map(span => {
    const peak = peakOver(series.t, series.vyMs, span.fromT, span.toT);
    const startY = valueAt(series.t, series.yCm, span.fromT);
    const endY = valueAt(series.t, series.yCm, span.toT);
    const peakPower = series.powerW
      ? peakOver(series.t, series.powerW, span.fromT, span.toT)
      : null;
    return {
      phaseId: span.definition.id,
      label: span.definition.label,
      durationS: Math.max(0, span.toT - span.fromT),
      meanVelocityMs: meanOver(series.t, series.vyMs, span.fromT, span.toT),
      peakVelocityMs: peak?.value ?? null,
      peakVelocityT: peak?.t ?? null,
      heightGainedCm: endY !== null && startY !== null ? endY - startY : 0,
      peakPowerW: peakPower?.value ?? null,
    };
  });

  const overallPeak = peakOver(series.t, series.vyMs, series.t[0], series.t[series.t.length - 1]);
  const overallPower = series.powerW
    ? peakOver(series.t, series.powerW, series.t[0], series.t[series.t.length - 1])
    : null;

  // The transition dip: the first pull's peak minus the lowest velocity reached
  // before the second pull gets going. Computed from the spans rather than
  // re-detected, so a coach who moved an edge sees the number move with it.
  const firstPull = phases[0];
  const transition = phases[1];
  const transitionVelocityLossMs =
    firstPull?.peakVelocityMs != null && transition
      ? firstPull.peakVelocityMs -
        (minOver(series.t, series.vyMs, transition.durationS > 0 ? spans[1].fromT : 0, spans[1]?.toT ?? 0) ??
          firstPull.peakVelocityMs)
      : null;

  const turnover = phases.find(p => p.phaseId === 'turnover') ?? phases[3] ?? null;

  return {
    phases,
    peakVelocityMs: overallPeak?.value ?? null,
    transitionVelocityLossMs,
    turnoverVelocityMs: turnover?.meanVelocityMs ?? null,
    peakPowerW: overallPower?.value ?? null,
  };
}

/** Minimum of a series over a closed window. */
function minOver(
  t: readonly number[],
  values: readonly number[],
  fromT: number,
  toT: number,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < fromT || t[i] > toT) continue;
    if (best === null || values[i] < best) best = values[i];
  }
  return best;
}

/** Linear read of a series at an arbitrary time. */
export function valueAt(
  t: readonly number[],
  values: readonly number[],
  at: number,
): number | null {
  const n = t.length;
  if (n === 0) return null;
  if (at <= t[0]) return values[0];
  if (at >= t[n - 1]) return values[n - 1];
  for (let i = 1; i < n; i++) {
    if (t[i] >= at) {
      const span = t[i] - t[i - 1];
      const frac = span > 0 ? (at - t[i - 1]) / span : 0;
      return values[i - 1] + (values[i] - values[i - 1]) * frac;
    }
  }
  return values[n - 1];
}
