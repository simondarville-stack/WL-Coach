import { describe, it, expect } from 'vitest';
import {
  buildIstMap,
  captureIndividualRows,
  computeSollIst,
  istKey,
  newRefKey,
  suggestReference,
  type RefValuesMap,
  type SollIstRow,
} from '../sollIst';
import { modelToCsv, parseModelCsv } from '../sollIstCsv';
import { SOLLIST_PRESETS, resolvePreset } from '../sollIstPresets';
import type { AthletePRHistory, Exercise } from '../database.types';

const ex = (id: string, name: string, lift_slot: Exercise['lift_slot'] = null, aliases: string[] = []): Exercise =>
  ({ id, name, lift_slot, aliases } as unknown as Exercise);

const pr = (exercise_id: string, rep_count: number, value_kg: number): AthletePRHistory =>
  ({
    id: `${exercise_id}-${rep_count}`,
    exercise_id,
    rep_count,
    value_kg,
    achieved_date: '2026-07-01',
    created_at: '2026-07-01T10:00:00Z',
  } as unknown as AthletePRHistory);

const REFS: RefValuesMap = {
  sn: { current: 100, goal: 105 },
  cj: { current: 120, goal: 125 },
};

const BSQ: SollIstRow = { exerciseId: 'bsq', label: 'Back squat', refKey: 'cj', indexPct: 120, reps: 3 };
const PULL: SollIstRow = { exerciseId: 'pull', label: 'Snatch pull', refKey: 'sn', indexPct: 108, reps: 1 };

describe('computeSollIst', () => {
  it('derives Soll, Δ, Target and To-go from index × reference', () => {
    // The canonical example: back squat 120/3 vs C&J. C&J 120 → Soll 144;
    // athlete squats 150×3 → +6 kg / 104 %; goal C&J 125 → target 150 → done.
    const ist = new Map([[istKey('bsq', 3), { valueKg: 150, source: 'real' as const }]]);
    const [row] = computeSollIst([BSQ], REFS, ist);
    expect(row.soll).toBeCloseTo(144);
    expect(row.deltaKg).toBeCloseTo(6);
    expect(row.deltaPct).toBeCloseTo((150 / 144) * 100);
    expect(row.target).toBeCloseTo(150);
    expect(row.toGo).toBeCloseTo(0);
  });

  it('supports arbitrary references — a squat-family sheet anchored on back squat', () => {
    // Sandbox case: back squat is the index-100 anchor, front squat is 85 %.
    const refs: RefValuesMap = { bsq: { current: 200, goal: 210 } };
    const fsq: SollIstRow = { exerciseId: 'fsq', label: 'Front squat', refKey: 'bsq', indexPct: 85, reps: 1 };
    const ist = new Map([[istKey('fsq', 1), { valueKg: 165, source: 'real' as const }]]);
    const [row] = computeSollIst([fsq], refs, ist);
    expect(row.soll).toBeCloseTo(170);
    expect(row.deltaKg).toBeCloseTo(-5);
    expect(row.target).toBeCloseTo(178.5);
  });

  it('keeps Ist empty (index sheet) when no Ist map entries exist', () => {
    const [row] = computeSollIst([PULL], REFS, new Map());
    expect(row.soll).toBeCloseTo(108);
    expect(row.ist).toBeNull();
    expect(row.deltaKg).toBeNull();
    expect(row.target).toBeCloseTo(113.4);
  });

  it('returns null Soll for a missing or valueless reference', () => {
    const [pullRow] = computeSollIst([PULL], { sn: { current: null, goal: null } }, new Map());
    expect(pullRow.soll).toBeNull();
    const [orphan] = computeSollIst([{ ...PULL, refKey: 'nope' }], REFS, new Map());
    expect(orphan.soll).toBeNull();
  });
});

describe('buildIstMap', () => {
  const exercises = [ex('bsq', 'Back squat'), ex('pull', 'Snatch pull')];

  it('prefers a real rep-max and marks estimation for empty cells', () => {
    // bsq has a real 3RM; pull has only a 1RM so its 3RM cell is estimated.
    const history = [pr('bsq', 3, 150), pr('pull', 1, 110)];
    const map = buildIstMap([BSQ, { ...PULL, reps: 3 }], exercises, history, {});
    expect(map.get(istKey('bsq', 3))).toEqual({ valueKg: 150, source: 'real' });
    const est = map.get(istKey('pull', 3));
    expect(est?.source).toBe('estimated');
    expect(est!.valueKg).toBeLessThan(110); // a 3RM estimate sits under the 1RM
  });

  it('lets coach overrides win over PR data', () => {
    const history = [pr('bsq', 3, 150)];
    const map = buildIstMap([BSQ], exercises, history, { [istKey('bsq', 3)]: 155 });
    expect(map.get(istKey('bsq', 3))).toEqual({ valueKg: 155, source: 'override' });
  });

  describe('measured-only mode', () => {
    it('drops estimated cells and keeps measured ones', () => {
      const history = [pr('bsq', 3, 150), pr('pull', 1, 110)];
      const rows = [BSQ, { ...PULL, reps: 3 }];
      // Sanity: the estimate exists in the default mode.
      expect(buildIstMap(rows, exercises, history, {}).get(istKey('pull', 3))?.source).toBe('estimated');

      const measured = buildIstMap(rows, exercises, history, {}, true);
      expect(measured.get(istKey('bsq', 3))).toEqual({ valueKg: 150, source: 'real' });
      expect(measured.has(istKey('pull', 3))).toBe(false);
      expect([...measured.values()].every((v) => v.source !== 'estimated')).toBe(true);
    });

    it('still lets a coach override through — a typed number is a measurement', () => {
      const map = buildIstMap([{ ...PULL, reps: 3 }], exercises, [pr('pull', 1, 110)], { [istKey('pull', 3)]: 99 }, true);
      expect(map.get(istKey('pull', 3))).toEqual({ valueKg: 99, source: 'override' });
    });

    it('is empty when the athlete has no records at all', () => {
      expect(buildIstMap([BSQ], exercises, [], {}, true).size).toBe(0);
      expect(buildIstMap([BSQ], exercises, [], {}, false).size).toBe(0);
    });
  });
});

describe('suggestReference', () => {
  it('uses the real 1RM when present, implied otherwise', () => {
    const sn = ex('sn', 'Snatch', 'snatch');
    expect(suggestReference(sn, [pr('sn', 1, 100)])).toEqual({ valueKg: 100, source: 'real' });
    const implied = suggestReference(sn, [pr('sn', 3, 92)]);
    expect(implied?.source).toBe('estimated');
    expect(implied!.valueKg).toBeGreaterThan(92);
    expect(suggestReference(sn, [])).toBeNull();
    expect(suggestReference(null, [pr('sn', 1, 100)])).toBeNull(); // manual ref
  });

  it('measured-only refuses to fall back to the implied 1RM', () => {
    const sn = ex('sn', 'Snatch', 'snatch');
    // A real 1RM still resolves.
    expect(suggestReference(sn, [pr('sn', 1, 100)], true)).toEqual({ valueKg: 100, source: 'real' });
    // Only a 3RM to infer from — nothing measured at 1RM, so nothing suggested.
    expect(suggestReference(sn, [pr('sn', 3, 92)], true)).toBeNull();
  });
});

describe('captureIndividualRows', () => {
  it('captures actual ratios as new indices, keeping rows without Ist', () => {
    // Athlete squats 138 vs C&J 120 → individual index 115 (the "athlete A
    // only needs 115/3" case from the spec).
    const ist = new Map([[istKey('bsq', 3), { valueKg: 138, source: 'real' as const }]]);
    const computed = computeSollIst([BSQ, PULL], REFS, ist);
    const captured = captureIndividualRows(computed, REFS);
    expect(captured[0].indexPct).toBeCloseTo(115);
    expect(captured[1].indexPct).toBe(108); // untouched — no Ist
  });
});

describe('newRefKey', () => {
  it('slugs the label and de-duplicates against taken keys', () => {
    expect(newRefKey('Back squat', [])).toBe('back_squat');
    expect(newRefKey('Back squat', ['back_squat'])).toBe('back_squat_2');
    expect(newRefKey('###', [])).toBe('ref');
  });
});

describe('CSV round-trip', () => {
  const exercises = [ex('bsq', 'Back squat'), ex('pull', 'Snatch pull'), ex('fsq', 'Front squat')];

  it('parses semicolon CSV with decimal commas and Kategorie refs', () => {
    const { refs, rows, warnings } = parseModelCsv(
      'exercise;ref;index;reps\nBack squat;2;117,5;3\nSnatch pull;SN;108;1\n',
      exercises,
    );
    expect(warnings).toEqual([]);
    expect(refs.map((r) => r.label)).toEqual(['Clean & Jerk', 'Snatch']);
    expect(rows).toEqual([
      { exerciseId: 'bsq', label: 'Back squat', refKey: refs[0].key, indexPct: 117.5, reps: 3 },
      { exerciseId: 'pull', label: 'Snatch pull', refKey: refs[1].key, indexPct: 108, reps: 1 },
    ]);
  });

  it('creates arbitrary references on the fly and binds them to the catalogue', () => {
    const { refs, rows, warnings } = parseModelCsv('Front squat;Back squat;85;1', exercises);
    expect(warnings).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].label).toBe('Back squat');
    expect(refs[0].exerciseId).toBe('bsq'); // bound → PR suggestions work
    expect(rows[0]).toEqual({ exerciseId: 'fsq', label: 'Front squat', refKey: refs[0].key, indexPct: 85, reps: 1 });
  });

  it('keeps unmatched exercises and references as unbound with a warning', () => {
    const { refs, rows, warnings } = parseModelCsv('Mystery lift,Made-up ref,90,1', exercises);
    expect(rows[0].exerciseId).toBeNull();
    expect(rows[0].label).toBe('Mystery lift');
    expect(refs[0].label).toBe('Made-up ref');
    expect(refs[0].exerciseId).toBeNull(); // manual reference
    expect(warnings).toHaveLength(1); // only the exercise warns; a manual ref is legal
  });

  it('rejects bad indices and reps with line-numbered warnings', () => {
    const { rows, warnings } = parseModelCsv('Back squat;CJ;abc;3\nBack squat;CJ;120;12', exercises);
    expect(rows).toHaveLength(0);
    expect(warnings.some((w) => w.includes('Line 1'))).toBe(true);
    expect(warnings.some((w) => w.includes('Line 2'))).toBe(true);
  });

  it('round-trips through modelToCsv', () => {
    const src = 'exercise;ref;index;reps\nFront squat;Back squat;85,5;2';
    const first = parseModelCsv(src, exercises);
    const second = parseModelCsv(modelToCsv(first.refs, first.rows), exercises);
    expect(second.warnings).toEqual([]);
    expect(second.rows).toEqual(first.rows);
    expect(second.refs).toEqual(first.refs);
  });
});

describe('alias resolution', () => {
  it('maps preset rows via coach-taught aliases (exact, before loose matching)', () => {
    // The coach once repointed "Snatch-grip deadlift" → "Træk Dødløft";
    // the alias now resolves automatically. The decoy would win a loose
    // includes-match, so this also proves aliases outrank loose matching.
    const exercises = [
      ex('decoy', 'Snatch-grip deadlift with pause'),
      ex('dl', 'Træk Dødløft', null, ['Snatch-grip deadlift', 'Lastheben breit']),
    ];
    const senior = SOLLIST_PRESETS.find((p) => p.key === 'bvdg_senior')!;
    const { rows } = resolvePreset(senior, exercises);
    const dlRow = rows.find((r) => r.exerciseId === 'dl');
    expect(dlRow).toBeDefined();
    expect(dlRow!.indexPct).toBe(130);
  });

  it('CSV rows and references resolve via aliases too', () => {
    const exercises = [ex('dl', 'Træk Dødløft', null, ['Snatch-grip deadlift']), ex('bsq', 'Ben Bagpå', null, ['Back squat'])];
    const { refs, rows, warnings } = parseModelCsv('Snatch-grip deadlift;Back squat;65;1', exercises);
    expect(warnings).toEqual([]);
    expect(rows[0].exerciseId).toBe('dl');
    expect(refs[0].exerciseId).toBe('bsq'); // ref bound via exact alias
  });

  it('never maps two preset rows onto the same exercise (first claim wins)', () => {
    const preset = {
      key: 't',
      name: 't',
      description: '',
      refs: [{ key: 'r', label: 'R', match: ['nope'] }],
      rows: [
        { label: 'A', refKey: 'r', indexPct: 100, reps: 1, match: ['back squat'] },
        { label: 'B', refKey: 'r', indexPct: 90, reps: 1, match: ['back squat'] },
      ],
    };
    const { rows } = resolvePreset(preset, [ex('bsq', 'Back squat')]);
    expect(rows[0].exerciseId).toBe('bsq');
    expect(rows[1].exerciseId).toBeNull(); // stays unmapped for manual repoint
    expect(rows[1].label).toBe('B');
  });
});

describe('preset resolution', () => {
  it('resolves refs and rows via lift_slot first, then names, leaving the rest unmapped', () => {
    const exercises = [
      ex('snx', 'Træk', 'snatch'),
      ex('cjx', 'Stød', 'clean_and_jerk'),
      ex('bs', 'Squat variation X', 'back_squat'), // lift_slot beats name
      ex('sp', 'Snatch Pull'),
      ex('pp', 'Push Press behind neck'),
    ];
    const senior = SOLLIST_PRESETS.find((p) => p.key === 'bvdg_senior')!;
    const { refs, rows } = resolvePreset(senior, exercises);
    expect(refs.find((r) => r.key === 'sn')).toEqual({ key: 'sn', label: 'Træk', exerciseId: 'snx' });
    expect(refs.find((r) => r.key === 'cj')?.exerciseId).toBe('cjx');
    const byLabel = (l: string) => rows.find((r) => r.label.toLowerCase().includes(l));
    expect(byLabel('squat variation x')?.exerciseId).toBe('bs');
    expect(byLabel('snatch pull')?.exerciseId).toBe('sp');
    expect(byLabel('push press')?.exerciseId).toBe('pp');
    // Something with no counterpart stays unmapped but keeps its label.
    const unmapped = rows.find((r) => r.exerciseId === null);
    expect(unmapped).toBeDefined();
    // Every row points at a defined reference.
    const refKeys = new Set(refs.map((r) => r.key));
    expect(rows.every((r) => refKeys.has(r.refKey))).toBe(true);
  });
});
