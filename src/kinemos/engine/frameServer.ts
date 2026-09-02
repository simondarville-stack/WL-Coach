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
 * Are these timestamps variable-rate?
 *
 * THE one VFR rule in KinEMOS. The import probe (`lib/kinemosProbe.ts`)
 * re-exports this and applies it to a packet sample; the frame server applies
 * it to the full table. A clip called constant at import but variable in the
 * viewer would be graded on one basis and measured on another, so the rule
 * lives here and nowhere else (design §4 rule 3 — single source of truth).
 *
 * Timestamps are sorted first (packets arrive in decode order; with B-frames
 * presentation order differs), then successive deltas are compared to their
 * median. Container-timescale rounding wobbles CFR deltas by a tick — a
 * 600-tick QuickTime timescale can only write 59,94 fps as mostly 10-tick gaps
 * with an 11 slipped in — so the test is a tolerance, not equality: a clip is
 * VFR when more than 5 % of deltas sit over 15 % away from the median. Real
 * phone VFR swings far wider than that; a splice or a dropped frame stays
 * under the 5 %.
 *
 * Null when the sample is too small to judge.
 */
export function detectVfr(timestamps: readonly number[]): boolean | null {
  if (timestamps.length < 24) return null;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length < 12) return null;
  const median = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
  if (!(median > 0)) return null;
  const outliers = deltas.filter(d => Math.abs(d - median) > median * 0.15).length;
  return outliers / deltas.length > 0.05;
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

  // A duplicate presentation timestamp is a muxing artefact, not a frame the
  // coach can step to; left in the table, "next frame" becomes a no-op that
  // reads as a frozen viewer. Exact equality is the right test: these are
  // container timestamps, not computed floats.
  let kept = 0;
  for (let i = 0; i < timestamps.length; i++) {
    if (kept === 0 || timestamps[i] !== timestamps[kept - 1]) timestamps[kept++] = timestamps[i];
  }
  timestamps.length = kept;

  if (timestamps.length === 0) {
    throw new FrameServerUnavailableError('This clip contains no video frames.');
  }

  const lastDuration =
    timestamps.length > 1
      ? timestamps[timestamps.length - 1] - timestamps[timestamps.length - 2]
      : 0;
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

  // ── The decode queue ──────────────────────────────────────────────────────
  //
  // ONE decode at a time, always. `CanvasSink` wraps a single `VideoDecoder`
  // walking a single demuxer, and overlapping `getCanvas` calls on it do not
  // queue — past a handful in flight they simply stop resolving, and they never
  // reject either. The picture then freezes for the rest of the session while
  // the transport, the readouts and the overlay all carry on, which reads as a
  // viewer that lost sync rather than a decoder that stalled.
  //
  // It is not a rare case. Dragging the scrub strip, holding the step key or
  // stepping quickly through a turnover — the things a coach does constantly —
  // each fire a request per frame plus a prefetch fan, so hundreds pile up in a
  // second or two. Serialising them costs nothing (there is one decoder either
  // way) and is the whole fix.
  //
  // What ordering buys, on top: while a queue is draining the coach has usually
  // moved on, so the newest request is the one they are waiting for. Jobs are
  // taken by priority — a request the coach is watching for beats a prefetch —
  // and newest-first within a priority.
  interface DecodeJob {
    index: number;
    priority: number;
    seq: number;
    resolve: (frame: ServedFrame) => void;
    reject: (error: unknown) => void;
  }

  /** A frame someone is waiting to see, versus one decoded speculatively. */
  const WANTED = 1;
  const SPECULATIVE = 0;

  /** How many speculative frames may sit in the queue. Beyond this the oldest
   *  are dropped: a prefetch for where the playhead WAS is worth nothing once
   *  it has moved, and letting them accumulate would delay every real request
   *  behind a queue of stale work. */
  const MAX_SPECULATIVE_QUEUED = 8;

  const queued = new Map<number, DecodeJob>();
  let nextSeq = 0;
  let draining = false;

  function takeNext(): DecodeJob | null {
    let best: DecodeJob | null = null;
    for (const job of queued.values()) {
      if (
        !best ||
        job.priority > best.priority ||
        (job.priority === best.priority && job.seq > best.seq)
      ) {
        best = job;
      }
    }
    if (best) queued.delete(best.index);
    return best;
  }

  function trimSpeculative(): void {
    let over = 0;
    for (const job of queued.values()) if (job.priority === SPECULATIVE) over++;
    while (over > MAX_SPECULATIVE_QUEUED) {
      let oldest: DecodeJob | null = null;
      for (const job of queued.values()) {
        if (job.priority !== SPECULATIVE) continue;
        if (!oldest || job.seq < oldest.seq) oldest = job;
      }
      if (!oldest) return;
      queued.delete(oldest.index);
      inFlight.delete(oldest.index);
      oldest.reject(new FrameServerUnavailableError('Prefetch dropped: the playhead moved on.'));
      over--;
    }
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const job = takeNext();
        if (!job) return;
        if (closed) {
          inFlight.delete(job.index);
          job.reject(new FrameServerUnavailableError('Frame server is closed.'));
          continue;
        }
        try {
          const frame = await decodeAt(job.index);
          if (!closed) cache.set(job.index, frame);
          job.resolve(frame);
        } catch (error) {
          job.reject(error);
        } finally {
          inFlight.delete(job.index);
        }
      }
    } finally {
      draining = false;
    }
  }

  function request(index: number, priority = WANTED): Promise<ServedFrame> {
    const cached = cache.get(index);
    if (cached) return Promise.resolve(cached);

    const already = queued.get(index);
    if (already) {
      // A speculative decode the coach is now actually waiting for: promote it
      // rather than queueing the same frame twice.
      if (priority > already.priority) {
        already.priority = priority;
        already.seq = nextSeq++;
      }
      return inFlight.get(index)!;
    }

    const pending = inFlight.get(index);
    if (pending) return pending;

    let resolve!: (frame: ServedFrame) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<ServedFrame>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    inFlight.set(index, promise);
    queued.set(index, { index, priority, seq: nextSeq++, resolve, reject });
    if (priority === SPECULATIVE) trimSpeculative();
    void drain();
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
        void request(i, SPECULATIVE).catch(() => undefined);
      }
    },

    nearestIndex(t: number) {
      return nearestIndexIn(timestamps, t);
    },

    close() {
      closed = true;
      cache.clear();
      inFlight.clear();
      // Anyone waiting on a queued frame gets an answer rather than a promise
      // that never settles — the failure this whole queue exists to remove.
      for (const job of queued.values()) {
        job.reject(new FrameServerUnavailableError('Frame server is closed.'));
      }
      queued.clear();
      input.dispose();
    },
  };
}
