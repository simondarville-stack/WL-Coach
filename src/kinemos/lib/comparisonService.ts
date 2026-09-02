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
 * is to run the same pipeline — `computeFromBundle`, shared with the cache
 * refresh so every writer of the cache computes the same way too.
 */
import type { KinematicSeries, RepSummary } from '../engine/kinematics';
import type { LiftMetrics, PhaseBoundary } from '../engine/phases';
import type { KinemosAnalysis, KinemosTrackPoint } from '../../lib/database.types';
import { listRecentAnalyses, loadBundle } from './analysisService';
import { computeFromBundle } from './recompute';
import { loadLibrary, type LibrarySource, type LibraryVideo } from './videoLibrary';

/** An analysis the coach could compare the current one against. */
export interface ComparisonCandidate {
  analysis: KinemosAnalysis;
  clip: LibraryVideo;
  /** True when it is the same exercise as well as the same athlete — the
   *  comparison a coach usually means. */
  sameExercise: boolean;
  /** The athlete's reference lift for this exercise — listed first and
   *  preselected, because "how does this compare to the good one" is the
   *  question the reference exists to answer. */
  isReference: boolean;
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
      isReference: analysis.is_reference === true,
    });
  }

  // Same exercise first, its reference lift ahead of the rest, then newest. A
  // coach comparing a snatch to a snatch is the common case; comparing a
  // snatch to a clean is occasionally the point.
  return candidates.sort((a, b) => {
    if (a.sameExercise !== b.sameExercise) return a.sameExercise ? -1 : 1;
    if (a.isReference !== b.isReference) return a.isReference ? -1 : 1;
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
  if (!bundle) return null;
  const computed = computeFromBundle(bundle);
  if (!computed) return null;

  return { analysis: bundle.analysis, clip: candidate.clip, ...computed };
}
