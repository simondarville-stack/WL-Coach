/**
 * viewerFormat — how KinEMOS prints a number.
 *
 * EMOS uses comma decimals throughout (CLAUDE.md "Stack"), and the viewer adds
 * one rule of its own: a measured value never appears without its unit, because
 * the same readout is centimetres when the clip is calibrated and pixels when
 * it is not. A bare "43,2" that silently changes meaning is the failure this
 * module exists to prevent.
 */

/** Comma decimals, fixed places. `null`/`undefined`/NaN render as an em dash so
 *  a missing value never reads as zero. */
export function num(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals).replace('.', ',');
}

/** A distance in the viewer's current unit. `calibrated` decides both the
 *  number's scale (the caller has already converted) and the unit shown. */
export function distance(value: number, calibrated: boolean): string {
  return calibrated ? `${num(value, 1)} cm` : `${num(value, 0)} px`;
}

/** Clip position as mm:ss,cc — the transport readout in the P1 mockups. */
export function clipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00,00';
  const whole = Math.floor(seconds);
  const centis = Math.round((seconds - whole) * 100);
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${mm}:${ss},${String(centis).padStart(2, '0')}`;
}

/** Millimetres per pixel, the scale readout over the video. Quoted in mm
 *  rather than cm because the interesting range is 1–4 mm/px and "0,21 cm/px"
 *  buries the signal in leading zeros. */
export function mmPerPx(cmPerPx: number): string {
  return num(cmPerPx * 10, 2);
}

/** Signed value with the direction said in words, not only in a sign — colour
 *  and sign alone are not allowed to carry meaning (design brief, hard
 *  conventions). */
export function drift(cm: number, calibrated: boolean): string {
  const magnitude = distance(Math.abs(cm), calibrated);
  if (Math.abs(cm) < (calibrated ? 0.05 : 0.5)) return `${magnitude} (no drift)`;
  return `${magnitude} ${cm > 0 ? 'right' : 'left'} of the start`;
}
