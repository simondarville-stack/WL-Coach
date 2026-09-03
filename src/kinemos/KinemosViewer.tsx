/**
 * KinemosViewer — the study room (docs/KINEMOS_P1_PLAN.md W3–W7).
 *
 * A coach opens a library clip here and works it by hand: step it frame by
 * frame on real decoded frames, outline a plate to get centimetres, mark the
 * bar end through the lift, measure a distance or an angle, keep a snapshot.
 * No tracker, no velocity, no grade — those are P2, and the rail says so.
 *
 * The state model is small on purpose. One rep is open at a time; its marks,
 * its calibration and its annotations are the state, and each of them is
 * written back on a debounce. There is no save button because there is no
 * moment at which a coach is "done" with a rep — EMOS is last-write-wins
 * everywhere (CLAUDE.md core principle 4) and this is no different.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Circle, Columns2, Crosshair, Hand, Minus, Ruler, Star, TrendingUp, Triangle } from 'lucide-react';
import { ErrorState, Spinner, confirmDialog } from '../components/ui';
import { formatDateShort } from '../lib/dateUtils';
import { getOwnerId } from '../lib/ownerContext';
import type { KinemosAnnotation, KinemosShare, KinemosTrackPoint } from '../lib/database.types';
import {
  DEFAULT_PLATE_DIAMETER_CM,
  angleDeg,
  calibrateFromEllipse,
  displacementToCm,
  distanceCm,
  pathMetrics,
  type PlateEllipse,
  type PxPoint,
} from './engine/calibration';
import { computeKinematics, peakStability, summariseRep } from './engine/kinematics';
import { noDistortion, undistortEllipse, undistortPoints, type DistortionSource } from './engine/distortion';
import { deviceKeyFor, profileForClip, saveDeviceProfile } from './lib/deviceProfileService';
import { describeFit, describeRefusal, fitClipDistortion } from './lib/distortionFit';
import {
  DEFAULT_PHASE_SET,
  computeLiftMetrics,
  enforceMonotonic,
  kneeCrossing,
  proposePhases,
  spansFrom,
  type PhaseBoundary,
} from './engine/phases';
import { gradeAnalysis, type CameraStability, type TrackerTier } from './engine/grade';
import { trackFromAnchor } from './engine/tracker';
import type { AlignmentAnchor } from './engine/compare';
import { toStoredMetrics } from './engine/metricCatalogue';
import { ComparisonView } from './components/ComparisonView';
import { TrendsView } from './components/TrendsView';
import { markAsReference } from './lib/referenceService';
import { findPlateOnFrame, recentreTrackOnOutline, snapEllipseOnFrame, stabiliseTrack } from './lib/assists';
import { trackSet } from './lib/setTracker';
import { createClubShare, createShare, deleteShare, fetchAthleteOwnerId, listSharesForAnalysis } from './lib/shareService';
import { exportOverlayVideo } from './lib/overlayExport';
import { formatTalkoverLength, startTalkover, talkoverMimeType, type TalkoverController } from './lib/talkover';
import { kinemosObjectUrl, uploadTalkover } from './lib/kinemosStorage';
import { valueAt } from './engine/phases';
import { useCoachStore } from '../store/coachStore';
import {
  findComparable,
  loadComparisonSubject,
  type ComparisonCandidate,
  type ComparisonSubject,
} from './lib/comparisonService';
import { trackerSourceFrom } from './lib/trackerSource';
import { DEFAULT_FILTER } from './engine/signal';
import { useFrameServer } from './hooks/useFrameServer';
import { AnalysisPanel } from './components/AnalysisPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { GradeChip, GradePanel } from './components/GradePanel';
import { MetricsPanel } from './components/MetricsPanel';
import { ReadoutRail } from './components/ReadoutRail';
import { ViewerStage, type ViewerTool } from './components/ViewerStage';
import { ViewerTransport } from './components/ViewerTransport';
import {
  addAnnotation,
  clearCalibration,
  deleteAnnotation as deleteAnnotationRow,
  ensureAnalysis,
  listReps,
  saveAnalysisState,
  loadBundle,
  saveCalibration,
  saveTrack,
} from './lib/analysisService';
import { uploadSnapshot } from './lib/kinemosStorage';
import { composeSnapshot } from './lib/snapshot';
import { loadClipByKey, type LibrarySource, type LibraryVideo } from './lib/videoLibrary';
import { distance as formatDistance, num } from './lib/viewerFormat';

/** How long the viewer waits after the last edit before writing. Long enough
 *  that marking a whole lift is one write per pause, short enough that a coach
 *  who closes the tab loses nothing they would notice. */
const SAVE_DEBOUNCE_MS = 900;

const TOOLS: Array<{
  id: ViewerTool;
  label: string;
  icon: typeof Hand;
  key: string;
}> = [
  {
    id: 'look',
    label: 'Look — drag to pan, wheel to zoom',
    icon: Hand,
    key: 'V',
  },
  {
    id: 'calibrate',
    label: 'Calibrate against a plate',
    icon: Circle,
    key: 'C',
  },
  { id: 'mark', label: 'Mark the bar end', icon: Crosshair, key: 'M' },
  { id: 'distance', label: 'Measure a distance', icon: Ruler, key: 'D' },
  { id: 'angle', label: 'Measure an angle', icon: Triangle, key: 'A' },
  { id: 'knee', label: 'Mark the knee height — click the knee on the start frame', icon: Minus, key: 'K' },
];

export function KinemosViewer() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const navigate = useNavigate();

  const [clip, setClip] = useState<LibraryVideo | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [loadingClip, setLoadingClip] = useState(true);

  const [tool, setTool] = useState<ViewerTool>('look');
  // `?rep=N` opens a particular rep — how a lift shared with a colleague
  // lands on the rep that was shared rather than rep 1.
  const [searchParams] = useSearchParams();
  const [repIndex, setRepIndex] = useState(() => {
    const rep = Number(searchParams.get('rep'));
    return Number.isInteger(rep) && rep >= 1 ? rep : 1;
  });
  const [repIndices, setRepIndices] = useState<number[]>([1]);

  const [points, setPoints] = useState<KinemosTrackPoint[]>([]);
  const [ellipse, setEllipse] = useState<PlateEllipse | null>(null);
  const [plateDiameterCm, setPlateDiameterCm] = useState(DEFAULT_PLATE_DIAMETER_CM);
  const [annotations, setAnnotations] = useState<KinemosAnnotation[]>([]);
  const [measurePoints, setMeasurePoints] = useState<PxPoint[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [shares, setShares] = useState<KinemosShare[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [talkover, setTalkover] = useState<TalkoverController | null>(null);
  const [talkoverBusy, setTalkoverBusy] = useState(false);
  const [talkoverNote, setTalkoverNote] = useState<string | null>(null);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const coaches = useCoachStore(s => s.coaches);
  const colleagues = useMemo(
    () => coaches.filter(c => c.id !== activeCoachId).map(c => ({ id: c.id, name: c.name })),
    [coaches, activeCoachId],
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const [massKg, setMassKg] = useState<number | null>(null);
  const [massSource, setMassSource] = useState<'logged' | 'manual' | null>(null);
  const [camera, setCamera] = useState<CameraStability>('unknown');
  /** Null means "whatever the engine proposes". As soon as the coach drags an
   *  edge this holds their whole set and the proposal stops being consulted —
   *  automation proposes, the coach disposes (design §7). */
  const [coachBoundaries, setCoachBoundaries] = useState<PhaseBoundary[] | null>(null);

  const [trackerTier, setTrackerTier] = useState<TrackerTier>('manual');
  const [correctionCount, setCorrectionCount] = useState(0);
  /** Frame indices the tracker flagged. The scrub strip paints these, which is
   *  how a coach finds the frames worth checking without scrubbing all of
   *  them — the design brief's third open question. */
  const [uncertainIndices, setUncertainIndices] = useState<number[]>([]);
  const [trackProgress, setTrackProgress] = useState<{ done: number; total: number } | null>(null);

  const [comparing, setComparing] = useState(false);
  // Trends and comparison are two readings of the same athlete's history and
  // take the same space, so opening one closes the other.
  const [trending, setTrending] = useState(false);
  // Whether this rep is the athlete's reference lift for the exercise. Written
  // straight through on toggle rather than via the debounced save: it is one
  // deliberate act, not a drag, and it has to clear the previous holder.
  const [isReference, setIsReference] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  // The OpenCV assists: which is running, and what the last one said.
  const [assist, setAssist] = useState<{ busy: 'find' | 'snap' | null; note: string | null }>({
    busy: null,
    note: null,
  });
  const [stabiliseProgress, setStabiliseProgress] = useState<{ done: number; total: number } | null>(null);
  const [stabiliseNote, setStabiliseNote] = useState<string | null>(null);
  /** How the plate outline is fitted: a free ellipse, or a circle for a round
   *  plate filmed square-on (see `OutlineFitOptions`). Not persisted — it
   *  describes how the next find or snap runs, and the outline it produces is
   *  what gets stored. */
  const [plateShape, setPlateShape] = useState<'ellipse' | 'circle'>('ellipse');
  const [setNote, setSetNote] = useState<string | null>(null);
  const [recentreProgress, setRecentreProgress] = useState<{ done: number; total: number } | null>(null);
  const [recentreNote, setRecentreNote] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ComparisonCandidate[]>([]);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [comparisonSubject, setComparisonSubject] = useState<ComparisonSubject | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  /** Lift-off by default: the one event every pull has, and where the bar path
   *  starts (design §8). */
  const [alignment, setAlignment] = useState<AlignmentAnchor>('liftoff');

  const analysisIdRef = useRef<string | null>(null);
  // Only user edits are written back. Without this the load that populates
  // state would immediately look like a change and write it straight back.
  const dirtyRef = useRef(false);

  const source = kind as LibrarySource | undefined;
  const clipKey = source && id ? `${source}:${id}` : null;

  // ── The clip ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clipKey) return;
    let cancelled = false;
    setLoadingClip(true);
    loadClipByKey(clipKey)
      .then(found => {
        if (cancelled) return;
        if (!found) setClipError('That clip is not in the library any more.');
        setClip(found);
      })
      .catch(() => {
        if (!cancelled) setClipError('The library could not be read.');
      })
      .finally(() => {
        if (!cancelled) setLoadingClip(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clipKey]);

  // A Stream-hosted clip is an iframe embed, not a file: there are no frames to
  // decode, so there is nothing to analyse (P1 plan §4). Better refused with
  // the reason than opened onto a black stage.
  const analysable = clip !== null && !clip.isEmbed;
  const playbackUrl = analysable ? clip.playbackUrl : null;

  // Kept whole as well as destructured: the comparison view is handed the
  // playhead itself, because side-by-side playback has to run off this clock
  // rather than open a second one.
  const playback = useFrameServer(playbackUrl);
  const {
    status,
    error: frameError,
    decodeError,
    server,
    frame,
    index,
    playing,
    speed,
    seek,
    step,
    togglePlay,
    setSpeed,
  } = playback;

  const currentT = server ? (server.timestamps[index] ?? null) : null;

  // ── The rep's stored record ───────────────────────────────────────────────
  useEffect(() => {
    if (!source || !id) return;
    let cancelled = false;
    listReps(source, id)
      .then(reps => {
        if (cancelled) return;
        const indices = reps.map(r => r.rep_index);
        setRepIndices(indices.length > 0 ? indices : [1]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  useEffect(() => {
    if (!source || !id) return;
    let cancelled = false;
    dirtyRef.current = false;
    analysisIdRef.current = null;
    setPoints([]);
    setEllipse(null);
    setAnnotations([]);
    setShares([]);
    setShareNote(null);
    setMeasurePoints([]);
    setCoachBoundaries(null);
    setCamera('unknown');
    setIsReference(false);
    setAssist({ busy: null, note: null });
    setStabiliseNote(null);
    // The logged load is the best first guess at bar mass, and it is already on
    // the library row. A coach who filmed a different set overwrites it.
    setMassKg(clip?.loadKg ?? null);
    setMassSource(clip?.loadKg == null ? null : 'logged');

    loadBundle(source, id, repIndex)
      .then(bundle => {
        if (cancelled || !bundle) return;
        analysisIdRef.current = bundle.analysis.id;
        setPoints(bundle.track?.points ?? []);
        setAnnotations(bundle.annotations);
        // Shares are an extra: a missing table (the migration not yet
        // applied) must not stop the rep from loading.
        listSharesForAnalysis(bundle.analysis.id)
          .then(s => {
            if (!cancelled) setShares(s);
          })
          .catch(() => undefined);
        if (bundle.track) {
          setTrackerTier(bundle.track.tracker_tier);
          setCorrectionCount(bundle.track.correction_count);
        }
        if (bundle.analysis.mass_kg != null) {
          setMassKg(Number(bundle.analysis.mass_kg));
          setMassSource(bundle.analysis.mass_source ?? 'manual');
        }
        if (bundle.analysis.camera) setCamera(bundle.analysis.camera);
        setIsReference(bundle.analysis.is_reference === true);
        // Only a set the coach has actually touched is restored. Stored
        // proposals would go stale the moment the track changed, and silently
        // re-showing an old engine guess as if it were current is worse than
        // re-proposing from what is on screen now.
        const stored = bundle.analysis.phase_boundaries;
        if (stored && stored.some(b => b.source === 'coach')) {
          setCoachBoundaries(stored as PhaseBoundary[]);
        }
        if (bundle.calibration) {
          setEllipse({
            cx: Number(bundle.calibration.ellipse_cx),
            cy: Number(bundle.calibration.ellipse_cy),
            semiMajorPx: Number(bundle.calibration.semi_major_px),
            semiMinorPx: Number(bundle.calibration.semi_minor_px),
            tiltDeg: Number(bundle.calibration.tilt_deg),
          });
          setPlateDiameterCm(Number(bundle.calibration.plate_diameter_cm));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `clip` is read only for its logged load, and re-running on a clip
    // identity change would wipe unsaved work; the key already covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id, repIndex]);

  // ── The lens ──────────────────────────────────────────────────────────────
  //
  // Design §6.1's distortion tiers, applied at READ time like the filter: the
  // stored track is what was measured on the frame, and the correction is a
  // lens the frame was seen through, re-applied on every load. So the stage
  // keeps drawing the raw points over the raw picture — where they belong,
  // since the picture is distorted too — while everything computed from them
  // is computed from the corrected pair.
  const [lensK1, setLensK1] = useState(0);
  const [lensSource, setLensSource] = useState<DistortionSource>('none');
  const [lensBusy, setLensBusy] = useState(false);
  const [lensNote, setLensNote] = useState<string | null>(null);

  const lensModel = useMemo(() => {
    const base = noDistortion(server?.displayWidth ?? 0, server?.displayHeight ?? 0);
    return lensK1 ? { ...base, k1: lensK1 } : base;
  }, [server?.displayWidth, server?.displayHeight, lensK1]);

  const measuredPoints = useMemo(() => undistortPoints(lensModel, points), [lensModel, points]);
  const measuredEllipse = useMemo(
    () => (ellipse ? undistortEllipse(lensModel, ellipse) : null),
    [lensModel, ellipse],
  );

  const calibration = useMemo(
    () => (measuredEllipse ? calibrateFromEllipse(measuredEllipse, plateDiameterCm) : null),
    [measuredEllipse, plateDiameterCm],
  );

  const metrics = useMemo(() => pathMetrics(measuredPoints, calibration), [measuredPoints, calibration]);

  // ── The measurement pipeline ──────────────────────────────────────────────
  //
  // Everything below is derived, every render, from the track and the
  // calibration. Nothing is stored as truth: the analysis row caches the
  // outcome so a trend view can read a season without re-running this, but the
  // panel always shows what the current marks actually imply.
  const kinematics = useMemo(
    () =>
      computeKinematics(measuredPoints, calibration, {
        massKg,
        filter: DEFAULT_FILTER,
      }),
    [measuredPoints, calibration, massKg],
  );

  const proposal = useMemo(() => (kinematics ? proposePhases(kinematics) : null), [kinematics]);

  const boundaries = useMemo(() => {
    if (!kinematics) return [];
    if (!coachBoundaries) return proposal?.boundaries ?? [];
    // A coach's set is clamped to the clip it is being shown against — a rep
    // re-marked shorter must not leave an edge hanging past the end.
    return enforceMonotonic(
      coachBoundaries,
      kinematics.t[0],
      kinematics.t[kinematics.t.length - 1],
    );
  }, [kinematics, coachBoundaries, proposal]);

  const spans = useMemo(() => spansFrom(boundaries, DEFAULT_PHASE_SET), [boundaries]);

  const liftMetrics = useMemo(
    () => (kinematics && spans.length > 0 ? computeLiftMetrics(kinematics, spans) : null),
    [kinematics, spans],
  );

  const repSummary = useMemo(() => (kinematics ? summariseRep(kinematics) : null), [kinematics]);

  /**
   * Whether this lift has everything the comparison needs. One flag rather than
   * three conditions in three places: a button enabled on a weaker test than
   * the view it opens is a button that opens nothing.
   */
  const comparable = kinematics !== null && liftMetrics !== null && repSummary !== null;

  // Two extra runs of the pipeline at neighbouring cutoffs — a few hundred
  // points each — to say whether the peak is the lift's or the filter's.
  const stability = useMemo(
    () => (kinematics ? peakStability(points, calibration, { massKg, filter: DEFAULT_FILTER }) : null),
    [kinematics, points, calibration, massKg],
  );

  const grade = useMemo(
    () =>
      gradeAnalysis({
        sampleRateHz: kinematics?.sampleRateHz ?? server?.averageFps ?? 0,
        vfr: server?.isVfr ?? false,
        calibration,
        filtered: kinematics?.filtered ?? false,
        filter: kinematics?.filter ?? DEFAULT_FILTER,
        // What actually produced this track, and how much the coach had to fix
        // — a heavily-corrected assisted track is graded as hand-marked, which
        // is what it is.
        trackerTier,
        correctionCount,
        trackedFrames: points.length,
        camera,
        distortionSource: lensSource,
        timingRepairs: kinematics?.timingRepairs.length ?? 0,
        peakSpread: stability?.spread ?? null,
      }),
    [kinematics, server, calibration, camera, points.length, trackerTier, correctionCount, stability, lensSource],
  );

  /**
   * Why there are no curves, in the coach's terms — long for the empty chart
   * area, which has the room and is the more likely place to be read cold.
   */
  const analysisEmptyReason = useMemo(() => {
    if (!calibration)
      return 'Calibrate against a plate to get velocities — without a scale there is no velocity to measure.';
    if (calibration.confidence === 'degenerate')
      return 'The plate outline is too small to carry a scale worth measuring against.';
    if (points.length < 8)
      return `Mark the bar through the lift — ${points.length} of at least 8 points so far.`;
    return null;
  }, [calibration, points.length]);

  /** The same fact, terse, for the rail. The long sentence is already on screen
   *  in the chart area; repeating it verbatim in a 304 px column reads as a
   *  duplicated warning rather than as one condition stated once. */
  const metricsEmptyReason = useMemo(() => {
    if (!calibration) return 'Calibrate a plate to get velocities.';
    if (calibration.confidence === 'degenerate')
      return 'The plate outline is too small to measure against.';
    if (points.length < 8) return `${points.length} of at least 8 marks so far.`;
    return null;
  }, [calibration, points.length]);

  // ── Persistence ───────────────────────────────────────────────────────────
  const ensureId = useCallback(async (): Promise<string | null> => {
    if (analysisIdRef.current) return analysisIdRef.current;
    if (!source || !id || !server) return null;
    const analysis = await ensureAnalysis(
      source,
      id,
      repIndex,
      {
        frameWidth: server.displayWidth,
        frameHeight: server.displayHeight,
        rotation: server.rotation,
      },
      // owner_id from day one so the auth/RLS phase needs no schema surgery
      // and no backfill (CLAUDE.md "Auth & access").
      getOwnerId(),
    );
    analysisIdRef.current = analysis.id;
    setRepIndices(current =>
      current.includes(analysis.rep_index)
        ? current
        : [...current, analysis.rep_index].sort((a, b) => a - b),
    );
    return analysis.id;
  }, [source, id, repIndex, server]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        // Cleared BEFORE the write, not after: an edit made while the write is
        // in flight sets it again and schedules the next one. Clearing after
        // would swallow that edit; never clearing at all — which is what this
        // did — means every later dependency change rewrites the whole record.
        dirtyRef.current = false;
        try {
          const analysisId = await ensureId();
          if (!analysisId) return;
          await saveTrack(analysisId, points, {
            tier: 'manual',
            ownerId: getOwnerId(),
          });
          await saveAnalysisState(analysisId, {
            massKg,
            massSource,
            camera,
            phaseBoundaries: boundaries.length > 0 ? boundaries : null,
            phaseSetId: 'default',
            // The cache the trend views read. Schema-stamped so a season of
            // rows can be told apart if what is stored ever changes meaning.
            metrics: liftMetrics ? toStoredMetrics(liftMetrics, repSummary) : null,
            grade: grade.grade,
            gradeErrorMs: grade.expectedVelocityErrorMs,
            gradeFactors: grade.factors,
          });
          if (ellipse && calibration) {
            await saveCalibration(
              analysisId,
              ellipse,
              calibration,
              { index, t: currentT ?? 0 },
              getOwnerId(),
            );
          }
          setSaveError(null);
        } catch {
          // Still unsaved, so the next dependency change should try again.
          dirtyRef.current = true;
          setSaveError('Changes could not be saved — they are still on screen, but not stored.');
        }
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `index`/`currentT` deliberately excluded: they change on every step and
    // would restart the debounce forever. The frame a calibration was set on is
    // read at write time, which is close enough for provenance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    points,
    ellipse,
    calibration,
    plateDiameterCm,
    massKg,
    massSource,
    camera,
    trackerTier,
    correctionCount,
    boundaries,
    liftMetrics,
    grade,
    ensureId,
  ]);

  // ── Phase edges ───────────────────────────────────────────────────────────
  const dragBoundary = useCallback(
    (index: number, t: number) => {
      // The first drag promotes the engine's proposal into the coach's own set;
      // from then on it is theirs and nothing re-proposes over it.
      setCoachBoundaries(current => {
        const base = current ?? boundaries;
        if (index < 0 || index >= base.length) return current;
        const next = base.map((b, i) => (i === index ? { ...b, t, source: 'coach' as const } : b));
        return next;
      });
    },
    [boundaries],
  );

  const commitBoundary = useCallback(() => {
    dirtyRef.current = true;
    // Force a save even though the drag already changed state: the debounce
    // watches `boundaries`, and a drag that ends where it started still needs
    // the `source: 'coach'` promotion written.
    setCoachBoundaries(current => (current ? [...current] : current));
  }, []);

  const resetBoundaries = useCallback(() => {
    dirtyRef.current = true;
    setCoachBoundaries(null);
  }, []);

  // ── Marking ───────────────────────────────────────────────────────────────
  const handleMark = useCallback(
    (point: PxPoint) => {
      if (currentT === null) return;
      dirtyRef.current = true;
      // On a tracked series this click is a CORRECTION, and the grade counts
      // them: a tracker that needs fixing on a fifth of its frames is not
      // performing at its tier, however good its output looks.
      if (trackerTier !== 'manual') {
        setCorrectionCount(c => c + 1);
        setUncertainIndices(current => current.filter(i => i !== index));
      }
      setPoints(current => {
        const without = current.filter(p => Math.abs(p.t - currentT) > 1e-6);
        const next: KinemosTrackPoint = {
          t: currentT,
          x: point.x,
          y: point.y,
          s: 'm',
        };
        return [...without, next].sort((a, b) => a.t - b.t);
      });
      // Auto-advance: marking a lift should be click, click, click, not click,
      // reach for an arrow key, click.
      step(1);
    },
    [currentT, step, trackerTier, index],
  );

  const deleteMarkHere = useCallback(() => {
    if (currentT === null) return;
    dirtyRef.current = true;
    setPoints(current => current.filter(p => Math.abs(p.t - currentT) > 1e-6));
  }, [currentT]);

  const clearMarks = useCallback(async () => {
    const ok = await confirmDialog({
      title: 'Clear every mark?',
      message: 'The bar path for this rep will be removed. Nothing else is affected.',
      confirmLabel: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    dirtyRef.current = true;
    setPoints([]);
    setTrackerTier('manual');
    setCorrectionCount(0);
    setUncertainIndices([]);
  }, []);

  // ── Comparison ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!comparing || !source || !id) return;
    let cancelled = false;
    findComparable(
      { kind: source, id, repIndex },
      clip?.athleteId ?? null,
      clip?.exerciseName ?? null,
    )
      .then(found => {
        if (cancelled) return;
        setCandidates(found);
        // Nothing chosen yet: open on the athlete's reference for this
        // exercise, which is what the reference is for.
        const reference = found.find(c => c.sameExercise && c.isReference);
        if (reference) setComparisonId(current => current ?? reference.analysis.id);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [comparing, source, id, repIndex, clip?.athleteId, clip?.exerciseName]);

  useEffect(() => {
    if (!comparisonId) {
      setComparisonSubject(null);
      return;
    }
    const candidate = candidates.find(c => c.analysis.id === comparisonId);
    if (!candidate) return;
    let cancelled = false;
    setComparisonLoading(true);
    loadComparisonSubject(candidate)
      .then(subject => {
        if (!cancelled) setComparisonSubject(subject);
      })
      .catch(() => {
        if (!cancelled) setComparisonSubject(null);
      })
      .finally(() => {
        if (!cancelled) setComparisonLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [comparisonId, candidates]);

  // ── Assisted tracking ─────────────────────────────────────────────────────
  //
  // Anchor and supervise (design §6.2). The coach marks the bar end on one
  // frame; the tracker fills the clip forwards and backwards from it. A
  // correction is the same gesture — mark the frame that is wrong, then track
  // again — which is why re-tracking needs no separate code path.
  /** Track the clip from one anchor, in both directions, and take the result
   *  into the viewer. Shared by the TRACK button and the plate finder. */
  const trackFrom = useCallback(
    async (anchorIndex: number, x: number, y: number, radiusPx: number | undefined) => {
      if (!server) return;
      const source = trackerSourceFrom(server);
      setTrackProgress({ done: 0, total: server.frameCount });
      try {
        const result = await trackFromAnchor(
          source,
          { index: anchorIndex, x, y },
          {
            // The plate is calibrated, so its on-screen radius is known rather
            // than guessed — quietly the most useful thing the calibration does
            // for the tracker.
            templateRadiusPx: radiusPx === undefined ? undefined : Math.max(10, radiusPx),
            onProgress: (done, total) => setTrackProgress({ done, total }),
          },
        );
        if (result.points.length < 2) {
          setSaveError(
            'Tracking could not get hold of the bar from that point. Mark the bar end more ' +
              'precisely, or calibrate the plate first so the tracker knows how big it is.',
          );
          return;
        }
        dirtyRef.current = true;
        setPoints(result.points.map(p => ({ t: p.t, x: p.x, y: p.y, s: 't' as const })));
        setUncertainIndices(result.lowConfidenceIndices);
        setTrackerTier('assisted');
        setSaveError(
          result.gaveUp
            ? 'The tracker lost the bar part way through, so the track stops there. Mark it again ' +
                'further on and re-track.'
            : null,
        );
      } catch {
        setSaveError('Tracking failed — the clip could not be read frame by frame.');
      } finally {
        source.dispose();
        setTrackProgress(null);
      }
    },
    [server],
  );

  /**
   * Track the whole clip as a set and make a rep of each lift.
   *
   * The anchor is the mark nearest the playhead, as for TRACK. The set
   * tracker follows the plate through every rep, cuts the joined track into
   * reps at their rests and calibrates each on its own rest outline. Each rep
   * is then persisted as what the rep model already is — an analysis row per
   * rep index with its own track, calibration and cached metrics — so the
   * rep picker, the comparison and the trends see them with no change. Rep
   * 1 replaces the rep the coach is in; later reps take the next indices.
   */
  const trackSetNow = useCallback(async () => {
    if (!server || !source || !id || currentT === null || !ellipse) return;
    const anchorPoint = points.reduce<KinemosTrackPoint | null>(
      (best, p) =>
        best === null || Math.abs(p.t - currentT) < Math.abs(best.t - currentT) ? p : best,
      null,
    );
    if (!anchorPoint) return;
    setTrackProgress({ done: 0, total: server.frameCount });
    setSetNote(null);
    try {
      const result = await trackSet(
        server,
        { index: server.nearestIndex(anchorPoint.t), x: anchorPoint.x, y: anchorPoint.y },
        {
          ellipse,
          plateDiameterCm,
          onProgress: (done, total) => setTrackProgress({ done, total }),
        },
      );
      if (result.reps.length === 0) {
        setSetNote(
          result.points.length < 8
            ? 'The tracker could not get hold of the bar from that mark.'
            : 'No rep found: nothing in the track rises 40 cm from a rest. A clip that starts mid-pull is one rep — use TRACK for it.',
        );
        return;
      }
      // Persist every rep. Rep k takes index (repIndex + k), so the current
      // analysis becomes rep 1 and a set tracked twice lands on the same rows.
      const owner = getOwnerId();
      const indices: number[] = [];
      let firstApplied = false;
      for (const rep of result.reps) {
        const index = repIndex + rep.rep - 1;
        const analysis = await ensureAnalysis(
          source,
          id,
          index,
          { frameWidth: server.displayWidth, frameHeight: server.displayHeight, rotation: server.rotation },
          owner,
        );
        await saveTrack(analysis.id, rep.points, { tier: 'assisted', ownerId: owner });
        await saveCalibration(
          analysis.id,
          rep.ellipse,
          rep.calibration,
          { index: server.nearestIndex(rep.segment.liftOffT), t: rep.segment.liftOffT },
          owner,
        );
        const series = computeKinematics(rep.points, rep.calibration, { massKg, filter: DEFAULT_FILTER });
        if (series) {
          const proposal = proposePhases(series);
          const metrics = computeLiftMetrics(series, spansFrom(proposal.boundaries, DEFAULT_PHASE_SET));
          await saveAnalysisState(analysis.id, {
            massKg,
            massSource,
            camera,
            phaseBoundaries: proposal.boundaries,
            phaseSetId: 'default',
            metrics: toStoredMetrics(metrics, summariseRep(series)),
          });
        }
        indices.push(index);
        if (!firstApplied) {
          // Rep 1 is the one on screen: take it into the viewer directly,
          // already saved, rather than round-tripping through a reload.
          firstApplied = true;
          analysisIdRef.current = analysis.id;
          dirtyRef.current = false;
          setPoints(rep.points);
          setEllipse(rep.ellipse);
          setUncertainIndices(rep.lowConfidenceIndices);
          setTrackerTier('assisted');
          setCorrectionCount(0);
        }
      }
      setRepIndices(current => [...new Set([...current, ...indices])].sort((a, b) => a - b));
      const own = result.reps.filter(r => r.ownCalibration).length;
      const byColour = result.joins.filter(j => j.how === 'colour').length;
      setSetNote(
        `${result.reps.length} rep${result.reps.length === 1 ? '' : 's'} found` +
          (result.joins.length > 0
            ? `, the plate found again ${result.joins.length} time${result.joins.length === 1 ? '' : 's'}` +
              (byColour > 0 ? ` (${byColour} by its colour, in flight)` : '')
            : '') +
          `; ${own} calibrated at ${own === 1 ? 'its' : 'their'} own rest` +
          (result.colour ? '' : '. The plate has no colour to find it by, so it is found again by shape at each rest') +
          (result.lostAtEnd ? '. The tracker lost the bar at the end and did not find it again.' : '.'),
      );
    } catch (e) {
      setSetNote(e instanceof Error ? e.message : 'Tracking the set failed — the clip could not be read frame by frame.');
    } finally {
      setTrackProgress(null);
    }
  }, [server, source, id, currentT, ellipse, points, plateDiameterCm, repIndex, massKg, massSource, camera]);

  const runTrack = useCallback(async () => {
    if (!server || currentT === null) return;
    // The mark on this frame if there is one, otherwise the nearest mark in
    // time. Falling back to points[0] — which is what this did — anchors the
    // track at the start of the clip while the button says "from here".
    const anchorPoint = points.reduce<KinemosTrackPoint | null>(
      (best, p) =>
        best === null || Math.abs(p.t - currentT) < Math.abs(best.t - currentT) ? p : best,
      null,
    );
    if (!anchorPoint) return;
    await trackFrom(server.nearestIndex(anchorPoint.t), anchorPoint.x, anchorPoint.y, ellipse?.semiMajorPx);
  }, [server, currentT, points, ellipse, trackFrom]);

  // ── OpenCV assists ────────────────────────────────────────────────────────
  //
  // Find the plate (no outline), snap an outline to the edge, and take the
  // camera's motion out of a track. Each is one deliberate press; each says
  // what it found in the coach's terms, and none of them touches the video.
  const findPlateHere = useCallback(async () => {
    if (!server || currentT === null) return;
    setAssist({ busy: 'find', note: null });
    try {
      const found = await findPlateOnFrame(server, index, undefined, { shape: plateShape });
      if (!found) {
        setAssist({ busy: null, note: 'No plate found on this frame. Try a frame where the whole plate is in view, or outline it by hand.' });
        return;
      }
      dirtyRef.current = true;
      setEllipse(found.ellipse);
      // The plate's centre is the bar end: the anchor the tracker needs.
      const anchor: KinemosTrackPoint = { t: currentT, x: found.ellipse.cx, y: found.ellipse.cy, s: 'm' };
      setPoints(prev => [...prev.filter(p => Math.abs(p.t - currentT) > 1e-6), anchor].sort((a, b) => a.t - b.t));
      setAssist({
        busy: null,
        note: `Plate found, edge under ${Math.round(found.support * 100)} % of the outline. Tracking from its centre.`,
      });
      // A template exactly the plate's face lost the lock at the second pull
      // on real footage; a little context round the rim keeps it
      // (docs/KINEMOS_ACCURACY_STUDY.md §7).
      await trackFrom(index, found.ellipse.cx, found.ellipse.cy, found.ellipse.semiMajorPx * 1.08);
    } catch (e) {
      setAssist({ busy: null, note: e instanceof Error ? e.message : 'The plate finder could not run.' });
    }
  }, [server, currentT, index, trackFrom, plateShape]);

  const snapHere = useCallback(async () => {
    if (!server || !ellipse) return;
    setAssist({ busy: 'snap', note: null });
    try {
      const out = await snapEllipseOnFrame(server, index, ellipse, { shape: plateShape });
      if (!out) {
        setAssist({ busy: null, note: 'No plate edge near the outline on this frame — nothing to snap to.' });
        return;
      }
      const moved = Math.hypot(out.ellipse.cx - ellipse.cx, out.ellipse.cy - ellipse.cy);
      const grew = out.ellipse.semiMajorPx - ellipse.semiMajorPx;
      dirtyRef.current = true;
      setEllipse(out.ellipse);
      setAssist({
        busy: null,
        note:
          `Snapped: centre moved ${num(moved, 1)} px, radius ${grew >= 0 ? '+' : '−'}${num(Math.abs(grew), 1)} px, ` +
          `edge under ${Math.round(out.support * 100)} % of the outline${out.support < 0.6 ? ' — part of the plate is hidden; check it' : ''}.`,
      });
    } catch (e) {
      setAssist({ busy: null, note: e instanceof Error ? e.message : 'The snap could not run.' });
    }
  }, [server, ellipse, index, plateShape]);

  const stabiliseNow = useCallback(async () => {
    if (!server || points.length < 8 || currentT === null) return;
    setStabiliseProgress({ done: 0, total: server.frameCount });
    setStabiliseNote(null);
    try {
      // The anchor is the frame the coach marked, or the nearest to the playhead.
      const anchor = points.find(p => p.s === 'm') ?? points[0];
      const out = await stabiliseTrack(server, anchor.t, points, ellipse?.semiMajorPx ?? 20, (done, total) =>
        setStabiliseProgress({ done, total }),
      );
      dirtyRef.current = true;
      setPoints(out.points);
      setCamera('stabilised');
      setStabiliseNote(
        `Camera moved up to ${num(out.maxShiftPx, 1)} px; the track was corrected by up to ${num(out.maxCorrectionPx, 1)} px` +
          (out.weakFrames > 0 ? `, with ${out.weakFrames} frames where the background gave little to hold on to.` : '.'),
      );
    } catch (e) {
      setStabiliseNote(e instanceof Error ? e.message : 'Stabilisation could not run.');
    } finally {
      setStabiliseProgress(null);
    }
  }, [server, points, currentT, ellipse]);

  const recentreNow = useCallback(async () => {
    if (!server || !ellipse || points.length < 8) return;
    setRecentreProgress({ done: 0, total: points.length });
    setRecentreNote(null);
    try {
      const out = await recentreTrackOnOutline(
        server,
        points,
        ellipse,
        (done, total) => setRecentreProgress({ done, total }),
        { shape: plateShape },
      );
      dirtyRef.current = true;
      setPoints(out.points);
      let scaleNote = '';
      if (out.midPull) {
        // The scale is re-read where the plate is at camera height — see
        // RecentreTrackResult.midPull — and the calibration frame follows
        // it, so the outline on screen is the plate it describes.
        const before = ellipse.semiMajorPx;
        const after = out.midPull.ellipse.semiMajorPx;
        setEllipse(out.midPull.ellipse);
        seek(server.nearestIndex(out.midPull.t));
        scaleNote =
          ` Scale re-read at mid-pull from ${out.midPull.frames} frames: plate ${num(2 * after, 1)} px across` +
          (Math.abs(after - before) >= 0.25 ? ` (was ${num(2 * before, 1)} px on the calibration frame).` : '.');
      }
      setRecentreNote(
        `${out.recentred} of ${points.length} points now sit on the fitted outline's centre, moved by up to ${num(out.largestMovePx, 1)} px` +
          (out.kept > 0 ? `; ${out.kept} kept the tracker's point because too little rim was visible.` : '.') +
          scaleNote,
      );
    } catch (e) {
      setRecentreNote(e instanceof Error ? e.message : 'Re-centring could not run.');
    } finally {
      setRecentreProgress(null);
    }
  }, [server, points, ellipse, plateShape, seek]);

  /** Seek to the next frame the tracker was unsure about, after the playhead.
   *  Wraps, so repeated presses walk the whole set. */
  const jumpToNextUncertain = useCallback(() => {
    if (uncertainIndices.length === 0) return;
    seek(uncertainIndices.find(i => i > index) ?? uncertainIndices[0]);
  }, [uncertainIndices, index, seek]);

  // ── Measurement ───────────────────────────────────────────────────────────
  const measureArity = tool === 'angle' ? 3 : 2;
  const measureComplete = measurePoints.length === measureArity;

  const measureValue = useMemo(() => {
    if (tool === 'distance' && measurePoints.length === 2) {
      return calibration
        ? formatDistance(distanceCm(calibration, measurePoints[0], measurePoints[1]), true)
        : formatDistance(
            Math.hypot(
              measurePoints[1].x - measurePoints[0].x,
              measurePoints[1].y - measurePoints[0].y,
            ),
            false,
          );
    }
    if (tool === 'angle' && measurePoints.length === 3) {
      // Third click is the vertex — the arms are placed first, which is how
      // Kinovea's angle tool reads to anyone who has used one.
      return `${num(angleDeg(calibration, measurePoints[0], measurePoints[2], measurePoints[1]), 1)}°`;
    }
    return null;
  }, [tool, measurePoints, calibration]);

  const addMeasurePoint = useCallback(
    (point: PxPoint) => {
      setMeasurePoints(current => (current.length >= measureArity ? [point] : [...current, point]));
    },
    [measureArity],
  );

  const saveMeasurement = useCallback(async () => {
    if (!measureValue) return;
    try {
      const analysisId = await ensureId();
      if (!analysisId) return;
      const row = await addAnnotation(analysisId, {
        kind: 'measurement',
        frameIndex: index,
        frameT: currentT,
        ownerId: getOwnerId(),
        body: `${tool === 'angle' ? 'Angle' : 'Distance'} ${measureValue}`,
        payload: {
          type: tool,
          points: measurePoints,
          calibrated: calibration !== null,
        },
      });
      setAnnotations(current => [...current, row]);
      setMeasurePoints([]);
    } catch {
      setSaveError('That measurement could not be saved.');
    }
  }, [measureValue, ensureId, index, currentT, tool, measurePoints, calibration]);

  // ── Annotations ───────────────────────────────────────────────────────────
  const addNote = useCallback(
    async (body: string) => {
      try {
        const analysisId = await ensureId();
        if (!analysisId) return;
        const row = await addAnnotation(analysisId, {
          kind: 'note',
          frameIndex: index,
          frameT: currentT,
          body,
          ownerId: getOwnerId(),
        });
        setAnnotations(current => [...current, row]);
      } catch {
        setSaveError('That note could not be saved.');
      }
    },
    [ensureId, index, currentT],
  );

  const takeSnapshot = useCallback(async () => {
    if (!frame || !server) return;
    setSnapshotBusy(true);
    try {
      const analysisId = await ensureId();
      if (!analysisId) return;
      const caption = [
        clip?.athleteName,
        clip?.exerciseName,
        `frame ${index + 1}/${server.frameCount}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const blob = await composeSnapshot({
        frame: frame.canvas as CanvasImageSource,
        width: server.displayWidth,
        height: server.displayHeight,
        points,
        currentT,
        ellipse,
        caption,
      });
      const assetKey = await uploadSnapshot(blob);
      const row = await addAnnotation(analysisId, {
        kind: 'snapshot',
        frameIndex: index,
        frameT: currentT,
        assetKey,
        ownerId: getOwnerId(),
        body: `Snapshot — frame ${index + 1}`,
      });
      setAnnotations(current => [...current, row]);
    } catch {
      setSaveError('The snapshot could not be stored — check that KinEMOS storage is configured.');
    } finally {
      setSnapshotBusy(false);
    }
  }, [frame, server, ensureId, clip, index, points, currentT, ellipse]);

  // The stored lens for this clip's phone, if one has ever been measured.
  // Looked up by make and model, so a profile measured on one clip corrects
  // every later clip from the same phone — which is what makes design §6.1's
  // "model-lookup tier" real without a shipped table of phones nobody
  // measured.
  useEffect(() => {
    let alive = true;
    setLensK1(0);
    setLensSource('none');
    setLensNote(null);
    if (!server || !clip) return;
    profileForClip(clip.deviceMake, clip.deviceModel, server.displayWidth, server.displayHeight, clip.athleteId)
      .then(found => {
        if (!alive || found.source === 'none') return;
        setLensK1(found.model.k1);
        setLensSource(found.source);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [server, clip]);

  /**
   * Measure this clip's lens from the straight edges already in the gym, and
   * remember it against the phone. A refusal is a real answer — a hall with
   * nothing straight in shot, or a lens with nothing to correct — and says so
   * rather than storing a confident zero.
   */
  const measureLens = useCallback(async () => {
    if (!server) return;
    setLensBusy(true);
    setLensNote(null);
    try {
      const result = await fitClipDistortion(server);
      const fit = result.fit;
      if (!fit) {
        setLensNote(describeRefusal(result));
        return;
      }
      setLensK1(fit.model.k1);
      const key = deviceKeyFor(clip?.deviceMake ?? null, clip?.deviceModel ?? null);
      if (!key) {
        // Still applied to this clip — it is measured, and it is right — but
        // there is nothing to file it under for the next one.
        setLensSource('profile');
        setLensNote(`${describeFit(fit)} Applied here; not stored, because the clip does not say which phone shot it.`);
        return;
      }
      await saveDeviceProfile({
        deviceMake: clip?.deviceMake ?? null,
        deviceModel: clip?.deviceModel ?? null,
        athleteId: clip?.athleteId ?? null,
        ownerId: getOwnerId(),
        k1: fit.model.k1,
        residualBeforePx: fit.residualBeforePx,
        residualAfterPx: fit.residualAfterPx,
        chains: fit.chains,
        frames: fit.framesUsed,
        frameWidth: server.displayWidth,
        frameHeight: server.displayHeight,
        sourceKind: source ?? null,
        sourceId: id ?? null,
      });
      setLensSource('profile');
      setLensNote(`${describeFit(fit)} Stored for ${key} — every clip from it is corrected from now on.`);
    } catch (e) {
      const text = (e as { message?: string } | null)?.message ?? '';
      setLensNote(
        /kinemos_device_profiles/.test(text)
          ? 'Measuring needs the kinemos_device_profiles table — the 20260903140000 migration has not been applied.'
          : 'The lens could not be measured.',
      );
    } finally {
      setLensBusy(false);
    }
  }, [server, clip, source, id]);

  const clearLens = useCallback(() => {
    setLensK1(0);
    setLensSource('none');
    setLensNote('Back to no correction for this clip. The stored profile is still there; measuring again replaces it.');
  }, []);

  // ── Sharing ───────────────────────────────────────────────────────────────
  /** The most recent talkover of this rep, for a share to carry. */
  const latestTalkover = useMemo(
    () => [...annotations].reverse().find(a => a.kind === 'talkover' && a.asset_key) ?? null,
    [annotations],
  );

  /**
   * Hand this rep to its athlete: this frame with the bar path drawn, the
   * numbers as they stand, and the coach's words, into the athlete's general
   * coach thread. The message is stamped with the athlete's own environment,
   * as the inbox does, or the athlete app never finds it.
   */
  const shareNow = useCallback(
    async (message: string) => {
      if (!frame || !server || !clip?.athleteId || !repSummary) return;
      setShareBusy(true);
      setShareNote(null);
      try {
        const analysisId = await ensureId();
        if (!analysisId) return;
        const caption = [clip.athleteName, clip.exerciseName, clip.date ? formatDateShort(clip.date) : null]
          .filter(Boolean)
          .join(' · ');
        const image = await composeSnapshot({
          frame: frame.canvas as CanvasImageSource,
          width: server.displayWidth,
          height: server.displayHeight,
          points,
          currentT,
          ellipse,
          caption,
        });
        const coachEnv = getOwnerId();
        const ownerId = await fetchAthleteOwnerId(clip.athleteId, coachEnv ?? '');
        if (!ownerId) {
          setShareNote('The athlete has no environment to send into.');
          return;
        }
        const share = await createShare({
          analysisId,
          athleteId: clip.athleteId,
          ownerId,
          senderCoachId: activeCoachId,
          note: message,
          image,
          summary: {
            athleteName: clip.athleteName,
            exerciseName: clip.exerciseName,
            date: clip.date,
            loadKg: massKg,
            repIndex,
            label: null,
            vmaxMs: repSummary.peakVerticalVelocityMs,
            peakHeightCm: repSummary.peakHeightCm,
            grade: grade?.grade ?? null,
            clipUrl: clip.playbackUrl ?? null,
            talkoverUrl: latestTalkover?.asset_key ? kinemosObjectUrl(latestTalkover.asset_key) : null,
          },
        });
        setShares(current => [share, ...current]);
        setShareNote(`Sent to ${clip.athleteName ?? 'the athlete'} — it is in their coach thread now.`);
      } catch (e) {
        const text = (e as { message?: string } | null)?.message ?? '';
        setShareNote(
          /kinemos_shares/.test(text)
            ? 'Sharing needs the kinemos_shares table — the 20260903120000 migration has not been applied.'
            : 'The share could not be sent.',
        );
      } finally {
        setShareBusy(false);
      }
    },
    [frame, server, clip, repSummary, ensureId, points, currentT, ellipse, activeCoachId, massKg, repIndex, grade, latestTalkover],
  );

  /**
   * The clip with the bar path burned in, as a file the coach's browser
   * downloads. The caption names the lift; the readout is the bar's
   * vertical velocity at each frame when there is a calibration to give one.
   */
  const exportNow = useCallback(async () => {
    if (!server || points.length < 2) return;
    setExporting({ done: 0, total: 1 });
    setExportNote(null);
    try {
      const caption = [
        clip?.athleteName,
        [clip?.exerciseName, massKg !== null ? `${num(massKg, Number.isInteger(massKg) ? 0 : 1)} kg` : null].filter(Boolean).join(' '),
        clip?.date ? formatDateShort(clip.date) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const series = kinematics;
      const result = await exportOverlayVideo({
        server,
        points,
        caption,
        readout: series
          ? t => {
              const v = valueAt(series.t, series.vyMs, t);
              return v === null || t < series.t[0] || t > series.t[series.t.length - 1] ? null : `${num(v, 2)} m/s`;
            }
          : null,
        onProgress: (done, total) => setExporting({ done, total }),
      });
      const stem = [clip?.athleteName, clip?.exerciseName, clip?.date, `rep${repIndex}`]
        .filter(Boolean)
        .join('-')
        .replace(/[^\p{L}\p{N}-]+/gu, '_');
      const name = `${stem || 'kinemos'}.${result.extension}`;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportNote(
        `${name} — ${num(result.blob.size / 1_000_000, 1)} MB, ${result.frames} frames, ${num(result.durationS, 1)} s` +
          (result.extension === 'webm' ? '. This browser has no H.264 encoder, so it is WebM; Chrome or Edge on a desktop writes MP4.' : '.'),
      );
    } catch (e) {
      setExportNote(e instanceof Error ? e.message : 'The export failed.');
    } finally {
      setExporting(null);
    }
  }, [server, points, clip, massKg, kinematics, repIndex]);

  // ── Talkover ──────────────────────────────────────────────────────────────
  // The recorder reads the stage through refs, so scrubbing while it runs
  // needs no re-render of the recorder and no dependency churn here.
  const liveFrameRef = useRef(frame);
  liveFrameRef.current = frame;
  const liveTRef = useRef(currentT);
  liveTRef.current = currentT;
  const livePointsRef = useRef(points);
  livePointsRef.current = points;

  const toggleTalkover = useCallback(async () => {
    if (talkover) {
      // Stop, store, list.
      setTalkoverBusy(true);
      try {
        const recording = await talkover.stop();
        setTalkover(null);
        const analysisId = await ensureId();
        if (!analysisId) return;
        const key = await uploadTalkover(recording.blob, recording.mimeType);
        const row = await addAnnotation(analysisId, {
          kind: 'talkover',
          frameIndex: index,
          frameT: currentT,
          assetKey: key,
          ownerId: getOwnerId(),
          body: `Talkover — ${formatTalkoverLength(recording.durationS)}${recording.withAudio ? '' : ', no microphone'}`,
          payload: { durationS: recording.durationS, mimeType: recording.mimeType, withAudio: recording.withAudio },
        });
        setAnnotations(current => [...current, row]);
        setTalkoverNote(
          recording.withAudio
            ? `Saved — ${formatTalkoverLength(recording.durationS)}. It can go with the next share.`
            : `Saved without sound — the microphone was not granted. ${formatTalkoverLength(recording.durationS)} of picture.`,
        );
      } catch (e) {
        setTalkover(null);
        setTalkoverNote(e instanceof Error ? e.message : 'The talkover could not be saved.');
      } finally {
        setTalkoverBusy(false);
      }
      return;
    }
    if (!server) return;
    setTalkoverNote(null);
    try {
      const caption = [clip?.athleteName, clip?.exerciseName, clip?.date ? formatDateShort(clip.date) : null]
        .filter(Boolean)
        .join(' · ');
      const controller = await startTalkover({
        width: server.displayWidth,
        height: server.displayHeight,
        getFrame: () => (liveFrameRef.current?.canvas as CanvasImageSource | undefined) ?? null,
        getT: () => liveTRef.current,
        getPoints: () => livePointsRef.current,
        caption,
      });
      setTalkover(controller);
      if (!controller.withAudio) setTalkoverNote('Recording the picture only — the microphone was not granted.');
    } catch (e) {
      setTalkoverNote(e instanceof Error ? e.message : 'Recording could not start.');
    }
  }, [talkover, server, ensureId, index, currentT, clip]);

  /** The same picture and numbers, to a colleague coach. */
  const shareWithCoach = useCallback(
    async (coachId: string, message: string) => {
      if (!frame || !server || !repSummary) return;
      setShareBusy(true);
      setShareNote(null);
      try {
        const analysisId = await ensureId();
        if (!analysisId) return;
        const caption = [clip?.athleteName, clip?.exerciseName, clip?.date ? formatDateShort(clip.date) : null]
          .filter(Boolean)
          .join(' · ');
        const image = await composeSnapshot({
          frame: frame.canvas as CanvasImageSource,
          width: server.displayWidth,
          height: server.displayHeight,
          points,
          currentT,
          ellipse,
          caption,
        });
        const ownerId = getOwnerId();
        if (!ownerId) {
          setShareNote('No environment to share within.');
          return;
        }
        const share = await createClubShare({
          analysisId,
          ownerId,
          senderCoachId: activeCoachId,
          recipientCoachId: coachId,
          note: message,
          image,
          summary: {
            athleteName: clip?.athleteName ?? null,
            exerciseName: clip?.exerciseName ?? null,
            date: clip?.date ?? null,
            loadKg: massKg,
            repIndex,
            label: null,
            vmaxMs: repSummary.peakVerticalVelocityMs,
            peakHeightCm: repSummary.peakHeightCm,
            grade: grade?.grade ?? null,
            clipUrl: clip?.playbackUrl ?? null,
            talkoverUrl: latestTalkover?.asset_key ? kinemosObjectUrl(latestTalkover.asset_key) : null,
          },
        });
        setShares(current => [share, ...current]);
        const name = colleagues.find(c => c.id === coachId)?.name ?? 'your colleague';
        setShareNote(`Sent to ${name} — it is on their video library under “Shared with you”.`);
      } catch (e) {
        const text = (e as { message?: string } | null)?.message ?? '';
        setShareNote(
          /kinemos_shares/.test(text)
            ? 'Sharing needs the kinemos_shares table — the 20260903120000 migration has not been applied.'
            : 'The share could not be sent.',
        );
      } finally {
        setShareBusy(false);
      }
    },
    [frame, server, repSummary, ensureId, clip, points, currentT, ellipse, activeCoachId, massKg, repIndex, grade, latestTalkover, colleagues],
  );

  const removeShare = useCallback(async (shareId: string) => {
    try {
      await deleteShare(shareId);
      setShares(current => current.filter(s => s.id !== shareId));
    } catch {
      setShareNote('That share could not be taken back.');
    }
  }, []);

  const removeAnnotation = useCallback(async (annotationId: string) => {
    try {
      await deleteAnnotationRow(annotationId);
      setAnnotations(current => current.filter(a => a.id !== annotationId));
    } catch {
      setSaveError('That annotation could not be deleted.');
    }
  }, []);

  // ── Knee height ───────────────────────────────────────────────────────────
  // The knee is an annotation — a measurement whose payload says what it
  // is — so it travels with the rep, lists in the rail and deletes like any
  // other. One per rep: a new click replaces the old row.
  const kneeAnnotation = useMemo(
    () => annotations.find(a => a.kind === 'measurement' && a.payload?.type === 'knee') ?? null,
    [annotations],
  );
  const kneePoint = useMemo<PxPoint | null>(() => {
    const p = kneeAnnotation?.payload?.point as { x?: unknown; y?: unknown } | undefined;
    return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
  }, [kneeAnnotation]);
  /** Knee height above the bar's first mark, cm — the height the charts
   *  and the analyzer measure from. Null until there is a track to measure
   *  from and a calibration to measure with. */
  const kneeCm = useMemo(() => {
    if (!kneePoint || !calibration || points.length === 0) return null;
    const origin = points.reduce((first, p) => (p.t < first.t ? p : first), points[0]);
    return displacementToCm(calibration, kneePoint.x - origin.x, kneePoint.y - origin.y).y;
  }, [kneePoint, calibration, points]);
  const kneeReadout = useMemo(() => {
    if (kneeCm === null) return null;
    const crossing = kinematics ? kneeCrossing(kinematics, kneeCm) : null;
    return { heightCm: kneeCm, t: crossing?.t ?? null, velocityMs: crossing?.valueMs ?? null };
  }, [kneeCm, kinematics]);

  const markKnee = useCallback(
    async (point: PxPoint) => {
      try {
        const analysisId = await ensureId();
        if (!analysisId) return;
        if (kneeAnnotation) await deleteAnnotationRow(kneeAnnotation.id);
        const heightCm =
          calibration && points.length > 0
            ? displacementToCm(
                calibration,
                point.x - points.reduce((first, p) => (p.t < first.t ? p : first), points[0]).x,
                point.y - points.reduce((first, p) => (p.t < first.t ? p : first), points[0]).y,
              ).y
            : null;
        const row = await addAnnotation(analysisId, {
          kind: 'measurement',
          frameIndex: index,
          frameT: currentT,
          ownerId: getOwnerId(),
          body: heightCm === null ? 'Knee height' : `Knee height — ${num(heightCm, 1)} cm above the bar`,
          payload: { type: 'knee', point, heightCm },
        });
        setAnnotations(current => [...current.filter(a => a.id !== kneeAnnotation?.id), row]);
      } catch {
        setSaveError('The knee mark could not be saved.');
      }
    },
    [ensureId, kneeAnnotation, calibration, points, index, currentT],
  );

  const clearCalibrationNow = useCallback(async () => {
    setEllipse(null);
    dirtyRef.current = true;
    const analysisId = analysisIdRef.current;
    if (analysisId) await clearCalibration(analysisId).catch(() => undefined);
  }, []);

  const addRep = useCallback(() => {
    const next = Math.max(...repIndices) + 1;
    setRepIndices(current => [...current, next]);
    setRepIndex(next);
  }, [repIndices]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const jump = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case 'ArrowLeft':
        case ',':
          e.preventDefault();
          step(-jump);
          break;
        case 'ArrowRight':
        case '.':
          e.preventDefault();
          step(jump);
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'Home':
          e.preventDefault();
          seek(0);
          break;
        case 'End':
          e.preventDefault();
          if (server) seek(server.frameCount - 1);
          break;
        case 'r':
        case 'R':
          // Back to the engine's proposal — the undo for a phase edge dragged
          // somewhere the coach did not mean.
          e.preventDefault();
          resetBoundaries();
          break;
        default: {
          const match = TOOLS.find(t => t.key.toLowerCase() === e.key.toLowerCase());
          if (match) {
            setTool(match.id);
            setMeasurePoints([]);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, togglePlay, seek, server, resetBoundaries]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadingClip) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
        <Spinner />
      </div>
    );
  }

  if (clipError || !clip) {
    return (
      <div style={{ padding: 'var(--space-xl)' }}>
        <ErrorState message={clipError ?? 'Clip not found.'} onRetry={() => navigate('/kinemos')} />
      </div>
    );
  }

  const toggleReference = async () => {
    if (referenceBusy) return;
    const next = !isReference;
    setReferenceBusy(true);
    try {
      const analysisId = await ensureId();
      if (!analysisId) return;
      await markAsReference(
        { analysisId, athleteId: clip.athleteId, exerciseName: clip.exerciseName },
        next,
      );
      setIsReference(next);
    } catch {
      setSaveError('The reference could not be saved.');
    } finally {
      setReferenceBusy(false);
    }
  };

  const title = clip.exerciseName ?? 'Clip';
  const subtitle = [
    clip.athleteName,
    clip.loadKg !== null
      ? `${num(clip.loadKg, 0)} kg${clip.loadIsTopSet ? ' (top set)' : ''}`
      : null,
    clip.date ? formatDateShort(clip.date) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Fills the shell's <main>, which is flex-1 inside an h-screen column.
        // Not 100vh: that ignores the 49 px app header and pushes the transport
        // off the bottom of the window.
        height: '100%',
        minHeight: 0,
        background: 'var(--color-bg-page)',
      }}
    >
      {/* Header */}
      <header
        style={{
          flexShrink: 0,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-md)',
          padding: '0 var(--space-lg)',
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-secondary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-md)',
            minWidth: 0,
          }}
        >
          <Link
            to="/kinemos"
            title="Back to the library"
            style={{
              display: 'inline-flex',
              color: 'var(--color-text-secondary)',
            }}
          >
            <ChevronLeft size={18} />
          </Link>
          <span style={{ fontSize: 'var(--text-section)', fontWeight: 600 }}>{title}</span>
          <span
            style={{
              fontSize: 'var(--text-label)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {subtitle}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <button
            type="button"
            onClick={() => {
              setTrending(false);
              setComparing(current => !current);
            }}
            title={
              comparable
                ? 'Compare this lift with another of the same athlete'
                : 'Comparison needs a calibrated, marked lift'
            }
            disabled={!comparable}
            aria-pressed={comparing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 9px',
              border: '1px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              background: comparing ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
              color: comparable
                ? comparing
                  ? 'var(--color-accent)'
                  : 'var(--color-text-primary)'
                : 'var(--color-text-tertiary)',
              fontSize: 'var(--text-micro)',
              fontFamily: 'inherit',
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: comparable ? 'pointer' : 'not-allowed',
            }}
          >
            <Columns2 size={12} />
            COMPARE
          </button>
          <button
            type="button"
            onClick={() => void toggleReference()}
            disabled={!comparable || referenceBusy}
            aria-pressed={isReference}
            title={
              !comparable
                ? 'A reference needs a calibrated, marked lift'
                : isReference
                  ? `This is ${clip.athleteName ?? 'the athlete'}’s reference ${clip.exerciseName ?? 'lift'}. Comparison opens on it and the trend view draws it as a line. Press to unmark.`
                  : `Make this ${clip.athleteName ?? 'the athlete'}’s reference ${clip.exerciseName ?? 'lift'} — the one the others are judged against. Replaces any current reference for this exercise.`
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 9px',
              border: '1px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              background: isReference ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
              color: comparable
                ? isReference
                  ? 'var(--color-accent)'
                  : 'var(--color-text-primary)'
                : 'var(--color-text-tertiary)',
              fontSize: 'var(--text-micro)',
              fontFamily: 'inherit',
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: comparable ? 'pointer' : 'not-allowed',
            }}
          >
            <Star size={12} fill={isReference ? 'currentColor' : 'none'} />
            {isReference ? 'REFERENCE' : 'SET REFERENCE'}
          </button>
          <button
            type="button"
            onClick={() => {
              setComparing(false);
              setTrending(current => !current);
            }}
            title={
              clip.athleteId
                ? `${clip.athleteName ?? 'This athlete'}’s analysed lifts over time and against load`
                : 'Trends need an athlete on the clip'
            }
            disabled={!clip.athleteId}
            aria-pressed={trending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 9px',
              border: '1px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-sm)',
              background: trending ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
              color: clip.athleteId
                ? trending
                  ? 'var(--color-accent)'
                  : 'var(--color-text-primary)'
                : 'var(--color-text-tertiary)',
              fontSize: 'var(--text-micro)',
              fontFamily: 'inherit',
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: clip.athleteId ? 'pointer' : 'not-allowed',
            }}
          >
            <TrendingUp size={12} />
            TRENDS
          </button>
          <GradeChip grade={grade} />
        </div>
      </header>

      {saveError && (
        <div
          style={{
            padding: 'var(--space-sm) var(--space-lg)',
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning-text)',
            fontSize: 'var(--text-caption)',
          }}
        >
          {saveError}
        </div>
      )}

      {/* `comparable` spelled out, because a boolean does not narrow the three
          nullable values the view needs. Same conjunction, by definition. */}
      {comparing && kinematics && liftMetrics && repSummary && (
        <ComparisonView
          current={{
            label: [title, clip.date ? formatDateShort(clip.date) : null]
              .filter(Boolean)
              .join(' · '),
            date: clip.date,
            points,
            series: kinematics,
            boundaries,
            metrics: liftMetrics,
            summary: repSummary,
            grade: grade.grade,
            massKg,
            phaseSetId: 'default',
          }}
          candidates={candidates}
          selectedId={comparisonId}
          onSelect={setComparisonId}
          subject={comparisonSubject}
          loading={comparisonLoading}
          anchor={alignment}
          onAnchor={setAlignment}
          onClose={() => setComparing(false)}
          playback={playback}
        />
      )}

      {trending && (
        <TrendsView
          athleteId={clip.athleteId}
          athleteName={clip.athleteName}
          exerciseName={clip.exerciseName}
          currentAnalysisId={analysisIdRef.current}
          onClose={() => setTrending(false)}
          onOpen={record => {
            setTrending(false);
            navigate(`/kinemos/analysis/${record.sourceKind}/${record.sourceId}`);
          }}
        />
      )}

      <div
        style={{
          flexGrow: 1,
          display: trending || (comparing && comparable) ? 'none' : 'flex',
          minHeight: 0,
        }}
      >
        {/* Tool rail */}
        <nav
          style={{
            width: 48,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: 'var(--space-sm) 0',
            background: 'var(--color-bg-primary)',
            borderRight: '1px solid var(--color-border-tertiary)',
          }}
        >
          {TOOLS.map(({ id: toolId, label, icon: Icon, key }) => (
            <button
              key={toolId}
              type="button"
              title={`${label} (${key})`}
              aria-label={label}
              aria-pressed={tool === toolId}
              onClick={() => {
                setTool(toolId);
                setMeasurePoints([]);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: tool === toolId ? 'var(--color-accent-muted)' : 'transparent',
                color: tool === toolId ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={16} />
            </button>
          ))}
        </nav>

        {/* Stage */}
        <main
          style={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
            padding: 'var(--space-md)',
            background: 'var(--color-bg-tertiary)',
          }}
        >
          {!analysable && (
            <ErrorState
              message={
                'This clip is hosted as a streaming embed, so KinEMOS cannot reach its frames. ' +
                'Clips stored as files — every direct import, and log or competition clips in the ' +
                'video buckets — analyse normally.'
              }
            />
          )}

          {analysable && status === 'error' && (
            <ErrorState message={frameError ?? 'Unknown error.'} />
          )}

          {analysable && (status === 'opening' || status === 'idle') && (
            <div style={{ display: 'grid', placeItems: 'center', flexGrow: 1 }}>
              <Spinner />
            </div>
          )}

          {/* A frame that would not decode. The stage is blank behind this —
              deliberately, because a stale frame under a live transport is how
              a mark gets stored against a timestamp it does not belong to. */}
          {analysable && status === 'ready' && decodeError && (
            <div
              style={{
                flexShrink: 0,
                padding: 'var(--space-sm) var(--space-lg)',
                background: 'var(--color-warning-bg)',
                color: 'var(--color-warning-text)',
                fontSize: 'var(--text-caption)',
              }}
            >
              {`${decodeError} Nothing is shown rather than the frame before it — step past it, or re-import the clip if it persists.`}
            </div>
          )}

          {analysable && status === 'ready' && server && (
            <>
              <ViewerStage
                canvas={frame?.canvas ?? null}
                width={server.displayWidth}
                height={server.displayHeight}
                tool={tool}
                points={points}
                currentT={currentT}
                showPath
                ellipse={ellipse}
                onEllipseChange={next => {
                  dirtyRef.current = true;
                  setEllipse(next);
                }}
                measurePoints={measurePoints}
                onMeasurePoint={addMeasurePoint}
                onMark={handleMark}
                knee={kneePoint}
                onKnee={p => void markKnee(p)}
              />
              <ViewerTransport
                index={index}
                frameCount={server.frameCount}
                timestamps={server.timestamps}
                playing={playing}
                speed={speed}
                markedTimes={points.map(p => p.t)}
                uncertainIndices={uncertainIndices}
                fps={server.averageFps}
                vfr={server.isVfr}
                onSeek={seek}
                onStep={step}
                onTogglePlay={togglePlay}
                onSpeed={setSpeed}
              />
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                ← → step a frame · ⇧ steps ten · space plays · V/C/M/D/A pick a tool · R resets
                phase edges · shift-drag pans
              </p>
            </>
          )}
        </main>

        {/* Rail */}
        <aside
          style={{
            width: 304,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-primary)',
            borderLeft: '1px solid var(--color-border-tertiary)',
            overflowY: 'auto',
          }}
        >
          <CalibrationPanel
            ellipse={ellipse}
            calibration={calibration}
            plateDiameterCm={plateDiameterCm}
            active={tool === 'calibrate'}
            onPlateDiameter={cm => {
              dirtyRef.current = true;
              setPlateDiameterCm(cm);
            }}
            onActivate={() => setTool('calibrate')}
            onClear={() => void clearCalibrationNow()}
            onFind={() => void findPlateHere()}
            onSnap={() => void snapHere()}
            assist={assist}
            shape={plateShape}
            onShape={setPlateShape}
            lens={{
              source: lensSource,
              k1: lensK1,
              device: [clip.deviceMake, clip.deviceModel].filter(Boolean).join(' ') || null,
              busy: lensBusy,
              note: lensNote,
              onMeasure: () => void measureLens(),
              onClear: clearLens,
            }}
          />
          <ReadoutRail
            repIndices={repIndices}
            repIndex={repIndex}
            onRep={setRepIndex}
            onAddRep={addRep}
            metrics={metrics}
            markedHere={currentT !== null && points.some(p => Math.abs(p.t - currentT) < 1e-6)}
            onDeleteMark={deleteMarkHere}
            onClearMarks={() => void clearMarks()}
            tool={tool}
            measureValue={measureValue}
            kneeCm={kneeCm}
            kneeMarked={kneePoint !== null}
            share={{
              athleteName: clip.athleteId ? clip.athleteName ?? 'the athlete' : null,
              shares,
              busy: shareBusy,
              note: shareNote,
              ready: points.length > 1 && calibration !== null && repSummary !== null,
              onShare: message => void shareNow(message),
              onDelete: shareId => void removeShare(shareId),
              onExport: () => void exportNow(),
              exporting,
              exportNote,
              talkoverIncluded: latestTalkover !== null,
              colleagues,
              onShareWithCoach: (coachId, message) => void shareWithCoach(coachId, message),
            }}
            talkover={
              talkoverMimeType() === null
                ? null
                : {
                    recording: talkover !== null,
                    startedAt: talkover?.startedAt ?? null,
                    busy: talkoverBusy,
                    note: talkoverNote,
                    onToggle: () => void toggleTalkover(),
                  }
            }
            measureComplete={measureComplete}
            onSaveMeasurement={() => void saveMeasurement()}
            onClearMeasurement={() => setMeasurePoints([])}
            annotations={annotations}
            onAddNote={body => void addNote(body)}
            onSnapshot={() => void takeSnapshot()}
            onDeleteAnnotation={annotationId => void removeAnnotation(annotationId)}
            snapshotBusy={snapshotBusy}
            tracking={{
              canTrack: points.length > 0 && status === 'ready',
              busy: trackProgress,
              tier: trackerTier === 'manual' ? 'manual' : 'assisted',
              uncertainCount: uncertainIndices.length,
              correctionCount,
              onTrack: () => void runTrack(),
              onNextUncertain: jumpToNextUncertain,
              onTrackSet: points.length > 0 && status === 'ready' && ellipse ? () => void trackSetNow() : undefined,
              setNote,
            }}
          />
          <MetricsPanel
            metrics={liftMetrics}
            summary={repSummary}
            massKg={massKg}
            massSource={massSource}
            onMass={kg => {
              dirtyRef.current = true;
              setMassKg(kg !== null && Number.isFinite(kg) ? kg : null);
              setMassSource(kg === null ? null : 'manual');
            }}
            emptyReason={metricsEmptyReason}
            knee={kneeReadout}
          />
          <GradePanel
            grade={grade}
            camera={camera}
            onCamera={next => {
              dirtyRef.current = true;
              setCamera(next);
            }}
            stabilise={
              points.length >= 8
                ? { onRun: () => void stabiliseNow(), progress: stabiliseProgress, note: stabiliseNote }
                : undefined
            }
            recentre={
              points.length >= 8 && ellipse
                ? { onRun: () => void recentreNow(), progress: recentreProgress, note: recentreNote }
                : undefined
            }
          />
        </aside>
      </div>

      {analysable && status === 'ready' && !comparing && (
        <AnalysisPanel
          series={kinematics}
          spans={spans}
          boundaries={boundaries}
          onBoundaryDrag={dragBoundary}
          onBoundaryCommit={commitBoundary}
          currentT={currentT}
          onSeekT={t => {
            if (server) seek(server.nearestIndex(t));
          }}
          emptyReason={analysisEmptyReason}
          kneeCm={kneeCm}
        />
      )}
    </div>
  );
}
