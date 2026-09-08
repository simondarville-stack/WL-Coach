import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { PrescriptionGrid } from '../PrescriptionGrid';
import { StackedNotation } from '../StackedNotation';
import type { PRLimit, PRLimitSet } from '../../../lib/prLimits';

/**
 * A line planned above the athlete's PR at its rep count renders bold, on
 * both surfaces that show a prescription: the editable grid and the
 * read-only stacked notation. Tested through the components because the
 * mark is a class on the grid column and a font weight on the notation —
 * the pure verdict is covered in lib/__tests__/prLimits.test.ts.
 */

const snatch: PRLimit = {
  real: new Map([[1, 100], [3, 90]]),
  anchors: [{ reps: 1, valueKg: 100 }, { reps: 3, valueKg: 90 }],
  oneRM: 100,
  name: 'Snatch',
};
const limits: PRLimitSet = { self: snatch };

function GridHarness({ raw, unit, prLimits }: { raw: string; unit: string; prLimits: PRLimitSet | null }) {
  const [value, setValue] = useState(raw);
  return (
    <PrescriptionGrid
      prescriptionRaw={value}
      unit={unit}
      loadIncrement={5}
      clickIncrement={1}
      prLimits={prLimits}
      onSave={next => setValue(next)}
    />
  );
}

const columns = (c: HTMLElement) => Array.from(c.querySelectorAll('.pgrid-col'));
const isBeyond = (col: Element) => col.classList.contains('pgrid-beyond-pr');

describe('PrescriptionGrid marks a line beyond the PR', () => {
  it('bolds the column above the PR at its rep count and says why', () => {
    const { container } = render(<GridHarness raw="80×3, 92.5×3, 95×1×2" unit="absolute_kg" prLimits={limits} />);
    const cols = columns(container);
    expect(cols.map(isBeyond)).toEqual([false, true, false]);
    const load = cols[1].querySelector('button')!;
    expect(load.title.startsWith('Would be a new 3RM — Snatch: 92,5 kg above 3RM 90 kg')).toBe(true);
    // The set count is never bold — the rule targets load and reps only.
    expect(cols[1].querySelectorAll('.pgrid-btn-sets').length).toBe(1);
  });

  it('marks nothing without limits', () => {
    const { container } = render(<GridHarness raw="80×3, 92.5×3" unit="absolute_kg" prLimits={null} />);
    expect(columns(container).map(isBeyond)).toEqual([false, false]);
  });

  it('follows a stepped load on the click, before any save lands', () => {
    const { container } = render(<GridHarness raw="90×3" unit="absolute_kg" prLimits={limits} />);
    expect(isBeyond(columns(container)[0])).toBe(false);
    // Left click steps the load by clickIncrement (1 kg): 90 → 91, above the 3RM.
    fireEvent.mouseDown(screen.getAllByRole('button')[0], { button: 0 });
    fireEvent.mouseUp(screen.getAllByRole('button')[0], { button: 0 });
    expect(isBeyond(columns(container)[0])).toBe(true);
  });

  it('checks a percentage through the 1RM', () => {
    const { container } = render(<GridHarness raw="85%×3, 95%×3" unit="percentage" prLimits={limits} />);
    expect(columns(container).map(isBeyond)).toEqual([false, true]);
  });
});

describe('StackedNotation marks a line beyond the PR', () => {
  it('bolds load and reps of the column and carries the verdict as its tooltip', () => {
    const { container } = render(<StackedNotation raw="80×3, 92.5×3" unit="absolute_kg" prLimits={limits} />);
    const pairs = Array.from(container.querySelectorAll('[title]'));
    expect(pairs.length).toBe(1);
    expect(pairs[0].getAttribute('title')).toBe('Would be a new 3RM — Snatch: 92,5 kg above 3RM 90 kg');
    const spans = Array.from(pairs[0].querySelectorAll('span'));
    expect(spans[0].style.fontWeight).toBe('700');
    expect(spans[1].style.fontWeight).toBe('700');
    // The other column stays at the notation's regular weight.
    const plain = container.querySelectorAll('span')[0];
    expect(plain.style.fontWeight).toBe('500');
  });

  it('marks a complex on the member that exceeds its own PR', () => {
    const jerk: PRLimit = { real: new Map([[2, 100]]), anchors: [{ reps: 2, valueKg: 100 }], oneRM: 105, name: 'Jerk' };
    const clean: PRLimit = { real: new Map([[1, 120]]), anchors: [{ reps: 1, valueKg: 120 }], oneRM: 120, name: 'Clean' };
    const { container } = render(
      <StackedNotation raw="105×1+2" unit="absolute_kg" isCombo prLimits={{ self: null, members: [clean, jerk] }} />,
    );
    expect(container.querySelector('[title]')?.getAttribute('title'))
      .toBe('Would be a new 2RM — Jerk: 105 kg above 2RM 100 kg');
  });
});
