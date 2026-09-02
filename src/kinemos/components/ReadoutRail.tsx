/**
 * ReadoutRail — the numbers, on the right, next to the video.
 *
 * Answering the design brief's first open question: the rail holds the numbers
 * and the stage stays whole. A coach judging a lift looks at the bar path far
 * more than at any figure, so the figures sit beside the video where a glance
 * reaches them without covering it.
 *
 * This section covers the GEOMETRY — what the marked path is, in centimetres
 * or in pixels, and what has been said about it. The measured quantities that
 * need the P2 pipeline behind them (velocity, phases, power) are `MetricsPanel`
 * below it, and how far to trust any of it is `GradePanel` below that. Three
 * panels rather than one because they answer three different questions and a
 * coach reads them at different moments.
 */
import { Camera, Plus, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Button } from '../../components/ui';
import type { KinemosAnnotation } from '../../lib/database.types';
import type { PathMetrics } from '../engine/calibration';
import { distance, drift, num } from '../lib/viewerFormat';
import type { ViewerTool } from './ViewerStage';

interface ReadoutRailProps {
  repIndices: number[];
  repIndex: number;
  onRep: (rep: number) => void;
  onAddRep: () => void;

  metrics: PathMetrics;
  markedHere: boolean;
  onDeleteMark: () => void;
  onClearMarks: () => void;

  tool: ViewerTool;
  measureValue: string | null;
  measureComplete: boolean;
  onSaveMeasurement: () => void;
  onClearMeasurement: () => void;

  annotations: KinemosAnnotation[];
  onAddNote: (body: string) => void;
  onSnapshot: () => void;
  onDeleteAnnotation: (id: string) => void;
  snapshotBusy: boolean;

  tracking: TrackingState;
}

/** Everything the rail needs to offer, and report on, assisted tracking. */
export interface TrackingState {
  /** False until there is an anchor to track from. */
  canTrack: boolean;
  /** Progress while a track runs, or null. */
  busy: { done: number; total: number } | null;
  tier: 'manual' | 'assisted';
  /** How many frames the tracker flagged, and how many the coach has fixed. */
  uncertainCount: number;
  correctionCount: number;
  onTrack: () => void;
  onNextUncertain: () => void;
}

export function ReadoutRail({
  repIndices,
  repIndex,
  onRep,
  onAddRep,
  metrics,
  markedHere,
  onDeleteMark,
  onClearMarks,
  tool,
  measureValue,
  measureComplete,
  onSaveMeasurement,
  onClearMeasurement,
  annotations,
  onAddNote,
  onSnapshot,
  onDeleteAnnotation,
  snapshotBusy,
  tracking,
}: ReadoutRailProps) {
  const [noteDraft, setNoteDraft] = useState('');
  const calibrated = metrics.calibrated;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Reps ────────────────────────────────────────────────────────── */}
      <section style={section}>
        <header style={header}>
          <span style={label}>REP</span>
          <button type="button" onClick={onAddRep} title="Add a rep" style={iconButton}>
            <Plus size={13} />
          </button>
        </header>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {repIndices.map(rep => (
            <button
              key={rep}
              type="button"
              onClick={() => onRep(rep)}
              style={{
                minWidth: 34,
                flexGrow: 1,
                padding: '5px 0',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-label)',
                fontWeight: rep === repIndex ? 600 : 400,
                background: rep === repIndex ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                color:
                  rep === repIndex ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
              }}
            >
              {rep}
            </button>
          ))}
        </div>
        <p style={hint}>
          One recording often holds several attempts; every rep keeps its own path and its own
          numbers.
        </p>
      </section>

      {/* ── Path ────────────────────────────────────────────────────────── */}
      <section style={section}>
        <header style={header}>
          <span style={label}>BAR PATH</span>
          {metrics.pointCount > 0 && (
            <button
              type="button"
              onClick={onClearMarks}
              title="Clear every mark"
              style={iconButton}
            >
              <Trash2 size={13} />
            </button>
          )}
        </header>

        {metrics.pointCount < 2 ? (
          <p style={hint}>
            {metrics.pointCount === 0
              ? 'No marks yet. Pick the Mark tool and click the bar end — the playhead steps forward on its own, so it is click, click, click.'
              : 'One mark down. Keep going — a path needs at least two.'}
          </p>
        ) : (
          <>
            {!calibrated && (
              <p style={{ ...hint, color: 'var(--color-warning-text)' }}>
                In pixels — no calibration yet.
              </p>
            )}
            <dl style={{ margin: 0, display: 'grid', gap: 2 }}>
              <Row term="Marks" value={String(metrics.pointCount)} />
              <Row term="Time marked" value={`${num(metrics.durationS, 2)} s`} />
              <Row term="Rise" value={distance(metrics.riseCm, calibrated)} />
              <Row
                term="Peak above start"
                value={distance(metrics.peakAboveStartCm, calibrated)}
                hint="Height gained from the first mark — meaningful when the first mark is the bar on the floor."
              />
              <Row
                term="Loop width"
                value={distance(metrics.loopWidthCm, calibrated)}
                hint="Total horizontal spread of the path, end to end."
              />
              <Row term="Finish" value={drift(metrics.netDriftCm, calibrated)} />
              <Row term="Path length" value={distance(metrics.pathLengthCm, calibrated)} />
            </dl>
          </>
        )}

        {markedHere && (
          <div style={{ marginTop: 'var(--space-sm)' }}>
            <Button size="sm" variant="ghost" onClick={onDeleteMark}>
              Remove the mark on this frame
            </Button>
          </div>
        )}

        {/* ── Assisted tracking ─────────────────────────────────────────── */}
        <div style={{ marginTop: 'var(--space-sm)' }}>
          {tracking.busy ? (
            <>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--color-bg-secondary)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round((tracking.busy.done / Math.max(1, tracking.busy.total)) * 100)}%`,
                    background: 'var(--color-accent)',
                  }}
                />
              </div>
              <p style={hint}>
                {`Following the bar — frame ${tracking.busy.done} of ${tracking.busy.total}.`}
              </p>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={tracking.tier === 'assisted' ? 'ghost' : 'secondary'}
                disabled={!tracking.canTrack}
                onClick={tracking.onTrack}
              >
                {tracking.tier === 'assisted'
                  ? 'Re-track from this frame'
                  : 'Track the bar from here'}
              </Button>
              <p style={hint}>
                {!tracking.canTrack
                  ? 'Mark the bar end once — the tracker follows it from there.'
                  : tracking.tier === 'assisted'
                    ? 'Correct a frame by marking it, then re-track: everything either side is redone from your point.'
                    : 'One mark is the anchor. The tracker fills in the rest of the clip, forwards and backwards.'}
              </p>
            </>
          )}

          {tracking.tier === 'assisted' && !tracking.busy && (
            <dl style={{ margin: 'var(--space-sm) 0 0', display: 'grid', gap: 2 }}>
              <Row
                term="Frames to check"
                value={String(tracking.uncertainCount)}
                hint="Frames the tracker was not confident about. They are marked on the scrub strip."
              />
              <Row term="Corrections" value={String(tracking.correctionCount)} />
            </dl>
          )}

          {tracking.tier === 'assisted' && !tracking.busy && tracking.uncertainCount > 0 && (
            <div style={{ marginTop: 4 }}>
              <Button size="sm" variant="ghost" onClick={tracking.onNextUncertain}>
                Jump to the next one
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Measurement ─────────────────────────────────────────────────── */}
      {(tool === 'distance' || tool === 'angle') && (
        <section style={section}>
          <header style={header}>
            <span style={label}>{tool === 'distance' ? 'DISTANCE' : 'ANGLE'}</span>
          </header>
          <p style={hint}>
            {tool === 'distance'
              ? 'Click two points on the frame.'
              : 'Click the two arms and then the vertex, in that order.'}
          </p>
          <div
            style={{
              fontSize: 'var(--text-section)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text-primary)',
            }}
          >
            {measureValue ?? '—'}
          </div>
          {measureComplete && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-xs)',
                marginTop: 'var(--space-sm)',
              }}
            >
              <Button size="sm" variant="secondary" onClick={onSaveMeasurement}>
                Keep it
              </Button>
              <Button size="sm" variant="ghost" onClick={onClearMeasurement}>
                Discard
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ── Annotations ─────────────────────────────────────────────────── */}
      <section style={section}>
        <header style={header}>
          <span style={label}>NOTES & SNAPSHOTS</span>
          <button
            type="button"
            onClick={onSnapshot}
            disabled={snapshotBusy}
            title="Save this frame with its overlays"
            style={{ ...iconButton, opacity: snapshotBusy ? 0.5 : 1 }}
          >
            <Camera size={13} />
          </button>
        </header>

        {annotations.length === 0 && <p style={hint}>Nothing saved for this rep yet.</p>}
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 6,
          }}
        >
          {annotations.map(a => (
            <li
              key={a.id}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'flex-start',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-tertiary)',
                  fontSize: 'var(--text-micro)',
                  textTransform: 'uppercase',
                }}
              >
                {a.kind}
              </span>
              <span style={{ flexGrow: 1, lineHeight: 1.35 }}>
                {a.body || (a.frame_index !== null ? `frame ${a.frame_index + 1}` : '—')}
              </span>
              <button
                type="button"
                onClick={() => onDeleteAnnotation(a.id)}
                title="Delete"
                style={iconButton}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={e => {
            e.preventDefault();
            const body = noteDraft.trim();
            if (!body) return;
            onAddNote(body);
            setNoteDraft('');
          }}
          style={{
            marginTop: 'var(--space-sm)',
            display: 'flex',
            gap: 'var(--space-xs)',
          }}
        >
          <input
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="Note on this frame…"
            className="emos-input"
            style={{
              flexGrow: 1,
              minWidth: 0,
              height: 28,
              fontSize: 'var(--text-caption)',
            }}
          />
          <Button size="sm" variant="secondary" type="submit">
            Add
          </Button>
        </form>
      </section>
    </div>
  );
}

function Row({ term, value, hint: title }: { term: string; value: string; hint?: string }) {
  return (
    <div style={rowStyle} title={title}>
      <dt
        style={{
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {term}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--text-label)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const section: CSSProperties = {
  padding: 'var(--space-md)',
  borderBottom: '1px solid var(--color-border-tertiary)',
};

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 'var(--space-sm)',
};

const label: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const hint: CSSProperties = {
  margin: 'var(--space-sm) 0 0',
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
};

const iconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--color-text-tertiary)',
  cursor: 'pointer',
};
