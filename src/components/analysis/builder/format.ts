// Value formatting for the Analysis builder. European convention: comma
// decimal separator (CLAUDE.md). Unit-aware rounding so a pivot cell reads the
// way a coach expects (tonnage in kg/t, intensities as %, counts as integers).

const de = (n: number, decimals: number): string =>
  n.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function formatValue(value: number | null | undefined, unit: string): string {
  if (value == null || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'kg':
      // Tonnage gets large — switch to tonnes past 10 t for legibility. Always
      // carry the unit so a kg row and a t row in the same column don't read as
      // the same magnitude.
      return Math.abs(value) >= 10000 ? `${de(value / 1000, 1)} t` : `${de(Math.round(value), 0)} kg`;
    case '%':
      return `${de(value, 1)}%`;
    case 'reps':
    case 'sets':
      return de(Math.round(value), 0);
    case 'ratio':
      return de(value, 2);
    case 'AU':
      return de(Math.round(value), 0);
    default:
      return de(value, Number.isInteger(value) ? 0 : 1);
  }
}

/** Compact signed delta for the Δ compare mode. */
export function formatDelta(value: number | null | undefined, unit: string): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return sign + formatValue(value, unit);
}

/** Compact, unit-aware axis tick (no decimals on large kg → tonnes). */
export function formatAxisTick(value: number | string | undefined, unit: string): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return value == null ? '' : String(value);
  switch (unit) {
    case 'kg':
      // On an axis the ticks are round gridlines; keep one consistent unit by
      // switching to tonnes once they reach the thousands (4 t, 8 t, 12 t).
      return Math.abs(value) >= 1000 ? `${de(value / 1000, value % 1000 === 0 ? 0 : 1)} t` : de(Math.round(value), 0);
    case '%':
      return `${de(Math.round(value), 0)}%`;
    default:
      return de(Math.round(value), 0);
  }
}
