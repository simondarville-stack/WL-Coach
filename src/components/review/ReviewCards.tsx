/**
 * ReviewCards — the card renderers for the coach Review feed scroller.
 *
 * Three card kinds share one visual frame (dark stage, phone-width column):
 *   VideoCard   — full-bleed clip, autoplays while in view
 *   ThreadCard  — unread athlete question(s), reply inline
 *   SessionCard — completed-session summary (performed work via StackedNotation)
 *
 * Every card carries a ComposeBar: quick-reaction chips + a comment box that
 * posts into the existing athlete-visible message thread.
 */
import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  MessageCircle,
  Send,
  Video,
} from 'lucide-react';
import type { Athlete, GppSection } from '../../lib/database.types';
import type {
  ReviewSessionItem,
  ReviewThreadItem,
  ReviewVideoItem,
} from '../../lib/reviewFeedService';
import { LoggedStackedNotation, StackedNotation } from '../planner/StackedNotation';
import { ScrubPlayer } from '../planner/ScrubPlayer';
import { VideoThumb } from '../planner/VideoThumb';
import { formatDateShort } from '../../lib/dateUtils';
import { isStreamPlaybackUrl } from '../../lib/streamUploads';

// Quick reactions are coach-defined (Settings → Review); the defaults live in
// src/lib/reviewSettings.ts and ReviewScroller passes the resolved list down.

// ─── Shared bits ───────────────────────────────────────────────────────────

function AthleteBadge({ athlete, context }: { athlete: Athlete | undefined; context: string }) {
  const name = athlete?.name ?? 'Unknown athlete';
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {athlete?.photo_url ? (
        <img
          src={athlete.photo_url}
          alt=""
          className="w-8 h-8 rounded-full object-cover border border-white/20"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center text-sm font-medium">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-medium text-white truncate">{name}</div>
        <div className="text-[11px] text-white/60 truncate">{context}</div>
      </div>
    </div>
  );
}

function SeenDot({ seen }: { seen: boolean }) {
  return seen ? (
    <span className="flex items-center gap-1 text-[11px] text-emerald-400/90">
      <Check size={12} /> seen
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[11px] text-sky-300">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" /> new
    </span>
  );
}

interface ComposeBarProps {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  /** The coach's quick-reaction chips (Settings → Review). Empty = no chip
   *  row — a coach may deliberately run without reactions. */
  reactions?: string[];
  /** Hide the emoji chips (e.g. on question cards a bare 👍 is a non-answer). */
  showReactions?: boolean;
  /** Sends made outside this bar (keyboard quick reactions) — shown in the
   *  same "Sent:" confirmation list so the feedback lands on the card. */
  externalSent?: string[];
}

function ComposeBar({ placeholder, onSend, reactions = [], showReactions = true, externalSent }: ComposeBarProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = async (body: string) => {
    const trimmed = body.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(trimmed);
      setSent(prev => [...prev, trimmed]);
      setText('');
    } catch {
      setError('Send failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1.5">
      {[...(externalSent ?? []), ...sent].map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-emerald-300/90 px-1">
          <CheckCircle2 size={12} className="shrink-0" />
          <span className="truncate">Sent: {s}</span>
        </div>
      ))}
      {showReactions && reactions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reactions.map(r => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => void send(r)}
              className="px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-xs transition-colors disabled:opacity-50"
            >
              {r}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={e => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-white/10 text-white placeholder-white/40 text-sm rounded-full px-3.5 py-2 outline-none focus:bg-white/15 focus:ring-1 focus:ring-white/30"
        />
        <button
          type="submit"
          disabled={busy || text.trim() === ''}
          title="Send comment"
          className="w-9 h-9 shrink-0 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </form>
      {error && <div className="text-[11px] text-red-300 px-1">{error}</div>}
    </div>
  );
}

interface CardFrameProps {
  athlete: Athlete | undefined;
  context: string;
  seen: boolean;
  kindIcon: React.ReactNode;
  children: React.ReactNode;
  composer: ComposeBarProps;
  /** Rendered between the content and the composer (e.g. technique rating). */
  accessory?: React.ReactNode;
}

/** Common frame: header row, content area, composer pinned at the bottom. */
function CardFrame({ athlete, context, seen, kindIcon, children, composer, accessory }: CardFrameProps) {
  return (
    <div className="h-full flex flex-col px-3 py-3 gap-2">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <AthleteBadge athlete={athlete} context={context} />
        <div className="flex items-center gap-2 text-white/50">
          <SeenDot seen={seen} />
          {kindIcon}
        </div>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
      {accessory != null && <div className="shrink-0">{accessory}</div>}
      <div className="shrink-0">
        <ComposeBar {...composer} />
      </div>
    </div>
  );
}

// ─── Technique rating (1–5) ────────────────────────────────────────────────

/**
 * 1–5 technique rating, star-fill style: tap a number to rate, tap the
 * current rating again to clear. Optimistic — the value flips immediately
 * and rolls back if the write fails. Writes to
 * training_log_exercises.technique_rating via the onRate the caller wires.
 * Shown only when the coach has the feature enabled (Settings → Review).
 */
export function TechniqueRating({
  value,
  onRate,
  theme,
  label = true,
}: {
  value: number | null;
  onRate: (rating: number | null) => Promise<void>;
  theme: 'dark' | 'light';
  /** Show the "Technique" caption (off in dense per-exercise rows). */
  label?: boolean;
}) {
  const [current, setCurrent] = useState<number | null>(value);
  const [busy, setBusy] = useState(false);

  const rate = async (n: number) => {
    if (busy) return;
    const next = current === n ? null : n;
    const prev = current;
    setCurrent(next);
    setBusy(true);
    try {
      await onRate(next);
    } catch {
      setCurrent(prev);
    } finally {
      setBusy(false);
    }
  };

  const active = 'bg-[var(--color-accent)] text-white';
  const idle =
    theme === 'dark'
      ? 'bg-white/10 text-white/60 hover:bg-white/25'
      : 'bg-gray-100 text-gray-400 hover:bg-gray-200';

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span
          className={`text-[10px] mr-0.5 ${theme === 'dark' ? 'text-white/50' : 'text-gray-400'}`}
        >
          Technique
        </span>
      )}
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={busy}
          onClick={() => void rate(n)}
          title={current === n ? 'Clear technique rating' : `Rate technique ${n}/5`}
          aria-label={current === n ? 'Clear technique rating' : `Rate technique ${n} of 5`}
          className={`w-5 h-5 rounded-full text-[10px] font-medium tabular-nums leading-none transition-colors disabled:opacity-60 ${
            current != null && n <= current ? active : idle
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// ─── Video card ────────────────────────────────────────────────────────────

interface VideoCardProps {
  item: ReviewVideoItem;
  athlete: Athlete | undefined;
  seen: boolean;
  /** Card is the one currently in view — drives autoplay. */
  active: boolean;
  /** Card is the active one or its direct neighbour — the only cards that
   *  mount a real player. Everything further away renders a cheap poster,
   *  so a 20-clip queue doesn't fire 20 video downloads on load. */
  near: boolean;
  onComment: (text: string) => Promise<void>;
  /** The coach's quick-reaction chips. */
  reactions?: string[];
  /** Technique rating for the clip's exercise; null hides the control
   *  (feature toggled off in Settings → Review). */
  onRateTechnique?: ((rating: number | null) => Promise<void>) | null;
  /** Keyboard quick reactions already sent for this card. */
  externalSent?: string[];
}

export function VideoCard({
  item,
  athlete,
  seen,
  active,
  near,
  onComment,
  reactions,
  onRateTechnique,
  externalSent,
}: VideoCardProps) {
  // Mount the player the first time the card comes near the viewport and
  // keep it mounted after — scrolling back must not restart a buffered clip.
  const [playerMounted, setPlayerMounted] = useState(near);
  useEffect(() => {
    if (near) setPlayerMounted(true);
  }, [near]);

  const context = [
    item.exerciseName,
    item.video.set_number != null ? `set ${item.video.set_number}` : null,
    item.sessionDate ? formatDateShort(item.sessionDate) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <CardFrame
      athlete={athlete}
      context={context}
      seen={seen}
      kindIcon={<Video size={16} />}
      composer={{
        placeholder: `Comment on ${item.exerciseName}…`,
        onSend: onComment,
        reactions,
        externalSent,
      }}
      accessory={
        onRateTechnique ? (
          <TechniqueRating
            value={item.techniqueRating}
            onRate={onRateTechnique}
            theme="dark"
          />
        ) : null
      }
    >
      <div className="relative h-full rounded-2xl overflow-hidden bg-black">
        {!playerMounted ? (
          // Far-offscreen card: poster only (stored JPEG when the clip has
          // one; the lazy fallback never triggers here because the card is
          // not near the viewport).
          <VideoThumb video={item.video} />
        ) : isStreamPlaybackUrl(item.video.video_url) ? (
          // Cloudflare Stream clip: the embed player streams adaptive HLS on
          // gym wifi. Autoplay-muted only while the card is in view, mirroring
          // the reel behaviour of the <video> branch.
          <iframe
            src={`${item.video.video_url}?muted=true&preload=metadata${active ? '&autoplay=true' : ''}`}
            title={item.exerciseName}
            allow="accelerometer; encrypted-media; picture-in-picture; fullscreen; autoplay"
            allowFullScreen
            className="w-full h-full border-0"
          />
        ) : (
          // Scrub player, reel-wired: autoplays muted while the card is in
          // view; tap pauses, sideways drag walks frames. Only the active
          // card buffers ahead — neighbours stop at metadata.
          <ScrubPlayer
            src={item.video.video_url}
            active={active}
            loop
            layout="fill"
            preload={active ? 'auto' : 'metadata'}
          />
        )}
        {item.video.description && (
          <div className="absolute bottom-12 left-2 right-2 text-xs text-white bg-black/50 rounded-lg px-2.5 py-1.5 pointer-events-none">
            {item.video.description}
          </div>
        )}
      </div>
    </CardFrame>
  );
}

// ─── Thread (question) card ────────────────────────────────────────────────

interface ThreadCardProps {
  item: ReviewThreadItem;
  athlete: Athlete | undefined;
  seen: boolean;
  onReply: (text: string) => Promise<void>;
}

export function ThreadCard({ item, athlete, seen, onReply }: ThreadCardProps) {
  const context = item.sessionId
    ? `Session ${item.sessionDate ? formatDateShort(item.sessionDate) : ''}`.trim()
    : 'Direct message';
  return (
    <CardFrame
      athlete={athlete}
      context={context}
      seen={seen}
      kindIcon={<MessageCircle size={16} />}
      composer={{ placeholder: 'Reply…', onSend: onReply, showReactions: false }}
    >
      <div className="h-full rounded-2xl bg-white/[0.06] border border-white/10 p-3 overflow-y-auto">
        <div className="text-[11px] uppercase tracking-wide text-white/40 mb-2">
          {item.newCount === 1 ? 'New message' : `${item.newCount} new messages`}
        </div>
        <div className="space-y-2">
          {/* Both sides of the conversation, every coach included — a
              co-coach's reply shows up here, not just your own. */}
          {item.messages.map(m =>
            m.senderType === 'athlete' ? (
              <div key={m.id} className="max-w-[90%]">
                <div className="bg-white text-gray-900 text-sm rounded-2xl rounded-tl-sm px-3 py-2 whitespace-pre-wrap">
                  {m.message}
                </div>
                <div className="text-[10px] text-white/40 mt-0.5 px-1">
                  {formatDateShort(m.createdAt)}{' '}
                  {new Date(m.createdAt).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            ) : (
              <div key={m.id} className="max-w-[90%] ml-auto flex flex-col items-end">
                <div className="bg-[var(--color-accent)] text-white text-sm rounded-2xl rounded-tr-sm px-3 py-2 whitespace-pre-wrap">
                  {m.message}
                </div>
                <div className="text-[10px] text-white/40 mt-0.5 px-1">
                  {m.coachName ?? 'Coach'} · {formatDateShort(m.createdAt)}{' '}
                  {new Date(m.createdAt).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {m.seenByAthlete && ' · Seen'}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </CardFrame>
  );
}

// ─── Session review card ───────────────────────────────────────────────────

const STATUS_GLYPH: Record<string, { glyph: string; cls: string }> = {
  completed: { glyph: '✓', cls: 'text-emerald-600' },
  skipped: { glyph: '✗', cls: 'text-red-500' },
  in_progress: { glyph: '●', cls: 'text-amber-500' },
  pending: { glyph: '○', cls: 'text-[color:var(--color-text-tertiary)]' },
};

interface SessionCardProps {
  item: ReviewSessionItem;
  athlete: Athlete | undefined;
  seen: boolean;
  onComment: (text: string) => Promise<void>;
  /** The coach's quick-reaction chips. */
  reactions?: string[];
  /** Keyboard quick reactions already sent for this card. */
  externalSent?: string[];
}

export function SessionCard({
  item,
  athlete,
  seen,
  onComment,
  reactions,
  externalSent,
}: SessionCardProps) {
  const s = item.session;
  const headerBits: string[] = [];
  if (s.session_rpe != null) headerBits.push(`RPE ${String(s.session_rpe).replace('.', ',')}`);
  if (s.duration_minutes != null) headerBits.push(`${s.duration_minutes} min`);

  return (
    <CardFrame
      athlete={athlete}
      context={`Session ${formatDateShort(s.date)}${s.session_label ? ` · ${s.session_label}` : ''}`}
      seen={seen}
      kindIcon={<ClipboardList size={16} />}
      composer={{ placeholder: 'Comment on this session…', onSend: onComment, reactions, externalSent }}
    >
      {/* Light panel so StackedNotation's token colours render as designed.
          data-theme="light" re-scopes the CSS tokens to their light values —
          without it, the dark coach app's token set leaks in and the
          notation renders near-white on the white card (unreadable). */}
      <div data-theme="light" className="h-full rounded-2xl bg-white overflow-y-auto">
        <div className="px-3.5 pt-3 pb-2 border-b border-gray-100 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-gray-900">Completed session</div>
          {headerBits.length > 0 && (
            <div className="text-[11px] text-gray-500">{headerBits.join(' · ')}</div>
          )}
        </div>
        {/* Metrics activated for this athlete/week — value or a quiet "—"
            when the athlete skipped the entry (that gap is itself signal). */}
        {item.metrics.length > 0 && (
          <div className="px-3.5 py-2 border-b border-gray-100 flex flex-wrap gap-1.5">
            {item.metrics.map(m => (
              <span
                key={m.key}
                className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[11px]"
              >
                <span className="text-gray-400">{m.label}</span>
                {m.value != null ? (
                  <span className="text-gray-800 font-medium tabular-nums">{m.value}</span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="divide-y divide-gray-50">
          {item.exercises.map(ex => {
            const st = STATUS_GLYPH[ex.status] ?? STATUS_GLYPH.pending;
            const performedSets = ex.sets.filter(set => set.status !== 'pending');
            const membersLine =
              ex.isCombo && ex.comboMembers.length > 0 ? ex.comboMembers.join(' + ') : null;
            return (
              <div key={ex.id} className="px-3.5 py-2 flex items-start gap-2.5">
                <span className={`text-xs mt-0.5 ${st.cls}`} title={ex.status}>
                  {st.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-gray-800 truncate">
                      {ex.name}
                    </span>
                    {ex.isCombo && (
                      <span
                        className="text-[10px] px-1 rounded bg-sky-50 text-sky-700 border border-sky-200"
                        title={membersLine ?? 'Combination exercise'}
                      >
                        combo
                      </span>
                    )}
                    {ex.gpp && (
                      <span className="text-[10px] text-gray-500 tabular-nums">
                        {ex.gpp.rows.filter(r => r.done).length}/{ex.gpp.rows.length} done
                      </span>
                    )}
                    {ex.offPlan && (
                      <span
                        className="text-[10px] px-1 rounded bg-amber-50 text-amber-700 border border-amber-200"
                        title="Added by the athlete — not in the plan"
                      >
                        off-plan
                      </span>
                    )}
                  </div>
                  {/* Combo members under the name, unless the name already IS
                      the joined member list. */}
                  {membersLine != null && membersLine !== ex.name && (
                    <div className="text-[11px] text-gray-500 truncate">{membersLine}</div>
                  )}
                  {/* What the athlete actually did, most specific source first:
                      GPP rows > logged sets > performed_raw fallback (in the
                      planned row's unit, so % prescriptions render as %). */}
                  {ex.gpp ? (
                    <GppStack gpp={ex.gpp} />
                  ) : performedSets.length > 0 ? (
                    <div className="mt-0.5">
                      <LoggedStackedNotation sets={ex.sets} />
                    </div>
                  ) : ex.performedRaw.trim() !== '' ? (
                    <div className="mt-0.5">
                      <StackedNotation
                        raw={ex.performedRaw}
                        unit={ex.unit ?? 'kg'}
                        isCombo={ex.isCombo || ex.performedRaw.includes('+')}
                      />
                    </div>
                  ) : null}
                  {ex.noteText && (
                    <div className="text-[12px] text-gray-600 mt-0.5 whitespace-pre-wrap">
                      {ex.noteText}
                    </div>
                  )}
                  {ex.performedNotes.trim() !== '' && (
                    <div className="text-[11px] text-gray-500 mt-0.5">{ex.performedNotes}</div>
                  )}
                </div>
              </div>
            );
          })}
          {item.exercises.length === 0 && (
            <div className="px-3.5 py-3 text-xs text-gray-400">No logged exercises.</div>
          )}
        </div>
        {s.session_notes.trim() !== '' && (
          <div className="px-3.5 py-2 border-t border-gray-100 text-xs text-gray-600">
            <span className="text-gray-400">Athlete notes:</span> {s.session_notes}
          </div>
        )}
        {/* Feedback already given — by ANY coach, so co-coaches on a shared
            athlete see each other's reactions before adding their own. */}
        {item.coachComments.length > 0 && (
          <div className="px-3.5 py-2 border-t border-gray-100 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">Coach comments</div>
            {item.coachComments.map(c => (
              <div key={c.id} className="flex items-start gap-1.5 text-xs">
                <span className="shrink-0 w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-semibold flex items-center justify-center mt-px">
                  {(c.coachName ?? 'C').charAt(0).toUpperCase()}
                </span>
                <span className="text-gray-700 whitespace-pre-wrap min-w-0">
                  <span className="text-gray-400">{c.coachName ?? 'Coach'}:</span> {c.message}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-400 tabular-nums">
                  {formatDateShort(c.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardFrame>
  );
}

/**
 * GPP rows in the stacked visual grammar: load above the rule, reps below,
 * set count to the right — same shape StackedNotation draws, hand-laid
 * because GPP rows are structured fields, not a prescription string.
 * Unticked rows render dimmed.
 */
function GppStack({ gpp }: { gpp: GppSection }) {
  // Tracks the same tokens as StackedNotation. This block is hand-laid rather
  // than reusing the component, so it has to be kept in step by hand — when
  // the notation moved to --text-notation this stayed on --text-caption and
  // rendered 2px smaller than the rows around it.
  const mono: React.CSSProperties = {
    fontFamily: 'var(--font-stacked)',
    fontSize: 'var(--text-notation)',
    color: 'var(--color-text-primary)',
    fontWeight: 500,
    lineHeight: 1.25,
  };
  return (
    <div className="mt-1 space-y-1">
      {gpp.description.trim() !== '' && (
        <div className="text-[11px] text-gray-500 italic whitespace-pre-wrap">{gpp.description}</div>
      )}
      {gpp.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={`text-[11px] ${r.done ? 'text-emerald-600' : 'text-[color:var(--color-text-tertiary)]'}`}>
            {r.done ? '✓' : '○'}
          </span>
          <span
            className="text-[length:var(--text-label)] flex-1 min-w-0 truncate"
            style={{ color: r.done ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
          >
            {r.exercise}
          </span>
          <div className="flex items-start gap-1 shrink-0">
            <div className="flex flex-col items-center min-w-[2rem]">
              <span style={mono}>{r.load.trim() !== '' ? r.load : 'BW'}</span>
              <div
                style={{ width: '100%', borderTop: '0.5px solid var(--color-border-primary)', margin: '1px 0' }}
              />
              <span style={mono}>{r.reps}</span>
            </div>
            {r.sets > 1 && (
              <span className="text-[11px] text-gray-500 font-medium self-center">{r.sets}</span>
            )}
          </div>
        </div>
      ))}
      {gpp.rows.length === 0 && <div className="text-[11px] text-gray-400 italic">No rows</div>}
    </div>
  );
}

// ─── End card ──────────────────────────────────────────────────────────────

export function EndCard({
  total,
  historyStatus,
  historyCount,
  historyComplete,
  onBackToTop,
}: {
  total: number;
  /** Lazy history load behind this card: idle (not reached yet), loading,
   *  ready (cards below), or empty (nothing reviewed in the window). */
  historyStatus: 'idle' | 'loading' | 'ready' | 'empty';
  historyCount: number;
  /** No deeper pages left — history below is everything there is. */
  historyComplete: boolean;
  onBackToTop: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
        <Check size={28} />
      </div>
      <div className="text-lg font-medium text-white">All caught up</div>
      <div className="text-sm text-white/60">
        {total === 0
          ? 'Nothing new from your athletes right now.'
          : `You have reviewed all ${total} new item${total === 1 ? '' : 's'}.`}
      </div>
      <div className="text-sm text-white/50 flex flex-col items-center gap-1">
        {historyStatus === 'loading' || historyStatus === 'idle' ? (
          <span>Loading history…</span>
        ) : historyStatus === 'ready' ? (
          <>
            <span>
              Keep scrolling for history — {historyCount}
              {historyComplete ? '' : '+'} reviewed item
              {historyCount === 1 ? '' : 's'}, newest first.
            </span>
            <ChevronDown size={16} className="text-white/40 animate-bounce" />
          </>
        ) : (
          <span>No reviewed items in this window yet.</span>
        )}
      </div>
      {total > 0 && (
        <button
          type="button"
          onClick={onBackToTop}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-sm transition-colors"
        >
          <ChevronUp size={15} /> Back to top
        </button>
      )}
    </div>
  );
}
