/**
 * kinemosProbe — everything a clip can tell us about itself before upload.
 *
 * `videoProbe.ts` already reads duration and captures a poster, which is all
 * the upload guards need. KinEMOS needs more, because the numbers here decide
 * how far a later analysis can be trusted:
 *
 *   - **fps** is the ceiling on temporal resolution. A turnover lasting ~0.15 s
 *     is 9 samples at 60 fps and 4 at 30 — the difference between a peak
 *     velocity worth quoting and one interpolated out of too little.
 *   - **display dimensions** set the spatial resolution: with a 45 cm plate
 *     across ~200 px, one pixel is ~2 mm, and that is what the ±0.02 m/s
 *     "hardcore" tier is spending.
 *   - **device make/model**, where the container kept it, seeds the
 *     model-lookup calibration tier (design §6.1). Frequently absent — upload
 *     paths strip metadata and not every phone writes it — so it is captured
 *     opportunistically and never required.
 *   - **recording date** is when the lift happened, as opposed to when someone
 *     got round to importing it.
 *
 * Every field is optional and every failure is silent: a clip that refuses to
 * be probed still imports, it just carries less provenance and will grade
 * lower when P2 starts grading. mediabunny is dynamically imported so the
 * demuxer stays out of the main bundle.
 */

export interface ClipProbe {
  durationS: number | null;
  fps: number | null;
  /** True when the packet timing says variable frame rate. Velocity is dx/dt:
   *  a nominal fps on a VFR clip silently corrupts every derived number, so
   *  the engine must know to use real timestamps and the quality grade must
   *  know to dock the clip (design §6.3). Null = could not tell. */
  vfr: boolean | null;
  width: number | null;
  height: number | null;
  /** Container rotation in degrees clockwise (0/90/180/270). Portrait phone
   *  video is stored landscape plus this flag; WebCodecs hands the engine
   *  UNROTATED frames, so click→pixel mapping needs it (design §6.3). */
  rotation: number | null;
  /** Codec id as mediabunny names it: 'avc', 'hevc', 'vp9', 'av1', … */
  codec: string | null;
  /** Whether this browser's WebCodecs can decode the track — what the P2
   *  engine will need on this machine. Machine-dependent, so it gates the
   *  import but is not stored. */
  decodable: boolean | null;
  /** Whether a <video> element claims it can play the clip — what the library
   *  tile and the editor preview need. */
  playable: boolean | null;
  deviceMake: string | null;
  deviceModel: string | null;
  recordedAt: string | null;
}

export const EMPTY_PROBE: ClipProbe = {
  durationS: null,
  fps: null,
  vfr: null,
  width: null,
  height: null,
  rotation: null,
  codec: null,
  decodable: null,
  playable: null,
  deviceMake: null,
  deviceModel: null,
  recordedAt: null,
};

/**
 * VFR judgement from a sample of packet presentation timestamps.
 *
 * Timestamps are sorted first (packets arrive in decode order; with B-frames
 * presentation order differs), then successive deltas are compared to their
 * median. Container-timescale rounding wobbles CFR deltas by a tick, so the
 * test is a tolerance, not equality: a clip is called VFR when more than 5 %
 * of deltas sit over 15 % away from the median — real phone VFR swings far
 * wider than that, while an edit splice or two stays under the 5 %.
 *
 * Exported for tests; null when the sample is too small to judge.
 */
export function isVariableFrameRate(timestamps: number[]): boolean | null {
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

/** Packets sampled to average a frame rate. Enough to ride out variable frame
 *  timing without decoding the clip twice. */
const FPS_SAMPLE_PACKETS = 120;

/**
 * QuickTime/MP4 atoms that carry the recording device.
 *
 * Apple writes `com.apple.quicktime.make` / `.model` via the `keys` atom;
 * many Android writers use the older `©mak` / `©mod` udta atoms. Both are
 * checked because "which phone filmed this" is worth having and neither is
 * reliable on its own.
 */
const MAKE_KEYS = ['com.apple.quicktime.make', '©mak', 'make', 'Make'];
const MODEL_KEYS = ['com.apple.quicktime.model', '©mod', 'model', 'Model'];

/** Raw tag values arrive as strings, byte arrays, or richer objects; only a
 *  clean short string is worth storing as a device name. */
function readTag(
  raw: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!raw) return null;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Long values are almost certainly not a device name — a stray comment
      // atom, or a udta blob decoded as text.
      if (trimmed && trimmed.length <= 64) return trimmed;
    }
  }
  return null;
}

/**
 * Read a clip's technical provenance. Never throws — an unreadable container
 * yields EMPTY_PROBE and the import proceeds without provenance.
 */
/** Sample of packet timestamps read for the VFR judgement. Metadata-only —
 *  no frame data leaves the container. */
const VFR_SAMPLE_PACKETS = 240;

export async function probeClip(file: File): Promise<ClipProbe> {
  try {
    const { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    const track = await input.getPrimaryVideoTrack();

    /** First N packet presentation timestamps, for the VFR call. */
    const sampleTimestamps = async (): Promise<number[]> => {
      if (!track) return [];
      const sink = new EncodedPacketSink(track);
      const times: number[] = [];
      for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
        times.push(packet.timestamp);
        if (times.length >= VFR_SAMPLE_PACKETS) break;
      }
      return times;
    };

    /** Can a <video> element play this? Codec-string based, so an HEVC clip on
     *  a browser without HEVC answers '' rather than optimistically 'maybe'. */
    const canPlay = async (): Promise<boolean | null> => {
      if (!track || typeof document === 'undefined') return null;
      const params = await track.getCodecParameterString();
      if (!params) return null;
      const container = file.type.startsWith('video/') ? file.type : 'video/mp4';
      return document.createElement('video').canPlayType(`${container}; codecs="${params}"`) !== '';
    };

    // Each of these can fail on its own (a truncated clip computes a duration
    // but no packet stats), so none of them may take the others down.
    const [durationS, fps, timestamps, decodable, playable, tags] = await Promise.all([
      input.computeDuration().catch(() => null),
      track
        ? track
            .computePacketStats(FPS_SAMPLE_PACKETS)
            .then(stats => stats.averagePacketRate ?? null)
            .catch(() => null)
        : Promise.resolve(null),
      sampleTimestamps().catch(() => [] as number[]),
      track ? track.canDecode().catch(() => null) : Promise.resolve(null),
      canPlay().catch(() => null),
      input.getMetadataTags().catch(() => null),
    ]);

    const raw = tags?.raw as Record<string, unknown> | undefined;

    return {
      durationS: Number.isFinite(durationS) ? durationS : null,
      // Phone footage is nominally 30 or 60 fps but measures as 29.97 or
      // 59.94; two decimals keeps that honest without storing float noise.
      fps: fps != null && Number.isFinite(fps) ? Math.round(fps * 100) / 100 : null,
      vfr: isVariableFrameRate(timestamps),
      // Display dimensions, not coded ones: a portrait phone clip is stored
      // landscape with a rotation flag, and the analysis works in the frame
      // the coach actually sees.
      width: track?.displayWidth ?? null,
      height: track?.displayHeight ?? null,
      rotation: track?.rotation ?? null,
      codec: track?.codec ?? null,
      decodable,
      playable,
      deviceMake: readTag(raw, MAKE_KEYS),
      deviceModel: readTag(raw, MODEL_KEYS),
      recordedAt: tags?.date instanceof Date ? tags.date.toISOString() : null,
    };
  } catch {
    return EMPTY_PROBE;
  }
}
