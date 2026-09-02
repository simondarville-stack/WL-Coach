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
        y: 1000 - y * pxPerM + rand() * tremorPx,
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

/** The stage needs pixels. A painted frame stands in for decoded video: a
 *  platform, a plate at the marked position, and enough contrast to see the
 *  overlay against. */
function useStageCanvas(width: number, height: number, plate: PxPoint) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  if (!ref.current) {
    ref.current = document.createElement('canvas');
    ref.current.width = width;
    ref.current.height = height;
  }
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
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
  }, [width, height, plate.x, plate.y]);
  return ref.current;
}

/**
 * A comparison subject built out of a second synthetic lift — slower off the
 * floor, faster through the second pull, filmed with the bar elsewhere in
 * frame, from a clip that starts a third of a second earlier. Every one of
 * those differences is something the alignment and the delta table have to
 * handle, and none of them is visible from a unit test.
 */
function useReferenceSubject(): { candidate: ComparisonCandidate; subject: ComparisonSubject } {
  return useMemo(() => {
    const points = syntheticTrack(60, 1.2, {
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
      fps: 60,
      width: 1920,
      height: 1080,
      playbackUrl: '',
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
        series,
        boundaries,
        metrics: computeLiftMetrics(series, spans),
        summary: summariseRep(series),
      },
    };
  }, []);
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
  const reference = useReferenceSubject();

  const points = useMemo(() => syntheticTrack(fps, tremor), [fps, tremor]);
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
    };
  }, [boundaries, marks, ellipse, currentT, kinematics]);

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
