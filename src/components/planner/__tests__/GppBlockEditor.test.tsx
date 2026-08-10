import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GppBlockEditor } from '../GppBlockEditor';
import type { GppSection } from '../../../lib/database.types';

const SECTION: GppSection = {
  title: 'Conditioning',
  description: '3 rounds for time',
  rows: [{ exercise: 'Back extension', reps: '10', sets: 3, load: '' }],
};

function setup() {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <GppBlockEditor open initial={SECTION} onClose={onClose} onSave={onSave} />,
  );
  const backdrop = container.firstElementChild as HTMLElement;
  return { onClose, onSave, backdrop };
}

/**
 * `handleClose` reaches onClose through `flush().finally(...)`, so "did not
 * close" can only be asserted once that whole promise chain has had a chance to
 * settle. Awaiting a single microtask is not enough — it makes the negative
 * tests pass against the buggy component too.
 */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });

// jsdom doesn't synthesize `click` from a down/up pair, so each test fires it
// explicitly — on the backdrop, because the browser dispatches click at the
// nearest common ancestor of the down and up targets. That click is exactly
// what used to dismiss the sheet mid-selection.
describe('GppBlockEditor backdrop dismissal', () => {
  it('closes when the whole gesture happens on the backdrop', async () => {
    const { onClose, backdrop } = setup();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open when a text selection started inside and ended on the backdrop', async () => {
    const { onClose, backdrop } = setup();

    // Selecting the description and dragging past the panel edge: mouse down
    // inside the sheet, mouse up over the backdrop.
    fireEvent.mouseDown(screen.getByPlaceholderText(/3 rounds for time/i));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open for a gesture that ends inside the sheet', async () => {
    const { onClose, backdrop } = setup();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(screen.getByPlaceholderText(/3 rounds for time/i));
    fireEvent.click(backdrop);

    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });
});
