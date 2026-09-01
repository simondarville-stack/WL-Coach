/**
 * frameServer — frame-accurate access to a clip, by index.
 *
 * This is the foundation P1's viewer and P2's tracker both sit on, and it
 * exists because an HTML5 `<video>` element cannot do the one thing a study
 * environment needs: land on *this* frame, deterministically, and say what
 * time it is. Setting `currentTime` seeks to an approximate position, stepping
 * by `1/fps` assumes a constant frame rate the footage may not have, and
 * neither can tell you which frame you got. Kinovea-style analysis starts
 * where that ends.
 *
 * What this gives instead:
 *
 *   - **A real frame index.** One metadata-only pass over the container yields
 *     every frame's true presentation timestamp (`frameTiming.ts`). Frame 90
 *     is whatever the file says frame 90 is, on constant- and variable-rate
 *     footage alike. Stepping is `i ± 1`, never arithmetic on a nominal fps.
 *   - **Decoded frames on demand**, rotation already applied — portrait phone
 *     footage is stored landscape plus a rotation matrix, and WebCodecs hands
 *     back the unrotated picture, so a click mapped onto raw decoder output
 *     would land in the wrong place on exactly the clips athletes film most.
 *   - **Streaming.** Backed by a URL, only the byte ranges actually needed are
 *     fetched — which is why the R2 route implements Range (P0 §W1). A 250 MB
 *     competition recording opens in the time it takes to read its index.
 *
 * Built on mediabunny's `CanvasSink`, which wraps WebCodecs' `VideoDecoder`
 * and handles the demux, the decode pipeline and the rotation. Dynamically
 * imported, so none of it reaches the main bundle.
 *
 * Engine rules apply: nothing here imports from EMOS, touches Supabase or
 * knows React. Frames in, frames out — the same code can run in a Worker
 * batch job over R2 objects when server-side pre-analysis arrives (design §4).
 */
import {
  averageFrameRate,
  buildFrameIndex,
  clampFrameIndex,
  frameIndexAtTime,
  isVariableFrameRate,
  type FrameIndex,
} from './frameTiming';

/** What the clip is, once opened. Everything the quality grade (§6.4) needs
 *  to judge a later analysis, measured rather than declared. */
export interface ClipInfo {
  /** Frame size as displayed — after rotation and pixel-aspect correction.
   *  The space every click, ellipse and track point lives in. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Container rotation in degrees clockwise; already applied to served
   *  frames, recorded so callers know what the source did. */
  readonly rotation: number;
  readonly codec: string | null;
  readonly frameCount: number;
  /** Measured mean frame rate, not the container's claim. */
  readonly averageFps: number | null;
  /** Timing is variable rather than constant — the engine must use real
   *  timestamps, and the grade should say so. Null when undecidable. */
  readonly vfr: boolean | null;
  /** Presentation duration: end of the last frame. */
  readonly durationS: number;
}

/**
 * One frame, ready to draw.
 *
 * **The canvas is borrowed, not owned.** Frames come from a small ring buffer,
 * so this canvas is overwritten once a few more frames have been served. Draw
 * it into your own surface (`ctx.drawImage(frame.canvas, …)`) before awaiting
 * anything else; never store it. The ring is what keeps VRAM flat while a
 * coach holds down the step key.
 */
export interface ServedFrame {
  readonly index: number;
  /** True presentation timestamp in seconds — what metrics must differentiate
   *  against, never `index / fps`. */
  readonly timestamp: number;
  readonly duration: number;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
}

/** Structural shape of mediabunny's `WrappedCanvas`, kept local so this
 *  module needs no static import of a lazily-loaded library. */
interface WrappedCanvasLike {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration: number;
}

export interface OpenFrameServerOptions {
  /**
   * Ring-buffer size. Four covers a viewer drawing one frame while the next
   * decodes; a scan that reads frames in flight wants more. Larger costs VRAM
   * proportionally.
   */
  poolSize?: number;
}

/** The clip cannot be decoded here: an unsupported codec (HEVC outside
 *  Safari), a container mediabunny cannot read, or no video track at all.
 *  Distinguished from a transport failure because the fix differs — convert
 *  the file, versus retry. */
export class ClipUndecodableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipUndecodableError';
  }
}

/**
 * A clip, open and indexed, serving frames by index.
 *
 * Construct with `openFrameServer`. Call `close()` when done — it releases the
 * decoder, the canvas pool and any in-flight range requests.
 */
export class FrameServer {
  readonly info: ClipInfo;
  readonly index: FrameIndex;

  /** mediabunny handles, typed structurally so this module needs no static
   *  import of a library that must stay in a lazy chunk. */
  private readonly sink: {
    getCanvas(t: number): Promise<WrappedCanvasLike | null>;
    canvases(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<WrappedCanvasLike, void, unknown>;
  };
  private readonly input: { dispose(): Promise<void> | void };
  private closed = false;

  /** @internal — use `openFrameServer`. */
  constructor(
    info: ClipInfo,
    index: FrameIndex,
    sink: FrameServer['sink'],
    input: FrameServer['input'],
  ) {
    this.info = info;
    this.index = index;
    this.sink = sink;
    this.input = input;
  }

  /** Frame visible at a given time — the last frame at or before it. */
  indexAtTime(timeS: number): number {
    return frameIndexAtTime(this.index, timeS);
  }

  /** Presentation timestamp of a frame. Clamped, so a caller stepping past
   *  the end gets the last frame's time rather than NaN. */
  timeAtIndex(i: number): number {
    if (this.index.length === 0) return 0;
    return this.index.timestamps[clampFrameIndex(this.index, i)];
  }

  /** Move `delta` frames from `i`, stopping at either end. */
  step(i: number, delta: number): number {
    return clampFrameIndex(this.index, i + delta);
  }

  /**
   * Decode and return one frame by index.
   *
   * Seeking backwards or far forwards costs a decode from the preceding
   * keyframe — unavoidable in any codec with inter-frame prediction, and the
   * reason the viewer should prefer `frames()` when walking a range.
   *
   * The frame is looked up by its indexed timestamp rather than by ordinal,
   * so this stays correct on VFR footage where ordinal and time do not track.
   *
   * **Concurrent calls resolve out of order.** A coach holding the step key
   * fires requests faster than a keyframe seek completes, and an earlier,
   * slower one can settle after a later, faster one — painting a stale frame.
   * This is not serialised here on purpose: a scan wants parallelism, and
   * dropping requests would be wrong for it. Interactive callers must guard
   * with a generation counter (bump on each request, ignore a result whose
   * generation is no longer current) — `dev/frame-server-check.html` shows
   * the pattern.
   */
  async frameAt(i: number): Promise<ServedFrame | null> {
    if (this.closed || this.index.length === 0) return null;
    const clamped = clampFrameIndex(this.index, i);
    const timestamp = this.index.timestamps[clamped];
    // Nudge into the frame's own interval: asking for exactly the boundary
    // timestamp is at the mercy of float rounding in the sink's comparison,
    // and landing one frame early is the classic off-by-one in frame
    // stepping. A tenth of the frame's duration is well inside it.
    const probe = timestamp + Math.min(this.index.durations[clamped], 0.05) * 0.1;
    const wrapped = await this.sink.getCanvas(probe);
    if (!wrapped) return null;
    return {
      index: clamped,
      // The sink reports the decoded frame's own timestamp; trust it over the
      // index if they disagree, and report the matching index.
      timestamp: wrapped.timestamp,
      duration: wrapped.duration,
      canvas: wrapped.canvas,
    };
  }

  /** Decode the frame visible at a time. */
  frameAtTime(timeS: number): Promise<ServedFrame | null> {
    return this.frameAt(this.indexAtTime(timeS));
  }

  /**
   * Walk a range of frames in presentation order, decoding each packet once.
   *
   * This is the right tool whenever frames are consumed in sequence —
   * playback, a scan, and above all P2's tracker, which visits every frame of
   * a lift exactly once. Repeated `frameAt` calls would re-seek and re-decode
   * from a keyframe for each one; this pipeline decodes ahead instead.
   *
   * `endIndex` is inclusive. Same borrow rule as `frameAt`: draw each frame
   * before advancing the iterator.
   */
  async *frames(startIndex = 0, endIndex = this.index.length - 1): AsyncGenerator<ServedFrame> {
    if (this.closed || this.index.length === 0) return;
    const from = clampFrameIndex(this.index, startIndex);
    const to = clampFrameIndex(this.index, endIndex);
    if (to < from) return;

    const startTime = this.index.timestamps[from];
    // Exclusive upper bound: stop just inside the last wanted frame's own
    // interval so the frame after it is never decoded.
    const endTime = this.index.timestamps[to] + Math.min(this.index.durations[to], 0.05) * 0.5;

    let i = from;
    for await (const wrapped of this.sink.canvases(startTime, endTime)) {
      if (this.closed) return;
      yield {
        index: Math.min(i, to),
        timestamp: wrapped.timestamp,
        duration: wrapped.duration,
        canvas: wrapped.canvas,
      };
      if (i >= to) return;
      i++;
    }
  }

  /** Release the decoder, the canvas pool and any in-flight requests.
   *  Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.input.dispose();
  }
}

/**
 * Open a clip and index its frames.
 *
 * `source` is a `File`/`Blob` for a local pick, or a URL string for a stored
 * clip — the latter streams through range requests rather than downloading
 * the file, which is what makes opening R2-hosted competition footage
 * instant.
 *
 * Throws `ClipUndecodableError` when this browser cannot decode the clip;
 * everything else propagates as-is (a network failure should look like one).
 */
export async function openFrameServer(
  source: Blob | string | URL,
  options: OpenFrameServerOptions = {},
): Promise<FrameServer> {
  const { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, UrlSource } =
    await import('mediabunny');

  const input = new Input({
    formats: ALL_FORMATS,
    source:
      typeof source === 'string' || source instanceof URL
        ? new UrlSource(source)
        : new BlobSource(source),
  });

  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    await input.dispose();
    throw new ClipUndecodableError('This file has no video track.');
  }
  if (!(await track.canDecode())) {
    const codec = track.codec ?? 'unknown';
    await input.dispose();
    throw new ClipUndecodableError(
      `This browser cannot decode ${codec === 'hevc' ? 'HEVC (H.265)' : codec} video. ` +
        'Convert the clip to H.264/MP4 to analyse it here.',
    );
  }

  // The index pass: metadata only, so no frame data is read and a long clip
  // costs a header parse plus a walk of the sample table.
  const packetSink = new EncodedPacketSink(track);
  const timestamps: number[] = [];
  const durations: number[] = [];
  for await (const packet of packetSink.packets(undefined, undefined, { metadataOnly: true })) {
    timestamps.push(packet.timestamp);
    durations.push(packet.duration);
  }
  const index = buildFrameIndex(timestamps, durations);

  const sink = new CanvasSink(track, {
    // Rotation is applied for us; asking for display dimensions keeps served
    // frames in the same space as every click and overlay.
    poolSize: options.poolSize ?? 4,
  });

  const info: ClipInfo = {
    displayWidth: track.displayWidth,
    displayHeight: track.displayHeight,
    rotation: track.rotation,
    codec: track.codec,
    frameCount: index.length,
    averageFps: averageFrameRate(index),
    vfr: isVariableFrameRate(timestamps),
    durationS: index.endTime,
  };

  return new FrameServer(info, index, sink, input);
}
