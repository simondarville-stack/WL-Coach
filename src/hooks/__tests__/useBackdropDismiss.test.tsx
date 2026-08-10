import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useBackdropDismiss } from '../useBackdropDismiss';

/**
 * A minimal stand-in for the app's nested-backdrop dialogs: backdrop wraps
 * panel, panel contains a text field. Every real modal that uses the hook has
 * this shape, so exercising it here covers all of them.
 */
function Dialog({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropDismiss(onClose);
  return (
    <div data-testid="backdrop" {...backdrop}>
      <div data-testid="panel">
        <textarea aria-label="notes" defaultValue="some prose to select" />
      </div>
    </div>
  );
}

function setup() {
  const onClose = vi.fn();
  render(<Dialog onClose={onClose} />);
  return {
    onClose,
    backdrop: screen.getByTestId('backdrop'),
    panel: screen.getByTestId('panel'),
    field: screen.getByLabelText('notes'),
  };
}

// jsdom does not synthesize `click` from a down/up pair, so these tests fire it
// explicitly — always on the backdrop, because the browser dispatches click at
// the nearest common ancestor of the mousedown and mouseup targets. That click
// is exactly what dismissed the dialog mid-selection before this hook existed.
describe('useBackdropDismiss', () => {
  it('dismisses when the gesture starts and ends on the backdrop', () => {
    const { onClose, backdrop } = setup();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when a text selection is dragged out of the panel', () => {
    const { onClose, backdrop, field } = setup();

    fireEvent.mouseDown(field);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss when a gesture ends inside the panel', () => {
    const { onClose, backdrop, field } = setup();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(field);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss on a plain click inside the panel', () => {
    const { onClose, panel } = setup();

    fireEvent.mouseDown(panel);
    fireEvent.mouseUp(panel);
    fireEvent.click(panel);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not leak a stale backdrop gesture into the next one', () => {
    const { onClose, backdrop, field } = setup();

    // A completed backdrop dismissal, then a selection dragged out. The second
    // gesture must not inherit the first one's "started on backdrop" flag.
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(field);
    fireEvent.mouseUp(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
