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

export type ViewerTool = 'look' | 'calibrate' | 'mark' | 'distance' | 'angle';

interface ViewerStageProps {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  width: number;
  height: number;
  tool: ViewerTool;

  points: KinemosTrackPoint[];
  /** Timestamp of the frame on screen, so its own mark can be highlighted. */
  currentT: number | null;
  showPath: boolean;

  ellipse: PlateEllipse | null;
  onEllipseChange: (ellipse: PlateEllipse) => void;

  /** Handles of the measurement in progress. Two for a distance, three for an
   *  angle. */
  measurePoints: PxPoint[];
  onMeasurePoint: (point: PxPoint) => void;

  onMark: (point: PxPoint) => void;
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

export function ViewerStage({
  canvas,
  width,
  height,
  tool,
  points,
  currentT,
  showPath,
  ellipse,
  onEllipseChange,
  measurePoints,
  onMeasurePoint,
  onMark,
}: ViewerStageProps) {
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragTarget | null>(null);
  const panFromRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

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
    e.currentTarget.setPointerCapture(e.pointerId);

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
    currentT === null ? null : (points.find(p => Math.abs(p.t - currentT) < 1e-6) ?? null);

  const cursor =
    tool === 'look' ? 'grab' : tool === 'calibrate' && ellipse ? 'default' : 'crosshair';

  return (
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
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          maxWidth: '100%',
          maxHeight: '100%',
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
          style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', cursor }}
        />

        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          // The overlay must never swallow a click meant for the stage; only
          // the handles below opt back in.
          pointerEvents="none"
        >
          {/* ── Bar path ──────────────────────────────────────────────── */}
          {showPath && points.length > 1 && (
            <polyline
              points={points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={3 / scale}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.95}
            />
          )}
          {showPath &&
            points.map(p => (
              <circle key={p.t} cx={p.x} cy={p.y} r={3 / scale} fill="#FFFFFF" opacity={0.85} />
            ))}
          {currentMark && (
            <>
              <circle
                cx={currentMark.x}
                cy={currentMark.y}
                r={8 / scale}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={2 / scale}
              />
              <circle cx={currentMark.x} cy={currentMark.y} r={2.5 / scale} fill="#FFFFFF" />
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
                strokeWidth={2 / scale}
                strokeDasharray={`${6 / scale} ${4 / scale}`}
              />
              {tool === 'calibrate' && (
                <>
                  <EllipseHandle
                    point={{ x: ellipse.cx, y: ellipse.cy }}
                    scale={scale}
                    onGrab={() => {
                      dragRef.current = 'centre';
                    }}
                  />
                  <EllipseHandle
                    point={handlePoint(ellipse, 'major')}
                    scale={scale}
                    onGrab={() => {
                      dragRef.current = 'major';
                    }}
                  />
                  <EllipseHandle
                    point={handlePoint(ellipse, 'minor')}
                    scale={scale}
                    onGrab={() => {
                      dragRef.current = 'minor';
                    }}
                  />
                </>
              )}
            </g>
          )}

          {/* ── Measurement in progress ───────────────────────────────── */}
          {measurePoints.length > 1 && (
            <polyline
              points={measurePoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#7FD1B9"
              strokeWidth={2 / scale}
            />
          )}
          {measurePoints.map((p, i) => (
            <circle
              key={`${i}-${p.x}-${p.y}`}
              cx={p.x}
              cy={p.y}
              r={4 / scale}
              fill="#7FD1B9"
              stroke="#0F0F0E"
              strokeWidth={1 / scale}
            />
          ))}
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
  );
}

/** A grab target on the ellipse. Drawn at a constant on-screen size by dividing
 *  through the zoom, so magnifying to place a handle precisely does not turn
 *  the handle itself into the obstruction. */
function EllipseHandle({
  point,
  scale,
  onGrab,
}: {
  point: PxPoint;
  scale: number;
  onGrab: () => void;
}) {
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={6 / scale}
      fill="#F2C14E"
      stroke="#0F0F0E"
      strokeWidth={1.5 / scale}
      pointerEvents="all"
      style={{ cursor: 'move' }}
      // Deliberately NOT stopping propagation: the wrapper's pointerdown still
      // runs and captures the pointer, then sees this flag and stands aside.
      onPointerDown={onGrab}
    />
  );
}
