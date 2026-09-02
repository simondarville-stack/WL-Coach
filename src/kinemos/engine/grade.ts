/**
 * grade — how far to trust the numbers, computed rather than asserted.
 *
 * The design doc promises two operating points (§6.4): ±0,05 m/s on peak
 * velocity from everyday handheld footage, ±0,02 m/s from the serious tier.
 * A letter stamped on an analysis by a lookup table would be decoration. So
 * this module builds an **error budget** from the conditions the analysis
 * actually ran under, and the letter falls out of the number.
 *
 * The model, and every assumption in it:
 *
 *   1. Marking a point has a position uncertainty σ_p, in PIXELS, that depends
 *      on what did the marking — a coach's click is worth about 1,5 px, a
 *      sub-pixel centroid on a high-contrast marker about 0,4 px.
 *   2. Calibration turns that into metres: σ_pos = σ_p · cmPerPx / 100.
 *   3. A central difference turns position noise into velocity noise:
 *      σ_v,raw = σ_pos · √2 / (2Δt) = σ_pos · fps / √2.
 *   4. The low-pass keeps only the fraction 2·fc/fps of the noise bandwidth,
 *      so white noise falls by √(2·fc/fps).
 *
 *   Multiplying (3) and (4):    **σ_v ≈ σ_pos · √(fps · fc)**
 *
 * That closed form is worth staring at, because it says something a coach can
 * act on: velocity accuracy improves with a SMALLER cm/px (film closer, or at
 * higher resolution) and with a LOWER cutoff, and it gets *worse* with frame
 * rate — a 240 fps clip differentiates over shorter intervals and therefore
 * amplifies the same pixel noise more. Frame rate buys temporal resolution,
 * not precision.
 *
 * The model is not fitted to anything; it is derived. What makes it credible is
 * that it reproduces the design doc's two tiers unprompted: a coach's click on
 * a 2 mm/px 60 fps clip filtered at 6 Hz comes out at 0,057 m/s, and a marker
 * on the same clip at 0,015 m/s. Those are the ±0,05 and ±0,02 the product
 * promises, arrived at from first principles rather than back-solved.
 *
 * Multipliers then account for the things the derivation does not model —
 * handheld background motion, an off-perpendicular view, an uncorrected lens,
 * variable frame rate. They are judgement, and they are labelled as such.
 *
 * Engine purity: numbers in, numbers out.
 */
import type { Calibration } from './calibration';
import type { FilterSettings } from './signal';

/**
 * Comma decimals, the convention everywhere in EMOS (CLAUDE.md "Stack").
 *
 * A number formatter inside the engine is a small compromise on purity — but
 * these factors carry display strings by design (a value and the words that
 * explain it), EMOS is deliberately single-locale, and i18n infrastructure is a
 * standing anti-goal. The alternative, threading a formatter in from the UI,
 * would buy nothing this product intends to use.
 */
function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals).replace('.', ',');
}

export type TrackerTier = 'manual' | 'assisted' | 'marker' | 'ml';
export type CameraStability = 'tripod' | 'stabilised' | 'handheld' | 'unknown';
export type DistortionSource = 'none' | 'model' | 'profile';
export type Verdict = 'good' | 'fair' | 'weak';

/**
 * Position uncertainty per tier, in pixels. COACH-CONFIG in spirit, though
 * these are properties of the method rather than preferences: they are the
 * numbers to revise when a tracker is measured against ground truth, and the
 * P2 tracker's own validation is where that measurement comes from.
 */
export const TIER_POSITION_NOISE_PX: Record<TrackerTier, number> = {
  manual: 1.5,
  assisted: 1.0,
  ml: 0.8,
  marker: 0.4,
};

/** Multipliers for what the derivation does not model. Judgement, not physics. */
const CAMERA_MULTIPLIER: Record<CameraStability, number> = {
  tripod: 1,
  stabilised: 1.2,
  handheld: 1.5,
  unknown: 1.4,
};

const DISTORTION_MULTIPLIER: Record<DistortionSource, number> = {
  profile: 1,
  model: 1.05,
  none: 1.1,
};

/** Variable frame rate is handled correctly by the engine, but resampling onto
 *  a uniform grid interpolates, and interpolation is not free. */
const VFR_MULTIPLIER = 1.15;

/** Grade boundaries on the estimated peak-velocity error, m/s. A is the
 *  hardcore tier the design doc names; B is the everyday tier. */
export const GRADE_A_MAX_ERROR_MS = 0.03;
export const GRADE_B_MAX_ERROR_MS = 0.06;

export interface GradeInputs {
  /** Effective sample rate of the analysed series — the resampled grid's rate,
   *  not a nominal fps from the container. */
  sampleRateHz: number;
  vfr: boolean;
  calibration: Calibration | null;
  /** Did the low-pass actually run? An unfiltered series carries the raw
   *  differentiation noise, which the budget below assumes away. */
  filtered: boolean;
  filter: FilterSettings;
  trackerTier: TrackerTier;
  /** How many frames the coach had to correct, out of how many were tracked.
   *  A tracker needing constant correction is not performing at its tier. */
  correctionCount: number;
  trackedFrames: number;
  camera: CameraStability;
  distortionSource: DistortionSource;
}

export interface GradeFactor {
  id: string;
  label: string;
  /** What the condition actually was, for display. */
  value: string;
  verdict: Verdict;
  /** Why it matters — shown on hover, so the grade teaches rather than judges. */
  why: string;
}

export interface QualityGrade {
  /** Null when the analysis cannot be graded at all: without a calibration
   *  there is no velocity to be accurate about. */
  grade: 'A' | 'B' | 'C' | null;
  /** One-sigma estimate of the error on peak velocity, m/s. */
  expectedVelocityErrorMs: number | null;
  factors: GradeFactor[];
  /** One sentence a coach can read without unpacking the factors. */
  summary: string;
  /** What would move this analysis up a grade, most valuable first. Empty at A. */
  improvements: string[];
}

/**
 * Effective tracker tier after accounting for how much hand-correcting the
 * track needed.
 *
 * An assisted track corrected on half its frames is a hand-marked track with
 * extra steps, and grading it as assisted would flatter it. The threshold is
 * a fifth of the frames — beyond that the tracker was not really doing the job.
 */
export function effectiveTier(
  tier: TrackerTier,
  correctionCount: number,
  trackedFrames: number,
): TrackerTier {
  if (tier === 'manual' || trackedFrames <= 0) return tier;
  const density = correctionCount / trackedFrames;
  return density > 0.2 ? 'manual' : tier;
}

/**
 * The core estimate: σ_v ≈ σ_pos · √(fps · fc), times the multipliers.
 * Exported so the number can be checked directly rather than only through the
 * letter it produces.
 */
export function estimateVelocityErrorMs(inputs: GradeInputs): number | null {
  const cal = inputs.calibration;
  if (!cal || cal.confidence === 'degenerate' || !(cal.cmPerPxV > 0)) return null;
  if (!(inputs.sampleRateHz > 0)) return null;

  const tier = effectiveTier(inputs.trackerTier, inputs.correctionCount, inputs.trackedFrames);
  const sigmaPosM = (TIER_POSITION_NOISE_PX[tier] * cal.cmPerPxV) / 100;

  // Unfiltered, there is no bandwidth reduction at all: the noise arrives with
  // the full σ_pos · fps/√2 of a raw central difference.
  const base = inputs.filtered
    ? sigmaPosM * Math.sqrt(inputs.sampleRateHz * inputs.filter.cutoffHz)
    : (sigmaPosM * inputs.sampleRateHz) / Math.SQRT2;

  // An off-perpendicular view leaves a residual the flat-plate model does not
  // remove; it grows with the square of the angle rather than linearly, because
  // the first-order term is exactly what the anisotropic calibration corrects.
  const angleMultiplier = 1 + (cal.viewingAngleDeg / 90) ** 2;

  return (
    base *
    CAMERA_MULTIPLIER[inputs.camera] *
    DISTORTION_MULTIPLIER[inputs.distortionSource] *
    angleMultiplier *
    (inputs.vfr ? VFR_MULTIPLIER : 1)
  );
}

/** The whole verdict: a letter, the number behind it, and what to do next. */
export function gradeAnalysis(inputs: GradeInputs): QualityGrade {
  const cal = inputs.calibration;
  const error = estimateVelocityErrorMs(inputs);
  const factors = buildFactors(inputs, error);

  if (error === null) {
    return {
      grade: null,
      expectedVelocityErrorMs: null,
      factors,
      summary:
        'Not graded — without a plate calibration there is no scale, and no velocity to be accurate about.',
      improvements: ['Outline a plate to calibrate the clip.'],
    };
  }

  let grade: 'A' | 'B' | 'C' =
    error <= GRADE_A_MAX_ERROR_MS ? 'A' : error <= GRADE_B_MAX_ERROR_MS ? 'B' : 'C';

  // Caps. These are not penalties added to a score — they are statements that
  // a condition makes the estimate itself unreliable, so the letter must not
  // claim more than the estimate can support.
  if (cal && cal.confidence === 'wide' && grade === 'A') grade = 'B';
  if (!inputs.filtered && grade !== 'C') grade = 'C';

  return {
    grade,
    expectedVelocityErrorMs: error,
    factors,
    summary: summarise(grade, error, inputs),
    improvements: improvementsFor(inputs, error),
  };
}

function buildFactors(inputs: GradeInputs, error: number | null): GradeFactor[] {
  const cal = inputs.calibration;
  const tier = effectiveTier(inputs.trackerTier, inputs.correctionCount, inputs.trackedFrames);
  const mmPerPx = cal ? cal.cmPerPxV * 10 : null;

  const factors: GradeFactor[] = [
    {
      id: 'scale',
      label: 'Scale',
      value: cal ? `Plate, ${fmt(cal.viewingAngleDeg, 0)}° off` : 'None',
      verdict: !cal
        ? 'weak'
        : cal.confidence === 'ok'
          ? 'good'
          : cal.confidence === 'wide'
            ? 'fair'
            : 'weak',
      why: 'The plate gives the pixels-to-centimetres scale. Past 30° off perpendicular the flat-plate model starts to slip.',
    },
    {
      id: 'resolution',
      label: 'Spatial resolution',
      value: mmPerPx === null ? '—' : `${fmt(mmPerPx, 1)} mm/px`,
      verdict: mmPerPx === null ? 'weak' : mmPerPx <= 2.5 ? 'good' : mmPerPx <= 5 ? 'fair' : 'weak',
      why: 'How much real distance one pixel covers. This is the single biggest term in the error budget — filming closer beats every other improvement.',
    },
    {
      id: 'rate',
      label: 'Sample rate',
      value: `${fmt(inputs.sampleRateHz, 0)} Hz${inputs.vfr ? ', variable' : ''}`,
      verdict: inputs.sampleRateHz >= 50 ? 'good' : inputs.sampleRateHz >= 28 ? 'fair' : 'weak',
      why: 'Frame rate buys temporal detail — a 30 fps clip cannot resolve a turnover. It does not buy precision: differentiating over shorter intervals amplifies the same pixel noise more.',
    },
    {
      id: 'tracking',
      label: 'Tracking',
      value:
        tier === 'manual'
          ? inputs.trackerTier === 'manual'
            ? 'By hand'
            : 'Assisted, heavily corrected'
          : tier === 'marker'
            ? 'Marker'
            : tier === 'ml'
              ? 'Automatic'
              : 'Assisted',
      verdict: tier === 'marker' ? 'good' : tier === 'manual' ? 'fair' : 'good',
      why: 'What placed the points, and how precisely. A marker on the bar end is the tightest tier; a hand-placed click is about 1,5 px.',
    },
    {
      id: 'filter',
      label: 'Smoothing',
      value: inputs.filtered
        ? `${fmt(inputs.filter.cutoffHz, 0)} Hz Butterworth`
        : 'None — raw differentiation',
      verdict: inputs.filtered ? 'good' : 'weak',
      why: 'Differentiating raw marks amplifies every pixel of tremor. Without the low-pass the velocity curve is mostly noise.',
    },
    {
      id: 'camera',
      label: 'Camera',
      value:
        inputs.camera === 'tripod'
          ? 'Tripod'
          : inputs.camera === 'stabilised'
            ? 'Handheld, stabilised'
            : inputs.camera === 'handheld'
              ? 'Handheld'
              : 'Not recorded',
      verdict: inputs.camera === 'tripod' ? 'good' : inputs.camera === 'stabilised' ? 'fair' : 'weak',
      why: 'A moving camera moves the bar in frame. Stabilisation removes most of it; a tripod removes all of it.',
    },
    {
      id: 'lens',
      label: 'Lens profile',
      value:
        inputs.distortionSource === 'profile'
          ? 'Measured'
          : inputs.distortionSource === 'model'
            ? 'From the phone model'
            : 'None',
      verdict:
        inputs.distortionSource === 'profile'
          ? 'good'
          : inputs.distortionSource === 'model'
            ? 'fair'
            : 'weak',
      why: 'Lens distortion bends straight lines near the frame edge. Filming from a distance keeps it small; a measured profile removes it.',
    },
  ];

  if (error !== null) {
    factors.push({
      id: 'estimate',
      label: 'Estimated error',
      value: `±${fmt(error, 3)} m/s`,
      verdict: error <= GRADE_A_MAX_ERROR_MS ? 'good' : error <= GRADE_B_MAX_ERROR_MS ? 'fair' : 'weak',
      why: 'One standard deviation on peak velocity, from the conditions above. A snatch that makes it at 1,80 and misses at 1,77 needs this under 0,03.',
    });
  }

  return factors;
}

function summarise(grade: 'A' | 'B' | 'C', error: number, inputs: GradeInputs): string {
  const err = `±${fmt(error, 2)} m/s`;
  if (!inputs.filtered) {
    return `Grade C — the velocity here is unsmoothed, so it carries the full marking noise. Turn the filter on before quoting a number.`;
  }
  if (grade === 'A') {
    return `Grade A — good to about ${err} on peak velocity, tight enough to separate a 1,80 from a 1,77.`;
  }
  if (grade === 'B') {
    return `Grade B — good to about ${err}. Fine for tracking a lifter's trend; too coarse to call a three-centimetre-per-second difference.`;
  }
  return `Grade C — about ${err}. Read the shape of the curve, not the digits.`;
}

/** Ordered by how much each would actually move the number. */
function improvementsFor(inputs: GradeInputs, error: number): string[] {
  const out: string[] = [];
  const cal = inputs.calibration;

  if (!inputs.filtered) {
    out.push('Turn on smoothing, or lower the cutoff until the clip’s frame rate can carry it.');
  }
  if (cal && cal.cmPerPxV * 10 > 2.5) {
    out.push(
      `Film closer or at higher resolution — one pixel currently covers ${fmt(cal.cmPerPxV * 10, 1)} mm, and this term dominates the budget.`,
    );
  }
  if (inputs.trackerTier !== 'marker') {
    out.push('Put a high-contrast marker on the bar end — it roughly quarters the position noise.');
  }
  if (inputs.camera !== 'tripod') {
    out.push('Film from a tripod or a bench rather than by hand.');
  }
  if (cal && cal.viewingAngleDeg > 30) {
    out.push(
      `Move the camera closer to perpendicular — it is ${fmt(cal.viewingAngleDeg, 0)}° off, past what the flat-plate model covers.`,
    );
  }
  if (inputs.distortionSource === 'none') {
    out.push('Store a lens profile for this device.');
  }
  return error <= GRADE_A_MAX_ERROR_MS ? out.slice(0, 1) : out;
}
