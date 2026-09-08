/**
 * ViewerStage — the video, the overlays, and every pointer gesture on them.
 *
 * One coordinate system throughout: DISPLAY-SPACE PIXELS, exactly as the frame
 * server serves them (rotation already applied). The canvas is that size, the
 * SVG overlay's viewBox is that size, and every stored point is in it. Clicks
 * convert through the painted canvas's own bounding rect, so zoom and pan cost
 * the rest of the component nothing — no gesture has to know the transform.
 *
 * Zoom matters more here than it looks: a bar end is ~50 px in a typical clip,
 * and in P1 the coach's click IS the measurement (there is no tracker centroid
 * to refine it yet). Magnification is how precision gets bought.
 *
 * Everything drawn over the frame is sized in SCREEN pixels. The overlay's
 * viewBox is the frame's — 1080 × 1920 for a phone clip — fitted into a
 * column a third that wide, so a radius or a stroke given in frame pixels
 * arrives on screen a third the size: a mark became a one-pixel dot and a
 * measurement line vanished (08/09/2026, `verify/drive-viewer.mjs`). `px()`
 * divides by the on-screen scale (fit × zoom) so a handle is a handle at any
 * clip size and any magnification.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PlateEllipse, PxPoint } from '../engine/calibration';
import type { KinemosTrackPoint } from '../../lib/database.types';
import {
  STAGE_GRID_CM,
  STAGE_LINE_WIDTHS_PX,
  STAGE_OPACITIES,
  STAGE_POINT_RADII_PX,
  type StagePrefs,
} from '../lib/displayPrefs';
import { DisplayOptions, type OptionRow } from './DisplayOptions';

export type ViewerTool = 'look' | 'calibrate' | 'mark' | 'distance' | 'angle' | 'knee';

interface ViewerStageProps {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  width: number;
  height: number;
  tool: ViewerTool;

  points: KinemosTrackPoint[];
  /** Timestamp of the frame on screen, so its own mark can be highlighted. */
  currentT: number | null;

  /** How the path and the frame furniture are drawn (`lib/displayPrefs`). */
  display: StagePrefs;
  /** The options chip on the stage. Absent → the chip is not drawn. */
  onDisplay?: (patch: Partial<StagePrefs>) => void;
  onDisplayReset?: () => void;
  displayModified?: boolean;
  /** One colour per point when the path is coloured by velocity or phase,
   *  aligned to `points`. Null → the path is one colour. */
  pointColours?: readonly string[] | null;
  /** Why the path cannot be coloured, when it cannot (no calibrated track). */
  colourReason?: string | null;
  /** The centimetre grid in frame pixels: the spacing along each axis and a
   *  point the lines pass through (the bar's start). Null → no calibration. */
  cmGrid?: { xStep: number; yStep: number; origin: PxPoint; cm: number } | null;

  ellipse: PlateEllipse | null;
  onEllipseChange: (ellipse: PlateEllipse) => void;

  /** Handles of the measurement in progress. Two for a distance, three for an
   *  angle — the two arms first, then the vertex. */
  measurePoints: PxPoint[];
  onMeasurePoint: (point: PxPoint) => void;
  /** The measurement's value, drawn beside it once it is complete. */
  measureLabel?: string | null;

  onMark: (point: PxPoint) => void;

  /** The knee, as the coach clicked it on the start frame — drawn as a
   *  height line across the frame, so the bar can be watched crossing it. */
  knee?: PxPoint | null;
  onKnee?: (point: PxPoint) => void;
}

/** Which ellipse handle a drag is moving, if any. */
type DragTarget = 'centre' | 'major' | 'minor';

/** Zoom range. Below 1 the frame is smaller than its box, which is never what
 *  a coach wants; above 8 a pixel is a tile and the click stops being honest
 *  about its own precision. */
const MIN_SCALE = 1;
const MAX_SCALE = 8;

/** Semi-axes of the ellipse a fresh calibration starts with, as a fraction of
 *  frame height. A competition plate typically fills about a fifth of the
 *  frame; starting close means the coach adjusts rather than constructs. */
const DEFAULT_SEMI_AXIS_FRACTION = 0.09;

/** The measurement colour, and the dark it is outlined in so it reads on a
 *  light floor as well as a dark one. Data-ish chrome: one colour for every
 *  hand measurement, distinct from the bar path and the plate. */
const MEASURE_COLOR = '#7FD1B9';
const INK = '#0F0F0E';

function defaultEllipseAt(point: PxPoint, frameHeight: number): PlateEllipse {
  const r = Math.max(12, frameHeight * DEFAULT_SEMI_AXIS_FRACTION);
  return { cx: point.x, cy: point.y, semiMajorPx: r, semiMinorPx: r * 0.85, tiltDeg: 0 };
}

/** Unit vectors of the ellipse frame: `up` along the major axis, `right`
 *  across it. Image coordinates, y downward. */
function axes(tiltDeg: number) {
  const phi = (tiltDeg * Math.PI) / 180;
  return {
    up: { x: Math.sin(phi), y: -Math.cos(phi) },
    right: { x: Math.cos(phi), y: Math.sin(phi) },
  };
}

function handlePoint(ellipse: PlateEllipse, which: 'major' | 'minor'): PxPoint {
  const { up, right } = axes(ellipse.tiltDeg);
  const dir = which === 'major' ? up : right;
  const r = which === 'major' ? ellipse.semiMajorPx : ellipse.semiMinorPx;
  return { x: ellipse.cx + dir.x * r, y: ellipse.cy + dir.y * r };
}

/**
 * The arc that marks an angle at its vertex: from the first arm round to the
 * second by the shorter way, which is the angle the readout reports. Returns
 * the SVG path and the direction of the arc's middle, where the label goes.
 */
function angleArc(vertex: PxPoint, a: PxPoint, b: PxPoint, radius: number) {
  const a1 = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const a2 = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  let delta = a2 - a1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const start = { x: vertex.x + radius * Math.cos(a1), y: vertex.y + radius * Math.sin(a1) };
  const end = { x: vertex.x + radius * Math.cos(a1 + delta), y: vertex.y + radius * Math.sin(a1 + delta) };
  const mid = a1 + delta / 2;
  return {
    d: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${end.x} ${end.y}`,
    mid: { x: Math.cos(mid), y: Math.sin(mid) },
  };
}

/**
 * Pointer capture, guarded.
 *
 * `setPointerCapture` throws `NotFoundError` when the pointer id is no longer
 * active — which happens for real when a pointer is released between the event
 * being queued and the handler running, and which would otherwise take the
 * whole gesture down with it. Failing to capture costs a drag that stops at the
 * element's edge; throwing costs the interaction entirely.
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Nothing to capture. The gesture still works inside the element.
  }
}

export function ViewerStage({
  canvas,
  width,
  height,
  tool,
  points,
  currentT,
  display,
  onDisplay,
  onDisplayReset,
  displayModified = false,
  pointColours = null,
  colourReason = null,
  cmGrid = null,
  ellipse,
  onEllipseChange,
  measurePoints,
  onMeasurePoint,
  measureLabel = null,
  onMark,
  knee = null,
  onKnee,
}: ViewerStageProps) {
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragTarget | null>(null);
  const panFromRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // The stage's own size, so the frame can be FITTED into it. `max-width:
  // 100%` alone is not a fit: the wrapper's height is content-sized, so a
  // percentage max-height on the canvas resolves to nothing, and any frame
  // larger than the box renders at full width and is cropped by the
  // overflow. On a 1080×1920 portrait phone clip — the footage coaches
  // actually film — that showed the middle third of the picture and nothing
  // else, with the lifter off the bottom. Measured with a ResizeObserver so a
  // sidebar toggle or a window resize refits too.
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    // jsdom has no ResizeObserver; the stage then renders at 1:1, which is
    // what the component tests exercise.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setBox(current =>
        current.w === rect.width && current.h === rect.height
          ? current
          : { w: rect.width, h: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Contain, in both directions: a 384×288 clip is upscaled to fill the box
  // rather than sitting as a stamp in the corner. Sub-pixel sizes are rounded
  // so the canvas and the SVG overlay agree on their box.
  const fit = box.w > 0 && box.h > 0 && width > 0 && height > 0 ? Math.min(box.w / width, box.h / height) : 1;
  const fittedWidth = Math.max(1, Math.round(width * fit));
  const fittedHeight = Math.max(1, Math.round(height * fit));

  /** Screen pixels per frame pixel, and its inverse: a size that should be
   *  `n` pixels on screen whatever the clip and the zoom. */
  const ui = fit * scale;
  const px = (n: number) => n / ui;

  // Paint the served frame. The frame server owns its canvas, so this copies
  // rather than adopts — the served one can be evicted from the cache at any
  // time, and a stage holding a released canvas paints garbage.
  useEffect(() => {
    const target = paintRef.current;
    if (!target) return;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    if (!canvas) {
      ctx.clearRect(0, 0, target.width, target.height);
      return;
    }
    ctx.drawImage(canvas as CanvasImageSource, 0, 0, target.width, target.height);
  }, [canvas, width, height]);

  // Wheel zoom as a non-passive native listener: React's synthetic wheel
  // handler cannot preventDefault on a passively-attached root listener, which
  // is how a zoom gesture ends up scrolling the page instead.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(current =>
        Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * (e.deltaY < 0 ? 1.12 : 1 / 1.12))),
      );
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  /** Client coordinates → display-space pixels, via the painted canvas's own
   *  rect. Correct under any zoom/pan because the rect already reflects them. */
  const toFrame = useCallback(
    (clientX: number, clientY: number): PxPoint => {
      const el = paintRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * width,
        y: ((clientY - rect.top) / rect.height) * height,
      };
    },
    [width, height],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The pointer is captured on the wrapper in every case, including a handle
    // grab: capturing on the small circle instead would send moves to the
    // circle and lose them the moment the coach drags faster than it is wide.
    capturePointer(e.currentTarget, e.pointerId);

    if (dragRef.current) return; // a handle claimed this press

    // A drag on empty stage pans in every tool, so reframing never costs a
    // tool switch.
    if (tool === 'look' || e.shiftKey) {
      panFromRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    const p = toFrame(e.clientX, e.clientY);
    if (tool === 'calibrate') {
      // First press plants the plate outline; after that the handles do the
      // work and a press on the frame pans.
      if (!ellipse) onEllipseChange(defaultEllipseAt(p, height));
      else panFromRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    if (tool === 'mark') {
      onMark(p);
      return;
    }
    if (tool === 'knee') {
      onKnee?.(p);
      return;
    }
    onMeasurePoint(p);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && ellipse) {
      const p = toFrame(e.clientX, e.clientY);
      if (drag === 'centre') {
        onEllipseChange({ ...ellipse, cx: p.x, cy: p.y });
      } else if (drag === 'major') {
        const vx = p.x - ellipse.cx;
        const vy = p.y - ellipse.cy;
        const len = Math.hypot(vx, vy);
        if (len > 2) {
          // This handle sets the plate's size AND its tilt in one gesture: the
          // major axis is the plate's true diameter, so where the coach puts
          // it is what "up the plate" means.
          onEllipseChange({
            ...ellipse,
            semiMajorPx: len,
            tiltDeg: (Math.atan2(vx, -vy) * 180) / Math.PI,
          });
        }
      } else {
        const { right } = axes(ellipse.tiltDeg);
        const along = Math.abs((p.x - ellipse.cx) * right.x + (p.y - ellipse.cy) * right.y);
        onEllipseChange({ ...ellipse, semiMinorPx: Math.max(1, along) });
      }
      return;
    }
    const panFrom = panFromRef.current;
    if (panFrom) {
      setPan({
        x: panFrom.panX + (e.clientX - panFrom.x),
        y: panFrom.panY + (e.clientY - panFrom.y),
      });
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    panFromRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const currentMark =
    currentT === null || !display.cursor ? null : (points.find(p => Math.abs(p.t - currentT) < 1e-6) ?? null);

  // ── The path, as the coach wants it drawn ────────────────────────────────
  //
  // `visible` is the indices of the points to draw: all of them, or only what
  // the bar has done so far when the trail follows the playhead. Indices, not
  // a filtered copy, so a per-point colour stays aligned to its point.
  const visible: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (display.trail === 'past' && currentT !== null && points[i].t > currentT + 1e-6) continue;
    visible.push(i);
  }
  const drawLine = display.path === 'line' || display.path === 'both';
  const drawPoints = display.path === 'points' || display.path === 'both';
  const colours = display.colour !== 'plain' && pointColours && pointColours.length === points.length ? pointColours : null;
  const lineWidth = px(display.lineWidthPx);
  const pointRadius = px(display.pointRadiusPx);

  const gridStroke = { stroke: 'rgba(255,255,255,0.38)', strokeWidth: px(1), strokeDasharray: `${px(4)} ${px(4)}` };
  const cmLines = (() => {
    if (display.grid !== 'cm' || !cmGrid || !(cmGrid.xStep > 1) || !(cmGrid.yStep > 1)) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    // Both ways from the origin, capped so a tiny plate on a huge frame cannot
    // draw thousands of lines.
    for (let x = cmGrid.origin.x, n = 0; x >= 0 && n < 120; x -= cmGrid.xStep, n++) xs.push(x);
    for (let x = cmGrid.origin.x + cmGrid.xStep, n = 0; x <= width && n < 120; x += cmGrid.xStep, n++) xs.push(x);
    for (let y = cmGrid.origin.y, n = 0; y >= 0 && n < 120; y -= cmGrid.yStep, n++) ys.push(y);
    for (let y = cmGrid.origin.y + cmGrid.yStep, n = 0; y <= height && n < 120; y += cmGrid.yStep, n++) ys.push(y);
    return { xs, ys };
  })();

  const optionRows: OptionRow[] | null = onDisplay
    ? [
        {
          kind: 'choice',
          label: 'Path',
          value: display.path,
          options: [
            { value: 'line', label: 'line' },
            { value: 'points', label: 'points' },
            { value: 'both', label: 'both' },
            { value: 'off', label: 'off' },
          ],
          onChange: (v: never) => onDisplay({ path: v }),
        },
        {
          kind: 'choice',
          label: 'Line width',
          value: display.lineWidthPx,
          options: STAGE_LINE_WIDTHS_PX.map(w => ({ value: w, label: `${w} px` })),
          onChange: (v: never) => onDisplay({ lineWidthPx: v }),
        },
        {
          kind: 'choice',
          label: 'Point size',
          value: display.pointRadiusPx,
          options: STAGE_POINT_RADII_PX.map(r => ({ value: r, label: `${String(r).replace('.', ',')} px` })),
          onChange: (v: never) => onDisplay({ pointRadiusPx: v }),
        },
        {
          kind: 'choice',
          label: 'Opacity',
          value: display.opacity,
          options: STAGE_OPACITIES.map(o => ({ value: o, label: `${Math.round(o * 100)} %` })),
          onChange: (v: never) => onDisplay({ opacity: v }),
        },
        {
          kind: 'choice',
          label: 'Colour',
          value: display.colour,
          options: [
            { value: 'plain', label: 'one colour' },
            { value: 'velocity', label: 'velocity heat', title: 'Blue falling · grey at rest · amber rising · red at this lift\'s Vmax' },
            { value: 'phase', label: 'by phase', title: 'Each phase in its timeline colour' },
          ],
          onChange: (v: never) => onDisplay({ colour: v }),
          disabledReason: colourReason,
        },
        {
          kind: 'choice',
          label: 'Grid',
          value: display.grid,
          options: [
            { value: 'off', label: 'off' },
            { value: 'thirds', label: 'thirds' },
            { value: 'cm', label: 'cm', title: 'Real centimetres through the plate outline, from the bar\'s start' },
          ],
          onChange: (v: never) => onDisplay({ grid: v }),
        },
        ...(display.grid === 'cm'
          ? [
              {
                kind: 'choice' as const,
                label: 'Grid step',
                value: display.gridCm,
                options: STAGE_GRID_CM.map(cm => ({ value: cm, label: `${cm} cm` })),
                onChange: (v: never) => onDisplay({ gridCm: v }),
                disabledReason: cmGrid ? null : 'no plate outline',
              },
            ]
          : []),
        {
          kind: 'choice',
          label: 'Trail',
          value: display.trail,
          options: [
            { value: 'full', label: 'whole rep' },
            { value: 'past', label: 'up to now', title: 'The path grows with the playhead' },
          ],
          onChange: (v: never) => onDisplay({ trail: v }),
        },
        { kind: 'toggle', label: 'Ring on the bar at this frame', value: display.cursor, onChange: v => onDisplay({ cursor: v }) },
      ]
    : null;

  const cursor =
    tool === 'look' ? 'grab' : tool === 'calibrate' && ellipse ? 'default' : 'crosshair';

  // ── The measurement in progress ──────────────────────────────────────────
  //
  // A distance is the segment between its two points. An angle is two RAYS
  // from the vertex — the third click — with an arc between them; the first
  // two points are the arms, and until the vertex is placed nothing joins
  // them, because a line between two arm tips is not an angle and reads as
  // one. The value sits beside the figure once it is complete.
  const angleReady = tool === 'angle' && measurePoints.length === 3;
  const distanceReady = tool === 'distance' && measurePoints.length === 2;
  const arc = angleReady ? angleArc(measurePoints[2], measurePoints[0], measurePoints[1], px(26)) : null;
  const labelStyle = {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    userSelect: 'none' as const,
    paintOrder: 'stroke' as const,
  };

  return (
    // The outer wrapper is not clipped, so the options popover can hang past
    // the stage's edge; the inner box clips the zoomed frame as before.
    <div style={{ position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex' }}>
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: '#0F0F0E',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: fittedWidth,
          height: fittedHeight,
          flexShrink: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          lineHeight: 0,
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas
          ref={paintRef}
          width={width}
          height={height}
          style={{ display: 'block', width: fittedWidth, height: fittedHeight, cursor }}
        />

        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          // The overlay must never swallow a click meant for the stage; only
          // the handles below opt back in.
          pointerEvents="none"
        >
          {/* ── Grid ──────────────────────────────────────────────────── */}
          {display.grid === 'thirds' && (
            <g data-grid="thirds" {...gridStroke}>
              <line x1={width / 3} y1={0} x2={width / 3} y2={height} />
              <line x1={(2 * width) / 3} y1={0} x2={(2 * width) / 3} y2={height} />
              <line x1={0} y1={height / 3} x2={width} y2={height / 3} />
              <line x1={0} y1={(2 * height) / 3} x2={width} y2={(2 * height) / 3} />
            </g>
          )}
          {cmLines && cmGrid && (
            <g data-grid="cm" {...gridStroke}>
              {cmLines.xs.map(x => (
                <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} />
              ))}
              {cmLines.ys.map(y => (
                <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} />
              ))}
              <text
                x={px(8)}
                y={height - px(8)}
                fontSize={px(11)}
                fill="#FFFFFF"
                stroke={INK}
                strokeWidth={px(3)}
                style={labelStyle}
              >
                {`${cmGrid.cm} cm`}
              </text>
            </g>
          )}

          {/* ── Bar path ──────────────────────────────────────────────── */}
          {display.path !== 'off' && visible.length > 0 && (
            <g data-path={display.path} opacity={display.opacity}>
              {drawLine && visible.length > 1 && !colours && (
                <polyline
                  points={visible.map(i => `${points[i].x},${points[i].y}`).join(' ')}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {drawLine &&
                colours &&
                visible.slice(1).map((i, k) => {
                  const a = points[visible[k]];
                  const b = points[i];
                  return (
                    <line
                      key={b.t}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={colours[i]}
                      strokeWidth={lineWidth}
                      strokeLinecap="round"
                    />
                  );
                })}
              {drawPoints &&
                visible.map(i => (
                  <circle key={points[i].t} cx={points[i].x} cy={points[i].y} r={pointRadius} fill={colours ? colours[i] : '#FFFFFF'} />
                ))}
            </g>
          )}
          {currentMark && (
            <>
              <circle
                cx={currentMark.x}
                cy={currentMark.y}
                r={px(9)}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={px(2)}
              />
              <circle cx={currentMark.x} cy={currentMark.y} r={px(3)} fill="#FFFFFF" />
            </>
          )}

          {/* ── Plate ellipse ─────────────────────────────────────────── */}
          {ellipse && (
            <g>
              <ellipse
                cx={ellipse.cx}
                cy={ellipse.cy}
                rx={ellipse.semiMinorPx}
                ry={ellipse.semiMajorPx}
                transform={`rotate(${ellipse.tiltDeg} ${ellipse.cx} ${ellipse.cy})`}
                fill="none"
                stroke="#F2C14E"
                strokeWidth={px(2)}
                strokeDasharray={`${px(6)} ${px(4)}`}
              />
              {tool === 'calibrate' && (
                <>
                  <EllipseHandle
                    point={{ x: ellipse.cx, y: ellipse.cy }}
                    ui={ui}
                    onGrab={() => {
                      dragRef.current = 'centre';
                    }}
                  />
                  <EllipseHandle
                    point={handlePoint(ellipse, 'major')}
                    ui={ui}
                    onGrab={() => {
                      dragRef.current = 'major';
                    }}
                  />
                  <EllipseHandle
                    point={handlePoint(ellipse, 'minor')}
                    ui={ui}
                    onGrab={() => {
                      dragRef.current = 'minor';
                    }}
                  />
                </>
              )}
            </g>
          )}

          {/* ── Knee height ───────────────────────────────────────────── */}
          {knee && (
            <g>
              <line
                x1={0}
                y1={knee.y}
                x2={width}
                y2={knee.y}
                stroke={MEASURE_COLOR}
                strokeWidth={px(1.5)}
                strokeDasharray={`${px(8)} ${px(5)}`}
                opacity={0.9}
              />
              <circle cx={knee.x} cy={knee.y} r={px(5)} fill={MEASURE_COLOR} stroke={INK} strokeWidth={px(1.5)} />
              <text
                x={px(8)}
                y={knee.y - px(6)}
                fontSize={px(12)}
                fill={MEASURE_COLOR}
                stroke={INK}
                strokeWidth={px(3)}
                style={labelStyle}
              >
                knee
              </text>
            </g>
          )}

          {/* ── Measurement in progress ───────────────────────────────── */}
          {distanceReady && (
            <line
              x1={measurePoints[0].x}
              y1={measurePoints[0].y}
              x2={measurePoints[1].x}
              y2={measurePoints[1].y}
              stroke={MEASURE_COLOR}
              strokeWidth={px(2)}
              strokeLinecap="round"
            />
          )}
          {angleReady && arc && (
            <>
              <polyline
                points={`${measurePoints[0].x},${measurePoints[0].y} ${measurePoints[2].x},${measurePoints[2].y} ${measurePoints[1].x},${measurePoints[1].y}`}
                fill="none"
                stroke={MEASURE_COLOR}
                strokeWidth={px(2)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d={arc.d} fill="none" stroke={MEASURE_COLOR} strokeWidth={px(1.5)} />
            </>
          )}
          {measurePoints.map((p, i) => (
            <circle
              key={`${i}-${p.x}-${p.y}`}
              cx={p.x}
              cy={p.y}
              r={px(5)}
              fill={MEASURE_COLOR}
              stroke={INK}
              strokeWidth={px(1.5)}
            />
          ))}
          {measureLabel && distanceReady && (
            <text
              x={(measurePoints[0].x + measurePoints[1].x) / 2}
              y={(measurePoints[0].y + measurePoints[1].y) / 2 - px(10)}
              textAnchor="middle"
              fontSize={px(13)}
              fill={MEASURE_COLOR}
              stroke={INK}
              strokeWidth={px(3)}
              style={labelStyle}
            >
              {measureLabel}
            </text>
          )}
          {measureLabel && angleReady && arc && (
            <text
              x={measurePoints[2].x + arc.mid.x * px(44)}
              y={measurePoints[2].y + arc.mid.y * px(44) + px(4)}
              textAnchor="middle"
              fontSize={px(13)}
              fill={MEASURE_COLOR}
              stroke={INK}
              strokeWidth={px(3)}
              style={labelStyle}
            >
              {measureLabel}
            </text>
          )}
        </svg>
      </div>

      {scale !== 1 && (
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            height: 24,
            padding: '0 8px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'rgba(0,0,0,0.55)',
            color: '#FFFFFF',
            fontSize: 'var(--text-caption)',
            cursor: 'pointer',
          }}
        >
          {`${scale.toFixed(1).replace('.', ',')}× — reset`}
        </button>
      )}
    </div>
      {optionRows && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}>
          <DisplayOptions
            title="Clip overlay"
            tone="stage"
            rows={optionRows}
            modified={displayModified}
            onReset={() => onDisplayReset?.()}
            footer={
              display.colour === 'velocity' && !colourReason ? (
                <p style={{ margin: '8px 0 0', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', lineHeight: 1.35 }}>
                  Blue falling · grey at rest · amber rising · red at this lift's Vmax.
                </p>
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
}

/** A grab target on the ellipse. Drawn at a constant on-screen size by dividing
 *  through the on-screen scale, so magnifying to place a handle precisely does
 *  not turn the handle itself into the obstruction. */
function EllipseHandle({
  point,
  ui,
  onGrab,
}: {
  point: PxPoint;
  /** Screen pixels per frame pixel. */
  ui: number;
  onGrab: () => void;
}) {
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={7 / ui}
      fill="#F2C14E"
      stroke="#0F0F0E"
      strokeWidth={1.5 / ui}
      pointerEvents="all"
      style={{ cursor: 'move' }}
      // Deliberately NOT stopping propagation: the wrapper's pointerdown still
      // runs and captures the pointer, then sees this flag and stands aside.
      onPointerDown={onGrab}
    />
  );
}
