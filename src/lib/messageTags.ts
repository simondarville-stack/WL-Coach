/**
 * messageTags — the one place that knows how a tagged comment is shaped.
 *
 * A coach reviewing a training log tags a comment to the thing it is about:
 * one exercise the athlete logged — optionally one set of it — or one metric
 * they entered (bodyweight, RAW, VAS, a custom metric, the session RPE…).
 * Two representations, kept in step by this module:
 *
 *   - the message TEXT carries each tag as a plain `#Label` token — a set as
 *     a path, `#Snatch/3` — so any surface that ignores tags still reads
 *     correctly: old clients, thread previews, notifications;
 *   - the message ROW carries the structure (`tags`, a `MessageTag[]`), so a
 *     tag-aware surface can highlight the token and file the comment under
 *     the row or metric it names.
 *
 * `#` and not `@`: a comment is *about* an exercise, not addressed to it,
 * and `@` stays free for people (a co-coach in a shared thread, later).
 *
 * Pure: no React, no Supabase. The composer (src/components/review/
 * TagComposer.tsx) and every renderer go through these helpers rather than
 * re-deriving the token grammar.
 */
import type { MessageTag, TrainingLogMessage, TrainingLogSet } from './database.types';
import type { ReviewSessionItem } from './reviewFeedService';

/** The character that opens a tag, in the text and in the picker. */
export const TAG_PREFIX = '#';

export type ExerciseTag = Extract<MessageTag, { kind: 'exercise' }>;

/** One logged set a coach can drill down to under an exercise target. */
export interface SetTarget {
  setNumber: number;
  /** What the set was: `80 × 3`, `85 × x` (missed), `not done`. */
  hint: string;
}

/** One thing the coach can tag on a card: the tag it produces plus a hint
 *  for the picker (a metric's value, an exercise's status), and the sets the
 *  picker can drill into when it is an exercise. */
export interface TagTarget {
  tag: MessageTag;
  hint: string | null;
  sets?: SetTarget[];
}

/** What `sessionTagTargets` reads off a card — a session card carries all
 *  three; a thread card bound to a session carries the same three. */
export type TagSource = Pick<ReviewSessionItem, 'session' | 'metrics' | 'exercises'>;

/** Longest mention query the picker keeps open for. Past this the coach is
 *  writing prose, not looking for a target. */
export const MENTION_QUERY_MAX = 40;

// ─── Reading tags off a row ────────────────────────────────────────────────

function isMessageTag(x: unknown): x is MessageTag {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  if (typeof t.label !== 'string' || t.label === '') return false;
  if (t.kind === 'exercise') {
    if (typeof t.logExerciseId !== 'string') return false;
    return (
      t.setNumber === undefined ||
      (typeof t.setNumber === 'number' && Number.isInteger(t.setNumber) && t.setNumber > 0)
    );
  }
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

/** The token a tag appears as in the text: `#Snatch`, `#Snatch/3`, `#BW`. */
export function tagToken(tag: MessageTag): string {
  const set = tag.kind === 'exercise' && tag.setNumber != null ? `/${tag.setNumber}` : '';
  return `${TAG_PREFIX}${tag.label}${set}`;
}

/** Stable identity for keys and de-duplication. A set tag is its own
 *  identity, distinct from the whole exercise. */
export function tagId(tag: MessageTag): string {
  if (tag.kind === 'metric') return `metric:${tag.key}`;
  return `exercise:${tag.logExerciseId}${tag.setNumber != null ? `/${tag.setNumber}` : ''}`;
}

/** True when the message is tagged to this logged exercise, as a whole or
 *  to one of its sets. */
export function isTaggedToExercise(
  m: Pick<TrainingLogMessage, 'tags'>,
  logExerciseId: string,
): boolean {
  return messageTags(m).some(t => t.kind === 'exercise' && t.logExerciseId === logExerciseId);
}

// ─── Targets: what a card offers to tag ────────────────────────────────────

/** A label has to survive as a token: no `#` (or `@`), no line breaks,
 *  single spaces, non-empty. A `/` may stay — tokens are matched whole, and
 *  the picker only reads a trailing `/digits` as a set path. */
export function sanitizeLabel(label: string): string {
  return label.replace(/[#@\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Labels must be unique within one card, or `#Snatch` could not say which
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

/** One logged set as the picker shows it. Terse on purpose: a menu row,
 *  not a prescription (which would be StackedNotation). */
function setHint(s: TrainingLogSet): string {
  if (s.status === 'pending') return 'not done';
  const load = s.performed_load != null ? fmtNum(s.performed_load) : '?';
  const reps =
    s.performed_text?.trim() ||
    (s.performed_reps != null ? String(s.performed_reps) : s.status === 'completed' ? '?' : 'x');
  const mark = s.status === 'completed' ? '' : s.status === 'failed' ? ' · missed' : ' · skipped';
  return `${load} × ${reps}${mark}`;
}

/**
 * Everything a coach can tag on a card, exercises first (in session order,
 * each carrying its logged sets to drill into), then the metrics the
 * athlete was asked for, then the session-level fields that carry a value.
 * Metric keys mirror the card's chips so a tag and the chip it came from
 * agree.
 */
export function sessionTagTargets(source: TagSource): TagTarget[] {
  const exercises: TagTarget[] = source.exercises.map(ex => {
    const sets = ex.sets
      .slice()
      .sort((a, b) => a.set_number - b.set_number)
      .map(s => ({ setNumber: s.set_number, hint: setHint(s) }));
    return {
      tag: { kind: 'exercise', logExerciseId: ex.id, label: ex.name },
      hint: ex.status === 'completed' ? null : ex.status.replace('_', ' '),
      ...(sets.length > 0 ? { sets } : {}),
    };
  });
  const metrics: TagTarget[] = source.metrics.map(m => ({
    tag: { kind: 'metric', key: m.key, label: m.label, value: m.value },
    hint: m.value ?? 'not entered',
  }));
  const s = source.session;
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

/** Every tag a card's targets can produce — each exercise whole and per set,
 *  each metric — so the tokens in a draft can be recognised. */
export function expandTagCandidates(targets: TagTarget[]): MessageTag[] {
  const out: MessageTag[] = [];
  for (const t of targets) {
    out.push(t.tag);
    if (t.tag.kind === 'exercise') {
      for (const s of t.sets ?? []) out.push({ ...t.tag, setNumber: s.setNumber });
    }
  }
  return out;
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

// ─── The picker: rows for a query, with set paths ──────────────────────────

export interface MentionPath {
  /** The exercise part of the query (the whole query when there is no path). */
  exercise: string;
  /** Digits typed after the `/`, `''` right after it, null when no path. */
  set: string | null;
}

/** `sn` → no path; `sn/` → Snatch's sets; `sn/3` → set 3. A `/` followed by
 *  anything but digits is part of a label (`Clean/Jerk`), not a path. */
export function parseMentionPath(query: string): MentionPath {
  const slash = query.lastIndexOf('/');
  if (slash < 0) return { exercise: query, set: null };
  const after = query.slice(slash + 1);
  if (after !== '' && !/^\d+$/.test(after)) return { exercise: query, set: null };
  return { exercise: query.slice(0, slash), set: after };
}

export interface PickerRow {
  /** The tag that goes into the draft when this row is picked. */
  tag: MessageTag;
  /** What the row shows: `Snatch`, `Snatch/3`, `BW`. */
  label: string;
  hint: string | null;
  icon: 'exercise' | 'metric' | 'set';
  /** This exercise has sets to drill into (`→`, or the `/` key). */
  drillable: boolean;
}

function hasSets(t: TagTarget): t is TagTarget & { tag: ExerciseTag; sets: SetTarget[] } {
  return t.tag.kind === 'exercise' && (t.sets?.length ?? 0) > 0;
}

/**
 * The rows the picker shows for a query. Without a path: the targets that
 * match. With one (`Snatch/`, `sn/2`): the exercise the path names — an
 * exact label wins over a prefix — and its sets, the whole exercise first
 * when no set digits have been typed yet.
 */
export function pickerRows(targets: TagTarget[], query: string): PickerRow[] {
  const path = parseMentionPath(query);
  if (path.set === null) {
    return filterTagTargets(targets, path.exercise).map(t => ({
      tag: t.tag,
      label: t.tag.label,
      hint: t.hint,
      icon: t.tag.kind,
      drillable: hasSets(t),
    }));
  }
  const withSets = targets.filter(hasSets);
  const wanted = path.exercise.trim().toLowerCase();
  const exact = withSets.filter(t => t.tag.label.toLowerCase() === wanted);
  const matched = exact.length > 0 ? exact : filterTagTargets(withSets, path.exercise).filter(hasSets);
  const rows: PickerRow[] = [];
  for (const t of matched) {
    if (path.set === '') {
      rows.push({ tag: t.tag, label: t.tag.label, hint: 'whole exercise', icon: 'exercise', drillable: false });
    }
    for (const s of t.sets) {
      if (path.set !== '' && !String(s.setNumber).startsWith(path.set)) continue;
      rows.push({
        tag: { ...t.tag, setNumber: s.setNumber },
        label: `${t.tag.label}/${s.setNumber}`,
        hint: s.hint,
        icon: 'set',
        drillable: false,
      });
    }
  }
  return rows;
}

// ─── The token grammar ─────────────────────────────────────────────────────

export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; tag: MessageTag; token: string };

/** The whole token at position i, and not the head of a longer word —
 *  `#Snatch` must not fire inside `#Snatches`. */
function tokenAt(text: string, i: number, token: string): boolean {
  if (!text.startsWith(token, i)) return false;
  const next = text[i + token.length];
  return next === undefined || !/[\p{L}\p{N}]/u.test(next);
}

/**
 * Split a message into plain text and the tag tokens found in it. Longest
 * token wins where two could match (`#Snatch/3` before `#Snatch`, `#Snatch
 * Pull` before `#Snatch`). A tag whose token is not in the text produces no
 * segment — the renderer shows those as a leading chip row instead.
 */
export function splitMessageByTags(text: string, tags: MessageTag[]): MessageSegment[] {
  if (tags.length === 0 || text === '') return [{ kind: 'text', text }];
  const byLength = tags
    .map(tag => ({ tag, token: tagToken(tag) }))
    .sort((a, b) => b.token.length - a.token.length);
  const segments: MessageSegment[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === TAG_PREFIX) {
      const hit = byLength.find(x => tokenAt(text, i, x.token));
      if (hit) {
        if (buf !== '') {
          segments.push({ kind: 'text', text: buf });
          buf = '';
        }
        segments.push({ kind: 'tag', tag: hit.tag, token: hit.token });
        i += hit.token.length;
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
 *  order. This is what a send stores: delete the `#Snatch` from the text and
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
  /** Index of the `#` that opened the query. */
  start: number;
  /** What the coach has typed after it, up to the caret. */
  query: string;
}

/**
 * Is the caret inside a `#` mention being typed? The `#` must start the
 * text or follow whitespace, and the query must be short and on one line.
 * (`set #3` in prose opens nothing useful: no target matches `3`, so the
 * picker stays hidden.)
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf(TAG_PREFIX);
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX || /[\r\n]/.test(query)) return null;
  return { start: at, query };
}

/** Replace `[start, end)` of the text, returning the caret after it. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  return { text: before + insert + text.slice(end), caret: before.length + insert.length };
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
  tag: MessageTag,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  return replaceRange(text, start, end, `${lead}${tagToken(tag)} `);
}

/** Remove every token of one tag from the text, along with the single
 *  space that followed it, so the sentence closes up. `others` are the
 *  draft's other candidate tags: with them in the tokeniser, removing
 *  `#Snatch` leaves a `#Snatch/3` in the same text alone. */
export function removeMention(text: string, tag: MessageTag, others: MessageTag[] = []): string {
  const id = tagId(tag);
  const segs = splitMessageByTags(text, [tag, ...others]);
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === 'text') {
      out += seg.text;
      continue;
    }
    if (tagId(seg.tag) !== id) {
      out += seg.token;
      continue;
    }
    const next = segs[i + 1];
    if (next && next.kind === 'text' && next.text.startsWith(' ')) {
      segs[i + 1] = { kind: 'text', text: next.text.slice(1) };
    }
  }
  return out;
}
