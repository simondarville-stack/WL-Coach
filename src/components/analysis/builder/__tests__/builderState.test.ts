import { describe, it, expect } from 'vitest';
import { buildQuery, defaultBuilderState, previousScope } from '../builderState';
import { createRegistry, type Scope } from '../../../../lib/analysis';
import { weekStartsBetween } from '../../../../lib/dateUtils';

const reg = createRegistry([]);
const today = '2026-06-08';

describe('buildQuery — multi-subject is shown side by side, never summed', () => {
  it('auto-splits multiple athletes by adding athlete as a column', () => {
    const q = buildQuery({ ...defaultBuilderState(today), athleteIds: ['A1', 'A2'] }, reg, today);
    expect(q.cols).toContain('athlete');
    expect(q.viz.series).toBe('athlete');
  });

  it('does not split a single athlete', () => {
    const q = buildQuery({ ...defaultBuilderState(today), athleteIds: ['A1'] }, reg, today);
    expect(q.cols).not.toContain('athlete');
  });

  it('splits a group selection by athlete too', () => {
    const q = buildQuery({ ...defaultBuilderState(today), groupIds: ['G1'] }, reg, today);
    expect(q.cols).toContain('athlete');
  });

  it('respects an explicit athlete dimension (no duplicate)', () => {
    const q = buildQuery({ ...defaultBuilderState(today), athleteIds: ['A1', 'A2'], rows: ['athlete'], cols: [] }, reg, today);
    expect(q.cols).not.toContain('athlete');
  });

  it('respects an explicit group aggregate (does not force athlete split)', () => {
    const q = buildQuery({ ...defaultBuilderState(today), groupIds: ['G1'], rows: ['group'], cols: [] }, reg, today);
    expect(q.cols).not.toContain('athlete');
  });
});

describe('previousScope — period-over-period windows align to equal week counts', () => {
  it('date-range prior window has the same number of Mondays as the base', () => {
    const scope: Scope = { mode: 'dateRange', from: '2026-06-02', to: '2026-06-22' }; // Tue→Mon, 21 days
    const base = weekStartsBetween(scope.from, scope.to);
    const prev = previousScope(scope, '2026-06-22');
    expect(prev.mode).toBe('dateRange');
    if (prev.mode !== 'dateRange') return;
    const prevWeeks = weekStartsBetween(prev.from, prev.to);
    expect(prevWeeks.length).toBe(base.length);
    expect(prevWeeks.length).toBeGreaterThan(0);
    expect(prevWeeks[prevWeeks.length - 1] < base[0]).toBe(true); // no overlap
  });
});
