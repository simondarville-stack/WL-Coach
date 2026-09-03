/**
 * The timing repair, against tracks where the fault is planted and the truth
 * is known: a frame carrying the wrong timestamp must be found and put back,
 * a timestamp step must be found and undone from that frame on, and a real
 * event that also breaks the acceleration bound must be left alone.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type TrackPoint } from '../calibration';
import { computeKinematics, peakStability, summariseRep } from '../kinematics';
import { DEFAULT_FILTER } from '../signal';
import { repairTiming } from '../timing';

const FPS = 50;
/** 1 cm/px at 45 cm over 45 px. */
const cal = calibrateFromEllipse({ cx: 0, cy: 0, semiMajorPx: 22.5, semiMinorPx: 22.5, tiltDeg: 0 }, 45);

/** A snatch-shaped rise: 200 cm in 1,4 s as a smooth function of time,
 *  peaking in velocity at 0,7 s at 2,2 m/s — 4,5 px per frame here. */
function heightCm(t: number): number {
  return 200 * (1 - Math.cos(Math.min(Math.PI, (Math.PI * t) / 1.4))) / 2 + 0.6 * Math.sin(3 * t);
}

function at(t: number): { x: number; y: number } {
  return { x: 300 + 4 * Math.sin(2 * t), y: 400 - heightCm(t) };
}

function cleanTrack(seconds = 2): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let i = 0; i <= seconds * FPS; i++) {
    const t = i / FPS;
    points.push({ t, ...at(t) });
  }
  return points;
}

/** A spike: frame k shows the picture from `framesLate` frames earlier,
 *  stamped with frame k's time. */
function spike(points: TrackPoint[], k: number, framesLate: number): TrackPoint[] {
  return points.map((p, i) => (i === k ? { ...p, ...at(p.t - framesLate / FPS) } : p));
}

/** A step: from frame k on, every picture was taken `framesAhead` frames
 *  later than its stamp says — a dropped field (0,5) or frame (1). */
function step(points: TrackPoint[], k: number, framesAhead: number): TrackPoint[] {
  return points.map((p, i) => (i >= k ? { ...p, ...at(p.t + framesAhead / FPS) } : p));
}

/** Velocity error of a track against the clean one, through the whole
 *  pipeline — what the coach would actually see. */
function peakError(points: TrackPoint[], repair = true): number {
  const truth = summariseRep(computeKinematics(cleanTrack(), cal)!).peakVerticalVelocityMs;
  const peak = summariseRep(computeKinematics(points, cal, { repairTiming: repair })!).peakVerticalVelocityMs;
  return Math.abs(peak / truth - 1);
}

describe('repairTiming — clean and untouched cases', () => {
  it('leaves a clean track alone', () => {
    const points = cleanTrack();
    const { points: out, repairs } = repairTiming(points, { cmPerPx: 1 });
    expect(repairs).toEqual([]);
    expect(out).toEqual(points);
  });

  it('is off without a scale — the bound is physical, not in pixels', () => {
    const { repairs } = repairTiming(spike(cleanTrack(), 34, 1), { cmPerPx: 0 });
    expect(repairs).toEqual([]);
  });

  it('does not touch a catch', () => {
    // The bar stops dead at frame 60 and stays. The frames after sit on the
    // old curve at no consistent shift, so nothing is a timing fault.
    const points = cleanTrack();
    for (let i = 60; i < points.length; i++) points[i] = { ...points[i], y: points[60].y, x: points[60].x };
    expect(repairTiming(points, { cmPerPx: 1 }).repairs).toEqual([]);
  });

  it('does not touch a bounce', () => {
    // Rising at full speed, the bar hits something at frame 40 and comes back
    // down at half the speed: an event, not a stamp.
    const clean = cleanTrack();
    const points = clean.map((p, i) =>
      i > 40 ? { ...p, x: clean[40].x, y: clean[40].y + 2.2 * (i - 40) } : p,
    );
    expect(repairTiming(points, { cmPerPx: 1 }).repairs).toEqual([]);
  });
});

describe('repairTiming — spikes', () => {
  it('finds a frame stamped 0,7 frames late and moves it back in time', () => {
    const k = 34; // just before peak velocity, where a fault hurts most
    const faulty = spike(cleanTrack(), k, 0.7);
    const { points, repairs } = repairTiming(faulty, { cmPerPx: 1 });
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ index: k, action: 'retimed' });
    expect(repairs[0].shiftFrames).toBeCloseTo(-0.7, 1);
    // The sample survives, at the time its picture was actually taken.
    expect(points).toHaveLength(faulty.length);
    const moved = points.find(p => p.x === faulty[k].x && p.y === faulty[k].y)!;
    expect(moved.t).toBeCloseTo(faulty[k].t - 0.7 / FPS, 3);
  });

  it('handles a half-frame spike the same way', () => {
    const { repairs } = repairTiming(spike(cleanTrack(), 36, 0.5), { cmPerPx: 1 });
    expect(repairs).toHaveLength(1);
    expect(repairs[0].shiftFrames).toBeCloseTo(-0.5, 1);
  });

  it('moves a frame stamped a whole frame late onto its neighbour, then drops the copy', () => {
    const faulty = spike(cleanTrack(), 34, 1);
    const { points, repairs } = repairTiming(faulty, { cmPerPx: 1 });
    expect(repairs.map(r => r.action)).toEqual(['retimed', 'dropped']);
    expect(repairs[0].shiftFrames).toBeCloseTo(-1, 1);
    expect(points).toHaveLength(faulty.length - 1);
  });

  it('treats a repeated frame as the duplicate it is, and keeps one copy', () => {
    // Frame 35 shows frame 34's picture: an encoder duplicate. It is moved
    // back onto the frame it copies — and then, sitting on the same instant
    // as frame 34, dropped, because the resampler cannot use two samples at
    // one time and they say the same thing.
    const points = cleanTrack();
    points[35] = { ...points[35], x: points[34].x, y: points[34].y };
    const { points: out, repairs } = repairTiming(points, { cmPerPx: 1 });
    expect(repairs.map(r => r.action)).toEqual(['retimed', 'dropped']);
    expect(out).toHaveLength(points.length - 1);
  });

  it('recovers the clean peak velocity, and shows the fault when switched off', () => {
    const faulty = spike(cleanTrack(), 34, 0.7);
    expect(peakError(faulty)).toBeLessThan(0.005);
    expect(peakError(faulty, false)).toBeGreaterThan(0.005);
    expect(computeKinematics(faulty, cal)!.timingRepairs).toHaveLength(1);
  });
});

describe('repairTiming — steps', () => {
  it('finds a dropped field — everything half a frame ahead from frame k on', () => {
    const k = 36;
    const { points, repairs } = repairTiming(step(cleanTrack(), k, 0.5), { cmPerPx: 1 });
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ index: k, action: 'stepped' });
    expect(repairs[0].shiftFrames).toBeCloseTo(0.5, 1);
    // Every frame from k on now carries the time its picture was taken.
    for (let i = k; i < points.length; i++) expect(points[i].t).toBeCloseTo((i + 0.5) / FPS, 3);
    for (let i = 0; i < k; i++) expect(points[i].t).toBeCloseTo(i / FPS, 6);
  });

  it('finds a dropped frame — everything a whole frame ahead', () => {
    const { repairs } = repairTiming(step(cleanTrack(), 30, 1), { cmPerPx: 1 });
    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('stepped');
    expect(repairs[0].shiftFrames).toBeCloseTo(1, 1);
  });

  it('recovers the clean peak velocity across a step', () => {
    const faulty = step(cleanTrack(), 36, 0.5);
    expect(peakError(faulty, false)).toBeGreaterThan(0.02);
    expect(peakError(faulty)).toBeLessThan(0.005);
  });

  it('handles a step and a spike in the same track', () => {
    // (The spike is a whole-frame duplicate, so once re-timed it sits on its
    // neighbour's instant and is dropped as the copy it is.)
    const faulty = spike(step(cleanTrack(), 30, 0.5), 45, 1);
    const { points, repairs } = repairTiming(faulty, { cmPerPx: 1 });
    expect(repairs[0]).toMatchObject({ index: 30, action: 'stepped' });
    expect(repairs[repairs.length - 1]).toMatchObject({ index: 45, action: 'dropped' });
    expect(points).toHaveLength(faulty.length - 1);
    expect(peakError(faulty)).toBeLessThan(0.005);
  });
});

describe('peakStability', () => {
  it('holds still on a clean plateau and moves on an unrepaired lurch', () => {
    const clean = peakStability(cleanTrack(), cal)!;
    expect(Math.abs(clean.spread)).toBeLessThan(0.02);
    // A one-frame lurch that the repair is not allowed to touch: the peak
    // becomes a function of the cutoff, and the spread says so.
    const lurched = peakStability(spike(cleanTrack(), 34, 0.7), cal, { repairTiming: false })!;
    expect(Math.abs(lurched.spread)).toBeGreaterThan(Math.abs(clean.spread) + 0.01);
    expect(lurched.peakAtHigherMs).toBeGreaterThan(lurched.peakAtLowerMs);
  });

  it('is null when there is no filter to vary', () => {
    expect(peakStability(cleanTrack(), cal, { filter: { ...DEFAULT_FILTER, kind: 'none' } })).toBeNull();
  });
});
