/**
 * MessageText — a message body with its tags drawn as chips.
 *
 * The text is stored plain, `@Snatch looked slow on set 3`, and the row
 * carries the structure behind each `@Label` token (src/lib/messageTags.ts).
 * This draws the tokens as chips where they sit in the sentence, and a tag
 * whose token is not in the text (a legacy `📹 Snatch:` clip comment, an
 * edited message) as a chip row in front of it. Untagged messages render as
 * the bare string — no wrapper, no cost.
 *
 * One renderer for every thread surface — the athlete app, the coach inbox,
 * the field app, log mode, the review reel — so a tag looks the same
 * wherever the message is read. The parent bubble owns the text styling
 * (size, colour, `whitespace-pre-wrap`); the variant only picks a chip tint
 * that reads on that bubble.
 */
import { Fragment } from 'react';
import type { MessageTag } from '../../lib/database.types';
import { splitMessageByTags, tagId, tagsInText } from '../../lib/messageTags';

export type MessageTextVariant =
  /** Sitting on the accent-coloured "own message" bubble. */
  | 'on-accent'
  /** Sitting on a dark bubble (athlete app, field app, the reel's thread card). */
  | 'dark'
  /** Sitting on a light bubble or panel (desktop inbox, log mode, session card). */
  | 'light';

const CHIP: Record<MessageTextVariant, string> = {
  'on-accent': 'bg-white/20 text-white',
  dark: 'bg-sky-400/20 text-sky-200',
  light: 'bg-[var(--color-accent-muted)] text-[color:var(--color-accent)]',
};

const CHIP_VALUE: Record<MessageTextVariant, string> = {
  'on-accent': 'text-white/75',
  dark: 'text-sky-200/70',
  light: 'text-[color:var(--color-accent-hover)] opacity-75',
};

export function TagChip({ tag, variant }: { tag: MessageTag; variant: MessageTextVariant }) {
  const value = tag.kind === 'metric' ? tag.value : null;
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded px-1 py-px font-medium leading-tight align-baseline whitespace-nowrap ${CHIP[variant]}`}
      title={
        tag.kind === 'exercise'
          ? `About ${tag.label}`
          : value
            ? `${tag.label} was ${value} when this was written`
            : `About ${tag.label}`
      }
    >
      @{tag.label}
      {value && <span className={`font-normal ${CHIP_VALUE[variant]}`}>{value}</span>}
    </span>
  );
}

export function MessageText({
  text,
  tags,
  variant,
}: {
  text: string;
  tags: MessageTag[];
  variant: MessageTextVariant;
}) {
  if (tags.length === 0) return <>{text}</>;
  const segments = splitMessageByTags(text, tags);
  const inline = new Set(tagsInText(text, tags).map(tagId));
  const detached = tags.filter(t => !inline.has(tagId(t)));
  return (
    <>
      {detached.length > 0 && (
        <span className="flex flex-wrap gap-1 mb-1">
          {detached.map(t => (
            <TagChip key={tagId(t)} tag={t} variant={variant} />
          ))}
        </span>
      )}
      {segments.map((s, i) =>
        s.kind === 'text' ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : (
          <TagChip key={i} tag={s.tag} variant={variant} />
        ),
      )}
    </>
  );
}
