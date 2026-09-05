/**
 * TagComposer — the review card's comment box, with `@` tagging.
 *
 * A coach reading a training log wants to say "the snatch was slow, the
 * bodyweight is fine" without writing the words "the snatch" and hoping the
 * athlete reads them against the right row. So: type `@` and the card's
 * exercises and metrics come up; pick one and `@Snatch ` lands in the text.
 * Tapping an exercise row or a metric chip on the card does the same through
 * `insertTarget`, which is the one-thumb path on the coach mobile app.
 *
 * The text is the source of truth. The chips above the box mirror the
 * tokens in it (src/lib/messageTags.ts owns the grammar); delete a token and
 * its chip goes, tap a chip's × and its token goes. What is sent is the text
 * plus the tags whose tokens are still in it.
 *
 * Keys: ↑/↓ walk the picker, Enter/Tab pick, Esc closes it; with the picker
 * closed Enter sends and Shift+Enter breaks a line — the same as the input it
 * replaces. The reel's own ↑/↓ and 1–9 shortcuts ignore keystrokes in a
 * textarea, so nothing here fights them.
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
import { Activity, AtSign, Dumbbell, X } from 'lucide-react';
import type { MessageTag } from '../../lib/database.types';
import {
  filterTagTargets,
  insertMention,
  mentionQueryAt,
  removeMention,
  tagId,
  tagsInText,
  type TagTarget,
} from '../../lib/messageTags';
import { AutoGrowTextarea } from '../ui';

export interface TagComposerHandle {
  /** Put a target's token into the draft at the caret (or the end) and focus. */
  insertTarget: (target: TagTarget) => void;
  focus: () => void;
}

interface TagComposerProps {
  value: string;
  onChange: (text: string) => void;
  /** What `@` can resolve to on this card. Empty = a plain textarea. */
  targets: TagTarget[];
  placeholder: string;
  disabled?: boolean;
  /** Enter (without Shift) — the caller decides whether the draft sends. */
  onSubmit: () => void;
}

export const TagComposer = forwardRef<TagComposerHandle, TagComposerProps>(function TagComposer(
  { value, onChange, targets, placeholder, disabled = false, onSubmit },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Caret to place once the controlled value has been re-rendered. */
  const pendingCaret = useRef<number | null>(null);
  /** The `@` position of a mention the coach picked or dismissed — the
   *  picker stays shut for that mention until the caret leaves it. */
  const dismissedStart = useRef<number | null>(null);

  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [index, setIndex] = useState(0);

  const allTags = useMemo(() => targets.map(t => t.tag), [targets]);
  const armed = useMemo(() => tagsInText(value, allTags), [value, allTags]);
  const matches = useMemo(
    () => (query ? filterTagTargets(targets, query.text) : []),
    [targets, query],
  );
  const open = query != null && matches.length > 0;

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
    (start: number, end: number, target: TagTarget) => {
      const next = insertMention(value, start, end, target.tag);
      pendingCaret.current = next.caret;
      dismissedStart.current = start;
      setQuery(null);
      onChange(next.text);
      textareaRef.current?.focus();
    },
    [value, onChange],
  );

  const pick = useCallback(
    (target: TagTarget) => {
      if (!query) return;
      const caret = textareaRef.current?.selectionStart ?? value.length;
      applyInsert(query.start, caret, target);
    },
    [query, value.length, applyInsert],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertTarget: target => {
        const el = textareaRef.current;
        const caret = el && document.activeElement === el ? el.selectionStart : value.length;
        applyInsert(caret, caret, target);
      },
      focus: () => textareaRef.current?.focus(),
    }),
    [applyInsert, value.length],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(i => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(i => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(index, matches.length - 1)]);
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
    onChange(removeMention(value, tag));
    textareaRef.current?.focus();
  };

  /** The `@` button: start a mention at the caret so the whole list shows. */
  const openPicker = () => {
    const el = textareaRef.current;
    const caret = el && document.activeElement === el ? el.selectionStart : value.length;
    const before = value.slice(0, caret);
    const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${lead}@${value.slice(caret)}`;
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
              @{tag.label}
              <button
                type="button"
                onClick={() => remove(tag)}
                title={`Remove @${tag.label}`}
                aria-label={`Remove @${tag.label}`}
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
          aria-label="Tag an exercise or metric"
          className="absolute bottom-full left-0 right-0 mb-1 z-20 max-h-48 overflow-y-auto rounded-xl bg-neutral-900 border border-white/15 shadow-xl py-1"
        >
          {matches.map((t, i) => (
            <button
              key={tagId(t.tag)}
              type="button"
              role="option"
              aria-selected={i === index}
              // mousedown would blur the textarea and close the picker before
              // the click landed.
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(t)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                i === index ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              {t.tag.kind === 'exercise' ? (
                <Dumbbell size={12} className="shrink-0 text-white/50" aria-hidden />
              ) : (
                <Activity size={12} className="shrink-0 text-white/50" aria-hidden />
              )}
              <span className="truncate font-medium">{t.tag.label}</span>
              {t.hint && (
                <span className="ml-auto shrink-0 text-[11px] text-white/45 tabular-nums truncate max-w-[45%]">
                  {t.hint}
                </span>
              )}
            </button>
          ))}
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
            title="Tag an exercise or metric (or type @)"
            aria-label="Tag an exercise or metric"
            className="h-9 w-9 shrink-0 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white flex items-center justify-center disabled:opacity-40"
          >
            <AtSign size={15} />
          </button>
        )}
      </div>
    </div>
  );
});
