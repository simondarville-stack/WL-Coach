import { describe, it, expect } from 'vitest';
import type { MessageTag } from '../database.types';
import type { ReviewSessionItem } from '../reviewFeedService';
import {
  dedupeLabels,
  filterTagTargets,
  insertMention,
  isOnlyTags,
  isTaggedToExercise,
  mentionQueryAt,
  messageTags,
  removeMention,
  sessionTagTargets,
  splitMessageByTags,
  tagsInText,
} from '../messageTags';

const snatch: MessageTag = { kind: 'exercise', logExerciseId: 'le-1', label: 'Snatch' };
const snatchPull: MessageTag = { kind: 'exercise', logExerciseId: 'le-2', label: 'Snatch Pull' };
const bw: MessageTag = { kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' };

describe('messageTags (safe read)', () => {
  it('reads an array of well-formed tags', () => {
    expect(messageTags({ tags: [snatch, bw] })).toEqual([snatch, bw]);
  });

  it('reads no tags off a row without the column, a null, or junk', () => {
    expect(messageTags({})).toEqual([]);
    expect(messageTags({ tags: null })).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed
    expect(messageTags({ tags: 'nope' as any })).toEqual([]);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed
      messageTags({ tags: [{ kind: 'exercise' }, { kind: 'metric', key: 'bw', label: '' }, snatch] as any }),
    ).toEqual([snatch]);
  });

  it('answers whether a message is tagged to a logged exercise', () => {
    expect(isTaggedToExercise({ tags: [snatch] }, 'le-1')).toBe(true);
    expect(isTaggedToExercise({ tags: [snatch] }, 'le-2')).toBe(false);
    expect(isTaggedToExercise({ tags: [bw] }, 'le-1')).toBe(false);
  });
});

describe('splitMessageByTags', () => {
  it('finds tokens in the text and keeps the prose around them', () => {
    expect(splitMessageByTags('@Snatch looked slow, @BW nice', [snatch, bw])).toEqual([
      { kind: 'tag', tag: snatch, token: '@Snatch' },
      { kind: 'text', text: ' looked slow, ' },
      { kind: 'tag', tag: bw, token: '@BW' },
      { kind: 'text', text: ' nice' },
    ]);
  });

  it('prefers the longest label where two could match', () => {
    const segs = splitMessageByTags('@Snatch Pull was heavy', [snatch, snatchPull]);
    expect(segs[0]).toEqual({ kind: 'tag', tag: snatchPull, token: '@Snatch Pull' });
    expect(segs[1]).toEqual({ kind: 'text', text: ' was heavy' });
  });

  it('does not fire inside a longer word', () => {
    expect(splitMessageByTags('@Snatches are fine', [snatch])).toEqual([
      { kind: 'text', text: '@Snatches are fine' },
    ]);
  });

  it('leaves text alone when nothing is tagged', () => {
    expect(splitMessageByTags('plain words', [])).toEqual([{ kind: 'text', text: 'plain words' }]);
    expect(splitMessageByTags('@Nobody here', [snatch])).toEqual([
      { kind: 'text', text: '@Nobody here' },
    ]);
  });
});

describe('tagsInText / isOnlyTags', () => {
  it('lists each mentioned tag once, in order of first appearance', () => {
    expect(tagsInText('@BW then @Snatch and @BW again', [snatch, bw])).toEqual([bw, snatch]);
  });

  it('drops a tag whose token the coach deleted from the text', () => {
    expect(tagsInText('looked slow', [snatch, bw])).toEqual([]);
  });

  it('knows when the draft is nothing but an armed tag', () => {
    expect(isOnlyTags('@Snatch ', [snatch])).toBe(true);
    expect(isOnlyTags('@Snatch @BW', [snatch, bw])).toBe(true);
    expect(isOnlyTags('@Snatch fix the catch', [snatch])).toBe(false);
    expect(isOnlyTags('', [snatch])).toBe(false);
    expect(isOnlyTags('   ', [snatch])).toBe(false);
  });
});

describe('mentionQueryAt', () => {
  it('opens on a bare @ and tracks what is typed after it', () => {
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('well @Sn', 8)).toEqual({ start: 5, query: 'Sn' });
    expect(mentionQueryAt('@Power Sn', 9)).toEqual({ start: 0, query: 'Power Sn' });
  });

  it('ignores an @ glued to a word, a query on another line, or one too long', () => {
    expect(mentionQueryAt('mail me@x', 9)).toBeNull();
    expect(mentionQueryAt('@Sn\natch', 8)).toBeNull();
    expect(mentionQueryAt(`@${'x'.repeat(41)}`, 42)).toBeNull();
    expect(mentionQueryAt('no at here', 10)).toBeNull();
  });

  it('only looks before the caret', () => {
    expect(mentionQueryAt('hello @Snatch', 5)).toBeNull();
    expect(mentionQueryAt('hello @Snatch', 8)).toEqual({ start: 6, query: 'S' });
  });
});

describe('insertMention / removeMention', () => {
  it('replaces the typed query with the token and a trailing space', () => {
    const r = insertMention('well @Sn done', 5, 8, snatch);
    expect(r.text).toBe('well @Snatch  done');
    expect(r.caret).toBe('well @Snatch '.length);
  });

  it('adds a leading space when appended straight after a word', () => {
    const r = insertMention('looked slow', 11, 11, snatch);
    expect(r.text).toBe('looked slow @Snatch ');
    expect(r.caret).toBe(r.text.length);
  });

  it('inserts cleanly into an empty draft', () => {
    expect(insertMention('', 0, 0, bw)).toEqual({ text: '@BW ', caret: 4 });
  });

  it('removes the token and the space after it, leaving the sentence intact', () => {
    expect(removeMention('@Snatch looked slow', snatch)).toBe('looked slow');
    expect(removeMention('fix @Snatch please', snatch)).toBe('fix please');
    expect(removeMention('@Snatch @Snatch twice', snatch)).toBe('twice');
    expect(removeMention('untouched', snatch)).toBe('untouched');
  });
});

describe('targets', () => {
  it('dedupes labels with a counter and sanitises tokens', () => {
    const out = dedupeLabels([
      { tag: { kind: 'exercise', logExerciseId: 'a', label: 'Snatch' }, hint: null },
      { tag: { kind: 'exercise', logExerciseId: 'b', label: 'Snatch' }, hint: null },
      { tag: { kind: 'exercise', logExerciseId: 'c', label: ' Clean @\nJerk ' }, hint: null },
    ]);
    expect(out.map(t => t.tag.label)).toEqual(['Snatch', 'Snatch (2)', 'Clean Jerk']);
  });

  it('filters starts-with before contains, case-insensitively', () => {
    const targets = dedupeLabels([
      { tag: snatchPull, hint: null },
      { tag: { kind: 'exercise', logExerciseId: 'x', label: 'Power Snatch' }, hint: null },
      { tag: snatch, hint: null },
      { tag: bw, hint: null },
    ]);
    expect(filterTagTargets(targets, 'sn').map(t => t.tag.label)).toEqual([
      'Snatch Pull',
      'Snatch',
      'Power Snatch',
    ]);
    expect(filterTagTargets(targets, '').map(t => t.tag.label)).toEqual([
      'Snatch Pull',
      'Power Snatch',
      'Snatch',
      'BW',
    ]);
    expect(filterTagTargets(targets, 'zzz')).toEqual([]);
  });

  it('builds a session card into exercises, metric chips, then session fields', () => {
    const item = {
      kind: 'session',
      session: {
        session_rpe: 8.5,
        duration_minutes: 75,
        session_notes: 'Felt heavy today but the pulls moved well',
      },
      metrics: [
        { key: 'bw', label: 'BW', value: '82,5 kg' },
        { key: 'vas', label: 'VAS', value: null },
      ],
      exercises: [
        { id: 'le-1', name: 'Snatch', status: 'completed' },
        { id: 'le-2', name: 'Snatch', status: 'skipped' },
      ],
    } as unknown as ReviewSessionItem;
    const targets = sessionTagTargets(item);
    expect(targets.map(t => t.tag.label)).toEqual([
      'Snatch',
      'Snatch (2)',
      'BW',
      'VAS',
      'RPE',
      'Duration',
      'Notes',
    ]);
    expect(targets[1].hint).toBe('skipped');
    expect(targets[2].tag).toEqual({ kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' });
    expect(targets[3].hint).toBe('not entered');
    expect(targets[4].tag).toMatchObject({ key: 'rpe', value: '8,5' });
    expect(targets[5].tag).toMatchObject({ key: 'duration', value: '75 min' });
    expect(targets[6].hint).toBe('Felt heavy today but the pulls moved we…');
  });
});
