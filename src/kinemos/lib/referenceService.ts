/**
 * referenceService — which lift the others are judged against.
 *
 * Design §8 lists "versus a model lift" third among comparison needs, and the
 * P3 plan deferred it for want of a notion of a reference lift. This is that
 * notion at its smallest: the coach marks one analysed rep as the athlete's
 * reference for an exercise — their best snatch, the one that looked right —
 * and the comparison picker opens on it while the trend view draws it as a
 * line to read the others against.
 *
 * One reference per (athlete, exercise). The database cannot say so, because
 * an analysis carries no athlete or exercise of its own (it names its clip;
 * the athlete lives on the library row), so the rule is kept here: setting a
 * reference clears the previous holder, found through the adapter's join.
 */
import { loadKinemosLiftRecords, type KinemosLiftRecord } from './analysisAdapter';
import { saveAnalysisState } from './analysisService';

/** The reference among a set of records for an exercise, or null. */
export function referenceOf(
  records: readonly KinemosLiftRecord[],
  exerciseName: string | null,
): KinemosLiftRecord | null {
  const wanted = (exerciseName ?? '').toLowerCase();
  if (!wanted) return null;
  return (
    records.find(r => r.isReference && (r.exerciseName ?? '').toLowerCase() === wanted) ?? null
  );
}

/**
 * Make (or unmake) a rep the reference for its athlete and exercise.
 *
 * Any other reference the athlete has for the same exercise is cleared first,
 * so there is never more than one. Injected reads and writes for tests.
 */
export async function markAsReference(
  target: { analysisId: string; athleteId: string | null; exerciseName: string | null },
  on: boolean,
  deps: {
    load?: typeof loadKinemosLiftRecords;
    save?: typeof saveAnalysisState;
  } = {},
): Promise<void> {
  const load = deps.load ?? loadKinemosLiftRecords;
  const save = deps.save ?? saveAnalysisState;

  if (on && target.athleteId) {
    const records = await load({ athleteIds: [target.athleteId] });
    const wanted = (target.exerciseName ?? '').toLowerCase();
    const others = records.filter(
      r =>
        r.isReference &&
        r.analysisId !== target.analysisId &&
        (r.exerciseName ?? '').toLowerCase() === wanted,
    );
    for (const other of others) await save(other.analysisId, { isReference: false });
  }
  await save(target.analysisId, { isReference: on });
}
