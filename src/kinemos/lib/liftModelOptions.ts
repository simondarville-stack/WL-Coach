/**
 * liftModelOptions — the lift models as a picker outside KinEMOS sees them.
 *
 * The exercise form declares which model an exercise is (P9 plan §4), and
 * it lives in the EMOS catalogue code, which does not import the engine
 * directly (design §4 rule 1). This is the public surface: labels and ids,
 * grouped by family, the compound included since a "Clean & Jerk" exercise
 * is exactly what a coach declares it on.
 */
import { liftModelsByFamily } from '../engine/liftModels';

export interface LiftModelOptionGroup {
  label: string;
  options: Array<{ id: string; label: string; note: string }>;
}

export function liftModelOptions(): LiftModelOptionGroup[] {
  return liftModelsByFamily().map(group => ({
    label: group.label,
    options: group.models.map(m => ({ id: m.id, label: m.label, note: m.note })),
  }));
}
