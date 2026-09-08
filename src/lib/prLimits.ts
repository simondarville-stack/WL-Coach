/**
 * prLimits — is a planned load beyond what the athlete has ever lifted?
 *
 * The planner marks a prescription line that would be a new PR, so a coach
 * sees at a glance where a week asks for more than the athlete has shown.
 * The comparison is per REP COUNT, not per 1RM: 3 × 100 is measured against
 * the athlete's 3RM, because 100 for a triple is a different feat from 100
 * for a single.
 *
 * Threshold at a rep count, in order:
 *   1. a real PR entry at that rep count (athlete_pr_history, newest wins);
 *   2. otherwise the same multi-anchor estimate the PR table shows as a
 *      phantom cell (`~95`), so a coach who has read the table is not
 *      surprised here;
 *   3. otherwise nothing — an exercise with no PR at all is never marked.
 *      Marking every line of an untracked lift would be noise, not signal.
 *
 * Percentage prescriptions resolve through the exercise's cached 1RM
 * (athlete_prs.pr_value_kg, the blended implied 1RM) before comparing, so
 * "3 × 95 %" is checked as kg against the 3RM like any other line.
 *
 * Pure: no React, no Supabase. Consumers build the limits once per athlete
 * and hand a resolver down to the surfaces that render prescriptions.
 */
import { estimateAtRepsFromAnchors, roundToHalf, type PRAnchor } from './xrmUtils';
import { parseComboPrescription, parsePrescription } from './prescriptionParser';
import type { AthletePR, AthletePRHistory } from './database.types';

/** What is known about one exercise's PRs, enough to judge any rep count. */
export interface PRLimit {
  /** Current real PR per rep count (1–10): the newest history entry. */
  real: ReadonlyMap<number, number>;
  /** The same entries as estimator anchors. */
  anchors: readonly PRAnchor[];
  /** Blended implied 1RM — what a percentage prescription is a percentage of. */
  oneRM: number | null;
  /** For the tooltip: which lift the limit belongs to. */
  name: string;
}

/** The limits a prescription is checked against: the row's own lift, and
 *  for a combo one limit per member position (null where unknown). */
export interface PRLimitSet {
  self: PRLimit | null;
  /** Combo members in position order. Absent or short → members unchecked. */
  members?: readonly (PRLimit | null)[];
}

/** One prescription line as the grid or the notation sees it. */
export interface PRCheckLine {
  load: number;
  loadMax?: number | null;
  /** Non-combo: rep count (the lower bound of a range). */
  reps?: number;
  /** Combo: the bare tuple, "2+1". */
  repsText?: string;
  /** Combo: rounds per set, "m(a+b)". */
  multiplier?: number | null;
  /** Free-text load (never a PR check). */
  loadText?: string;
}

export interface PRVerdict {
  /** The planned load, in kg. */
  loadKg: number;
  /** The rep count the load was checked at. */
  reps: number;
  /** What the athlete has shown (or is estimated) at that rep count. */
  thresholdKg: number;
  /** True when the threshold is a phantom estimate, not a real entry. */
  estimated: boolean;
  /** The lift whose PR was exceeded — matters for a combo. */
  name: string;
}

/**
 * Build one limit per exercise from the athlete's history and cached PRs.
 * History must be newest-first (achieved_date, created_at), the order the
 * PR table and `fetchPRHistory` already use, so the first entry per rep
 * count is the current PR.
 */
export function buildPRLimits(
  history: readonly AthletePRHistory[],
  prs: readonly AthletePR[],
  nameOf: (exerciseId: string) => string,
): Map<string, PRLimit> {
  const realById = new Map<string, Map<number, number>>();
  for (const h of history) {
    if (h.rep_count < 1 || h.value_kg <= 0) continue;
    let byRep = realById.get(h.exercise_id);
    if (!byRep) { byRep = new Map(); realById.set(h.exercise_id, byRep); }
    if (!byRep.has(h.rep_count)) byRep.set(h.rep_count, h.value_kg);
  }
  const oneRMById = new Map<string, number>();
  for (const pr of prs) if (pr.pr_value_kg && pr.pr_value_kg > 0) oneRMById.set(pr.exercise_id, pr.pr_value_kg);

  const ids = new Set<string>([...realById.keys(), ...oneRMById.keys()]);
  const out = new Map<string, PRLimit>();
  for (const id of ids) {
    const real = realById.get(id) ?? new Map<number, number>();
    const anchors: PRAnchor[] = Array.from(real, ([reps, valueKg]) => ({ reps, valueKg }));
    const cached = oneRMById.get(id) ?? null;
    // A cache row can lag a history edit by one sync; prefer it when present
    // (it is what % prescriptions resolve against everywhere else), fall back
    // to the anchors' own blend.
    const oneRM = cached ?? (anchors.length > 0 ? roundToHalf(estimateAtRepsFromAnchors(anchors, 1)) : null);
    out.set(id, { real, anchors, oneRM, name: nameOf(id) });
  }
  return out;
}

/** The athlete's best at `reps` — real if logged, else the table's phantom. */
export function prThresholdAt(limit: PRLimit, reps: number): { kg: number; estimated: boolean } | null {
  if (reps < 1) return null;
  const real = limit.real.get(reps);
  if (real != null) return { kg: real, estimated: false };
  if (limit.anchors.length === 0) return null;
  const est = estimateAtRepsFromAnchors([...limit.anchors], reps);
  return est > 0 ? { kg: roundToHalf(est), estimated: true } : null;
}

/** A load in the prescription's unit → kg, or null when it cannot be one. */
function loadToKg(load: number, unit: string | null, limit: PRLimit): number | null {
  if (!(load > 0)) return null;
  if (unit === 'absolute_kg' || unit == null) return load;
  if (unit === 'percentage') return limit.oneRM ? roundToHalf((load / 100) * limit.oneRM) : null;
  return null;
}

function judge(loadKg: number, reps: number, limit: PRLimit): PRVerdict | null {
  const threshold = prThresholdAt(limit, reps);
  if (!threshold) return null;
  // Strictly above: matching a PR is not a new one.
  if (loadKg <= threshold.kg) return null;
  return { loadKg, reps, thresholdKg: threshold.kg, estimated: threshold.estimated, name: limit.name };
}

/**
 * Judge one line. Returns the verdict for the first lift it exceeds a PR of,
 * or null when it stays inside what the athlete has shown.
 *
 * A load range is checked at its top — "80-90" plans for 90. A rep range is
 * checked at its bottom — "3-5" is at least a triple. A combo checks each
 * member at its own part of the tuple, scaled by the round multiplier: in
 * "1+2" at 100 the clean is checked as a single and the jerk as a double.
 */
export function checkLineBeyondPR(
  line: PRCheckLine,
  unit: string | null,
  isCombo: boolean,
  limits: PRLimitSet | null | undefined,
): PRVerdict | null {
  if (!limits) return null;
  if (unit === 'free_text_reps' || (line.loadText != null && !(line.load > 0))) return null;
  const load = line.loadMax ?? line.load;

  if (isCombo) {
    const parts = (line.repsText ?? '').split('+').map(p => parseInt(p, 10) || 0);
    const rounds = line.multiplier != null && line.multiplier > 0 ? line.multiplier : 1;
    const members = limits.members ?? [];
    for (let i = 0; i < parts.length; i++) {
      const limit = members[i];
      const reps = parts[i] * rounds;
      if (!limit || reps <= 0) continue;
      const kg = loadToKg(load, unit, limit);
      if (kg == null) continue;
      const v = judge(kg, reps, limit);
      if (v) return v;
    }
    return null;
  }

  const limit = limits.self;
  if (!limit || line.reps == null || line.reps <= 0) return null;
  const kg = loadToKg(load, unit, limit);
  if (kg == null) return null;
  return judge(kg, line.reps, limit);
}

/** Judge every line of a stored prescription, index-aligned to its lines. */
export function checkPrescriptionBeyondPR(
  raw: string | null,
  unit: string | null,
  isCombo: boolean,
  limits: PRLimitSet | null | undefined,
): (PRVerdict | null)[] {
  if (!raw || !limits) return [];
  if (isCombo) {
    return parseComboPrescription(raw).map(l => checkLineBeyondPR(
      { load: l.load, loadMax: l.loadMax, repsText: l.repsText, multiplier: l.multiplier, loadText: l.loadText },
      unit, true, limits,
    ));
  }
  if (unit === 'free_text_reps') return [];
  return parsePrescription(raw).map(l => checkLineBeyondPR(
    { load: l.load, loadMax: l.loadMax, reps: l.reps },
    unit, false, limits,
  ));
}

/** German-locale kg for a tooltip: 97.5 → "97,5". */
function kg(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

/** "Would be a new 3RM — Snatch: 100 kg above 97,5 kg" */
export function describePRVerdict(v: PRVerdict): string {
  const rm = `${v.reps}RM`;
  const shown = v.estimated ? `est. ${rm} ~${kg(v.thresholdKg)} kg` : `${rm} ${kg(v.thresholdKg)} kg`;
  return `Would be a new ${rm} — ${v.name}: ${kg(v.loadKg)} kg above ${shown}`;
}
