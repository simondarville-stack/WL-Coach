// Combo expansion — single source of truth for "a combo is only a wrapper".
//
// A combo planned_exercise bundles several member lifts under one lead, but for
// counting (reps / sets / tonnage / category / per-exercise stress & PRs) each
// member is its own instance. This module turns a planned row into the list of
// counted contributions every counter should aggregate:
//   - a normal exercise  → exactly itself
//   - a combo            → one contribution per member, with that member's reps
//
// The per-member rep split lives only in the prescription ("80×1+2×3" → the
// reps tuple "1+2"), decoded positionally against the members ordered by
// position. We reuse parseComboPrescription so this stays consistent with how
// the combo's own summary cache is computed in useWeekPlans.

import { parseComboPrescription, computePrescriptionSummary } from './prescriptionParser';

// Generic over the exercise shape so callers that only load a subset of
// Exercise columns (e.g. the week-overview hook) can still use it.
export interface CountedContribution<E> {
  exercise_id: string;
  exercise: E;
  unit: string | null;
  summary_total_sets: number;
  summary_total_reps: number;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
}

interface CountableRow<E> {
  exercise_id: string;
  exercise: E;
  unit: string | null;
  is_combo: boolean;
  prescription_raw: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
}

interface MemberRef<E> {
  exerciseId: string;
  exercise: E;
  position: number;
}

function lump<E>(row: CountableRow<E>): CountedContribution<E> {
  return {
    exercise_id: row.exercise_id,
    exercise: row.exercise,
    unit: row.unit,
    summary_total_sets: row.summary_total_sets ?? 0,
    summary_total_reps: row.summary_total_reps ?? 0,
    summary_highest_load: row.summary_highest_load,
    summary_avg_load: row.summary_avg_load,
  };
}

/**
 * Expand a planned row into the contributions that should be counted.
 * Non-combo → [self]. Combo → one per performed member.
 *
 * Falls back to a single lump under the combo's lead whenever the members or a
 * parseable prescription are unavailable, so a combo's work is never silently
 * dropped.
 */
export function expandForCounting<E extends { counts_towards_totals?: boolean | null }>(
  row: CountableRow<E>,
  members: MemberRef<E>[] | undefined,
): CountedContribution<E>[] {
  if (!row.is_combo) {
    // Trust the cached summary, but if it is empty fall back to a live parse of
    // the prescription. A stale/zero cache (e.g. a row whose summary was never
    // recomputed) would otherwise silently drop a fully-prescribed exercise
    // from the totals even though its prescription renders correctly.
    const cachedReps = row.summary_total_reps ?? 0;
    const cachedSets = row.summary_total_sets ?? 0;
    if (cachedReps === 0 && cachedSets === 0 && row.prescription_raw) {
      const s = computePrescriptionSummary(row.prescription_raw, row.unit, false);
      if (s.total_reps > 0 || s.total_sets > 0) {
        return [{
          exercise_id: row.exercise_id,
          exercise: row.exercise,
          unit: row.unit,
          summary_total_sets: s.total_sets,
          summary_total_reps: s.total_reps,
          summary_highest_load: s.highest_load,
          summary_avg_load: s.avg_load,
        }];
      }
    }
    return [lump(row)];
  }

  const ordered = (members ?? []).slice().sort((a, b) => a.position - b.position);
  const lines = parseComboPrescription(row.prescription_raw ?? '');
  if (ordered.length === 0 || lines.length === 0) return [lump(row)];

  const parsed = lines.map(l => ({
    sets: l.sets,
    multiplier: l.multiplier ?? 1,   // "m(a+b)" ⇒ m rounds of the tuple per set
    parts: l.repsText.split('+').map(p => parseInt(p, 10) || 0),
    load: l.load,
    loadMax: l.loadMax,
  }));

  const out: CountedContribution<E>[] = [];
  ordered.forEach((m, i) => {
    let reps = 0, weighted = 0;
    let highest: number | null = null;
    for (const ln of parsed) {
      const part = ln.parts[i] ?? 0;
      if (part <= 0) continue;            // member not performed in this line
      // Reps scale by the round multiplier (m rounds per set); the set/round
      // count below does NOT — a set stays a set regardless of m (Option A).
      const lineReps = part * ln.sets * ln.multiplier;
      reps += lineReps;
      const eff = ln.loadMax != null ? (ln.load + ln.loadMax) / 2 : ln.load;
      weighted += eff * lineReps;
      const hi = ln.loadMax ?? ln.load;
      if (highest === null || hi > highest) highest = hi;
    }
    if (reps === 0) return;               // member not performed
    out.push({
      exercise_id: m.exerciseId,
      exercise: m.exercise,
      unit: row.unit,
      summary_total_sets: 0,              // a set is a set — assigned once below
      summary_total_reps: reps,
      summary_highest_load: highest,
      summary_avg_load: reps > 0 ? weighted / reps : null,
    });
  });

  if (out.length === 0) return [lump(row)];

  // "A set is a set": a combo round is one set whether it is "power snatch +
  // snatch" or "2 reps of snatch", so the combo's rounds count once — not once
  // per member. Reps stay split per member; the set count is attributed to the
  // first member that counts towards totals (so the set survives even when the
  // lead movement is a non-counting one), leaving the others at 0 sets.
  const totalRounds = parsed.reduce((s, ln) => s + ln.sets, 0);
  const setHolder = out.find(c => c.exercise.counts_towards_totals !== false) ?? out[0];
  setHolder.summary_total_sets = totalRounds;

  return out;
}
