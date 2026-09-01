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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Circle, Crosshair, Hand, Ruler, Triangle } from 'lucide-react';
import { ErrorState, Spinner, confirmDialog } from '../components/ui';
import { formatDateShort } from '../lib/dateUtils';
import { getOwnerId } from '../lib/ownerContext';
import type { KinemosAnnotation, KinemosTrackPoint } from '../lib/database.types';
import {
  DEFAULT_PLATE_DIAMETER_CM,
  angleDeg,
  calibrateFromEllipse,
  distanceCm,
  pathMetrics,
  type PlateEllipse,
  type PxPoint,
} from './engine/calibration';
import { useFrameServer } from './hooks/useFrameServer';
import { CalibrationPanel } from './components/CalibrationPanel';
import { ReadoutRail } from './components/ReadoutRail';
import { ViewerStage, type ViewerTool } from './components/ViewerStage';
import { ViewerTransport } from './components/ViewerTransport';
import {
  addAnnotation,
  clearCalibration,
  deleteAnnotation as deleteAnnotationRow,
  ensureAnalysis,
  listReps,
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

const TOOLS: Array<{ id: ViewerTool; label: string; icon: typeof Hand; key: string }> = [
  { id: 'look', label: 'Look — drag to pan, wheel to zoom', icon: Hand, key: 'V' },
  { id: 'calibrate', label: 'Calibrate against a plate', icon: Circle, key: 'C' },
  { id: 'mark', label: 'Mark the bar end', icon: Crosshair, key: 'M' },
  { id: 'distance', label: 'Measure a distance', icon: Ruler, key: 'D' },
  { id: 'angle', label: 'Measure an angle', icon: Triangle, key: 'A' },
];

export function KinemosViewer() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const navigate = useNavigate();

  const [clip, setClip] = useState<LibraryVideo | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [loadingClip, setLoadingClip] = useState(true);

  const [tool, setTool] = useState<ViewerTool>('look');
  const [repIndex, setRepIndex] = useState(1);
  const [repIndices, setRepIndices] = useState<number[]>([1]);

  const [points, setPoints] = useState<KinemosTrackPoint[]>([]);
  const [ellipse, setEllipse] = useState<PlateEllipse | null>(null);
  const [plateDiameterCm, setPlateDiameterCm] = useState(DEFAULT_PLATE_DIAMETER_CM);
  const [annotations, setAnnotations] = useState<KinemosAnnotation[]>([]);
  const [measurePoints, setMeasurePoints] = useState<PxPoint[]>([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const {
    status,
    error: frameError,
    server,
    frame,
    index,
    playing,
    speed,
    seek,
    step,
    togglePlay,
    setSpeed,
  } = useFrameServer(playbackUrl);

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
    setMeasurePoints([]);

    loadBundle(source, id, repIndex)
      .then(bundle => {
        if (cancelled || !bundle) return;
        analysisIdRef.current = bundle.analysis.id;
        setPoints(bundle.track?.points ?? []);
        setAnnotations(bundle.annotations);
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
  }, [source, id, repIndex]);

  const calibration = useMemo(
    () => (ellipse ? calibrateFromEllipse(ellipse, plateDiameterCm) : null),
    [ellipse, plateDiameterCm],
  );

  const metrics = useMemo(() => pathMetrics(points, calibration), [points, calibration]);

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
        try {
          const analysisId = await ensureId();
          if (!analysisId) return;
          await saveTrack(analysisId, points, { tier: 'manual', ownerId: getOwnerId() });
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
          setSaveError('Changes could not be saved — they are still on screen, but not stored.');
        }
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `index`/`currentT` deliberately excluded: they change on every step and
    // would restart the debounce forever. The frame a calibration was set on is
    // read at write time, which is close enough for provenance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, ellipse, calibration, plateDiameterCm, ensureId]);

  // ── Marking ───────────────────────────────────────────────────────────────
  const handleMark = useCallback(
    (point: PxPoint) => {
      if (currentT === null) return;
      dirtyRef.current = true;
      setPoints(current => {
        const without = current.filter(p => Math.abs(p.t - currentT) > 1e-6);
        const next: KinemosTrackPoint = { t: currentT, x: point.x, y: point.y, s: 'm' };
        return [...without, next].sort((a, b) => a.t - b.t);
      });
      // Auto-advance: marking a lift should be click, click, click, not click,
      // reach for an arrow key, click.
      step(1);
    },
    [currentT, step],
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
  }, []);

  // ── Measurement ───────────────────────────────────────────────────────────
  const measureArity = tool === 'angle' ? 3 : 2;
  const measureComplete = measurePoints.length === measureArity;

  const measureValue = useMemo(() => {
    if (tool === 'distance' && measurePoints.length === 2) {
      return calibration
        ? formatDistance(distanceCm(calibration, measurePoints[0], measurePoints[1]), true)
        : formatDistance(Math.hypot(
            measurePoints[1].x - measurePoints[0].x,
            measurePoints[1].y - measurePoints[0].y,
          ), false);
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

  const removeAnnotation = useCallback(async (annotationId: string) => {
    try {
      await deleteAnnotationRow(annotationId);
      setAnnotations(current => current.filter(a => a.id !== annotationId));
    } catch {
      setSaveError('That annotation could not be deleted.');
    }
  }, []);

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
  }, [step, togglePlay, seek, server]);

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
  const subtitle = [
    clip.athleteName,
    clip.loadKg !== null ? `${num(clip.loadKg, 0)} kg${clip.loadIsTopSet ? ' (top set)' : ''}` : null,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minWidth: 0 }}>
          <Link
            to="/kinemos"
            title="Back to the library"
            style={{ display: 'inline-flex', color: 'var(--color-text-secondary)' }}
          >
            <ChevronLeft size={18} />
          </Link>
          <span style={{ fontSize: 'var(--text-section)', fontWeight: 600 }}>{title}</span>
          <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
            {subtitle}
          </span>
        </div>
        <span
          title="Quality grading needs the tracking pipeline — it arrives with P2. Until then the rail spells out the conditions instead."
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--text-micro)',
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          NOT GRADED
        </span>
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

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
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

          {analysable && status === 'error' && <ErrorState message={frameError ?? 'Unknown error.'} />}

          {analysable && (status === 'opening' || status === 'idle') && (
            <div style={{ display: 'grid', placeItems: 'center', flexGrow: 1 }}>
              <Spinner />
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
              />
              <ViewerTransport
                index={index}
                frameCount={server.frameCount}
                timestamps={server.timestamps}
                playing={playing}
                speed={speed}
                markedTimes={points.map(p => p.t)}
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
                ← → step a frame · ⇧ steps ten · space plays · V/C/M/D/A pick a tool · shift-drag
                pans
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
              measureComplete={measureComplete}
              onSaveMeasurement={() => void saveMeasurement()}
              onClearMeasurement={() => setMeasurePoints([])}
              annotations={annotations}
              onAddNote={body => void addNote(body)}
              onSnapshot={() => void takeSnapshot()}
              onDeleteAnnotation={annotationId => void removeAnnotation(annotationId)}
              snapshotBusy={snapshotBusy}
              calibration={calibration}
              fps={server?.averageFps ?? 0}
              vfr={server?.isVfr ?? false}
            codec={server?.codec ?? null}
          />
        </aside>
      </div>
    </div>
  );
}
