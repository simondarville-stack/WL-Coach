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
import type { VideoSampleSink } from 'mediabunny';
import { readLumaRegion } from './lumaRegion';
import type { FrameRegion, GrayImage } from './tracker';

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
  /**
   * Every frame in presentation order, streamed. One decoder run from the
   * first frame to the last, no per-frame seek and no cache: the activity
   * scan's way of seeing a whole clip. Measured on the testset (07/09/2026,
   * 1080p H.264, 160 px thumbnails) this costs 16 ms per frame where
   * `frameAt` frame by frame cost 89 — the per-call retrieval, not the
   * decode, is the price. `onFrame` returning `false` stops the walk. Not to
   * be interleaved with `frameAt` on the same server: both drive the one
   * decoder. Absent on a server that cannot stream (tests' mocks).
   */
  stream?(onFrame: (frame: ServedFrame) => boolean | void, fromIndex?: number): Promise<number>;
  /** Warm the cache around `index`, in presentation order. Best-effort and
   *  never rejects — a failed prefetch is a slower step, not an error. */
  prefetch(index: number, radius?: number): void;
  /** Frame whose timestamp is closest to `t`. */
  nearestIndex(t: number): number;
  /**
   * The luma of a display-space region of frame `index`, copied from the
   * decoded frame's Y plane with no canvas in between (P6 plan §4). Null
   * when the path is not available for this clip (served downscaled, a
   * format with no readable luma) or the region is off the frame — the
   * caller then reads the canvas as before. Absent on servers that do not
   * decode (the tests' stand-ins). Callers gate it behind
   * `lumaRegionReadsEnabled()`; the server itself is flag-free.
   */
  luma?(index: number, region: FrameRegion): Promise<GrayImage | null>;
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
 * Indices to warm around `index`, nearest first and forward-biased. The
 * server's own prefetch no longer looks behind the playhead (see `prefetch`
 * below: a frame behind the forward run costs a seek); this stays as the
 * pure, testable form of the two-sided policy for anyone warming a cache
 * that is not a decoder run.
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

/** Upper bound on decoded frames held in memory, bytes. See the cache sizing
 *  in `openFrameServer`. */
export const CACHE_BUDGET_BYTES = 384 * 1024 * 1024;

export async function openFrameServer(
  src: FrameSource,
  options: OpenFrameServerOptions = {},
): Promise<FrameServer> {
  const { cacheSize = 24, maxEdge = null } = options;

  // Dynamic import keeps mediabunny's ~570 kB out of every bundle that does not
  // decode video — the same rule the clip editor and the probe follow.
  const {
    ALL_FORMATS,
    BlobSource,
    CanvasSink,
    EncodedPacketSink,
    Input,
    UrlSource,
    VideoSampleSink: SampleSink,
  } = await import('mediabunny');

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

  // The cache is sized in frames but bounded in bytes. Twenty-four 1080p
  // frames are 200 MB of RGBA; twenty-four 8K frames would be 3,2 GB, and the
  // testset's 7680 × 4320 clip (04/09/2026) is exactly that. Past the budget
  // the count comes down — to two at 8K, which still covers a step in each
  // direction from a frame the decoder has just produced.
  const frameBytes = servedWidth * servedHeight * 4;
  const boundedCacheSize = Math.max(2, Math.min(cacheSize, Math.floor(CACHE_BUDGET_BYTES / frameBytes)));
  const cache = new FrameCache<ServedFrame>(boundedCacheSize);
  const inFlight = new Map<number, Promise<ServedFrame>>();
  let closed = false;

  // ── Luma-region reads (P6 plan §4) ────────────────────────────────────────
  //
  // A second sink on the same track hands over the decoder's own frames, so a
  // region's Y plane can be copied straight out of one. Built on first use
  // and never when nobody asks — the flag lives with the caller. Serialised
  // on its own chain for the same reason the canvas decodes are queued: a
  // sink's decoder does not take overlapping requests. Not available when
  // the clip is served downscaled: the decoder's frame is full size and the
  // tracker's coordinates would not be.
  //
  // What this cannot know without a browser: whether two decoders on one
  // demuxer contend, and what a forward run of `getSample` costs against the
  // canvas sink's cached run. Both are on the plan's local list.
  let sampleSink: VideoSampleSink | null = null;
  let lumaChain: Promise<unknown> = Promise.resolve();
  const lumaAvailable = sinkOptions.width === undefined;
  // Pinned here, where the null check above has already run: a closure
  // cannot see through `let track`'s narrowing.
  const lumaTrack = track;
  const rotation = track.rotation;

  function lumaAt(index: number, region: FrameRegion): Promise<GrayImage | null> {
    if (closed || !lumaAvailable) return Promise.resolve(null);
    const clamped = Math.max(0, Math.min(timestamps.length - 1, Math.round(index)));
    const run = async (): Promise<GrayImage | null> => {
      if (closed) return null;
      sampleSink ??= new SampleSink(lumaTrack);
      const timestamp = timestamps[clamped];
      // The same single retry the canvas decode gets.
      let sample = await sampleSink.getSample(timestamp).catch(() => null);
      if (!sample) sample = await sampleSink.getSample(timestamp);
      if (!sample) return null;
      try {
        return await readLumaRegion(sample, region, rotation);
      } finally {
        sample.close();
      }
    };
    const result = lumaChain.then(run, run);
    lumaChain = result.catch(() => undefined);
    return result;
  }

  // ── The decode run ────────────────────────────────────────────────────────
  //
  // `CanvasSink.getCanvas(t)` is not a seek into a running decoder. mediabunny
  // builds a fresh `VideoDecoder` for every call, decodes from the previous
  // key frame up to `t`, hands that one frame over and closes the decoder
  // again. On the testset's 1080×1920 HEVC 60 fps clip (GOP 56) that is
  // 57–75 ms a frame at the median and 200 ms at the 90th percentile
  // (`verify/playback-probe.html`, 08/09/2026), against 16–25 ms a frame from
  // one decoder walking forward. Playback at 1× showed 13 of 240 frames; at
  // 0,25× every other one; a held → key crawled.
  //
  // So the server keeps ONE forward run open — `canvasSink.canvases(t)`, a
  // single decoder in presentation order — and serves a request by pulling
  // from it whenever the frame is at or a little ahead of where the run
  // stands. Playback, a held → key, a ⇧→ ten-frame jump and the tracker's
  // forward walk all become one decode a frame, and the run pre-decodes a
  // few frames ahead on its own while the coach looks. A request the run
  // cannot reach — behind it, or far ahead across a key frame — closes the
  // run and opens one at the target, which costs exactly what `getCanvas`
  // cost, so no gesture got slower. A run opened for a backward step starts
  // `BACKFILL` frames early and caches what it passes: the frames between the
  // key frame and the target are decoded either way, and keeping the last few
  // is what a ← held down needs.
  interface DecodeRun {
    iterator: AsyncIterator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number }>;
    /** Index the next pull will yield. */
    next: number;
  }
  let run: DecodeRun | null = null;

  /** How far ahead of the run a frame may be and still be walked to rather
   *  than sought. Ten frames is the ⇧→ jump; the rest is the playback loop
   *  landing a few frames past the run when a decode ran long. Measured
   *  (`verify/pull-probe.html`, the 60 fps HEVC clip): a pull is ~5 ms, a
   *  seek 67–90 ms wherever it lands in the GOP — the decoder runs from the
   *  key frame at hardware speed and converts nothing on the way. So a walk
   *  pays up to about sixteen frames and not beyond, even inside one GOP:
   *  the first version walked whole GOPs and turned a random seek from 80 ms
   *  into 500. */
  const RUN_REACH = 16;
  /** Frames a seek for a STEP BACK starts early, so the next steps back are
   *  served from the cache: twelve pulls at ~5 ms buy twelve free steps. A
   *  jump — a scrub, a rep, Home — gets no backfill; the coach may never
   *  step back from it, and every backfilled frame would be paid for on the
   *  jump itself. Half the cache at most: the frames the coach just looked
   *  at are worth keeping too. */
  const BACKFILL = Math.min(12, Math.floor(boundedCacheSize / 2));
  /** A request this close behind the previous one is a step back. */
  const STEP_BACK_REACH = 3;
  /** The index most recently asked for through `frameAt`, cache hits
   *  included — what "a step back" is measured from. */
  let lastAsked: number | null = null;

  /** Index of the container's last declared key frame at or before `index`
   *  — a claim, not a fact (see the packet pass above), so it only ever
   *  decides where a run starts, never what it yields. */
  function keyframeIndexBefore(index: number): number {
    const t = timestamps[index];
    if (keyframeTimestamps.length === 0 || keyframeTimestamps[0] > t) return 0;
    let lo = 0;
    let hi = keyframeTimestamps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (keyframeTimestamps[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return nearestIndexIn(timestamps, keyframeTimestamps[lo]);
  }

  async function endRun(): Promise<void> {
    const ending = run;
    run = null;
    if (!ending) return;
    try {
      await ending.iterator.return?.();
    } catch {
      // A run that failed on the way out has nothing left to release.
    }
  }

  function openRun(startIndex: number): DecodeRun {
    const iterator = canvasSink.canvases(timestamps[startIndex])[Symbol.asyncIterator]();
    return { iterator, next: startIndex };
  }

  /** Can the open run serve `index` by walking forward? */
  function runReaches(index: number): boolean {
    return run !== null && index >= run.next && index - run.next <= RUN_REACH;
  }

  /** Where a fresh run for `index` starts: `backfill` frames early, but never
   *  before the key frame the decoder has to start from anyway. */
  function runStartFor(index: number, backfill: number): number {
    return Math.max(0, keyframeIndexBefore(index), index - backfill);
  }

  /** Pull from the open run until `index` comes out, caching every frame on
   *  the way — they are decoded regardless, and a step back wants them. */
  async function pullTo(index: number): Promise<ServedFrame> {
    for (;;) {
      const active = run;
      if (!active || closed) throw new FrameServerUnavailableError('Frame server is closed.');
      const result = await active.iterator.next();
      if (closed) throw new FrameServerUnavailableError('Frame server is closed.');
      if (result.done) {
        run = null;
        throw new FrameServerUnavailableError(`Frame ${index + 1} could not be decoded.`);
      }
      const at = nearestIndexIn(timestamps, result.value.timestamp);
      active.next = at + 1;
      const frame: ServedFrame = { index: at, timestamp: timestamps[at], canvas: result.value.canvas };
      cache.set(at, frame);
      if (at >= index) return frame;
    }
  }

  async function decodeAt(index: number, backfill: number): Promise<ServedFrame> {
    try {
      if (!runReaches(index)) {
        await endRun();
        run = openRun(runStartFor(index, backfill));
      }
      return await pullTo(index);
    } catch (error) {
      if (closed) throw error;
      // One retry, on a fresh run at the frame itself. A hardware decoder
      // under memory pressure — the 8K clip again — can fail a single decode
      // and be perfectly able to do the next; the second failure is the real
      // answer.
      await endRun();
      run = openRun(index);
      try {
        return await pullTo(index);
      } catch (again) {
        await endRun();
        throw new FrameServerUnavailableError(
          `Frame ${index + 1} could not be decoded (${again instanceof Error ? again.message : 'unknown error'}).`,
        );
      }
    }
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
  // What ordering buys, on top: jobs are taken by priority — a request the
  // coach is watching for beats a prefetch — and within a priority by what
  // the open run can reach cheapest: the lowest index at or ahead of the run
  // (a pull), else the lowest index at all (one seek and a walk that serves
  // the rest from cache, instead of a seek each). The viewer's hooks keep a
  // single wanted request in flight, so "newest" and "only" are the same job
  // there; what this order shapes is a batch — the tracker's backward run,
  // an export, the tests.
  interface DecodeJob {
    index: number;
    priority: number;
    seq: number;
    /** Frames to start early if this job has to seek — set for a step back. */
    backfill: number;
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
    const position = run ? run.next : Number.POSITIVE_INFINITY;
    // 0 = a pull from the open run, 1 = a seek.
    const cost = (job: DecodeJob) => (job.index >= position ? 0 : 1);
    for (const job of queued.values()) {
      if (
        !best ||
        job.priority > best.priority ||
        (job.priority === best.priority &&
          (cost(job) < cost(best) || (cost(job) === cost(best) && job.index < best.index)))
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
        // A walk for an earlier job may have passed this frame since it was
        // queued; the cache is checked again so a batch behind the run costs
        // one seek, not one per frame.
        const cached = cache.get(job.index);
        if (cached) {
          inFlight.delete(job.index);
          job.resolve(cached);
          continue;
        }
        try {
          const frame = await decodeAt(job.index, job.backfill);
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

  function request(index: number, priority = WANTED, backfill = 0): Promise<ServedFrame> {
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
    queued.set(index, { index, priority, seq: nextSeq++, backfill, resolve, reject });
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
      const previous = lastAsked;
      lastAsked = clamped;
      const stepBack =
        previous !== null && clamped < previous && previous - clamped <= STEP_BACK_REACH;
      return request(clamped, WANTED, stepBack ? BACKFILL : 0);
    },

    prefetch(index: number, radius = 3) {
      if (closed) return;
      // Ahead only. A frame behind the playhead would close the forward run
      // and reopen one at the key frame — the cost this run exists to avoid
      // — and the frames behind are already in the cache from the walk that
      // reached here, or from the backfill of the seek that did.
      // And never so far that the frame on screen and the one before it are
      // evicted: on the 8K clip the cache holds two frames, and a fan of four
      // would push both out before the coach steps back.
      const from = Math.round(index);
      const ahead = Math.min(radius, Math.max(0, boundedCacheSize - 2));
      for (let i = from + 1; i <= from + ahead && i < timestamps.length; i++) {
        if (cache.has(i) || inFlight.has(i)) continue;
        void request(i, SPECULATIVE).catch(() => undefined);
      }
    },

    nearestIndex(t: number) {
      return nearestIndexIn(timestamps, t);
    },

    async stream(onFrame, fromIndex = 0) {
      if (closed) throw new FrameServerUnavailableError('Frame server is closed.');
      // The walk is its own decoder run; the stepping run gives way so the
      // clip is not on two decoders at once.
      await endRun();
      let served = 0;
      const start = Math.max(0, Math.min(timestamps.length - 1, Math.round(fromIndex)));
      for await (const wrapped of canvasSink.canvases(timestamps[start])) {
        if (closed) break;
        served++;
        const index = nearestIndexIn(timestamps, wrapped.timestamp);
        const go = onFrame({ index, timestamp: wrapped.timestamp, canvas: wrapped.canvas });
        if (go === false) break;
      }
      return served;
    },

    luma: lumaAt,

    close() {
      closed = true;
      void endRun();
      cache.clear();
      inFlight.clear();
      sampleSink = null;
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
