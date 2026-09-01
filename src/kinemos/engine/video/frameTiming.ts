/**
 * frameTiming — the timestamp arithmetic the viewer and the tracker both stand
 * on. Pure functions over numbers; no decoding, no DOM, no EMOS.
 *
 * Why a module of its own: "which frame am I on" is the question every other
 * KinEMOS feature asks, and the obvious answer — `currentTime * fps` — is
 * wrong on exactly the footage coaches film. A phone shooting in low light
 * silently drops to variable frame rate, so frame 90 is not at 1,5 s, and an
 * HTML5 `<video>` seek lands on "a frame near there" rather than a frame the
 * coach chose. Velocity is dx/dt: a wrong dt is a wrong number on a screen
 * that claims ±0,02 m/s (design §6.3, §6.4).
 *
 * So KinEMOS never derives a frame from a nominal fps. It builds an index of
 * the real presentation timestamps once, and every seek, step and metric is an
 * index into that array.
 */

/**
 * One clip's frames in presentation order.
 *
 * `timestamps[i]` is when frame `i` is shown, in seconds. Monotonically
 * increasing, deduplicated. `durations[i]` is how long it stays up — needed
 * because on VFR footage it varies, and the last frame's duration is the only
 * thing that says where the clip actually ends.
 */
export interface FrameIndex {
  readonly timestamps: Float64Array;
  readonly durations: Float64Array;
  /** Frame count. */
  readonly length: number;
  /** End of the last frame, i.e. the clip's presentation duration. */
  readonly endTime: number;
}

export const EMPTY_FRAME_INDEX: FrameIndex = {
  timestamps: new Float64Array(0),
  durations: new Float64Array(0),
  length: 0,
  endTime: 0,
};

/**
 * Build a frame index from raw packet timing.
 *
 * Packets arrive in *decode* order — with B-frames that is not presentation
 * order — so timestamps are sorted before anything else. Duplicates are
 * dropped: a duplicate presentation timestamp is not a frame the coach can
 * step to, and leaving it in would make "next frame" a no-op that reads as a
 * frozen UI.
 *
 * A missing or non-positive duration is filled from the gap to the next frame,
 * which is what the container would have shown anyway; the final frame falls
 * back to the median gap.
 */
export function buildFrameIndex(
  rawTimestamps: readonly number[],
  rawDurations?: readonly number[],
): FrameIndex {
  const pairs: { t: number; d: number }[] = [];
  for (let i = 0; i < rawTimestamps.length; i++) {
    const t = rawTimestamps[i];
    if (!Number.isFinite(t)) continue;
    const d = rawDurations?.[i];
    pairs.push({ t, d: Number.isFinite(d) && (d as number) > 0 ? (d as number) : 0 });
  }
  if (pairs.length === 0) return EMPTY_FRAME_INDEX;

  pairs.sort((a, b) => a.t - b.t);

  const timestamps: number[] = [];
  const durations: number[] = [];
  for (const p of pairs) {
    // Exact equality is the right test: these are container timestamps, not
    // computed floats, and two frames genuinely sharing a presentation time
    // is a muxing artefact rather than something to step through.
    if (timestamps.length > 0 && p.t === timestamps[timestamps.length - 1]) continue;
    timestamps.push(p.t);
    durations.push(p.d);
  }

  // Gaps first, so a missing duration can borrow from its successor.
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1]);
  const medianGap =
    gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;

  for (let i = 0; i < durations.length; i++) {
    if (durations[i] > 0) continue;
    durations[i] = i + 1 < timestamps.length ? timestamps[i + 1] - timestamps[i] : medianGap;
  }

  const last = timestamps.length - 1;
  return {
    timestamps: Float64Array.from(timestamps),
    durations: Float64Array.from(durations),
    length: timestamps.length,
    endTime: timestamps[last] + durations[last],
  };
}

/**
 * The frame visible at `timeS`: the last frame whose presentation timestamp is
 * at or before it — the same rule a player follows, so the index agrees with
 * what the eye sees.
 *
 * A time before the first frame clamps to 0 rather than returning -1: the
 * viewer always has a frame to show, and a negative index would have to be
 * handled at every call site.
 */
export function frameIndexAtTime(index: FrameIndex, timeS: number): number {
  const { timestamps, length } = index;
  if (length === 0) return 0;
  if (!Number.isFinite(timeS) || timeS <= timestamps[0]) return 0;
  if (timeS >= timestamps[length - 1]) return length - 1;

  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    // Upper mid, so the loop settles on the last index at or before timeS
    // instead of spinning between two neighbours.
    const mid = Math.ceil((lo + hi) / 2);
    if (timestamps[mid] <= timeS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Clamp an arbitrary integer to a valid frame index. Stepping past either end
 *  parks on the end frame — the coach's key repeat should stop, not wrap. */
export function clampFrameIndex(index: FrameIndex, i: number): number {
  if (index.length === 0) return 0;
  if (!Number.isFinite(i)) return 0;
  return Math.min(index.length - 1, Math.max(0, Math.trunc(i)));
}

/**
 * Mean frame rate over the whole clip: frames per second of presentation time.
 *
 * Derived from the index rather than the container's declared rate, because a
 * declared 60 fps on a clip that actually delivered 47 is exactly the lie the
 * quality grade exists to catch. Null when there is nothing to measure.
 */
export function averageFrameRate(index: FrameIndex): number | null {
  if (index.length < 2) return null;
  const span = index.timestamps[index.length - 1] - index.timestamps[0];
  if (!(span > 0)) return null;
  return (index.length - 1) / span;
}

/**
 * Whether frame timing is variable rather than constant.
 *
 * Successive gaps are compared to their median. Container-timescale rounding
 * wobbles constant-rate gaps by a tick, so the test is a tolerance rather than
 * equality: VFR is called when more than 5 % of gaps sit over 15 % away from
 * the median. Real phone VFR swings far wider than that, while an occasional
 * splice or dropped frame stays under the 5 %.
 *
 * Takes raw timestamps (not a FrameIndex) so the import probe can call it on a
 * cheap packet sample, long before a full index is worth building. Null when
 * the sample is too small to mean anything.
 */
export function isVariableFrameRate(timestamps: readonly number[]): boolean | null {
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
