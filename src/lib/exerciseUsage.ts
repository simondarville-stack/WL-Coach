/**
 * exerciseUsage — turning raw usage counts into what the tree renders.
 *
 * The catalogue says what a coach HAS; usage says what they still USE. Two
 * counts are kept apart on purpose:
 *
 *   planned — how often the exercise is prescribed (vocabulary in use).
 *   logged  — how often athletes recorded it, off-plan work included.
 *
 * "planned 0, logged > 0" is the row a coach must NOT prune: the athletes do
 * it, it just never gets written into a programme. Collapsing the two into
 * one number would hide exactly that case.
 *
 * Counts roll up the family (an exercise plus every descendant) because that
 * is how the tree reads: a parent's number answers "is this branch alive?",
 * a leaf's answers "is this variation alive?". Rollup mirrors the analysis
 * family rollup (src/lib/exerciseHierarchy.ts) so the two never disagree.
 */
import { buildChildrenIndex, getDescendantIds, type HierNode } from './exerciseHierarchy';

export interface UsageCounts {
  planned: number;
  logged: number;
}

export interface UsageRollup {
  /** This exercise alone. */
  own: UsageCounts;
  /** This exercise plus every descendant variation. */
  family: UsageCounts;
}

export const ZERO_USAGE: UsageRollup = {
  own: { planned: 0, logged: 0 },
  family: { planned: 0, logged: 0 },
};

/** Window options offered in the toolbar. Weeks, because coaches think in
 *  weeks (a mesocycle is 4, a macro block ~12). */
export const USAGE_WINDOWS = [4, 12, 26, 52] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

/** ISO date (YYYY-MM-DD) `weeks` before today — the RPC's `p_since`. */
export function usageSinceDate(weeks: number, today = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-exercise own + family usage. `raw` holds only exercises with any usage
 * (the RPC omits the rest); everything missing counts as zero.
 */
export function rollUpUsage(
  exercises: HierNode[],
  raw: Map<string, UsageCounts>,
): Map<string, UsageRollup> {
  const childrenIndex = buildChildrenIndex(exercises);
  const out = new Map<string, UsageRollup>();
  for (const ex of exercises) {
    const own = raw.get(ex.id) ?? { planned: 0, logged: 0 };
    let planned = own.planned;
    let logged = own.logged;
    for (const descendantId of getDescendantIds(ex.id, childrenIndex)) {
      const d = raw.get(descendantId);
      if (d) { planned += d.planned; logged += d.logged; }
    }
    out.set(ex.id, { own, family: { planned, logged } });
  }
  return out;
}

/**
 * Background intensity for a usage cell, 0–1. Log-scaled: one exercise
 * prescribed 400× must not flatten everything else to invisible, which is
 * what a linear scale does on real catalogues (GPP dwarfs every lift).
 */
export function heatIntensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const scaled = Math.log1p(count) / Math.log1p(max);
  return Math.min(1, Math.max(0.12, scaled));
}

/** Tooltip text for one row's usage cell. */
export function describeUsage(rollup: UsageRollup, weeks: number): string {
  const { own, family } = rollup;
  const variations = family.planned - own.planned;
  const loggedVariations = family.logged - own.logged;
  const period = `in the last ${weeks} weeks`;
  if (family.planned === 0 && family.logged === 0) {
    return `Never planned or logged ${period} — a pruning candidate.`;
  }
  if (family.planned === 0) {
    return `Never planned ${period}, but logged ${family.logged}× — athletes do this off-plan, so keep it.`;
  }
  const plannedPart = variations > 0
    ? `Planned ${family.planned}× ${period} (this exercise ${own.planned}×, variations ${variations}×)`
    : `Planned ${family.planned}× ${period}`;
  const loggedPart = loggedVariations > 0
    ? `logged ${family.logged}× (this exercise ${own.logged}×)`
    : `logged ${family.logged}×`;
  return `${plannedPart} · ${loggedPart}.`;
}
