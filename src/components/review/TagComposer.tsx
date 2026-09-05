/**
 * TagComposer — the review card's comment box, with `#` tagging.
 *
 * A coach reading a training log wants to say "the snatch was slow, the
 * bodyweight is fine" without writing the words "the snatch" and hoping the
 * athlete reads them against the right row. So: type `#` and the card's
 * exercises and metrics come up; pick one and `#Snatch ` lands in the text.
 * Tapping an exercise row, a set column or a metric chip on the card does
 * the same through `insertTag`, which is the one-thumb path on the coach
 * mobile app.
 *
 * A set is a path under its exercise: `#Snatch/` lists the logged sets,
 * `#Snatch/3` names one. In the picker, → on an exercise row (or its ›)
 * drills into its sets and ← comes back out; the whole exercise stays the
 * first row, so the set is optional.
 *
 * The text is the source of truth. The chips above the box mirror the
 * tokens in it (src/lib/messageTags.ts owns the grammar); delete a token and
 * its chip goes, tap a chip's × and its token goes. What is sent is the text
 * plus the tags whose tokens are still in it.
 *
 * Keys: ↑/↓ walk the picker, Enter/Tab pick, → / ← drill in and out, Esc
 * closes it; with the picker closed Enter sends and Shift+Enter breaks a
 * line — the same as the input it replaces. The reel's own ↑/↓ and 1–9
 * shortcuts ignore keystrokes in a textarea, so nothing here fights them.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Activity, ChevronRight, Dumbbell, Hash, Layers, X } from 'lucide-react';
import type { MessageTag } from '../../lib/database.types';
import {
  TAG_PREFIX,
  expandTagCandidates,
  insertMention,
  mentionQueryAt,
  parseMentionPath,
  pickerRows,
  removeMention,
  replaceRange,
  tagId,
  tagToken,
  tagsInText,
  type PickerRow,
  type TagTarget,
} from '../../lib/messageTags';
import { AutoGrowTextarea } from '../ui';

export interface TagComposerHandle {
  /** Put a tag's token into the draft at the caret (or the end) and focus. */
  insertTag: (tag: MessageTag) => void;
  focus: () => void;
}

interface TagComposerProps {
  value: string;
  onChange: (text: string) => void;
  /** What `#` can resolve to on this card. Empty = a plain textarea. */
  targets: TagTarget[];
  placeholder: string;
  disabled?: boolean;
  /** Enter (without Shift) — the caller decides whether the draft sends. */
  onSubmit: () => void;
}

const ROW_ICON = {
  exercise: Dumbbell,
  set: Layers,
  metric: Activity,
} as const;

export const TagComposer = forwardRef<TagComposerHandle, TagComposerProps>(function TagComposer(
  { value, onChange, targets, placeholder, disabled = false, onSubmit },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Caret to place once the controlled value has been re-rendered. */
  const pendingCaret = useRef<number | null>(null);
  /** The `#` position of a mention the coach picked or dismissed — the
   *  picker stays shut for that mention until the caret leaves it. */
  const dismissedStart = useRef<number | null>(null);

  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [index, setIndex] = useState(0);

  const allTags = useMemo(() => expandTagCandidates(targets), [targets]);
  const armed = useMemo(() => tagsInText(value, allTags), [value, allTags]);
  const rows = useMemo<PickerRow[]>(
    () => (query ? pickerRows(targets, query.text) : []),
    [targets, query],
  );
  const open = query != null && rows.length > 0;

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = textareaRef.current;
    if (caret == null || !el) return;
    pendingCaret.current = null;
    el.setSelectionRange(caret, caret);
  }, [value]);

  // Keep the active row in view as ↑/↓ walk a long list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    // Optional call: jsdom (the test runner) has no scrollIntoView.
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [open, index]);

  /** Re-derive the picker from the text and the caret. */
  const sync = useCallback(
    (text: string, caret: number) => {
      if (targets.length === 0) {
        setQuery(null);
        return;
      }
      const q = mentionQueryAt(text, caret);
      if (!q || q.start === dismissedStart.current) {
        if (!q) dismissedStart.current = null;
        setQuery(null);
        return;
      }
      setQuery(prev => {
        if (prev && prev.start === q.start && prev.text === q.query) return prev;
        setIndex(0);
        return { start: q.start, text: q.query };
      });
    },
    [targets.length],
  );

  const applyInsert = useCallback(
    (start: number, end: number, tag: MessageTag) => {
      const next = insertMention(value, start, end, tag);
      pendingCaret.current = next.caret;
      dismissedStart.current = start;
      setQuery(null);
      onChange(next.text);
      textareaRef.current?.focus();
    },
    [value, onChange],
  );

  const caretNow = () => textareaRef.current?.selectionStart ?? value.length;

  const pick = useCallback(
    (row: PickerRow) => {
      if (!query) return;
      applyInsert(query.start, caretNow(), row.tag);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caretNow reads a ref
    [query, applyInsert],
  );

  /** Rewrite the mention being typed to `#Label/` so the sets list, or back
   *  to `#Label` to leave it. The query re-derives from the new text. */
  const rewriteMention = useCallback(
    (raw: string) => {
      if (!query) return;
      const next = replaceRange(value, query.start, caretNow(), raw);
      pendingCaret.current = next.caret;
      dismissedStart.current = null;
      onChange(next.text);
      setQuery({ start: query.start, text: raw.slice(1) });
      setIndex(0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caretNow reads a ref
    [query, value, onChange],
  );

  const drillInto = (row: PickerRow) => rewriteMention(`${TAG_PREFIX}${row.tag.label}/`);

  useImperativeHandle(
    ref,
    () => ({
      insertTag: tag => {
        const el = textareaRef.current;
        const caret = el && document.activeElement === el ? el.selectionStart : value.length;
        applyInsert(caret, caret, tag);
      },
      focus: () => textareaRef.current?.focus(),
    }),
    [applyInsert, value.length],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      const active = rows[Math.min(index, rows.length - 1)];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(i => (i + 1) % rows.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(i => (i - 1 + rows.length) % rows.length);
        return;
      }
      if (e.key === 'ArrowRight' && active.drillable) {
        e.preventDefault();
        drillInto(active);
        return;
      }
      if (e.key === 'ArrowLeft' && query && parseMentionPath(query.text).set === '') {
        // Right after the `/`: back out to the exercise list.
        e.preventDefault();
        rewriteMention(`${TAG_PREFIX}${parseMentionPath(query.text).exercise}`);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (query) dismissedStart.current = query.start;
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const remove = (tag: MessageTag) => {
    onChange(removeMention(value, tag, allTags));
    textareaRef.current?.focus();
  };

  /** The `#` button: start a mention at the caret so the whole list shows. */
  const openPicker = () => {
    const el = textareaRef.current;
    const caret = el && document.activeElement === el ? el.selectionStart : value.length;
    const before = value.slice(0, caret);
    const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${lead}${TAG_PREFIX}${value.slice(caret)}`;
    const at = before.length + lead.length + 1;
    pendingCaret.current = at;
    dismissedStart.current = null;
    onChange(next);
    setQuery({ start: at - 1, text: '' });
    setIndex(0);
    el?.focus();
  };

  return (
    <div className="relative min-w-0 flex-1">
      {armed.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1 px-0.5">
          {armed.map(tag => (
            <span
              key={tagId(tag)}
              className="inline-flex items-center gap-0.5 rounded-full bg-sky-400/20 text-sky-100 text-[11px] font-medium pl-2 pr-1 py-0.5"
            >
              {tagToken(tag)}
              <button
                type="button"
                onClick={() => remove(tag)}
                title={`Remove ${tagToken(tag)}`}
                aria-label={`Remove ${tagToken(tag)}`}
                className="rounded-full p-0.5 hover:bg-white/20"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Tag an exercise, a set or a metric"
          className="absolute bottom-full left-0 right-0 mb-1 z-20 max-h-48 overflow-y-auto rounded-xl bg-neutral-900 border border-white/15 shadow-xl py-1"
        >
          {rows.map((row, i) => {
            const Icon = ROW_ICON[row.icon];
            return (
              <div
                key={tagId(row.tag)}
                role="option"
                aria-selected={i === index}
                // mousedown would blur the textarea and close the picker
                // before the click landed.
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(row)}
                className={`flex items-center gap-2 px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                  i === index ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10'
                }`}
              >
                <Icon size={12} className="shrink-0 text-white/50" aria-hidden />
                <span className="truncate font-medium">{row.label}</span>
                {row.hint && (
                  <span className="ml-auto shrink-0 text-[11px] text-white/45 tabular-nums truncate max-w-[45%]">
                    {row.hint}
                  </span>
                )}
                {row.drillable && (
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => {
                      e.stopPropagation();
                      drillInto(row);
                    }}
                    title={`Sets of ${row.label} (→)`}
                    aria-label={`Sets of ${row.label}`}
                    className={`shrink-0 rounded p-0.5 text-white/60 hover:bg-white/20 hover:text-white ${row.hint ? '' : 'ml-auto'}`}
                  >
                    <ChevronRight size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-end gap-1">
        <AutoGrowTextarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={e => {
            onChange(e.target.value);
            sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={e => sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
          style={{ maxHeight: '7rem' }}
          className="flex-1 min-w-0 bg-white/10 text-white placeholder-white/40 text-sm rounded-2xl px-3.5 py-2 outline-none focus:bg-white/15 focus:ring-1 focus:ring-white/30 leading-snug"
        />
        {targets.length > 0 && (
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            title="Tag an exercise, a set or a metric (or type #)"
            aria-label="Tag an exercise, a set or a metric"
            className="h-9 w-9 shrink-0 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white flex items-center justify-center disabled:opacity-40"
          >
            <Hash size={15} />
          </button>
        )}
      </div>
    </div>
  );
});
