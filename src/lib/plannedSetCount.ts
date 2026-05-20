/**
 * expectedPlannedSetCount — how many rows the athlete UI synthesises for a
 * planned exercise. Mirrors the row computation in ExerciseLogCard so the
 * auto-promote-to-completed check in TodayScreen lines up with what the
 * athlete actually sees on screen.
 *
 * Structured set lines win when present. Free-text-reps prescriptions get
 * parsed via parseFreeTextPrescription (sets defaults to 1 per line). Pure
 * free_text and "other" units synthesise a single ✓/✗ row. Sentinel and
 * GPP exercises have no per-set rows and return null — auto-promotion for
 * them happens via explicit "Mark complete", not by terminal-state sweep.
 */
import type { PlannedExerciseFull } from './trainingLogService';
import { parseFreeTextPrescription } from './prescriptionParser';

export function expectedPlannedSetCount(planned: PlannedExerciseFull): number | null {
  if (planned.setLines.length > 0) {
    return planned.setLines.reduce((n, l) => n + Math.max(1, l.sets ?? 1), 0);
  }
  const unit = planned.exercise.unit;
  if (unit === 'free_text_reps' && planned.exercise.prescription_raw) {
    const lines = parseFreeTextPrescription(planned.exercise.prescription_raw);
    if (lines.length === 0) return null;
    return lines.reduce((n, l) => n + Math.max(1, l.sets ?? 1), 0);
  }
  if (unit === 'free_text' || unit === 'other') {
    return 1;
  }
  return null;
}
