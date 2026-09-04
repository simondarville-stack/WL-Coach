/**
 * Combo rep tuples must survive the athlete's log.
 *
 * A combo prescription ("90×1+1+1×3") stores the tuple in
 * planned_set_lines.reps_text and only its SUM in .reps. The one-tap ✓ used
 * to copy the sum into performed_reps and leave performed_text null, so a
 * clean + 2 jerks was recorded — and displayed everywhere — as "3".
 *
 * These tests pin the contract SetEntryRow now upholds:
 *   performed_reps keeps the sum (volume math), performed_text keeps the
 *   tuple (display, and the per-member split in analysis/factFetch).
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { PlannedSetLine } from '../../../../lib/database.types';
import { SetEntryRow, expandSetLines, type SetRowInput } from '../SetEntryRow';

function comboLine(overrides: Partial<PlannedSetLine> = {}): PlannedSetLine {
  return {
    id: 'l1',
    planned_exercise_id: 'pe1',
    sets: 3,
    sets_max: null,
    reps: 3, // the SUM of 1+1+1
    reps_max: null,
    reps_text: '1+1+1',
    load_value: 90,
    load_max: null,
    load_cmp: null,
    position: 1,
    notes: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('expandSetLines — combo rows', () => {
  it('carries the rep tuple and asks for a "+"-capable keyboard', () => {
    const rows = expandSetLines([comboLine()], 'absolute_kg');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.plannedRepsText).toBe('1+1+1');
      expect(r.plannedRepsTuple).toBe('1+1+1');
      expect(r.plannedRepsValue).toBe(3);
      expect(r.comboReps).toBe(true);
    }
  });

  it('keeps the grouped "m(a+b)" form intact', () => {
    const [row] = expandSetLines([comboLine({ reps_text: '2(1+1)', reps: 4 })], 'absolute_kg');
    expect(row.plannedRepsTuple).toBe('2(1+1)');
    expect(row.plannedRepsValue).toBe(4);
  });

  it('leaves an ordinary prescription without a tuple', () => {
    const [row] = expandSetLines([comboLine({ reps_text: null, reps: 5 })], 'absolute_kg');
    expect(row.plannedRepsTuple).toBeNull();
    expect(row.comboReps).toBe(false);
  });
});

/** The payload SetEntryRow hands its parent — typed so the assertions below
 *  read `mock.calls[0][0]` rather than an untyped tuple. */
type SavePatch = Parameters<ComponentProps<typeof SetEntryRow>['onSave']>[0];

describe('SetEntryRow — combo reps round-trip', () => {
  const onSave = vi.fn<(patch: SavePatch) => Promise<void>>(() => Promise.resolve());

  beforeEach(() => {
    cleanup();
    onSave.mockClear();
  });

  const comboRow: SetRowInput = {
    setNumber: 1,
    plannedRepsText: '1+1+1',
    plannedLoadText: '90',
    plannedRepsValue: 3,
    plannedLoadValue: 90,
    loadIsKg: true,
    plannedRepsTuple: '1+1+1',
    comboReps: true,
  };

  it('records the prescribed tuple on a value-less ✓, not just its sum', async () => {
    render(<SetEntryRow input={comboRow} logged={null} onSave={onSave} />);
    fireEvent.click(screen.getByTitle('Did this set'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      status: 'completed',
      performedLoad: 90,
      performedReps: 3, // the sum still drives tonnage
      performedText: '1+1+1', // …and the tuple is what a coach reads
    });
  });

  it('keeps a tuple the athlete typed themselves', async () => {
    render(<SetEntryRow input={comboRow} logged={null} onSave={onSave} />);
    const reps = screen.getByPlaceholderText('1+1+1');
    fireEvent.change(reps, { target: { value: '1+1+0' } });
    fireEvent.blur(reps);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      performedReps: 2,
      performedText: '1+1+0',
    });
  });

  it('clears a stale tuple when the athlete types a plain number over it', async () => {
    render(
      <SetEntryRow
        input={comboRow}
        logged={{
          id: 's1',
          owner_id: null,
          log_exercise_id: 'le1',
          set_number: 1,
          planned_load: 90,
          planned_reps: 3,
          performed_load: 90,
          performed_reps: 3,
          performed_text: '1+1+1',
          rpe: null,
          status: 'completed',
          notes: null,
          created_at: '2026-06-01T00:00:00Z',
          updated_at: '2026-06-01T00:00:00Z',
        }}
        onSave={onSave}
      />,
    );
    const reps = screen.getByDisplayValue('1+1+1');
    fireEvent.change(reps, { target: { value: '2' } });
    fireEvent.blur(reps);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      performedReps: 2,
      performedText: null,
    });
  });

  it('leaves performed_text null for an ordinary (non-combo) ✓', async () => {
    render(
      <SetEntryRow
        input={{
          setNumber: 1,
          plannedRepsText: '5',
          plannedLoadText: '100',
          plannedRepsValue: 5,
          plannedLoadValue: 100,
          loadIsKg: true,
        }}
        logged={null}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTitle('Did this set'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      performedReps: 5,
      performedText: null,
    });
  });
});
