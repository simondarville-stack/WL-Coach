import { describe, it, expect } from 'vitest';
import {
  buildParentIndex,
  buildChildrenIndex,
  resolveRootId,
  resolveAncestorPath,
  depthOf,
  wouldCreateCycle,
  getDescendantIds,
  resolveFamilyName,
  type HierNode,
} from '../exerciseHierarchy';

// Family: Snatch (root) → Snatch from hang → { low hang, high hang }
//         Back Squat (root, flat)
//         Orphan child whose parent is not in the set (dangling)
const node = (id: string, parent: string | null = null): HierNode => ({
  id,
  parent_exercise_id: parent,
});

const NODES: HierNode[] = [
  node('snatch'),
  node('hang', 'snatch'),
  node('low_hang', 'hang'),
  node('high_hang', 'hang'),
  node('bsq'),
  node('orphan', 'missing_parent'),
];

const NAMES: Record<string, string> = {
  snatch: 'Snatch',
  hang: 'Snatch from hang',
  low_hang: 'Snatch from low hang',
  high_hang: 'Snatch from high hang',
  bsq: 'Back Squat',
  orphan: 'Orphan',
};

describe('buildParentIndex', () => {
  it('maps every node to its immediate parent (null for roots)', () => {
    const idx = buildParentIndex(NODES);
    expect(idx.get('snatch')).toBeNull();
    expect(idx.get('hang')).toBe('snatch');
    expect(idx.get('low_hang')).toBe('hang');
    expect(idx.get('orphan')).toBe('missing_parent');
    expect(idx.size).toBe(6);
  });
});

describe('resolveRootId', () => {
  const idx = buildParentIndex(NODES);

  it('resolves a root to itself', () => {
    expect(resolveRootId('snatch', idx)).toBe('snatch');
    expect(resolveRootId('bsq', idx)).toBe('bsq');
  });

  it('walks a single level up to the root', () => {
    expect(resolveRootId('hang', idx)).toBe('snatch');
  });

  it('walks multiple levels up to the root', () => {
    expect(resolveRootId('low_hang', idx)).toBe('snatch');
    expect(resolveRootId('high_hang', idx)).toBe('snatch');
  });

  it('treats a dangling parent as the top (node becomes root)', () => {
    expect(resolveRootId('orphan', idx)).toBe('orphan');
  });

  it('resolves an unknown id to itself (defensive)', () => {
    expect(resolveRootId('does_not_exist', idx)).toBe('does_not_exist');
  });

  it('never hangs on a self-loop (defensive)', () => {
    const loop = buildParentIndex([node('a', 'a')]);
    expect(resolveRootId('a', loop)).toBe('a');
  });

  it('never hangs on a multi-hop cycle (defensive)', () => {
    const cyc = buildParentIndex([node('a', 'b'), node('b', 'c'), node('c', 'a')]);
    // Each node deterministically becomes its own root; no infinite loop.
    expect(resolveRootId('a', cyc)).toBe('a');
    expect(resolveRootId('b', cyc)).toBe('b');
    expect(resolveRootId('c', cyc)).toBe('c');
  });
});

describe('resolveAncestorPath', () => {
  const idx = buildParentIndex(NODES);

  it('returns [self, parent, …, root] nearest-first', () => {
    expect(resolveAncestorPath('low_hang', idx)).toEqual(['low_hang', 'hang', 'snatch']);
  });

  it('returns [self] for a root', () => {
    expect(resolveAncestorPath('snatch', idx)).toEqual(['snatch']);
  });

  it('stops at a dangling parent', () => {
    expect(resolveAncestorPath('orphan', idx)).toEqual(['orphan']);
  });

  it('is cycle-safe', () => {
    const cyc = buildParentIndex([node('a', 'b'), node('b', 'a')]);
    expect(resolveAncestorPath('a', cyc)).toEqual(['a', 'b']);
  });
});

describe('depthOf', () => {
  const idx = buildParentIndex(NODES);
  it('is 0 at root, 1 for direct child, 2 for grandchild', () => {
    expect(depthOf('snatch', idx)).toBe(0);
    expect(depthOf('hang', idx)).toBe(1);
    expect(depthOf('low_hang', idx)).toBe(2);
  });
});

describe('wouldCreateCycle', () => {
  const idx = buildParentIndex(NODES);

  it('rejects self-parenting', () => {
    expect(wouldCreateCycle('hang', 'hang', idx)).toBe(true);
  });

  it('rejects parenting under a direct descendant', () => {
    // Making "snatch" a child of "hang" would loop (hang is a descendant).
    expect(wouldCreateCycle('snatch', 'hang', idx)).toBe(true);
  });

  it('rejects parenting under a deep descendant', () => {
    expect(wouldCreateCycle('snatch', 'low_hang', idx)).toBe(true);
  });

  it('allows a valid re-parent (non-descendant target)', () => {
    // Move "low_hang" under "bsq" — no cycle.
    expect(wouldCreateCycle('low_hang', 'bsq', idx)).toBe(false);
  });

  it('allows parenting under a sibling', () => {
    expect(wouldCreateCycle('low_hang', 'high_hang', idx)).toBe(false);
  });

  it('allows attaching a current root under another tree', () => {
    expect(wouldCreateCycle('bsq', 'hang', idx)).toBe(false);
  });
});

describe('getDescendantIds', () => {
  const childrenIdx = buildChildrenIndex(NODES);

  it('collects all transitive descendants, excluding self', () => {
    expect(getDescendantIds('snatch', childrenIdx)).toEqual(
      new Set(['hang', 'low_hang', 'high_hang']),
    );
  });

  it('collects direct children only when there are no grandchildren', () => {
    expect(getDescendantIds('hang', childrenIdx)).toEqual(new Set(['low_hang', 'high_hang']));
  });

  it('returns empty for a leaf', () => {
    expect(getDescendantIds('low_hang', childrenIdx)).toEqual(new Set());
  });

  it('is cycle-safe', () => {
    const cyc = buildChildrenIndex([node('a', 'b'), node('b', 'a')]);
    // a's children include b, b's children include a — must not loop.
    expect(getDescendantIds('a', cyc)).toEqual(new Set(['b']));
  });
});

describe('resolveFamilyName', () => {
  const idx = buildParentIndex(NODES);
  const nameById = (id: string) => NAMES[id];

  it('labels a child with its root family name', () => {
    expect(resolveFamilyName('low_hang', idx, nameById, '(unknown)')).toBe('Snatch');
    expect(resolveFamilyName('hang', idx, nameById, '(unknown)')).toBe('Snatch');
  });

  it('labels a root with its own name', () => {
    expect(resolveFamilyName('bsq', idx, nameById, '(unknown)')).toBe('Back Squat');
  });

  it('falls back when the root name is unknown', () => {
    expect(resolveFamilyName('ghost', idx, () => undefined, '(deleted)')).toBe('(deleted)');
  });
});
