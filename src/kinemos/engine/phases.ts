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
  /** The transition found from acceleration rather than velocity: the bar
   *  did not slow through the knee, it only stopped speeding up. See
   *  `findUnweighting`. */
  | 'acceleration-peak'
  | 'acceleration-trough'
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
  /** When velocity shows no dip, the transition is looked for in
   *  acceleration: the bar stops speeding up through the knee and speeds up
   *  again in the second pull. How deep that acceleration trough must be,
   *  m/s², measured against the smaller of the two peaks around it. */
  minUnweightingMs2: number;
}

export const DEFAULT_PHASE_THRESHOLDS: PhaseThresholds = {
  liftoffMs: 0.1,
  liftoffHoldS: 0.05,
  minProminenceMs: 0.05,
  settleMs: 0.15,
  // 1 m/s² is about a tenth of gravity — a tenth of the load coming off the
  // bar through the knee. The first phone footage sat at 1,3–1,7.
  minUnweightingMs2: 1,
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

/**
 * The German Weightlifting Analyzer's measures for the snatch and clean
 * (BVDG teaching material; Jentsch & Lippmann 2009; Darville 2018 §3.1), in
 * EMOS units — m/s, cm, s, and force as a percentage of the load, the way
 * that material states it. Heights are above the bar's first mark, which for
 * a lift from the floor is the plate's radius above the platform; the
 * material's "from ground" figures are these plus 22,5 cm on a 45 cm plate.
 *
 * Forces need no mass: F/(m·g) = 1 + a/g, so they come from acceleration
 * alone and are comparable across bars. PSK, the one mass-dependent figure,
 * is load × Vmax — the material calls it power and gives it in N·s.
 *
 * Every field is null when the phase it is read from is not in the phase
 * set: the model needs first_pull, transition, second_pull and catch.
 */
export interface AnalyzerMetrics {
  /** Peak vertical velocity at the end of the first pull. */
  v1Ms: number | null;
  /** Minimum vertical velocity through the transition — the knee passing. */
  v2Ms: number | null;
  vmaxMs: number | null;
  /** The lowest (negative) vertical velocity after Vmax: the drop under. */
  vminMs: number | null;
  /** Time from Vmax to Vmin. Peter Käks' third measure: "the speed of the
   *  lifter and their technique". */
  tTurnS: number | null;
  /** Height of the bar at Vmax. */
  sVmaxCm: number | null;
  /** Top of the bar's flight — the apex before the catch. */
  sMaxCm: number | null;
  /** S_max − S_vmax: how far the bar rises after peak velocity. */
  sFlyCm: number | null;
  /** S_fly minus the ballistic rise Vmax²/2g: the height the arms and the
   *  pull-under added beyond what the impulse alone would give. */
  sRemainCm: number | null;
  /** The same as a share of S_max. */
  sRemainPct: number | null;
  /** Height of the bar at the deepest point of the catch. */
  sSitCm: number | null;
  /** S_max − S_sit: how far the bar fell into the catch. */
  sFallCm: number | null;
  /** Peak vertical force in the first pull, % of load. */
  f1Pct: number | null;
  /** Minimum vertical force through the transition, % of load. */
  f2Pct: number | null;
  /** Peak vertical force in the second pull, % of load. */
  f3Pct: number | null;
  /** Peak vertical force braking the bar in the catch, % of load. */
  fbrPct: number | null;
  /** Load × Vmax, N·s. Null without a mass. */
  pskNs: number | null;
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
  analyzer: AnalyzerMetrics;
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
 * The transition when velocity has no dip: the double knee bend as an
 * UNWEIGHTING. Many lifters — and most phone clips of them — show a shoulder
 * in the velocity curve rather than a trough: the bar keeps rising through
 * the knee, only slower. In acceleration that is unmistakable: a peak as the
 * first pull drives, a trough as the knees come under, a second, higher peak
 * as the hips open. The first pull ends at the first peak, the second pull
 * starts at the trough. Both peaks must stand `minUnweightingMs2` above the
 * trough, or it is a wiggle in the filter rather than a knee bend.
 */
function findUnweighting(
  series: KinematicSeries,
  fromIndex: number,
  toIndex: number,
  th: PhaseThresholds,
): { peakIndex: number; troughIndex: number } | null {
  const a = series.ayMs2;
  if (toIndex - fromIndex < 6) return null;
  // Walk the interval: candidate first peak, then the deepest trough after
  // it, then the highest rise after that trough. Earliest qualifying
  // arrangement wins. The walk starts a little BEFORE lift-off: lift-off is
  // where velocity crosses a threshold, and the first pull's drive — its
  // acceleration peak — is what gets it there, a few frames earlier.
  const lead = Math.ceil(0.2 / Math.max(series.dt, 1e-3));
  for (let i = Math.max(1, fromIndex - lead); i < toIndex - 1; i++) {
    if (!(a[i] > a[i - 1] && a[i] >= a[i + 1])) continue;
    let troughIndex = i;
    for (let j = i + 1; j < toIndex; j++) if (a[j] < a[troughIndex]) troughIndex = j;
    if (troughIndex === i) continue;
    let riseIndex = troughIndex;
    for (let j = troughIndex + 1; j <= toIndex; j++) if (a[j] > a[riseIndex]) riseIndex = j;
    const prominence = Math.min(a[i], a[riseIndex]) - a[troughIndex];
    if (prominence < th.minUnweightingMs2) continue;
    // The first pull does not end at its hardest drive — on a phone clip that
    // is the lift-off transient — but on the way into the trough, where the
    // drive has mostly let go: the last moment before the trough at which
    // the acceleration still stood a third of the way up its depth. That is
    // where V1, the velocity the first pull got the bar to, is read; for a
    // pull with no dip it sits a little under V2, as the BVDG material has it.
    const shoulder = a[troughIndex] + prominence * 0.3;
    let endIndex = troughIndex;
    while (endIndex > i && a[endIndex] < shoulder) endIndex--;
    return { peakIndex: endIndex, troughIndex };
  }
  return null;
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
  const velocityDip = findFirstVelocityPeak(series, Math.max(0, liftoffIdx), peakIdx, thresholds);
  const unweighting = velocityDip ? null : findUnweighting(series, Math.max(0, liftoffIdx), peakIdx, thresholds);
  const dip = velocityDip ?? unweighting;
  // When the transition came from acceleration, the boundaries say so.
  const via: Partial<Record<BoundaryRuleId, BoundaryRuleId>> = unweighting
    ? { 'first-velocity-peak': 'acceleration-peak', 'velocity-trough': 'acceleration-trough' }
    : {};
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
      boundaries.push({ phaseId: phase.id, t: value, rule: via[phase.startRule] ?? phase.startRule, source: 'detected' });
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
        (minOver(series.t, series.vyMs, transition.durationS > 0 ? spans[1].fromT : 0, spans[1]?.toT ?? 0)?.value ??
          firstPull.peakVelocityMs)
      : null;

  const turnover = phases.find(p => p.phaseId === 'turnover') ?? phases[3] ?? null;

  return {
    phases,
    peakVelocityMs: overallPeak?.value ?? null,
    transitionVelocityLossMs,
    turnoverVelocityMs: turnover?.meanVelocityMs ?? null,
    peakPowerW: overallPower?.value ?? null,
    analyzer: computeAnalyzerMetrics(series, spans),
  };
}

/** Standard gravity, for the ballistic rise in S_remain and for force as a
 *  share of load. Duplicated from kinematics.ts rather than imported, to keep
 *  this module free of a dependency it needs one number from. */
const G_MS2 = 9.80665;

/** The analyzer block with nothing in it — a lift the model could not read. */
export const EMPTY_ANALYZER_METRICS: AnalyzerMetrics = {
  v1Ms: null, v2Ms: null, vmaxMs: null, vminMs: null, tTurnS: null,
  sVmaxCm: null, sMaxCm: null, sFlyCm: null, sRemainCm: null, sRemainPct: null,
  sSitCm: null, sFallCm: null, f1Pct: null, f2Pct: null, f3Pct: null, fbrPct: null, pskNs: null,
};

/** See `AnalyzerMetrics`. */
/** Vertical force on the bar as a percentage of its weight, sample by sample:
 *  F/(m·g) = 1 + a/g. Needs no mass, so it is comparable across bars. */
export function forcePercentOf(series: KinematicSeries): number[] {
  return series.ayMs2.map(a => (1 + a / G_MS2) * 100);
}

/** One of the analyzer's landmarks: when it happens, the bar's vertical
 *  velocity there, and how high the bar is — so a chart in either domain can
 *  put the same dot in the same place. */
export interface AnalyzerEvent {
  t: number;
  valueMs: number;
  heightCm: number;
}

export interface AnalyzerEvents {
  /** Peak velocity of the first pull. */
  v1: AnalyzerEvent | null;
  /** Velocity where the second pull starts — the knee passing. */
  v2: AnalyzerEvent | null;
  vmax: AnalyzerEvent | null;
  /** The lowest velocity after Vmax: the drop under. */
  vmin: AnalyzerEvent | null;
  /** The top of the flight (S_max). */
  apex: AnalyzerEvent | null;
  /** The deepest point of the catch (S_sit). */
  sit: AnalyzerEvent | null;
}

/**
 * Where the analyzer's landmarks are. `computeAnalyzerMetrics` reads its
 * numbers off these; the charts draw them. One search, two consumers, so a
 * V2 shown on a curve is the V2 in the table.
 */
export function locateAnalyzerEvents(
  series: KinematicSeries,
  spans: readonly PhaseSpan[],
): AnalyzerEvents {
  const none: AnalyzerEvents = { v1: null, v2: null, vmax: null, vmin: null, apex: null, sit: null };
  const n = series.t.length;
  if (n < 2) return none;
  // A phase whose edge the engine only guessed at yields no analyzer number:
  // a V2 read over a transition that was not actually found is a number
  // about the fallback rule, not about the lift (P3 plan §2 decision 3). A
  // coach's edge counts; a detected one counts; a fallback does not.
  const spanOf = (id: string) => spans.find(s => s.definition.id === id && s.source !== 'fallback') ?? null;
  const tEnd = series.t[n - 1];
  const at = (t: number, valueMs: number): AnalyzerEvent => ({
    t,
    valueMs,
    heightCm: valueAt(series.t, series.yCm, t) ?? 0,
  });
  const firstPull = spanOf('first_pull');
  const transition = spanOf('transition');
  const catchSpan = spanOf('catch');

  // The pull, phase by phase. V2 is the velocity where the second pull
  // starts — the velocity trough when there is one, the knee passing when
  // the transition was read from acceleration and the velocity only
  // shouldered. The minimum over the span would be the same number in the
  // first case and the span's START in the second, which is V1 again.
  const v1 = firstPull ? peakOver(series.t, series.vyMs, firstPull.fromT, firstPull.toT) : null;
  const v2 = transition ? valueAt(series.t, series.vyMs, transition.toT) : null;
  const vmax = peakOver(series.t, series.vyMs, series.t[0], tEnd);

  // After Vmax: the flight to the apex, the drop under, the catch.
  let vmin: { value: number; t: number } | null = null;
  let apexT: number | null = catchSpan ? catchSpan.fromT : null;
  if (vmax) {
    for (let i = 0; i < n; i++) {
      if (series.t[i] < vmax.t) continue;
      if (!vmin || series.vyMs[i] < vmin.value) vmin = { value: series.vyMs[i], t: series.t[i] };
      // The apex, when no catch phase says where it is: the first moment
      // after Vmax that the bar stops rising.
      if (apexT === null && i > 0 && series.vyMs[i] <= 0 && series.t[i - 1] >= vmax.t) apexT = series.t[i];
    }
  }
  const sit = apexT !== null ? minOver(series.t, series.yCm, apexT, catchSpan ? catchSpan.toT : tEnd) : null;

  return {
    v1: v1 ? at(v1.t, v1.value) : null,
    v2: transition && v2 !== null ? at(transition.toT, v2) : null,
    vmax: vmax ? at(vmax.t, vmax.value) : null,
    vmin: vmin ? at(vmin.t, vmin.value) : null,
    apex: apexT !== null ? at(apexT, valueAt(series.t, series.vyMs, apexT) ?? 0) : null,
    sit: sit ? at(sit.t, valueAt(series.t, series.vyMs, sit.t) ?? 0) : null,
  };
}

/**
 * The bar passing a marked knee height on its way up: the first sample at or
 * above `kneeCm` before Vmax, and the velocity there. The analyzer's V1 and
 * V2 are defined around the knee; this is the check that the phase edges
 * the engine found are where the coach's eye says the knee is. Null when the
 * bar never gets that high before its peak — a hang lift above the knee, or
 * a mark on the wrong frame.
 */
export function kneeCrossing(
  series: KinematicSeries,
  kneeCm: number,
): { t: number; valueMs: number; heightCm: number } | null {
  const n = series.t.length;
  if (n < 2) return null;
  const vmax = peakOver(series.t, series.vyMs, series.t[0], series.t[n - 1]);
  if (!vmax) return null;
  for (let i = 1; i < n; i++) {
    if (series.t[i] > vmax.t) break;
    if (series.yCm[i] >= kneeCm && series.yCm[i - 1] < kneeCm) {
      // Interpolate the crossing between the two samples.
      const frac = (kneeCm - series.yCm[i - 1]) / (series.yCm[i] - series.yCm[i - 1] || 1);
      const t = series.t[i - 1] + (series.t[i] - series.t[i - 1]) * frac;
      return { t, valueMs: valueAt(series.t, series.vyMs, t) ?? series.vyMs[i], heightCm: kneeCm };
    }
  }
  return null;
}

export function computeAnalyzerMetrics(
  series: KinematicSeries,
  spans: readonly PhaseSpan[],
): AnalyzerMetrics {
  const empty = EMPTY_ANALYZER_METRICS;
  const n = series.t.length;
  if (n < 2) return empty;
  const spanOf = (id: string) => spans.find(s => s.definition.id === id && s.source !== 'fallback') ?? null;
  const tEnd = series.t[n - 1];
  const forcePct = forcePercentOf(series);
  const events = locateAnalyzerEvents(series, spans);
  const { v1, v2, vmax, vmin, apex, sit } = events;

  const firstPull = spanOf('first_pull');
  const transition = spanOf('transition');
  const secondPull = spanOf('second_pull');
  const catchSpan = spanOf('catch');

  const f1 = firstPull ? peakOver(series.t, forcePct, firstPull.fromT, firstPull.toT) : null;
  const f2 = transition ? minOver(series.t, forcePct, transition.fromT, transition.toT) : null;
  const f3 = secondPull ? peakOver(series.t, forcePct, secondPull.fromT, secondPull.toT) : null;

  const sVmax = vmax ? vmax.heightCm : null;
  const sMax = apex ? apex.heightCm : null;
  const sFly = sMax !== null && sVmax !== null ? sMax - sVmax : null;
  const ballisticCm = vmax ? ((vmax.valueMs * vmax.valueMs) / (2 * G_MS2)) * 100 : null;
  const sRemain = sFly !== null && ballisticCm !== null ? sFly - ballisticCm : null;
  const sSit = sit ? sit.heightCm : null;
  const fbr = apex ? peakOver(series.t, forcePct, apex.t, catchSpan ? catchSpan.toT : tEnd) : null;

  return {
    v1Ms: v1?.valueMs ?? null,
    v2Ms: v2?.valueMs ?? null,
    vmaxMs: vmax?.valueMs ?? null,
    vminMs: vmin?.valueMs ?? null,
    tTurnS: vmax && vmin ? vmin.t - vmax.t : null,
    sVmaxCm: sVmax,
    sMaxCm: sMax,
    sFlyCm: sFly,
    sRemainCm: sRemain,
    sRemainPct: sRemain !== null && sMax !== null && sMax > 0 ? (sRemain / sMax) * 100 : null,
    sSitCm: sSit,
    sFallCm: sMax !== null && sSit !== null ? sMax - sSit : null,
    f1Pct: f1?.value ?? null,
    f2Pct: f2?.value ?? null,
    f3Pct: f3?.value ?? null,
    fbrPct: fbr?.value ?? null,
    pskNs: series.massKg && vmax ? series.massKg * vmax.valueMs : null,
  };
}

/** Minimum of a series over a closed window, and when it occurs. */
function minOver(
  t: readonly number[],
  values: readonly number[],
  fromT: number,
  toT: number,
): { value: number; t: number } | null {
  let best: { value: number; t: number } | null = null;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < fromT || t[i] > toT) continue;
    if (best === null || values[i] < best.value) best = { value: values[i], t: t[i] };
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
