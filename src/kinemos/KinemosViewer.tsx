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
import { ChevronLeft, Circle, Crosshair, Hand, Minus, Ruler, Share2, Triangle } from 'lucide-react';
import { Button, ErrorState, SegmentedControl, Spinner, confirmDialog } from '../components/ui';
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
  computeLiftMetrics,
  enforceMonotonic,
  kneeCrossing,
  spansFrom,
  type PhaseBoundary,
} from './engine/phases';
import { liftModelById, liftModelOfStored, partForKind, shapesComparable, type LiftModel } from './engine/liftModels';
import { describeHow, type LiftModelHow } from './lib/liftModelResolve';
import { gradeAnalysis, type CameraStability, type TrackerTier } from './engine/grade';
import { trackFromAnchor } from './engine/tracker';
import type { AlignmentAnchor } from './engine/compare';
import { catalogueFor, fromStoredMetrics, toStoredMetrics } from './engine/metricCatalogue';
import { ComparisonView } from './components/ComparisonView';
import { TrendsView } from './components/TrendsView';
import { markAsReference } from './lib/referenceService';
import { findPlateOnFrame, recentreTrackOnOutline, snapEllipseOnFrame, stabiliseTrack, trackMarkerFrom } from './lib/assists';
import { trackSet, type TrackSetResult } from './lib/setTracker';
import { scanActivity, windowLabel } from './lib/activityScan';
import type { ActivitySample } from './engine/activity';
import { windowRanges, type LiftWindow } from './engine/activity';
import { splitReps } from './engine/reps';
import { persistRep, proposePhasesFor } from './lib/autoAnalyse';
import { EMBED_ANALYSED_NOTE, EMBED_UNANALYSED_NOTE } from './lib/uploadAnalysis';
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
import { PhaseTimeline, VelocityChart } from './components/AnalysisPanel';
import { BarPathPanel } from './components/BarPathPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { historyRows } from './lib/history';
import { LiftPanel } from './components/LiftPanel';
import { HeadlineChip, RailPanel } from './components/RailPanel';
import { useEvent } from './hooks/useEvent';
import { useMediaQuery } from './hooks/useMediaQuery';
import { DEPTH_LABELS, PANEL_KEYS, useViewerPanels, type ViewerDepth } from './hooks/useViewerPanels';
import { findEarlierLift, verdictFor } from './lib/verdict';
import { frameConfidences, lowConfidenceFrames, toTrackPoint } from './lib/trackedPoints';
import { CalibrationPanel, type LensState } from './components/CalibrationPanel';
import { GradeChip, GradePanel } from './components/GradePanel';
import { MetricsPanel } from './components/MetricsPanel';
import { ReadoutRail, type ShareState, type TalkoverState, type TrackingState } from './components/ReadoutRail';
import { ViewerStage, type ViewerTool } from './components/ViewerStage';
import { useDisplayPrefs } from './hooks/useDisplayPrefs';
import { DEFAULT_DISPLAY_PREFS, heatScaleMs, velocityColour } from './lib/displayPrefs';
import { ColumnSplitter } from './components/ColumnSplitter';
import { PATH_WIDTH_RANGE, VIDEO_WIDTH_RANGE, useColumnWidths } from './hooks/useColumnWidths';
import { useElementWidth } from './hooks/useElementWidth';
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

/** What the viewer keeps of an activity scan (P7 plan): the windows and
 *  the cost, cached per clip under `LIFT_SCAN_KEY` + the clip key. */
interface LiftScan {
  windows: LiftWindow[];
  frames: number;
  msPerFrame: number;
}
const LIFT_SCAN_KEY = 'kinemos.scan.';

/** What TRACK THE SET reads of a set tracker's result, whether from one
 *  call over the whole clip or several inside the lifts. */
type SetOutcome = Pick<TrackSetResult, 'points' | 'reps' | 'joins' | 'lostAtEnd' | 'colour'>;

/** "12,4 s" — a clip time for a sentence. */
function secs(t: number): string {
  return `${t.toFixed(1).replace('.', ',')} s`;
}

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
  /** Each rep's stored peak velocity, for the rep pills — what the cache
   *  column says, so the pills need no second pipeline run. */
  const [repPeaks, setRepPeaks] = useState<Record<number, number | null>>({});
  /** Each rep's stored lift model id, for the pills: a clean & jerk's reps
   *  read "Clean" and "Jerk" rather than "Rep 1" and "Rep 2". */
  const [repModels, setRepModels] = useState<Record<number, string | null>>({});
  /**
   * The lift model this rep is segmented under (P9), and where that came
   * from: the stored row, the coach's pick in the chip, or — when neither —
   * the clip's exercise (`clip.liftModelId`) and, failing that, a snatch
   * from the floor, assumed and said so.
   */
  const [liftModel, setLiftModel] = useState<{ id: string; how: LiftModelHow | 'stored' | 'coach' } | null>(null);

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
  /** Set when a rep is loaded: the flagged frames come from the stored
   *  scores, and placing them needs the frame server. */
  const rebuildUncertainRef = useRef(false);
  /** Where the activity scan found the lifts (P7 plan): shown on the
   *  scrub strip before anything is tracked, and what TRACK THE SET works
   *  inside. Null until the scan has run (or was found cached). */
  const [liftScan, setLiftScan] = useState<LiftScan | null>(null);
  const [trackProgress, setTrackProgress] = useState<{ done: number; total: number } | null>(null);

  const [comparing, setComparing] = useState(false);
  // Trends and comparison are two readings of the same athlete's history and
  // take the same space, so opening one closes the other.
  const [trending, setTrending] = useState(false);
  // Whether this rep is the athlete's reference lift for the exercise. Written
  // straight through on toggle rather than via the debounced save: it is one
  // deliberate act, not a drag, and it has to clear the previous holder.
  const [isReference, setIsReference] = useState(false);
  const [isModel, setIsModel] = useState(false);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
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
  /** What the last "track the rest" said — on the lift panel, where the offer was. */
  const [restNote, setRestNote] = useState<string | null>(null);
  /**
   * Where the next part of the clip begins, kept from the moment the coach
   * pressed "+ rep": the end of the rep they were on — or the playhead, when
   * they had already scrubbed past that end to where the next lift starts.
   * The new, empty rep can then be tracked from there to the end of the clip
   * without a mark; a set the tracker cut wrongly is finished this way.
   */
  const [restStart, setRestStart] = useState<{
    index: number;
    t: number;
    x: number;
    y: number;
    ellipse: PlateEllipse;
    afterRep: number;
    /** The coach chose the frame; the plate is found on it before tracking. */
    atPlayhead: boolean;
  } | null>(null);
  const display = useDisplayPrefs();
  const stageModified = useMemo(
    () => JSON.stringify(display.prefs.stage) !== JSON.stringify(DEFAULT_DISPLAY_PREFS.stage),
    [display.prefs.stage],
  );
  const plotModified = useMemo(
    () => JSON.stringify(display.prefs.plot) !== JSON.stringify(DEFAULT_DISPLAY_PREFS.plot),
    [display.prefs.plot],
  );
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
  // decode, so nothing can be MEASURED here (P1 plan §4). It may still carry
  // reps — analysed on the athlete's phone at upload (P8 plan) — and those
  // the rail and the analysis panel show from the stored rows, over the
  // Stream player rather than a black stage.
  const analysable = clip !== null && !clip.isEmbed;
  const embedded = clip !== null && clip.isEmbed;
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

  useEffect(() => {
    if (!rebuildUncertainRef.current || status !== 'ready' || !server) return;
    rebuildUncertainRef.current = false;
    setUncertainIndices(lowConfidenceFrames(points, server.nearestIndex));
  }, [points, status, server]);

  /** Every stored point on its frame with the tracker's score — the
   *  confidence strip's data. */
  const frameScores = useMemo(
    () => (server && status === 'ready' ? frameConfidences(points, server.nearestIndex) : []),
    [points, server, status],
  );

  // ── The lifts in the clip ─────────────────────────────────────────────────
  //
  // The activity scan (P7 plan) runs once per clip, in the background on its
  // own thumbnail frame server, as soon as the clip is open; its windows go
  // on the scrub strip and TRACK THE SET stays inside them. Cached per clip
  // in localStorage so reopening an analysed rep does not decode the clip
  // again; the cache holds the windows and the timing, nothing heavier.
  //
  // Only while the clip is IDLE. The scan is a second decoder run on the same
  // clip, and on a 60 fps phone clip it took playback from smooth to a
  // stutter (07/09/2026): both runs queue on one hardware decoder. So it
  // starts a moment after the clip opens, stops the instant the coach presses
  // play, and resumes from the frame it reached once the clip is paused
  // again (`resumeFrom`) — never from scratch.
  const scanPartialRef = useRef<{ frames: number; samples: ActivitySample[] } | null>(null);
  useEffect(() => {
    scanPartialRef.current = null;
    setLiftScan(null);
  }, [clipKey]);
  useEffect(() => {
    if (status !== 'ready' || !playbackUrl || !clipKey || playing || liftScan) return;
    const key = `${LIFT_SCAN_KEY}${clipKey}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw) as LiftScan;
        if (Array.isArray(cached.windows)) {
          setLiftScan(cached);
          return;
        }
      }
    } catch {
      // No cache, or none readable: scan.
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      scanActivity(playbackUrl, { shouldStop: () => cancelled, resumeFrom: scanPartialRef.current ?? undefined })
        .then(result => {
          if (result.stopped) {
            // Interrupted by play: keep what was seen for the next idle moment.
            scanPartialRef.current = { frames: result.frames, samples: result.samples };
            return;
          }
          if (cancelled) return;
          scanPartialRef.current = null;
          const summary: LiftScan = { windows: result.windows, frames: result.frames, msPerFrame: result.msPerFrame };
          setLiftScan(summary);
          try {
            localStorage.setItem(key, JSON.stringify(summary));
          } catch {
            // Storage full or refused: the scan simply runs again next time.
          }
        })
        .catch(() => {
          // A clip the thumbnail server cannot open is one the main server
          // could not either; nothing to say here that the stage does not.
        });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, playbackUrl, clipKey, playing, liftScan]);

  const liftSpans = useMemo(() => {
    if (!server || !liftScan || liftScan.windows.length === 0) return [];
    return windowRanges(liftScan.windows, server.timestamps).map((range, k) => ({
      from: range.from,
      to: range.to,
      label: `lift, ${windowLabel(liftScan.windows[k])}`,
    }));
  }, [server, liftScan]);

  // ── The rep's stored record ───────────────────────────────────────────────
  useEffect(() => {
    if (!source || !id) return;
    let cancelled = false;
    listReps(source, id)
      .then(reps => {
        if (cancelled) return;
        const indices = reps.map(r => r.rep_index);
        setRepIndices(indices.length > 0 ? indices : [1]);
        const peaks: Record<number, number | null> = {};
        const models: Record<number, string | null> = {};
        for (const r of reps) {
          const stored = fromStoredMetrics(r.metrics);
          peaks[r.rep_index] = stored?.analyzer.vmaxMs ?? stored?.peakVelocityMs ?? null;
          models[r.rep_index] = r.lift_model_id ?? null;
        }
        setRepPeaks(peaks);
        setRepModels(models);
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
    setIsModel(false);
    setModelLabel(null);
    setAssist({ busy: null, note: null });
    setStabiliseNote(null);
    setLiftModel(null);
    // The logged load is the best first guess at bar mass, and it is already on
    // the library row. A coach who filmed a different set overwrites it.
    setMassKg(clip?.loadKg ?? null);
    setMassSource(clip?.loadKg == null ? null : 'logged');

    loadBundle(source, id, repIndex)
      .then(bundle => {
        if (cancelled || !bundle) return;
        analysisIdRef.current = bundle.analysis.id;
        setPoints(bundle.track?.points ?? []);
        // The flagged list is read back from the stored scores once the
        // frame server can place the points on frames — below.
        rebuildUncertainRef.current = true;
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
        // The model the rep was stored under. A row analysed before P9 has
        // none and reads as a snatch from the floor; a row that was only
        // ever created — no metrics yet — has nothing to say, and the clip's
        // exercise decides.
        if (bundle.analysis.lift_model_id || bundle.analysis.metrics) {
          setLiftModel({ id: liftModelOfStored(bundle.analysis.lift_model_id, bundle.analysis.phase_set_id).id, how: 'stored' });
        }
        setIsReference(bundle.analysis.is_reference === true);
        setIsModel(bundle.analysis.is_model === true);
        setModelLabel(bundle.analysis.model_label ?? null);
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

  // ── The lift model ────────────────────────────────────────────────────────
  /** The clip's model: stored on the rep, picked by the coach, resolved from
   *  the exercise, or assumed. A compound (clean & jerk) is what the SET is
   *  cut as; a single rep of it is segmented as one of its parts. */
  const clipModel = useMemo<LiftModel>(
    () => liftModelById(liftModel?.id ?? clip?.liftModelId ?? 'snatch'),
    [liftModel?.id, clip?.liftModelId],
  );
  const model = useMemo<LiftModel>(
    () => (clipModel.shape === 'compound' ? partForKind(clipModel, 'pull') : clipModel),
    [clipModel],
  );
  const modelHow: string = liftModel?.how ?? (clip?.liftModelId ? describeHow(clip.liftModelHow) : 'assumed');
  /** The coach picks a model in the chip: the phases are re-proposed under
   *  it, and any edges dragged under the old set are let go — they named
   *  phases the new set may not have. */
  const chooseModel = useCallback((id: string) => {
    setLiftModel({ id, how: 'coach' });
    setCoachBoundaries(null);
    dirtyRef.current = true;
  }, []);

  /** One object for the lift panel's chip, stable across frame steps so the
   *  panel does not re-render with the playhead. */
  const liftPanelModel = useMemo(
    () => ({ current: model, clipModel, how: modelHow, onChange: chooseModel }),
    [model, clipModel, modelHow, chooseModel],
  );

  const proposal = useMemo(() => (kinematics ? proposePhasesFor(kinematics, model) : null), [kinematics, model]);

  const boundaries = useMemo(() => {
    if (!kinematics) return [];
    if (!coachBoundaries) return proposal?.boundaries ?? [];
    const first = kinematics.t[0];
    const last = kinematics.t[kinematics.t.length - 1];
    // Boundaries stored before 0.90.0 were on a clock zeroed at the rep's
    // first mark; the series is on the clip's clock now. A set that lies
    // entirely before the series starts can only be the old clock — shift it.
    const rezeroed = coachBoundaries.length > 0 && coachBoundaries.every(b => b.t < first - 1e-6);
    const onClipClock = rezeroed ? coachBoundaries.map(b => ({ ...b, t: b.t + first })) : coachBoundaries;
    // A coach's set is clamped to the clip it is being shown against — a rep
    // re-marked shorter must not leave an edge hanging past the end.
    return enforceMonotonic(onClipClock, first, last);
  }, [kinematics, coachBoundaries, proposal]);

  const spans = useMemo(() => spansFrom(boundaries, model.phaseSet ?? []), [boundaries, model]);

  // A lift with no phases (the unspecified lift) still has its universal
  // numbers: the metrics are computed over an empty span list.
  const liftMetrics = useMemo(
    () => (kinematics && (spans.length > 0 || model.phaseSet === null) ? computeLiftMetrics(kinematics, spans) : null),
    [kinematics, spans, model.phaseSet],
  );

  const repSummary = useMemo(() => (kinematics ? summariseRep(kinematics) : null), [kinematics]);

  /**
   * The path over the video, coloured: by the bar's vertical velocity at each
   * point (the series is on the clip's clock, so a point's time reads straight
   * off it) or by the phase the point falls in. One colour per stored point,
   * aligned to `points`; null when the coach wants one colour or there is no
   * calibrated series to colour by.
   */
  const pointColours = useMemo<string[] | null>(() => {
    const mode = display.prefs.stage.colour;
    if (mode === 'plain' || !kinematics || points.length === 0) return null;
    if (mode === 'velocity') {
      const scale = heatScaleMs(kinematics.vyMs);
      return points.map(p => velocityColour(valueAt(kinematics.t, kinematics.vyMs, p.t) ?? 0, scale));
    }
    return points.map(p => spans.find(sp => p.t >= sp.fromT && p.t <= sp.toT)?.definition.color ?? '#9CA3AF');
  }, [display.prefs.stage.colour, kinematics, points, spans]);
  const colourReason = kinematics ? null : 'needs a calibrated track';
  /** A real-centimetre grid through the plate's own scales, from the bar's start. */
  const cmGrid = useMemo(() => {
    if (!calibration || points.length === 0 || display.prefs.stage.grid !== 'cm') return null;
    const cm = display.prefs.stage.gridCm;
    return { xStep: cm / calibration.cmPerPxH, yStep: cm / calibration.cmPerPxV, origin: { x: points[0].x, y: points[0].y }, cm };
  }, [calibration, points, display.prefs.stage.grid, display.prefs.stage.gridCm]);

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

  /** Why there are no numbers, in one line — the bar-path column, the
   *  chart and the lift panel all say this one thing. */
  const metricsEmptyReason = useMemo(() => {
    if (!calibration) return 'Calibrate a plate to get velocities.';
    if (calibration.confidence === 'degenerate')
      return 'The plate outline is too small to measure against.';
    if (points.length < 8) return `${points.length} of at least 8 marks so far.`;
    return null;
  }, [calibration, points.length]);

  /** What the stage says over a Stream embed: that the reps below came
   *  from the athlete's phone, or that there are none (P8 plan §4). */
  const embedNote = embedded ? (points.length > 0 ? EMBED_ANALYSED_NOTE : EMBED_UNANALYSED_NOTE) : null;

  // ── The rail's composition ────────────────────────────────────────────────
  const panels = useViewerPanels(clip?.athleteId ?? null);
  const notesPanelRef = useRef<HTMLElement | null>(null);
  /** Below this the panel rail drops under the plots instead of shrinking
   *  beside them (docs/KINEMOS_VIEWER_LAYOUT.md, Responsive). */
  const wide = useMediaQuery('(min-width: 1200px)');
  /** The clip and bar-path columns' widths: the wireframe's by default, the
   *  coach's after a drag on a splitter, remembered per orientation. */
  const portraitClip = server
    ? server.displayHeight >= server.displayWidth
    : (clip?.height ?? 0) >= (clip?.width ?? 0);
  const columns = useColumnWidths(portraitClip, portraitClip ? 392 : 600);
  /**
   * What the window can afford. The rail keeps `RAIL_MIN` whatever the
   * columns ask for: the clip column gives way first, down to its floor,
   * then the bar path. A drag past the cap stores the wish and shows the
   * cap, so a wider window later honours the wish.
   */
  const [rowRef, rowWidth] = useElementWidth<HTMLDivElement>();
  const RAIL_MIN = 320;
  const TOOL_RAIL = 40;
  const ROW_GAPS = 5 * 12; // five `--space-md` gaps: tools, clip, splitter, path, splitter, rail
  const budget = rowWidth > 0 ? rowWidth - TOOL_RAIL - ROW_GAPS - RAIL_MIN : Number.POSITIVE_INFINITY;
  const videoWidth = Math.max(VIDEO_WIDTH_RANGE.min, Math.min(columns.video, budget - columns.path));
  const pathWidth = Math.max(PATH_WIDTH_RANGE.min, Math.min(columns.path, budget - videoWidth));

  /** The lift this one is judged against, and the sentence that judgement
   *  makes — gated on the grade's margin. */
  const peakForVerdict = liftMetrics?.analyzer.vmaxMs ?? liftMetrics?.peakVelocityMs ?? null;
  const earlierLift = useMemo(
    () => findEarlierLift(candidates, { date: clip?.date ?? null, loadKg: clip?.loadKg ?? null }),
    [candidates, clip?.date, clip?.loadKg],
  );
  const verdict = useMemo(
    () =>
      verdictFor(
        { peakVelocityMs: peakForVerdict, loadKg: clip?.loadKg ?? null, errorMs: grade.expectedVelocityErrorMs },
        earlierLift,
      ),
    [peakForVerdict, clip?.loadKg, grade.expectedVelocityErrorMs, earlierLift],
  );
  const history = useMemo(
    () =>
      historyRows(candidates, {
        analysisId: analysisIdRef.current,
        date: clip?.date ?? null,
        loadKg: clip?.loadKg ?? null,
        peakVelocityMs: peakForVerdict,
        sVmaxCm: liftMetrics?.analyzer.sVmaxCm ?? null,
        grade: grade.grade,
        current: true,
        isReference,
      }),
    // `analysisIdRef` is a ref; the row's id is read when the inputs change,
    // which is after the first save at the latest.
    [candidates, clip?.date, clip?.loadKg, peakForVerdict, liftMetrics, grade.grade, isReference],
  );
  /** The catalogue as this lift's model sees it, and how many of its
   *  measures the lift has a value for. */
  const modelCatalogue = useMemo(() => catalogueFor(model), [model]);
  const metricCount = useMemo(
    () => (liftMetrics ? modelCatalogue.filter(m => m.read({ metrics: liftMetrics, summary: repSummary }) !== null).length : 0),
    [liftMetrics, repSummary, modelCatalogue],
  );

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
            phaseSetId: model.phaseSetId,
            liftModelId: model.id,
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
  //
  // The athlete's other analysed lifts are read as soon as the clip is open,
  // not only when the comparison view is: "This lift" judges the rep against
  // the last one at this load, and "History & comparison" lists them. Two
  // list reads; the heavy part — another clip's bundle — waits for a choice.
  useEffect(() => {
    if (!source || !id || !clip?.athleteId) return;
    let cancelled = false;
    findComparable(
      { kind: source, id, repIndex },
      clip.athleteId,
      clip.exerciseName ?? null,
    )
      .then(found => {
        // Same motion shape or not offered at all: a jerk laid over a
        // snatch compares nothing (P9 plan §5.7).
        if (!cancelled) {
          setCandidates(
            found.filter(c => shapesComparable(liftModelOfStored(c.analysis.lift_model_id, c.analysis.phase_set_id), model)),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, id, repIndex, clip?.athleteId, clip?.exerciseName, model]);

  useEffect(() => {
    if (!comparing) return;
    // Nothing chosen yet: open on the athlete's reference for this
    // exercise, which is what the reference is for.
    const reference = candidates.find(c => c.sameExercise && c.isReference);
    if (reference) setComparisonId(current => current ?? reference.analysis.id);
  }, [comparing, candidates]);

  useEffect(() => {
    if (!comparisonId || !comparing) {
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
  }, [comparisonId, candidates, comparing]);

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
        // Only the lift. The tracker follows the plate through the drop and
        // the walk-away too, and those frames would set the peak velocity
        // (a dropped bar falls faster than any pull) and the apex. With a
        // calibration the track is cut to the rep the anchor sits in —
        // lift-off to the deepest point of the catch, the same cut the set
        // tracker makes — and the rest is left out, said so, and never
        // stored. Without one there is no scale to find a rest by, so the
        // whole track stands.
        let kept = result.points;
        let leftOut = 0;
        let noLift = false;
        if (calibration) {
          const sorted = [...result.points].sort((a, b) => a.t - b.t);
          const segments = splitReps(sorted, calibration);
          const anchorT = server.timestamps[anchorIndex] ?? sorted[0].t;
          const segment =
            segments.find(s => sorted[s.from].t <= anchorT && anchorT <= sorted[s.to].t) ??
            segments[0];
          if (segment) {
            // Led by the rest before lift-off (up to 0,4 s of it): lift-off
            // is a rise out of stillness, and the phase detector needs the
            // stillness to find it.
            let from = segment.from;
            while (from > 0 && sorted[segment.from].t - sorted[from - 1].t <= 0.4) from--;
            kept = sorted.slice(from, segment.to + 1);
            leftOut = sorted.length - kept.length;
          } else {
            noLift = true;
          }
        }
        const keptIndex = new Set(kept.map(p => p.index));
        setPoints(kept.map(toTrackPoint));
        setUncertainIndices(result.lowConfidenceIndices.filter(i => keptIndex.has(i)));
        setTrackerTier('assisted');
        const notes: string[] = [];
        if (noLift) {
          // The testset's training-hall clip: the bar drifts, is never lifted,
          // and the camera pans away — analysed whole, its "peak velocity" is
          // the pan. Said, so the numbers are read for what they are.
          notes.push(
            'No lift found in this track — no rest followed by a rise of 40 cm or more — so the ' +
              'whole track is kept and the phases are guesses. If there is a lift, check the calibration; ' +
              'if the bar only moved, the numbers below are not a lift.',
          );
        }
        if (leftOut > 0) {
          notes.push(
            `Kept the lift only: ${leftOut} tracked frame${leftOut === 1 ? '' : 's'} outside it ` +
              '(before lift-off, or the drop after the catch) were left out.',
          );
        }
        const endsWhereTrackEnded =
          leftOut === 0 || kept[kept.length - 1].index === result.points[result.points.length - 1].index;
        if (result.gaveUp && endsWhereTrackEnded) {
          notes.push(
            'The tracker lost the bar part way through, so the track stops there. Mark it again ' +
              'further on and re-track.',
          );
        } else if (result.stoppedAt?.reason === 'drop' && endsWhereTrackEnded) {
          // Not a loss: the tracker stops where the bar is let go, on
          // purpose, because the fall and the bounce are not the lift.
          notes.push('The track ends where the bar was dropped.');
        }
        setSaveError(notes.length ? notes.join(' ') : null);
      } catch {
        setSaveError('Tracking failed — the clip could not be read frame by frame.');
      } finally {
        source.dispose();
        setTrackProgress(null);
      }
    },
    [server, calibration],
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
  /**
   * Persist every rep of a set track. Rep k takes index (repIndex + k), so the
   * current analysis becomes rep 1 and a set tracked twice lands on the same
   * rows; rep 1 is taken into the viewer directly, already saved.
   */
  const persistSetReps = useCallback(
    async (result: SetOutcome): Promise<number[]> => {
      if (!server || !source || !id) return [];
      const owner = getOwnerId();
      const indices: number[] = [];
      const models: Record<number, string | null> = {};
      let firstApplied = false;
      for (const rep of result.reps) {
        const index = repIndex + rep.rep - 1;
        // A clean & jerk's reps land on the clean and the jerk by what the
        // bar did first; a plain model is its own part.
        const part = partForKind(clipModel, rep.segment.kind);
        // One definition of what a stored rep is, shared with the automatic
        // run on the library (`lib/autoAnalyse.ts`).
        const analysisId = await persistRep({
          source,
          sourceId: id,
          repIndex: index,
          server,
          ownerId: owner,
          points: rep.points,
          ellipse: rep.ellipse,
          calibration: rep.calibration,
          calibratedAt: { index: server.nearestIndex(rep.segment.liftOffT), t: rep.segment.liftOffT },
          massKg,
          massSource,
          camera,
          model: part,
        });
        indices.push(index);
        models[index] = part.id;
        if (!firstApplied) {
          firstApplied = true;
          analysisIdRef.current = analysisId;
          dirtyRef.current = false;
          setLiftModel({ id: part.id, how: 'stored' });
          setPoints(rep.points);
          setEllipse(rep.ellipse);
          setUncertainIndices(rep.lowConfidenceIndices);
          setTrackerTier('assisted');
          setCorrectionCount(0);
        }
      }
      setRepIndices(current => [...new Set([...current, ...indices])].sort((a, b) => a - b));
      setRepModels(current => ({ ...current, ...models }));
      return indices;
    },
    [server, source, id, repIndex, massKg, massSource, camera, clipModel],
  );

  /**
   * The rest of the clip, from where "+ rep" left off, as reps of this and
   * the following indices. The same set tracker as TRACK THE SET, held to the
   * frames after the previous rep (`range`), anchored on the plate where that
   * rep left it — or, when the coach scrubbed ahead first, found again on the
   * frame they chose. This is how a set the tracker cut wrongly is finished:
   * the coach keeps what is right, adds a rep, and tracks on from there.
   */
  const trackRestNow = useCallback(async () => {
    if (!server || !source || !id || !restStart) return;
    const from = Math.min(restStart.index, server.frameCount - 1);
    setTrackProgress({ done: 0, total: server.frameCount - from });
    setSetNote(null);
    setRestNote(null);
    const say = (note: string) => {
      setSetNote(note);
      setRestNote(note);
    };
    try {
      let at = { index: from, x: restStart.x, y: restStart.y };
      let outline = restStart.ellipse;
      if (restStart.atPlayhead) {
        const found =
          (await findPlateOnFrame(server, from, { x: restStart.x, y: restStart.y }, { shape: plateShape })) ??
          (await findPlateOnFrame(server, from, undefined, { shape: plateShape }));
        if (found) {
          at = { index: from, x: found.ellipse.cx, y: found.ellipse.cy };
          outline = found.ellipse;
        }
      }
      const result = await trackSet(server, at, {
        ellipse: outline,
        plateDiameterCm,
        shape: clipModel.shape,
        range: { from, to: server.frameCount - 1 },
        onProgress: (done, total) => setTrackProgress({ done, total }),
      });
      if (result.reps.length === 0) {
        say(
          result.points.length < 8
            ? `The tracker could not get hold of the bar at ${secs(restStart.t)}. Scrub to a still frame where the plate is clear, press + rep again, and try from there — or mark the bar and track by hand.`
            : `Nothing after ${secs(restStart.t)} rises 40 cm from a rest. The clip may end here, or the next lift starts mid-pull — mark the bar and use TRACK for it.`,
        );
        return;
      }
      const indices = await persistSetReps(result);
      setRestStart(null);
      say(
        `${indices.length} rep${indices.length === 1 ? '' : 's'} found after rep ${restStart.afterRep}, from ${secs(restStart.t)} to the end of the clip` +
          (result.joins.length > 0 ? `, the plate found again ${result.joins.length} time${result.joins.length === 1 ? '' : 's'}` : '') +
          (result.lostAtEnd ? '. The tracker lost the bar at the end and did not find it again.' : '.'),
      );
    } catch (e) {
      say(e instanceof Error ? e.message : 'Tracking the rest of the clip failed — the clip could not be read frame by frame.');
    } finally {
      setTrackProgress(null);
    }
  }, [server, source, id, restStart, plateShape, plateDiameterCm, persistSetReps]);

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
      const anchorIndex = server.nearestIndex(anchorPoint.t);
      const onProgress = (done: number, total: number) => setTrackProgress({ done, total });
      const whole = () =>
        trackSet(server, { index: anchorIndex, x: anchorPoint.x, y: anchorPoint.y }, { ellipse, plateDiameterCm, shape: clipModel.shape, onProgress });

      // Inside the lifts the scan found (P7 plan), when it found any. The
      // coach's mark anchors the lift it sits in; every other lift is
      // anchored where the plate finder puts the plate on the still frame
      // before it — near the mark first, anywhere second — and, failing
      // both, at the mark's own coordinates. Nothing found in any lift: the
      // whole clip, as before, so the scan can only ever save time.
      const windows = liftScan?.windows ?? [];
      let result: SetOutcome | null = null;
      if (windows.length > 0) {
        const combined: SetOutcome = { points: [], reps: [], joins: [], lostAtEnd: false, colour: null };
        for (const range of windowRanges(windows, server.timestamps)) {
          let at = { index: range.restIndex, x: anchorPoint.x, y: anchorPoint.y };
          let outline = ellipse;
          if (anchorIndex >= range.from && anchorIndex <= range.to) {
            at = { index: anchorIndex, x: anchorPoint.x, y: anchorPoint.y };
          } else {
            const found =
              (await findPlateOnFrame(server, range.restIndex, { x: anchorPoint.x, y: anchorPoint.y }, { shape: plateShape })) ??
              (await findPlateOnFrame(server, range.restIndex, undefined, { shape: plateShape }));
            if (found) {
              at = { index: range.restIndex, x: found.ellipse.cx, y: found.ellipse.cy };
              outline = found.ellipse;
            }
          }
          const piece = await trackSet(server, at, {
            ellipse: outline,
            plateDiameterCm,
            shape: clipModel.shape,
            range: { from: range.from, to: range.to },
            onProgress,
          });
          combined.points.push(...piece.points);
          combined.joins.push(...piece.joins);
          combined.lostAtEnd = piece.lostAtEnd;
          combined.colour = combined.colour ?? piece.colour;
          for (const rep of piece.reps) combined.reps.push({ ...rep, rep: combined.reps.length + 1 });
        }
        if (combined.reps.length > 0) result = combined;
      }
      const usedLifts = result !== null;
      if (!result) result = await whole();
      if (result.reps.length === 0) {
        setSetNote(
          result.points.length < 8
            ? 'The tracker could not get hold of the bar from that mark.'
            : 'No rep found: nothing in the track rises 40 cm from a rest. A clip that starts mid-pull is one rep — use TRACK for it.',
        );
        return;
      }
      await persistSetReps(result);
      const own = result.reps.filter(r => r.ownCalibration).length;
      const byColour = result.joins.filter(j => j.how === 'colour').length;
      setSetNote(
        `${result.reps.length} rep${result.reps.length === 1 ? '' : 's'} found` +
          (usedLifts
            ? ` inside the ${windows.length} lift${windows.length === 1 ? '' : 's'} the scan marked`
            : windows.length > 0
              ? ' — nothing tracked inside the marked lifts, so the whole clip was tracked'
              : '') +
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
  }, [server, source, id, currentT, ellipse, points, plateDiameterCm, liftScan, plateShape, persistSetReps]);

  /**
   * Follow a marker on the bar end rather than the plate. The coach clicks
   * the sticker, this samples its colour there and follows that colour; the
   * track it produces is stored at the `marker` tier, which the grade prices
   * tighter than the template one because it is.
   */
  const runMarkerTrack = useCallback(async () => {
    if (!server || currentT === null) return;
    const anchorPoint = points.reduce<KinemosTrackPoint | null>(
      (best, p) => (best === null || Math.abs(p.t - currentT) < Math.abs(best.t - currentT) ? p : best),
      null,
    );
    if (!anchorPoint) return;
    setTrackProgress({ done: 0, total: server.frameCount });
    setSetNote(null);
    try {
      const result = await trackMarkerFrom(
        server,
        { index: server.nearestIndex(anchorPoint.t), x: anchorPoint.x, y: anchorPoint.y },
        (done, total) => setTrackProgress({ done, total }),
      );
      if (!result.found) {
        setSetNote(
          'Nothing coloured under that mark. A marker has to be a colour nothing else in shot shares — a bright sticker on the end cap. Without one, TRACK follows the plate.',
        );
        return;
      }
      dirtyRef.current = true;
      setPoints(result.points);
      setUncertainIndices(result.lowConfidenceIndices);
      setTrackerTier('marker');
      setCorrectionCount(0);
      setSetNote(
        `Followed the marker over ${result.points.length} frames` +
          (result.gaveUp ? ', then lost it — it was hidden too long.' : '.') +
          ' Graded at the marker tier.',
      );
    } catch (e) {
      setSetNote(e instanceof Error ? e.message : 'The marker could not be followed.');
    } finally {
      setTrackProgress(null);
    }
  }, [server, currentT, points]);

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

  // `useEvent`, not `useCallback`: it reads the playhead, and a handler that
  // changed on every frame step would re-render the lift panel on every frame.
  const addRep = useEvent(() => {
    const next = Math.max(...repIndices) + 1;
    // Where the next part of the clip starts: the end of the rep being left,
    // or the playhead when the coach has already scrubbed past that end. The
    // plate outline goes with it, since the new rep has none of its own yet.
    if (server && points.length > 0 && ellipse) {
      const last = points[points.length - 1];
      const endIndex = server.nearestIndex(last.t);
      const fromIndex = Math.max(endIndex, index);
      setRestStart({
        index: fromIndex,
        t: server.timestamps[fromIndex] ?? last.t,
        x: last.x,
        y: last.y,
        ellipse,
        afterRep: repIndex,
        atPlayhead: fromIndex > endIndex,
      });
    } else {
      setRestStart(null);
    }
    setRestNote(null);
    setRepIndices(current => [...current, next]);
    setRepIndex(next);
  });

  // A different clip: nothing left to track on from.
  useEffect(() => {
    setRestStart(null);
    setRestNote(null);
  }, [source, id]);

  /** The offer to track on from where "+ rep" left off, while this rep is
   *  still empty and the clip has frames after that point. */
  const trackRest = useMemo(
    () =>
      restStart && server && points.length === 0 && status === 'ready' && restStart.index < server.frameCount - 1
        ? {
            hint: `From ${secs(restStart.t)}${restStart.atPlayhead ? ' (the playhead)' : ` (the end of rep ${restStart.afterRep})`} to the end of the clip. Each lift found becomes a rep, calibrated at its own rest.`,
            run: () => void trackRestNow(),
          }
        : null,
    [restStart, server, points.length, status, trackRestNow],
  );

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

  const toggleReference = async () => {
    if (referenceBusy || !clip) return;
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

  /**
   * Mark this rep as a model lift for the whole club (P5b) — an exemplar
   * offered when comparing ANY athlete, not only its own. Unlike the
   * reference lift there is no one-per-anything rule: a club may keep
   * several models of one lift, and the label is what tells them apart.
   */
  const toggleModel = async () => {
    if (referenceBusy || !clip) return;
    const next = !isModel;
    setReferenceBusy(true);
    try {
      const analysisId = await ensureId();
      if (!analysisId) return;
      const label = next
        ? window.prompt(
            'What is this a model of? A model lift without a name is an anonymous bar path.',
            modelLabel ?? [clip.athleteName, clip.exerciseName].filter(Boolean).join(' · '),
          )
        : null;
      // A cancelled prompt cancels the marking; an empty one does not, because
      // a coach who cleared the box meant to leave it unnamed.
      if (next && label === null) return;
      await saveAnalysisState(analysisId, { isModel: next, modelLabel: next ? label : null });
      setIsModel(next);
      setModelLabel(next ? label : null);
    } catch {
      setSaveError('The model lift could not be saved.');
    } finally {
      setReferenceBusy(false);
    }
  };


  // ── Stable handlers and prop objects ─────────────────────────────────────
  //
  // The viewer re-renders on every frame. The rail's panels are memoised and
  // take these — the same identity from one frame to the next — so a frame
  // step re-renders the stage, the transport, the timeline and the two plots,
  // and nothing else.
  const seekT = useCallback(
    (t: number) => {
      if (server) seek(server.nearestIndex(t));
    },
    [server, seek],
  );
  const on = {
    ellipseChange: useEvent((next: PlateEllipse) => {
      dirtyRef.current = true;
      setEllipse(next);
    }),
    knee: useEvent((p: PxPoint) => void markKnee(p)),
    deleteMark: useEvent(() => deleteMarkHere()),
    clearMarks: useEvent(() => void clearMarks()),
    saveMeasurement: useEvent(() => void saveMeasurement()),
    clearMeasurement: useEvent(() => setMeasurePoints([])),
    addNote: useEvent((body: string) => void addNote(body)),
    snapshot: useEvent(() => void takeSnapshot()),
    deleteAnnotation: useEvent((annotationId: string) => void removeAnnotation(annotationId)),
    track: useEvent(() => void runTrack()),
    trackSet: useEvent(() => void trackSetNow()),
    trackMarker: useEvent(() => void runMarkerTrack()),
    mass: useEvent((kg: number | null) => {
      dirtyRef.current = true;
      setMassKg(kg !== null && Number.isFinite(kg) ? kg : null);
      setMassSource(kg === null ? null : 'manual');
    }),
    camera: useEvent((next: CameraStability) => {
      dirtyRef.current = true;
      setCamera(next);
    }),
    stabilise: useEvent(() => void stabiliseNow()),
    recentre: useEvent(() => void recentreNow()),
    plateDiameter: useEvent((cm: number) => {
      dirtyRef.current = true;
      setPlateDiameterCm(cm);
    }),
    calibrate: useEvent(() => setTool('calibrate')),
    clearCalibration: useEvent(() => void clearCalibrationNow()),
    findPlate: useEvent(() => void findPlateHere()),
    snap: useEvent(() => void snapHere()),
    measureLens: useEvent(() => void measureLens()),
    share: useEvent((message: string) => void shareNow(message)),
    removeShare: useEvent((shareId: string) => void removeShare(shareId)),
    export: useEvent(() => void exportNow()),
    shareWithCoach: useEvent((coachId: string, message: string) => void shareWithCoach(coachId, message)),
    toggleTalkover: useEvent(() => void toggleTalkover()),
    toggleReference: useEvent(() => void toggleReference()),
    toggleModel: useEvent(() => void toggleModel()),
    compare: useEvent((analysisId: string | null) => {
      setTrending(false);
      if (analysisId) setComparisonId(analysisId);
      setComparing(true);
    }),
    trends: useEvent(() => {
      setComparing(false);
      setTrending(true);
    }),
    openShare: useEvent(() => {
      panels.show('notes');
      window.setTimeout(() => notesPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
    }),
  };

  const markedTimes = useMemo(() => points.map(p => p.t), [points]);
  const kneeMarked = kneePoint !== null;

  const trackingBase = useMemo<TrackingState>(
    () => ({
      canTrack: points.length > 0 && status === 'ready',
      busy: trackProgress,
      tier: trackerTier === 'manual' ? 'manual' : 'assisted',
      uncertainCount: uncertainIndices.length,
      correctionCount,
      onTrack: on.track,
      onNextUncertain: jumpToNextUncertain,
      onTrackSet: points.length > 0 && status === 'ready' && ellipse ? on.trackSet : undefined,
      onTrackRest: trackRest?.run,
      trackRestHint: trackRest?.hint,
      setNote,
      onTrackMarker: points.length > 0 && status === 'ready' ? on.trackMarker : undefined,
      uncertainIndices,
      onJumpTo: seek,
    }),
    [points.length, status, trackProgress, trackerTier, uncertainIndices, correctionCount, ellipse, setNote, seek, jumpToNextUncertain, on.track, on.trackSet, on.trackMarker, trackRest],
  );
  const phaseEdges = useMemo(
    () => (server ? spans.map(s => ({ index: server.nearestIndex(s.fromT), label: s.definition.label })) : []),
    [server, spans],
  );
  /** The tracking panel's state carries the playhead for the strip, so it
   *  — and only it — follows the frame. */
  const trackingWithConfidence = useMemo<TrackingState>(
    () => ({
      ...trackingBase,
      confidence: server ? { frames: frameScores, frameCount: server.frameCount, currentIndex: index, edges: phaseEdges } : undefined,
    }),
    [trackingBase, server, frameScores, index, phaseEdges],
  );

  const shareState = useMemo<ShareState | null>(
    () =>
      clip
        ? {
            athleteName: clip.athleteId ? clip.athleteName ?? 'the athlete' : null,
            shares,
            busy: shareBusy,
            note: shareNote,
            ready: points.length > 1 && calibration !== null && repSummary !== null,
            onShare: on.share,
            onDelete: on.removeShare,
            onExport: on.export,
            exporting,
            exportNote,
            talkoverIncluded: latestTalkover !== null,
            colleagues,
            onShareWithCoach: on.shareWithCoach,
          }
        : null,
    [clip, shares, shareBusy, shareNote, points.length, calibration, repSummary, exporting, exportNote, latestTalkover, colleagues, on.share, on.removeShare, on.export, on.shareWithCoach],
  );
  const talkoverState = useMemo<TalkoverState | null>(
    () =>
      talkoverMimeType() === null
        ? null
        : { recording: talkover !== null, startedAt: talkover?.startedAt ?? null, busy: talkoverBusy, note: talkoverNote, onToggle: on.toggleTalkover },
    [talkover, talkoverBusy, talkoverNote, on.toggleTalkover],
  );
  const liftMarks = useMemo(
    () => ({
      comparable,
      busy: referenceBusy,
      isReference,
      onToggleReference: on.toggleReference,
      isModel,
      modelLabel,
      onToggleModel: on.toggleModel,
      athleteName: clip?.athleteName ?? null,
      exerciseName: clip?.exerciseName ?? null,
    }),
    [comparable, referenceBusy, isReference, isModel, modelLabel, clip?.athleteName, clip?.exerciseName, on.toggleReference, on.toggleModel],
  );
  const earlierForMetrics = useMemo(
    () =>
      earlierLift
        ? {
            lift: { metrics: earlierLift.metrics, summary: earlierLift.metrics.summary },
            label: earlierLift.date ? formatDateShort(earlierLift.date) : 'earlier',
          }
        : null,
    [earlierLift],
  );
  const lensState = useMemo<LensState>(
    () => ({
      source: lensSource,
      k1: lensK1,
      device: [clip?.deviceMake, clip?.deviceModel].filter(Boolean).join(' ') || null,
      busy: lensBusy,
      note: lensNote,
      onMeasure: on.measureLens,
      onClear: clearLens,
    }),
    [lensSource, lensK1, clip?.deviceMake, clip?.deviceModel, lensBusy, lensNote, clearLens, on.measureLens],
  );
  const stabiliseState = useMemo(
    () => (points.length >= 8 ? { onRun: on.stabilise, progress: stabiliseProgress, note: stabiliseNote } : undefined),
    [points.length, stabiliseProgress, stabiliseNote, on.stabilise],
  );
  const recentreState = useMemo(
    () => (points.length >= 8 && ellipse ? { onRun: on.recentre, progress: recentreProgress, note: recentreNote } : undefined),
    [points.length, ellipse, recentreProgress, recentreNote, on.recentre],
  );

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

  const title = clip.exerciseName ?? 'Clip';
  const loadLabel =
    clip.loadKg !== null ? `${num(clip.loadKg, clip.loadKg % 1 === 0 ? 0 : 1)} kg${clip.loadIsTopSet ? ' (top set)' : ''}` : null;

  /**
   * The video column's width follows the clip: a portrait phone clip needs
   * about 28 % of a 1440 px viewport and frees the rest for reading, which is
   * the bet the layout makes; a landscape clip would be a stamp at that width,
   * so it gets the wider column and the rail gives up the difference.
   */

  const gradeTone = grade.grade === 'A' ? 'success' : grade.grade === 'B' ? 'warning' : grade.grade === 'C' ? 'danger' : 'neutral';

  const trackingHeadline = trackProgress ? (
    <HeadlineChip mono>{`frame ${trackProgress.done} / ${trackProgress.total}`}</HeadlineChip>
  ) : uncertainIndices.length > 0 ? (
    <HeadlineChip tone="danger">{`${uncertainIndices.length} frames flagged`}</HeadlineChip>
  ) : trackerTier !== 'manual' && points.length > 0 ? (
    <HeadlineChip tone="success">{`tracked · ${points.length} frames`}</HeadlineChip>
  ) : points.length > 0 ? (
    <HeadlineChip>{`${points.length} marks by hand`}</HeadlineChip>
  ) : (
    <HeadlineChip>not tracked</HeadlineChip>
  );

  const calibrationHeadline = calibration ? (
    <HeadlineChip mono title="plate · viewing angle">
      {`${num(calibration.plateDiameterCm, 1)} cm · θ ${num(calibration.viewingAngleDeg, 1)}°`}
    </HeadlineChip>
  ) : (
    <HeadlineChip tone="warning">not calibrated</HeadlineChip>
  );

  const earlierCount = history.filter(r => !r.current).length;
  const historyHeadline = (
    <HeadlineChip>{earlierCount > 0 ? `${title} · last ${earlierCount}` : 'no history yet'}</HeadlineChip>
  );

  const notesHeadline = (
    <HeadlineChip>
      {[
        `${annotations.length} ${annotations.length === 1 ? 'note' : 'notes'}`,
        shares.length > 0 ? `shared ${shares.length}×` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </HeadlineChip>
  );

  const stageReady = analysable && status === 'ready' && server;
  const showingOverlay = trending || (comparing && comparable);

  /** What the panels say when there is nothing to show. The stage carries the
   *  full embed note; the panels say the short thing once each — the long
   *  sentence lives in the bar-path column, the terse one in the rail. */
  const embedEmpty = embedded && !kinematics ? 'No stored rep — analysed on the athlete’s phone.' : null;
  const railEmptyReason = embedEmpty ?? metricsEmptyReason;

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
          minHeight: 49,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-md)',
          padding: '0 var(--space-lg)',
          background: 'var(--color-bg-primary)',
          borderBottom: '0.5px solid var(--color-border-primary)',
        }}
      >
        <Link
          to="/kinemos"
          title="Back to the library"
          style={{ display: 'inline-flex', color: 'var(--color-text-secondary)' }}
        >
          <ChevronLeft size={18} />
        </Link>
        <span
          style={{
            fontSize: 'var(--text-page-title)',
            fontWeight: 600,
            letterSpacing: 'var(--tracking-page-title)',
            lineHeight: 'var(--leading-page-title)',
            whiteSpace: 'nowrap',
          }}
        >
          KinEMOS
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
            minWidth: 0,
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {clip.athleteName && (
            <>
              <span>{clip.athleteName}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{title}</span>
          {clip.date && (
            <>
              <span aria-hidden>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{formatDateShort(clip.date)}</span>
            </>
          )}
          {loadLabel && (
            <>
              <span aria-hidden>·</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{loadLabel}</span>
            </>
          )}
        </span>
        <GradeChip grade={grade} />
        <span style={{ flexGrow: 1 }} />
        <span
          aria-live="polite"
          style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}
        >
          {`${panels.openCount} of ${PANEL_KEYS.length} panels open`}
        </span>
        <span
          style={{
            fontSize: 'var(--text-micro)',
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
          }}
        >
          Depth
        </span>
        <SegmentedControl<ViewerDepth>
          ariaLabel="Depth"
          value={panels.depth}
          onChange={panels.setDepth}
          options={(Object.keys(DEPTH_LABELS) as ViewerDepth[]).map(depth => ({
            id: depth,
            label: DEPTH_LABELS[depth],
            title: depth === 'look' ? 'Lift only' : depth === 'read' ? 'Lift, velocity, metrics, history' : 'Everything',
          }))}
        />
        <Button size="sm" variant="primary" icon={<Share2 size={12} />} onClick={on.openShare} title="Send, or export with the bar path">
          Share
        </Button>
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
            phaseSetId: model.phaseSetId,
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
          stageNote={embedNote}
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

      {/* Three columns: the clip, the bar path, the panel rail. The first two
          are fixed and full height; the rail takes the rest and is the only
          thing that scrolls. On a narrow window the rail drops under them. */}
      <div
        ref={rowRef}
        style={{
          flexGrow: 1,
          display: showingOverlay ? 'none' : 'flex',
          flexWrap: wide ? 'nowrap' : 'wrap',
          alignItems: 'stretch',
          alignContent: 'flex-start',
          gap: 'var(--space-md)',
          padding: 'var(--space-md)',
          minHeight: 0,
          overflowY: wide ? 'hidden' : 'auto',
        }}
      >
        {/* Tool rail */}
        <nav
          aria-label="Tools"
          style={{
            width: 40,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: 'var(--space-sm) 0',
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-lg)',
            alignSelf: 'flex-start',
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
                width: 30,
                height: 30,
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

        {/* Column 1 — the clip */}
        <section
          aria-label="Video"
          style={{
            width: videoWidth,
            flexShrink: 0,
            minHeight: wide ? 0 : 560,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-sm)',
              padding: 'var(--space-sm)',
            }}
          >
            {embedded && (
              <>
                <p
                  style={{
                    margin: 0,
                    padding: 'var(--space-sm) var(--space-md)',
                    fontSize: 'var(--text-caption)',
                    color: 'var(--color-text-secondary)',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {embedNote}
                </p>
                {/* The same player the library's modal uses: pixels to look at
                    while reading the numbers, not frames to measure. */}
                <div style={{ background: '#000', borderRadius: 'var(--radius-md)', overflow: 'hidden', flexGrow: 1, minHeight: 0 }}>
                  <iframe
                    src={clip.playbackUrl}
                    title={title}
                    allow="accelerometer; encrypted-media; picture-in-picture;"
                    allowFullScreen
                    style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              </>
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
                  padding: 'var(--space-sm) var(--space-md)',
                  background: 'var(--color-warning-bg)',
                  color: 'var(--color-warning-text)',
                  fontSize: 'var(--text-caption)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {`${decodeError} Nothing is shown rather than the frame before it — step past it, or re-import the clip if it persists.`}
              </div>
            )}

            {stageReady && (
              <ViewerStage
                canvas={frame?.canvas ?? null}
                width={server.displayWidth}
                height={server.displayHeight}
                tool={tool}
                points={points}
                currentT={currentT}
                display={display.prefs.stage}
                onDisplay={display.setStage}
                onDisplayReset={() => display.reset('stage')}
                displayModified={stageModified}
                pointColours={pointColours}
                colourReason={colourReason}
                cmGrid={cmGrid}
                ellipse={ellipse}
                onEllipseChange={on.ellipseChange}
                measurePoints={measurePoints}
                onMeasurePoint={addMeasurePoint}
                measureLabel={measureValue}
                onMark={handleMark}
                knee={kneePoint}
                onKnee={on.knee}
              />
            )}
          </div>

          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-sm)',
              padding: '0 var(--space-md) var(--space-md)',
            }}
          >
            {stageReady && (
              <ViewerTransport
                index={index}
                frameCount={server.frameCount}
                timestamps={server.timestamps}
                playing={playing}
                speed={speed}
                markedTimes={markedTimes}
                uncertainIndices={uncertainIndices}
                liftSpans={liftSpans}
                fps={server.averageFps}
                vfr={server.isVfr}
                onSeek={seek}
                onStep={step}
                onTogglePlay={togglePlay}
                onSpeed={setSpeed}
              />
            )}
            {(stageReady || (embedded && kinematics)) && (
              <PhaseTimeline
                series={kinematics}
                spans={spans}
                boundaries={boundaries}
                onBoundaryDrag={dragBoundary}
                onBoundaryCommit={commitBoundary}
                currentT={currentT}
                onSeekT={seekT}
                emptyReason={railEmptyReason}
              />
            )}
            {stageReady && (
              <p style={{ margin: 0, fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                ← → frame · ⇧ ×10 · space play · V C M D A K tools · ⇧-drag pan
              </p>
            )}
          </div>

          {/* The active tool's readout — a distance, an angle, the knee —
              sits with the stage it is read off. */}
          {stageReady && (tool === 'distance' || tool === 'angle' || tool === 'knee') && (
            <div style={{ flexShrink: 0, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <ReadoutRail
                parts={['measure']}
                repIndices={repIndices}
                repIndex={repIndex}
                onRep={setRepIndex}
                onAddRep={addRep}
                metrics={metrics}
                markedHere={false}
                onDeleteMark={on.deleteMark}
                onClearMarks={on.clearMarks}
                tool={tool}
                measureValue={measureValue}
                kneeCm={kneeCm}
                kneeMarked={kneeMarked}
                measureComplete={measureComplete}
                onSaveMeasurement={on.saveMeasurement}
                onClearMeasurement={on.clearMeasurement}
                annotations={annotations}
                onAddNote={on.addNote}
                onSnapshot={on.snapshot}
                onDeleteAnnotation={on.deleteAnnotation}
                snapshotBusy={snapshotBusy}
                tracking={trackingBase}
              />
            </div>
          )}
        </section>

        {wide && (
          <ColumnSplitter
            label="Clip column width"
            width={videoWidth}
            onResize={columns.setVideo}
            onReset={columns.resetVideo}
          />
        )}

        {/* Column 2 — the bar path and velocity-over-height, one height axis */}
        <div style={{ width: pathWidth, flexShrink: 0, minHeight: wide ? 0 : 560, display: 'flex', flexDirection: 'column' }}>
          <BarPathPanel
            series={kinematics}
            spans={spans}
            analyzer={liftMetrics?.analyzer ?? null}
            summary={repSummary}
            currentT={currentT}
            onSeekT={seekT}
            emptyReason={railEmptyReason}
            kneeCm={kneeCm}
            display={display.prefs.plot}
            onDisplay={display.setPlot}
            onLabels={display.setLabels}
            onDisplayReset={() => display.reset('plot')}
            displayModified={plotModified}
          />
        </div>

        {wide && (
          <ColumnSplitter
            label="Bar-path column width"
            width={pathWidth}
            onResize={columns.setPath}
            onReset={columns.resetPath}
          />
        )}

        {/* Column 3 — the panel rail; the only thing that scrolls */}
        <div
          style={{
            flexGrow: 1,
            flexBasis: wide ? 0 : '100%',
            minWidth: wide ? RAIL_MIN : 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-md)',
            overflowY: wide ? 'auto' : 'visible',
          }}
        >
          <RailPanel
            title={`This lift · rep ${repIndex}`}
            headline={<HeadlineChip tone={gradeTone}>{grade.grade ?? 'ungraded'}</HeadlineChip>}
            open={panels.open.lift}
            onToggle={() => panels.toggle('lift')}
          >
            <LiftPanel
              repIndices={repIndices}
              repIndex={repIndex}
              repPeaks={repPeaks}
              repModels={repModels}
              model={liftPanelModel}
              onRep={setRepIndex}
              onAddRep={addRep}
              trackRest={trackRest}
              trackBusy={trackProgress}
              setNote={restNote}
              metrics={liftMetrics}
              summary={repSummary}
              emptyReason={railEmptyReason}
              verdict={verdict}
              marks={liftMarks}
            />
          </RailPanel>

          <RailPanel
            title="Velocity over time"
            headline={
              <HeadlineChip mono>
                {peakForVerdict !== null ? `peak ${num(peakForVerdict, 2)} m/s` : '—'}
              </HeadlineChip>
            }
            open={panels.open.velocity}
            onToggle={() => panels.toggle('velocity')}
          >
            <VelocityChart
              series={kinematics}
              spans={spans}
              boundaries={boundaries}
              currentT={currentT}
              onSeekT={seekT}
              emptyReason={railEmptyReason}
              kneeCm={kneeCm}
            />
          </RailPanel>

          <RailPanel
            title="All metrics"
            headline={
              <HeadlineChip>
                {liftMetrics
                  ? `${metricCount} of ${modelCatalogue.length}${earlierLift?.date ? ` · vs ${formatDateShort(earlierLift.date)}` : ''}`
                  : 'no numbers yet'}
              </HeadlineChip>
            }
            open={panels.open.metrics}
            onToggle={() => panels.toggle('metrics')}
          >
            <MetricsPanel
              metrics={liftMetrics}
              summary={repSummary}
              model={model}
              massKg={massKg}
              massSource={massSource}
              onMass={on.mass}
              emptyReason={metricsEmptyReason}
              knee={kneeReadout}
              earlier={earlierForMetrics}
              marginMs={grade.expectedVelocityErrorMs}
            />
          </RailPanel>

          <RailPanel
            title="Tracking & correction"
            headline={trackingHeadline}
            open={panels.open.tracking}
            onToggle={() => panels.toggle('tracking')}
          >
            <ReadoutRail
              parts={['path']}
              repIndices={repIndices}
              repIndex={repIndex}
              onRep={setRepIndex}
              onAddRep={addRep}
              metrics={metrics}
              markedHere={currentT !== null && points.some(p => Math.abs(p.t - currentT) < 1e-6)}
              onDeleteMark={on.deleteMark}
              onClearMarks={on.clearMarks}
              tool={tool}
              measureValue={measureValue}
              kneeCm={kneeCm}
              kneeMarked={kneeMarked}
              measureComplete={measureComplete}
              onSaveMeasurement={on.saveMeasurement}
              onClearMeasurement={on.clearMeasurement}
              annotations={annotations}
              onAddNote={on.addNote}
              onSnapshot={on.snapshot}
              onDeleteAnnotation={on.deleteAnnotation}
              snapshotBusy={snapshotBusy}
              tracking={trackingWithConfidence}
            />
            <GradePanel grade={grade} camera={camera} onCamera={on.camera} stabilise={stabiliseState} recentre={recentreState} />
          </RailPanel>

          <RailPanel
            title="Calibration"
            headline={calibrationHeadline}
            open={panels.open.calibration}
            onToggle={() => panels.toggle('calibration')}
          >
            <CalibrationPanel
              hideTitle
              ellipse={ellipse}
              calibration={calibration}
              plateDiameterCm={plateDiameterCm}
              active={tool === 'calibrate'}
              onPlateDiameter={on.plateDiameter}
              onActivate={on.calibrate}
              onClear={on.clearCalibration}
              onFind={on.findPlate}
              onSnap={on.snap}
              assist={assist}
              shape={plateShape}
              onShape={setPlateShape}
              lens={lensState}
            />
          </RailPanel>

          <RailPanel
            title="History & comparison"
            headline={historyHeadline}
            open={panels.open.history}
            onToggle={() => panels.toggle('history')}
          >
            <HistoryPanel
              rows={history}
              exerciseName={clip.exerciseName}
              comparable={comparable}
              onCompare={on.compare}
              canTrend={clip.athleteId !== null}
              onTrends={on.trends}
            />
          </RailPanel>

          <RailPanel
            ref={notesPanelRef}
            title="Notes & sharing"
            headline={notesHeadline}
            open={panels.open.notes}
            onToggle={() => panels.toggle('notes')}
          >
            <ReadoutRail
              parts={['share', 'notes']}
              repIndices={repIndices}
              repIndex={repIndex}
              onRep={setRepIndex}
              onAddRep={addRep}
              metrics={metrics}
              markedHere={false}
              onDeleteMark={on.deleteMark}
              onClearMarks={on.clearMarks}
              tool={tool}
              measureValue={measureValue}
              kneeCm={kneeCm}
              kneeMarked={kneeMarked}
              share={shareState}
              talkover={talkoverState}
              measureComplete={measureComplete}
              onSaveMeasurement={on.saveMeasurement}
              onClearMeasurement={on.clearMeasurement}
              annotations={annotations}
              onAddNote={on.addNote}
              onSnapshot={on.snapshot}
              onDeleteAnnotation={on.deleteAnnotation}
              snapshotBusy={snapshotBusy}
              tracking={trackingBase}
            />
          </RailPanel>
        </div>
      </div>
    </div>
  );
}
