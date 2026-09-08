/**
 * Where V1 and V2 come from, and when they are withheld.
 *
 * The charts and the analyzer table read the same search. A phase edge the
 * engine only guessed at (`source: 'fallback'`) yields no V1 or V2 on
 * purpose; an edge the coach set does. This pins the rule, because "the bar
 * path does not show V1 and V2" is what a coach sees when the dip detector
 * finds nothing and every edge is a proportion.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { computeKinematics } from '../kinematics';
import { computeLiftMetrics, locateAnalyzerEvents, proposePhases, spansFrom, type PhaseBoundary } from '../phases';

const cal = calibrateFromEllipse({ cx: 500, cy: 700, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 }, 45);
const CONTROL: Array<[number, number]> = [
  [0.0, 0], [0.4, 0], [0.8, 1.0], [1.0, 0.75], [1.3, 1.85], [1.5, 0], [1.7, -0.6], [1.9, 0], [2.3, 0],
];
const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};
function velocityAt(t: number): number {
  for (let i = 1; i < CONTROL.length; i++) {
    const [t0, v0] = CONTROL[i - 1];
    const [t1, v1] = CONTROL[i];
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
  }
  return 0;
}
function syntheticLift(fps = 120): TrackPoint[] {
  const points: TrackPoint[] = [];
  const fine = 2400;
  let y = 0;
  let next = 0;
  for (let i = 0; i <= 2.3 * fine; i++) {
    const t = i / fine;
    if (t >= next) {
      points.push({ t, x: 500, y: 700 - y * 100 });
      next += 1 / fps;
    }
    y += velocityAt(t) / fine;
  }
  return points;
}

const series = computeKinematics(syntheticLift(), cal, { massKg: 100 })!;
const proposal = proposePhases(series);

describe('locateAnalyzerEvents and the edge sources', () => {
  it('reads V1 and V2 from detected edges', () => {
    const events = locateAnalyzerEvents(series, spansFrom(proposal.boundaries));
    expect(events.v1).not.toBeNull();
    expect(events.v2).not.toBeNull();
    expect(events.v1!.valueMs).toBeGreaterThan(events.v2!.valueMs);
  });

  it('withholds V1 and V2 when the transition edge was placed by proportion, and keeps Vmax', () => {
    const guessed: PhaseBoundary[] = proposal.boundaries.map(b =>
      b.phaseId === 'transition' ? { ...b, source: 'fallback' } : b,
    );
    const spans = spansFrom(guessed);
    // The guess spoils both spans it edges: the first pull ends there, the transition starts there.
    expect(spans.find(s => s.definition.id === 'first_pull')!.source).toBe('fallback');
    expect(spans.find(s => s.definition.id === 'transition')!.source).toBe('fallback');
    const events = locateAnalyzerEvents(series, spans);
    expect(events.v1).toBeNull();
    expect(events.v2).toBeNull();
    expect(events.vmax).not.toBeNull();
    // And the table agrees with the chart.
    const a = computeLiftMetrics(series, spans).analyzer;
    expect(a.v1Ms).toBeNull();
    expect(a.v2Ms).toBeNull();
    expect(a.vmaxMs).toBe(events.vmax!.valueMs);
  });

  it('reads them again once the coach sets the edge, at the coach’s time', () => {
    const coachT = 1.02;
    const set: PhaseBoundary[] = proposal.boundaries.map(b =>
      b.phaseId === 'transition' ? { ...b, source: 'fallback' as const } : b,
    ).map(b => (b.phaseId === 'second_pull' ? { ...b, t: coachT, source: 'coach' as const } : b));
    // Only the second pull's start is the coach's; the transition's own start is
    // still a guess, so V1 (first pull) stays withheld while V2 — read at the
    // transition's END, the coach's edge — is not.
    const events = locateAnalyzerEvents(series, spansFrom(set));
    expect(events.v1).toBeNull();
    expect(events.v2).toBeNull();

    const both: PhaseBoundary[] = proposal.boundaries.map(b =>
      b.phaseId === 'transition' || b.phaseId === 'second_pull' ? { ...b, source: 'coach' } : b,
    );
    const fixed = locateAnalyzerEvents(series, spansFrom(both));
    expect(fixed.v1).not.toBeNull();
    expect(fixed.v2).not.toBeNull();
    expect(fixed.v2!.t).toBeCloseTo(proposal.boundaries.find(b => b.phaseId === 'second_pull')!.t, 6);
  });

  it('every event carries a height so a chart against height can place it', () => {
    const events = locateAnalyzerEvents(series, spansFrom(proposal.boundaries));
    for (const key of ['v1', 'v2', 'vmax', 'vmin', 'apex', 'sit'] as const) {
      const e = events[key];
      expect(e, key).not.toBeNull();
      expect(Number.isFinite(e!.heightCm), key).toBe(true);
    }
    expect(events.v2!.heightCm).toBeGreaterThan(events.v1!.heightCm);
  });
});
