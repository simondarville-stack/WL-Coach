export interface ParsedSetLine {
  sets: number;
  reps: number;
  load: number;
  loadMax: number | null;  // null = fixed, number = interval upper bound
}

export interface FreeTextSetLine {
  sets: number;
  reps: number;
  loadText: string;
}

/**
 * Infer the prescription unit from a coach's raw input.
 *
 * Used by the grid load-cell and the free-form textarea so the coach
 * doesn't have to toggle the unit manually — a "%" suffix flips to
 * percentage, any non-separator letter flips to free_text_reps. A plain
 * number returns null (no change), leaving whatever the exercise was
 * already using.
 *
 * `x`, `X`, `×` and `*` are accepted set/rep separators and are stripped
 * before the letter check so "80x5x3" doesn't trigger free_text_reps.
 */
export function detectIntendedUnit(input: string): 'percentage' | 'free_text_reps' | 'absolute_kg' | null {
  if (!input) return null;
  const stripped = input.replace(/[xX×*]/g, '');
  if (/[a-zA-Z]/.test(stripped)) return 'free_text_reps';
  if (input.includes('%')) return 'percentage';
  // Pure numeric (no letters, no %): the coach is signalling raw kg.
  // Used as the auto-revert path from percentage / free_text_reps back to
  // kg — typing "80x5" in a percentage-mode cell now correctly flips the
  // unit back instead of staying in percentage and reinterpreting 80 as 80%.
  if (/\d/.test(stripped)) return 'absolute_kg';
  return null;
}

/**
 * Parses a prescription string into set lines
 * Supports formats like:
 * - "80x5" or "80×5" = 80kg/% for 5 reps (1 set implied)
 * - "80x5x3" or "80×5×3" = 80kg/% for 5 reps for 3 sets
 * - "80-90x5x3" = interval 80-90kg for 5 reps for 3 sets
 * - "80x5, 85x5" = multiple set lines (comma separated)
 * - "80 x 5 x 3" = with spaces (normalized)
 * - Handles %, kg, RPE based on context
 */
export function parsePrescription(raw: string): ParsedSetLine[] {
  if (!raw || raw.trim() === '') {
    return [];
  }

  const result: ParsedSetLine[] = [];

  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\*/g, 'x')
    .replace(/×/g, 'x')
    .replace(/%/g, '');

  const segments = normalized.split(',').filter(s => s.trim());

  for (const segment of segments) {
    const parsed = parseSegment(segment);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

function parseSegment(segment: string): ParsedSetLine | null {
  const parts = segment.split('x');
  if (parts.length < 2) return null;

  // Parse load — check for interval "min-max"
  const loadStr = parts[0];
  let load: number;
  let loadMax: number | null = null;

  // Interval detection: contains "-" but not at position 0 (not negative number)
  const dashIdx = loadStr.indexOf('-', 1);  // start search at 1 to skip negative sign
  if (dashIdx !== -1) {
    const minStr = loadStr.slice(0, dashIdx);
    const maxStr = loadStr.slice(dashIdx + 1);
    load = parseFloat(minStr);
    loadMax = parseFloat(maxStr);
    if (isNaN(load) || isNaN(loadMax) || loadMax < load) return null;
  } else {
    load = parseFloat(loadStr);
    if (isNaN(load)) return null;
  }

  if (parts.length === 2) {
    const reps = parseInt(parts[1], 10);
    if (reps > 0 && load >= 0) {
      return { sets: 1, reps, load, loadMax };
    }
  } else if (parts.length === 3) {
    const reps = parseInt(parts[1], 10);
    const sets = parseInt(parts[2], 10);
    if (sets > 0 && reps > 0 && load >= 0) {
      return { sets, reps, load, loadMax };
    }
  }

  return null;
}

/**
 * Formats set lines back into a prescription string
 * Display rule: If sets = 1, omit the sets part
 * Format: load×reps×sets (e.g., 20×4×3) or load×reps (e.g., 20×4 when sets=1)
 */
export function formatPrescription(lines: ParsedSetLine[], unit: string | null): string {
  if (lines.length === 0) return '';

  const unitSymbol = unit === 'percentage' ? '%' : '';

  return lines
    .map(line => {
      const loadStr = line.loadMax !== null && line.loadMax !== undefined
        ? `${line.load}-${line.loadMax}${unitSymbol}`
        : `${line.load}${unitSymbol}`;

      if (line.sets === 1) {
        return `${loadStr}×${line.reps}`;
      } else {
        return `${loadStr}×${line.reps}×${line.sets}`;
      }
    })
    .join(', ');
}

/**
 * Formats a prescription string for display with proper × symbols
 * Applies the display rule: sets = 1 → hide sets part
 */
export function formatPrescriptionDisplay(prescription: string | null, unit: string | null = null): string {
  if (!prescription || prescription.trim() === '') return '';

  const parsed = parsePrescription(prescription);
  if (parsed.length === 0) {
    return prescription;
  }

  return formatPrescription(parsed, unit);
}

/**
 * Generates a compact preview for display
 */
export function formatPrescriptionPreview(prescription: string | null): string {
  if (!prescription) return '';

  if (prescription.length <= 40) return prescription;

  return prescription.substring(0, 37) + '...';
}

/**
 * Parses a free text prescription into set lines
 * Format: "text x reps x sets" or "text x reps" (sets = 1 implied)
 * Examples:
 * - "Heavy x 5 x 3" = "Heavy" for 5 reps for 3 sets
 * - "Technical and light x 5" = "Technical and light" for 5 reps (1 set)
 * - "80-90% x 3 x 2" = "80-90%" for 3 reps for 2 sets
 */
export function parseFreeTextPrescription(raw: string): FreeTextSetLine[] {
  if (!raw || raw.trim() === '') {
    return [];
  }

  const result: FreeTextSetLine[] = [];
  const segments = raw.split(',').map(s => s.trim()).filter(s => s);

  for (const segment of segments) {
    const parsed = parseFreeTextSegment(segment);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

function parseFreeTextSegment(segment: string): FreeTextSetLine | null {
  const xPattern = /\s*[x×]\s*/gi;
  const parts = segment.split(xPattern);

  if (parts.length === 2) {
    const loadText = parts[0].trim();
    const reps = parseInt(parts[1], 10);
    if (!isNaN(reps) && reps >= 0) {
      return { loadText, reps, sets: 1 };
    }
  } else if (parts.length === 3) {
    const loadText = parts[0].trim();
    const reps = parseInt(parts[1], 10);
    const sets = parseInt(parts[2], 10);
    if (!isNaN(reps) && reps >= 0 && !isNaN(sets) && sets > 0) {
      return { loadText, reps, sets };
    }
  }

  return null;
}

/**
 * Parsed set line for combo prescriptions ("80×2+1×3")
 */
export interface ParsedComboSetLine {
  sets: number;
  repsText: string;   // "2+1" or "1+1+1"
  totalReps: number;  // sum of all parts
  load: number;
  loadMax: number | null;   // null = fixed, number = interval upper bound
  loadText?: string;  // set when load is free text (non-numeric)
}

/**
 * Parses a combo prescription string where reps are tuples.
 * Format: "80×2+1, 90×2+1×3" (load × tuple_reps × sets)
 * Sets defaults to 1 if omitted.
 */
export function parseComboPrescription(raw: string): ParsedComboSetLine[] {
  if (!raw || raw.trim() === '') return [];

  const segments = raw.split(',').map(s => s.trim()).filter(s => s);
  const result: ParsedComboSetLine[] = [];

  for (const segment of segments) {
    const normalized = segment
      .replace(/×/g, 'x')
      .replace(/\s+/g, '')
      .replace(/%/g, '');

    // Split on 'x' but preserve the '+' inside reps
    // Format: load x repsText [x sets]
    const firstX = normalized.indexOf('x');
    if (firstX === -1) continue;

    const loadStr = normalized.slice(0, firstX);
    const rest = normalized.slice(firstX + 1);

    // Interval detection in load: contains "-" not at position 0
    const dashIdx = loadStr.indexOf('-', 1);
    let load: number;
    let loadMax: number | null = null;
    let loadIsNumeric: boolean;

    if (dashIdx !== -1) {
      const minStr = loadStr.slice(0, dashIdx);
      const maxStr = loadStr.slice(dashIdx + 1);
      load = parseFloat(minStr);
      loadMax = parseFloat(maxStr);
      loadIsNumeric = !isNaN(load) && !isNaN(loadMax);
    } else {
      load = parseFloat(loadStr);
      loadIsNumeric = !isNaN(load);
      loadMax = null;
    }

    // Allow free-text loads (e.g. "Heavy") — store as loadText with load=0
    if (!loadIsNumeric && !loadStr) continue;

    // Check if there's a trailing 'x sets' (last segment after 'x' that is just a number, no '+')
    const lastX = rest.lastIndexOf('x');
    let repsText: string;
    let sets = 1;

    if (lastX !== -1) {
      const possibleSets = rest.slice(lastX + 1);
      const possibleReps = rest.slice(0, lastX);
      // Only treat as sets if it's a plain integer (no '+')
      if (/^\d+$/.test(possibleSets) && possibleReps.length > 0) {
        sets = parseInt(possibleSets, 10);
        repsText = possibleReps;
      } else {
        repsText = rest;
      }
    } else {
      repsText = rest;
    }

    if (!repsText) continue;
    const repsParts = repsText.split('+').map(p => parseInt(p, 10) || 0);
    const totalReps = repsParts.reduce((s, n) => s + n, 0);
    if (totalReps <= 0 || sets <= 0) continue;

    result.push({
      sets,
      repsText,
      totalReps,
      load: loadIsNumeric ? load : 0,
      loadMax: loadIsNumeric ? loadMax : null,
      ...(loadIsNumeric ? {} : { loadText: loadStr }),
    });
  }

  return result;
}

/**
 * Formats combo set lines back into prescription string
 */
export function formatComboPrescription(lines: ParsedComboSetLine[], unit: string | null): string {
  if (!lines.length) return '';
  const sym = unit === 'percentage' ? '%' : '';
  return lines
    .map(l => {
      let loadPart: string;
      if (l.loadText) {
        loadPart = l.loadText;
      } else if (l.loadMax !== null && l.loadMax !== undefined) {
        loadPart = `${l.load}-${l.loadMax}${sym}`;
      } else {
        loadPart = `${l.load}${sym}`;
      }
      return l.sets === 1 ? `${loadPart}×${l.repsText}` : `${loadPart}×${l.repsText}×${l.sets}`;
    })
    .join(', ');
}

/**
 * Formats free text set lines back into a prescription string
 * Display rule: If sets = 1, omit the sets part
 */
export function formatFreeTextPrescription(lines: FreeTextSetLine[]): string {
  if (lines.length === 0) return '';

  return lines
    .map(line => {
      if (line.sets === 1) {
        return `${line.loadText} × ${line.reps}`;
      } else {
        return `${line.loadText} × ${line.reps} × ${line.sets}`;
      }
    })
    .join(', ');
}

export interface PrescriptionSummary {
  total_sets: number;
  total_reps: number;
  highest_load: number | null;
  avg_load: number | null;
}

/**
 * Compute the cached summary (total sets/reps, highest load, weighted-average
 * load) for a prescription. Single source of truth shared by the save path
 * (useWeekPlans.writePrescription, which persists it) and the counting layer's
 * stale-cache fallback (comboExpansion), so a displayed prescription and its
 * counted totals can never disagree.
 *
 * Mirrors the unit branching of the save path exactly: combos and numeric
 * units carry load; text-based units (rpe / free_text / free_text_reps) carry
 * reps & sets only; 'other' carries nothing.
 */
export function computePrescriptionSummary(
  prescription: string,
  unit: string | null,
  isCombo: boolean,
): PrescriptionSummary {
  const empty: PrescriptionSummary = { total_sets: 0, total_reps: 0, highest_load: null, avg_load: null };

  if (isCombo) {
    const parsed = parseComboPrescription(prescription);
    if (parsed.length === 0) return empty;
    const total_sets = parsed.reduce((s, l) => s + l.sets, 0);
    const total_reps = parsed.reduce((s, l) => s + l.sets * l.totalReps, 0);
    const highest_load = Math.max(...parsed.map(l => l.loadMax ?? l.load));
    const weighted = parsed.reduce(
      (s, l) => s + (l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load) * l.sets * l.totalReps, 0);
    return { total_sets, total_reps, highest_load, avg_load: total_reps > 0 ? weighted / total_reps : null };
  }

  const isFreeText = unit === 'free_text';
  const isOtherUnit = unit === 'other';
  const isFreeTextReps = unit === 'free_text_reps';
  const isTextBased = isFreeText || unit === 'rpe' || isFreeTextReps;
  const isNonNumeric = isFreeText || isOtherUnit;

  const parsed = isNonNumeric ? [] : parsePrescription(prescription);
  const parsedText = isTextBased ? parseFreeTextPrescription(prescription) : [];

  if (parsed.length > 0 && !isNonNumeric && !isFreeTextReps) {
    const total_sets = parsed.reduce((s, l) => s + l.sets, 0);
    const total_reps = parsed.reduce((s, l) => s + l.sets * l.reps, 0);
    const highest_load = Math.max(...parsed.map(l => l.loadMax ?? l.load));
    const weighted = parsed.reduce(
      (s, l) => s + (l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load) * l.sets * l.reps, 0);
    return { total_sets, total_reps, highest_load, avg_load: total_reps > 0 ? weighted / total_reps : null };
  }
  if (parsedText.length > 0 && isTextBased) {
    const total_sets = parsedText.reduce((s, l) => s + l.sets, 0);
    const total_reps = parsedText.reduce((s, l) => s + l.sets * l.reps, 0);
    return { total_sets, total_reps, highest_load: null, avg_load: null };
  }
  return empty;
}
