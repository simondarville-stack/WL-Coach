/**
 * ClipStage — a clip and its bar path, read-only.
 *
 * `ViewerStage` is the working surface: zoom, pan, calibration handles,
 * marking, measurement. None of that belongs in a side-by-side comparison,
 * where the coach is watching rather than editing, and where two of everything
 * would double the ways a gesture can land on the wrong clip.
 *
 * So this is the watching half on its own: the frame, the path traced so far,
 * and the bar's position now. Same coordinate system as everywhere else in
 * KinEMOS — display-space pixels exactly as the frame server serves them, with
 * rotation already applied — so a stored track point needs no conversion.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { KinemosTrackPoint } from '../../lib/database.types';

interface ClipStageProps {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  width: number;
  height: number;
  points: KinemosTrackPoint[];
  /** Timestamp on screen. The path is drawn up to here and the marker sits on
   *  it; null draws the whole path and no marker. */
  currentT: number | null;
  /** Colour of this clip's path, matching its curve in the charts. */
  color: string;
  /** Caption strip along the bottom — which lift this is, and its reading. */
  footer?: ReactNode;
  /** Shown in place of the frame while it is not there. */
  overlay?: ReactNode;
}

export function ClipStage({
  canvas,
  width,
  height,
  points,
  currentT,
  color,
  footer,
  overlay,
}: ClipStageProps) {
  const paintRef = useRef<HTMLCanvasElement | null>(null);

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

  // The path up to now, and where the bar is. A path drawn to the end of the
  // lift while the video is a third of the way through shows the coach the
  // answer before the question.
  const drawn = currentT === null ? points : points.filter(p => p.t <= currentT + 1e-6);
  const head = currentT === null ? null : (drawn[drawn.length - 1] ?? null);
  const d = drawn
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  return (
    <div
      style={{
        position: 'relative',
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#111',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', flexGrow: 1, minHeight: 0, display: 'grid' }}>
        <canvas
          ref={paintRef}
          width={width}
          height={height}
          style={{
            gridArea: '1 / 1',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
        {/* The overlay shares the grid cell and the aspect, so it lands on the
            frame rather than on the letterbox around it. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ gridArea: '1 / 1', width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {drawn.length > 1 && (
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {head && (
            <>
              <circle cx={head.x} cy={head.y} r={Math.max(4, height * 0.006)} fill={color} />
              <circle
                cx={head.x}
                cy={head.y}
                r={Math.max(9, height * 0.014)}
                fill="none"
                stroke={color}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {overlay && (
          <div
            style={{
              gridArea: '1 / 1',
              display: 'grid',
              placeItems: 'center',
              padding: 'var(--space-md)',
              textAlign: 'center',
              color: '#D8D8D2',
              fontSize: 'var(--text-caption)',
              lineHeight: 1.5,
            }}
          >
            {overlay}
          </div>
        )}
      </div>
      {footer && <div style={footerStyle}>{footer}</div>}
    </div>
  );
}

const footerStyle: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-sm)',
  padding: '4px 8px',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#EDEDE7',
  fontSize: 'var(--text-micro)',
  fontVariantNumeric: 'tabular-nums',
  flexWrap: 'wrap',
};
