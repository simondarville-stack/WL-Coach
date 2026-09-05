import { describe, it, expect } from 'vitest';
import type { MessageTag, TrainingLogSet } from '../database.types';
import type { ReviewSessionItem } from '../reviewFeedService';
import {
  dedupeLabels,
  expandTagCandidates,
  filterTagTargets,
  insertMention,
  isOnlyTags,
  isTaggedToExercise,
  mentionQueryAt,
  messageTags,
  parseMentionPath,
  pickerRows,
  removeMention,
  replaceRange,
  sessionTagTargets,
  splitMessageByTags,
  tagId,
  tagToken,
  tagsInText,
  type TagTarget,
} from '../messageTags';

const snatch: MessageTag = { kind: 'exercise', logExerciseId: 'le-1', label: 'Snatch' };
const snatch3: MessageTag = { kind: 'exercise', logExerciseId: 'le-1', label: 'Snatch', setNumber: 3 };
const snatchPull: MessageTag = { kind: 'exercise', logExerciseId: 'le-2', label: 'Snatch Pull' };
const bw: MessageTag = { kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' };

const set = (n: number, over: Partial<TrainingLogSet> = {}): TrainingLogSet => ({
  id: `set-${n}`,
  owner_id: null,
  log_exercise_id: 'le-1',
  set_number: n,
  planned_load: null,
  planned_reps: null,
  performed_load: 80,
  performed_reps: 3,
  performed_text: null,
  rpe: null,
  status: 'completed',
  notes: null,
  created_at: '',
  updated_at: '',
  ...over,
});

describe('messageTags (safe read)', () => {
  it('reads an array of well-formed tags', () => {
    expect(messageTags({ tags: [snatch, snatch3, bw] })).toEqual([snatch, snatch3, bw]);
  });

  it('reads no tags off a row without the column, a null, or junk', () => {
    expect(messageTags({})).toEqual([]);
    expect(messageTags({ tags: null })).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed
    expect(messageTags({ tags: 'nope' as any })).toEqual([]);
    expect(
      messageTags({
        tags: [
          { kind: 'exercise' },
          { kind: 'metric', key: 'bw', label: '' },
          { ...snatch, setNumber: 0 },
          { ...snatch, setNumber: 1.5 },
          snatch,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed
        ] as any,
      }),
    ).toEqual([snatch]);
  });

  it('answers whether a message is tagged to a logged exercise, whole or by set', () => {
    expect(isTaggedToExercise({ tags: [snatch] }, 'le-1')).toBe(true);
    expect(isTaggedToExercise({ tags: [snatch3] }, 'le-1')).toBe(true);
    expect(isTaggedToExercise({ tags: [snatch] }, 'le-2')).toBe(false);
    expect(isTaggedToExercise({ tags: [bw] }, 'le-1')).toBe(false);
  });

  it('tokens and identities tell a set apart from its exercise', () => {
    expect(tagToken(snatch)).toBe('#Snatch');
    expect(tagToken(snatch3)).toBe('#Snatch/3');
    expect(tagToken(bw)).toBe('#BW');
    expect(tagId(snatch)).not.toBe(tagId(snatch3));
  });
});

describe('splitMessageByTags', () => {
  it('finds tokens in the text and keeps the prose around them', () => {
    expect(splitMessageByTags('#Snatch looked slow, #BW nice', [snatch, bw])).toEqual([
      { kind: 'tag', tag: snatch, token: '#Snatch' },
      { kind: 'text', text: ' looked slow, ' },
      { kind: 'tag', tag: bw, token: '#BW' },
      { kind: 'text', text: ' nice' },
    ]);
  });

  it('prefers the longest token where two could match', () => {
    const segs = splitMessageByTags('#Snatch Pull was heavy', [snatch, snatchPull]);
    expect(segs[0]).toEqual({ kind: 'tag', tag: snatchPull, token: '#Snatch Pull' });
    expect(segs[1]).toEqual({ kind: 'text', text: ' was heavy' });

    const withSet = splitMessageByTags('#Snatch/3 slow, #Snatch fine', [snatch, snatch3]);
    expect(withSet).toEqual([
      { kind: 'tag', tag: snatch3, token: '#Snatch/3' },
      { kind: 'text', text: ' slow, ' },
      { kind: 'tag', tag: snatch, token: '#Snatch' },
      { kind: 'text', text: ' fine' },
    ]);
  });

  it('does not fire inside a longer word', () => {
    expect(splitMessageByTags('#Snatches are fine', [snatch])).toEqual([
      { kind: 'text', text: '#Snatches are fine' },
    ]);
  });

  it('leaves text alone when nothing is tagged', () => {
    expect(splitMessageByTags('plain words', [])).toEqual([{ kind: 'text', text: 'plain words' }]);
    expect(splitMessageByTags('#Nobody here', [snatch])).toEqual([
      { kind: 'text', text: '#Nobody here' },
    ]);
  });
});

describe('tagsInText / isOnlyTags', () => {
  it('lists each mentioned tag once, in order of first appearance', () => {
    expect(tagsInText('#BW then #Snatch and #BW again', [snatch, bw])).toEqual([bw, snatch]);
  });

  it('drops a tag whose token the coach deleted from the text', () => {
    expect(tagsInText('looked slow', [snatch, bw])).toEqual([]);
  });

  it('knows when the draft is nothing but an armed tag', () => {
    expect(isOnlyTags('#Snatch ', [snatch])).toBe(true);
    expect(isOnlyTags('#Snatch/3 #BW', [snatch3, bw])).toBe(true);
    expect(isOnlyTags('#Snatch fix the catch', [snatch])).toBe(false);
    expect(isOnlyTags('', [snatch])).toBe(false);
    expect(isOnlyTags('   ', [snatch])).toBe(false);
  });
});

describe('mentionQueryAt', () => {
  it('opens on a bare # and tracks what is typed after it', () => {
    expect(mentionQueryAt('#', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('well #Sn', 8)).toEqual({ start: 5, query: 'Sn' });
    expect(mentionQueryAt('#Power Sn', 9)).toEqual({ start: 0, query: 'Power Sn' });
    expect(mentionQueryAt('#Snatch/', 8)).toEqual({ start: 0, query: 'Snatch/' });
  });

  it('ignores a # glued to a word, a query on another line, or one too long', () => {
    expect(mentionQueryAt('issue#12', 8)).toBeNull();
    expect(mentionQueryAt('#Sn\natch', 8)).toBeNull();
    expect(mentionQueryAt(`#${'x'.repeat(41)}`, 42)).toBeNull();
    expect(mentionQueryAt('no hash here', 12)).toBeNull();
  });

  it('only looks before the caret', () => {
    expect(mentionQueryAt('hello #Snatch', 5)).toBeNull();
    expect(mentionQueryAt('hello #Snatch', 8)).toEqual({ start: 6, query: 'S' });
  });
});

describe('insertMention / replaceRange / removeMention', () => {
  it('replaces the typed query with the token and a trailing space', () => {
    const r = insertMention('well #Sn done', 5, 8, snatch);
    expect(r.text).toBe('well #Snatch  done');
    expect(r.caret).toBe('well #Snatch '.length);
  });

  it('adds a leading space when appended straight after a word', () => {
    const r = insertMention('looked slow', 11, 11, snatch3);
    expect(r.text).toBe('looked slow #Snatch/3 ');
    expect(r.caret).toBe(r.text.length);
  });

  it('inserts cleanly into an empty draft', () => {
    expect(insertMention('', 0, 0, bw)).toEqual({ text: '#BW ', caret: 4 });
  });

  it('replaceRange swaps a span and lands the caret after it (drilling into sets)', () => {
    expect(replaceRange('see #sn now', 4, 7, '#Snatch/')).toEqual({
      text: 'see #Snatch/ now',
      caret: 12,
    });
  });

  it('removes the token and the space after it, leaving the sentence intact', () => {
    expect(removeMention('#Snatch looked slow', snatch)).toBe('looked slow');
    expect(removeMention('fix #Snatch/3 please', snatch3)).toBe('fix please');
    expect(removeMention('#Snatch #Snatch twice', snatch)).toBe('twice');
    expect(removeMention('untouched', snatch)).toBe('untouched');
    // Removing the whole-exercise tag leaves a set tag of the same exercise,
    // given the other candidates so the longer token wins.
    expect(removeMention('#Snatch/3 and #Snatch', snatch, [snatch3])).toBe('#Snatch/3 and ');
    expect(removeMention('#Snatch/3 and #Snatch', snatch3, [snatch])).toBe('and #Snatch');
  });
});

describe('targets', () => {
  it('dedupes labels with a counter and sanitises tokens', () => {
    const out = dedupeLabels([
      { tag: { kind: 'exercise', logExerciseId: 'a', label: 'Snatch' }, hint: null },
      { tag: { kind: 'exercise', logExerciseId: 'b', label: 'Snatch' }, hint: null },
      { tag: { kind: 'exercise', logExerciseId: 'c', label: ' Clean #\n@Jerk ' }, hint: null },
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

  it('builds a session card into exercises with their sets, metric chips, then session fields', () => {
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
        {
          id: 'le-1',
          name: 'Snatch',
          status: 'completed',
          sets: [
            set(2, { performed_load: 85, performed_reps: 2 }),
            set(1),
            set(3, { performed_load: 90, performed_reps: null, status: 'failed' }),
            set(4, { status: 'pending' }),
          ],
        },
        { id: 'le-2', name: 'Snatch', status: 'skipped', sets: [] },
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
    expect(targets[0].sets).toEqual([
      { setNumber: 1, hint: '80 × 3' },
      { setNumber: 2, hint: '85 × 2' },
      { setNumber: 3, hint: '90 × x · missed' },
      { setNumber: 4, hint: 'not done' },
    ]);
    expect(targets[1].sets).toBeUndefined();
    expect(targets[1].hint).toBe('skipped');
    expect(targets[2].tag).toEqual({ kind: 'metric', key: 'bw', label: 'BW', value: '82,5 kg' });
    expect(targets[3].hint).toBe('not entered');
    expect(targets[4].tag).toMatchObject({ key: 'rpe', value: '8,5' });
    expect(targets[5].tag).toMatchObject({ key: 'duration', value: '75 min' });
    expect(targets[6].hint).toBe('Felt heavy today but the pulls moved we…');
  });

  it('expands targets into every tag their tokens can name', () => {
    const targets: TagTarget[] = [
      { tag: snatch, hint: null, sets: [{ setNumber: 1, hint: '' }, { setNumber: 3, hint: '' }] },
      { tag: bw, hint: null },
    ];
    expect(expandTagCandidates(targets)).toEqual([
      snatch,
      { ...snatch, setNumber: 1 },
      { ...snatch, setNumber: 3 },
      bw,
    ]);
  });
});

describe('picker paths', () => {
  const targets: TagTarget[] = [
    {
      tag: snatch,
      hint: null,
      sets: [
        { setNumber: 1, hint: '80 × 3' },
        { setNumber: 2, hint: '85 × 3' },
        { setNumber: 3, hint: '90 × x · missed' },
      ],
    },
    { tag: snatchPull, hint: null, sets: [{ setNumber: 1, hint: '100 × 3' }] },
    { tag: { kind: 'exercise', logExerciseId: 'le-9', label: 'Clean/Jerk' }, hint: null },
    { tag: bw, hint: '82,5 kg' },
  ];

  it('reads a trailing /digits as a set path and nothing else', () => {
    expect(parseMentionPath('sn')).toEqual({ exercise: 'sn', set: null });
    expect(parseMentionPath('sn/')).toEqual({ exercise: 'sn', set: '' });
    expect(parseMentionPath('Snatch/3')).toEqual({ exercise: 'Snatch', set: '3' });
    expect(parseMentionPath('Clean/Jerk')).toEqual({ exercise: 'Clean/Jerk', set: null });
  });

  it('lists targets without a path, marking the ones that can drill', () => {
    const rows = pickerRows(targets, '');
    expect(rows.map(r => [r.label, r.icon, r.drillable])).toEqual([
      ['Snatch', 'exercise', true],
      ['Snatch Pull', 'exercise', true],
      ['Clean/Jerk', 'exercise', false],
      ['BW', 'metric', false],
    ]);
  });

  it('a bare path lists the whole exercise then its sets; an exact label beats a prefix', () => {
    const rows = pickerRows(targets, 'Snatch/');
    expect(rows.map(r => r.label)).toEqual(['Snatch', 'Snatch/1', 'Snatch/2', 'Snatch/3']);
    expect(rows[0].hint).toBe('whole exercise');
    expect(rows[3]).toMatchObject({ tag: snatch3, hint: '90 × x · missed', icon: 'set' });
  });

  it('a prefix path covers every matching exercise; digits narrow the sets', () => {
    expect(pickerRows(targets, 'sn/').map(r => r.label)).toEqual([
      'Snatch',
      'Snatch/1',
      'Snatch/2',
      'Snatch/3',
      'Snatch Pull',
      'Snatch Pull/1',
    ]);
    expect(pickerRows(targets, 'sn/2').map(r => r.label)).toEqual(['Snatch/2']);
    expect(pickerRows(targets, 'sn/9')).toEqual([]);
  });

  it('a slash inside a label is not a path', () => {
    expect(pickerRows(targets, 'Clean/J').map(r => r.label)).toEqual(['Clean/Jerk']);
  });
});
