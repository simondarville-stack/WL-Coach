/**
 * The stabiliser against a camera the tests moved: the estimated motion has
 * to recover the shift and rotation applied to the scene, and a bar tracked
 * in the shaking frames has to come out where it was in the world.
 */
import { describe, expect, it } from 'vitest';
import type { FrameSource } from '../../engine/tracker';
import { apply, compose, estimateCameraMotion, invert, motionSummary, stabilisePoints } from '../stabilise';
import { imageOf, renderScene, rng, type SceneOptions } from './scene';

const W = 384;
const H = 288;

function sourceFrom(frames: SceneOptions[]): FrameSource {
  const rendered = frames.map(renderScene);
  return {
    frameCount: rendered.length,
    timestamps: rendered.map((_, i) => i / 50),
    getGray: async i => rendered[i],
  };
}

describe('affine algebra', () => {
  it('inverts and composes', () => {
    const m: [number, number, number, number, number, number] = [0.98, -0.2, 5, 0.2, 0.98, -3];
    const back = compose(invert(m), m);
    const p = apply(back, 17, 31);
    expect(p.x).toBeCloseTo(17, 6);
    expect(p.y).toBeCloseTo(31, 6);
  });
});

describe('estimateCameraMotion', () => {
  it('recovers a handheld drift and puts the bar back where it was', async () => {
    const rand = rng(5);
    // The bar rises through the world while the camera drifts and wobbles.
    const frames: SceneOptions[] = [];
    let dx = 0;
    let dy = 0;
    let rot = 0;
    for (let i = 0; i < 24; i++) {
      dx += (rand() - 0.5) * 1.6 + 0.3;
      dy += (rand() - 0.5) * 1.6 - 0.2;
      rot += (rand() - 0.5) * 0.3;
      frames.push({
        width: W,
        height: H,
        plate: { cx: 150 + 4 * Math.sin(i / 4), cy: 230 - i * 4, a: 22, b: 22, tiltDeg: 0 },
        camera: { dx, dy, rotDeg: rot },
        noise: 2,
        seed: 3,
      });
    }
    const source = sourceFrom(frames);
    const motions = await estimateCameraMotion(source, 0, {
      exclude: i => ({ x: imageOf(frames[i].plate!.cx, frames[i].plate!.cy, frames[i]).x, y: imageOf(frames[i].plate!.cx, frames[i].plate!.cy, frames[i]).y, r: 22 }),
    });
    expect(motions).toHaveLength(24);
    expect(motions.every(m => m.index === 0 || m.inliers >= 12)).toBe(true);

    // The plate's image position on each frame (what a tracker would give),
    // mapped back to frame 0, should equal where it appears in frame 0's
    // camera — i.e. the world motion only.
    const tracked = frames.map((f, i) => {
      const p = imageOf(f.plate!.cx, f.plate!.cy, f);
      return { index: i, x: p.x, y: p.y };
    });
    const stabilised = stabilisePoints(tracked, motions);
    let worst = 0;
    for (let i = 0; i < frames.length; i++) {
      const expected = imageOf(frames[i].plate!.cx, frames[i].plate!.cy, frames[0]);
      worst = Math.max(worst, Math.hypot(stabilised[i].x - expected.x, stabilised[i].y - expected.y));
    }
    // Chained over 23 frames, the camera is recovered to well under a pixel.
    expect(worst).toBeLessThan(0.8);

    const summary = motionSummary(motions);
    expect(summary.maxShiftPx).toBeGreaterThan(3);
  }, 60_000);

  it('is the identity for a camera that did not move', async () => {
    const frames: SceneOptions[] = Array.from({ length: 6 }, (_, i) => ({
      width: W,
      height: H,
      plate: { cx: 150, cy: 230 - i * 5, a: 22, b: 22, tiltDeg: 0 },
      noise: 2,
    }));
    const motions = await estimateCameraMotion(sourceFrom(frames), 2);
    for (const m of motions) {
      const p = apply(m.toAnchor, 100, 100);
      expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThan(0.3);
    }
  }, 60_000);
});
