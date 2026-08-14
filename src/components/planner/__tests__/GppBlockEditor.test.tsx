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
  const backdrop = container.querySelector('[data-emos-backdrop]') as HTMLElement;
  return { onClose, onSave, backdrop };
}

/**
 * `handleClose` reaches onClose through `flush().finally(...)`, so "did not
 * close" can only be asserted once that whole promise chain has had a chance to
 * settle. Awaiting a single microtask is not enough — it makes the negative
 * tests pass against a component that does close.
 */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });

// The GPP sheet autosaves, so it is wired as a `transient` AdaptiveDialog:
// backdrop and Escape both dismiss. These tests pin that wiring; the gesture
// logic itself is covered in useBackdropDismiss.test.tsx.
describe('GppBlockEditor dismissal', () => {
  it('closes when the whole gesture happens on the backdrop', async () => {
    const { onClose, backdrop } = setup();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open when a text selection started inside and ended on the backdrop', async () => {
    const { onClose, backdrop } = setup();

    // Selecting the description and dragging past the panel edge: mouse down
    // inside the sheet, mouse up over the backdrop, then the click the browser
    // dispatches at their nearest common ancestor.
    fireEvent.mouseDown(screen.getByPlaceholderText(/3 rounds for time/i));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { onClose } = setup();

    fireEvent.keyDown(screen.getByPlaceholderText(/3 rounds for time/i), { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
