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
import { Camera, Mic, Play, Plus, Square, Trash2 } from 'lucide-react';
import { VideoLightbox } from '../../components/planner/VideoLightbox';
import { kinemosObjectUrl } from '../lib/kinemosStorage';
import { formatTalkoverLength } from '../lib/talkover';
import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '../../components/ui';
import type { KinemosAnnotation, KinemosShare } from '../../lib/database.types';
import { formatDateTimeShort } from '../../lib/dateUtils';
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

  /** The marked knee's height above the bar's start, cm; null when there is
   *  no mark, or no calibration or track to measure it against. */
  kneeCm?: number | null;
  kneeMarked?: boolean;

  annotations: KinemosAnnotation[];
  /** Handing this rep to its athlete. Null before there is an analysis to
   *  share. */
  share?: ShareState | null;
  /** Recording the coach over the scrubbed lift. Absent where the browser
   *  cannot record. */
  talkover?: TalkoverState | null;
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
  /** Track the whole clip as a set and make a rep of each lift. Absent
   *  until there is an anchor and a calibration to size the plate by. */
  onTrackSet?: () => void;
  /** What the last set track said, in the coach's terms. */
  setNote?: string | null;
  /** Follow a high-contrast marker on the bar end instead of the plate —
   *  design §6.2's tighter tier. Absent until there is an anchor. */
  onTrackMarker?: () => void;
}

export interface ShareState {
  /** Who the rep goes to — the clip's athlete. Null when the clip has none. */
  athleteName: string | null;
  /** Earlier shares of this rep, newest first. */
  shares: KinemosShare[];
  busy: boolean;
  /** What the last share said, in the coach's terms. */
  note: string | null;
  /** Whether there is anything to send yet — a track and a calibration. */
  ready: boolean;
  onShare: (message: string) => void;
  onDelete: (shareId: string) => void;
  /** The clip with the bar path burned in, as a file — for outside EMOS. */
  onExport: () => void;
  exporting: { done: number; total: number } | null;
  exportNote: string | null;
  /** Whether the rep has a talkover that the next share will carry. */
  talkoverIncluded: boolean;
  /** The other coaches in this environment — the club channel's recipients. */
  colleagues: Array<{ id: string; name: string }>;
  onShareWithCoach: (coachId: string, message: string) => void;
}

export interface TalkoverState {
  recording: boolean;
  /** performance.now() the recording started, for the running clock. */
  startedAt: number | null;
  /** Stopping: the file is being stored. */
  busy: boolean;
  note: string | null;
  onToggle: () => void;
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
  kneeCm = null,
  kneeMarked = false,
  annotations,
  share = null,
  talkover = null,
  onAddNote,
  onSnapshot,
  onDeleteAnnotation,
  snapshotBusy,
  tracking,
}: ReadoutRailProps) {
  const [noteDraft, setNoteDraft] = useState('');
  const [shareDraft, setShareDraft] = useState('');
  const [colleagueId, setColleagueId] = useState('');
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  // A clock for the recording in progress: re-render once a second while it
  // runs, nothing otherwise.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!talkover?.recording) return;
    const id = window.setInterval(() => setTick(n => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [talkover?.recording]);
  const recordedS = talkover?.recording && talkover.startedAt !== null ? (performance.now() - talkover.startedAt) / 1000 : 0;
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
              {tracking.onTrackSet && (
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={tracking.onTrackSet}
                    title="Track the whole clip as a set: follow the plate through every rep, find it again after each drop, cut the track into reps at their rests, and make a rep of each with its own calibration. Loads OpenCV the first time, about 13 MB."
                  >
                    Track the set
                  </Button>
                  {tracking.onTrackMarker && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={tracking.onTrackMarker}
                      title="Follow a high-contrast marker on the bar end instead of the plate. A sticker nothing else in the gym shares gives a centroid about twice as tight as the plate template — the tier the grade calls 0,4 px. Click the marker first, then this."
                      style={{ marginLeft: 'var(--space-xs)' }}
                    >
                      Track a marker
                    </Button>
                  )}
                  {tracking.setNote && <p style={hint}>{tracking.setNote}</p>}
                </div>
              )}
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

      {/* ── Knee height ─────────────────────────────────────────────────── */}
      {tool === 'knee' && (
        <section style={section}>
          <header style={header}>
            <span style={label}>KNEE</span>
          </header>
          <p style={hint}>
            {kneeMarked
              ? 'Click again to move it. The line on the frame is the knee height; the charts mark where the bar crosses it.'
              : 'Click the athlete’s knee on the start frame, with the bar on the floor. V1 and V2 are defined around the knee — this is how to check the phase edges against it.'}
          </p>
          <div
            style={{
              fontSize: 'var(--text-section)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text-primary)',
            }}
          >
            {kneeCm === null ? (kneeMarked ? 'marked — calibrate and mark the bar to measure it' : '—') : `${num(kneeCm, 1)} cm above the bar`}
          </div>
        </section>
      )}

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

      {/* ── Share ───────────────────────────────────────────────────────── */}
      {share && (
        <section style={section}>
          <header style={header}>
            <span style={label}>SHARE</span>
          </header>
          {share.athleteName === null ? (
            <p style={hint}>This clip has no athlete. Attach one in the library and the rep can be sent to them; the export below works either way.</p>
          ) : !share.ready ? (
            <p style={hint}>Track and calibrate the rep first — the athlete gets this frame with the bar path, and the numbers.</p>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault();
                share.onShare(shareDraft.trim());
                setShareDraft('');
              }}
              style={{ display: 'grid', gap: 'var(--space-xs)' }}
            >
              <textarea
                value={shareDraft}
                onChange={e => setShareDraft(e.target.value)}
                placeholder={`A word to ${share.athleteName}… (optional)`}
                className="emos-input"
                rows={2}
                style={{ resize: 'vertical', fontSize: 'var(--text-caption)' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <Button size="sm" type="submit" disabled={share.busy}>
                  {share.busy ? 'Sending…' : `Send to ${share.athleteName}`}
                </Button>
                <span style={{ ...hint, margin: 0 }}>
                  {share.talkoverIncluded
                    ? 'This frame, the bar path, the numbers and the latest talkover, into their coach thread.'
                    : 'This frame, the bar path and the numbers, into their coach thread.'}
                </span>
              </div>
            </form>
          )}
          {share.ready && share.colleagues.length > 0 && (
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!colleagueId) return;
                share.onShareWithCoach(colleagueId, shareDraft.trim());
                setShareDraft('');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)' }}
            >
              <select
                value={colleagueId}
                onChange={e => setColleagueId(e.target.value)}
                className="emos-input"
                style={{ height: 28, fontSize: 'var(--text-caption)', flexGrow: 1, minWidth: 0 }}
                title="A colleague coach in this environment. The words above go with it; they find it on the video library under “Shared with you”."
              >
                <option value="">or a colleague…</option>
                {share.colleagues.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" type="submit" disabled={share.busy || !colleagueId}>
                Send
              </Button>
            </form>
          )}
          {share.note && <p style={hint}>{share.note}</p>}
          <div style={{ marginTop: 'var(--space-sm)' }}>
            {share.exporting ? (
              <>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((share.exporting.done / Math.max(1, share.exporting.total)) * 100)}%`,
                      background: 'var(--color-accent)',
                    }}
                  />
                </div>
                <p style={hint}>{`Writing the video — frame ${share.exporting.done} of ${share.exporting.total}.`}</p>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!share.ready}
                onClick={share.onExport}
                title="Download this clip with the bar path burned in — for a seminar, a post, anywhere outside EMOS. H.264 in MP4 where the browser can encode it, otherwise WebM."
              >
                Export video
              </Button>
            )}
            {share.exportNote && <p style={hint}>{share.exportNote}</p>}
          </div>
          {share.shares.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 'var(--space-xs) 0 0', padding: 0, display: 'grid', gap: 4 }}>
              {share.shares.map(s => (
                <li
                  key={s.id}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)' }}
                >
                  <span style={{ flexGrow: 1 }}>
                    {`Sent ${formatDateTimeShort(new Date(s.created_at))}`}
                    <span style={{ color: 'var(--color-text-tertiary)' }}>
                      {s.athlete_read_at ? ` · opened ${formatDateTimeShort(new Date(s.athlete_read_at))}` : ' · not opened yet'}
                    </span>
                  </span>
                  <button type="button" onClick={() => share.onDelete(s.id)} title="Take it back — removes the card from the athlete's thread" style={iconButton}>
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Annotations ─────────────────────────────────────────────────── */}
      <section style={section}>
        <header style={header}>
          <span style={label}>NOTES & SNAPSHOTS</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {talkover && (
              <button
                type="button"
                onClick={talkover.onToggle}
                disabled={talkover.busy}
                title={
                  talkover.recording
                    ? 'Stop the talkover and save it'
                    : 'Record a talkover: your voice and the lift as you scrub it, saved with this rep'
                }
                style={{
                  ...iconButton,
                  opacity: talkover.busy ? 0.5 : 1,
                  color: talkover.recording ? 'var(--color-danger-text)' : undefined,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {talkover.recording ? <Square size={12} /> : <Mic size={13} />}
                {talkover.recording && (
                  <span style={{ fontSize: 'var(--text-micro)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTalkoverLength(recordedS)}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onSnapshot}
              disabled={snapshotBusy}
              title="Save this frame with its overlays"
              style={{ ...iconButton, opacity: snapshotBusy ? 0.5 : 1 }}
            >
              <Camera size={13} />
            </button>
          </span>
        </header>
        {talkover?.recording && (
          <p style={{ ...hint, color: 'var(--color-danger-text)' }}>Recording — scrub, step and talk. Press the square to stop.</p>
        )}
        {talkover?.note && !talkover.recording && <p style={hint}>{talkover.note}</p>}

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
              {a.kind === 'talkover' && a.asset_key && (
                <button type="button" onClick={() => setPlayingKey(a.asset_key)} title="Play the talkover" style={iconButton}>
                  <Play size={12} />
                </button>
              )}
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
      {playingKey && (
        <VideoLightbox src={kinemosObjectUrl(playingKey)} caption="Talkover" onClose={() => setPlayingKey(null)} />
      )}
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
