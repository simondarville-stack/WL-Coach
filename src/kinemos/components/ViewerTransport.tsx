/**
 * ViewerTransport — the playhead's chrome: the scrub strip and the controls
 * under the stage.
 *
 * Frame stepping outranks play/pause here. A coach studying a turnover spends
 * their time on ← and →, at 0,25× when they play at all, so the step buttons
 * sit inboard and the speed chips default slow (design brief: "frame stepping
 * matters more than play/pause").
 *
 * The strip carries the MARK COVERAGE — which frames have a point on them. It
 * is the P1 answer to the design brief's third open question ("how does a coach
 * find the frames worth checking without scrubbing all 218 of them"): before a
 * tracker exists, the frames worth attention are the ones not yet marked. P2
 * repaints the same strip with tracker confidence and the question is answered
 * the same way.
 */
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { PLAYBACK_SPEEDS } from '../hooks/useFrameServer';
import { clipTime, num } from '../lib/viewerFormat';

interface ViewerTransportProps {
  index: number;
  frameCount: number;
  timestamps: readonly number[];
  playing: boolean;
  speed: number;
  /** Timestamps that carry a mark, for the coverage band. */
  markedTimes: number[];
  /** Frame indices the tracker was not sure about. Drawn over the coverage in
   *  warning colour: this strip is where "which frames are worth checking" gets
   *  answered without scrubbing all 218 of them. */
  uncertainIndices?: number[];
  fps: number;
  vfr: boolean;

  onSeek: (index: number) => void;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
}

export function ViewerTransport({
  index,
  frameCount,
  timestamps,
  playing,
  speed,
  markedTimes,
  uncertainIndices = [],
  fps,
  vfr,
  onSeek,
  onStep,
  onTogglePlay,
  onSpeed,
}: ViewerTransportProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const seekFromClient = useCallback(
    (clientX: number) => {
      const el = stripRef.current;
      if (!el || frameCount === 0) return;
      const rect = el.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      // Position maps to a FRAME, not a time: on a variable-rate clip an even
      // pixel-per-second strip would make the dense stretches unscrubbable.
      onSeek(Math.round(fraction * (frameCount - 1)));
    },
    [frameCount, onSeek],
  );

  const onStripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClient(e.clientX);
  };
  const onStripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) seekFromClient(e.clientX);
  };
  const onStripUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    scrubbing.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const playhead = frameCount > 1 ? (index / (frameCount - 1)) * 100 : 0;
  const t = timestamps[index] ?? 0;

  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div
        ref={stripRef}
        onPointerDown={onStripDown}
        onPointerMove={onStripMove}
        onPointerUp={onStripUp}
        onPointerCancel={onStripUp}
        style={{
          position: 'relative',
          height: 22,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-tertiary)',
          cursor: 'pointer',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Coverage: one tick per marked frame. Ticks are 2 px wide whatever
            the clip length, so a sparse start reads as sparse rather than
            disappearing. */}
        {markedTimes.map(time => {
          const i = timestamps.indexOf(time);
          const left = i >= 0 && frameCount > 1 ? (i / (frameCount - 1)) * 100 : null;
          return left === null ? null : (
            <span
              key={time}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${left}%`,
                width: 2,
                background: 'var(--color-accent)',
                opacity: 0.55,
              }}
            />
          );
        })}
        {uncertainIndices.map(i => {
          const left = frameCount > 1 ? (i / (frameCount - 1)) * 100 : 0;
          return (
            <span
              key={`u${i}`}
              title={`Frame ${i + 1} — the tracker was not confident here`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${left}%`,
                width: 3,
                marginLeft: -0.5,
                background: 'var(--color-warning-border)',
              }}
            />
          );
        })}
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${playhead}%`,
            width: 2,
            background: 'var(--color-text-primary)',
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <TransportButton label="First frame (Home)" onClick={() => onSeek(0)}>
          <SkipBack size={16} />
        </TransportButton>
        <TransportButton label="Back one frame (←)" onClick={() => onStep(-1)}>
          <ChevronLeft size={16} />
        </TransportButton>
        <TransportButton label={playing ? 'Pause (space)' : 'Play (space)'} onClick={onTogglePlay}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </TransportButton>
        <TransportButton label="Forward one frame (→)" onClick={() => onStep(1)}>
          <ChevronRight size={16} />
        </TransportButton>
        <TransportButton label="Last frame (End)" onClick={() => onSeek(frameCount - 1)}>
          <SkipForward size={16} />
        </TransportButton>

        <span
          style={{
            width: 1,
            height: 18,
            background: 'var(--color-border-secondary)',
            margin: '0 var(--space-xs)',
          }}
        />

        <div style={{ display: 'flex', gap: 2 }}>
          {PLAYBACK_SPEEDS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => onSpeed(option)}
              style={{
                padding: '3px 7px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-caption)',
                fontWeight: option === speed ? 600 : 400,
                background: option === speed ? 'var(--color-accent-muted)' : 'transparent',
                color: option === speed ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              }}
            >
              {`${num(option, option < 1 ? 2 : 0)}×`}
            </button>
          ))}
        </div>

        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 'var(--space-md)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>{`frame ${index + 1} / ${frameCount}`}</span>
          <span>{clipTime(t)}</span>
          <span title={vfr ? 'Variable frame rate — this is the average' : undefined}>
            {`${num(fps, 1)} fps${vfr ? ' (VFR)' : ''}`}
          </span>
        </span>
      </div>
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        color: 'var(--color-text-primary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
