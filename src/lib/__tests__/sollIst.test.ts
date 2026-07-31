import { describe, it, expect } from 'vitest';
import { computeSollIst, buildIstMap, captureIndividualRows, istKey, suggestReference, type SollIstRow, type RefValues } from '../sollIst';
import { parseModelCsv, modelToCsv } from '../sollIstCsv';
import { resolvePreset, SOLLIST_PRESETS } from '../sollIstPresets';
import type { AthletePRHistory, Exercise } from '../database.types';

const ex = (id: string, name: string, lift_slot: Exercise['lift_slot'] = null): Exercise =>
  ({ id, name, lift_slot } as unknown as Exercise);

const pr = (exercise_id: string, rep_count: number, value_kg: number): AthletePRHistory =>
  ({
    id: `${exercise_id}-${rep_count}`,
    exercise_id,
    rep_count,
    value_kg,
    achieved_date: '2026-07-01',
    created_at: '2026-07-01T10:00:00Z',
  } as unknown as AthletePRHistory);

const REFS: RefValues = { currentSn: 100, currentCj: 120, goalSn: 105, goalCj: 125 };

const BSQ: SollIstRow = { exerciseId: 'bsq', label: 'Back squat', refSlot: 'clean_and_jerk', indexPct: 120, reps: 3 };
const PULL: SollIstRow = { exerciseId: 'pull', label: 'Snatch pull', refSlot: 'snatch', indexPct: 108, reps: 1 };

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

  it('keeps Ist empty (index sheet) when no Ist map entries exist', () => {
    const [row] = computeSollIst([PULL], REFS, new Map());
    expect(row.soll).toBeCloseTo(108);
    expect(row.ist).toBeNull();
    expect(row.deltaKg).toBeNull();
    expect(row.target).toBeCloseTo(113.4);
  });

  it('returns null Soll when the reference value is missing', () => {
    const [row] = computeSollIst([PULL], { ...REFS, currentSn: null }, new Map());
    expect(row.soll).toBeNull();
    expect(row.deltaPct).toBeNull();
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
});

describe('suggestReference', () => {
  it('uses the real 1RM when present, implied otherwise', () => {
    const sn = ex('sn', 'Snatch', 'snatch');
    expect(suggestReference(sn, [pr('sn', 1, 100)])).toEqual({ valueKg: 100, source: 'real' });
    const implied = suggestReference(sn, [pr('sn', 3, 92)]);
    expect(implied?.source).toBe('estimated');
    expect(implied!.valueKg).toBeGreaterThan(92);
    expect(suggestReference(sn, [])).toBeNull();
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

describe('CSV round-trip', () => {
  const exercises = [ex('bsq', 'Back squat'), ex('pull', 'Snatch pull')];

  it('parses semicolon CSV with decimal commas and Kategorie refs', () => {
    const { rows, warnings } = parseModelCsv(
      'exercise;ref;index;reps\nBack squat;2;117,5;3\nSnatch pull;SN;108;1\n',
      exercises,
    );
    expect(warnings).toEqual([]);
    expect(rows).toEqual([
      { exerciseId: 'bsq', label: 'Back squat', refSlot: 'clean_and_jerk', indexPct: 117.5, reps: 3 },
      { exerciseId: 'pull', label: 'Snatch pull', refSlot: 'snatch', indexPct: 108, reps: 1 },
    ]);
  });

  it('keeps unmatched exercises as unmapped rows with a warning', () => {
    const { rows, warnings } = parseModelCsv('Mystery lift,SN,90,1', exercises);
    expect(rows[0].exerciseId).toBeNull();
    expect(rows[0].label).toBe('Mystery lift');
    expect(warnings).toHaveLength(1);
  });

  it('rejects bad refs and reps with line-numbered warnings', () => {
    const { rows, warnings } = parseModelCsv('Back squat;XX;120;3\nBack squat;CJ;120;12', exercises);
    expect(rows).toHaveLength(0);
    expect(warnings.some((w) => w.includes('Line 1'))).toBe(true);
    expect(warnings.some((w) => w.includes('Line 2'))).toBe(true);
  });

  it('round-trips through modelToCsv', () => {
    const rows: SollIstRow[] = [
      { exerciseId: 'bsq', label: 'Back squat', refSlot: 'clean_and_jerk', indexPct: 117.5, reps: 3 },
    ];
    const { rows: parsed, warnings } = parseModelCsv(modelToCsv(rows), exercises);
    expect(warnings).toEqual([]);
    expect(parsed).toEqual(rows);
  });
});

describe('preset resolution', () => {
  it('resolves via lift_slot first, then name, leaving the rest unmapped', () => {
    const exercises = [
      ex('bs', 'Squat variation X', 'back_squat'), // lift_slot beats name
      ex('sp', 'Snatch Pull'),
      ex('pp', 'Push Press behind neck'),
    ];
    const senior = SOLLIST_PRESETS.find((p) => p.key === 'bvdg_senior')!;
    const rows = resolvePreset(senior, exercises);
    const byLabel = (l: string) => rows.find((r) => r.label.toLowerCase().includes(l));
    expect(byLabel('squat variation x')?.exerciseId).toBe('bs');
    expect(byLabel('snatch pull')?.exerciseId).toBe('sp');
    expect(byLabel('push press')?.exerciseId).toBe('pp');
    // Something with no counterpart stays unmapped but keeps its label.
    const unmapped = rows.find((r) => r.exerciseId === null);
    expect(unmapped).toBeDefined();
  });
});
