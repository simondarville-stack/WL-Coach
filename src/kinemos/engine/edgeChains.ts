/**
 * edgeChains — the straight edges of a gym, out of an edge bitmap.
 *
 * The plumb-line fit in `distortion.ts` needs runs of pixels that lie along
 * something the world guarantees is straight: a rack upright, a platform
 * edge, a door frame, the line where wall meets floor. This module finds
 * them, given only a boolean edge mask — which keeps the choosing of edges
 * pure and testable, with OpenCV's Canny left as the one impure step in
 * `cv/edges.ts`.
 *
 * Two jobs, in order.
 *
 * **Tracing.** Edge pixels are walked 8-connected, and at every step the walk
 * takes the neighbour that best CONTINUES the direction it is already going,
 * refusing any turn sharper than `maxTurnDeg`. Stopping dead at every
 * junction was the first rule, on the reasoning that guessing which arm of a
 * crossing continues the line is how a corner ends up in the middle of a
 * "straight" edge. Measured, it was worse: a near-vertical line that has
 * drifted a pixel sideways is a staircase, a staircase pixel routinely has
 * three neighbours, and the rule chopped the longest and most informative
 * edges — the ones nearest the frame edge, where the bow is biggest — into
 * useless stubs. Following the direction keeps them whole and still refuses
 * the shelf meeting the upright, because that is a right angle and no
 * continuation of anything.
 *
 * **Choosing.** A chain earns its place by being long, and by being nearly —
 * but not exactly — straight. Both bounds matter:
 *
 *   - Too curved and it is a cable, a plate rim or a lifter's back, and it
 *     would drag the fit toward whatever k1 flattens a real curve.
 *   - Exactly straight (to a fraction of a pixel over hundreds of them)
 *     means it is already undistorted, so it carries no information about
 *     the lens — and in practice means the edge is short or near the frame
 *     centre where distortion vanishes.
 *
 * Engine purity: a mask and numbers in, points out.
 */
import type { PxPoint } from './calibration';

export interface ChainOptions {
  /** Shortest chain worth keeping, px of path. Default: a twelfth of the
   *  image diagonal — long enough that a bow is measurable. */
  minLengthPx?: number;
  /** Most a chain may deviate from its own straight line, as a share of its
   *  length. Above this it is a curve, not a bent straight line. */
  maxRelativeBow?: number;
  /** Least it must deviate to carry any information about the lens. */
  minRelativeBow?: number;
  /** Cap on how many chains are returned, longest first. */
  limit?: number;
}

/** Both bounds are measured rather than guessed. On drawn frames a straight
 *  edge bent by a k1 of −0,16 bows 0,4–0,6 % of its own length; a slack
 *  cable across the same frame bows 3 %. Two per cent sits between them with
 *  room on either side. */
const DEFAULTS: Required<Omit<ChainOptions, 'minLengthPx'>> = {
  maxRelativeBow: 0.02,
  minRelativeBow: 0.0015,
  limit: 40,
};

/** How sharp a turn ends a chain. A staircase steps at 45°; a corner is 90°. */
const MAX_TURN_DEG = 60;
/** How many pixels back the walk looks to know which way it is going. One
 *  step is all staircase and no direction. */
const DIRECTION_SPAN = 4;

/** Every 8-connected run of edge pixels, followed through junctions along its
 *  own direction. */
export function traceChains(
  mask: Uint8Array,
  width: number,
  height: number,
  maxTurnDeg = MAX_TURN_DEG,
): PxPoint[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
  const neighbours = (x: number, y: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && at(x + dx, y + dy)) out.push([x + dx, y + dy]);
      }
    }
    return out;
  };

  const used = new Uint8Array(width * height);
  const minCos = Math.cos((maxTurnDeg * Math.PI) / 180);
  const chains: PxPoint[][] = [];

  const walk = (sx: number, sy: number): PxPoint[] => {
    const chain: PxPoint[] = [];
    let cx = sx;
    let cy = sy;
    for (;;) {
      used[cy * width + cx] = 1;
      chain.push({ x: cx, y: cy });
      const options = neighbours(cx, cy).filter(([nx, ny]) => !used[ny * width + nx]);
      if (options.length === 0) break;
      if (chain.length === 1) {
        [cx, cy] = options[0];
        continue;
      }
      // Where the chain has been heading, over the last few pixels rather
      // than the last one.
      const back = chain[Math.max(0, chain.length - 1 - DIRECTION_SPAN)];
      const dx = cx - back.x;
      const dy = cy - back.y;
      const len = Math.hypot(dx, dy) || 1;
      let best: [number, number] | null = null;
      let bestCos = minCos;
      for (const [nx, ny] of options) {
        const ex = nx - cx;
        const ey = ny - cy;
        const cos = (dx * ex + dy * ey) / (len * Math.hypot(ex, ey));
        if (cos >= bestCos) {
          bestCos = cos;
          best = [nx, ny];
        }
      }
      if (!best) break;
      [cx, cy] = best;
    }
    return chain;
  };

  // Free ends first, so a chain is walked from its end and comes out whole;
  // then anything still unvisited, which is how a closed or fully-junctioned
  // run gets seen at all.
  for (const endsOnly of [true, false]) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!mask[y * width + x] || used[y * width + x]) continue;
        if (endsOnly && neighbours(x, y).length !== 1) continue;
        const chain = walk(x, y);
        if (chain.length >= 3) chains.push(chain);
      }
    }
  }
  return chains;
}

/** End-to-end length of a chain, px. Straight-line, not path — a bent
 *  straight edge and its chord differ by too little to matter, and the chord
 *  is what "long" means here. */
export function chainSpanPx(chain: readonly PxPoint[]): number {
  if (chain.length < 2) return 0;
  const a = chain[0];
  const b = chain[chain.length - 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The chains worth fitting a lens to: long, bowed, but not curved. Sorted
 * longest first and capped, because the fit's cost is linear in points and
 * the twentieth-longest edge in a gym adds nothing.
 */
export function selectPlumbLines(
  chains: readonly (readonly PxPoint[])[],
  width: number,
  height: number,
  options: ChainOptions = {},
  residualOf: (chain: readonly PxPoint[]) => number = defaultResidual,
): PxPoint[][] {
  const opt = {
    ...DEFAULTS,
    minLengthPx: options.minLengthPx ?? Math.hypot(width, height) / 12,
    ...options,
  };
  const kept: Array<{ chain: PxPoint[]; span: number }> = [];
  for (const chain of chains) {
    const span = chainSpanPx(chain);
    if (span < opt.minLengthPx || chain.length < 8) continue;
    const relative = residualOf(chain) / span;
    if (relative > opt.maxRelativeBow || relative < opt.minRelativeBow) continue;
    kept.push({ chain: [...chain], span });
  }
  kept.sort((a, b) => b.span - a.span);
  return kept.slice(0, opt.limit).map(k => k.chain);
}

/** The default straightness measure, kept here so the selector has no import
 *  cycle with `distortion.ts`; it is the same total-least-squares residual. */
function defaultResidual(chain: readonly PxPoint[]): number {
  const n = chain.length;
  if (n < 3) return 0;
  let mx = 0;
  let my = 0;
  for (const p of chain) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of chain) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const half = (sxx + syy) / 2;
  const diff = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  return Math.sqrt(Math.max(0, half - diff) / n);
}
