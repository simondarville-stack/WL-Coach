/**
 * activityScan — the activity engine fed from a real clip.
 *
 * Opens a THUMBNAIL frame server on the source (`maxEdge` 160: a 160 × 90 or
 * 90 × 160 canvas, 14 400 pixels), walks every frame in presentation order,
 * reads each tiny canvas's luma and feeds `engine/activity.ts`. The engine
 * decides where the lifts are; this is only the walk.
 *
 * Its own server, not the viewer's (P7 plan §1): the viewer's server is full
 * resolution with a 24-frame cache of RGBA canvases, and walking a whole
 * clip through it would evict the coach's stepping window and pay a
 * full-size draw per frame. The frame server's own `maxEdge` draw does the
 * downscale, so the per-frame cost here is the decode and little else —
 * `msPerFrame` in the result is that number, and the P7 plan §6 says what
 * it has to be for the scan to pay for itself.
 *
 * The walk goes forward one frame at a time: the frame server decodes one
 * frame at a time and sequential is the cheap direction (every backward step
 * is a seek to the previous key frame). `scanServer` is the walk on an open
 * server with an injectable thumbnail reader, so the tests can drive it
 * without a canvas; `scanActivity` opens and closes the server around it.
 */
import {
  activityAccumulator,
  liftWindows,
  type ActivityOptions,
  type ActivitySample,
  type LiftWindow,
  type LiftWindowOptions,
  type Thumb,
} from '../engine/activity';
import {
  openFrameServer,
  type FrameServer,
  type FrameSource as ClipSource,
  type OpenFrameServerOptions,
  type ServedFrame,
} from '../engine/frameServer';
import { grayFromRgba } from '../engine/tracker';

export interface ActivityScanResult {
  windows: LiftWindow[];
  samples: ActivitySample[];
  /** Frames walked. */
  frames: number;
  totalMs: number;
  msPerFrame: number;
  thumbWidth: number;
  thumbHeight: number;
  /** True when `shouldStop` ended the walk early; the windows are then from
   *  the frames seen so far. */
  stopped: boolean;
}

/** Reads one served frame as a luma thumbnail. */
export type ThumbReader = (frame: ServedFrame, width: number, height: number) => Thumb;

export interface ScanServerOptions {
  /** Default: the canvas reader. Injected by the tests. */
  readThumb?: ThumbReader;
  onProgress?: (done: number, total: number) => void;
  /** Checked before every frame; true ends the walk. */
  shouldStop?: () => boolean;
  /**
   * Carry on from an earlier walk that `shouldStop` ended — its `frames` and
   * `samples`. The viewer stops the scan the moment the coach presses play
   * (two decoders on one clip is a stutter) and picks it up again from here
   * when the clip is paused, rather than starting over each time.
   */
  resumeFrom?: { frames: number; samples: ActivitySample[] };
  activity?: ActivityOptions;
  windows?: LiftWindowOptions;
}

export interface ScanActivityOptions extends ScanServerOptions {
  /** Longest edge of the thumbnail. 160 is the engine's yardstick: an 8 px
   *  cell grid of 20 × 12 on it. */
  maxEdge?: number;
  /** The thumbnail server's cache; the walk never looks back. */
  cacheSize?: number;
  /** Injected by the tests. */
  open?: (src: ClipSource, options: OpenFrameServerOptions) => Promise<FrameServer>;
}

export const SCAN_MAX_EDGE = 160;
const SCAN_CACHE_SIZE = 4;

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

/** A reader that draws the served canvas onto one of its own and reads the
 *  luma back — `getImageData` over a thumbnail is a few hundred microseconds. */
export function canvasThumbReader(): ThumbReader {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  return (frame, width, height) => {
    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) throw new Error('The activity scan needs a 2D canvas, which this browser did not provide.');
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0, width, height);
    const gray = grayFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
    return { width, height, data: gray.data, t: frame.timestamp };
  };
}

/** The walk over an already-open (thumbnail) server. Does not close it. */
export async function scanServer(server: FrameServer, options: ScanServerOptions = {}): Promise<ActivityScanResult> {
  const read = options.readThumb ?? canvasThumbReader();
  const width = server.displayWidth;
  const height = server.displayHeight;
  const total = server.frameCount;
  const acc = activityAccumulator(options.activity);
  const t0 = now();
  let stopped = false;
  // Resuming: the earlier samples stand; the walk restarts one frame BEFORE
  // the first unseen one so the accumulator has a previous thumbnail to
  // difference against, and that re-read frame's sample is dropped.
  const prior = options.resumeFrom?.samples ?? [];
  const resumeAt = Math.max(0, Math.min(total, options.resumeFrom?.frames ?? 0));
  const seedIndex = resumeAt > 0 ? resumeAt - 1 : 0;
  let frames = resumeAt;
  const take = (frame: ServedFrame): void => {
    acc.push(read(frame, width, height));
    if (resumeAt > 0 && frame.index === seedIndex) {
      // The seed: read for its pixels only, its sample already counted.
      acc.samples.pop();
      return;
    }
    frames++;
    options.onProgress?.(frames, total);
  };
  if (resumeAt < total) {
    if (server.stream) {
      // One decoder run over the clip (`FrameServer.stream`): 16 ms a frame
      // against 89–153 through `frameAt`, measured on the testset — the walk
      // is the whole cost of the scan, so this is what makes it pay.
      await server.stream(frame => {
        if (options.shouldStop?.()) {
          stopped = true;
          return false;
        }
        take(frame);
        return true;
      }, seedIndex);
    } else {
      for (let i = seedIndex; i < total; i++) {
        if (options.shouldStop?.()) {
          stopped = true;
          break;
        }
        take(await server.frameAt(i));
      }
    }
  }
  const samples = prior.length > 0 ? prior.concat(acc.samples) : acc.samples;
  const totalMs = now() - t0;
  return {
    windows: liftWindows(samples, height, options.windows),
    samples,
    frames,
    totalMs,
    msPerFrame: frames > 0 ? totalMs / frames : 0,
    thumbWidth: width,
    thumbHeight: height,
    stopped,
  };
}

/** Open a thumbnail server on `src`, scan it, close it. */
export async function scanActivity(src: ClipSource, options: ScanActivityOptions = {}): Promise<ActivityScanResult> {
  const open = options.open ?? openFrameServer;
  const server = await open(src, { maxEdge: options.maxEdge ?? SCAN_MAX_EDGE, cacheSize: options.cacheSize ?? SCAN_CACHE_SIZE });
  try {
    return await scanServer(server, options);
  } finally {
    server.close();
  }
}

/** A second with a comma decimal and one place: "6,9". */
export function secondsLabel(t: number): string {
  return t.toFixed(1).replace('.', ',');
}

/** "1,2–2,4 s" — the lift's span, from where the bar moves to the window's
 *  end, for a marker or a message. */
export function windowLabel(window: LiftWindow): string {
  return `${secondsLabel(window.liftT)}–${secondsLabel(window.toT)} s`;
}
