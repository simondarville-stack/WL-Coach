/**
 * messageTags — the one place that knows how a tagged comment is shaped.
 *
 * A coach reviewing a training log tags a comment to the thing it is about:
 * one exercise the athlete logged, or one metric they entered (bodyweight,
 * RAW, VAS, a custom metric, the session RPE…). Two representations, kept in
 * step by this module:
 *
 *   - the message TEXT carries each tag as a plain `@Label` token
 *     (`@Snatch looked slow on set 3`), so any surface that ignores tags
 *     still reads correctly — old clients, thread previews, notifications;
 *   - the message ROW carries the structure (`tags`, a `MessageTag[]`), so a
 *     tag-aware surface can highlight the token and file the comment under
 *     the row or metric it names.
 *
 * Pure: no React, no Supabase. The composer (src/components/review/
 * TagComposer.tsx) and every renderer go through these helpers rather than
 * re-deriving the token grammar.
 */
import type { MessageTag, TrainingLogMessage } from './database.types';
import type { ReviewSessionItem } from './reviewFeedService';

/** One thing the coach can tag on a card: the tag it produces plus a hint
 *  for the picker (a metric's value, an exercise's status). */
export interface TagTarget {
  tag: MessageTag;
  hint: string | null;
}

/** Longest mention query the `@` picker keeps open for. Past this the coach
 *  is writing prose, not looking for a target. */
export const MENTION_QUERY_MAX = 40;

// ─── Reading tags off a row ────────────────────────────────────────────────

function isMessageTag(x: unknown): x is MessageTag {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  if (typeof t.label !== 'string' || t.label === '') return false;
  if (t.kind === 'exercise') return typeof t.logExerciseId === 'string';
  if (t.kind === 'metric') return typeof t.key === 'string';
  return false;
}

/**
 * Safe read of a message's tags. Rows written before the column existed
 * (no field), nulls, and anything malformed all read as "no tags" — a bad
 * row must never take a thread down.
 */
export function messageTags(m: Pick<TrainingLogMessage, 'tags'>): MessageTag[] {
  const raw = m.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isMessageTag);
}

/** The token a tag appears as in the text. */
export function tagToken(tag: Pick<MessageTag, 'label'>): string {
  return `@${tag.label}`;
}

/** Stable identity for keys and de-duplication. */
export function tagId(tag: MessageTag): string {
  return tag.kind === 'exercise' ? `exercise:${tag.logExerciseId}` : `metric:${tag.key}`;
}

/** True when the message is tagged to this logged exercise. */
export function isTaggedToExercise(
  m: Pick<TrainingLogMessage, 'tags'>,
  logExerciseId: string,
): boolean {
  return messageTags(m).some(t => t.kind === 'exercise' && t.logExerciseId === logExerciseId);
}

// ─── Targets: what a session card offers to tag ────────────────────────────

/** A label has to survive as a token: no `@`, no line breaks, single
 *  spaces, non-empty. */
export function sanitizeLabel(label: string): string {
  return label.replace(/[@\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Labels must be unique within one card, or `@Snatch` could not say which
 * of two snatch rows it means. The second and later duplicates get a
 * counter: `Snatch`, `Snatch (2)`. Case-sensitive on purpose — the token
 * match is too.
 */
export function dedupeLabels(targets: TagTarget[]): TagTarget[] {
  const seen = new Map<string, number>();
  return targets.map(t => {
    const base = sanitizeLabel(t.tag.label) || 'Item';
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const label = n === 1 ? base : `${base} (${n})`;
    return { ...t, tag: { ...t.tag, label } };
  });
}

/** German-locale comma decimals, as on the session card. */
function fmtNum(n: number): string {
  return String(n).replace('.', ',');
}

/**
 * Everything a coach can tag on a completed-session card, exercises first
 * (in session order), then the metrics the athlete was asked for, then the
 * session-level fields that carry a value. Metric keys mirror the card's
 * chips so a tag and the chip it came from agree.
 */
export function sessionTagTargets(item: ReviewSessionItem): TagTarget[] {
  const exercises: TagTarget[] = item.exercises.map(ex => ({
    tag: { kind: 'exercise', logExerciseId: ex.id, label: ex.name },
    hint: ex.status === 'completed' ? null : ex.status.replace('_', ' '),
  }));
  const metrics: TagTarget[] = item.metrics.map(m => ({
    tag: { kind: 'metric', key: m.key, label: m.label, value: m.value },
    hint: m.value ?? 'not entered',
  }));
  const s = item.session;
  if (s.session_rpe != null) {
    const value = fmtNum(s.session_rpe);
    metrics.push({ tag: { kind: 'metric', key: 'rpe', label: 'RPE', value }, hint: value });
  }
  if (s.duration_minutes != null) {
    const value = `${s.duration_minutes} min`;
    metrics.push({ tag: { kind: 'metric', key: 'duration', label: 'Duration', value }, hint: value });
  }
  if (s.session_notes.trim() !== '') {
    const note = s.session_notes.trim();
    metrics.push({
      tag: { kind: 'metric', key: 'notes', label: 'Notes', value: null },
      hint: note.length > 40 ? `${note.slice(0, 39)}…` : note,
    });
  }
  return dedupeLabels([...exercises, ...metrics]);
}

/**
 * Picker filtering: case-insensitive, label starts-with first, then
 * contains — `sn` lists `Snatch` above `Power Snatch`. Empty query keeps the
 * card's own order.
 */
export function filterTagTargets(targets: TagTarget[], query: string): TagTarget[] {
  const q = query.trim().toLowerCase();
  if (q === '') return targets;
  const starts: TagTarget[] = [];
  const contains: TagTarget[] = [];
  for (const t of targets) {
    const label = t.tag.label.toLowerCase();
    if (label.startsWith(q)) starts.push(t);
    else if (label.includes(q)) contains.push(t);
  }
  return [...starts, ...contains];
}

// ─── The token grammar ─────────────────────────────────────────────────────

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; tag: MessageTag; token: string };

/** `@Label` at position i, and not the head of a longer word — `@Snatch`
 *  must not fire inside `@Snatches`. */
function tokenAt(text: string, i: number, label: string): boolean {
  if (!text.startsWith(`@${label}`, i)) return false;
  const next = text[i + 1 + label.length];
  return next === undefined || !/[\p{L}\p{N}]/u.test(next);
}

/**
 * Split a message into plain text and the tag tokens found in it. Longest
 * label wins where two could match (`@Snatch Pull` before `@Snatch`). A tag
 * whose token is not in the text produces no segment — the renderer shows
 * those as a leading chip row instead.
 */
export function splitMessageByTags(text: string, tags: MessageTag[]): MessageSegment[] {
  if (tags.length === 0 || text === '') return [{ kind: 'text', text }];
  const byLength = [...tags].sort((a, b) => b.label.length - a.label.length);
  const segments: MessageSegment[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      const hit = byLength.find(t => tokenAt(text, i, t.label));
      if (hit) {
        if (buf !== '') {
          segments.push({ kind: 'text', text: buf });
          buf = '';
        }
        const token = tagToken(hit);
        segments.push({ kind: 'tag', tag: hit, token });
        i += token.length;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  if (buf !== '') segments.push({ kind: 'text', text: buf });
  return segments;
}

/** The tags whose token appears in the text, each once, in first-appearance
 *  order. This is what a send stores: delete the `@Snatch` from the text and
 *  the tag is gone with it — the text is the source of truth. */
export function tagsInText(text: string, tags: MessageTag[]): MessageTag[] {
  const out: MessageTag[] = [];
  const seen = new Set<string>();
  for (const seg of splitMessageByTags(text, tags)) {
    if (seg.kind !== 'tag') continue;
    const id = tagId(seg.tag);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(seg.tag);
  }
  return out;
}

/** The text is nothing but tags (and whitespace) — the coach has armed a
 *  target and written no words yet, so a quick reaction should carry it. */
export function isOnlyTags(text: string, tags: MessageTag[]): boolean {
  const segs = splitMessageByTags(text, tags);
  return (
    segs.some(s => s.kind === 'tag') &&
    segs.every(s => s.kind === 'tag' || s.text.trim() === '')
  );
}

// ─── Composer editing ──────────────────────────────────────────────────────

export interface MentionQuery {
  /** Index of the `@` that opened the query. */
  start: number;
  /** What the coach has typed after it, up to the caret. */
  query: string;
}

/**
 * Is the caret inside an `@` mention being typed? The `@` must start the
 * text or follow whitespace (an email address does not open the picker),
 * and the query must be short and on one line.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX || /[\r\n]/.test(query)) return null;
  return { start: at, query };
}

/**
 * Replace `[start, end)` of the text with the tag's token and a trailing
 * space; a space is added in front too when the insertion would otherwise
 * glue onto a word (tapping a row mid-sentence). Returns the caret to place
 * after the insertion.
 */
export function insertMention(
  text: string,
  start: number,
  end: number,
  tag: Pick<MessageTag, 'label'>,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const insert = `${lead}${tagToken(tag)} `;
  return { text: before + insert + after, caret: before.length + insert.length };
}

/** Remove every `@Label` token of one tag from the text, along with the
 *  single space that followed it, so the sentence closes up. */
export function removeMention(text: string, tag: MessageTag): string {
  const segs = splitMessageByTags(text, [tag]);
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === 'text') {
      out += seg.text;
      continue;
    }
    const next = segs[i + 1];
    if (next && next.kind === 'text' && next.text.startsWith(' ')) {
      segs[i + 1] = { kind: 'text', text: next.text.slice(1) };
    }
  }
  return out;
}
