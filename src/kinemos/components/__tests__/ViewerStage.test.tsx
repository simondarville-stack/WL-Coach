/**
 * The clip overlay draws what the coach's display preferences say: a line,
 * points or both, a grid, a coloured path, a trail that follows the playhead.
 * jsdom has no ResizeObserver, so the stage renders at 1:1 and a screen pixel
 * is a frame pixel.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KinemosTrackPoint } from '../../../lib/database.types';
import { DEFAULT_DISPLAY_PREFS, type StagePrefs } from '../../lib/displayPrefs';
import { ViewerStage } from '../ViewerStage';

const points: KinemosTrackPoint[] = [
  { t: 0, x: 100, y: 200 },
  { t: 0.04, x: 102, y: 180 },
  { t: 0.08, x: 105, y: 150 },
  { t: 0.12, x: 104, y: 120 },
];

function renderStage(display: Partial<StagePrefs>, extra: Partial<Parameters<typeof ViewerStage>[0]> = {}) {
  return render(
    <ViewerStage
      canvas={null}
      width={480}
      height={270}
      tool="look"
      points={points}
      currentT={0.08}
      display={{ ...DEFAULT_DISPLAY_PREFS.stage, ...display }}
      ellipse={null}
      onEllipseChange={vi.fn()}
      measurePoints={[]}
      onMeasurePoint={vi.fn()}
      onMark={vi.fn()}
      {...extra}
    />,
  );
}

describe('ViewerStage draws the path as the coach set it', () => {
  it('defaults to one line at 2 px, no points, with the ring at this frame', () => {
    const { container } = renderStage({});
    const line = container.querySelector('[data-path] polyline')!;
    expect(line).not.toBeNull();
    expect(line.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelectorAll('[data-path] circle').length).toBe(0);
    // The ring: an outer stroke-only circle of radius 9 plus its dot.
    expect(container.querySelector('circle[r="9"]')).not.toBeNull();
  });

  it('points only, at the chosen radius, with the whole layer at the chosen opacity', () => {
    const { container } = renderStage({ path: 'points', pointRadiusPx: 3.5, opacity: 0.5 });
    expect(container.querySelector('[data-path] polyline')).toBeNull();
    const dots = container.querySelectorAll('[data-path] circle');
    expect(dots.length).toBe(points.length);
    expect(dots[0].getAttribute('r')).toBe('3.5');
    expect(container.querySelector('[data-path]')!.getAttribute('opacity')).toBe('0.5');
  });

  it('draws nothing when the path is off, and no ring when the cursor is off', () => {
    const { container } = renderStage({ path: 'off', cursor: false });
    expect(container.querySelector('[data-path]')).toBeNull();
    expect(container.querySelector('circle[r="9"]')).toBeNull();
  });

  it('a trail that follows the playhead stops at the current frame', () => {
    const { container } = renderStage({ path: 'both', trail: 'past' });
    // currentT = 0.08: three of the four points have happened.
    expect(container.querySelectorAll('[data-path] circle').length).toBe(3);
    expect(container.querySelector('[data-path] polyline')!.getAttribute('points')!.split(' ').length).toBe(3);
  });

  it('a coloured path is one segment per pair, in the later point’s colour', () => {
    const colours = ['#111111', '#222222', '#333333', '#444444'];
    const { container } = renderStage({ colour: 'velocity', lineWidthPx: 3 }, { pointColours: colours });
    expect(container.querySelector('[data-path] polyline')).toBeNull();
    const segments = container.querySelectorAll('[data-path] line');
    expect(segments.length).toBe(3);
    expect(segments[0].getAttribute('stroke')).toBe('#222222');
    expect(segments[2].getAttribute('stroke')).toBe('#444444');
    expect(segments[0].getAttribute('stroke-width')).toBe('3');
  });

  it('falls back to one colour when the colours do not fit the points', () => {
    const { container } = renderStage({ colour: 'phase' }, { pointColours: ['#111111'] });
    expect(container.querySelector('[data-path] polyline')).not.toBeNull();
  });

  it('a thirds grid is two lines each way; a cm grid follows the calibration from the bar’s start', () => {
    const thirds = renderStage({ grid: 'thirds' });
    expect(thirds.container.querySelectorAll('[data-grid="thirds"] line').length).toBe(4);
    thirds.unmount();

    const cm = renderStage({ grid: 'cm', gridCm: 10 }, { cmGrid: { xStep: 100, yStep: 90, origin: { x: 100, y: 200 }, cm: 10 } });
    const lines = Array.from(cm.container.querySelectorAll('[data-grid="cm"] line'));
    // x: 100, 0 going left; 200, 300, 400 going right → 5. y: 200, 110, 20 up; nothing below 270 → 3.
    expect(lines.length).toBe(8);
    expect(lines.some(l => l.getAttribute('x1') === '100' && l.getAttribute('x2') === '100')).toBe(true);
    expect(cm.container.querySelector('[data-grid="cm"] text')!.textContent).toBe('10 cm');
    // No grid lines without a calibration to size them.
    cm.unmount();
    const none = renderStage({ grid: 'cm' });
    expect(none.container.querySelector('[data-grid="cm"]')).toBeNull();
  });

  it('offers the options on the stage and writes each choice back', () => {
    const onDisplay = vi.fn();
    renderStage({}, { onDisplay, onDisplayReset: vi.fn(), displayModified: false });
    fireEvent.click(screen.getByRole('button', { name: /Clip overlay · display options/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'points' }));
    expect(onDisplay).toHaveBeenCalledWith({ path: 'points' });
    fireEvent.click(screen.getByRole('radio', { name: '4 px' }));
    expect(onDisplay).toHaveBeenCalledWith({ lineWidthPx: 4 });
    fireEvent.click(screen.getByRole('radio', { name: 'thirds' }));
    expect(onDisplay).toHaveBeenCalledWith({ grid: 'thirds' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ring on the bar at this frame' }));
    expect(onDisplay).toHaveBeenCalledWith({ cursor: false });
  });

  it('draws no options chip when nothing can receive a choice', () => {
    renderStage({});
    expect(screen.queryByRole('button', { name: /display options/ })).toBeNull();
  });
});
