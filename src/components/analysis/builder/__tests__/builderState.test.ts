import { describe, it, expect } from 'vitest';
import { buildQuery, defaultBuilderState } from '../builderState';
import { createRegistry } from '../../../../lib/analysis';

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
