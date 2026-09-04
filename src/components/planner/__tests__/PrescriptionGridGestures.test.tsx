import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { PrescriptionGrid } from '../PrescriptionGrid';

/**
 * The two gestures the grid owns, tested through the real component because
 * both of them write: Alt+click re-units the row and Ctrl+click can expand one
 * cell into several columns. A pure-function test cannot catch the case that
 * actually hurts — a write that lands but loses part of the prescription.
 */

/** Mirrors a real call site: echoes the saved raw back and applies the unit. */
function Harness({ raw, unit: initialUnit, isCombo, clickIncrement, onWrite }: {
  raw: string;
  unit: string;
  isCombo?: boolean;
  clickIncrement?: number;
  onWrite: (raw: string, unit?: string) => void;
}) {
  const [value, setValue] = useState(raw);
  const [unit, setUnit] = useState(initialUnit);
  return (
    <PrescriptionGrid
      prescriptionRaw={value}
      unit={unit}
      loadIncrement={5}
      clickIncrement={clickIncrement}
      isCombo={isCombo}
      onSave={(next, unitOverride) => {
        onWrite(next, unitOverride);
        setValue(next);
        if (unitOverride) setUnit(unitOverride);
      }}
    />
  );
}

/** The load cell is the first button in the grid. */
const loadCell = () => screen.getAllByRole('button')[0];

describe('Alt+click cycles the unit', () => {
  it('cycles forward and writes the raw and the unit in one call', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0, altKey: true });

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith('80%×3×5', 'percentage');
    expect(screen.getByText('Percentage')).toBeTruthy();
  });

  it('cycles backward on Alt+right-click without also changing the load', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="percentage" onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 2, altKey: true });

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith('80×3×5', 'absolute_kg');
  });

  it('refuses to shed a soft-load sign, and writes nothing', () => {
    // free_text_reps stores only `loadText × reps × sets`, and cycling back
    // does not restore the sign — so the transition is declined, not taken.
    const onWrite = vi.fn();
    render(<Harness raw="≥80%×3" unit="percentage" onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0, altKey: true });

    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByText(/would be lost/)).toBeTruthy();
  });

  it('refuses to shed an interval upper bound, and writes nothing', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80-90%×3" unit="percentage" onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0, altKey: true });

    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByText(/would be lost/)).toBeTruthy();
  });

  it('refuses a rep range too', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80%×3-5" unit="percentage" onWrite={onWrite} />);
    fireEvent.mouseDown(loadCell(), { button: 0, altKey: true });
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe('Ctrl+click takes a whole notation line', () => {
  const typeInCell = (text: string) => {
    fireEvent.mouseDown(loadCell(), { button: 0, ctrlKey: true });
    const input = document.querySelector('input.pgrid-editing') as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('expands a bare comma list into one column per load', () => {
    const onWrite = vi.fn();
    render(<Harness raw="50×1" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('30,40,50');

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0][0]).toBe('30×1, 40×1, 50×1');
  });

  it('reads reps and sets per segment', () => {
    const onWrite = vi.fn();
    render(<Harness raw="50×1" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('30x2, 40x2x2, 50');

    expect(onWrite.mock.calls[0][0]).toBe('30×2, 40×2×2, 50×1');
  });

  it('splices in place of the edited column, keeping the others', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3, 90×2" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('30,40');

    expect(onWrite.mock.calls[0][0]).toBe('30×1, 40×1, 90×2');
  });

  it('stores a quoted literal as a label and re-units the row, in one write', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×1" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('"30x2"');

    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite).toHaveBeenCalledWith('"30x2" × 1', 'free_text_reps');
  });

  it('still takes a text load whose spelling contains an x', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×1" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('Max');

    expect(onWrite).toHaveBeenCalledWith('"Max" × 1', 'free_text_reps');
  });

  it('refuses an unreadable line rather than storing half of it', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3, 90×2" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('30x2, 50kg, 40x3');

    expect(onWrite).not.toHaveBeenCalled();
    expect(screen.getByText(/Could not read/)).toBeTruthy();
  });

  it('leaves a single value alone — a plain number keeps its reps', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" onWrite={onWrite} />);

    typeInCell('90');

    expect(onWrite.mock.calls[0][0]).toBe('90×3×5');
  });

  it('leaves an interval and a German decimal alone', () => {
    const onWrite = vi.fn();
    const { unmount } = render(<Harness raw="80×3" unit="absolute_kg" onWrite={onWrite} />);
    typeInCell('80-90');
    expect(onWrite.mock.calls[0][0]).toBe('80-90×3');
    unmount();

    const onWrite2 = vi.fn();
    render(<Harness raw="80×3" unit="absolute_kg" onWrite={onWrite2} />);
    typeInCell('82,5');
    // Comma decimals are not accepted as input anywhere in EMOS; the point is
    // that it does NOT become a 82 column plus a phantom 5 column.
    expect(onWrite2.mock.calls[0][0]).toBe('82×3');
  });
});

/**
 * The click increment is a coach setting (`grid_click_increment`) that used to
 * be saveable and inert — nothing read it. These pin the wiring: the value has
 * to reach the load cell, and it must NOT reach the counts.
 */
describe('the coach click increment and the Shift jump', () => {
  const repsCell = () => screen.getAllByRole('button')[1];
  const setsCell = () => screen.getAllByRole('button')[2];

  it('moves a load cell by the coach increment, not by 1', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0 });
    expect(onWrite).toHaveBeenCalledWith('82.5×3×5', undefined);
  });

  it('multiplies the increment by 5 under Shift', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0, shiftKey: true });
    expect(onWrite).toHaveBeenCalledWith('92.5×3×5', undefined);
  });

  it('goes down by the same amounts on right-click', () => {
    const onWrite = vi.fn();
    const { unmount } = render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite} />);
    fireEvent.mouseDown(loadCell(), { button: 2 });
    expect(onWrite).toHaveBeenCalledWith('77.5×3×5', undefined);
    unmount();

    const onWrite2 = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite2} />);
    fireEvent.mouseDown(loadCell(), { button: 2, shiftKey: true });
    expect(onWrite2).toHaveBeenCalledWith('67.5×3×5', undefined);
  });

  it('leaves reps and sets stepping by 1 whatever the increment says', () => {
    const onWrite = vi.fn();
    const { unmount } = render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite} />);
    fireEvent.mouseDown(repsCell(), { button: 0 });
    // 4 reps, not 5,5 — a prescription cannot ask for half a rep.
    expect(onWrite).toHaveBeenCalledWith('80×4×5', undefined);
    unmount();

    const onWrite2 = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite2} />);
    fireEvent.mouseDown(setsCell(), { button: 0 });
    expect(onWrite2).toHaveBeenCalledWith('80×3×6', undefined);
  });

  it('still gives counts the Shift jump, in whole numbers', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" clickIncrement={2.5} onWrite={onWrite} />);

    fireEvent.mouseDown(repsCell(), { button: 0, shiftKey: true });
    expect(onWrite).toHaveBeenCalledWith('80×8×5', undefined);
  });

  it('defaults to 1 when no increment is threaded', () => {
    const onWrite = vi.fn();
    render(<Harness raw="80×3×5" unit="absolute_kg" onWrite={onWrite} />);

    fireEvent.mouseDown(loadCell(), { button: 0 });
    expect(onWrite).toHaveBeenCalledWith('81×3×5', undefined);
  });
});
