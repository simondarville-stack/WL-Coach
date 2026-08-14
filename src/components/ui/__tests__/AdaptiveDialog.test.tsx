import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AdaptiveDialog } from '../AdaptiveDialog';

function renderDialog(props: Partial<React.ComponentProps<typeof AdaptiveDialog>> = {}) {
  const onClose = vi.fn();
  const { container, unmount } = render(
    <AdaptiveDialog onClose={onClose} ariaLabel="Test dialog" {...props}>
      <div>
        <input aria-label="first" />
        <button>last</button>
      </div>
    </AdaptiveDialog>,
  );
  return {
    onClose,
    unmount,
    backdrop: container.querySelector('[data-emos-backdrop]') as HTMLElement,
    // Lazy: the stacked-dialog test mounts two at once, where a `getByRole`
    // evaluated eagerly here would throw on the duplicate match.
    get dialog() { return container.querySelector<HTMLElement>('[role]')!; },
  };
}

describe('AdaptiveDialog — the dismissal contract', () => {
  describe('transient (autosaved or read-only: nothing to lose)', () => {
    it('closes on a backdrop click', () => {
      const { onClose, backdrop } = renderDialog();
      fireEvent.mouseDown(backdrop);
      fireEvent.mouseUp(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape', () => {
      const { onClose, dialog } = renderDialog();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when a selection is dragged out of the panel', () => {
      const { onClose, backdrop } = renderDialog();
      fireEvent.mouseDown(screen.getByLabelText('first'));
      fireEvent.mouseUp(backdrop);
      fireEvent.click(backdrop);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('guarded (buffered input: only buttons close it)', () => {
    it('never closes on a backdrop click, dirty or not', () => {
      const clean = renderDialog({ dismiss: 'guarded' });
      fireEvent.mouseDown(clean.backdrop);
      fireEvent.mouseUp(clean.backdrop);
      expect(clean.onClose).not.toHaveBeenCalled();
      clean.unmount();

      const dirty = renderDialog({ dismiss: 'guarded', dirty: true });
      fireEvent.mouseDown(dirty.backdrop);
      fireEvent.mouseUp(dirty.backdrop);
      expect(dirty.onClose).not.toHaveBeenCalled();
    });

    it('allows Escape while untouched', () => {
      const { onClose, dialog } = renderDialog({ dismiss: 'guarded' });
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('refuses Escape once there is typing to lose', () => {
      const { onClose, dialog } = renderDialog({ dismiss: 'guarded', dirty: true });
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

describe('AdaptiveDialog — chrome', () => {
  it('labels itself for assistive tech', () => {
    const { dialog } = renderDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Test dialog');
  });

  it('honours role="alertdialog" for confirms', () => {
    renderDialog({ role: 'alertdialog' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('moves focus into the dialog and hands it back on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount, dialog } = renderDialog();
    expect(document.activeElement).toBe(dialog);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('leaves focus alone when the content placed it deliberately', () => {
    const onClose = vi.fn();
    render(
      <AdaptiveDialog onClose={onClose} ariaLabel="Confirm">
        <button autoFocus>Delete</button>
      </AdaptiveDialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('locks body scroll while open and restores it after', () => {
    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps body scroll locked until the last of two stacked dialogs closes', () => {
    const first = renderDialog();
    const second = renderDialog();
    expect(document.body.style.overflow).toBe('hidden');

    second.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    first.unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('leaves alignItems unset for responsive-end so the breakpoint class wins', () => {
    const { container } = render(
      <AdaptiveDialog onClose={vi.fn()} ariaLabel="x" align="responsive-end">
        <div>body</div>
      </AdaptiveDialog>,
    );
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('items-end');
    expect(overlay.className).toContain('sm:items-center');
    // An inline value here would override the classes and pin the sheet.
    expect(overlay.style.alignItems).toBe('');
  });

  it('wraps Tab from the last focusable back to the first', () => {
    const { dialog } = renderDialog();
    const first = screen.getByLabelText('first');
    const last = screen.getByRole('button', { name: 'last' });

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
