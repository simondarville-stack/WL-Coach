/**
 * CalibrationPanel — turning a plate into a scale.
 *
 * A PANEL, not a wizard step (docs/KINEMOS_P1_PLAN.md decision 4). A coach
 * routinely wants to look at a lift before measuring it, revisits the
 * calibration when the first number looks wrong, and may calibrate the same
 * clip differently for two attempts filmed from slightly different spots. A
 * gate would fight all three; this reopens at any moment and nothing downstream
 * refuses to work without it.
 *
 * The two scales are shown SEPARATELY and never averaged. That is the whole
 * point of the anisotropic model: the plate's minor axis is its true diameter
 * squashed by cos θ, so the horizontal scale is larger than the vertical one,
 * and an interface implying a single number under-reports every loop-back by
 * 13 % at 30° off perpendicular.
 */
import { Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button, Select } from '../../components/ui';
import { PLATE_PRESETS, type Calibration, type PlateEllipse } from '../engine/calibration';
import { mmPerPx, num } from '../lib/viewerFormat';

interface CalibrationPanelProps {
  ellipse: PlateEllipse | null;
  calibration: Calibration | null;
  plateDiameterCm: number;
  active: boolean;
  onPlateDiameter: (cm: number) => void;
  onActivate: () => void;
  onClear: () => void;
  /** Find the plate on this frame with OpenCV — no outline needed. */
  onFind: () => void;
  /** Snap the drawn outline to the plate's real edge, sub-pixel. */
  onSnap: () => void;
  /** Which assist is running, and what the last one said. */
  assist: { busy: 'find' | 'snap' | null; note: string | null };
  /** How the next find or snap fits the outline: a free ellipse, or a circle
   *  for a round plate filmed square-on. */
  shape: 'ellipse' | 'circle';
  onShape: (shape: 'ellipse' | 'circle') => void;
}

export function CalibrationPanel({
  ellipse,
  calibration,
  plateDiameterCm,
  active,
  onPlateDiameter,
  onActivate,
  onClear,
  onFind,
  onSnap,
  assist,
  shape,
  onShape,
}: CalibrationPanelProps) {
  const shapeToggle = (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-sm)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
      title="A round plate filmed square-on is a circle: fitting one instead of a free ellipse leaves nothing for the shadow below or the rim's thickness above to tilt, and the radius is the scale directly. Leave it off when the camera is off to one side — the plate really is an ellipse then. Applies to the next find or snap."
    >
      <input
        type="checkbox"
        checked={shape === 'circle'}
        onChange={e => onShape(e.target.checked ? 'circle' : 'ellipse')}
        disabled={assist.busy !== null}
      />
      Round plate, camera square-on — fit a circle
    </label>
  );

  return (
    <section style={sectionStyle}>
      <header style={headerStyle}>
        <span style={labelStyle}>CALIBRATION</span>
        {ellipse && (
          <button type="button" onClick={onClear} title="Remove the calibration" style={iconButton}>
            <Trash2 size={13} />
          </button>
        )}
      </header>

      {!ellipse && (
        <>
          <p style={hintStyle}>
            Not calibrated — distances read in pixels. Outline a plate to get centimetres.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="primary"
              onClick={onFind}
              disabled={assist.busy !== null}
              title="Find the plate on this frame, outline it to the pixel and track the bar from it — no clicking. Loads OpenCV the first time, about 13 MB."
            >
              {assist.busy === 'find' ? 'Finding the plate…' : 'Find the plate'}
            </Button>
            <Button size="sm" variant="secondary" onClick={onActivate} disabled={assist.busy !== null}>
              {active ? 'Click the plate on the frame' : 'Outline it by hand'}
            </Button>
          </div>
          {shapeToggle}
          {assist.note && <p style={hintStyle}>{assist.note}</p>}
        </>
      )}

      {ellipse && calibration && (
        <>
          <label style={{ display: 'block' }}>
            <span style={{ ...labelStyle, display: 'block', marginBottom: 2 }}>PLATE</span>
            <Select
              value={String(plateDiameterCm)}
              onChange={e => onPlateDiameter(Number(e.target.value))}
              style={{ width: '100%' }}
            >
              {PLATE_PRESETS.map(preset => (
                <option key={preset.diameterCm} value={preset.diameterCm}>
                  {preset.label}
                </option>
              ))}
              {/* A coach measuring an odd disc keeps whatever they set, rather
                  than having the panel silently snap to a preset. */}
              {!PLATE_PRESETS.some(preset => preset.diameterCm === plateDiameterCm) && (
                <option value={plateDiameterCm}>{`${num(plateDiameterCm, 1)} cm`}</option>
              )}
            </Select>
          </label>

          <dl style={{ margin: 'var(--space-sm) 0 0', display: 'grid', gap: 2 }}>
            <Row
              term="Scale — vertical"
              value={`${mmPerPx(calibration.cmPerPxV)} mm/px`}
              hint="Along the bar's travel: read straight off the plate's long axis."
            />
            <Row
              term="Scale — horizontal"
              value={`${mmPerPx(calibration.cmPerPxH)} mm/px`}
              hint="Across the frame: wider, because the view foreshortens it."
            />
            <Row
              term="Camera angle"
              value={`${num(calibration.viewingAngleDeg, 0)}° off perpendicular`}
              hint="Derived from how much narrower the plate looks than it is tall."
            />
            <Row
              term="Outline orientation"
              value={`${num(calibration.tiltDeg, 1)}°`}
              hint="Which way the outline's long axis leans. It says how the two scales are shared between the image axes — not which way is up. Up is the image vertical, from the tripod."
            />
          </dl>

          {calibration.reason && (
            <p
              style={{
                margin: 'var(--space-sm) 0 0',
                padding: 'var(--space-sm)',
                borderRadius: 'var(--radius-sm)',
                background:
                  calibration.confidence === 'degenerate'
                    ? 'var(--color-danger-bg)'
                    : 'var(--color-warning-bg)',
                color:
                  calibration.confidence === 'degenerate'
                    ? 'var(--color-danger-text)'
                    : 'var(--color-warning-text)',
                fontSize: 'var(--text-caption)',
                lineHeight: 1.4,
              }}
            >
              {calibration.reason}
            </p>
          )}

          {!active && (
            <div style={{ marginTop: 'var(--space-sm)', display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={onSnap}
                disabled={assist.busy !== null}
                title="Move the outline onto the plate's real edge, to a fraction of a pixel, using the edges in the frame. Says how much of the rim it found."
              >
                {assist.busy === 'snap' ? 'Snapping…' : 'Snap to the edge'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onActivate} disabled={assist.busy !== null}>
                Adjust the outline
              </Button>
            </div>
          )}
          {!active && shapeToggle}
          {assist.note && !active && <p style={hintStyle}>{assist.note}</p>}
          {active && (
            <p style={hintStyle}>
              Drag the outer handle to size and rotate the plate, the side handle to squash it onto
              the plate edge, the centre to move it.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Row({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
      title={hint}
    >
      <dt style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>
        {term}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 'var(--text-label)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: 'var(--space-md)',
  borderBottom: '1px solid var(--color-border-tertiary)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 'var(--space-sm)',
};

const labelStyle: CSSProperties = {
  fontSize: 'var(--text-caption)',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
};

const hintStyle: CSSProperties = {
  margin: '0 0 var(--space-sm)',
  fontSize: 'var(--text-caption)',
  lineHeight: 1.4,
  color: 'var(--color-text-tertiary)',
};

const iconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--color-text-tertiary)',
  cursor: 'pointer',
};
