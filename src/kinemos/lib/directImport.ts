/**
 * directImport — write and remove KinEMOS's own video rows.
 *
 * The clip has already been through the shared clip editor (`useClipEditor`)
 * by the time it arrives here, so trimming, cropping and resolution are
 * settled; this module's job is provenance and cleanup.
 *
 * Failure ordering follows the contract `trainingLogService` established on
 * the Stream path: bytes are stored first, the row second, and a failed row
 * insert deletes the bytes it would have pointed at. The opposite order would
 * leave a row whose video 404s, which is worse than a few orphaned megabytes.
 */
import { supabase } from '../../lib/supabase';
import { captureVideoPoster } from '../../lib/videoProbe';
import { probeClip } from './kinemosProbe';
import { deleteObject, uploadClip, uploadPoster } from './kinemosStorage';

export interface DirectImportMeta {
  athleteId?: string | null;
  exerciseId?: string | null;
  note?: string | null;
  ownerId?: string | null;
  /** Duration of the file the coach picked, when the editor trimmed it —
   *  so the library can say what was kept out of what. */
  originalDurationS?: number | null;
  trimmed?: boolean;
}

export interface ImportedVideo {
  id: string;
  r2_key: string;
}

/**
 * Import one prepared clip: probe it, store the bytes, store a poster, write
 * the row.
 *
 * The probe runs first and in parallel with nothing else on purpose — it is
 * fast (metadata and a short packet sample, no full decode) and its result
 * decides nothing about the upload, but a probe *after* a successful upload
 * would strand provenance if it failed.
 */
export async function importDirectVideo(
  file: File,
  meta: DirectImportMeta = {},
): Promise<ImportedVideo> {
  const [probe, poster] = await Promise.all([
    probeClip(file),
    // Best-effort, same as every other upload path in the app: no poster
    // means the library tile falls back to a lazy <video>.
    captureVideoPoster(file),
  ]);

  // A clip neither <video> nor WebCodecs can decode here would import as a
  // dead library row — a tile that never plays and footage P2 cannot analyse.
  // Refused before any byte is uploaded. Only when BOTH answers are a firm no:
  // an inconclusive probe never blocks an import (HEVC that plays via
  // hardware <video> but not WebCodecs passes, and P2 grades it later).
  if (probe.decodable === false && probe.playable === false) {
    const codec = probe.codec === 'hevc' ? 'HEVC (H.265)' : probe.codec ?? 'this clip’s codec';
    throw new Error(
      `${codec} cannot be played in this browser — the import would be unwatchable here. ` +
        'Convert the clip to H.264/MP4 and try again.',
    );
  }

  const key = await uploadClip(file);
  const thumbKey = poster ? await uploadPoster(key, poster) : null;

  const { data, error } = await supabase
    .from('kinemos_videos')
    .insert({
      owner_id: meta.ownerId ?? null,
      athlete_id: meta.athleteId ?? null,
      exercise_id: meta.exerciseId ?? null,
      r2_key: key,
      thumb_key: thumbKey,
      original_name: file.name,
      size_bytes: file.size,
      duration_s: probe.durationS,
      fps: probe.fps,
      vfr: probe.vfr,
      width: probe.width,
      height: probe.height,
      rotation: probe.rotation,
      codec: probe.codec,
      device_make: probe.deviceMake,
      device_model: probe.deviceModel,
      trimmed: meta.trimmed ?? false,
      original_duration_s: meta.originalDurationS ?? null,
      recorded_at: probe.recordedAt,
      note: meta.note ?? null,
    })
    .select('id, r2_key')
    .single();

  if (error) {
    // Nothing points at these objects now — leaving them would be a silent
    // storage leak on every failed import.
    await deleteObject(key);
    if (thumbKey) await deleteObject(thumbKey);
    throw error;
  }

  return data as ImportedVideo;
}

/** Remove a direct import: row first, then bytes. A row that survives its
 *  bytes shows a broken tile; bytes that survive their row are invisible and
 *  cheap, so the row goes first. */
export async function deleteDirectVideo(id: string): Promise<void> {
  const { data, error: readError } = await supabase
    .from('kinemos_videos')
    .select('r2_key, thumb_key')
    .eq('id', id)
    .single();
  if (readError) throw readError;

  const { error } = await supabase.from('kinemos_videos').delete().eq('id', id);
  if (error) throw error;

  const row = data as { r2_key: string; thumb_key: string | null };
  await deleteObject(row.r2_key);
  if (row.thumb_key) await deleteObject(row.thumb_key);
}
