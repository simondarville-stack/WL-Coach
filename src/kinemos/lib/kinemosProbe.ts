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
  width: number | null;
  height: number | null;
  deviceMake: string | null;
  deviceModel: string | null;
  recordedAt: string | null;
}

export const EMPTY_PROBE: ClipProbe = {
  durationS: null,
  fps: null,
  width: null,
  height: null,
  deviceMake: null,
  deviceModel: null,
  recordedAt: null,
};

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
export async function probeClip(file: File): Promise<ClipProbe> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

    const track = await input.getPrimaryVideoTrack();

    // Each of these can fail on its own (a truncated clip computes a duration
    // but no packet stats), so none of them may take the others down.
    const [durationS, fps, tags] = await Promise.all([
      input.computeDuration().catch(() => null),
      track
        ? track
            .computePacketStats(FPS_SAMPLE_PACKETS)
            .then(stats => stats.averagePacketRate ?? null)
            .catch(() => null)
        : Promise.resolve(null),
      input.getMetadataTags().catch(() => null),
    ]);

    const raw = tags?.raw as Record<string, unknown> | undefined;

    return {
      durationS: Number.isFinite(durationS) ? durationS : null,
      // Phone footage is nominally 30 or 60 fps but measures as 29.97 or
      // 59.94; two decimals keeps that honest without storing float noise.
      fps: fps != null && Number.isFinite(fps) ? Math.round(fps * 100) / 100 : null,
      // Display dimensions, not coded ones: a portrait phone clip is stored
      // landscape with a rotation flag, and the analysis works in the frame
      // the coach actually sees.
      width: track?.displayWidth ?? null,
      height: track?.displayHeight ?? null,
      deviceMake: readTag(raw, MAKE_KEYS),
      deviceModel: readTag(raw, MODEL_KEYS),
      recordedAt: tags?.date instanceof Date ? tags.date.toISOString() : null,
    };
  } catch {
    return EMPTY_PROBE;
  }
}
