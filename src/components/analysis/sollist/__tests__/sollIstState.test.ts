import { describe, it, expect } from 'vitest';
import { computeSollIst, type RefValuesMap, type SollIstRow } from '../../../../lib/sollIst';
import { buildRowGroups, defaultView, type SheetRef, type SheetView } from '../sollIstState';

const REFS: SheetRef[] = [
  { key: 'sn', label: 'Snatch', exerciseId: 'sn-ex', current: 100, goal: 105 },
  { key: 'cj', label: 'Clean & Jerk', exerciseId: 'cj-ex', current: 120, goal: 125 },
];
const VALUES: RefValuesMap = { sn: { current: 100, goal: 105 }, cj: { current: 120, goal: 125 } };

const row = (exerciseId: string, label: string, refKey: string, indexPct: number): SollIstRow => ({
  exerciseId,
  label,
  refKey,
  indexPct,
  reps: 1,
});

const ROWS = [
  row('bsq', 'Back squat', 'cj', 120),
  row('fsq', 'Front squat', 'cj', 105),
  row('pull', 'Snatch pull', 'sn', 108),
  row('psn', 'Power snatch', 'sn', 80),
];

const CATEGORY: Record<string, string> = { bsq: 'Squats', fsq: 'Squats', pull: 'Pulls' }; // psn intentionally uncategorised
const categoryOf = (id: string | null) => (id ? CATEGORY[id] ?? null : null);
const ORDER = ['Pulls', 'Squats'];

const CODE: Record<string, string> = { bsq: 'K4a', fsq: 'K4b', pull: 'K3a' }; // psn has no code
const codeOf = (id: string | null) => (id ? CODE[id] ?? null : null);

const computed = () => computeSollIst(ROWS, VALUES, new Map());
const view = (patch: Partial<SheetView>): SheetView => ({ ...defaultView(), ...patch });

describe('buildRowGroups', () => {
  it('passes everything through as one unlabelled group by default', () => {
    const groups = buildRowGroups(computed(), defaultView(), REFS, categoryOf, ORDER);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat', 'Snatch pull', 'Power snatch']);
  });

  it('searches exercise codes as well as names', () => {
    const byCode = buildRowGroups(computed(), view({ search: 'k4' }), REFS, categoryOf, ORDER, codeOf);
    expect(byCode[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat']);

    const exact = buildRowGroups(computed(), view({ search: 'k3a' }), REFS, categoryOf, ORDER, codeOf);
    expect(exact[0].rows.map((c) => c.row.label)).toEqual(['Snatch pull']);
  });

  it('omitting codeOf keeps the name-only behaviour', () => {
    const groups = buildRowGroups(computed(), view({ search: 'k4' }), REFS, categoryOf, ORDER);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(0);
  });

  it('filters by search, reference and category', () => {
    const bySearch = buildRowGroups(computed(), view({ search: 'squat' }), REFS, categoryOf, ORDER);
    expect(bySearch[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat']);

    const byRef = buildRowGroups(computed(), view({ refFilter: 'sn' }), REFS, categoryOf, ORDER);
    expect(byRef[0].rows.map((c) => c.row.label)).toEqual(['Snatch pull', 'Power snatch']);

    const byCat = buildRowGroups(computed(), view({ categoryFilter: 'Squats' }), REFS, categoryOf, ORDER);
    expect(byCat[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat']);

    // The pseudo-category for uncategorised rows is filterable too.
    const noCat = buildRowGroups(computed(), view({ categoryFilter: '—' }), REFS, categoryOf, ORDER);
    expect(noCat[0].rows.map((c) => c.row.label)).toEqual(['Power snatch']);
  });

  it('groups by reference in sheet-reference order with full labels', () => {
    const groups = buildRowGroups(computed(), view({ groupBy: 'ref' }), REFS, categoryOf, ORDER);
    expect(groups.map((g) => g.label)).toEqual(['Snatch', 'Clean & Jerk']);
    expect(groups[0].rows.map((c) => c.row.label)).toEqual(['Snatch pull', 'Power snatch']);
    expect(groups[1].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat']);
  });

  it('collects rows with unknown reference keys into an explicit group', () => {
    const orphanRows = [...ROWS, row('x', 'Mystery', 'gone', 90)];
    const groups = buildRowGroups(computeSollIst(orphanRows, VALUES, new Map()), view({ groupBy: 'ref' }), REFS, categoryOf, ORDER);
    expect(groups.map((g) => g.label)).toEqual(['Snatch', 'Clean & Jerk', 'Unknown reference']);
  });

  it('groups by category in catalogue order, uncategorised last', () => {
    const groups = buildRowGroups(computed(), view({ groupBy: 'category' }), REFS, categoryOf, ORDER);
    expect(groups.map((g) => g.label)).toEqual(['Pulls', 'Squats', 'No category']);
    expect(groups[0].rows.map((c) => c.row.label)).toEqual(['Snatch pull']);
  });

  it('sorts within groups, keeps model order on ties, nulls last', () => {
    const sorted = buildRowGroups(computed(), view({ sort: { key: 'index', dir: -1 } }), REFS, categoryOf, ORDER);
    expect(sorted[0].rows.map((c) => c.row.indexPct)).toEqual([120, 108, 105, 80]);

    const alpha = buildRowGroups(computed(), view({ sort: { key: 'exercise', dir: 1 } }), REFS, categoryOf, ORDER);
    expect(alpha[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat', 'Power snatch', 'Snatch pull']);

    // Ist is null for every row (no athlete): original order must survive.
    const byIst = buildRowGroups(computed(), view({ sort: { key: 'ist', dir: -1 } }), REFS, categoryOf, ORDER);
    expect(byIst[0].rows.map((c) => c.row.label)).toEqual(['Back squat', 'Front squat', 'Snatch pull', 'Power snatch']);
  });

  it('combines filter + sort + group', () => {
    const groups = buildRowGroups(
      computed(),
      view({ search: 's', groupBy: 'ref', sort: { key: 'index', dir: 1 } }),
      REFS,
      categoryOf,
      ORDER,
    );
    // 's' matches all four; grouped by ref, ascending index inside each.
    expect(groups[0].rows.map((c) => c.row.indexPct)).toEqual([80, 108]);
    expect(groups[1].rows.map((c) => c.row.indexPct)).toEqual([105, 120]);
  });
});
