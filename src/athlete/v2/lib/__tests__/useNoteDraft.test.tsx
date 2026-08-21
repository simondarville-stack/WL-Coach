import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useNoteDraft } from '../useNoteDraft';

/**
 * A stand-in for the athlete note cards: a textarea bound to useNoteDraft,
 * with `remote` controlled by the test the way TodayScreen's mergeSession
 * controls it — i.e. it only changes when a save round-trip lands.
 */
function Note({
  remote,
  persist,
}: {
  remote: string;
  persist: (v: string) => Promise<void>;
}) {
  const note = useNoteDraft(remote, persist);
  return <textarea aria-label="note" {...note.bind} />;
}

function box() {
  return screen.getByLabelText('note') as HTMLTextAreaElement;
}

/** Type by replacing the whole value, as a controlled textarea does. */
function type(value: string) {
  fireEvent.change(box(), { target: { value } });
}

describe('useNoteDraft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never lets a save echo overwrite text typed during the round-trip', async () => {
    // This is the reported bug: on a phone the ~800 ms debounce fires, the save
    // round-trips, and the echo lands while the athlete is still typing.
    const persist = vi.fn(async () => {});
    const { rerender } = render(<Note remote="" persist={persist} />);

    fireEvent.focus(box());
    type('Felt hevy');
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(persist).toHaveBeenCalledWith('Felt hevy');

    // Athlete keeps going while the request is in flight.
    type('Felt hevy on the third single');

    // The save lands: the server now echoes the SNAPSHOT it was sent.
    rerender(<Note remote="Felt hevy" persist={persist} />);

    expect(box().value).toBe('Felt hevy on the third single');
  });

  it('re-saves the corrected text after an echo of the earlier snapshot', async () => {
    // The old guard compared the draft against the echoed server value, so once
    // the echo had clobbered the box the correction was equal-and-skipped —
    // silently lost. The draft must still be committed here.
    const persist = vi.fn(async () => {});
    const { rerender } = render(<Note remote="" persist={persist} />);

    fireEvent.focus(box());
    type('Felt hevy');
    await act(async () => { vi.advanceTimersByTime(800); });

    type('Felt heavy');
    rerender(<Note remote="Felt hevy" persist={persist} />);
    await act(async () => { vi.advanceTimersByTime(800); });

    expect(persist).toHaveBeenLastCalledWith('Felt heavy');
  });

  it('holds the draft while the caret is parked mid-sentence', () => {
    // Mid-edit the draft can momentarily equal what was last sent (the athlete
    // paused, or deleted back to it). Focus alone has to keep the echo out, or
    // the caret is thrown to the end of the box.
    const persist = vi.fn(async () => {});
    const { rerender } = render(<Note remote="Felt heavy" persist={persist} />);

    fireEvent.focus(box());
    rerender(<Note remote="Felt heavy today" persist={persist} />);

    expect(box().value).toBe('Felt heavy');
  });

  it('accepts a server value into an idle box', () => {
    const persist = vi.fn(async () => {});
    const { rerender } = render(<Note remote="" persist={persist} />);

    rerender(<Note remote="Coach edited this" persist={persist} />);

    expect(box().value).toBe('Coach edited this');
  });

  it('commits once for a keystroke that both debounces and blurs', async () => {
    const persist = vi.fn(async () => {});
    render(<Note remote="" persist={persist} />);

    fireEvent.focus(box());
    type('Tired');
    await act(async () => { vi.advanceTimersByTime(800); });
    fireEvent.blur(box());

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('retries on the next blur when the write failed', async () => {
    const persist = vi.fn(async () => { throw new Error('offline'); });
    render(<Note remote="" persist={persist} />);

    fireEvent.focus(box());
    type('Tired');
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(persist).toHaveBeenCalledTimes(1);

    // The failure must not leave the text marked as safely stored.
    await act(async () => { fireEvent.blur(box()); });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith('Tired');
  });

  it('flushes an unsaved draft on unmount', async () => {
    const persist = vi.fn(async () => {});
    const { unmount } = render(<Note remote="" persist={persist} />);

    fireEvent.focus(box());
    type('Wrote this then switched day');
    await act(async () => { unmount(); });

    expect(persist).toHaveBeenCalledWith('Wrote this then switched day');
  });
});
