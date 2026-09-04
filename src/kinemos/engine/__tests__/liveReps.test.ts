/**
 * The live rep detector, fed one sample at a time from scripted sessions: a
 * clean double, a bar that was only shuffled, a lift that was dumped, a
 * tracker that glitched.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse } from '../calibration';
import { liveInit, liveStatus, liveStep, type LiveRep, type LiveSample } from '../liveReps';

/** 45 cm over 180 px ⇒ 0,25 cm/px. */
const cal = calibrateFromEllipse({ cx: 0, cy: 0, semiMajorPx: 90, semiMinorPx: 90, tiltDeg: 0 }, 45);
const PX_PER_CM = 4;
const FPS = 30;

/** Feed a height profile, in cm above the floor, and collect the reps. */
function run(heightsCm: number[], options = {}): { reps: LiveRep[]; samples: LiveSample[] } {
  let state = liveInit(cal, options);
  const reps: LiveRep[] = [];
  const samples: LiveSample[] = [];
  heightsCm.forEach((h, i) => {
    const sample = { t: i / FPS, x: 300, y: 800 - h * PX_PER_CM };
    samples.push(sample);
    const out = liveStep(state, sample);
    state = out.state;
    if (out.rep) reps.push(out.rep);
  });
  return { reps, samples };
}

/** A snatch: still, up to `peak` over 1 s, caught, still again. */
function snatch(peakCm = 140, restFrames = 30, standCm = 0): number[] {
  const out: number[] = new Array(restFrames).fill(0);
  const riseFrames = Math.round(FPS * 1.0);
  for (let i = 1; i <= riseFrames; i++) {
    out.push((peakCm * (1 - Math.cos((Math.PI * i) / riseFrames))) / 2);
  }
  // Received: a short dip and then still.
  for (let i = 1; i <= 8; i++) out.push(peakCm - (i / 8) * 20);
  const held = peakCm - 20 + standCm;
  for (let i = 0; i < 25; i++) out.push(held);
  return out;
}

describe('liveStep', () => {
  it('counts a single snatch once, with its peak velocity', () => {
    const { reps } = run(snatch());
    expect(reps).toHaveLength(1);
    expect(reps[0].index).toBe(1);
    expect(reps[0].riseCm).toBeCloseTo(140, 0);
    // A 140 cm rise shaped like a half-cosine over a second peaks at
    // π·1,40/2 ≈ 2,2 m/s.
    expect(reps[0].peakVelocityMs).toBeGreaterThan(1.9);
    expect(reps[0].peakVelocityMs).toBeLessThan(2.5);
    expect(reps[0].samples.length).toBeGreaterThan(20);
  });

  it('counts a double as two', () => {
    // Bar back to the floor between them, as a double is lifted.
    const { reps } = run([...snatch(), ...new Array(20).fill(0), ...snatch(135)]);
    expect(reps).toHaveLength(2);
    expect(reps[1].index).toBe(2);
    expect(reps[1].riseCm).toBeCloseTo(135, 0);
  });

  it('does not count a bar being shuffled on the floor', () => {
    const shuffle: number[] = [];
    for (let i = 0; i < 120; i++) shuffle.push(8 * Math.abs(Math.sin(i / 10)));
    expect(run(shuffle).reps).toHaveLength(0);
  });

  it('does not count a pull that never got high enough', () => {
    // A 30 cm pull: armed, but under the 40 cm a rep needs.
    expect(run(snatch(30)).reps).toHaveLength(0);
  });

  it('counts a lower pull when the coach says to', () => {
    // Blocks, or a halting pull: the threshold is the coach's.
    expect(run(snatch(30), { minRiseCm: 20 }).reps).toHaveLength(1);
  });

  it('does not split a wobble at the top into two reps', () => {
    const wobbly = snatch();
    // Caught, dips, comes back up 4 cm while being stabilised, settles.
    const at = wobbly.length - 20;
    for (let i = 0; i < 6; i++) wobbly[at + i] += i < 3 ? i * 1.5 : (5 - i) * 1.5;
    expect(run(wobbly).reps).toHaveLength(1);
  });

  it('ignores a tracker glitch rather than reporting 40 m/s', () => {
    const glitched = snatch();
    // One frame where the tracker jumped across the hall and back.
    glitched[45] = 900;
    const { reps } = run(glitched);
    expect(reps).toHaveLength(1);
    expect(reps[0].peakVelocityMs).toBeLessThan(2.5);
  });

  it('learns the floor rather than being told it', () => {
    // The whole session sits 60 cm up the frame — blocks, or a camera
    // pointed differently. The rise is still measured from where the bar
    // rested.
    const raised = snatch().map(h => h + 60);
    const { reps } = run(raised);
    expect(reps).toHaveLength(1);
    expect(reps[0].riseCm).toBeCloseTo(140, 0);
  });

  it('says whether a lift is under way', () => {
    let state = liveInit(cal);
    const feed = (h: number, i: number) => {
      state = liveStep(state, { t: i / FPS, x: 300, y: 800 - h * PX_PER_CM }).state;
    };
    feed(0, 0);
    feed(0, 1);
    expect(liveStatus(state).active).toBe(false);
    // A physical rise: 6 cm a frame at 30 fps is 1,8 m/s. A jump larger than
    // `maxSpeedMs` would be discarded as a tracker glitch, which is the
    // point of that guard.
    for (let i = 2; i <= 14; i++) feed((i - 1) * 6, i);
    expect(liveStatus(state).active).toBe(true);
    expect(liveStatus(state).aboveCm).toBeCloseTo(78, 0);
  });
});
