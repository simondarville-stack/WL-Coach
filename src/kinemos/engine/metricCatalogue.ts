/**
 * metricCatalogue — the one list of what KinEMOS measures.
 *
 * Three surfaces read the same numbers: the metrics panel in the viewer, the
 * delta table in a comparison, and a trend view over a season. Until this file
 * each carried its own idea of which metrics exist, what they are called and
 * which way is up — three lists that drift is CLAUDE.md core principle 3's
 * failure mode. So the catalogue is data: an ordered list of definitions, each
 * with a reader that pulls its value out of a computed lift, and the surfaces
 * map over it.
 *
 * The catalogue also fixes the STORED shape. `kinemos_analyses.metrics` is a
 * cache of what the engine derived (migration 20260902090000): the viewer
 * writes it on every save and a trend view reads a season of it without
 * re-running the pipeline. Two rules make that safe:
 *
 *   - **The cache carries a schema number.** A reader that meets a row written
 *     under an older schema knows to treat its values as older, and can say
 *     so, rather than silently mixing definitions across a trend line.
 *   - **A missing part is null, never zero.** The rep summary was not cached
 *     before schema 1, so an older row simply has no peak height; the reader
 *     returns null and the chart leaves a gap.
 *
 * Engine purity: types and pure functions only.
 */
import type { RepSummary } from './kinematics';
import type { AnalyzerMetrics, LiftMetrics } from './phases';

/** Which way is up, for a given metric. Null where it genuinely depends on the
 *  lifter and the interface must not pass judgement. */
export type BetterWhen = 'higher' | 'lower' | null;

/** A computed lift, as the catalogue's readers see it. The summary is optional
 *  because a cached row from before schema 1 does not carry one. */
export interface ComputedLift {
  metrics: LiftMetrics;
  summary: RepSummary | null;
}

export interface MetricDefinition {
  id: string;
  label: string;
  unit: string;
  decimals: number;
  betterWhen: BetterWhen;
  /** Why this metric is worth looking at at all — the tooltip on every surface. */
  why: string;
  /** Pull the value out of a computed lift. Null when it is not there. */
  read: (lift: ComputedLift) => number | null;
  /**
   * Below this, a difference between two lifts is inside the noise of an
   * everyday analysis and is reported as "the same" rather than as a change.
   * COACH-CONFIG in spirit — a hardcore-tier setup could tighten them.
   */
  significant: number;
}

function phase(m: LiftMetrics, id: string) {
  return m.phases.find(p => p.phaseId === id) ?? null;
}

/**
 * The catalogue, in the order the surfaces list it: the headline first, then
 * the pull phase by phase, then shape, then the mass-dependent number, then
 * context.
 */
export const METRIC_CATALOGUE: readonly MetricDefinition[] = [
  {
    id: 'peakVelocity',
    label: 'Peak velocity',
    unit: 'm/s',
    decimals: 2,
    betterWhen: 'higher',
    why: 'The headline number, and the one that decides whether a heavy attempt gets overhead.',
    read: l => l.metrics.peakVelocityMs,
    significant: 0.03,
  },
  {
    id: 'firstPull',
    label: 'First pull',
    unit: 'm/s',
    decimals: 2,
    // Faster off the floor is not automatically better — many coaches teach a
    // patient first pull precisely so the second can be faster.
    betterWhen: null,
    why: 'How fast the bar left the floor. Faster is not automatically better: a patient first pull is a coaching choice.',
    read: l => phase(l.metrics, 'first_pull')?.peakVelocityMs ?? null,
    significant: 0.03,
  },
  {
    id: 'secondPull',
    label: 'Second pull',
    unit: 'm/s',
    decimals: 2,
    betterWhen: 'higher',
    why: 'The extension. This is where a missed lift is usually lost.',
    read: l => phase(l.metrics, 'second_pull')?.peakVelocityMs ?? null,
    significant: 0.03,
  },
  {
    id: 'transitionLoss',
    label: 'Loss 1st → 2nd',
    unit: 'm/s',
    decimals: 2,
    betterWhen: 'lower',
    why: 'How much speed the bar gave up through the transition. Less is generally better, though some dip is normal.',
    read: l => l.metrics.transitionVelocityLossMs,
    significant: 0.03,
  },
  {
    id: 'turnover',
    label: 'Turnover',
    unit: 'm/s',
    decimals: 2,
    betterWhen: 'higher',
    why: 'Mean upward velocity while the bar is being pulled under.',
    read: l => l.metrics.turnoverVelocityMs,
    significant: 0.03,
  },
  {
    id: 'peakHeight',
    label: 'Peak height',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'How high the bar got above its start. Higher costs energy; whether it is better depends on whether the lift was made.',
    read: l => l.summary?.peakHeightCm ?? null,
    significant: 1,
  },
  {
    id: 'loopWidth',
    label: 'Loop width',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'Total horizontal spread of the path. A tighter path is not universally better — the loop is how the bar gets past the knees.',
    read: l => l.summary?.loopWidthCm ?? null,
    significant: 1,
  },
  {
    id: 'peakPower',
    label: 'Peak power',
    unit: 'W',
    decimals: 0,
    betterWhen: 'higher',
    why: 'Barbell power at its peak. Only comparable when both lifts carry a mass and the masses are close — a heavier bar moving slower can out-power a lighter bar moving faster, which says nothing about the lifter.',
    read: l => l.metrics.peakPowerW,
    significant: 40,
  },
  {
    id: 'duration',
    label: 'Pull duration',
    unit: 's',
    decimals: 2,
    betterWhen: null,
    why: 'Time from the first marked frame to the last. Sensitive to how each clip was marked, so read it as context rather than as a result.',
    read: l => l.summary?.durationS ?? null,
    significant: 0.05,
  },

  // ── The German Weightlifting Analyzer's measures (phases.ts AnalyzerMetrics) ──
  {
    id: 'v2',
    label: 'Knee passing (V2)',
    unit: 'm/s',
    decimals: 2,
    betterWhen: null,
    why: 'The slowest the bar gets through the transition. With V1 it says how much the double knee bend costs; on its own it is a matter of style.',
    read: l => l.metrics.analyzer?.v2Ms ?? null,
    significant: 0.03,
  },
  {
    id: 'vmin',
    label: 'Drop under (Vmin)',
    unit: 'm/s',
    decimals: 2,
    betterWhen: null,
    why: 'The fastest the bar comes down into the catch. Negative by definition.',
    read: l => l.metrics.analyzer?.vminMs ?? null,
    significant: 0.05,
  },
  {
    id: 'tTurn',
    label: 'Turnover time (t_turn)',
    unit: 's',
    decimals: 2,
    betterWhen: 'lower',
    why: 'From Vmax to Vmin: how quickly the lifter gets under the bar. Käks ranked it third, after Vmax and the path.',
    read: l => l.metrics.analyzer?.tTurnS ?? null,
    significant: 0.02,
  },
  {
    id: 'sVmax',
    label: 'Height at Vmax (S_vmax)',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'Where in the pull the bar was fastest, above its start.',
    read: l => l.metrics.analyzer?.sVmaxCm ?? null,
    significant: 1,
  },
  {
    id: 'sFly',
    label: 'Flight (S_fly)',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'How far the bar keeps rising after peak velocity, to the top of its flight.',
    read: l => l.metrics.analyzer?.sFlyCm ?? null,
    significant: 1,
  },
  {
    id: 'sRemain',
    label: 'Beyond ballistic (S_remain)',
    unit: '%',
    decimals: 1,
    betterWhen: null,
    why: 'Share of the flight height the impulse alone (Vmax²/2g) does not explain — what the arms and the pull-under added.',
    read: l => l.metrics.analyzer?.sRemainPct ?? null,
    significant: 1,
  },
  {
    id: 'sSit',
    label: 'Catch height (S_sit)',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'The bar at the deepest point of the catch, above its start. Anthropometry as much as technique.',
    read: l => l.metrics.analyzer?.sSitCm ?? null,
    significant: 1,
  },
  {
    id: 'sFall',
    label: 'Fall to catch (S_fall)',
    unit: 'cm',
    decimals: 1,
    betterWhen: null,
    why: 'From the top of the flight down to the catch.',
    read: l => l.metrics.analyzer?.sFallCm ?? null,
    significant: 1,
  },
  {
    id: 'f1',
    label: 'Force, first pull (F1)',
    unit: '%',
    decimals: 0,
    betterWhen: null,
    why: 'Peak vertical force on the bar in the first pull, as a share of the load. 100 % holds the bar still.',
    read: l => l.metrics.analyzer?.f1Pct ?? null,
    significant: 5,
  },
  {
    id: 'f2',
    label: 'Force, knee (F2)',
    unit: '%',
    decimals: 0,
    betterWhen: null,
    why: 'Lowest vertical force through the transition. Below 100 % the bar is slowing.',
    read: l => l.metrics.analyzer?.f2Pct ?? null,
    significant: 5,
  },
  {
    id: 'f3',
    label: 'Force, second pull (F3)',
    unit: '%',
    decimals: 0,
    betterWhen: 'higher',
    why: 'Peak vertical force on the bar in the second pull, as a share of the load.',
    read: l => l.metrics.analyzer?.f3Pct ?? null,
    significant: 5,
  },
  {
    id: 'fbr',
    label: 'Force, catch (Fbr)',
    unit: '%',
    decimals: 0,
    betterWhen: null,
    why: 'Peak vertical force braking the bar in the catch, as a share of the load.',
    read: l => l.metrics.analyzer?.fbrPct ?? null,
    significant: 10,
  },
];

export function metricById(id: string): MetricDefinition | null {
  return METRIC_CATALOGUE.find(m => m.id === id) ?? null;
}

// ── The stored shape ────────────────────────────────────────────────────────

/**
 * Schema of the `metrics` cache column. Bump it when what is stored changes
 * meaning — a new filter default, a redefined phase rule — so a trend view can
 * tell a season's worth of rows apart rather than drawing one line through two
 * definitions.
 *
 *   0 — implicit: rows written before this constant existed hold a bare
 *       `LiftMetrics` and no summary.
 *   1 — `LiftMetrics` plus the rep summary, under this key.
 *   2 — plus the `analyzer` block (phases.ts `AnalyzerMetrics`).
 */
export const STORED_METRICS_SCHEMA = 2;

export interface StoredMetrics extends LiftMetrics {
  schema: number;
  summary: RepSummary | null;
}

/** What the viewer writes into the cache column. */
export function toStoredMetrics(metrics: LiftMetrics, summary: RepSummary | null): StoredMetrics {
  return { ...metrics, schema: STORED_METRICS_SCHEMA, summary };
}

/**
 * Read the cache column back, whatever schema it was written under.
 *
 * Deliberately lenient about shape and strict about numbers: a row is accepted
 * if it has the phase list and the headline field, and anything that is not a
 * finite number reads as null — a JSON `null`, a string a numeric column
 * produced, or a field that did not exist yet.
 */
export function fromStoredMetrics(raw: unknown): StoredMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.phases) || !('peakVelocityMs' in r)) return null;

  const phases = r.phases
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map(p => ({
      phaseId: String(p.phaseId ?? ''),
      label: String(p.label ?? ''),
      durationS: numberOr(p.durationS, 0),
      meanVelocityMs: numberOrNull(p.meanVelocityMs),
      peakVelocityMs: numberOrNull(p.peakVelocityMs),
      peakVelocityT: numberOrNull(p.peakVelocityT),
      heightGainedCm: numberOr(p.heightGainedCm, 0),
      peakPowerW: numberOrNull(p.peakPowerW),
    }));

  const s = r.summary && typeof r.summary === 'object' ? (r.summary as Record<string, unknown>) : null;
  const summary: RepSummary | null =
    s && typeof s.durationS === 'number'
      ? {
          durationS: numberOr(s.durationS, 0),
          peakVerticalVelocityMs: numberOr(s.peakVerticalVelocityMs, 0),
          peakVerticalVelocityT: numberOr(s.peakVerticalVelocityT, 0),
          peakSpeedMs: numberOr(s.peakSpeedMs, 0),
          peakHeightCm: numberOr(s.peakHeightCm, 0),
          apexT: numberOr(s.apexT, 0),
          loopWidthCm: numberOr(s.loopWidthCm, 0),
          peakPowerW: numberOrNull(s.peakPowerW),
          peakPowerT: numberOrNull(s.peakPowerT),
          meanPropulsivePowerW: numberOrNull(s.meanPropulsivePowerW),
        }
      : null;

  // The analyzer block arrived with schema 2; an older row simply has none of
  // its numbers, and says so with nulls rather than zeros.
  const a = r.analyzer && typeof r.analyzer === 'object' ? (r.analyzer as Record<string, unknown>) : {};
  const analyzer: AnalyzerMetrics = {
    v1Ms: numberOrNull(a.v1Ms),
    v2Ms: numberOrNull(a.v2Ms),
    vmaxMs: numberOrNull(a.vmaxMs),
    vminMs: numberOrNull(a.vminMs),
    tTurnS: numberOrNull(a.tTurnS),
    sVmaxCm: numberOrNull(a.sVmaxCm),
    sMaxCm: numberOrNull(a.sMaxCm),
    sFlyCm: numberOrNull(a.sFlyCm),
    sRemainCm: numberOrNull(a.sRemainCm),
    sRemainPct: numberOrNull(a.sRemainPct),
    sSitCm: numberOrNull(a.sSitCm),
    sFallCm: numberOrNull(a.sFallCm),
    f1Pct: numberOrNull(a.f1Pct),
    f2Pct: numberOrNull(a.f2Pct),
    f3Pct: numberOrNull(a.f3Pct),
    fbrPct: numberOrNull(a.fbrPct),
    pskNs: numberOrNull(a.pskNs),
  };

  return {
    schema: numberOr(r.schema, 0),
    phases,
    peakVelocityMs: numberOrNull(r.peakVelocityMs),
    transitionVelocityLossMs: numberOrNull(r.transitionVelocityLossMs),
    turnoverVelocityMs: numberOrNull(r.turnoverVelocityMs),
    peakPowerW: numberOrNull(r.peakPowerW),
    analyzer,
    summary,
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}
