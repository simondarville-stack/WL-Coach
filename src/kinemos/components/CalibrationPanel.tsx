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
import { memo, type CSSProperties } from 'react';
import { Button, Select } from '../../components/ui';
import { PLATE_PRESETS, type Calibration, type PlateEllipse } from '../engine/calibration';
import type { DistortionSource } from '../engine/distortion';
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
  /** The lens tier: which correction this clip is being measured through,
   *  and how to measure one. */
  lens: LensState;
  /** Inside a rail panel that already carries the title. */
  hideTitle?: boolean;
}

export interface LensState {
  /** Which of design §6.1's tiers applies. */
  source: DistortionSource;
  /** The coefficient in force, 0 on the convention tier. */
  k1: number;
  /** The phone, when the clip named one. Without it a profile cannot be
   *  stored, because there is nothing to key it by. */
  device: string | null;
  busy: boolean;
  note: string | null;
  onMeasure: () => void;
  onClear: () => void;
}

function CalibrationPanelImpl({
  ellipse,
  calibration,
  plateDiameterCm,
  active,
  onPlateDiameter,
  onActivate,
  onClear,
  onFind,
  onSnap,
  lens,
  assist,
  shape,
  onShape,
  hideTitle = false,
}: CalibrationPanelProps) {
  const shapeToggle = (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-sm)', fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
      title="Fit a circle, not an ellipse · for a plate filmed square-on · applies to the next find or snap"
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
      <header style={{ ...headerStyle, ...(hideTitle && !ellipse ? { display: 'none' } : {}) }}>
        <span style={labelStyle}>{hideTitle ? '' : 'CALIBRATION'}</span>
        {ellipse && (
          <button type="button" onClick={onClear} title="Remove the calibration" style={iconButton}>
            <Trash2 size={13} />
          </button>
        )}
      </header>

      {!ellipse && (
        <>
          <p style={hintStyle}>Not calibrated · distances read in pixels.</p>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="primary"
              onClick={onFind}
              disabled={assist.busy !== null}
              title="Find and outline the plate, then track · OpenCV, ~13 MB first time"
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
              hint="Along the bar’s travel"
            />
            <Row
              term="Scale — horizontal"
              value={`${mmPerPx(calibration.cmPerPxH)} mm/px`}
              hint="Across the frame · wider by foreshortening"
            />
            <Row
              term="Camera angle"
              value={`${num(calibration.viewingAngleDeg, 0)}° off perpendicular`}
              hint="From the plate’s width ÷ height"
            />
            <Row
              term="Outline orientation"
              value={`${num(calibration.tiltDeg, 1)}°`}
              hint="Lean of the outline’s long axis · not which way is up"
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
                title="Snap the outline to the plate edge, sub-pixel"
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
            <p style={hintStyle}>Outer handle: size + rotate · side handle: squash · centre: move</p>
          )}

          {/* ── The lens ───────────────────────────────────────────────── */}
          <div style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 'var(--space-sm)' }}>
            <Row
              term="Lens"
              value={
                lens.source === 'profile'
                  ? `Measured · k₁ ${num(lens.k1, 3)}`
                  : lens.source === 'model'
                    ? `From ${lens.device ?? 'the phone model'} · k₁ ${num(lens.k1, 3)}`
                    : 'Not corrected'
              }
              hint={
                lens.source === 'none'
                  ? 'Bends straight lines near the frame edge · optional, measurable'
                  : 'Track and outline are corrected through it'
              }
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginTop: 'var(--space-xs)' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={lens.onMeasure}
                disabled={lens.busy || assist.busy !== null}
                title="Fit the lens to straight edges in shot · stored per phone"
              >
                {lens.busy ? 'Measuring the lens…' : lens.source === 'none' ? 'Measure the lens' : 'Measure again'}
              </Button>
              {lens.source !== 'none' && (
                <Button size="sm" variant="ghost" onClick={lens.onClear} title="Back to no correction">
                  Forget it
                </Button>
              )}
            </div>
            {lens.note && <p style={hintStyle}>{lens.note}</p>}
            {!lens.device && lens.source === 'none' && (
              <p style={hintStyle}>No phone model on this clip · a measurement cannot be stored for the next one.</p>
            )}
          </div>
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

export const CalibrationPanel = memo(CalibrationPanelImpl);
