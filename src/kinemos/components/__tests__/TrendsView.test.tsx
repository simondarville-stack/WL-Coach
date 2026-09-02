/**
 * The trend view is read cold, often on a phone at the platform, so what it
 * says when the data is thin matters as much as the chart. These tests drive
 * it with an injected loader and check the words: which reps are in view, that
 * a missing number is counted rather than hidden, and that the modes switch.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KinemosLiftRecord } from '../../lib/analysisAdapter';
import { TrendsView } from '../TrendsView';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

function rep(over: Partial<KinemosLiftRecord> & { analysisId: string }): KinemosLiftRecord {
  return {
    clipKey: `direct:${over.analysisId}`,
    sourceKind: 'direct',
    sourceId: over.analysisId,
    repIndex: 1,
    label: null,
    athleteId: 'ath-1',
    athleteName: 'Anna',
    exerciseName: 'Snatch',
    date: '2026-08-10',
    loadKg: 85,
    massKg: 85,
    massSource: 'logged',
    grade: 'A',
    gradeErrorMs: 0.02,
    phaseSetId: 'default',
    schema: 1,
    analysedAt: '2026-08-10T10:00:00Z',
    values: { peakVelocity: 1.8, secondPull: 1.8, transitionLoss: 0.1, turnover: 0.5 },
    ...over,
  };
}

const records: KinemosLiftRecord[] = [
  rep({ analysisId: 'r1', date: '2026-07-01', loadKg: 80, values: { peakVelocity: 1.7 } }),
  rep({ analysisId: 'r2', date: '2026-07-20', loadKg: 85, grade: 'B', values: { peakVelocity: 1.75 } }),
  // Analysed before the cache existed: no numbers at all.
  rep({ analysisId: 'r3', date: '2026-08-01', loadKg: 88, grade: null, schema: 0, values: { peakVelocity: null } }),
  rep({ analysisId: 'r4', date: '2026-08-10', loadKg: 90, values: { peakVelocity: 1.82 } }),
  rep({ analysisId: 'c1', date: '2026-08-05', exerciseName: 'Clean', loadKg: 110, grade: 'C', values: { peakVelocity: 1.4 } }),
];

function mount(over: Partial<Parameters<typeof TrendsView>[0]> = {}) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <TrendsView
      athleteId="ath-1"
      athleteName="Anna"
      exerciseName="Snatch"
      currentAnalysisId="r4"
      onClose={onClose}
      onOpen={onOpen}
      load={() => Promise.resolve(records)}
      {...over}
    />,
  );
  return { onOpen, onClose };
}

describe('TrendsView', () => {
  it('shows this exercise’s reps, newest first, and marks the one on screen', async () => {
    mount();
    expect(await screen.findByText('PEAK VELOCITY · M/S')).toBeInTheDocument();
    // Four snatches in view; the clean is not.
    expect(screen.getByText('4 in view · click a row to open it')).toBeInTheDocument();
    const cells = screen.getAllByRole('cell');
    expect(cells.some(c => c.textContent === '10/08')).toBe(true);
    expect(screen.queryByText('Clean')).not.toBeInTheDocument();
    expect(screen.getByText('this rep')).toBeInTheDocument();
    // The values, comma-decimal (an axis label may carry the same figure).
    expect(screen.getAllByText('1,82').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,70').length).toBeGreaterThan(0);
  });

  it('counts a rep with no stored number instead of hiding it', async () => {
    mount();
    expect(
      await screen.findByText(/1 of 4 reps in view have no stored peak velocity/),
    ).toBeInTheDocument();
  });

  it('widens to every exercise on request, and says the clean is a clean', async () => {
    mount();
    await screen.findByText('PEAK VELOCITY · M/S');
    fireEvent.click(screen.getByRole('button', { name: 'All exercises' }));
    expect(screen.getByText('5 in view · click a row to open it')).toBeInTheDocument();
    expect(screen.getByText('Clean')).toBeInTheDocument();
  });

  it('puts the metric against load on request', async () => {
    mount();
    await screen.findByText('PEAK VELOCITY · M/S');
    fireEvent.click(screen.getByRole('button', { name: 'Against load' }));
    // The load panel of the time view is gone; the reps table remains.
    expect(screen.queryByText('LOAD · KG')).not.toBeInTheDocument();
    expect(screen.getByText('REPS')).toBeInTheDocument();
  });

  it('switches metric from the picker', async () => {
    mount();
    await screen.findByText('PEAK VELOCITY · M/S');
    // The select and its first option share the metric's tooltip; the select comes first.
    fireEvent.change(screen.getAllByTitle(/headline number/)[0], { target: { value: 'transitionLoss' } });
    expect(await screen.findByText('LOSS 1ST → 2ND · M/S')).toBeInTheDocument();
    // No rep in the fixture carries a transition loss, so the panel says so
    // rather than drawing an empty chart.
    expect(screen.getByText(/None of the 4 reps in view has a stored loss 1st → 2nd/)).toBeInTheDocument();
  });

  it('opens a rep from its table row', async () => {
    const { onOpen } = mount();
    await screen.findByText('PEAK VELOCITY · M/S');
    fireEvent.click(screen.getByText('01/07'));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen.mock.calls[0][0].analysisId).toBe('r1');
  });

  it('says so when the clip has no athlete', () => {
    mount({ athleteId: null });
    expect(screen.getByText(/This clip has no athlete/)).toBeInTheDocument();
  });

  it('says so when nothing has been analysed yet', async () => {
    mount({ load: () => Promise.resolve([]) });
    expect(await screen.findByText(/Nothing analysed for Anna yet/)).toBeInTheDocument();
  });

  it('surfaces a failed read as its message', async () => {
    mount({ load: () => Promise.reject(new Error('network down')) });
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});
