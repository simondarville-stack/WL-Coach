/**
 * analysisService — read and write what a coach found in a clip.
 *
 * The four P1 tables (`kinemos_analyses`, `_calibrations`, `_tracks`,
 * `_annotations`) always travel together for one rep, so they are loaded as one
 * bundle and saved piecewise. Components never touch Supabase directly
 * (CLAUDE.md core principle 2).
 *
 * Two rules shape the API:
 *
 *   1. **No row until there is something to store.** Opening a clip to look at
 *      it must not litter the database with empty analyses. `loadBundle`
 *      returns null when a rep has never been worked on; every writer calls
 *      `ensureAnalysis` first, which creates the row on demand.
 *   2. **Last write wins, with a timestamp** (CLAUDE.md core principle 4).
 *      Every update stamps `updated_at`; nothing merges.
 */
import { supabase } from '../../lib/supabase';
import type {
  KinemosAnalysis,
  KinemosAnnotation,
  KinemosCalibration,
  KinemosTrack,
  KinemosTrackPoint,
} from '../../lib/database.types';
import type { Calibration, PlateEllipse } from '../engine/calibration';
import type { LibrarySource } from './videoLibrary';

export interface AnalysisBundle {
  analysis: KinemosAnalysis;
  calibration: KinemosCalibration | null;
  track: KinemosTrack | null;
  annotations: KinemosAnnotation[];
}

/** The library's `LibraryVideo.key` — `log:<uuid>` / `event:<uuid>` /
 *  `direct:<uuid>` — split back into the polymorphic source reference the
 *  analysis rows carry. Null for a key that is not one of the three. */
export function parseClipKey(key: string): { kind: LibrarySource; id: string } | null {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (!id) return null;
  if (kind !== 'log' && kind !== 'event' && kind !== 'direct') return null;
  return { kind, id };
}

export function clipKeyOf(kind: LibrarySource, id: string): string {
  return `${kind}:${id}`;
}

/** Geometry of the frames the points were captured in. Stored on the analysis
 *  so a later reader can tell whether the pixels still mean what they meant. */
export interface FrameGeometry {
  frameWidth: number;
  frameHeight: number;
  rotation: number;
}

/**
 * Every rep already analysed on a clip, oldest rep first. Drives the rep
 * selector; empty for a clip nobody has opened.
 */
export async function listReps(kind: LibrarySource, sourceId: string): Promise<KinemosAnalysis[]> {
  const { data, error } = await supabase
    .from('kinemos_analyses')
    .select('*')
    .eq('source_kind', kind)
    .eq('source_id', sourceId)
    .order('rep_index', { ascending: true });
  if (error) throw error;
  return (data ?? []) as KinemosAnalysis[];
}

/** The whole record for one rep, or null when it has never been worked on. */
export async function loadBundle(
  kind: LibrarySource,
  sourceId: string,
  repIndex: number,
): Promise<AnalysisBundle | null> {
  const { data, error } = await supabase
    .from('kinemos_analyses')
    .select('*')
    .eq('source_kind', kind)
    .eq('source_id', sourceId)
    .eq('rep_index', repIndex)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const analysis = data as KinemosAnalysis;
  const [calibration, track, annotations] = await Promise.all([
    loadCalibration(analysis.id),
    loadTrack(analysis.id),
    listAnnotations(analysis.id),
  ]);
  return { analysis, calibration, track, annotations };
}

async function loadCalibration(analysisId: string): Promise<KinemosCalibration | null> {
  const { data, error } = await supabase
    .from('kinemos_calibrations')
    .select('*')
    .eq('analysis_id', analysisId)
    .maybeSingle();
  if (error) throw error;
  return (data as KinemosCalibration | null) ?? null;
}

async function loadTrack(analysisId: string): Promise<KinemosTrack | null> {
  const { data, error } = await supabase
    .from('kinemos_tracks')
    .select('*')
    .eq('analysis_id', analysisId)
    .eq('kind', 'bar_end')
    .maybeSingle();
  if (error) throw error;
  return (data as KinemosTrack | null) ?? null;
}

export async function listAnnotations(analysisId: string): Promise<KinemosAnnotation[]> {
  const { data, error } = await supabase
    .from('kinemos_annotations')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as KinemosAnnotation[];
}

/**
 * The analysis row for this rep, creating it if this is the first thing the
 * coach has stored about it.
 *
 * The unique constraint on (source_kind, source_id, rep_index) is what makes
 * this safe: two tabs opening the same rep converge on one row rather than
 * racing to create two, and the conflict path re-reads instead of failing.
 */
export async function ensureAnalysis(
  kind: LibrarySource,
  sourceId: string,
  repIndex: number,
  geometry: FrameGeometry,
  ownerId: string | null = null,
): Promise<KinemosAnalysis> {
  const { data, error } = await supabase
    .from('kinemos_analyses')
    .upsert(
      {
        source_kind: kind,
        source_id: sourceId,
        rep_index: repIndex,
        frame_width: geometry.frameWidth,
        frame_height: geometry.frameHeight,
        rotation: geometry.rotation,
        // Spread rather than assigned: this is an UPSERT, and a plain
        // `owner_id: null` would blank an owner already on the row every time
        // a caller happened not to know one.
        ...(ownerId ? { owner_id: ownerId } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_kind,source_id,rep_index' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as KinemosAnalysis;
}

export async function updateAnalysis(
  analysisId: string,
  patch: Partial<Pick<KinemosAnalysis, 'label' | 'mass_kg' | 'mass_source' | 'notes' | 'status'>>,
): Promise<void> {
  const { error } = await supabase
    .from('kinemos_analyses')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', analysisId);
  if (error) throw error;
}

/** Remove a rep and everything hanging off it (cascade). Snapshot JPEGs in R2
 *  are the caller's to clean up — this module does not reach into storage. */
export async function deleteAnalysis(analysisId: string): Promise<void> {
  const { error } = await supabase.from('kinemos_analyses').delete().eq('id', analysisId);
  if (error) throw error;
}

/**
 * Store the confirmed plate outline together with the scales it implies.
 *
 * Both, deliberately: the ellipse so the panel reopens exactly where the coach
 * left it, the derived numbers so any later reader can convert pixels without
 * importing the engine — and, more to the point, without quietly recomputing
 * against a different plate-diameter default than the one that was used.
 */
export async function saveCalibration(
  analysisId: string,
  ellipse: PlateEllipse,
  cal: Calibration,
  frame: { index: number; t: number },
  ownerId: string | null = null,
): Promise<KinemosCalibration> {
  const { data, error } = await supabase
    .from('kinemos_calibrations')
    .upsert(
      {
        analysis_id: analysisId,
        ...(ownerId ? { owner_id: ownerId } : {}),
        frame_index: frame.index,
        frame_t: frame.t,
        ellipse_cx: ellipse.cx,
        ellipse_cy: ellipse.cy,
        semi_major_px: ellipse.semiMajorPx,
        semi_minor_px: ellipse.semiMinorPx,
        tilt_deg: ellipse.tiltDeg,
        plate_diameter_cm: cal.plateDiameterCm,
        cm_per_px_v: cal.cmPerPxV,
        cm_per_px_h: cal.cmPerPxH,
        viewing_angle_deg: cal.viewingAngleDeg,
        confidence: cal.confidence,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'analysis_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as KinemosCalibration;
}

export async function clearCalibration(analysisId: string): Promise<void> {
  const { error } = await supabase
    .from('kinemos_calibrations')
    .delete()
    .eq('analysis_id', analysisId);
  if (error) throw error;
}

/**
 * Store the whole point series for a rep.
 *
 * Whole-series writes, not per-point ones: the series is small (a 6 s lift at
 * 60 fps is ~360 points), the coach edits it as one object, and last-write-wins
 * on a JSONB column is exactly EMOS's collaboration model. `correctionCount` is
 * carried because the quality grade P2 computes counts how much hand-work a
 * track needed.
 */
export async function saveTrack(
  analysisId: string,
  points: KinemosTrackPoint[],
  options: {
    tier?: KinemosTrack['tracker_tier'];
    correctionCount?: number;
    ownerId?: string | null;
  } = {},
): Promise<KinemosTrack> {
  const { data, error } = await supabase
    .from('kinemos_tracks')
    .upsert(
      {
        analysis_id: analysisId,
        kind: 'bar_end',
        ...(options.ownerId ? { owner_id: options.ownerId } : {}),
        points,
        tracker_tier: options.tier ?? 'manual',
        correction_count: options.correctionCount ?? 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'analysis_id,kind' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as KinemosTrack;
}

export interface NewAnnotation {
  kind: KinemosAnnotation['kind'];
  frameIndex?: number | null;
  frameT?: number | null;
  body?: string | null;
  assetKey?: string | null;
  payload?: Record<string, unknown> | null;
  ownerId?: string | null;
}

export async function addAnnotation(
  analysisId: string,
  annotation: NewAnnotation,
): Promise<KinemosAnnotation> {
  const { data, error } = await supabase
    .from('kinemos_annotations')
    .insert({
      analysis_id: analysisId,
      kind: annotation.kind,
      frame_index: annotation.frameIndex ?? null,
      frame_t: annotation.frameT ?? null,
      body: annotation.body ?? null,
      asset_key: annotation.assetKey ?? null,
      payload: annotation.payload ?? null,
      owner_id: annotation.ownerId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KinemosAnnotation;
}

export async function updateAnnotationBody(id: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('kinemos_annotations')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase.from('kinemos_annotations').delete().eq('id', id);
  if (error) throw error;
}
