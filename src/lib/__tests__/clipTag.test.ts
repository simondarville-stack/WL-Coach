import { describe, expect, it } from 'vitest';
import {
  describeClipTag,
  describeSetOption,
  formatClipLoad,
  resolveClipTag,
  suggestSetForClip,
} from '../clipTag';
import type { TrainingLogSet, TrainingLogVideo } from '../database.types';

type VideoTag = Pick<TrainingLogVideo, 'set_number' | 'performed_load' | 'performed_reps'>;

const clip = (over: Partial<VideoTag> = {}): VideoTag => ({
  set_number: null,
  performed_load: null,
  performed_reps: null,
  ...over,
});

const set = (over: Partial<TrainingLogSet> & { set_number: number }): TrainingLogSet =>
  ({
    id: `set-${over.set_number}`,
    owner_id: null,
    log_exercise_id: 'ex',
    planned_load: null,
    planned_reps: null,
    performed_load: null,
    performed_reps: null,
    performed_text: null,
    rpe: null,
    status: 'pending',
    notes: null,
    created_at: '',
    updated_at: '',
    ...over,
  }) as TrainingLogSet;

describe('resolveClipTag', () => {
  it('reads load and reps from the linked set, not from the clip', () => {
    // The set row is the single source of truth; a copy on the clip would be
    // a second place to change one number.
    const sets = [set({ set_number: 2, performed_load: 105, performed_reps: 2 })];
    const resolved = resolveClipTag(clip({ set_number: 2 }), sets);

    expect(resolved).toEqual({ setNumber: 2, load: 105, reps: 2, fromSet: true });
  });

  it('falls back to the clip when the linked set has gone', () => {
    // A deleted set leaves set_number pointing at nothing; "S3" still beats
    // saying nothing at all.
    const resolved = resolveClipTag(clip({ set_number: 3, performed_load: 90 }), []);

    expect(resolved).toEqual({ setNumber: 3, load: 90, reps: null, fromSet: false });
  });

  it('uses the clip’s own numbers when it names no set', () => {
    const resolved = resolveClipTag(clip({ performed_load: 82.5, performed_reps: 1 }), [
      set({ set_number: 1, performed_load: 100, performed_reps: 3 }),
    ]);

    expect(resolved).toEqual({ setNumber: null, load: 82.5, reps: 1, fromSet: false });
  });

  it('reports an untagged clip as untagged', () => {
    expect(resolveClipTag(clip(), [])).toEqual({
      setNumber: null,
      load: null,
      reps: null,
      fromSet: false,
    });
  });
});

describe('formatClipLoad', () => {
  it('uses comma decimals and drops a trailing zero', () => {
    expect(formatClipLoad(102.5)).toBe('102,5');
    expect(formatClipLoad(100)).toBe('100');
  });
});

describe('describeClipTag', () => {
  const sets = [set({ set_number: 2, performed_load: 105, performed_reps: 2 })];

  it('names the set and its numbers', () => {
    expect(describeClipTag(clip({ set_number: 2 }), sets)).toBe('S2 · 105 × 2');
  });

  it('describes a clip that is not a logged set', () => {
    expect(describeClipTag(clip({ performed_load: 82.5, performed_reps: 1 }))).toBe('82,5 × 1');
  });

  it('copes with half a statement', () => {
    expect(describeClipTag(clip({ performed_load: 90 }))).toBe('90 kg');
    expect(describeClipTag(clip({ performed_reps: 3 }))).toBe('× 3');
    expect(describeClipTag(clip({ set_number: 4 }))).toBe('S4');
  });

  it('returns null when the athlete said nothing', () => {
    expect(describeClipTag(clip())).toBeNull();
  });
});

describe('describeSetOption', () => {
  it('prefers performed numbers over planned', () => {
    const s = set({ set_number: 1, planned_load: 100, planned_reps: 3, performed_load: 105 });
    expect(describeSetOption(s)).toBe('S1 · 105 × 3');
  });

  it('falls back to planned before the set is logged', () => {
    expect(describeSetOption(set({ set_number: 1, planned_load: 100, planned_reps: 3 }))).toBe(
      'S1 · 100 × 3',
    );
  });

  it('degrades to the bare set number when nothing is known', () => {
    expect(describeSetOption(set({ set_number: 5 }))).toBe('S5');
  });
});

describe('suggestSetForClip', () => {
  const sets = [
    set({ set_number: 1, status: 'completed' }),
    set({ set_number: 2, status: 'completed' }),
    set({ set_number: 3, status: 'pending' }),
  ];

  it('proposes the latest completed set — the one just filmed', () => {
    expect(suggestSetForClip(sets, [])).toBe(2);
  });

  it('skips sets that already have a clip', () => {
    // Filming a second lift is almost never re-filming the first.
    expect(suggestSetForClip(sets, [2])).toBe(1);
    expect(suggestSetForClip(sets, [1, 2])).toBe(3);
  });

  it('falls back to the first untouched set when none is completed', () => {
    const pending = [set({ set_number: 1 }), set({ set_number: 2 })];
    expect(suggestSetForClip(pending, [])).toBe(1);
    expect(suggestSetForClip(pending, [1])).toBe(2);
  });

  it('guesses nothing rather than guessing wrong', () => {
    expect(suggestSetForClip([], [])).toBeNull();
    expect(suggestSetForClip(sets, [1, 2, 3])).toBeNull();
  });

  it('ignores nulls in the already-tagged list', () => {
    // Untagged clips carry a null set_number and must not block anything.
    expect(suggestSetForClip(sets, [null, null])).toBe(2);
  });
});
