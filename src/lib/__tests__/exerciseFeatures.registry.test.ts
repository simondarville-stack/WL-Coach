/**
 * FEATURE_REGISTRY is the single source of truth for the planner's "+" feature
 * menu. Until 0.108.3 ExerciseFeatureControls restated every icon and label
 * inline, so the registry was authoritative in name only and the two could
 * drift without anything failing. These tests pin the registry's shape so the
 * derived menu keeps working, and assert the properties the menu relies on.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_REGISTRY } from '../exerciseFeatures';
import type { ExerciseFeatures } from '../database.types';

describe('FEATURE_REGISTRY', () => {
  it('covers every key of the features bag exactly once', () => {
    // A key in the bag with no registry entry can never be added from the
    // menu; a duplicate would render twice.
    const keys = FEATURE_REGISTRY.map(d => d.key);
    expect(new Set(keys).size).toBe(keys.length);

    // Keep in step with ExerciseFeatures. Written out so adding a field to the
    // bag without a registry entry fails here rather than silently.
    const expected: Array<keyof ExerciseFeatures> = [
      'totalTime', 'restTime', 'tempo', 'totalReps', 'totalSets', 'highestLoad', 'avgLoad',
    ];
    expect([...keys].sort()).toEqual([...expected].sort());
  });

  it('gives every entry a non-empty icon and label', () => {
    for (const def of FEATURE_REGISTRY) {
      expect(def.icon.trim(), `icon for ${def.key}`).not.toBe('');
      expect(def.label.trim(), `label for ${def.key}`).not.toBe('');
    }
  });

  it('marks the summary overrides coach-only and the prescription content athlete-visible', () => {
    const coachOnly = FEATURE_REGISTRY.filter(d => d.coachOnly).map(d => d.key).sort();
    const visible = FEATURE_REGISTRY.filter(d => !d.coachOnly).map(d => d.key).sort();
    // The overrides rewrite summary_* and must never reach the athlete app.
    expect(coachOnly).toEqual(['avgLoad', 'highestLoad', 'totalReps', 'totalSets']);
    expect(visible).toEqual(['restTime', 'tempo', 'totalTime']);
  });
});
