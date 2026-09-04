/**
 * The kinematics pipeline, tested against trajectories whose answers are known
 * in closed form. A velocity that is merely "plausible" is exactly the failure
 * mode this module exists to avoid, so the assertions are against analytic
 * truth rather than against a previously recorded output.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type PlateEllipse, type TrackPoint } from '../calibration';
import { G, computeKinematics, meanOver, peakOver, summariseRep } from '../kinematics';
import { DEFAULT_FILTER, filterEdgeSeconds } from '../signal';

/** A perpendicular shot at exactly 1 cm per pixel, so px and cm are the same
 *  number and every expected value can be read off the trajectory directly. */
const ellipse: PlateEllipse = {
  cx: 500,
  cy: 400,
  semiMajorPx: 22.5,
  semiMinorPx: 22.5,
  tiltDeg: 0,
};
const cal = calibrateFromEllipse(ellipse, 45); // 45 cm over 45 px ⇒ 1 cm/px

/** Build a track from a trajectory in centimetres, y measured UPWARD, sampled
 *  at `fps`. Image y grows downward, hence the negation. */
function track(
  yCmAt: (t: number) => number,
  xCmAt: (t: number) => number,
  seconds: number,
  fps: number,
): TrackPoint[] {
  const points: TrackPoint[] = [];
  const n = Math.round(seconds * fps);
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    points.push({ t, x: 500 + xCmAt(t), y: 400 - yCmAt(t) });
  }
  return points;
}

describe('computeKinematics — refusals', () => {
  it('refuses without a calibration, rather than printing pixels per second', () => {
    const points = track(t => 100 * t, () => 0, 1, 60);
    expect(computeKinematics(points, null)).toBeNull();
  });

  it('refuses on a calibration it has already flagged as unusable', () => {
    const degenerate = calibrateFromEllipse({ ...ellipse, semiMajorPx: 3, semiMinorPx: 3 }, 45);
    expect(degenerate.confidence).toBe('degenerate');
    expect(computeKinematics(track(t => 100 * t, () => 0, 1, 60), degenerate)).toBeNull();
  });

  it('refuses a track too short to differentiate', () => {
    expect(computeKinematics(track(t => 100 * t, () => 0, 0.05, 60), cal)).toBeNull();
  });
});

describe('computeKinematics — constant rise', () => {
  // 150 cm/s upward = 1,5 m/s, for one second.
  const series = computeKinematics(track(t => 150 * t, () => 0, 1, 120), cal, {
    massKg: 100,
  })!;

  it('recovers the velocity in metres per second', () => {
    const mid = series.vyMs.slice(20, -20);
    for (const v of mid) expect(v).toBeCloseTo(1.5, 3);
  });

  it('reports no acceleration on a constant rise', () => {
    for (const a of series.ayMs2.slice(20, -20)) expect(Math.abs(a)).toBeLessThan(0.02);
  });

  it('reports no horizontal motion when there is none', () => {
    for (const v of series.vxMs) expect(Math.abs(v)).toBeLessThan(1e-6);
  });

  it('computes power as m·g·v while the bar is not accelerating', () => {
    // F = m(a+g) = m·g when a = 0. 100 kg × 9,80665 × 1,5 ≈ 1471 W.
    const expected = 100 * G * 1.5;
    for (const p of series.powerW!.slice(20, -20)) expect(p).toBeCloseTo(expected, 0);
  });

  it('keeps position in centimetres, the readable unit for a pull', () => {
    expect(series.yCm[series.yCm.length - 1]).toBeCloseTo(150, 1);
  });
});

describe('computeKinematics — free flight', () => {
  // A bar released at 5 m/s: y(t) = 500t − ½·980,665·t² cm. Free flight is the
  // sharpest test of the force model, because the answer is exactly zero power.
  const v0 = 5;
  const seconds = 1;
  const fps = 240;
  const points = track(t => v0 * 100 * t - 0.5 * G * 100 * t * t, () => 0, seconds, fps);

  /** Indices clear of the filter's own start-up at both ends. The engine states
   *  that window rather than hiding it, and the test honours it — asserting
   *  inside the transient would be asserting that a known limitation is not
   *  there. */
  function cleanWindow(series: { t: number[] }, settings = DEFAULT_FILTER) {
    const edge = filterEdgeSeconds(settings);
    const from = series.t.findIndex(t => t >= edge);
    const to = series.t.findIndex(t => t > seconds - edge);
    return { from: from < 0 ? 0 : from, to: to < 0 ? series.t.length : to };
  }

  it('is exact when the filter is off — the pipeline itself adds no error', () => {
    const raw = computeKinematics(points, cal, {
      filter: { ...DEFAULT_FILTER, kind: 'none' },
      massKg: 80,
    })!;
    for (let i = 3; i < raw.t.length - 3; i++) {
      expect(raw.ayMs2[i]).toBeCloseTo(-G, 6);
      expect(raw.vyMs[i]).toBeCloseTo(v0 - G * raw.t[i], 6);
      expect(raw.powerW![i]).toBeCloseTo(0, 6);
    }
  });

  it('recovers the launch velocity', () => {
    const series = computeKinematics(points, cal, { massKg: 80 })!;
    const { from, to } = cleanWindow(series);
    for (let i = from; i < to; i++) {
      expect(series.vyMs[i]).toBeCloseTo(v0 - G * series.t[i], 1);
    }
  });

  it('recovers gravity as the acceleration', () => {
    const series = computeKinematics(points, cal, { massKg: 80 })!;
    const { from, to } = cleanWindow(series);
    for (let i = from; i < to; i++) expect(series.ayMs2[i]).toBeCloseTo(-G, 1);
  });

  it('reports zero power in free flight, because the lifter is not on the bar', () => {
    // F = m(a + g) = m(−g + g) = 0. This is the check that catches a sign error
    // in the force model — with a + g flipped it comes out at twice body-weight.
    const series = computeKinematics(points, cal, { massKg: 80 })!;
    const { from, to } = cleanWindow(series);
    for (let i = from; i < to; i++) expect(Math.abs(series.powerW![i])).toBeLessThan(40);
  });

  it('the filter’s edge window is where the error actually lives', () => {
    // Stated as a test so the limitation is recorded rather than folklore: the
    // outer 2/fc seconds carry a transient, and on a clip shorter than that
    // there is no clean middle at all.
    const series = computeKinematics(points, cal, { massKg: 80 })!;
    const edge = filterEdgeSeconds(DEFAULT_FILTER);
    expect(edge).toBeCloseTo(2 / 6, 6);
    const worstInsideEdge = Math.max(
      ...series.t.map((t, i) => (t < edge ? Math.abs(series.ayMs2[i] + G) : 0)),
    );
    const { from, to } = cleanWindow(series);
    const worstInMiddle = Math.max(
      ...series.ayMs2.slice(from, to).map(a => Math.abs(a + G)),
    );
    expect(worstInsideEdge).toBeGreaterThan(worstInMiddle * 3);
  });
});

describe('computeKinematics — calibration is honoured', () => {
  it('scales velocity by the plate, not by the pixels', () => {
    // Same pixel motion, a plate twice as small in frame ⇒ twice the cm/px ⇒
    // twice the velocity.
    const points = track(t => 100 * t, () => 0, 1, 120);
    const coarse = calibrateFromEllipse({ ...ellipse, semiMajorPx: 11.25, semiMinorPx: 11.25 }, 45);
    const a = computeKinematics(points, cal)!;
    const b = computeKinematics(points, coarse)!;
    expect(b.vyMs[40] / a.vyMs[40]).toBeCloseTo(2, 3);
  });

  it('uses the WIDER horizontal scale on an off-perpendicular shot', () => {
    // 60° off perpendicular: horizontal distances are foreshortened by cos 60°,
    // so a horizontal pixel run is worth twice as much real distance.
    const oblique = calibrateFromEllipse({ ...ellipse, semiMinorPx: 11.25 }, 45);
    expect(oblique.viewingAngleDeg).toBeCloseTo(60, 3);
    const sideways = track(() => 0, t => 50 * t, 1, 120);
    const perpendicular = computeKinematics(sideways, cal)!;
    const angled = computeKinematics(sideways, oblique)!;
    expect(angled.vxMs[40] / perpendicular.vxMs[40]).toBeCloseTo(2, 3);
  });
});

describe('computeKinematics — variable frame rate', () => {
  it('gets the same answer from a clip that changed rate mid-recording', () => {
    // The same 1,5 m/s rise, sampled at 60 fps for the first half and 24 for
    // the second. Anything reading index/fps instead of the timestamps reports
    // two different velocities for one constant motion.
    const points: TrackPoint[] = [];
    let t = 0;
    while (t <= 1) {
      points.push({ t, x: 500, y: 400 - 150 * t });
      t += t < 0.5 ? 1 / 60 : 1 / 24;
    }
    const series = computeKinematics(points, cal)!;
    for (const v of series.vyMs.slice(6, -6)) expect(v).toBeCloseTo(1.5, 2);
  });
});

describe('computeKinematics — noise', () => {
  it('filtering keeps the peak velocity it is meant to keep', () => {
    // A realistic pull: sinusoidal velocity peaking at 1,80 m/s, with ±1 px of
    // marking tremor on top. Unfiltered, the tremor at 60 fps and 1 cm/px puts
    // ±0,6 m/s of noise on the derivative.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const clean = (t: number) => (180 / Math.PI) * (1 - Math.cos(Math.PI * t)); // peak 1,80 m/s
    const points = track(clean, () => 0, 1, 120).map(p => ({ ...p, y: p.y + rand() * 2 }));

    const filtered = computeKinematics(points, cal, { filter: DEFAULT_FILTER })!;
    const raw = computeKinematics(points, cal, {
      filter: { ...DEFAULT_FILTER, kind: 'none' },
    })!;

    const peak = (s: number[]) => Math.max(...s.slice(10, -10));
    // The truth: d/dt of the clean trajectory peaks at 1,80 m/s.
    expect(peak(filtered.vyMs)).toBeGreaterThan(1.7);
    expect(peak(filtered.vyMs)).toBeLessThan(1.9);
    // Unfiltered, the noise alone overshoots it badly.
    expect(peak(raw.vyMs)).toBeGreaterThan(2.2);
  });

  it('says when it did not filter', () => {
    // 6 Hz is unusable at 10 fps — past Nyquist once the Winter correction is
    // applied — so the series comes back RAW and admits it, rather than
    // returning a smooth-looking curve from a filter that could not run.
    const series = computeKinematics(track(t => 100 * t, () => 0, 1.5, 10), cal)!;
    expect(series.filtered).toBe(false);
  });

  it('still filters at an ordinary phone frame rate', () => {
    const series = computeKinematics(track(t => 100 * t, () => 0, 1.5, 30), cal)!;
    expect(series.filtered).toBe(true);
  });
});

describe('summariseRep', () => {
  const series = computeKinematics(
    // Up to +120 cm over 0,9 s then held: velocity peaks in the middle.
    track(t => 120 * Math.min(1, t / 0.9), t => 6 * Math.sin(Math.PI * t), 1.2, 120),
    cal,
    { massKg: 100 },
  )!;
  const summary = summariseRep(series);

  it('reports the peak vertical velocity and when it happened', () => {
    expect(summary.peakVerticalVelocityMs).toBeGreaterThan(1.2);
    expect(summary.peakVerticalVelocityT).toBeGreaterThan(0);
    expect(summary.peakVerticalVelocityT).toBeLessThan(0.9);
  });

  it('reports how high the bar got, and the loop width', () => {
    expect(summary.peakHeightCm).toBeCloseTo(120, 0);
    expect(summary.loopWidthCm).toBeGreaterThan(5);
  });

  it('averages power only over the propulsive part', () => {
    // Including the held phase would drag the mean toward zero.
    expect(summary.meanPropulsivePowerW).not.toBeNull();
    expect(summary.meanPropulsivePowerW!).toBeGreaterThan(0);
    expect(summary.peakPowerW!).toBeGreaterThan(summary.meanPropulsivePowerW!);
  });

  it('leaves power null when no mass is known', () => {
    const noMass = computeKinematics(track(t => 100 * t, () => 0, 1, 120), cal)!;
    expect(noMass.powerW).toBeNull();
    expect(summariseRep(noMass).peakPowerW).toBeNull();
    expect(summariseRep(noMass).meanPropulsivePowerW).toBeNull();
  });
});

describe('meanOver / peakOver', () => {
  const t = [0, 0.1, 0.2, 0.3, 0.4];
  const v = [1, 5, 3, 9, 2];

  it('averages within a closed window', () => {
    expect(meanOver(t, v, 0.1, 0.3)).toBeCloseTo((5 + 3 + 9) / 3, 9);
  });

  it('finds the peak and its time', () => {
    expect(peakOver(t, v, 0, 0.4)).toEqual({ value: 9, t: 0.3 });
  });

  it('returns null for an empty window rather than zero', () => {
    // Zero would read as a real measurement of nothing happening.
    expect(meanOver(t, v, 1, 2)).toBeNull();
    expect(peakOver(t, v, 1, 2)).toBeNull();
  });
});

describe('computeKinematics — the clip clock', () => {
  it('keeps the track\u2019s own timestamps rather than re-zeroing at the first mark', () => {
    // A track cut to the lift starts seven seconds into the clip. Everything
    // that reads the series against the playhead — the phase band, seek,
    // comparison alignment — is on the clip clock, so the series must be too.
    const points: TrackPoint[] = Array.from({ length: 30 }, (_, i) => ({
      t: 7 + i / 60,
      x: 100,
      y: 500 - i * 2,
    }));
    const series = computeKinematics(points, cal)!;
    expect(series.t[0]).toBeCloseTo(7, 6);
    expect(series.t[series.t.length - 1]).toBeCloseTo(7 + 29 / 60, 6);
    // Positions are still relative to the first mark.
    expect(series.yCm[0]).toBeCloseTo(0, 3);
  });
});
