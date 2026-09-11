/**
 * The load–velocity panel's assumed threshold.
 *
 * Estimating a maximum from a fitted line needs a velocity to read it at.
 * Without a near-maximal rep of this athlete, the panel used to assume a
 * flat 1,5 m/s for everybody. The BVDG tables say better than that — a
 * maximal snatch moves at 1,5–1,7 m/s in the lower classes and 1,8–1,95 in
 * the upper — so when the athlete's profile carries a sex and a class, the
 * band's midpoint stands in, labelled as the material's.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KinemosLiftRecord } from '../../lib/analysisAdapter';
import { LoadVelocityPanel } from '../LoadVelocityPanel';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

/** A spread of loads at falling velocities: enough for a profile to fit. */
function record(over: Partial<Omit<KinemosLiftRecord, 'loadKg'>> & { analysisId: string; loadKg: number; velocity: number }): KinemosLiftRecord {
  const { velocity, ...rest } = over;
  return {
    clipKey: `direct:${over.analysisId}`,
    sourceKind: 'direct',
    sourceId: over.analysisId,
    repIndex: 1,
    label: null,
    athleteId: 'ath-1',
    athleteName: 'Anna',
    exerciseName: 'Snatch',
    date: '2026-08-01',
    athleteSex: null,
    athleteWeightClass: null,
    athleteBodyweightKg: null,
    liftModelId: null,
    massKg: over.loadKg,
    massSource: 'logged',
    grade: 'B',
    gradeErrorMs: 0.04,
    phaseSetId: 'default',
    isReference: false,
    isModel: false,
    modelLabel: null,
    schema: 3,
    analysedAt: '2026-08-01T10:00:00Z',
    values: { peakVelocity: velocity },
    ...rest,
  } as KinemosLiftRecord;
}

/** The panel builds its sentences from template literals, so the words are
 *  split across text nodes: match on the rendered text as a whole. */
const shown = (container: HTMLElement, re: RegExp) => re.test(container.textContent ?? '');

/** Loads well short of a maximum: every rep still moving faster than a
 *  maximum of any class does, so none of them is a measured threshold. */
const submaximal = (over: Partial<Omit<KinemosLiftRecord, 'loadKg'>> = {}) => [
  record({ analysisId: 'a', loadKg: 60, velocity: 2.2, ...over }),
  record({ analysisId: 'b', loadKg: 70, velocity: 2.1, ...over }),
  record({ analysisId: 'c', loadKg: 80, velocity: 2.0, ...over }),
  record({ analysisId: 'd', loadKg: 90, velocity: 1.95, ...over }),
];

describe('LoadVelocityPanel — the assumed threshold', () => {
  it('takes the class band when the athlete’s profile says who they are', () => {
    const { container } = render(
      <LoadVelocityPanel
        records={submaximal({ athleteSex: 'women', athleteWeightClass: '63', liftModelId: 'snatch' })}
        exerciseName="Snatch"
      />,
    );
    // Women, middle classes: the snatch band is 1,70–1,85 → midpoint 1,775.
    expect(shown(container, /German material/)).toBe(true);
    expect(shown(container, /middle classes/)).toBe(true);
    expect(shown(container, /1,70–1,85/)).toBe(true);
    // The midpoint of 1,70–1,85, as the estimate reads it at.
    expect(shown(container, /at 1,7[78] m\/s/)).toBe(true);
  });

  it('falls back to the flat assumption with no profile to go on', () => {
    // No sex or class on the athlete: nothing to look a band up by, and the
    // heaviest rep is taken at its word as before.
    const { container } = render(<LoadVelocityPanel records={submaximal()} exerciseName="Snatch" />);
    expect(shown(container, /German material/)).toBe(false);
    expect(shown(container, /threshold is measured/)).toBe(true);
  });

  it('refuses to call a submaximal rep a measured threshold', () => {
    // 1,95 m/s is quicker than any maximum in the women's middle classes
    // (1,70–1,85), so the heaviest analysed rep was not near-maximal.
    const { container } = render(
      <LoadVelocityPanel
        records={submaximal({ athleteSex: 'women', athleteWeightClass: '63', liftModelId: 'snatch' })}
        exerciseName="Snatch"
      />,
    );
    expect(shown(container, /threshold is measured/)).toBe(false);
  });

  it('prefers a measured threshold over both', () => {
    const withNearMax = [
      ...submaximal({ athleteSex: 'women', athleteWeightClass: '63', liftModelId: 'snatch' }),
      record({
        analysisId: 'e',
        loadKg: 100,
        velocity: 1.75,
        athleteSex: 'women',
        athleteWeightClass: '63',
        liftModelId: 'snatch',
      }),
    ];
    const { container } = render(<LoadVelocityPanel records={withNearMax} exerciseName="Snatch" />);
    expect(shown(container, /threshold is measured/)).toBe(true);
    expect(shown(container, /German material/)).toBe(false);
  });
});
