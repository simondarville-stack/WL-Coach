/**
 * Condense a run of (load, reps) work into the planner's `load×reps×sets`
 * notation — the textual form of the Stacked Load Notation.
 *
 * Used by the exercise load-history chart's hover card so a point shows not
 * just "100 kg" but the reps that load was actually moved for.
 *
 * Display rule matches the prescription grammar (CLAUDE.md): sets = 1 is
 * implied and never rendered.
 */

/** One load×reps×sets group, in the order written / lifted. */
export interface LoadRepsGroup {
  load: number;
  reps: number;
  sets: number;
}

/**
 * Collapse consecutive equal (load, reps) pairs into one group. Performed sets
 * arrive one row per set, so 80×3, 80×3, 85×2 reads as "80×3×2, 85×2".
 * Non-positive loads or reps are dropped — a set with no load carries no
 * information for a load chart.
 */
export function groupLoadReps(entries: Array<{ load: number; reps: number }>): LoadRepsGroup[] {
  const out: LoadRepsGroup[] = [];
  for (const e of entries) {
    if (e.load <= 0 || e.reps <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.load === e.load && last.reps === e.reps) last.sets += 1;
    else out.push({ load: e.load, reps: e.reps, sets: 1 });
  }
  return out;
}

/** German-locale numeric convention: comma decimals, no trailing ",0". */
export function formatKg(v: number): string {
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

/** "80×3, 85×2×3" — null when there is nothing to show. */
export function formatLoadReps(groups: LoadRepsGroup[]): string | null {
  if (groups.length === 0) return null;
  return groups
    .map(g => `${formatKg(g.load)}×${g.reps}${g.sets > 1 ? `×${g.sets}` : ''}`)
    .join(', ');
}

/** Merge two detail strings coming from different days of the same week. */
export function joinLoadRepsDetails(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return `${a} · ${b}`;
}
