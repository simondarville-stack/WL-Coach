/**
 * Synthetic gym scenes for the cv tests: a textured wall, a rack upright, and
 * a plate drawn as an ellipse in the engine's own tilt convention, all in
 * float grey so the tests can assert against the numbers they drew.
 */
import type { GrayLike } from '../opencv';

export interface SceneEllipse {
  cx: number;
  cy: number;
  a: number;
  b: number;
  tiltDeg: number;
}

export interface SceneOptions {
  width: number;
  height: number;
  plate?: SceneEllipse;
  /** Whole-scene camera shift and rotation about the centre, applied to
   *  the background and the plate alike. */
  camera?: { dx: number; dy: number; rotDeg: number };
  /** Deterministic texture seed. */
  seed?: number;
  noise?: number;
}

/** Deterministic pseudo-random in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Low-frequency texture on the wall so corners exist to track. */
function textureAt(x: number, y: number, seed: number): number {
  // A few sines at irrational-ish frequencies plus a blocky pattern: enough
  // structure for cornerMinEigenVal to find hundreds of corners.
  const s = seed * 0.37;
  const blocks = ((Math.floor(x / 23 + s) + Math.floor(y / 19 + s)) % 2) * 18;
  return (
    92 +
    blocks +
    12 * Math.sin(x * 0.21 + s) * Math.cos(y * 0.17 - s) +
    9 * Math.sin((x + y) * 0.09 + 2 * s)
  );
}

/** Value of the scene at *world* coordinates, before the camera moves. */
function worldAt(x: number, y: number, o: SceneOptions): number {
  let v = textureAt(x, y, o.seed ?? 1);
  // Floor band and a rack upright.
  if (y > o.height - 40) v = 70;
  if (x > o.width * 0.78 && x < o.width * 0.78 + 16) v = 175;
  const p = o.plate;
  if (p) {
    const t = (p.tiltDeg * Math.PI) / 180;
    const dx = x - p.cx;
    const dy = y - p.cy;
    // Engine convention: major axis = up rotated clockwise by tilt.
    const u = dx * -Math.sin(t) + dy * Math.cos(t);
    const w = dx * Math.cos(t) + dy * Math.sin(t);
    const nr = Math.hypot(u / p.a, w / p.b);
    if (nr <= 1) {
      // Rim 3 px wide, bright; face darker with a rotated branding bar.
      const rimInner = 1 - 3 / Math.max(p.a, p.b);
      if (nr >= rimInner) return 215;
      const bar = Math.abs(u * Math.cos(0.7) + w * Math.sin(0.7)) < p.a * 0.2 && Math.hypot(u, w) < p.a * 0.7;
      return bar ? 45 : 105;
    }
  }
  return v;
}

/** Render the scene as seen by the (possibly moved) camera, with 4× area
 *  supersampling so edges land at sub-pixel positions honestly. */
export function renderScene(o: SceneOptions): GrayLike {
  const { width, height } = o;
  const data = new Float32Array(width * height);
  const cam = o.camera ?? { dx: 0, dy: 0, rotDeg: 0 };
  const rot = (cam.rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = width / 2;
  const cy = height / 2;
  const noise = o.noise ?? 0;
  const rand = rng((o.seed ?? 1) * 7919 + 13);
  const offsets = [-0.25, 0.25];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          // Image pixel → world: undo the camera (rotate about centre, shift).
          const px = x + ox - cx;
          const py = y + oy - cy;
          const wx = cos * px + sin * py + cx - cam.dx;
          const wy = -sin * px + cos * py + cy - cam.dy;
          acc += worldAt(wx, wy, o);
        }
      }
      let v = acc / 4;
      if (noise > 0) v += (rand() - 0.5) * 2 * noise;
      data[y * width + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { width, height, data };
}

/** Where a world point appears in the image under the camera motion. */
export function imageOf(
  x: number,
  y: number,
  o: SceneOptions,
): { x: number; y: number } {
  const cam = o.camera ?? { dx: 0, dy: 0, rotDeg: 0 };
  const rot = (cam.rotDeg * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = o.width / 2;
  const cy = o.height / 2;
  const wx = x + cam.dx - cx;
  const wy = y + cam.dy - cy;
  return { x: cos * wx - sin * wy + cx, y: sin * wx + cos * wy + cy };
}
