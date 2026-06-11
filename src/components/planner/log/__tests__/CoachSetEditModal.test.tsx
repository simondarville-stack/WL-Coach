/**
 * Regression test for COACH-REVIEW-1 (critical).
 *
 * upsertLoggedSet does a WHOLE-ROW upsert: any field the caller omits is
 * written back as NULL. The coach edit modal only edits load/reps/status,
 * so it must carry the athlete's free-text / combo-tuple value
 * (performed_text, e.g. "2+2+2") and legacy notes through every save —
 * otherwise a routine kg correction, or even a ✓/✗ status toggle, silently
 * destroys logged athlete data. These tests assert both the status-toggle
 * and the value-edit paths forward those fields.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { TrainingLogSet } from '../../../../lib/database.types';

// Stub the service so no Supabase client is constructed and we can inspect
// the exact payload the modal sends. vi.hoisted keeps the spies available to
// the (hoisted) vi.mock factory without a temporal-dead-zone error.
const { upsertLoggedSet, deleteLoggedSet } = vi.hoisted(() => ({
  upsertLoggedSet: vi.fn(),
  deleteLoggedSet: vi.fn(),
}));
vi.mock('../../../../lib/trainingLogService', () => ({ upsertLoggedSet, deleteLoggedSet }));

import { CoachSetEditModal } from '../CoachSetEditModal';

function makeSet(overrides: Partial<TrainingLogSet> = {}): TrainingLogSet {
  return {
    id: 's1',
    owner_id: 'o1',
    log_exercise_id: 'le1',
    set_number: 1,
    planned_load: 80,
    planned_reps: 3,
    performed_load: 80,
    performed_reps: 6,
    performed_text: '2+2+2', // combo tuple — the value most at risk
    rpe: null,
    status: 'completed',
    notes: 'felt smooth',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('CoachSetEditModal — athlete data preservation (COACH-REVIEW-1)', () => {
  beforeEach(() => {
    cleanup();
    upsertLoggedSet.mockReset();
    deleteLoggedSet.mockReset();
    // Resolve to a saved row so saveRow's local-id → real-id swap succeeds.
    upsertLoggedSet.mockImplementation((args: { status?: TrainingLogSet['status'] }) =>
      Promise.resolve(makeSet({ status: args.status ?? 'completed' })),
    );
  });

  it('carries performed_text + notes through when the coach toggles status', async () => {
    render(
      <CoachSetEditModal
        open
        exerciseName="Snatch"
        logExerciseId="le1"
        loggedSets={[makeSet()]}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );

    // Toggling ✗ must not wipe the athlete's tuple/notes.
    fireEvent.click(screen.getByTitle("Didn't do this set"));

    await waitFor(() => expect(upsertLoggedSet).toHaveBeenCalledTimes(1));
    expect(upsertLoggedSet).toHaveBeenCalledWith(
      expect.objectContaining({
        logExerciseId: 'le1',
        setNumber: 1,
        status: 'skipped',
        performedText: '2+2+2',
        notes: 'felt smooth',
      }),
    );
  });

  it('preserves performed_text + notes when the coach edits the load value', async () => {
    render(
      <CoachSetEditModal
        open
        exerciseName="Snatch"
        logExerciseId="le1"
        loggedSets={[makeSet()]}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );

    // performed_load=80 → the load cell's value is "80" (reps cell is "6").
    const loadInput = screen.getByDisplayValue('80');
    fireEvent.change(loadInput, { target: { value: '85' } });
    fireEvent.blur(loadInput);

    await waitFor(() => expect(upsertLoggedSet).toHaveBeenCalled());
    expect(upsertLoggedSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        performedLoad: 85,
        performedText: '2+2+2',
        notes: 'felt smooth',
      }),
    );
  });

  it('refreshes the parent once on close, not on every edit', async () => {
    const onChanged = vi.fn();
    render(
      <CoachSetEditModal
        open
        exerciseName="Snatch"
        logExerciseId="le1"
        loggedSets={[makeSet()]}
        onClose={() => {}}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByTitle("Didn't do this set"));
    await waitFor(() => expect(upsertLoggedSet).toHaveBeenCalledTimes(1));
    // The edit is persisted, but the page must NOT reload mid-edit.
    expect(onChanged).not.toHaveBeenCalled();

    // Closing flushes a single refresh.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });
});
