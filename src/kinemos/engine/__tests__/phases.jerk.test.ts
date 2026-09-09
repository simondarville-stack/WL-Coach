/**
 * The dip-and-drive: phase proposal and the jerk's measures on a synthetic
 * jerk whose velocity profile is built from known control points, so where
 * the dip started and how deep it went have right answers.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { computeKinematics } from '../kinematics';
import {
  DIP_DRIVE_PHASES,
  DEFAULT_PHASE_END_RULE,
  DEFAULT_PHASE_THRESHOLDS,
  computeJerkMetrics,
  computeLiftMetrics,
  proposePhases,
  spansFrom,
} from '../phases';
import { liftModelById } from '../liftModels';
import { catalogueFor } from '../metricCatalogue';

const cal = calibrateFromEllipse({ cx: 500, cy: 700, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 }, 45); // 1 cm/px
const FPS = 120;

function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/**
 * A textbook jerk, m/s: still at the rack, a dip that reaches −1,0 m/s and
 * brakes to the lower turning point, a drive to 1,6 m/s, the flight to the
 * apex, a small drop into the fix, and stillness overhead.
 */
const CONTROL: Array<[t: number, v: number]> = [
  [0.0, 0],
  [0.4, 0],
  [0.7, -1.0], // fastest descent
  [0.9, 0], // lower turning point
  [1.15, 1.6], // Vmax
  [1.3, 0], // apex
  [1.4, -0.3], // the drop into the fix
  [1.5, 0], // fixed
  [1.9, 0],
];

function velocityAt(t: number): number {
  for (let i = 1; i < CONTROL.length; i++) {
    const [t0, v0] = CONTROL[i - 1];
    const [t1, v1] = CONTROL[i];
    if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
  }
  return 0;
}

function syntheticJerk(): TrackPoint[] {
  const duration = CONTROL[CONTROL.length - 1][0];
  const points: TrackPoint[] = [];
  const fine = 2400;
  let y = 0;
  let next = 0;
  for (let i = 0; i <= duration * fine; i++) {
    const t = i / fine;
    if (t >= next) {
      points.push({ t, x: 500, y: 700 - y * 100 });
      next += 1 / FPS;
    }
    y += velocityAt(t) / fine;
  }
  return points;
}

const series = computeKinematics(syntheticJerk(), cal, { massKg: 120 })!;
const jerkModel = liftModelById('jerk');
const proposal = proposePhases(series, DIP_DRIVE_PHASES, DEFAULT_PHASE_THRESHOLDS, DEFAULT_PHASE_END_RULE, 'dip-drive');
const at = (rule: string) => proposal.boundaries.find(b => b.rule === rule)!.t;

describe('proposePhases — a dip-and-drive', () => {
  it('finds every boundary from a real signature', () => {
    expect(proposal.fullyDetected).toBe(true);
    expect(proposal.boundaries).toHaveLength(DIP_DRIVE_PHASES.length + 1);
  });

  it('starts the dip where the bar leaves the rack downward', () => {
    expect(at('dip-start')).toBeGreaterThan(0.4);
    expect(at('dip-start')).toBeLessThan(0.6);
  });

  it('starts the braking at the fastest descent', () => {
    expect(at('peak-downward-velocity')).toBeCloseTo(0.7, 1);
  });

  it('starts the drive at the lower turning point', () => {
    expect(at('dip-bottom')).toBeCloseTo(0.9, 1);
  });

  it('ends the drive at Vmax and the turnover at Vmin', () => {
    expect(at('peak-velocity')).toBeCloseTo(1.15, 1);
    expect(at('velocity-min')).toBeCloseTo(1.4, 1);
  });

  it('ends the catch at the fix and closes at the settle', () => {
    expect(at('sit')).toBeCloseTo(1.5, 1);
    expect(at('settle')).toBeGreaterThanOrEqual(at('sit'));
  });

  it('keeps boundaries in order', () => {
    const b = proposal.boundaries;
    for (let i = 1; i < b.length; i++) expect(b[i].t).toBeGreaterThanOrEqual(b[i - 1].t);
  });

  it('starts the dip at the top when the series has no stillness before it', () => {
    // A jerk taken straight out of the clean's recovery: the series begins
    // at the highest point, already turning down.
    const startT = 0.41;
    const cut = syntheticJerk().filter(p => p.t >= startT);
    const s = computeKinematics(cut, cal, { massKg: 120 })!;
    const p = proposePhases(s, DIP_DRIVE_PHASES, DEFAULT_PHASE_THRESHOLDS, DEFAULT_PHASE_END_RULE, 'dip-drive');
    const dip = p.boundaries.find(b => b.rule === 'dip-start')!;
    expect(dip.source).toBe('detected');
    expect(dip.t).toBeLessThan(0.6);
    expect(p.boundaries.find(b => b.rule === 'dip-bottom')!.t).toBeCloseTo(0.9, 1);
  });

  it('refuses to see a dip in a pull, and a pull in a dip', () => {
    // The same series read as a pull from the floor: no lift-off is found
    // before the peak because the bar was DESCENDING there, so the edges
    // fall back — an honest "this does not look like a pull".
    const asPull = proposePhases(series);
    expect(asPull.fullyDetected).toBe(false);
  });
});

describe('the jerk’s measures', () => {
  const spans = spansFrom(proposal.boundaries, DIP_DRIVE_PHASES);
  const metrics = computeLiftMetrics(series, spans);
  const jerk = metrics.jerk!;

  it('exist for a dip-and-drive and not for a pull', () => {
    expect(metrics.jerk).not.toBeNull();
    const pullMetrics = computeLiftMetrics(series, spansFrom(proposePhases(series).boundaries));
    expect(pullMetrics.jerk).toBeNull();
  });

  it('reads the dip velocity, depth and the drive path', () => {
    expect(jerk.vDipMs).toBeCloseTo(-1.0, 1);
    // ∫ of the dip profile: ≈ 15 cm to the fastest descent, 10 cm braking.
    expect(jerk.sDipCm).toBeGreaterThan(21);
    expect(jerk.sDipCm).toBeLessThan(29);
    expect(jerk.sToVDipCm).toBeGreaterThan(10);
    expect(jerk.sToVDipCm).toBeLessThan(20);
    // The drive to Vmax: ≈ 20 cm.
    expect(jerk.sDriveCm).toBeGreaterThan(16);
    expect(jerk.sDriveCm).toBeLessThan(24);
    expect(jerk.driveMinusDipCm).toBeCloseTo(jerk.sDriveCm! - jerk.sDipCm!, 5);
  });

  it('reads forces as a share of the load, braking above the drive’s launch', () => {
    // Braking a 1 m/s descent in a fifth of a second is well over 100 %.
    expect(jerk.fDipPct).toBeGreaterThan(130);
    expect(jerk.fDrivePct).toBeGreaterThan(130);
    expect(jerk.driveForcePeaks).toBeGreaterThanOrEqual(1);
  });

  it('times the three parts of the way up', () => {
    expect(jerk.dipS! + jerk.brakingS!).toBeCloseTo(0.45, 1);
    expect(jerk.driveS).toBeCloseTo(0.25, 1);
  });

  it('shares the catch measures with the pull', () => {
    expect(metrics.analyzer.vmaxMs).toBeCloseTo(1.6, 1);
    expect(metrics.analyzer.vminMs).toBeCloseTo(-0.3, 1);
    expect(metrics.analyzer.sFallCm).toBeGreaterThan(0);
    expect(metrics.analyzer.tTurnS).toBeCloseTo(0.25, 1);
    // And has none of the pull's.
    expect(metrics.analyzer.v1Ms).toBeNull();
    expect(metrics.analyzer.f3Pct).toBeNull();
  });

  it('is null in every field when the dip edges were only guessed', () => {
    const guessed = spans.map(s => (s.definition.id === 'dip' ? { ...s, source: 'fallback' as const } : s));
    const m = computeJerkMetrics(series, guessed)!;
    expect(m.sDipCm).toBeNull();
    expect(m.vDipMs).toBeNull();
  });

  it('is what the catalogue reads for a jerk', () => {
    const lift = { metrics, summary: null };
    const rows = catalogueFor(jerkModel);
    const byId = Object.fromEntries(rows.map(r => [r.id, r.read(lift)]));
    expect(byId.vDip).toBeCloseTo(-1.0, 1);
    expect(byId.sDip).toBe(jerk.sDipCm);
    expect(byId.firstPull).toBeUndefined();
  });
});
