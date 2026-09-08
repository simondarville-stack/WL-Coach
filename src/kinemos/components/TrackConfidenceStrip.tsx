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
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CONFIDENCE_FLAGGED, CONFIDENCE_SOLID, confidenceRuns, type ConfidenceRun, type FrameConfidence } from '../lib/trackedPoints';
import { num } from '../lib/viewerFormat';

interface TrackConfidenceStripProps {
  frames: FrameConfidence[];
  frameCount: number;
  currentIndex: number | null;
  onSeek: (index: number) => void;
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
  doubtful: 'worth a look',
  flagged: 'flagged',
  manual: 'marked by hand',
  unscored: 'tracked before scores were kept',
  none: 'no point',
};

export function TrackConfidenceStrip({ frames, frameCount, currentIndex, onSeek }: TrackConfidenceStripProps) {
  if (frameCount <= 0) return null;
  const runs = confidenceRuns(frames, frameCount);
  const scored = frames.filter(f => f.c !== null);
  const mean = scored.length ? scored.reduce((sum, f) => sum + (f.c ?? 0), 0) / scored.length : null;

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
          <span style={{ ...micro, textTransform: 'none', letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }} title="Mean score over the scored frames">
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
        {currentIndex !== null && currentIndex >= 0 && currentIndex < frameCount && (
          <rect x={currentIndex} y={0} width={1} height={14} fill="var(--color-text-primary)" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        <Key band="solid">{`≥ ${num(CONFIDENCE_SOLID, 2)} solid`}</Key>
        <Key band="doubtful">{`${num(CONFIDENCE_FLAGGED, 2)}–${num(CONFIDENCE_SOLID, 2)} worth a look`}</Key>
        <Key band="flagged">{`< ${num(CONFIDENCE_FLAGGED, 2)} flagged`}</Key>
        <Key band="manual">by hand</Key>
        {frames.some(f => f.band === 'unscored') && <Key band="unscored">unscored — re-track to score</Key>}
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
