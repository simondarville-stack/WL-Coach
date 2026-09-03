/**
 * flywheel — consent, and the labelled data it unlocks.
 *
 * Design §10: coach corrections are the most valuable training labels there
 * are, because hard frames get human answers by construction. A tracker that
 * needed no correction produces a track the tracker already agreed with; a
 * track the coach fixed says exactly where the current method fails and what
 * the right answer was. That is the flywheel, and this module is both halves
 * of it: the consent that gates it, and the export that spends it.
 *
 * **Nothing here reads a track without consent.** `exportTrainingSet` starts
 * from the consent table, not from the analyses, so an athlete who has not
 * granted — or has revoked — cannot be included by an oversight in a filter
 * further down. Revoking is not a delete: `granted_at` and `revoked_at` are
 * both kept, because a bundle exported while consent stood was exported
 * lawfully and the record should say so.
 *
 * **What leaves is the labels, not the athlete.** A bundle carries the point
 * series, the calibration, the grade and a reference to the clip; it does
 * not carry the video, the athlete's name, or anything that identifies them
 * — the athlete is a stable opaque id so several clips of one lifter can be
 * grouped without saying who they are.
 */
import { supabase } from '../../lib/supabase';
import type {
  KinemosAnalysis,
  KinemosCalibration,
  KinemosTrack,
  KinemosTrackPoint,
  KinemosTrainingConsent,
} from '../../lib/database.types';

export interface ConsentState {
  athleteId: string;
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  note: string | null;
}

/** Granted and not since revoked. */
export function isGranted(row: Pick<KinemosTrainingConsent, 'granted_at' | 'revoked_at'>): boolean {
  if (!row.granted_at) return false;
  if (!row.revoked_at) return true;
  // Re-granted after a revocation is granted again.
  return new Date(row.granted_at).getTime() > new Date(row.revoked_at).getTime();
}

function toState(row: KinemosTrainingConsent): ConsentState {
  return {
    athleteId: row.athlete_id,
    granted: isGranted(row),
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    note: row.note,
  };
}

/** Every consent record in this environment, by athlete. */
export async function loadConsents(): Promise<Map<string, ConsentState>> {
  const { data, error } = await supabase.from('kinemos_training_consent').select('*');
  if (error) throw error;
  const rows = (data ?? []) as KinemosTrainingConsent[];
  return new Map(rows.map(r => [r.athlete_id, toState(r)]));
}

export interface SetConsentArgs {
  athleteId: string;
  ownerId: string | null;
  granted: boolean;
  coachId?: string | null;
  note?: string | null;
}

/** Record a grant or a withdrawal. Both are dated; neither erases the other. */
export async function setConsent(args: SetConsentArgs): Promise<ConsentState> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('kinemos_training_consent')
    .upsert(
      {
        owner_id: args.ownerId,
        athlete_id: args.athleteId,
        ...(args.granted ? { granted_at: now } : { revoked_at: now }),
        recorded_by_coach_id: args.coachId ?? null,
        note: args.note ?? null,
        updated_at: now,
      },
      { onConflict: 'owner_id,athlete_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return toState(data as KinemosTrainingConsent);
}

/** One labelled lift, as it leaves KinEMOS. */
export interface TrainingSample {
  /** Stable, opaque, and not the athlete's id: several clips of one lifter
   *  group together without naming them. */
  subject: string;
  sourceKind: 'log' | 'event' | 'direct';
  /** Which clip, so a later reader can pair the labels with footage they
   *  already hold. Never a URL, and never the video itself. */
  sourceId: string;
  repIndex: number;
  frameWidth: number | null;
  frameHeight: number | null;
  rotation: number | null;
  /** The labels: where the bar end was, frame by frame, as the coach left
   *  it. `s` says whether a hand or the tracker put each point there — the
   *  hand-placed ones are the valuable half. */
  points: KinemosTrackPoint[];
  trackerTier: string;
  /** How many frames the coach had to fix. The count that makes this sample
   *  worth having. */
  correctionCount: number;
  calibration: {
    ellipse: { cx: number; cy: number; semiMajorPx: number; semiMinorPx: number; tiltDeg: number };
    plateDiameterCm: number;
    cmPerPxV: number | null;
    cmPerPxH: number | null;
    viewingAngleDeg: number | null;
  } | null;
  grade: 'A' | 'B' | 'C' | null;
  massKg: number | null;
}

export interface TrainingSet {
  /** What this bundle is, in the file itself — a bundle that outlives the
   *  conversation that produced it needs to explain itself. */
  about: string;
  exportedAt: string;
  /** The consent every sample here rests on, as it stood at export. */
  consent: { athletes: number; grantedAt: string[] };
  samples: TrainingSample[];
}

/**
 * Build the labelled set from every consenting athlete's corrected analyses.
 *
 * `minCorrections` is the point of the thing: a track nobody corrected
 * teaches the tracker what it already believed. One correction is the
 * threshold at which a sample carries a human answer to a frame the machine
 * got wrong.
 */
export async function exportTrainingSet(options: { minCorrections?: number } = {}): Promise<TrainingSet> {
  const minCorrections = options.minCorrections ?? 1;
  const consents = await loadConsents();
  const granted = [...consents.values()].filter(c => c.granted);
  if (granted.length === 0) {
    return {
      about: TRAINING_SET_ABOUT,
      exportedAt: new Date().toISOString(),
      consent: { athletes: 0, grantedAt: [] },
      samples: [],
    };
  }

  // Which clips belong to consenting athletes. An analysis names its clip
  // polymorphically and carries no athlete of its own, so the athlete comes
  // from the three source tables — the same join the library does.
  const grantedIds = new Set(granted.map(c => c.athleteId));
  const clipIds = await clipsForAthletes(grantedIds);

  const { data, error } = await supabase
    .from('kinemos_analyses')
    .select('*, track:kinemos_tracks(*), calibration:kinemos_calibrations(*)');
  if (error) throw error;
  // The embedded track and calibration are PostgREST joins the generated
  // types cannot express; the row shape is what the select above says.
  const rows = (data ?? []) as unknown as Array<
    KinemosAnalysis & { track: KinemosTrack[] | KinemosTrack | null; calibration: KinemosCalibration[] | KinemosCalibration | null }
  >;

  const samples: TrainingSample[] = [];
  for (const row of rows) {
    const key = `${row.source_kind}:${row.source_id}`;
    if (!clipIds.has(key)) continue;
    const track = Array.isArray(row.track) ? row.track[0] : row.track;
    if (!track || track.correction_count < minCorrections) continue;
    const cal = Array.isArray(row.calibration) ? row.calibration[0] : row.calibration;
    samples.push({
      subject: subjectFor(clipIds.get(key)!),
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      repIndex: row.rep_index,
      frameWidth: row.frame_width,
      frameHeight: row.frame_height,
      rotation: row.rotation,
      points: track.points,
      trackerTier: track.tracker_tier,
      correctionCount: track.correction_count,
      calibration: cal
        ? {
            ellipse: {
              cx: Number(cal.ellipse_cx),
              cy: Number(cal.ellipse_cy),
              semiMajorPx: Number(cal.semi_major_px),
              semiMinorPx: Number(cal.semi_minor_px),
              tiltDeg: Number(cal.tilt_deg),
            },
            plateDiameterCm: Number(cal.plate_diameter_cm),
            cmPerPxV: cal.cm_per_px_v,
            cmPerPxH: cal.cm_per_px_h,
            viewingAngleDeg: cal.viewing_angle_deg,
          }
        : null,
      grade: row.grade,
      massKg: row.mass_kg,
    });
  }

  return {
    about: TRAINING_SET_ABOUT,
    exportedAt: new Date().toISOString(),
    consent: {
      athletes: granted.length,
      grantedAt: granted.map(c => c.grantedAt).filter((s): s is string => s !== null),
    },
    samples,
  };
}

const TRAINING_SET_ABOUT =
  'KinEMOS labelled bar-path set. Each sample is one rep: the bar-end point series as a coach left it ' +
  'after correcting an automated track, with the plate calibration and quality grade. Points are in ' +
  'display-space pixels of the named clip; `s` is "m" where a human placed the point and "t" where the ' +
  'tracker did. Athletes are opaque subject ids, and no video is included. Exported under per-athlete ' +
  'consent recorded in KinEMOS (design §10); consent is revocable and this bundle reflects it as at ' +
  'the export date above.';

/** A stable pseudonym for an athlete inside one bundle. Deterministic so two
 *  exports agree, and one-way so the bundle cannot name anybody. */
function subjectFor(athleteId: string): string {
  let h = 2166136261;
  for (let i = 0; i < athleteId.length; i++) {
    h ^= athleteId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `subject-${(h >>> 0).toString(36)}`;
}

/** `<kind>:<id>` → athleteId, for the clips belonging to these athletes. */
async function clipsForAthletes(athleteIds: ReadonlySet<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...athleteIds];
  if (ids.length === 0) return out;
  const [logs, events, direct] = await Promise.all([
    supabase.from('training_log_videos').select('id, athlete_id').in('athlete_id', ids),
    supabase.from('event_videos').select('id, athlete_id').in('athlete_id', ids),
    supabase.from('kinemos_videos').select('id, athlete_id').in('athlete_id', ids),
  ]);
  for (const [kind, res] of [
    ['log', logs],
    ['event', events],
    ['direct', direct],
  ] as const) {
    if (res.error) throw res.error;
    for (const row of (res.data ?? []) as Array<{ id: string; athlete_id: string | null }>) {
      if (row.athlete_id) out.set(`${kind}:${row.id}`, row.athlete_id);
    }
  }
  return out;
}
