/**
 * A design bench for the KinEMOS analysis surfaces.
 *
 * The viewer itself cannot be opened without a coaching environment and a real
 * clip, which makes the panels that carry the P2 numbers — the phase band, the
 * curves, the metric rail, the grade — the hardest part of the app to actually
 * LOOK at. This page renders them against a synthetic lift so the layout can be
 * judged, and so a change to any of them can be seen before it ships.
 *
 * The lift is the same control-point profile the phase tests use, so what is on
 * screen here is what those assertions are asserting about.
 *
 * It also exposes `window.__BENCH__`, so the pointer gestures — dragging a
 * phase edge, marking the bar end on the stage — can be driven from outside and
 * checked. That maths (client coordinates through a transformed canvas's own
 * rect, times through a band's width) is the part of the viewer with no unit
 * test and the most ways to be subtly wrong.
 *
 * Run `npm run dev` and open `/verify/viewer-preview.html`.
 */
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  calibrateFromEllipse,
  type PlateEllipse,
  type PxPoint,
  type TrackPoint,
} from '../src/kinemos/engine/calibration';
import { computeKinematics, summariseRep } from '../src/kinemos/engine/kinematics';
import {
  DEFAULT_PHASE_SET,
  computeLiftMetrics,
  enforceMonotonic,
  proposePhases,
  spansFrom,
  type PhaseBoundary,
} from '../src/kinemos/engine/phases';
import { gradeAnalysis, type CameraStability } from '../src/kinemos/engine/grade';
import { DEFAULT_FILTER } from '../src/kinemos/engine/signal';
import { useFrameServer } from '../src/kinemos/hooks/useFrameServer';
import { AnalysisPanel } from '../src/kinemos/components/AnalysisPanel';
import { ViewerStage, type ViewerTool } from '../src/kinemos/components/ViewerStage';
import { ComparisonView } from '../src/kinemos/components/ComparisonView';
import type { AlignmentAnchor } from '../src/kinemos/engine/compare';
import type { ComparisonCandidate, ComparisonSubject } from '../src/kinemos/lib/comparisonService';
import type { KinemosAnalysis } from '../src/lib/database.types';
import type { LibraryVideo } from '../src/kinemos/lib/videoLibrary';
import { GradeChip, GradePanel } from '../src/kinemos/components/GradePanel';
import { MetricsPanel } from '../src/kinemos/components/MetricsPanel';
import type { KinemosTrackPoint } from '../src/lib/database.types';
import '../src/index.css';

/** Velocity control points of a textbook snatch, m/s. */
const CONTROL: Array<[number, number]> = [
  [0.0, 0],
  [0.4, 0],
  [0.8, 1.0],
  [1.0, 0.75],
  [1.3, 1.85],
  [1.5, 0],
  [1.7, -0.6],
  [1.9, 0],
  [2.3, 0],
];

const smoothstep = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** 0,2 cm/px — the design doc's worked example, and the scale the synthetic
 *  track must be drawn at for the lift to be physically the size it claims. */
const CM_PER_PX = 0.2;

/** Stage dimensions. Deliberately larger than the box it is drawn into, so the
 *  gesture maths has to deal with a scaled canvas — which is the case that
 *  breaks if a handler reads clientX without going through the rect. */
const STAGE_W = 1280;
const STAGE_H = 800;

/** The reference lift is filmed at a different frame rate from the current one.
 *  That is the case side-by-side playback exists to survive: the follower has
 *  to land on its NEAREST frame to a moment, because there usually is no frame
 *  exactly there. */
const REFERENCE_FPS = 30;

/** Where the bar sits at rest, in frame pixels. */
const FLOOR_PX = 720;

interface TrackShape {
  delay?: number;
  firstPull?: number;
  secondPull?: number;
  xOffset?: number;
}

function syntheticTrack(fps: number, tremorPx: number, shape: TrackShape = {}): TrackPoint[] {
  const { delay = 0, firstPull, secondPull, xOffset = 0 } = shape;
  const control = CONTROL.map(([t, v], i) => {
    let value = v;
    if (firstPull !== undefined && i === 2) value = firstPull;
    if (secondPull !== undefined && i === 4) value = secondPull;
    return [t + (i === 0 ? 0 : delay), value] as [number, number];
  });
  const velocity = (t: number) => {
    for (let i = 1; i < control.length; i++) {
      const [t0, v0] = control[i - 1];
      const [t1, v1] = control[i];
      if (t <= t1) return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
    return 0;
  };
  const duration = CONTROL[CONTROL.length - 1][0];
  const points: TrackPoint[] = [];
  const fine = 2400;
  let y = 0;
  let next = 0;
  let seed = 11;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  for (let i = 0; i <= duration * fine; i++) {
    const t = i / fine;
    if (t >= next) {
      // y is metres; the frame is CM_PER_PX centimetres per pixel.
      const pxPerM = 100 / CM_PER_PX;
      points.push({
        t,
        x: 500 + xOffset + (4 / CM_PER_PX) * Math.sin(2 * Math.PI * t * 0.7) + rand() * tremorPx,
        // The bar starts near the floor of the frame and rises ~95 cm, which at
        // this scale is 475 px — so the whole lift is inside an 800 px frame.
        // It has to be: the bench now ENCODES these positions into a clip, and
        // a plate drawn off-frame is a fixture bug that looks like a viewer one.
        y: FLOOR_PX - y * pxPerM + rand() * tremorPx,
      });
      next += 1 / fps;
    }
    y += velocity(t) / fine;
  }
  return points;
}

const calibration = calibrateFromEllipse(
  {
    cx: 500,
    cy: 900,
    semiMajorPx: 45 / 2 / CM_PER_PX,
    semiMinorPx: 45 / 2 / CM_PER_PX,
    tiltDeg: 0,
  },
  45,
);

/** One frame of the stand-in scene: a platform, and a plate at the bar end. */
function paintScene(ctx: CanvasRenderingContext2D, width: number, height: number, plate: PxPoint) {
  ctx.fillStyle = '#232320';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#3a3a35';
  ctx.fillRect(0, height - 90, width, 90);
  ctx.save();
  ctx.translate(plate.x, plate.y);
  ctx.fillStyle = '#7a7a74';
  ctx.fillRect(-330, -7, 660, 14);
  ctx.beginPath();
  ctx.arc(0, 0, 112, 0, Math.PI * 2);
  ctx.fillStyle = '#6f6f68';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#dcdcd6';
  ctx.stroke();
  ctx.restore();
}

/** The stage needs pixels. A painted frame stands in for decoded video. */
function useStageCanvas(width: number, height: number, plate: PxPoint) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  if (!ref.current) {
    ref.current = document.createElement('canvas');
    ref.current.width = width;
    ref.current.height = height;
  }
  // Depending on the coordinates rather than the object: a fresh literal every
  // render would repaint every render.
  const { x, y } = plate;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paintScene(ctx, width, height, { x, y });
  }, [width, height, x, y]);
  return ref.current;
}

/**
 * A real, decodable clip of a synthetic lift.
 *
 * Side-by-side playback is the one surface here that a painted canvas cannot
 * stand in for: it is about two decoders, two frame rates and the drift between
 * them, and a still image has none of those. So the bench encodes its own
 * clips — one frame per track point, timestamped with that point's own `t`, so
 * the video and the track are in sync by construction and any misalignment on
 * screen is the viewer's rather than the fixture's.
 */
async function encodeClip(points: TrackPoint[], fps: number): Promise<Blob | null> {
  const chosen = await pickCodec();
  if (!chosen) return null;

  const { Output, BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat } =
    await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const output = new Output({
    format:
      chosen.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: chosen.codec, bitrate: 6_000_000 });
  output.addVideoTrack(source);
  await output.start();
  for (const p of points) {
    paintScene(ctx, STAGE_W, STAGE_H, p);
    await source.add(p.t, 1 / fps);
  }
  source.close();
  await output.finalize();
  return new Blob([output.target.buffer as ArrayBuffer], {
    type: chosen.container === 'mp4' ? 'video/mp4' : 'video/webm',
  });
}

async function pickCodec(): Promise<{ codec: 'avc' | 'vp9' | 'vp8'; container: string } | null> {
  for (const c of [
    { codec: 'avc' as const, container: 'mp4', config: 'avc1.42001f' },
    { codec: 'vp9' as const, container: 'webm', config: 'vp09.00.10.08' },
    { codec: 'vp8' as const, container: 'webm', config: 'vp8' },
  ]) {
    const supported = await VideoEncoder.isConfigSupported({
      codec: c.config,
      width: STAGE_W,
      height: STAGE_H,
      bitrate: 6_000_000,
    }).catch(() => null);
    if (supported?.supported) return c;
  }
  return null;
}

/**
 * Encode the clips the bench needs, once, ONE AT A TIME.
 *
 * Sequentially on purpose. Run concurrently, the second encoder quietly
 * produces a clip whose frames stop advancing partway through while its
 * timestamps carry on — 139 packets, the last sixty of them the same picture.
 * Nothing throws and the container looks correct, so it reads on screen as a
 * viewer that lost sync rather than a fixture that lost frames, which cost an
 * hour to tell apart. Two encoders on one GPU is a fixture problem, not a
 * product one: the app downloads its clips.
 */
function useEncodedClips(
  specs: Array<{ points: TrackPoint[]; fps: number }>,
  wanted: boolean,
): Array<Blob | null> {
  const [blobs, setBlobs] = useState<Array<Blob | null>>(() => specs.map(() => null));
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || started.current) return;
    started.current = true;
    (async () => {
      const out: Array<Blob | null> = [];
      for (const spec of specs) {
        out.push(await encodeClip(spec.points, spec.fps).catch(() => null));
        setBlobs([...out, ...specs.slice(out.length).map(() => null)]);
      }
    })();
  }, [wanted, specs]);
  return blobs;
}

/**
 * A blob as a URL the production code can take unchanged.
 *
 * Deliberately a URL rather than handing the Blob straight to the frame server:
 * the app only ever has URLs, and a bench that took a shortcut the app cannot
 * would stop testing the path the app runs.
 */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/**
 * A comparison subject built out of a second synthetic lift — slower off the
 * floor, faster through the second pull, filmed with the bar elsewhere in
 * frame, from a clip that starts a third of a second earlier. Every one of
 * those differences is something the alignment and the delta table have to
 * handle, and none of them is visible from a unit test.
 */
function useReferenceSubject(playbackUrl: string): {
  candidate: ComparisonCandidate;
  subject: ComparisonSubject;
} {
  return useMemo(() => {
    const points = syntheticTrack(REFERENCE_FPS, 1.2, {
      delay: -0.35,
      firstPull: 1.25,
      secondPull: 1.68,
      xOffset: 260,
    });
    const series = computeKinematics(points, calibration, { massKg: 96, filter: DEFAULT_FILTER })!;
    const boundaries = proposePhases(series).boundaries;
    const spans = spansFrom(boundaries, DEFAULT_PHASE_SET);

    const clip = {
      key: 'log:reference',
      source: 'log',
      sourceId: 'reference',
      athleteId: 'a1',
      athleteName: 'Jon Herskind',
      exerciseName: 'Snatch',
      date: '2026-07-14',
      sortedAt: '2026-07-14T17:10:00Z',
      loadKg: 96,
      loadIsTopSet: false,
      durationS: 2.4,
      fps: REFERENCE_FPS,
      width: 1920,
      height: 1080,
      playbackUrl,
      isEmbed: false,
      thumbnailUrl: null,
      note: null,
      sessionId: null,
      eventId: null,
    } as LibraryVideo;

    const analysis = {
      id: 'ref-1',
      source_kind: 'log',
      source_id: 'reference',
      rep_index: 1,
      grade: 'C',
      mass_kg: 96,
      phase_set_id: 'default',
    } as unknown as KinemosAnalysis;

    return {
      candidate: { analysis, clip, sameExercise: true },
      subject: {
        analysis,
        clip,
        points,
        series,
        boundaries,
        metrics: computeLiftMetrics(series, spans),
        summary: summariseRep(series),
      },
    };
  }, [playbackUrl]);
}

function Bench() {
  const [fps, setFps] = useState(60);
  const [tremor, setTremor] = useState(1.5);
  const [massKg, setMassKg] = useState<number | null>(102);
  const [camera, setCamera] = useState<CameraStability>('handheld');
  const [currentT, setCurrentT] = useState(1.28);
  const [coach, setCoach] = useState<PhaseBoundary[] | null>(null);
  const [tool, setTool] = useState<ViewerTool>('mark');
  const [marks, setMarks] = useState<KinemosTrackPoint[]>([]);
  const [ellipse, setEllipse] = useState<PlateEllipse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [alignment, setAlignment] = useState<AlignmentAnchor>('liftoff');

  const points = useMemo(() => syntheticTrack(fps, tremor), [fps, tremor]);

  // Encoding is deferred until the coach actually compares: it costs a couple
  // of seconds and every other panel on this page works without it.
  const referencePoints = useMemo(
    () =>
      syntheticTrack(REFERENCE_FPS, 1.2, {
        delay: -0.35,
        firstPull: 1.25,
        secondPull: 1.68,
        xOffset: 260,
      }),
    [],
  );
  const clipSpecs = useMemo(
    () => [
      { points, fps },
      { points: referencePoints, fps: REFERENCE_FPS },
    ],
    [points, fps, referencePoints],
  );
  const [leaderClip, referenceClip] = useEncodedClips(clipSpecs, comparing);
  const leaderUrl = useObjectUrl(leaderClip);
  const referenceUrl = useObjectUrl(referenceClip);
  const playback = useFrameServer(leaderUrl);
  const reference = useReferenceSubject(referenceUrl ?? '');
  const kinematics = useMemo(
    () => computeKinematics(points, calibration, { massKg, filter: DEFAULT_FILTER }),
    [points, massKg],
  );
  const proposal = useMemo(() => (kinematics ? proposePhases(kinematics) : null), [kinematics]);
  const boundaries = useMemo(() => {
    if (!kinematics) return [];
    if (!coach) return proposal?.boundaries ?? [];
    return enforceMonotonic(coach, kinematics.t[0], kinematics.t[kinematics.t.length - 1]);
  }, [kinematics, coach, proposal]);
  const spans = useMemo(() => spansFrom(boundaries, DEFAULT_PHASE_SET), [boundaries]);
  const metrics = useMemo(
    () => (kinematics && spans.length ? computeLiftMetrics(kinematics, spans) : null),
    [kinematics, spans],
  );
  const summary = useMemo(() => (kinematics ? summariseRep(kinematics) : null), [kinematics]);
  const grade = useMemo(
    () =>
      gradeAnalysis({
        sampleRateHz: kinematics?.sampleRateHz ?? fps,
        vfr: false,
        calibration,
        filtered: kinematics?.filtered ?? false,
        filter: DEFAULT_FILTER,
        trackerTier: 'manual',
        correctionCount: 0,
        trackedFrames: points.length,
        camera,
        distortionSource: 'none',
      }),
    [kinematics, fps, camera, points.length],
  );

  const stageCanvas = useStageCanvas(STAGE_W, STAGE_H, { x: 640, y: 620 });

  // The handle the driver reaches through. Exposing state rather than reaching
  // into the DOM keeps the assertions about what the component computed, not
  // about how it happens to render.
  useEffect(() => {
    (window as unknown as { __BENCH__: unknown }).__BENCH__ = {
      boundaries: boundaries.map(b => ({ t: b.t, rule: b.rule, source: b.source })),
      marks: marks.map(m => ({ t: m.t, x: m.x, y: m.y })),
      ellipse,
      stage: { width: STAGE_W, height: STAGE_H },
      // The chart's x-domain is the SERIES, not the boundary range — a driver
      // that assumes otherwise computes the wrong pixel for a given time.
      domain: kinematics
        ? { from: kinematics.t[0], to: kinematics.t[kinematics.t.length - 1] }
        : null,
      currentT,
      // Side-by-side has two clocks that must agree: the index the transport
      // is on, and the timestamp of the frame actually painted. A gap between
      // them is a stale picture under a correct overlay, which reads on screen
      // as the two lifts being at different points in the pull.
      leader: {
        index: playback.index,
        indexT: playback.server?.timestamps[playback.index] ?? null,
        frameT: playback.frame?.timestamp ?? null,
        frameIndex: playback.frame?.index ?? null,
        frameCount: playback.server?.frameCount ?? null,
      },
    };
  }, [boundaries, marks, ellipse, currentT, kinematics, playback]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--color-bg-page)',
      }}
    >
      <header
        style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 16px',
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: 'var(--text-section)' }}>Snatch</strong>
          <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
            Jon Herskind · 102 kg · 26/08
          </span>
        </div>
        <GradeChip grade={grade} />
      </header>

      {comparing && kinematics && metrics && summary && (
        <ComparisonView
          current={{
            label: 'Snatch · 26/08',
            date: '2026-08-26',
            points,
            series: kinematics,
            boundaries,
            metrics,
            summary,
            grade: grade.grade,
            massKg,
            phaseSetId: 'default',
          }}
          candidates={[reference.candidate]}
          selectedId={reference.candidate.analysis.id}
          onSelect={() => undefined}
          subject={reference.subject}
          loading={false}
          anchor={alignment}
          onAnchor={setAlignment}
          onClose={() => setComparing(false)}
          playback={playback}
        />
      )}

      <div style={{ flexGrow: 1, display: comparing ? 'none' : 'flex', minHeight: 0 }}>
        <main
          style={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 16,
            background: 'var(--color-bg-tertiary)',
          }}
        >
          <ViewerStage
            canvas={stageCanvas}
            width={STAGE_W}
            height={STAGE_H}
            tool={tool}
            points={marks}
            currentT={currentT}
            showPath
            ellipse={ellipse}
            onEllipseChange={setEllipse}
            measurePoints={[]}
            onMeasurePoint={() => undefined}
            onMark={p =>
              setMarks(current => [
                ...current.filter(m => Math.abs(m.t - currentT) > 1e-6),
                { t: currentT, x: p.x, y: p.y, s: 'm' },
              ])
            }
          />
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 'var(--text-caption)',
            }}
          >
            <label>
              fps{' '}
              <select value={fps} onChange={e => setFps(Number(e.target.value))}>
                {[24, 30, 60, 120, 240].map(v => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              marking tremor (px){' '}
              <input
                type="range"
                min={0}
                max={4}
                step={0.5}
                value={tremor}
                onChange={e => setTremor(Number(e.target.value))}
              />{' '}
              {tremor.toFixed(1)}
            </label>
            <label>
              playhead{' '}
              <input
                type="range"
                min={0}
                max={2.3}
                step={0.01}
                value={currentT}
                onChange={e => setCurrentT(Number(e.target.value))}
              />
            </label>
            <label>
              tool{' '}
              <select value={tool} onChange={e => setTool(e.target.value as ViewerTool)}>
                {(['look', 'calibrate', 'mark', 'distance', 'angle'] as ViewerTool[]).map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setCoach(null)}>
              reset phase edges
            </button>
            <span>{`${marks.length} marks`}</span>
            <button type="button" onClick={() => setComparing(c => !c)}>
              {comparing ? 'back to the lift' : 'compare'}
            </button>
          </div>
        </main>

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
          <MetricsPanel
            metrics={metrics}
            summary={summary}
            massKg={massKg}
            massSource="logged"
            onMass={setMassKg}
            emptyReason={null}
          />
          <GradePanel grade={grade} camera={camera} onCamera={setCamera} />
        </aside>
      </div>

      {/* Hidden while comparing, exactly as the viewer does it — a bench that
          shows a panel the real screen does not makes its screenshots lie. */}
      {!comparing && (
        <AnalysisPanel
          series={kinematics}
          spans={spans}
          boundaries={boundaries}
          onBoundaryDrag={(index, t) =>
            setCoach(current => {
              const base = current ?? boundaries;
              return base.map((b, i) => (i === index ? { ...b, t, source: 'coach' as const } : b));
            })
          }
          onBoundaryCommit={() => undefined}
          currentT={currentT}
          onSeekT={setCurrentT}
          emptyReason={null}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
