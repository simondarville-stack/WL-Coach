/**
 * videoClipEdit — trim and crop a training clip in the browser, before upload.
 *
 * Why client-side: EMOS is a pure SPA with no media backend of its own (the
 * Cloudflare Stream path in `streamUploads.ts` is optional and off by
 * default), so the only place an athlete's phone footage can be shortened is
 * on the phone that filmed it. That is also where it pays best — a 3-minute
 * clip trimmed to the 8 seconds of the actual lift is ~20× fewer bytes over
 * gym wifi, and it is the difference between a clip that clears the
 * `LOG_VIDEO_MAX_SECONDS` cap and one that gets rejected after the upload.
 *
 * The heavy lifting is mediabunny (MPL-2.0, WebCodecs demux/decode/encode/mux),
 * loaded through a dynamic `import()` so none of it lands in the main bundle:
 * an athlete who never opens the editor never downloads the encoder.
 *
 * Rotation is the reason this does not use a hand-rolled canvas pipeline.
 * Phone footage carries a rotation matrix rather than rotated pixels, and
 * mediabunny applies it before the crop — so the rectangle the athlete drags
 * over the preview is the rectangle that comes out.
 */

/**
 * A crop window as fractions (0–1) of the clip's *displayed* frame — after
 * the container's rotation metadata is applied, i.e. the frame as the athlete
 * sees it in the preview.
 *
 * Fractions rather than pixels so the rectangle dragged on a 360-px-wide phone
 * preview means the same thing against the 4K source it was drawn over.
 */
export interface ClipCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Output resolution ceilings, as the longest edge in pixels.
 *
 * `null` keeps the source resolution (and, with no crop, lets a pure trim stay
 * a lossless packet copy). 1080p is the default for anything larger because a
 * coach reviews technique on a phone or a laptop, and 4K of a barbell buys
 * nothing but upload minutes. COACH-CONFIG candidate.
 */
export type ClipResolution = null | 1920 | 1280 | 854;

export const CLIP_RESOLUTIONS: { label: string; maxEdge: ClipResolution }[] = [
  { label: 'Original', maxEdge: null },
  { label: '1080p', maxEdge: 1920 },
  { label: '720p', maxEdge: 1280 },
  { label: '480p', maxEdge: 854 },
];

/**
 * The ceiling review footage opens on. A phone's 4K is downscaled; anything
 * at or under 1080p passes through untouched (see `isResize`), so the common
 * 1080p clip keeps its lossless tail-trim path. Surfaces feeding analysis
 * (KinEMOS) opt out and keep the camera's pixels.
 */
export const REVIEW_CLIP_MAX_EDGE: ClipResolution = 1920;

// ── Review-clip encode profile ──────────────────────────────────────────────
//
// What a transcode is *for* here: a clip the coach's phone or laptop plays
// back smoothly on gym wifi and scrubs frame by frame in the review player.
// mediabunny's defaults aim at a different target — a qualitative "high"
// quality — and on the browsers that support it that becomes fixed-quantizer
// encoding with no bitrate ceiling at all. Handheld gym footage (sensor noise,
// camera shake, a whole platform of people moving) is exactly what a fixed
// quantizer spends bits on: measured against the same source, the output came
// out at a higher bitrate than the phone's own recording, so every trimmed
// clip landed in the review player heavier than the untrimmed original it
// replaced. The player then stalls on the download and the decoder both.
//
// So review transcodes get an explicit, capped bitrate target from pixel
// rate, never above what the source carried, held as a constant rate, plus a
// one-second keyframe cadence (phone recordings' own) so the scrub player's
// seeks decode at most a second of frames rather than mediabunny's two.

/** Bits per pixel per frame at 30 fps, H.264. 0,12 puts 1080p30 at
 *  ~7,5 Mbps — phone-recording territory, transparent for technique review. */
const REVIEW_BITS_PER_PIXEL = 0.12;
/** Bitrate grows sub-linearly with frame rate: consecutive frames at 60 fps
 *  are closer together and cheaper to predict. 60 fps ≈ 1,5× the 30 fps
 *  rate. */
const REVIEW_FPS_EXPONENT = 0.6;
const REVIEW_MIN_BITRATE = 1_000_000;
/** Ceiling for an athlete who insists on "Original" at 4K: 12 Mbps still
 *  streams on gym wifi. */
const REVIEW_MAX_BITRATE = 12_000_000;
/** Keyframe every second — what phone cameras write, and the seek distance
 *  the scrub player's frame-by-frame drag has to decode across. */
export const REVIEW_KEYFRAME_INTERVAL_S = 1;

/**
 * Target bitrate (bits/s) for a review transcode at the *output* size.
 * `fps` and `sourceBitrate` come from the source track when known; a missing
 * frame rate assumes 30, and a source below the model caps the target —
 * re-encoding cannot add detail, only bytes.
 */
export function reviewClipBitrate(
  width: number,
  height: number,
  fps?: number | null,
  sourceBitrate?: number | null,
): number {
  const rate = fps != null && Number.isFinite(fps) && fps > 0 ? fps : 30;
  const model =
    REVIEW_BITS_PER_PIXEL * width * height * 30 * Math.pow(rate / 30, REVIEW_FPS_EXPONENT);
  let target = Math.min(REVIEW_MAX_BITRATE, Math.max(REVIEW_MIN_BITRATE, model));
  if (sourceBitrate != null && Number.isFinite(sourceBitrate) && sourceBitrate > 0) {
    target = Math.min(target, Math.max(REVIEW_MIN_BITRATE, sourceBitrate));
  }
  return Math.round(target / 1000) * 1000;
}

/** A trim window plus an optional crop — the whole edit an athlete can make. */
export interface ClipEdit {
  /** Seconds into the source at which the output starts. */
  start: number;
  /** Seconds into the source at which the output ends. */
  end: number;
  crop: ClipCrop | null;
  /** Longest-edge ceiling for the output, or null to keep the source size. */
  maxEdge: ClipResolution;
}

/** Sub-pixel crop drags and float trim handles both land within this of a
 *  no-op; re-encoding for that would cost quality and time for nothing. */
const NOOP_EPSILON = 0.005;

export const FULL_FRAME: ClipCrop = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Whether the resolution ceiling actually shrinks this frame. A 1080p ceiling
 * on a 1080p clip is not a resize — and must not count as one, or the default
 * ceiling would turn every untouched clip into a needless remux and every
 * tail-trim into a re-encode. Without the frame size (metadata not loaded
 * yet) a set ceiling is assumed to bind.
 */
export function isResize(
  edit: ClipEdit,
  frame?: { w: number; h: number } | null,
): boolean {
  if (edit.maxEdge == null) return false;
  if (!frame) return true;
  const cw = (edit.crop?.w ?? 1) * frame.w;
  const ch = (edit.crop?.h ?? 1) * frame.h;
  return edit.maxEdge < Math.max(cw, ch);
}

/** True when applying this edit would produce the file we already have. */
export function isNoopEdit(
  edit: ClipEdit,
  duration: number,
  frame?: { w: number; h: number } | null,
): boolean {
  const trimmed =
    edit.start > NOOP_EPSILON || edit.end < duration - NOOP_EPSILON;
  const cropped =
    edit.crop != null &&
    (edit.crop.x > NOOP_EPSILON ||
      edit.crop.y > NOOP_EPSILON ||
      edit.crop.w < 1 - NOOP_EPSILON ||
      edit.crop.h < 1 - NOOP_EPSILON);
  return !trimmed && !cropped && !isResize(edit, frame);
}

/**
 * Output pixel dimensions for an edit, given the source's displayed frame.
 *
 * Even numbers throughout: H.264's 4:2:0 chroma subsampling rejects odd
 * width or height on many hardware encoders, and that failure would land
 * after the athlete has already framed the shot.
 */
export function outputDimensions(
  edit: ClipEdit,
  frameWidth: number,
  frameHeight: number,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const cw = (edit.crop?.w ?? 1) * frameWidth;
  const ch = (edit.crop?.h ?? 1) * frameHeight;
  // Never upscale: a 720p ceiling on a 480p clip leaves it at 480p.
  const scale = edit.maxEdge == null ? 1 : Math.min(1, edit.maxEdge / Math.max(cw, ch));
  return { width: even(cw * scale), height: even(ch * scale) };
}

/**
 * Whether this browser can re-encode a clip at all.
 *
 * WebCodecs is the gate: Chrome/Edge/Android since 94, Safari and iOS since
 * 17. Where it is missing the editor is simply not offered and uploads behave
 * exactly as they did before — no degraded editor, no failed encode after the
 * athlete has already framed a crop.
 */
export function clipEditingSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    typeof w.VideoEncoder === 'function' &&
    typeof w.VideoDecoder === 'function' &&
    typeof w.VideoFrame === 'function'
  );
}

/** Thrown when the athlete cancels an in-flight encode. Callers treat it as
 *  "nothing happened", not as a failure worth reporting. */
export class ClipEditCanceledError extends Error {
  constructor() {
    super('Clip edit canceled');
    this.name = 'ClipEditCanceledError';
  }
}

export interface ApplyClipEditOptions {
  /** 0–1, fired as the encode advances. */
  onProgress?: (progress: number) => void;
  /** Abort to cancel; `applyClipEdit` then rejects with ClipEditCanceledError. */
  signal?: AbortSignal;
  /** 1-based piece number, when one recording is split into a clip per lift.
   *  Only affects the output file's name. */
  part?: number;
  /**
   * For footage headed into analysis (KinEMOS): a trim-only edit is done as a
   * keyframe-aligned packet copy — original pixels, fps and timestamps, cut
   * snapped to the keyframe at or before the requested start — instead of the
   * re-encode mediabunny's Conversion performs for any head-trim. Falls back
   * to the normal path when the container defeats the copy. Ignored the
   * moment the edit crops or resizes, which force a transcode anyway.
   */
  preferLossless?: boolean;
  /**
   * What a transcode, when one happens, is encoded for. `review` (the
   * default) applies the capped review profile above — the training log, a
   * competition attempt, a coach's demo. `analysis` leaves mediabunny's
   * quality-first defaults in place: KinEMOS footage that could not stay a
   * packet copy (a crop) should lose as little as the encoder allows.
   */
  purpose?: 'review' | 'analysis';
}

/** Keep the edited name recognisable next to the original in a camera roll
 *  or an upload error, without ever growing an unbounded `-clip-clip-clip`.
 *  `part` numbers the pieces when one recording is split into several lifts. */
function editedFileName(name: string, part?: number): string {
  const base = (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name) || 'clip';
  const trimmedBase = base.endsWith('-clip') ? base : `${base}-clip`;
  return part == null ? `${trimmedBase}.mp4` : `${trimmedBase}-${part}.mp4`;
}

/**
 * Produce a new MP4 containing only `edit`'s time range and crop window.
 *
 * A trim-only edit is a packet copy ONLY when it starts at 0 (tail cut) —
 * mediabunny's Conversion re-encodes for any head-trim, because its copy path
 * requires the trim start at or before the first timestamp. `preferLossless`
 * routes trim-only edits through `losslessTrim.ts` instead, which snaps the
 * cut to a keyframe and copies packets verbatim. A crop or resize forces a
 * transcode either way. The source `File` is untouched — the caller decides
 * whether to upload the result or fall back to the original.
 */
export async function applyClipEdit(
  file: File,
  edit: ClipEdit,
  { onProgress, signal, part, preferLossless, purpose = 'review' }: ApplyClipEditOptions = {},
): Promise<File> {
  if (signal?.aborted) throw new ClipEditCanceledError();

  if (preferLossless && edit.crop == null && edit.maxEdge == null) {
    const { losslessTrimClip } = await import('./losslessTrim');
    const copied = await losslessTrimClip(file, edit.start, edit.end);
    if (signal?.aborted) throw new ClipEditCanceledError();
    if (copied) {
      onProgress?.(1);
      return new File([copied.buffer], editedFileName(file.name, part), { type: 'video/mp4' });
    }
    // null = this container cannot be packet-copied; fall through to the
    // re-encoding path below rather than failing the edit.
  }

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    ConversionCanceledError,
    Input,
    Mp4OutputFormat,
    Output,
    Quality,
  } = await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    // 'in-memory' fast start: the moov atom lands at the front, so the coach's
    // first tap on the tile starts playing instead of fetching the tail first.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  // Crop and resize are both expressed against the track's *display*
  // dimensions, because mediabunny crops after rotation — the same space the
  // preview showed the athlete.
  const video: {
    crop?: { left: number; top: number; width: number; height: number };
    width?: number;
    height?: number;
    fit?: 'fill';
    quality?: InstanceType<typeof Quality>;
    keyFrameInterval?: number;
  } = {};

  const track = await input.getPrimaryVideoTrack();
  if (track) {
    const dw = track.displayWidth;
    const dh = track.displayHeight;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    if (edit.crop) {
      video.crop = {
        left: Math.round(edit.crop.x * dw),
        top: Math.round(edit.crop.y * dh),
        width: even(edit.crop.w * dw),
        height: even(edit.crop.h * dh),
      };
    }
    const out = outputDimensions(edit, dw, dh);
    // Only ask for a resize when it actually changes something — otherwise
    // a trim-only edit would lose its lossless packet-copy path.
    const cropped = video.crop ?? { width: dw, height: dh };
    if (out.width !== cropped.width || out.height !== cropped.height) {
      video.width = out.width;
      video.height = out.height;
      // Aspect ratio is already preserved by outputDimensions, so 'fill'
      // just means "these exact pixels" rather than re-deriving a box.
      video.fit = 'fill';
    }

    // The review profile applies only where mediabunny is going to re-encode
    // anyway — a head-trim, a crop, a resize (the same test its Conversion
    // makes). Asking for a bitrate or keyframe cadence on a tail-only trim
    // would itself force the transcode the packet-copy path avoids.
    const headTrim = edit.start > (await track.getFirstTimestamp());
    const transcodes = headTrim || video.crop != null || video.width != null;
    if (purpose === 'review' && transcodes) {
      let fps: number | null = null;
      let sourceBitrate: number | null = null;
      try {
        // A sample of packets, metadata only — cheap, and enough for a mean.
        const stats = await track.computePacketStats(200);
        fps = stats.averagePacketRate;
        sourceBitrate = stats.averageBitrate;
      } catch {
        // Unknown rate: the model assumes 30 fps and no source cap.
      }
      // Constant rather than variable: the target is a ceiling the player
      // has to stream, and on a clip this short VBR never settles — measured
      // on the encode harness (verify/clip-encode.html) VBR overshot the
      // target by ~70 %, CBR landed on it.
      video.quality = new Quality({
        bitrate: reviewClipBitrate(out.width, out.height, fps, sourceBitrate),
        bitrateMode: 'constant',
      });
      video.keyFrameInterval = REVIEW_KEYFRAME_INTERVAL_S;
    }
  }

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: edit.start, end: edit.end },
    video,
    // The editor is the only caller and already handles discarded tracks via
    // `isValid`; the console warning would just be noise in the gym.
    showWarnings: false,
  });

  if (!conversion.isValid) {
    throw new Error('This clip cannot be edited on this device.');
  }

  if (onProgress) conversion.onProgress = p => onProgress(p);

  const abort = () => void conversion.cancel();
  signal?.addEventListener('abort', abort);
  try {
    await conversion.execute();
  } catch (e) {
    if (e instanceof ConversionCanceledError) throw new ClipEditCanceledError();
    throw e;
  } finally {
    signal?.removeEventListener('abort', abort);
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Edited clip came back empty.');
  return new File([buffer], editedFileName(file.name, part), { type: 'video/mp4' });
}
