/**
 * Rep cutting by motion shape: a jerk from the rack, and a clean & jerk cut
 * into its two parts.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { splitReps } from '../reps';

const FPS = 30;
const cal = calibrateFromEllipse({ cx: 0, cy: 0, semiMajorPx: 90, semiMinorPx: 90, tiltDeg: 0 }, 45); // 0,25 cm/px
const PX_PER_CM = 4;

const ease = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

/** A jerk: still at the rack (0), a 20 cm dip over 0,5 s, a drive to 60 cm
 *  by 1,0 s, a 5 cm drop into the fix, still overhead, then lowered back to
 *  the rack at a controlled 1 m/s. */
function jerkHeight(t: number): number {
  if (t < 0.5) return 0;
  if (t < 1.0) return -20 * ease((t - 0.5) / 0.5);
  if (t < 1.5) return -20 + 80 * ease((t - 1.0) / 0.5);
  if (t < 1.65) return 60 - 5 * ease((t - 1.5) / 0.15);
  if (t < 2.4) return 55;
  if (t < 2.95) return 55 - 55 * ease((t - 2.4) / 0.55);
  return 0;
}

/** A clean & jerk: the clean to a 100 cm catch, a stand to the rack at
 *  140 cm, a rest there, then the jerk from it. */
function cleanAndJerkHeight(t: number): number {
  if (t < 0.4) return 0;
  if (t < 1.4) return 120 * ease((t - 0.4) / 1.0); // the clean's pull
  if (t < 1.7) return 120 - 20 * ease((t - 1.4) / 0.3); // caught at 100
  if (t < 2.5) return 100 + 40 * ease((t - 1.7) / 0.8); // stand to the rack
  if (t < 3.3) return 140; // the rest at the rack
  return 140 + jerkHeight(t - 3.3 + 0.5); // then the jerk
}

function track(height: (t: number) => number, seconds: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let i = 0; i <= seconds * FPS; i++) {
    const t = i / FPS;
    points.push({ t, x: 0, y: -height(t) * PX_PER_CM });
  }
  return points;
}

describe('splitReps — a jerk from the rack', () => {
  const points = track(jerkHeight, 3.2);

  it('is cut as one dip-and-drive when read for that shape', () => {
    const reps = splitReps(points, cal, { shape: 'dip-drive' });
    expect(reps).toHaveLength(1);
    expect(reps[0].kind).toBe('dip-drive');
    expect(reps[0].dipCm).toBeCloseTo(20, 0);
    expect(reps[0].riseCm).toBeCloseTo(60, 0);
    expect(reps[0].liftOffT).toBeCloseTo(0.5, 1);
    expect(reps[0].apexT).toBeCloseTo(1.5, 1);
    // The rep ends at the fix, not at the rack after the lowering.
    expect(reps[0].catchT).toBeCloseTo(1.65, 1);
  });

  it('is not a rep at all when read as a pull from the floor', () => {
    // The rest at the rack is 55 cm above the track's lowest still height
    // (the fix is not still enough for long, the rack is) — it IS the floor
    // here, but the bar rises 60 cm only after dipping, and the pull reader
    // takes the first stop above 40 cm... which is the apex. So a pull
    // reader does find a rep; what it cannot know is the dip. The shape
    // check upstream is what tells them apart.
    const reps = splitReps(points, cal, { shape: 'pull-catch' });
    expect(reps.every(r => r.kind === 'pull' && r.dipCm === 0)).toBe(true);
  });

  it('is found from any rest when the shape is free', () => {
    const reps = splitReps(points, cal, { shape: 'free' });
    expect(reps).toHaveLength(1);
    expect(reps[0].kind).toBe('dip-drive');
  });
});

describe('splitReps — a clean & jerk', () => {
  const points = track(cleanAndJerkHeight, 6.0);

  it('is cut into a clean and a jerk when read as a compound', () => {
    const reps = splitReps(points, cal, { shape: 'compound' });
    expect(reps).toHaveLength(2);
    expect(reps[0].kind).toBe('pull');
    expect(reps[0].liftOffT).toBeCloseTo(0.4, 1);
    expect(reps[0].catchT).toBeCloseTo(1.7, 1);
    expect(reps[0].riseCm).toBeCloseTo(120, 0);
    expect(reps[1].kind).toBe('dip-drive');
    expect(reps[1].dipCm).toBeCloseTo(20, 0);
    expect(reps[1].liftOffT).toBeCloseTo(3.3, 1);
    expect(reps[1].riseCm).toBeCloseTo(60, 0);
  });

  it('gives only the clean when read as a lift from the floor', () => {
    // The rest at the rack is 140 cm above the floor and is not a rest a
    // lift from the floor starts from.
    const reps = splitReps(points, cal, { shape: 'pull-catch' });
    expect(reps).toHaveLength(1);
    expect(reps[0].kind).toBe('pull');
  });
});
