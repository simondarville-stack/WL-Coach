/**
 * Shared xRM estimation utilities.
 *
 * Two layers:
 *   - The eleven published 1RM formulas, exposed as estimate1RM /
 *     estimateWeightAtReps. These short-circuit at reps=1 and otherwise
 *     average the formula set. Same as the calculators have always done.
 *   - estimateAtRepsFromAnchors: the weighted multi-anchor model used by
 *     the PR table. Every real entry contributes an estimate at the
 *     target rep count; contributions are blended by inverse-square
 *     distance so close anchors dominate and far ones nudge.
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

export interface PRAnchor {
  /** Rep count of the real entry (1–10 in practice; any positive integer
   *  works in math). */
  reps: number;
  /** Weight lifted, in kg. */
  valueKg: number;
}

/**
 * Multi-anchor weighted estimate of the weight an athlete should hit at
 * targetReps, given a list of real PR entries.
 *
 * Each anchor produces its own estimate at targetReps by routing through
 * the 11-formula average (forward to implied 1RM, then reverse to the
 * target rep count). Those per-anchor estimates are blended with weights
 * proportional to 1/(1 + d²), where d is the integer rep distance from
 * the anchor to the target. So an anchor 1 rep away contributes 4× the
 * weight of an anchor 3 reps away (1/2 vs 1/10).
 *
 * Special cases:
 *  - Empty anchor list → returns 0.
 *  - One anchor exactly at targetReps → returns that anchor's value untouched.
 *  - Multiple anchors with one at targetReps → still returns the exact match,
 *    because d=0 gives weight=1 and every other weight is finite and smaller
 *    in the numerator/denominator pair; the exact-distance branch short-circuits
 *    for cleanliness.
 */
export function estimateAtRepsFromAnchors(
  anchors: PRAnchor[],
  targetReps: number,
): number {
  if (anchors.length === 0 || targetReps <= 0) return 0;

  // Direct hit: a real entry already exists at this rep count.
  const exact = anchors.find(a => a.reps === targetReps);
  if (exact) return exact.valueKg;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const a of anchors) {
    if (a.reps <= 0 || a.valueKg <= 0) continue;
    const implied1RM = estimate1RM(a.valueKg, a.reps);
    const perAnchorEstimate = estimateWeightAtReps(implied1RM, targetReps);
    const distance = Math.abs(a.reps - targetReps);
    const weight = 1 / (1 + distance * distance);
    weightedSum += perAnchorEstimate * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

/** Round a kg value to the nearest 0.5 kg. */
export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
