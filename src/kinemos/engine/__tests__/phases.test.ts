/**
 * Phase detection, tested against a synthetic lift whose velocity profile is
 * built from known control points — so "did it find the double knee bend" has
 * a right answer rather than an opinion.
 *
 * The other half of what is tested here is that the phase model is DATA. A set
 * with different phases, different rules and different thresholds has to work
 * without touching the detector, or the coach-flexibility principle is only a
 * comment.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { computeKinematics } from '../kinematics';
import {
  DEFAULT_PHASE_SET,
  DEFAULT_PHASE_THRESHOLDS,
  computeLiftMetrics,
  enforceMonotonic,
  proposePhases,
  spansFrom,
  valueAt,
  type PhaseBoundary,
  type PhaseDefinition,
} from '../phases';

const cal = calibrateFromEllipse(
  { cx: 500, cy: 700, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 },
  45,
); // 1 cm per pixel

const FPS = 120;

/** Smooth ramp from a to b over [0,1], zero slope at both ends. */
function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/**
 * Velocity control points of a textbook snatch, m/s. Leading and trailing
 * still time is deliberate: it is what a real clip contains, and it keeps the
 * moments of interest clear of the filter's edge window.
 */
const CONTROL: Array<[t: number, v: number]> = [
  [0.0, 0],
  [0.4, 0], // still on the floor
  [0.8, 1.0], // first pull peak
  [1.0, 0.75], // transition trough — the double knee bend
  [1.3, 1.85], // second pull peak
  [1.5, 0], // apex
  [1.7, -0.6], // dropping under the bar
  [1.9, 0], // caught
  [2.3, 0], // still
];

function velocityAt(t: number): number {
  for (let i = 1; i < CONTROL.length; i++) {
    const [t0, v0] = CONTROL[i - 1];
    const [t1, v1] = CONTROL[i];
    if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
  }
  return 0;
}

/** A track built by integrating that velocity profile. */
function syntheticLift(fps = FPS, velocity: (t: number) => number = velocityAt): TrackPoint[] {
  const duration = CONTROL[CONTROL.length - 1][0];
  const points: TrackPoint[] = [];
  // Integrate finely, sample at the frame rate, so the position series is a
  // faithful integral rather than a coarse sum.
  const fine = 2400;
  let y = 0;
  let nextSample = 0;
  for (let i = 0; i <= duration * fine; i++) {
    const t = i / fine;
    if (t >= nextSample) {
      points.push({ t, x: 500 + 4 * Math.sin(2 * Math.PI * t * 0.7), y: 700 - y * 100 });
      nextSample += 1 / fps;
    }
    y += velocity(t) / fine;
  }
  return points;
}

const series = computeKinematics(syntheticLift(), cal, { massKg: 100 })!;

describe('proposePhases — a lift with a clear double knee bend', () => {
  const { boundaries, fullyDetected } = proposePhases(series);

  it('finds every boundary from a real signature', () => {
    expect(fullyDetected).toBe(true);
    expect(boundaries.every(b => b.source === 'detected')).toBe(true);
  });

  it('produces one boundary per phase, plus the closing one', () => {
    expect(boundaries).toHaveLength(DEFAULT_PHASE_SET.length + 1);
    expect(boundaries[boundaries.length - 1].phaseId).toBeNull();
  });

  const at = (rule: string) => boundaries.find(b => b.rule === rule)!.t;

  it('puts lift-off where the bar starts moving', () => {
    expect(at('liftoff')).toBeGreaterThan(0.4);
    expect(at('liftoff')).toBeLessThan(0.62);
  });

  it('puts the end of the first pull at its velocity peak', () => {
    expect(at('first-velocity-peak')).toBeCloseTo(0.8, 1);
  });

  it('puts the start of the second pull at the transition trough', () => {
    expect(at('velocity-trough')).toBeCloseTo(1.0, 1);
  });

  it('puts the end of the second pull at peak velocity', () => {
    expect(at('peak-velocity')).toBeCloseTo(1.3, 1);
  });

  it('puts the turnover’s end at the apex', () => {
    expect(at('apex')).toBeCloseTo(1.5, 1);
  });

  it('gives the catch a real duration', () => {
    // The rule that fires on the apex collapses the catch to nothing, because
    // the apex is where velocity crosses zero. The bar has to be followed
    // through the descent before "it has stopped" means anything.
    const settleT = boundaries.find(b => b.rule === 'settle')!.t;
    const apexT = boundaries.find(b => b.rule === 'apex')!.t;
    expect(settleT).toBeGreaterThan(apexT + 0.1);
    expect(settleT).toBeCloseTo(1.9, 0);
  });

  it('keeps boundaries in order', () => {
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i].t).toBeGreaterThanOrEqual(boundaries[i - 1].t);
    }
  });
});

describe('proposePhases — a clip that ends at the apex', () => {
  // Footage cut the moment the bar is overhead: there is no descent, so there
  // is nothing to settle from. The engine must say it guessed rather than
  // reporting an edge it did not find.
  const cutShort = (t: number) =>
    t < 0.4 ? 0 : t < 1.5 ? 1.85 * Math.sin((Math.PI * (t - 0.4)) / 1.1) : 0;
  const clipped = computeKinematics(syntheticLift(FPS, cutShort), cal, { massKg: 100 })!;
  const { boundaries, fullyDetected } = proposePhases(clipped);

  it('falls back rather than inventing a settle', () => {
    expect(fullyDetected).toBe(false);
    expect(boundaries[boundaries.length - 1].source).toBe('fallback');
  });

  it('still closes the phase set at the end of the clip', () => {
    const last = boundaries[boundaries.length - 1];
    expect(last.t).toBeCloseTo(clipped.t[clipped.t.length - 1], 2);
  });
});

describe('proposePhases — a pull with no dip', () => {
  // Some lifters, and most pulls from the hang, show no transition dip at all.
  const monotonic = (t: number) => (t < 0.4 ? 0 : t < 1.3 ? 1.85 * smoothstep((t - 0.4) / 0.9) : Math.max(0, 1.85 * (1 - (t - 1.3) / 0.2)));
  const flat = computeKinematics(syntheticLift(FPS, monotonic), cal, { massKg: 100 })!;
  const { boundaries, fullyDetected } = proposePhases(flat);

  it('says so instead of inventing a double knee bend', () => {
    expect(fullyDetected).toBe(false);
    const dipBoundaries = boundaries.filter(
      b => b.rule === 'first-velocity-peak' || b.rule === 'velocity-trough',
    );
    expect(dipBoundaries.every(b => b.source === 'fallback')).toBe(true);
  });

  it('still returns usable, ordered boundaries so the coach can drag them', () => {
    expect(boundaries).toHaveLength(DEFAULT_PHASE_SET.length + 1);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i].t).toBeGreaterThanOrEqual(boundaries[i - 1].t);
    }
  });
});

describe('proposePhases — thresholds are the coach’s, not the code’s', () => {
  it('stops believing the dip once the prominence bar is raised above it', () => {
    // The synthetic dip is 0,25 m/s deep. Demanding 0,5 makes it noise.
    const strict = proposePhases(series, DEFAULT_PHASE_SET, {
      ...DEFAULT_PHASE_THRESHOLDS,
      minProminenceMs: 0.5,
    });
    expect(strict.fullyDetected).toBe(false);
  });

  it('moves lift-off when the velocity that counts as lift-off moves', () => {
    const lazy = proposePhases(series, DEFAULT_PHASE_SET, {
      ...DEFAULT_PHASE_THRESHOLDS,
      liftoffMs: 0.6,
    });
    const strictT = proposePhases(series).boundaries.find(b => b.rule === 'liftoff')!.t;
    const lazyT = lazy.boundaries.find(b => b.rule === 'liftoff')!.t;
    expect(lazyT).toBeGreaterThan(strictT);
  });
});

describe('proposePhases — the phase set is data', () => {
  /** A three-phase model: pull, turnover, catch. No transition at all — a
   *  coach who does not teach the double knee bend as a separate phase. */
  const threePhase: PhaseDefinition[] = [
    { id: 'pull', label: 'Pull', shortLabel: 'PULL', color: '#3E6E9E', startRule: 'liftoff' },
    { id: 'turnover', label: 'Turnover', shortLabel: 'TURN', color: '#A8681F', startRule: 'peak-velocity' },
    { id: 'catch', label: 'Catch', shortLabel: 'CATCH', color: '#3E6E3A', startRule: 'apex' },
  ];

  it('works without the detector knowing anything about this set', () => {
    const { boundaries, fullyDetected } = proposePhases(series, threePhase);
    expect(fullyDetected).toBe(true);
    expect(boundaries).toHaveLength(4);
    expect(boundaries.map(b => b.phaseId)).toEqual(['pull', 'turnover', 'catch', null]);
  });

  it('and its spans carry its own labels and colours', () => {
    const spans = spansFrom(proposePhases(series, threePhase).boundaries, threePhase);
    expect(spans.map(s => s.definition.label)).toEqual(['Pull', 'Turnover', 'Catch']);
    expect(spans[0].definition.color).toBe('#3E6E9E');
  });
});

describe('enforceMonotonic', () => {
  const b = (t: number): PhaseBoundary => ({
    phaseId: 'x',
    t,
    rule: 'liftoff',
    source: 'coach',
  });

  it('clamps a boundary dragged past its neighbour instead of going negative', () => {
    const out = enforceMonotonic([b(0.2), b(0.1), b(0.5)], 0, 1);
    expect(out.map(x => x.t)).toEqual([0.2, 0.2, 0.5]);
  });

  it('keeps everything inside the clip', () => {
    const out = enforceMonotonic([b(-5), b(0.5), b(99)], 0, 1);
    expect(out.map(x => x.t)).toEqual([0, 0.5, 1]);
  });
});

describe('spansFrom', () => {
  it('a span is only as trustworthy as its vaguer edge', () => {
    const boundaries: PhaseBoundary[] = [
      { phaseId: 'first_pull', t: 0, rule: 'liftoff', source: 'detected' },
      { phaseId: 'transition', t: 1, rule: 'first-velocity-peak', source: 'fallback' },
      { phaseId: null, t: 2, rule: 'settle', source: 'detected' },
    ];
    const spans = spansFrom(boundaries);
    expect(spans[0].source).toBe('fallback');
    expect(spans[1].source).toBe('fallback');
  });
});

describe('computeLiftMetrics', () => {
  const spans = spansFrom(proposePhases(series).boundaries);
  const metrics = computeLiftMetrics(series, spans);

  it('reports the peak velocity the trajectory was built with', () => {
    expect(metrics.peakVelocityMs).toBeCloseTo(1.85, 1);
  });

  it('measures the transition dip', () => {
    // Built as 1,00 down to 0,75.
    expect(metrics.transitionVelocityLossMs).toBeCloseTo(0.25, 1);
  });

  it('gives every phase a duration and a height gained', () => {
    expect(metrics.phases).toHaveLength(DEFAULT_PHASE_SET.length);
    for (const phase of metrics.phases) {
      expect(phase.durationS).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(phase.heightGainedCm)).toBe(true);
    }
  });

  it('has the second pull peak faster than the first', () => {
    const first = metrics.phases.find(p => p.phaseId === 'first_pull')!;
    const second = metrics.phases.find(p => p.phaseId === 'second_pull')!;
    expect(second.peakVelocityMs!).toBeGreaterThan(first.peakVelocityMs!);
  });

  it('reports power where a mass is known', () => {
    expect(metrics.peakPowerW).not.toBeNull();
    expect(metrics.peakPowerW!).toBeGreaterThan(1000);
  });

  it('leaves power null without a mass', () => {
    const noMass = computeKinematics(syntheticLift(), cal)!;
    const m = computeLiftMetrics(noMass, spansFrom(proposePhases(noMass).boundaries));
    expect(m.peakPowerW).toBeNull();
    expect(m.phases.every(p => p.peakPowerW === null)).toBe(true);
  });
});

describe('valueAt', () => {
  const t = [0, 1, 2];
  const v = [10, 20, 30];

  it('interpolates between samples', () => {
    expect(valueAt(t, v, 0.5)).toBeCloseTo(15, 9);
  });

  it('clamps outside the range rather than extrapolating', () => {
    expect(valueAt(t, v, -1)).toBe(10);
    expect(valueAt(t, v, 9)).toBe(30);
  });

  it('is null on an empty series', () => {
    expect(valueAt([], [], 1)).toBeNull();
  });
});
