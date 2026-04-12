/**
 * Shared xRM estimation utilities.
 * Averages 11 well-known 1RM formulas for both forward (weight@reps → 1RM)
 * and reverse (1RM → weight@reps) calculations.
 */

const FORMULAS: Record<string, (w: number, r: number) => number> = {
  'Epley':      (w, r) => w * (1 + r / 30),
  'Brzycki':    (w, r) => w * (36 / (37 - r)),
  'Adams':      (w, r) => w * (1 / (1 - 0.02 * r)),
  'Baechle':    (w, r) => w * (1 + 0.033 * r),
  'Berger':     (w, r) => w * (1 / (1.0261 * Math.exp(-0.0262 * r))),
  'Brown':      (w, r) => w * (0.9849 + 0.0328 * r),
  'Landers':    (w, r) => w * (1 / (1.013 - 0.0267123 * r)),
  'Lombardi':   (w, r) => w * Math.pow(r, 0.10),
  'Mayhew':     (w, r) => w * (1 / (0.522 + 0.419 * Math.exp(-0.055 * r))),
  "O'Conner":   (w, r) => w * (1 + 0.025 * r),
  'Wathen':     (w, r) => w * (1 / (0.4880 + 0.538 * Math.exp(-0.075 * r))),
};

const REVERSE_FORMULAS: Record<string, (m: number, r: number) => number> = {
  'Epley':      (m, r) => m / (1 + r / 30),
  'Brzycki':    (m, r) => m * (37 - r) / 36,
  'Adams':      (m, r) => m * (1 - 0.02 * r),
  'Baechle':    (m, r) => m / (1 + 0.033 * r),
  'Berger':     (m, r) => m * (1.0261 * Math.exp(-0.0262 * r)),
  'Brown':      (m, r) => m / (0.9849 + 0.0328 * r),
  'Landers':    (m, r) => m * (1.013 - 0.0267123 * r),
  'Lombardi':   (m, r) => m / Math.pow(r, 0.10),
  'Mayhew':     (m, r) => m * (0.522 + 0.419 * Math.exp(-0.055 * r)),
  "O'Conner":   (m, r) => m / (1 + 0.025 * r),
  'Wathen':     (m, r) => m * (0.4880 + 0.538 * Math.exp(-0.075 * r)),
};

/** Estimate 1RM from weight lifted at a given rep count. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  const vals = Object.values(FORMULAS).map(fn => fn(weightKg, reps));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Estimate the weight achievable at a target rep count, given a known 1RM. */
export function estimateWeightAtReps(oneRM: number, targetReps: number): number {
  if (targetReps <= 0) return 0;
  if (targetReps === 1) return oneRM;
  const vals = Object.values(REVERSE_FORMULAS).map(fn => fn(oneRM, targetReps));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Round a kg value to the nearest 0.5 kg. */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
