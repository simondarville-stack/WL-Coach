/**
 * frameServer — frame-accurate access to a clip's decoded pixels.
 *
 * The named P1 deliverable (docs/KINEMOS_DESIGN.md §12, docs/KINEMOS_P1_PLAN.md
 * W1). Everything the viewer does — stepping, marking, calibrating, measuring —
 * needs to name a frame exactly and get *that* frame back. An
 * `HTMLVideoElement` cannot do this: `currentTime` seeking lands on a nearby
 * frame, not the requested one, and computing a time from a nominal fps breaks
 * outright on the variable-frame-rate footage phones produce (design §6.3).
 *
 * So the clip is demuxed and decoded directly:
 *
 *   - `EncodedPacketSink` in metadata-only mode builds the FRAME INDEX — the
 *     container's own presentation timestamps, sorted. No frame data is read,
 *     so this is cheap even on a multi-minute clip, and it is the only honest
 *     answer to "how many frames are there".
 *   - `CanvasSink` decodes a given timestamp to a canvas, applying the
 *     container's rotation matrix on the way out. That last part matters more
 *     than it looks: WebCodecs decodes portrait phone video UNROTATED, and
 *     without this every click in every tool would need un-rotating by hand,
 *     forever. Downstream, one display-space coordinate system.
 *
 * Addressing rule (P1 plan decision 2): the unit is the TIMESTAMP; the index is
 * a label for the coach ("frame 126 / 218"). Anything computing dt reads
 * `timestamps`, never `i / fps`.
 *
 * Engine purity: this module imports mediabunny and the DOM. Nothing from EMOS,
 * nothing from React (design §4 rule 1).
 */

/** A decoded frame, in display space (rotation already applied). */
export interface ServedFrame {
  /** Index into the frame server's timestamp table. */
  index: number;
  /** Presentation timestamp in seconds, straight from the container. */
  timestamp: number;
  /** Display-space pixels. Owned by the frame server — draw from it, do not
   *  hold it across `close()`. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

/** The clip cannot be decoded here — a codec this browser's WebCodecs lacks
 *  (HEVC is the usual one), or a container mediabunny cannot read. Distinct
 *  from a network failure so the viewer can say which. */
export class FrameServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameServerUnavailableError';
  }
}

export interface FrameServer {
  /** Presentation timestamps in seconds, ascending. The authoritative clock. */
  readonly timestamps: readonly number[];
  /** Timestamps the container DECLARES to be key frames, ascending — a subset
   *  of `timestamps`. Unverified (see the packet pass in `openFrameServer`), so
   *  treat it as a hint, never as a guarantee. */
  readonly keyframeTimestamps: readonly number[];
  readonly frameCount: number;
  readonly durationS: number;
  /** Display dimensions, post-rotation — the coordinate space of every point
   *  the viewer stores. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Container rotation in degrees clockwise, already applied to the canvases.
   *  Recorded on the analysis so a later re-render cannot reinterpret stored
   *  coordinates. */
  readonly rotation: number;
  /** Packet-averaged frame rate. A summary for display; never a divisor. */
  readonly averageFps: number;
  /** True when the real timestamps are not evenly spaced (design §6.3). */
  readonly isVfr: boolean;
  readonly codec: string | null;

  frameAt(index: number): Promise<ServedFrame>;
  /** Warm the cache around `index`, in presentation order. Best-effort and
   *  never rejects — a failed prefetch is a slower step, not an error. */
  prefetch(index: number, radius?: number): void;
  /** Frame whose timestamp is closest to `t`. */
  nearestIndex(t: number): number;
  close(): void;
}

export interface OpenFrameServerOptions {
  /** Decoded frames kept in memory. 24 covers a stepping window in both
   *  directions without holding a whole clip's worth of RGBA. */
  cacheSize?: number;
  /** Longest edge of the served canvas. Frames are served at source resolution
   *  by default: spatial resolution IS measurement accuracy (P0 plan decision
   *  3), so nothing downsamples behind the coach's back. */
  maxEdge?: number | null;
}

/**
 * Nearest index into an ascending timestamp table. Exported for tests and for
 * the timeline strip, which maps a scrub position to a frame.
 *
 * Ties (a scrub landing exactly between two frames) resolve to the earlier
 * frame — stepping forward from there reaches the later one, so no frame is
 * unreachable.
 */
export function nearestIndexIn(timestamps: readonly number[], t: number): number {
  if (timestamps.length === 0) return 0;
  if (t <= timestamps[0]) return 0;
  if (t >= timestamps[timestamps.length - 1]) return timestamps.length - 1;

  let lo = 0;
  let hi = timestamps.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] <= t) lo = mid;
    else hi = mid;
  }
  return t - timestamps[lo] <= timestamps[hi] - t ? lo : hi;
}

/**
 * Are these timestamps variable-rate? Same rule as the import probe
 * (`kinemosProbe.isVariableFrameRate`), applied to the full table rather than a
 * 240-packet sample: a clip is VFR when the spread of frame deltas exceeds 5 %
 * of the median delta. Phones cross that easily; a genuine CFR clip sits at
 * essentially zero.
 *
 * Null when there are too few frames to judge.
 */
export function detectVfr(timestamps: readonly number[]): boolean | null {
  if (timestamps.length < 10) return null;
  const deltas: number[] = [];
  for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
  deltas.sort((a, b) => a - b);
  const median = deltas[deltas.length >> 1];
  if (!(median > 0)) return null;
  // Trimmed range: the 5th and 95th percentiles, so one dropped frame in a
  // recording does not by itself brand the clip variable.
  const lo = deltas[Math.floor(deltas.length * 0.05)];
  const hi = deltas[Math.floor(deltas.length * 0.95)];
  return (hi - lo) / median > 0.05;
}

/**
 * Mean frame rate over the real timestamps. Reported, never used as a divisor —
 * see the addressing rule in the header.
 */
export function averageFpsOf(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  const span = timestamps[timestamps.length - 1] - timestamps[0];
  if (!(span > 0)) return 0;
  return (timestamps.length - 1) / span;
}

/**
 * A tiny insertion-ordered LRU. Values are canvases, which the caller must be
 * able to release on eviction — hence `onEvict`.
 *
 * Exported for tests: eviction order is the difference between smooth stepping
 * and a decoder thrashing on every keypress.
 */
export class FrameCache<T> {
  private readonly map = new Map<number, T>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict?: (value: T) => void,
  ) {}

  get(key: number): T | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: number): boolean {
    return this.map.has(key);
  }

  set(key: number, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const evicted = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
      this.onEvict?.(evicted);
    }
  }

  clear(): void {
    for (const value of this.map.values()) this.onEvict?.(value);
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): number[] {
    return [...this.map.keys()];
  }
}

/**
 * Indices to warm around `index`, nearest first and forward-biased — stepping
 * forward is the common gesture, and the decoder is fastest in presentation
 * order. Pure, so the prefetch policy is testable without a decoder.
 */
export function prefetchOrder(index: number, radius: number, frameCount: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= radius; d++) {
    if (index + d < frameCount) out.push(index + d);
    if (index - d >= 0) out.push(index - d);
  }
  return out;
}

/** What `openFrameServer` accepts: a URL (range-read, the R2 case) or a Blob. */
export type FrameSource = string | Blob;

export async function openFrameServer(
  src: FrameSource,
  options: OpenFrameServerOptions = {},
): Promise<FrameServer> {
  const { cacheSize = 24, maxEdge = null } = options;

  // Dynamic import keeps mediabunny's ~570 kB out of every bundle that does not
  // decode video — the same rule the clip editor and the probe follow.
  const { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input, UrlSource } =
    await import('mediabunny');

  const input = new Input({
    source: typeof src === 'string' ? new UrlSource(src) : new BlobSource(src),
    formats: ALL_FORMATS,
  });

  let track;
  try {
    track = await input.getPrimaryVideoTrack();
  } catch (err) {
    throw new FrameServerUnavailableError(
      `This clip's container could not be read (${err instanceof Error ? err.message : 'unknown error'}).`,
    );
  }
  if (!track) {
    throw new FrameServerUnavailableError('This file has no video track.');
  }

  // A clip that plays in <video> can still be undecodable by WebCodecs — HEVC
  // on a browser without hardware support is the everyday case. P0 refuses
  // imports that BOTH reject; this one only WebCodecs rejects, so it lives in
  // the library and cannot be analysed here. Say so rather than paint black.
  if (!(await track.canDecode())) {
    throw new FrameServerUnavailableError(
      `This browser cannot decode ${track.codec ?? 'this clip'} frame by frame. ` +
        'Safari handles HEVC; Chrome and Firefox generally do not.',
    );
  }

  // ── Frame index: metadata-only packet pass ────────────────────────────────
  //
  // No `verifyKeyPackets` here: mediabunny refuses it alongside `metadataOnly`
  // (verifying a key packet means reading the bitstream, which is exactly what
  // metadata-only skips), and paying for a full data read of every packet to
  // build a timestamp table would defeat the point on a multi-minute clip.
  //
  // The consequence is that `keyframeTimestamps` is the CONTAINER'S CLAIM, not
  // a verified fact. That is fine for what it is used for — a scrub hint and
  // provenance — because nothing here hands those packets to a decoder;
  // `CanvasSink` does its own retrieval. Where a wrong key packet would
  // actually corrupt output, the trim path pays for verification
  // (`src/lib/losslessTrim.ts`).
  const packetSink = new EncodedPacketSink(track);
  const timestamps: number[] = [];
  const keyframeTimestamps: number[] = [];
  for await (const packet of packetSink.packets(undefined, undefined, {
    metadataOnly: true,
  })) {
    timestamps.push(packet.timestamp);
    if (packet.type === 'key') keyframeTimestamps.push(packet.timestamp);
  }
  // Packets arrive in decode order; B-frames mean that is not presentation
  // order. The coach steps through presentation order.
  timestamps.sort((a, b) => a - b);
  keyframeTimestamps.sort((a, b) => a - b);

  if (timestamps.length === 0) {
    throw new FrameServerUnavailableError('This clip contains no video frames.');
  }

  const lastDuration =
    timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[timestamps.length - 2] : 0;
  const durationS = timestamps[timestamps.length - 1] - timestamps[0] + lastDuration;

  const sinkOptions: { width?: number; height?: number; fit?: 'contain'; poolSize?: number } = {
    // A pool would recycle canvases under the cache's feet — the cache holds
    // several frames at once, which is the whole point of it.
    poolSize: 0,
  };
  if (maxEdge && Math.max(track.displayWidth, track.displayHeight) > maxEdge) {
    const scale = maxEdge / Math.max(track.displayWidth, track.displayHeight);
    sinkOptions.width = Math.round(track.displayWidth * scale);
    sinkOptions.height = Math.round(track.displayHeight * scale);
    sinkOptions.fit = 'contain';
  }
  const canvasSink = new CanvasSink(track, sinkOptions);

  const servedWidth = sinkOptions.width ?? track.displayWidth;
  const servedHeight = sinkOptions.height ?? track.displayHeight;

  const cache = new FrameCache<ServedFrame>(cacheSize);
  const inFlight = new Map<number, Promise<ServedFrame>>();
  let closed = false;

  async function decodeAt(index: number): Promise<ServedFrame> {
    const timestamp = timestamps[index];
    const wrapped = await canvasSink.getCanvas(timestamp);
    if (!wrapped) {
      throw new FrameServerUnavailableError(`Frame ${index + 1} could not be decoded.`);
    }
    return { index, timestamp, canvas: wrapped.canvas };
  }

  function request(index: number): Promise<ServedFrame> {
    const cached = cache.get(index);
    if (cached) return Promise.resolve(cached);

    const pending = inFlight.get(index);
    if (pending) return pending;

    const promise = decodeAt(index)
      .then(frame => {
        if (!closed) cache.set(index, frame);
        return frame;
      })
      .finally(() => {
        inFlight.delete(index);
      });
    inFlight.set(index, promise);
    return promise;
  }

  return {
    timestamps,
    keyframeTimestamps,
    frameCount: timestamps.length,
    durationS,
    displayWidth: servedWidth,
    displayHeight: servedHeight,
    rotation: track.rotation,
    averageFps: averageFpsOf(timestamps),
    isVfr: detectVfr(timestamps) ?? false,
    codec: track.codec,

    frameAt(index: number) {
      if (closed) return Promise.reject(new FrameServerUnavailableError('Frame server is closed.'));
      const clamped = Math.max(0, Math.min(timestamps.length - 1, Math.round(index)));
      return request(clamped);
    },

    prefetch(index: number, radius = 3) {
      if (closed) return;
      for (const i of prefetchOrder(Math.round(index), radius, timestamps.length)) {
        if (cache.has(i) || inFlight.has(i)) continue;
        void request(i).catch(() => undefined);
      }
    },

    nearestIndex(t: number) {
      return nearestIndexIn(timestamps, t);
    },

    close() {
      closed = true;
      cache.clear();
      inFlight.clear();
      input.dispose();
    },
  };
}
