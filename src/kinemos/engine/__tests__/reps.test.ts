/**
 * Rep splitting on tracks built to a known script: rests, pulls, drops.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { splitReps } from '../reps';

const FPS = 30;
/** 45 cm over 180 px ⇒ 0,25 cm/px, a phone clip's plate. */
const cal = calibrateFromEllipse({ cx: 0, cy: 0, semiMajorPx: 90, semiMinorPx: 90, tiltDeg: 0 }, 45);
const PX_PER_CM = 4;

/** Height in cm as a function of time for one snatch: rest, a 1,0 s pull to
 *  140 cm, a squat catch dip to 120 cm, a stand to 150 cm, a drop, rest. */
function snatchHeight(t: number): number {
  if (t < 0) return 0;
  if (t < 1.0) return 140 * (1 - Math.cos(Math.PI * t)) / 2; // rises to 140
  if (t < 1.3) return 140 - 20 * (t - 1.0) / 0.3; // catch dip to 120
  if (t < 2.3) return 120 + 30 * (t - 1.3); // stand to 150
  if (t < 2.7) return 150 * (1 - (t - 2.3) / 0.4); // drop
  return 0;
}

/** A track with `reps` snatches, each preceded by `restS` of rest, with a
 *  little pixel jitter. */
function set(reps: number, restS = 1.5, jitter = 0.3): TrackPoint[] {
  const out: TrackPoint[] = [];
  let seed = 3;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const period = restS + 3.0;
  const total = reps * period + restS;
  for (let i = 0; i <= total * FPS; i++) {
    const t = i / FPS;
    const k = Math.floor(t / period);
    const local = t - k * period - restS;
    const h = k < reps ? snatchHeight(local) : 0;
    out.push({ t, x: 300 + 10 * Math.sin(h / 30) + rand() * jitter, y: 800 - h * PX_PER_CM + rand() * jitter });
  }
  return out;
}

describe('splitReps', () => {
  it('finds both reps of a double, from lift-off to the catch', () => {
    const reps = splitReps(set(2), cal);
    expect(reps).toHaveLength(2);
    for (const [k, rep] of reps.entries()) {
      const restEnd = 1.5 + k * 4.5;
      expect(rep.liftOffT).toBeCloseTo(restEnd, 0);
      // The apex is the top of the pull, 1,0 s after lift-off, at 140 cm;
      // the catch is the bottom of the dip that follows, 0,3 s later.
      expect(rep.apexT - rep.liftOffT).toBeCloseTo(1.0, 1);
      expect(rep.catchT - rep.liftOffT).toBeCloseTo(1.3, 1);
      expect(rep.riseCm).toBeCloseTo(140, 0);
    }
  });

  it('finds a triple and a single alike', () => {
    expect(splitReps(set(3), cal)).toHaveLength(3);
    expect(splitReps(set(1), cal)).toHaveLength(1);
  });

  it('ignores the stand-up and the drop — they are not reps', () => {
    const reps = splitReps(set(1), cal);
    expect(reps).toHaveLength(1);
    // The rep's height is the apex (140 cm), not the top of the stand (150 cm),
    // and the rep ends in the catch, before the stand-up.
    expect(reps[0].riseCm).toBeLessThan(145);
    expect(reps[0].catchT - reps[0].liftOffT).toBeLessThan(1.5);
  });

  it('does not count a shuffle of the bar on the floor', () => {
    const points = set(1).map(p => ({ ...p, y: p.t < 1.0 ? p.y - 20 * Math.sin(p.t * 4) : p.y }));
    expect(splitReps(points, cal)).toHaveLength(1);
  });

  it('returns nothing for a clip that starts mid-pull', () => {
    const points = set(1).filter(p => p.t > 1.8);
    expect(splitReps(points, cal)).toHaveLength(0);
  });

  it('survives a tracker that lost the drop', () => {
    // The samples of the drop are missing: the next rest still starts a rep.
    const points = set(2).filter(p => {
      const local = (p.t - 1.5) % 4.5;
      return !(local > 2.3 && local < 2.8);
    });
    expect(splitReps(points, cal)).toHaveLength(2);
  });
});
