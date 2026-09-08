/**
 * The rail's composition: presets set every panel at once, a hand toggle
 * makes the composition the coach's own, and it comes back per athlete.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEPTH_PRESETS, PANEL_KEYS, depthOf, useViewerPanels } from '../useViewerPanels';

describe('useViewerPanels', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the lift and its velocity curve by default, which is no preset', () => {
    const { result } = renderHook(() => useViewerPanels('a-1'));
    expect(result.current.open.lift).toBe(true);
    expect(result.current.open.velocity).toBe(true);
    expect(result.current.open.tracking).toBe(false);
    expect(result.current.openCount).toBe(2);
    expect(result.current.depth).toBeNull();
  });

  it('a depth sets every panel at once and lights its pill', () => {
    const { result } = renderHook(() => useViewerPanels('a-1'));
    act(() => result.current.setDepth('work'));
    expect(PANEL_KEYS.every(k => result.current.open[k])).toBe(true);
    expect(result.current.depth).toBe('work');
    expect(result.current.openCount).toBe(PANEL_KEYS.length);

    act(() => result.current.setDepth('look'));
    expect(result.current.open).toEqual(DEPTH_PRESETS.look);
    expect(result.current.openCount).toBe(1);
  });

  it('a hand toggle clears the preset — the composition is the coach’s now', () => {
    const { result } = renderHook(() => useViewerPanels('a-1'));
    act(() => result.current.setDepth('read'));
    expect(result.current.depth).toBe('read');
    act(() => result.current.toggle('tracking'));
    expect(result.current.depth).toBeNull();
    expect(result.current.open.tracking).toBe(true);
    // ...and toggling it back lands on the preset again, which lights it.
    act(() => result.current.toggle('tracking'));
    expect(result.current.depth).toBe('read');
  });

  it('show opens without closing, and is a no-op on an open panel', () => {
    const { result } = renderHook(() => useViewerPanels('a-1'));
    act(() => result.current.show('notes'));
    expect(result.current.open.notes).toBe(true);
    expect(result.current.open.lift).toBe(true);
    const before = result.current.open;
    act(() => result.current.show('notes'));
    expect(result.current.open).toBe(before);
  });

  it('remembers the composition per athlete', () => {
    const first = renderHook(() => useViewerPanels('a-1'));
    act(() => first.result.current.setDepth('work'));
    first.unmount();

    const again = renderHook(() => useViewerPanels('a-1'));
    expect(again.result.current.depth).toBe('work');

    const other = renderHook(() => useViewerPanels('a-2'));
    expect(other.result.current.depth).toBeNull();
    expect(other.result.current.openCount).toBe(2);
  });

  it('re-reads when the athlete arrives after the first render', () => {
    localStorage.setItem('kinemos.viewer.panels.a-9', JSON.stringify(DEPTH_PRESETS.look));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useViewerPanels(id), {
      initialProps: { id: null as string | null },
    });
    expect(result.current.depth).toBeNull();
    rerender({ id: 'a-9' });
    expect(result.current.depth).toBe('look');
  });

  it('ignores a stored value it cannot read', () => {
    localStorage.setItem('kinemos.viewer.panels.a-1', '{not json');
    const { result } = renderHook(() => useViewerPanels('a-1'));
    expect(result.current.openCount).toBe(2);
  });

  it('names the preset a composition equals', () => {
    expect(depthOf(DEPTH_PRESETS.read)).toBe('read');
    expect(depthOf({ ...DEPTH_PRESETS.read, notes: true })).toBeNull();
  });
});
