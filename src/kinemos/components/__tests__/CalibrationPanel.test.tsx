/**
 * The front-view declaration on the calibration panel.
 *
 * The angle rule alone cannot be trusted to spot a front view — a small
 * plate seen edge-on fits at a modest angle (the 2009 archive's front-view
 * clean fitted an 18 px plate at 28°) — so the coach's word overrides it.
 * The checkbox has to show the EFFECTIVE answer, or a coach cannot tell
 * what the engine decided, and it has to be able to disagree in both
 * directions.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { calibrateFromEllipse, type PlateEllipse } from '../../engine/calibration';
import { CalibrationPanel, type LensState } from '../CalibrationPanel';

const sideOn: PlateEllipse = { cx: 100, cy: 100, semiMajorPx: 60, semiMinorPx: 58, tiltDeg: 0 };
/** Edge-on and small: the angle rule reads 28°, well short of its 60°. */
const smallEdgeOn: PlateEllipse = { cx: 100, cy: 100, semiMajorPx: 18, semiMinorPx: 16, tiltDeg: 0 };

const lens: LensState = {
  source: 'none',
  k1: 0,
  device: null,
  busy: false,
  note: null,
  onMeasure: () => undefined,
  onClear: () => undefined,
};

function renderPanel(
  ellipse: PlateEllipse,
  frontView: boolean | null,
  onFrontView = vi.fn(),
) {
  render(
    <CalibrationPanel
      ellipse={ellipse}
      calibration={calibrateFromEllipse(ellipse, 45, { frontView })}
      plateDiameterCm={45}
      active={false}
      onPlateDiameter={() => undefined}
      onActivate={() => undefined}
      onClear={() => undefined}
      onFind={() => undefined}
      onSnap={() => undefined}
      assist={{ busy: null, note: null }}
      shape="ellipse"
      onShape={() => undefined}
      frontView={frontView}
      onFrontView={onFrontView}
      lens={lens}
    />,
  );
  return { onFrontView, box: screen.getByRole('checkbox', { name: /Front view/ }) as HTMLInputElement };
}

describe('CalibrationPanel — the front view', () => {
  it('is unchecked on a side-on plate, and checking it tells the viewer', () => {
    const { box, onFrontView } = renderPanel(sideOn, null);
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onFrontView).toHaveBeenCalledWith(true);
  });

  it('shows the angle’s own verdict, and says it came from the angle', () => {
    // Edge-on and big enough for the angle rule to fire on its own.
    const { box } = renderPanel({ cx: 0, cy: 0, semiMajorPx: 100, semiMinorPx: 30, tiltDeg: 0 }, null);
    expect(box.checked).toBe(true);
    expect(screen.getByText(/from the angle/)).toBeTruthy();
  });

  it('stays checked once the coach has declared it on a plate the angle missed', () => {
    const { box } = renderPanel(smallEdgeOn, true);
    expect(box.checked).toBe(true);
    // The coach's word, not the angle's — so the panel does not credit it.
    expect(screen.queryByText(/from the angle/)).toBeNull();
  });

  it('lets the coach take it back off a wide shot they know is side-on', () => {
    const wide: PlateEllipse = { cx: 0, cy: 0, semiMajorPx: 100, semiMinorPx: 30, tiltDeg: 0 };
    const { box, onFrontView } = renderPanel(wide, null);
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onFrontView).toHaveBeenCalledWith(false);
  });
});
