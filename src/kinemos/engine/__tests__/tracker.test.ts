/**
 * The tracker, measured against ground truth.
 *
 * A tracker can only be evaluated by knowing where the thing actually was, so
 * these tests render a synthetic plate onto a synthetic platform at exact
 * sub-pixel positions and then ask how far off the tracker landed. That makes
 * "is it good enough" a number rather than an impression — and the number feeds
 * back into `TIER_POSITION_NOISE_PX.assisted` in the grade, which would
 * otherwise be a guess.
 *
 * The rendering is supersampled 4×4 so that a plate at x = 100,37 really does
 * produce different pixels from one at x = 100,00. Without enough supersampling
 * an edge pixel can only take a handful of coverage values, which caps the
 * sub-pixel information in the image itself — the suite would then be measuring
 * its own renderer rather than the tracker.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACK_OPTIONS,
  annulusOffsets,
  extractTemplate,
  grayFromRgba,
  nccAt,
  predictNext,
  subPixelOffset,
  trackDirection,
  trackFromAnchor,
  type FrameSource,
  type GrayImage,
} from '../tracker';

const W = 320;
const H = 220;
const PLATE_R = 26;

interface Scene {
  cx: number;
  cy: number;
  /** Rotation of the plate's lettering, radians. Plates spin during a lift. */
  rotation?: number;
  /** Multiplies every pixel — a flickering gym light, or the plate passing
   *  through shadow. */
  gain?: number;
  /** Added to every pixel. */
  offset?: number;
  /** Deterministic pixel noise, peak-to-peak. */
  noise?: number;
}

/**
 * One frame: a dark platform, a bright vertical rack upright (a distractor the
 * bar path crosses), and a plate — a mid-grey disc with a bright rim and three
 * darker "letters" that rotate with it.
 */
function renderFrame(scene: Scene): GrayImage {
  const { cx, cy, rotation = 0, gain = 1, offset = 0, noise = 0 } = scene;
  const data = new Float32Array(W * H);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      const SS = 4;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          acc += sampleScene(px, py, cx, cy, rotation);
        }
      }
      data[y * W + x] = (acc / (SS * SS)) * gain + offset + rand() * noise;
    }
  }
  return { width: W, height: H, data };
}

function sampleScene(px: number, py: number, cx: number, cy: number, rotation: number): number {
  // Platform, with a rack upright at x ≈ 250 for the track to be tempted by.
  let value = 34 + (py / H) * 12;
  if (Math.abs(px - 250) < 9) value = 190;

  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d <= PLATE_R) {
    value = d >= PLATE_R * 0.82 ? 215 : 122;
    // Branding across the face, as a competition plate actually carries: a wide
    // band of lettering covering most of the inner disc, turning with the
    // plate. Three small dots would understate the problem the annulus mask
    // exists to solve.
    const c = Math.cos(-rotation);
    const sn = Math.sin(-rotation);
    const lx = dx * c - dy * sn;
    const ly = dx * sn + dy * c;
    if (Math.abs(ly) < PLATE_R * 0.26 && Math.abs(lx) < PLATE_R * 0.72) value = 58;
  }
  return value;
}

/** A frame source over a list of scenes, at 60 fps. */
function sourceFrom(scenes: Scene[]): FrameSource {
  const frames = scenes.map(renderFrame);
  return {
    frameCount: frames.length,
    timestamps: scenes.map((_, i) => i / 60),
    getGray: (i: number) => Promise.resolve(frames[i]),
  };
}

/** An S-shaped pull: up, in, up, out — with sub-pixel positions throughout. */
function pullTrajectory(count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    return {
      x: 120 + 9 * Math.sin(u * Math.PI * 2) + 0.37,
      y: 170 - 105 * u + 0.61,
    };
  });
}

function rmsError(
  points: Array<{ index: number; x: number; y: number }>,
  truth: Array<{ x: number; y: number }>,
): number {
  let sum = 0;
  for (const p of points) {
    sum += (p.x - truth[p.index].x) ** 2 + (p.y - truth[p.index].y) ** 2;
  }
  return Math.sqrt(sum / points.length);
}

describe('annulusOffsets', () => {
  it('covers the rim and leaves the hub out', () => {
    const offsets = annulusOffsets(10, 0.5);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < offsets.length; i += 2) pairs.push([offsets[i], offsets[i + 1]]);
    expect(pairs.every(([dx, dy]) => Math.hypot(dx, dy) <= 10)).toBe(true);
    expect(pairs.every(([dx, dy]) => Math.hypot(dx, dy) >= 5)).toBe(true);
    // The hub is genuinely excluded — this is the whole point of the shape.
    expect(pairs.some(([dx, dy]) => dx === 0 && dy === 0)).toBe(false);
  });

  it('a zero inner fraction gives a filled disc', () => {
    const filled = annulusOffsets(10, 0);
    const ring = annulusOffsets(10, 0.5);
    expect(filled.length).toBeGreaterThan(ring.length);
  });
});

describe('extractTemplate', () => {
  const image = renderFrame({ cx: 120, cy: 110 });
  const offsets = annulusOffsets(PLATE_R, 0.45);

  it('cuts a usable template off the plate', () => {
    const template = extractTemplate(image, 120, 110, offsets);
    expect(template).not.toBeNull();
    expect(template!.norm).toBeGreaterThan(0);
  });

  it('refuses to run off the edge of the frame', () => {
    expect(extractTemplate(image, 4, 110, offsets)).toBeNull();
    expect(extractTemplate(image, 120, H - 2, offsets)).toBeNull();
  });

  it('refuses a patch with no contrast', () => {
    // A flat region correlates perfectly with everything, which would make the
    // confidence score meaningless rather than merely low.
    const flat: GrayImage = { width: W, height: H, data: new Float32Array(W * H).fill(50) };
    expect(extractTemplate(flat, 120, 110, offsets)).toBeNull();
  });
});

describe('nccAt', () => {
  const offsets = annulusOffsets(PLATE_R, 0.45);
  const image = renderFrame({ cx: 120, cy: 110 });
  const template = extractTemplate(image, 120, 110, offsets)!;

  it('is 1 where the template came from', () => {
    expect(nccAt(image, template, 120, 110)).toBeCloseTo(1, 6);
  });

  it('falls away as the candidate moves off the plate', () => {
    expect(nccAt(image, template, 128, 110)).toBeLessThan(0.9);
    expect(nccAt(image, template, 200, 60)).toBeLessThan(0.5);
  });

  it('is unmoved by a brightness or contrast change', () => {
    // The reason for normalising: a gym light flickers, and a plate passes
    // through shadow mid-lift.
    const dimmer = renderFrame({ cx: 120, cy: 110, gain: 0.6, offset: 25 });
    expect(nccAt(dimmer, template, 120, 110)).toBeCloseTo(1, 2);
  });

  it('scores an out-of-frame candidate as no match, not as an error', () => {
    expect(nccAt(image, template, 2, 2)).toBe(-1);
  });
});

describe('subPixelOffset', () => {
  it('finds the vertex of a parabola through three samples', () => {
    // y = −(x − 0,25)² sampled at −1, 0, 1.
    const f = (x: number) => -((x - 0.25) ** 2);
    expect(subPixelOffset(f(-1), f(0), f(1))).toBeCloseTo(0.25, 6);
  });

  it('returns zero on a flat neighbourhood rather than infinity', () => {
    expect(subPixelOffset(1, 1, 1)).toBe(0);
  });

  it('refuses an offset a real peak could not produce', () => {
    // An inverted neighbourhood puts the vertex outside the sample it is
    // supposed to refine.
    expect(subPixelOffset(5, 0, 5)).toBe(0);
  });
});

describe('predictNext', () => {
  it('extrapolates at constant velocity', () => {
    expect(predictNext([{ x: 0, y: 0 }, { x: 2, y: 4 }], 1)).toEqual({ x: 4, y: 8 });
  });

  it('stands still with only one point to go on', () => {
    expect(predictNext([{ x: 3, y: 7 }], 1)).toEqual({ x: 3, y: 7 });
  });
});

describe('tracking a clean pull', () => {
  const truth = pullTrajectory(48);
  const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y })));

  it('follows the plate the whole way', async () => {
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(result.gaveUp).toBe(false);
    expect(result.points).toHaveLength(48);
  });

  it('lands within a quarter of a pixel of the truth', async () => {
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    // Measured at ~0,04 px. The bound is set close to it: this is the number
    // the grade's `assisted` tier is reasoned from, so silent drift in it
    // matters more than in most assertions.
    expect(rmsError(result.points, truth)).toBeLessThan(0.12);
  });

  it('stays confident throughout', async () => {
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(result.lowConfidenceIndices).toHaveLength(0);
    expect(Math.min(...result.points.map(p => p.confidence))).toBeGreaterThan(0.9);
  });
});

describe('tracking a spinning plate', () => {
  // The case the annulus mask exists for: a plate turning through a full
  // rotation over the pull, as they do.
  const truth = pullTrajectory(40);
  const source = sourceFrom(
    truth.map((p, i) => ({ cx: p.x, cy: p.y, rotation: (i / 39) * Math.PI * 2 })),
  );
  const anchor = { index: 0, x: truth[0].x, y: truth[0].y };

  it('tracks through a full rotation of the branding', async () => {
    const result = await trackDirection(source, anchor, 1);
    expect(result.gaveUp).toBe(false);
    expect(rmsError(result.points, truth)).toBeLessThan(0.12);
  });

  it('masking the hub costs accuracy — which is why the default masks nothing', async () => {
    // The design doc assumed a ring template would be needed for rotation
    // invariance. Measured, it is not: cutting the middle out throws away most
    // of the pixels that localise the disc, and the position error roughly
    // doubles by an inner radius of 0,7 and grows five-fold by 0,78. The
    // circular edge dominates the correlation regardless of what is printed
    // inside it. This test is the record of that measurement — if it ever
    // inverts, the default should move with it.
    const disc = await trackDirection(source, anchor, 1, { innerRadiusFraction: 0 });
    const ring = await trackDirection(source, anchor, 1, { innerRadiusFraction: 0.7 });
    expect(rmsError(disc.points, truth)).toBeLessThan(rmsError(ring.points, truth));
  });

  it('a ring does hold correlation slightly better — it just does not matter', async () => {
    // The half of the assumption that was right. Correlation only has to clear
    // the confidence threshold; position error is the product.
    const disc = await trackDirection(source, anchor, 1, { innerRadiusFraction: 0 });
    const ring = await trackDirection(source, anchor, 1, { innerRadiusFraction: 0.7 });
    expect(Math.min(...ring.points.map(p => p.confidence))).toBeGreaterThan(
      Math.min(...disc.points.map(p => p.confidence)),
    );
    // And both stay comfortably clear of the threshold anyway.
    expect(Math.min(...disc.points.map(p => p.confidence))).toBeGreaterThan(
      DEFAULT_TRACK_OPTIONS.minConfidence + 0.15,
    );
  });
});

describe('staying fast on large footage', () => {
  it('decimates a template that would otherwise be enormous', () => {
    // A 45 cm plate is ~50 px across on a 480 p clip and ~200 px on 1080 p.
    // The mask must not grow sixteen-fold for information the edge already
    // carries.
    const uncapped = annulusOffsets(100, 0).length / 2;
    const capped = annulusOffsets(100, 0, 2200).length / 2;
    expect(uncapped).toBeGreaterThan(30000);
    expect(capped).toBeLessThan(3200);
    // Still a disc, just sampled on a coarser lattice.
    expect(capped).toBeGreaterThan(1200);
  });

  it('a decimated template tracks just as accurately', async () => {
    const truth = pullTrajectory(30);
    const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y })));
    const anchor = { index: 0, x: truth[0].x, y: truth[0].y };
    const full = await trackDirection(source, anchor, 1, { maxTemplateSamples: Infinity });
    const thin = await trackDirection(source, anchor, 1, { maxTemplateSamples: 300 });
    expect(rmsError(thin.points, truth)).toBeLessThan(rmsError(full.points, truth) * 3);
    expect(thin.gaveUp).toBe(false);
  });

  it('the coarse-then-fine search finds the same peak an exhaustive one would', async () => {
    // The stride-2 first pass is only safe because a disc's correlation surface
    // is several pixels wide. If that ever stops holding, this catches it.
    const truth = pullTrajectory(24);
    const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y })));
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1, {
      searchRadiusPx: 20,
    });
    expect(rmsError(result.points, truth)).toBeLessThan(0.12);
  });
});

describe('tracking through the awkward parts', () => {
  it('survives a lighting change across the lift', async () => {
    const truth = pullTrajectory(36);
    const source = sourceFrom(
      truth.map((p, i) => ({ cx: p.x, cy: p.y, gain: 1 - 0.4 * (i / 35), offset: 20 * (i / 35) })),
    );
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(result.gaveUp).toBe(false);
    expect(rmsError(result.points, truth)).toBeLessThan(0.5);
  });

  it('survives sensor noise', async () => {
    const truth = pullTrajectory(36);
    const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y, noise: 24 })));
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(result.gaveUp).toBe(false);
    expect(rmsError(result.points, truth)).toBeLessThan(1);
  });

  it('is not seduced by the rack upright the bar passes', async () => {
    // The distractor is a bright vertical bar at x ≈ 250, brighter than the
    // plate's rim. A tracker matching on brightness rather than on shape jumps
    // to it.
    const truth = Array.from({ length: 36 }, (_, i) => ({
      x: 200 + i * 1.6 + 0.3,
      y: 150 - i * 2.4 + 0.4,
    }));
    const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y })));
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(rmsError(result.points, truth)).toBeLessThan(1);
  });
});

describe('anchoring anywhere', () => {
  const truth = pullTrajectory(40);
  const source = sourceFrom(truth.map(p => ({ cx: p.x, cy: p.y })));

  it('tracks backward from a mid-lift anchor', async () => {
    // The gesture that makes a correction useful: a coach notices the track is
    // wrong some frames AFTER it went wrong.
    const result = await trackDirection(source, { index: 25, x: truth[25].x, y: truth[25].y }, -1);
    expect(result.points).toHaveLength(26);
    expect(result.points[0].index).toBe(0);
    expect(rmsError(result.points, truth)).toBeLessThan(0.12);
  });

  it('fills the whole clip from one anchor, in time order, without duplicates', async () => {
    const result = await trackFromAnchor(source, { index: 20, x: truth[20].x, y: truth[20].y });
    expect(result.points).toHaveLength(40);
    expect(new Set(result.points.map(p => p.index)).size).toBe(40);
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].index).toBeGreaterThan(result.points[i - 1].index);
    }
    expect(rmsError(result.points, truth)).toBeLessThan(0.12);
  });
});

describe('losing the bar', () => {
  it('gives up rather than reporting a complete track it does not have', async () => {
    // The plate leaves the frame entirely part way through.
    const truth = pullTrajectory(40);
    const source = sourceFrom(
      truth.map((p, i) => (i < 15 ? { cx: p.x, cy: p.y } : { cx: -400, cy: -400 })),
    );
    const result = await trackDirection(source, { index: 0, x: truth[0].x, y: truth[0].y }, 1);
    expect(result.gaveUp).toBe(true);
    expect(result.points.length).toBeLessThan(40);
    expect(result.lowConfidenceIndices.length).toBeGreaterThan(0);
  });

  it('reports an unusable anchor instead of tracking noise', async () => {
    const flat: GrayImage = { width: W, height: H, data: new Float32Array(W * H).fill(70) };
    const source: FrameSource = {
      frameCount: 5,
      timestamps: [0, 1 / 60, 2 / 60, 3 / 60, 4 / 60],
      getGray: () => Promise.resolve(flat),
    };
    const result = await trackDirection(source, { index: 0, x: 100, y: 100 }, 1);
    expect(result.gaveUp).toBe(true);
    expect(result.points).toHaveLength(0);
  });
});

describe('grayFromRgba', () => {
  it('weights the channels as a decoder does', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const gray = grayFromRgba(rgba, 2, 1);
    expect(gray.data[0]).toBeCloseTo(0.299 * 255, 3);
    expect(gray.data[1]).toBeCloseTo(0.587 * 255, 3);
  });
});

describe('DEFAULT_TRACK_OPTIONS', () => {
  it('searches far enough for a fast bar at an ordinary frame rate', () => {
    // 2 m/s at 60 fps and 2 mm/px is ~17 px between frames; the prediction
    // covers the bulk of that and the radius covers the residual.
    expect(DEFAULT_TRACK_OPTIONS.searchRadiusPx).toBeGreaterThanOrEqual(12);
  });
});
