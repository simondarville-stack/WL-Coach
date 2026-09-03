/**
 * plateColour — finding a coloured plate by its colour.
 *
 * Competition bumpers are red, blue, yellow or green, and a fan behind the
 * platform is none of those. The template tracker matches shape and shading;
 * when the plate blurs through a pull in front of something round it can
 * lose the plate and settle on the round thing (P3 plan §8, the fan). Colour
 * is the signal the template does not use: sampled once from the plate the
 * coach outlined, it says whether a candidate IS the plate and where a
 * plate-sized patch of that colour is in a later frame.
 *
 * Three things, all pure functions of RGBA pixels:
 *
 *   - `samplePlateColour` — the plate's hue and how saturated it is, from
 *     the face inside the outline (the hub is metal and is skipped). A black
 *     or grey plate has no usable colour and the model is null: everything
 *     downstream then works as it did without colour.
 *   - `colourMatchFraction` — how much of a disc is that colour. The fan
 *     scores near zero; the plate scores high even when blurred.
 *   - `findColourBlob` — the plate-sized connected patch of that colour
 *     nearest a guess, on a coarse grid so a frame costs a few thousand
 *     tests rather than a million.
 *
 * Engine purity: pixels in, numbers out. No canvas, no OpenCV.
 */
import type { PlateEllipse, PxPoint } from './calibration';

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PlateColourModel {
  /** Circular mean hue of the plate face, degrees 0–360. */
  hueDeg: number;
  /** How far a pixel's hue may sit from it and still be the plate. */
  hueToleranceDeg: number;
  /** Chroma (max − min channel, 0–255) a pixel needs to have a hue worth
   *  trusting. */
  minChroma: number;
  /** Share of the sampled face that was chromatic. */
  coverage: number;
}

export interface SampleOptions {
  /** The band of the outline sampled, as fractions of its semi-axes: inside
   *  the inner edge is the hub, outside the outer edge is the rim's blur. */
  innerFraction?: number;
  outerFraction?: number;
  /** Chroma below which a pixel is grey and says nothing about hue. */
  greyChroma?: number;
  /** Least share of chromatic pixels for the face to count as coloured. */
  minCoverage?: number;
}

const SAMPLE_DEFAULTS: Required<SampleOptions> = {
  innerFraction: 0.35,
  outerFraction: 0.85,
  greyChroma: 40,
  minCoverage: 0.5,
};

/** Hue in degrees and chroma 0–255 of one pixel. Hue is meaningless at zero
 *  chroma; callers gate on chroma first. */
export function hueChroma(r: number, g: number, b: number): { hue: number; chroma: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma === 0) return { hue: 0, chroma: 0 };
  let hue: number;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, chroma };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Normalised radius of a point in an outline's frame: 1 on the outline. */
function ellipseRadius(ellipse: PlateEllipse, x: number, y: number): number {
  const phi = (ellipse.tiltDeg * Math.PI) / 180;
  const dx = x - ellipse.cx;
  const dy = y - ellipse.cy;
  // `up` is the major axis, `right` the minor — as the stage draws it.
  const a = (dx * Math.sin(phi) - dy * Math.cos(phi)) / ellipse.semiMajorPx;
  const b = (dx * Math.cos(phi) + dy * Math.sin(phi)) / ellipse.semiMinorPx;
  return Math.hypot(a, b);
}

/**
 * Sample the plate's colour from the face inside its outline. Null when the
 * face is not coloured enough to be told from a grey background.
 */
export function samplePlateColour(
  image: RgbaImage,
  ellipse: PlateEllipse,
  options: SampleOptions = {},
): PlateColourModel | null {
  const opt = { ...SAMPLE_DEFAULTS, ...options };
  const { data, width, height } = image;
  const reach = Math.max(ellipse.semiMajorPx, ellipse.semiMinorPx) * opt.outerFraction + 1;
  const x0 = Math.max(0, Math.floor(ellipse.cx - reach));
  const x1 = Math.min(width - 1, Math.ceil(ellipse.cx + reach));
  const y0 = Math.max(0, Math.floor(ellipse.cy - reach));
  const y1 = Math.min(height - 1, Math.ceil(ellipse.cy + reach));
  let total = 0;
  let sinSum = 0;
  let cosSum = 0;
  const chromas: number[] = [];
  const hues: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const r = ellipseRadius(ellipse, x, y);
      if (r < opt.innerFraction || r > opt.outerFraction) continue;
      total++;
      const i = (y * width + x) * 4;
      const { hue, chroma } = hueChroma(data[i], data[i + 1], data[i + 2]);
      if (chroma < opt.greyChroma) continue;
      const rad = (hue * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      chromas.push(chroma);
      hues.push(hue);
    }
  }
  if (total === 0) return null;
  const coverage = hues.length / total;
  if (coverage < opt.minCoverage) return null;
  let hueDeg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  if (hueDeg < 0) hueDeg += 360;
  // Spread as a circular standard deviation, then a tolerance that is never
  // so tight that a shadowed part of the plate falls out, nor so loose that
  // a neighbouring colour gets in.
  let spread = 0;
  for (const h of hues) spread += hueDistance(h, hueDeg) ** 2;
  const std = Math.sqrt(spread / hues.length);
  const sorted = [...chromas].sort((a, b) => a - b);
  const medianChroma = sorted[sorted.length >> 1];
  return {
    hueDeg,
    hueToleranceDeg: Math.min(30, Math.max(12, 2 * std)),
    minChroma: Math.max(opt.greyChroma * 0.75, medianChroma * 0.4),
    coverage,
  };
}

/**
 * The colour of a small disc — a marker on the bar end, as the coach
 * clicked it (design §6.2's tracking tier 2). Unlike `samplePlateColour`
 * there is no hub to skip and no outline to work from: everything inside the
 * radius counts, and the tolerance is tighter, because a marker is chosen to
 * be one flat colour and the point of the tier is precision.
 */
export function sampleSpotColour(
  image: RgbaImage,
  centre: PxPoint,
  radiusPx: number,
  options: Pick<SampleOptions, 'greyChroma' | 'minCoverage'> = {},
): PlateColourModel | null {
  const greyChroma = options.greyChroma ?? SAMPLE_DEFAULTS.greyChroma;
  const minCoverage = options.minCoverage ?? 0.6;
  const { data, width, height } = image;
  const x0 = Math.max(0, Math.floor(centre.x - radiusPx));
  const x1 = Math.min(width - 1, Math.ceil(centre.x + radiusPx));
  const y0 = Math.max(0, Math.floor(centre.y - radiusPx));
  const y1 = Math.min(height - 1, Math.ceil(centre.y + radiusPx));
  let total = 0;
  let sinSum = 0;
  let cosSum = 0;
  const hues: number[] = [];
  const chromas: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - centre.x, y - centre.y) > radiusPx) continue;
      total++;
      const i = (y * width + x) * 4;
      const { hue, chroma } = hueChroma(data[i], data[i + 1], data[i + 2]);
      if (chroma < greyChroma) continue;
      const rad = (hue * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      hues.push(hue);
      chromas.push(chroma);
    }
  }
  if (total === 0 || hues.length / total < minCoverage) return null;
  let hueDeg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  if (hueDeg < 0) hueDeg += 360;
  let spread = 0;
  for (const h of hues) spread += hueDistance(h, hueDeg) ** 2;
  const std = Math.sqrt(spread / hues.length);
  const sorted = [...chromas].sort((a, b) => a - b);
  return {
    hueDeg,
    // Tighter than a plate's: a marker is one colour, and letting the
    // tolerance widen is how the tracker ends up on the lifter's shirt.
    hueToleranceDeg: Math.min(20, Math.max(8, 2 * std)),
    minChroma: Math.max(greyChroma * 0.75, sorted[sorted.length >> 1] * 0.4),
    coverage: hues.length / total,
  };
}

function matches(model: PlateColourModel, r: number, g: number, b: number): boolean {
  const { hue, chroma } = hueChroma(r, g, b);
  return chroma >= model.minChroma && hueDistance(hue, model.hueDeg) <= model.hueToleranceDeg;
}

/**
 * Share of the outline's face (the same band `samplePlateColour` reads) that
 * is the plate's colour. The plate itself reads 0,8–1; a fan, a wall or a
 * lifter's leg reads close to zero.
 */
export function colourMatchFraction(
  image: RgbaImage,
  ellipse: PlateEllipse,
  model: PlateColourModel,
  options: Pick<SampleOptions, 'innerFraction' | 'outerFraction'> = {},
): number {
  const inner = options.innerFraction ?? SAMPLE_DEFAULTS.innerFraction;
  const outer = options.outerFraction ?? SAMPLE_DEFAULTS.outerFraction;
  const { data, width, height } = image;
  const reach = Math.max(ellipse.semiMajorPx, ellipse.semiMinorPx) * outer + 1;
  const x0 = Math.max(0, Math.floor(ellipse.cx - reach));
  const x1 = Math.min(width - 1, Math.ceil(ellipse.cx + reach));
  const y0 = Math.max(0, Math.floor(ellipse.cy - reach));
  const y1 = Math.min(height - 1, Math.ceil(ellipse.cy + reach));
  let total = 0;
  let hit = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const r = ellipseRadius(ellipse, x, y);
      if (r < inner || r > outer) continue;
      total++;
      const i = (y * width + x) * 4;
      if (matches(model, data[i], data[i + 1], data[i + 2])) hit++;
    }
  }
  return total === 0 ? 0 : hit / total;
}

export interface ColourBlob {
  /** Centroid of the patch, px. */
  x: number;
  y: number;
  areaPx: number;
  /** Area as a share of the disc a plate of the given radius would cover:
   *  1 is a whole plate face, less is a plate part hidden or blurred thin. */
  fill: number;
}

export interface BlobSearchOptions {
  /** Where the plate was last seen. */
  near: PxPoint;
  /** How far from there to look. */
  searchRadiusPx: number;
  /** The plate's on-screen radius. */
  radiusPx: number;
  /** Grid step, px. Defaults to a tenth of the radius. */
  step?: number;
  /** Patches smaller than this share of a plate's disc are noise. */
  minFill?: number;
  /** Patches larger than this share are the background, not a plate. */
  maxFill?: number;
}

/**
 * The plate-sized patch of the plate's colour nearest a guess, or null.
 * The window is walked on a grid, cells that match are joined into patches
 * (4-connected), and among the patches of plausible size the one that best
 * combines nearness and plate-likeness wins. The centroid is of the grid
 * cells, so it is good to about a grid step — the tracker refines from there.
 */
export function findColourBlob(
  image: RgbaImage,
  model: PlateColourModel,
  options: BlobSearchOptions,
): ColourBlob | null {
  const step = Math.max(1, Math.round(options.step ?? options.radiusPx / 10));
  const minFill = options.minFill ?? 0.25;
  const maxFill = options.maxFill ?? 3;
  const { data, width, height } = image;
  const { near, searchRadiusPx: reach, radiusPx } = options;
  // The window must hold a whole plate beside the guess, not just its centre.
  const pad = reach + radiusPx;
  const x0 = Math.max(0, Math.floor(near.x - pad));
  const y0 = Math.max(0, Math.floor(near.y - pad));
  const x1 = Math.min(width - 1, Math.ceil(near.x + pad));
  const y1 = Math.min(height - 1, Math.ceil(near.y + pad));
  const cols = Math.floor((x1 - x0) / step) + 1;
  const rows = Math.floor((y1 - y0) / step) + 1;
  if (cols <= 0 || rows <= 0) return null;
  const mask = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * step;
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * step;
      const i = (y * width + x) * 4;
      if (matches(model, data[i], data[i + 1], data[i + 2])) mask[row * cols + col] = 1;
    }
  }
  // Connected patches.
  const label = new Int32Array(cols * rows).fill(-1);
  const patches: Array<{ count: number; sx: number; sy: number }> = [];
  const queue: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = patches.length;
    const patch = { count: 0, sx: 0, sy: 0 };
    patches.push(patch);
    label[start] = id;
    queue.length = 0;
    queue.push(start);
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const row = Math.floor(cell / cols);
      const col = cell - row * cols;
      patch.count++;
      patch.sx += x0 + col * step;
      patch.sy += y0 + row * step;
      const neighbours = [
        col > 0 ? cell - 1 : -1,
        col < cols - 1 ? cell + 1 : -1,
        row > 0 ? cell - cols : -1,
        row < rows - 1 ? cell + cols : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] && label[n] < 0) {
          label[n] = id;
          queue.push(n);
        }
      }
    }
  }
  const discArea = Math.PI * radiusPx * radiusPx;
  let best: { blob: ColourBlob; cost: number } | null = null;
  for (const patch of patches) {
    const areaPx = patch.count * step * step;
    const fill = areaPx / discArea;
    if (fill < minFill || fill > maxFill) continue;
    const x = patch.sx / patch.count;
    const y = patch.sy / patch.count;
    const distance = Math.hypot(x - near.x, y - near.y);
    if (distance > reach) continue;
    // Nearness in units of the search radius; size as the log-ratio to a
    // whole plate, so half a plate and two plates cost the same.
    const cost = distance / Math.max(1, reach) + Math.abs(Math.log(fill));
    if (!best || cost < best.cost) best = { blob: { x, y, areaPx, fill }, cost };
  }
  return best?.blob ?? null;
}
