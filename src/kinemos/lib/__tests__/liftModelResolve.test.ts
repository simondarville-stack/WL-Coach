import { describe, expect, it } from 'vitest';
import { modelFromName, resolveLiftModel, type ExerciseForModel } from '../liftModelResolve';

const ex = (over: Partial<ExerciseForModel> & { id: string; name: string }): ExerciseForModel => ({
  parent_exercise_id: null,
  lift_slot: null,
  kinemos_lift_model: null,
  ...over,
});

describe('modelFromName — English, German, Danish', () => {
  const cases: Array<[string, string | null]> = [
    ['Snatch', 'snatch'],
    ['Reißen', 'snatch'],
    ['Træk', 'snatch'],
    ['Power snatch', 'power-snatch'],
    ['Power pull', 'power-snatch'],
    ['Power pull strict', 'muscle-snatch'],
    ['Muscle snatch', 'muscle-snatch'],
    ['Råtræk', 'muscle-snatch'],
    ['Snatch pull', 'snatch-pull'],
    ['Trækhiv', 'snatch-pull'],
    ['Snatch deadlift', 'snatch-deadlift'],
    ['Styrketræk', 'snatch-deadlift'],
    ['Hang snatch', 'snatch-hang-above-knee'],
    ['Snatch from blocks', 'snatch-hang-below-knee'],
    ['Snatch, low hang', 'snatch-hang-below-knee'],
    ['Træk fra dyb hæng', 'snatch-hang-below-knee'],
    ['Træk overgang', 'snatch-hang-above-knee'],
    ['Snatch balance', 'snatch-balance'],
    ['Clean', 'clean'],
    ['Umsetzen', 'clean'],
    ['Stødvend', 'clean'],
    ['Power clean', 'power-clean'],
    ['Frivend', 'power-clean'],
    ['Power pull stød', 'power-clean'],
    ['Clean pull', 'clean-pull'],
    ['Stødhiv', 'clean-pull'],
    ['Clean deadlift', 'clean-deadlift'],
    ['Hang clean above knee', 'clean-hang-above-knee'],
    ['Stødvend lav blok', 'clean-hang-below-knee'],
    ['Jerk', 'jerk'],
    ['Split jerk', 'jerk'],
    ['Ausstoßen', 'jerk'],
    ['Opadstød', 'jerk'],
    ['Power jerk', 'power-jerk'],
    ['Push jerk', 'power-jerk'],
    ['Knickstød', 'power-jerk'],
    ['Push press', 'push-press'],
    ['Push pres', 'push-press'],
    ['Clean & Jerk', 'clean-and-jerk'],
    ['Clean and jerk', 'clean-and-jerk'],
    ['Stoßen', 'clean-and-jerk'],
    ['Stød', 'clean-and-jerk'],
    ['Strict press', 'press'],
    ['Stem', 'press'],
    // The live library's own names (09/09/2026).
    ['Stød Dødløft', 'clean-deadlift'],
    ['Træk Dødløft', 'snatch-deadlift'],
    ['Trækdødløft', 'snatch-deadlift'],
    ['PushPress', 'push-press'],
    ['Trækbalance', 'snatch-balance'],
    ['Power Stødhiv', 'clean-pull'],
    ['Vend fra hæng', 'clean-hang-above-knee'],
    ['Styrkevend', 'clean'],
    ['Trækiv', 'snatch'],
    ['Nakkepres', null],
    ['Back squat', null],
    ['Ben foran', null],
    ['Bench press', 'press'],
    ['Bent-over row', null],
  ];
  for (const [name, expected] of cases) {
    it(`${name} → ${expected ?? 'nothing'}`, () => {
      expect(modelFromName(name)).toBe(expected);
    });
  }
});

describe('resolveLiftModel — the ladder', () => {
  it('a declaration on the exercise wins', () => {
    const e = ex({ id: 'a', name: 'Back squat', kinemos_lift_model: 'jerk' });
    expect(resolveLiftModel(e, new Map([[e.id, e]]))).toEqual({ id: 'jerk', how: 'declared' });
  });

  it('an unknown declaration is ignored, not trusted', () => {
    const e = ex({ id: 'a', name: 'Snatch', kinemos_lift_model: 'coach-made-up' });
    expect(resolveLiftModel(e, new Map([[e.id, e]]))).toEqual({ id: 'snatch', how: 'name' });
  });

  it('a child inherits the parent’s declaration, refined by its own name', () => {
    const parent = ex({ id: 'p', name: 'Snatch', kinemos_lift_model: 'snatch' });
    const child = ex({ id: 'c', name: 'Snatch from blocks', parent_exercise_id: 'p' });
    const grandchild = ex({ id: 'g', name: 'Variant 2', parent_exercise_id: 'c' });
    const byId = new Map([[parent.id, parent], [child.id, child], [grandchild.id, grandchild]]);
    expect(resolveLiftModel(child, byId)).toEqual({ id: 'snatch-hang-below-knee', how: 'inherited' });
    // Two levels up, and a name that says nothing keeps the ancestor's model.
    expect(resolveLiftModel(grandchild, byId)).toEqual({ id: 'snatch', how: 'inherited' });
  });

  it('survives a cycle in the tree', () => {
    const a = ex({ id: 'a', name: 'X', parent_exercise_id: 'b' });
    const b = ex({ id: 'b', name: 'Y', parent_exercise_id: 'a' });
    expect(resolveLiftModel(a, new Map([[a.id, a], [b.id, b]]))).toBeNull();
  });

  it('falls to the lift slot, then the name', () => {
    const slot = ex({ id: 's', name: 'Rykk', lift_slot: 'snatch' });
    expect(resolveLiftModel(slot, new Map([[slot.id, slot]]))).toEqual({ id: 'snatch', how: 'slot' });
    const cj = ex({ id: 'cj', name: 'Stoß', lift_slot: 'clean_and_jerk' });
    expect(resolveLiftModel(cj, new Map([[cj.id, cj]]))).toEqual({ id: 'clean-and-jerk', how: 'slot' });
    const named = ex({ id: 'n', name: 'Push press' });
    expect(resolveLiftModel(named, new Map([[named.id, named]]))).toEqual({ id: 'push-press', how: 'name' });
    const squat = ex({ id: 'q', name: 'Front squat', lift_slot: 'front_squat' });
    expect(resolveLiftModel(squat, new Map([[squat.id, squat]]))).toEqual({ id: 'unspecified', how: 'slot' });
  });
});
