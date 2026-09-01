/**
 * The tab badge is 14 px on a phone. What it has to get right is that a coach
 * can tell at a glance whether anything is waiting — the exact number matters
 * far less, and past nine it stops fitting at all.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabBadge } from '../components/TabBadge';

describe('TabBadge', () => {
  it('renders nothing when there is nothing waiting', () => {
    const { container } = render(<TabBadge count={0} label="to review" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the number while it still fits', () => {
    render(<TabBadge count={7} label="to review" />);
    expect(screen.getByLabelText('7 to review')).toHaveTextContent('7');
  });

  it('shows a bare dot past nine instead of an unreadable "9+"', () => {
    render(<TabBadge count={23} label="unread threads" />);
    const badge = screen.getByLabelText('23 unread threads');
    // No glyph — two digits and a plus inside 14 px is a smudge.
    expect(badge).toHaveTextContent('');
    expect(badge.className).toContain('w-[9px]');
  });

  it('keeps the exact count available to a screen reader either way', () => {
    const { rerender } = render(<TabBadge count={4} label="to review" />);
    expect(screen.getByLabelText('4 to review')).toBeInTheDocument();
    rerender(<TabBadge count={140} label="to review" />);
    expect(screen.getByLabelText('140 to review')).toBeInTheDocument();
  });

  it('switches to the dot exactly at ten', () => {
    const { rerender, container } = render(<TabBadge count={9} label="x" />);
    expect(container.firstChild).toHaveTextContent('9');
    rerender(<TabBadge count={10} label="x" />);
    expect(container.firstChild).toHaveTextContent('');
  });
});
