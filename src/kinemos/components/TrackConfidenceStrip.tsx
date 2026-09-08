/**
 * TrackConfidenceStrip — the tracker's opinion of every frame, in one row.
 *
 * "Where is it bad" is read, not scrubbed: one strip over all frames, on the
 * same axis as the transport, coloured by the band the tracker's score falls
 * in. A hand mark is the accent — a coach's click, not a correlation. Frames
 * with no point are empty. A press seeks to that frame, and the playhead is
 * the video's.
 *
 * Colour is data here (it encodes the band) and the legend under the strip
 * says the same thing in words with the thresholds, so the colours never
 * carry the meaning alone.
 */
import { memo, useMemo, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CONFIDENCE_FLAGGED, CONFIDENCE_SOLID, confidenceRuns, type ConfidenceRun, type FrameConfidence } from '../lib/trackedPoints';
import { num } from '../lib/viewerFormat';

export interface PhaseEdge {
  /** Frame the phase starts on. */
  index: number;
  label: string;
}

interface TrackConfidenceStripProps {
  frames: FrameConfidence[];
  frameCount: number;
  currentIndex: number | null;
  onSeek: (index: number) => void;
  /** Where each phase starts, drawn as ticks so a red run can be placed in
   *  the lift without looking away to the timeline. */
  edges?: PhaseEdge[];
}

const BAND_COLOR: Record<ConfidenceRun['band'], string> = {
  solid: 'var(--color-success-border)',
  doubtful: 'var(--color-warning-border)',
  flagged: 'var(--color-danger-border)',
  manual: 'var(--color-accent)',
  unscored: 'var(--color-text-tertiary)',
  none: 'var(--color-bg-tertiary)',
};

const BAND_WORD: Record<ConfidenceRun['band'], string> = {
  solid: 'solid match',
  doubtful: 'doubtful',
  flagged: 'flagged',
  manual: 'by hand',
  unscored: 'unscored',
  none: 'no point',
};

function TrackConfidenceStripImpl({ frames, frameCount, currentIndex, onSeek, edges = [] }: TrackConfidenceStripProps) {
  // The runs and the mean change with the track, not with the playhead.
  const runs = useMemo(() => confidenceRuns(frames, frameCount), [frames, frameCount]);
  const mean = useMemo(() => {
    const scored = frames.filter(f => f.c !== null);
    return scored.length ? scored.reduce((sum, f) => sum + (f.c ?? 0), 0) / scored.length : null;
  }, [frames]);
  if (frameCount <= 0) return null;

  const seekFromClient = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(Math.round(fraction * (frameCount - 1)));
  };

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={micro}>{`Tracker confidence · ${frameCount} frames`}</span>
        {mean !== null && (
          <span style={{ ...micro, textTransform: 'none', letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }} title="Mean score">
            {`mean ${num(mean, 2)}`}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${frameCount} 14`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Tracker confidence per frame"
        onPointerDown={seekFromClient}
        style={{ display: 'block', width: '100%', height: 12, borderRadius: 3, cursor: 'pointer', touchAction: 'none' }}
      >
        {runs.map(run => (
          <rect key={run.from} x={run.from} y={0} width={run.to - run.from + 1} height={14} fill={BAND_COLOR[run.band]}>
            <title>
              {`${run.from === run.to ? `frame ${run.from + 1}` : `frames ${run.from + 1}–${run.to + 1}`} · ${BAND_WORD[run.band]}${
                run.c !== null ? ` · ${num(run.c, 2)}` : ''
              }`}
            </title>
          </rect>
        ))}
        {/* Lines, not rects: a one-frame rect is under a pixel on a long
            clip, and a non-scaling stroke keeps these one width at any
            frame count. */}
        {edges.map(edge =>
          edge.index > 0 && edge.index < frameCount ? (
            <line
              key={`${edge.label}-${edge.index}`}
              x1={edge.index}
              y1={0}
              x2={edge.index}
              y2={14}
              stroke="var(--color-text-primary)"
              strokeWidth={1}
              strokeDasharray="2 2"
              strokeOpacity={0.6}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${edge.label} · frame ${edge.index + 1}`}</title>
            </line>
          ) : null,
        )}
        {currentIndex !== null && currentIndex >= 0 && currentIndex < frameCount && (
          <line x1={currentIndex + 0.5} y1={0} x2={currentIndex + 0.5} y2={14} stroke="var(--color-text-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        <Key band="solid">{`≥ ${num(CONFIDENCE_SOLID, 2)} solid`}</Key>
        <Key band="doubtful">{`${num(CONFIDENCE_FLAGGED, 2)}–${num(CONFIDENCE_SOLID, 2)} doubtful`}</Key>
        <Key band="flagged">{`< ${num(CONFIDENCE_FLAGGED, 2)} flagged`}</Key>
        <Key band="manual">by hand</Key>
        {frames.some(f => f.band === 'unscored') && <Key band="unscored">unscored · re-track</Key>}
        {edges.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)' }}>
            <span style={{ width: 0, height: 8, borderLeft: '1px dashed var(--color-text-primary)', opacity: 0.6 }} />
            phase edge
          </span>
        )}
      </div>
    </div>
  );
}

function Key({ band, children }: { band: ConfidenceRun['band']; children: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-micro)', color: 'var(--color-text-tertiary)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: BAND_COLOR[band] }} />
      {children}
    </span>
  );
}

const micro: CSSProperties = {
  fontSize: 'var(--text-micro)',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-tertiary)',
};

export const TrackConfidenceStrip = memo(TrackConfidenceStripImpl);
