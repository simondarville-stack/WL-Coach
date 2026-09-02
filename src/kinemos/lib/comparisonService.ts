/**
 * comparisonService — finding the other lift, and getting it into a comparable
 * shape.
 *
 * "The same athlete's other snatches" is a join the analysis table cannot do
 * alone: an analysis names its source polymorphically (`source_kind` +
 * `source_id`) and carries no athlete of its own, deliberately, so that a log
 * clip, a competition attempt and a direct import are all analysable without
 * mirroring any of them. The athlete lives on the library row. So the join is
 * done here, in memory, over the two full reads — the same trade the library
 * itself documents.
 *
 * Everything a comparison needs is recomputed from the track and the
 * calibration rather than read from the cached `metrics` column. The cache is
 * for trend views that read a season at once; a comparison the coach is looking
 * at should agree with the viewer beside it, and the only way to guarantee that
 * is to run the same pipeline.
 */
import { calibrateFromEllipse } from '../engine/calibration';
import {
  computeKinematics,
  summariseRep,
  type KinematicSeries,
  type RepSummary,
} from '../engine/kinematics';
import {
  computeLiftMetrics,
  proposePhases,
  spansFrom,
  type LiftMetrics,
  type PhaseBoundary,
} from '../engine/phases';
import { DEFAULT_FILTER } from '../engine/signal';
import type { KinemosAnalysis, KinemosTrackPoint } from '../../lib/database.types';
import { listRecentAnalyses, loadBundle, plateEllipseFrom } from './analysisService';
import { loadLibrary, type LibrarySource, type LibraryVideo } from './videoLibrary';

/** An analysis the coach could compare the current one against. */
export interface ComparisonCandidate {
  analysis: KinemosAnalysis;
  clip: LibraryVideo;
  /** True when it is the same exercise as well as the same athlete — the
   *  comparison a coach usually means. */
  sameExercise: boolean;
}

/** A loaded comparison subject: everything needed to draw and to tabulate. */
export interface ComparisonSubject {
  analysis: KinemosAnalysis;
  clip: LibraryVideo;
  /** The track in this clip's own display-space pixels. The series is in
   *  centimetres and aligned to the other lift; drawing a path ON this video
   *  needs the pixels it was marked in. */
  points: KinemosTrackPoint[];
  series: KinematicSeries;
  boundaries: PhaseBoundary[];
  metrics: LiftMetrics;
  summary: RepSummary;
}

/**
 * Other analyses of the same athlete, newest first, same exercise before the
 * rest. Excludes the analysis being viewed.
 */
export async function findComparable(
  current: { kind: LibrarySource; id: string; repIndex: number },
  athleteId: string | null,
  exerciseName: string | null,
): Promise<ComparisonCandidate[]> {
  if (!athleteId) return [];

  const [analyses, library] = await Promise.all([listRecentAnalyses(), loadLibrary()]);
  const byKey = new Map(library.map(v => [v.key, v]));

  const candidates: ComparisonCandidate[] = [];
  for (const analysis of analyses) {
    if (
      analysis.source_kind === current.kind &&
      analysis.source_id === current.id &&
      analysis.rep_index === current.repIndex
    ) {
      continue;
    }
    const clip = byKey.get(`${analysis.source_kind}:${analysis.source_id}`);
    if (!clip || clip.athleteId !== athleteId) continue;
    candidates.push({
      analysis,
      clip,
      sameExercise:
        !!exerciseName && (clip.exerciseName ?? '').toLowerCase() === exerciseName.toLowerCase(),
    });
  }

  // Same exercise first, then newest. A coach comparing a snatch to a snatch is
  // the common case; comparing a snatch to a clean is occasionally the point.
  return candidates.sort((a, b) => {
    if (a.sameExercise !== b.sameExercise) return a.sameExercise ? -1 : 1;
    return (b.clip.date ?? '').localeCompare(a.clip.date ?? '');
  });
}

/**
 * Load a candidate and run it through the same pipeline the viewer runs.
 *
 * Null when it cannot be made comparable — no track, or no calibration, which
 * means no velocities and therefore nothing to compare.
 */
export async function loadComparisonSubject(
  candidate: ComparisonCandidate,
): Promise<ComparisonSubject | null> {
  const bundle = await loadBundle(
    candidate.analysis.source_kind,
    candidate.analysis.source_id,
    candidate.analysis.rep_index,
  );
  if (!bundle?.track || !bundle.calibration) return null;
  const points = bundle.track.points ?? [];
  if (points.length < 2) return null;

  const calibration = calibrateFromEllipse(
    plateEllipseFrom(bundle.calibration),
    Number(bundle.calibration.plate_diameter_cm),
  );
  const series = computeKinematics(points, calibration, {
    massKg: bundle.analysis.mass_kg === null ? null : Number(bundle.analysis.mass_kg),
    filter: DEFAULT_FILTER,
  });
  if (!series) return null;

  // A coach-corrected phase set is the answer; anything else is re-proposed
  // against the series as it is now, for the same reason the viewer does.
  const stored = bundle.analysis.phase_boundaries;
  const boundaries =
    stored && stored.some(b => b.source === 'coach')
      ? (stored as PhaseBoundary[])
      : proposePhases(series).boundaries;

  const spans = spansFrom(boundaries);
  return {
    analysis: bundle.analysis,
    clip: candidate.clip,
    points,
    series,
    boundaries,
    metrics: computeLiftMetrics(series, spans),
    summary: summariseRep(series),
  };
}
