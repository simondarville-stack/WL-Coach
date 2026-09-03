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
  forcePercentOf,
  kneeCrossing,
  locateAnalyzerEvents,
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
    // The synthetic dip is 0,25 m/s deep. Demanding 0,5 makes it noise — and
    // the transition is then read from acceleration instead, which the
    // boundaries say. Raising that bar too leaves nothing to find.
    const strictVelocity = proposePhases(series, DEFAULT_PHASE_SET, {
      ...DEFAULT_PHASE_THRESHOLDS,
      minProminenceMs: 0.5,
    });
    expect(strictVelocity.boundaries.find(b => b.phaseId === 'transition')!.rule).toBe('acceleration-peak');
    const strict = proposePhases(series, DEFAULT_PHASE_SET, {
      ...DEFAULT_PHASE_THRESHOLDS,
      minProminenceMs: 0.5,
      minUnweightingMs2: Infinity,
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

describe('computeAnalyzerMetrics — the German analyzer measures', () => {
  const spans = spansFrom(proposePhases(series).boundaries);
  const a = computeLiftMetrics(series, spans).analyzer;

  it('reads V1, V2, Vmax and Vmin off the profile the lift was built with', () => {
    expect(a.v1Ms).toBeCloseTo(1.0, 1);
    expect(a.v2Ms).toBeCloseTo(0.75, 1);
    expect(a.vmaxMs).toBeCloseTo(1.85, 1);
    expect(a.vminMs).toBeCloseTo(-0.6, 1);
  });

  it('times the turnover from Vmax to Vmin', () => {
    // Built as 1,3 s → 1,7 s.
    expect(a.tTurnS).toBeCloseTo(0.4, 1);
  });

  it('places the flight between the height at Vmax and the apex', () => {
    expect(a.sVmaxCm).not.toBeNull();
    expect(a.sMaxCm!).toBeGreaterThan(a.sVmaxCm!);
    expect(a.sFlyCm).toBeCloseTo(a.sMaxCm! - a.sVmaxCm!, 6);
    // 1,85 m/s ballistic rise is 17,4 cm; the profile decelerates faster than
    // gravity would, so the bar gains less than that — a negative remainder.
    expect(a.sRemainCm).toBeCloseTo(a.sFlyCm! - 17.45, 0);
    expect(a.sRemainPct).toBeCloseTo((a.sRemainCm! / a.sMaxCm!) * 100, 6);
  });

  it('measures the fall into the catch', () => {
    expect(a.sSitCm).not.toBeNull();
    expect(a.sSitCm!).toBeLessThan(a.sMaxCm!);
    expect(a.sFallCm).toBeCloseTo(a.sMaxCm! - a.sSitCm!, 6);
  });

  it('gives forces as a share of the load, from acceleration alone', () => {
    // Pulling harder than gravity in both pulls; easing off through the knee;
    // braking harder than gravity in the catch.
    expect(a.f1Pct!).toBeGreaterThan(100);
    expect(a.f3Pct!).toBeGreaterThan(100);
    expect(a.f2Pct!).toBeLessThan(100);
    expect(a.fbrPct!).toBeGreaterThan(100);
    const noMass = computeKinematics(syntheticLift(), cal)!;
    const b = computeLiftMetrics(noMass, spansFrom(proposePhases(noMass).boundaries)).analyzer;
    expect(b.f3Pct).toBeCloseTo(a.f3Pct!, 6);
    expect(b.pskNs).toBeNull();
  });

  it('gives PSK as load × Vmax when a mass is known', () => {
    expect(a.pskNs).toBeCloseTo(100 * a.vmaxMs!, 6);
  });

  it('is all null when the phase set has none of the phases it reads', () => {
    const m = computeLiftMetrics(series, []);
    expect(m.analyzer.v1Ms).toBeNull();
    expect(m.analyzer.f3Pct).toBeNull();
    // Vmax needs no phase.
    expect(m.analyzer.vmaxMs).toBeCloseTo(1.85, 1);
  });
});

describe('locateAnalyzerEvents — the landmarks the charts draw', () => {
  const spans = spansFrom(proposePhases(series).boundaries);
  const events = locateAnalyzerEvents(series, spans);
  const a = computeLiftMetrics(series, spans).analyzer;

  it('puts each landmark where the profile was built', () => {
    expect(events.v1!.t).toBeCloseTo(0.8, 1);
    expect(events.vmax!.t).toBeCloseTo(1.3, 1);
    expect(events.vmin!.t).toBeCloseTo(1.7, 1);
    expect(events.apex!.t).toBeGreaterThan(events.vmax!.t);
    expect(events.apex!.t).toBeLessThan(events.vmin!.t);
    expect(events.sit!.t).toBeGreaterThan(events.apex!.t);
  });

  it('is the same search the analyzer numbers come from', () => {
    expect(events.v1!.valueMs).toBe(a.v1Ms);
    expect(events.v2!.valueMs).toBe(a.v2Ms);
    expect(events.vmax!.valueMs).toBe(a.vmaxMs);
    expect(events.vmin!.valueMs).toBe(a.vminMs);
    expect(events.vmax!.heightCm).toBe(a.sVmaxCm);
    expect(events.apex!.heightCm).toBe(a.sMaxCm);
    expect(events.sit!.heightCm).toBe(a.sSitCm);
  });

  it('climbs: each landmark of the pull is higher than the one before', () => {
    expect(events.v2!.heightCm).toBeGreaterThan(events.v1!.heightCm);
    expect(events.vmax!.heightCm).toBeGreaterThan(events.v2!.heightCm);
    expect(events.apex!.heightCm).toBeGreaterThan(events.vmax!.heightCm);
  });

  it('has no V1 or V2 without the phases, and still has Vmax', () => {
    const bare = locateAnalyzerEvents(series, []);
    expect(bare.v1).toBeNull();
    expect(bare.v2).toBeNull();
    expect(bare.vmax!.valueMs).toBeCloseTo(1.85, 1);
  });

  it('finds the bar passing a knee height on the way up, and not one it never reaches', () => {
    // Half way up to Vmax's height: crossed once, between V1 and Vmax.
    const knee = events.vmax!.heightCm / 2;
    const crossing = kneeCrossing(series, knee)!;
    expect(crossing.heightCm).toBe(knee);
    expect(crossing.t).toBeGreaterThan(series.t[0]);
    expect(crossing.t).toBeLessThan(events.vmax!.t);
    expect(crossing.valueMs).toBeGreaterThan(0);
    expect(kneeCrossing(series, events.apex!.heightCm + 50)).toBeNull();
  });

  it('gives force as a share of the load, sample by sample', () => {
    const f = forcePercentOf(series);
    expect(f.length).toBe(series.t.length);
    // At rest the bar's weight is the whole force.
    expect(f[0]).toBeCloseTo(100, 0);
  });
});

describe('proposePhases — a pull with a shoulder rather than a dip', () => {
  // The bar never slows through the knee; it only stops speeding up for a
  // moment. Velocity has no trough, acceleration does.
  const SHOULDER: Array<[number, number]> = [
    [0.0, 0], [0.4, 0], [0.8, 1.0], [1.0, 1.03], [1.3, 1.85], [1.5, 0], [1.7, -0.6], [1.9, 0], [2.3, 0],
  ];
  const shoulderAt = (t: number): number => {
    for (let i = 1; i < SHOULDER.length; i++) {
      const [t0, v0] = SHOULDER[i - 1];
      const [t1, v1] = SHOULDER[i];
      if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
    return 0;
  };
  const lift = computeKinematics(syntheticLift(FPS, shoulderAt), cal, { massKg: 100 })!;
  const { boundaries, fullyDetected } = proposePhases(lift);

  it('finds the transition from the acceleration trough and says which signature it used', () => {
    expect(fullyDetected).toBe(true);
    const transition = boundaries.find(b => b.phaseId === 'transition')!;
    const secondPull = boundaries.find(b => b.phaseId === 'second_pull')!;
    expect(transition.rule).toBe('acceleration-peak');
    expect(secondPull.rule).toBe('acceleration-trough');
    expect(transition.source).toBe('detected');
    // The shoulder was built between 0,8 and 1,0 s: the first pull's drive
    // lets go on the way into it, the second pull starts in the middle of it.
    expect(transition.t).toBeGreaterThan(0.65);
    expect(transition.t).toBeLessThan(0.95);
    expect(secondPull.t).toBeGreaterThan(transition.t);
    expect(secondPull.t).toBeLessThan(1.1);
  });

  it('gives the analyzer its V1, V2 and forces from those edges', () => {
    const a = computeLiftMetrics(lift, spansFrom(boundaries)).analyzer;
    expect(a.v1Ms).not.toBeNull();
    expect(a.v2Ms).not.toBeNull();
    expect(a.f1Pct!).toBeGreaterThan(100);
    expect(a.f2Pct!).toBeLessThan(a.f1Pct!);
    expect(a.f3Pct!).toBeGreaterThan(a.f2Pct!);
  });
});
