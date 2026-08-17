/**
 * Load comparator — an "exercise feature" that softens a prescribed load:
 * '>=' work up to at least, '~' around, '<=' stay at or below. Typed as
 * ">=", "<=" or "~" in front of the load; displayed as ≥ ≈ ≤.
 * ("==" is deliberately NOT accepted: a leading "=" is the Excel-style
 * formula trigger in grid cells, so it can never reach the parser.)
 */
export type LoadCmp = '>=' | '~' | '<=';

export const LOAD_CMP_GLYPH: Record<LoadCmp, string> = { '>=': '≥', '~': '≈', '<=': '≤' };

/**
 * Split an optional comparator prefix off a load string. Accepts both the
 * typed ASCII forms (">=", "<=", "==", "~") and the display glyphs (≥ ≤ ≈)
 * so formatted prescriptions round-trip through the parser.
 */
export function splitLoadCmp(raw: string): { cmp: LoadCmp | null; rest: string } {
  const s = raw.trimStart();
  if (s.startsWith('>=')) return { cmp: '>=', rest: s.slice(2) };
  if (s.startsWith('≥')) return { cmp: '>=', rest: s.slice(1) };
  if (s.startsWith('<=')) return { cmp: '<=', rest: s.slice(2) };
  if (s.startsWith('≤')) return { cmp: '<=', rest: s.slice(1) };
  if (s.startsWith('≈')) return { cmp: '~', rest: s.slice(1) };
  if (s.startsWith('~')) return { cmp: '~', rest: s.slice(1) };
  return { cmp: null, rest: raw };
}

/** "3-5" → {min: 3, max: 5}; "5" → {min: 5, max: null}; garbage → null. */
function parseIntRange(s: string): { min: number; max: number | null } | null {
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const max = m[2] != null ? parseInt(m[2], 10) : null;
  if (max != null && max < min) return null;
  return { min, max };
}

/** Midpoint of a min/max range (max null = fixed value). */
export function rangeMid(min: number, max: number | null | undefined): number {
  return max != null ? (min + max) / 2 : min;
}

export interface ParsedSetLine {
  sets: number;
  setsMax?: number | null;   // null/absent = fixed set count, number = range upper bound
  reps: number;
  repsMax?: number | null;   // null/absent = fixed reps, number = range upper bound
  load: number;
  loadMax: number | null;  // null = fixed, number = interval upper bound
  loadCmp?: LoadCmp | null;  // soft-load comparator (≥ ≈ ≤), null/absent = exact
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
    .replace(/–/g, '-')
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
  // Optional soft-load comparator in front of the load ("≥85x3-5x4-6").
  const { cmp: loadCmp, rest } = splitLoadCmp(segment);
  const parts = rest.split('x');
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
    const reps = parseIntRange(parts[1]);
    if (reps && reps.min > 0 && load >= 0) {
      return { sets: 1, setsMax: null, reps: reps.min, repsMax: reps.max, load, loadMax, loadCmp };
    }
  } else if (parts.length === 3) {
    const reps = parseIntRange(parts[1]);
    const sets = parseIntRange(parts[2]);
    if (sets && reps && sets.min > 0 && reps.min > 0 && load >= 0) {
      return { sets: sets.min, setsMax: sets.max, reps: reps.min, repsMax: reps.max, load, loadMax, loadCmp };
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
      const cmpPrefix = line.loadCmp ? LOAD_CMP_GLYPH[line.loadCmp] : '';
      const loadStr = line.loadMax !== null && line.loadMax !== undefined
        ? `${cmpPrefix}${line.load}-${line.loadMax}${unitSymbol}`
        : `${cmpPrefix}${line.load}${unitSymbol}`;
      const repsStr = line.repsMax != null ? `${line.reps}-${line.repsMax}` : String(line.reps);
      const setsStr = line.setsMax != null ? `${line.sets}-${line.setsMax}` : String(line.sets);

      // Display rule: sets = 1 hides the sets part — unless it's a range
      // ("1-3" carries information a bare 1 would not).
      if (line.sets === 1 && line.setsMax == null) {
        return `${loadStr}×${repsStr}`;
      }
      return `${loadStr}×${repsStr}×${setsStr}`;
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
  setsMax?: number | null;  // null/absent = fixed set count, number = range upper bound
  repsText: string;   // "2+1" or "1+1+1" — always the BARE per-round tuple
  totalReps: number;  // sum of all parts (one round)
  load: number;
  loadMax: number | null;   // null = fixed, number = interval upper bound
  loadCmp?: LoadCmp | null; // soft-load comparator (≥ ≈ ≤), null/absent = exact
  loadText?: string;  // set when load is free text (non-numeric)
  /**
   * Optional round-grouping multiplier. `undefined` = ungrouped, render the
   * bare tuple "a+b" and count exactly one round. A present integer ≥1 marks
   * the tuple as grouped and serializes as "m(a+b)" — read as "m rounds of
   * (a+b)". It multiplies REPS/volume only; the set count (the ×N suffix)
   * is unaffected. Presence (not magnitude) is the toggle state, so m=1 still
   * round-trips as "1(a+b)".
   */
  multiplier?: number;
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
      .replace(/–/g, '-')
      .replace(/%/g, '');

    // Split on 'x' but preserve the '+' inside reps
    // Format: [cmp]load x repsText [x sets]
    const { cmp: loadCmp, rest: unsigned } = splitLoadCmp(normalized);
    const firstX = unsigned.indexOf('x');
    if (firstX === -1) continue;

    const loadStr = unsigned.slice(0, firstX);
    const rest = unsigned.slice(firstX + 1);

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

    // Check if there's a trailing 'x sets' (last segment after 'x' that is a
    // number or number range, no '+')
    const lastX = rest.lastIndexOf('x');
    let repsText: string;
    let sets = 1;
    let setsMax: number | null = null;

    if (lastX !== -1) {
      const possibleSets = rest.slice(lastX + 1);
      const possibleReps = rest.slice(0, lastX);
      // Only treat as sets if it's a plain integer or range (no '+')
      if (/^\d+(-\d+)?$/.test(possibleSets) && possibleReps.length > 0) {
        const range = parseIntRange(possibleSets);
        if (range) { sets = range.min; setsMax = range.max; }
        repsText = possibleReps;
      } else {
        repsText = rest;
      }
    } else {
      repsText = rest;
    }

    if (!repsText) continue;

    // Optional grouping multiplier: "m(a+b)" ⇒ m rounds of the tuple (a+b).
    // Strip it into a separate `multiplier`, leaving repsText the BARE tuple so
    // downstream positional per-member mapping (comboExpansion) is unaffected.
    // The parens contain no 'x', so the trailing "×sets" detection above is safe.
    let multiplier: number | undefined;
    const groupMatch = repsText.match(/^(\d+)\((.+)\)$/);
    if (groupMatch) {
      multiplier = parseInt(groupMatch[1], 10) || 1;
      repsText = groupMatch[2];
    }

    const repsParts = repsText.split('+').map(p => parseInt(p, 10) || 0);
    const totalReps = repsParts.reduce((s, n) => s + n, 0);
    if (totalReps <= 0 || sets <= 0) continue;

    result.push({
      sets,
      setsMax,
      repsText,
      totalReps,
      load: loadIsNumeric ? load : 0,
      loadMax: loadIsNumeric ? loadMax : null,
      loadCmp: loadIsNumeric ? loadCmp : null,
      ...(multiplier != null ? { multiplier } : {}),
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
      const cmpPrefix = !l.loadText && l.loadCmp ? LOAD_CMP_GLYPH[l.loadCmp] : '';
      let loadPart: string;
      if (l.loadText) {
        loadPart = l.loadText;
      } else if (l.loadMax !== null && l.loadMax !== undefined) {
        loadPart = `${cmpPrefix}${l.load}-${l.loadMax}${sym}`;
      } else {
        loadPart = `${cmpPrefix}${l.load}${sym}`;
      }
      const repsPart = l.multiplier != null ? `${l.multiplier}(${l.repsText})` : l.repsText;
      const setsPart = l.setsMax != null ? `${l.sets}-${l.setsMax}` : String(l.sets);
      // sets = 1 hides the suffix — unless it's a range ("1-3" is information).
      return l.sets === 1 && l.setsMax == null
        ? `${loadPart}×${repsPart}`
        : `${loadPart}×${repsPart}×${setsPart}`;
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

/**
 * Reduce a prescription to its top set line only — the segment with the
 * highest load (ties go to the later segment, i.e. the top of a build-up).
 * Used by the athlete app when the coach hides "sets below top set".
 * Returns null when there is nothing to reduce (0–1 segments), so callers
 * fall back to the full raw.
 */
export function topSetOnlyPrescription(raw: string | null, unit: string | null, isCombo: boolean): string | null {
  if (!raw?.trim()) return null;
  if (isCombo) {
    const lines = parseComboPrescription(raw);
    if (lines.length <= 1) return null;
    const top = lines.reduce((best, l) => ((l.loadMax ?? l.load) >= (best.loadMax ?? best.load) ? l : best));
    return formatComboPrescription([top], unit);
  }
  const lines = parsePrescription(raw);
  if (lines.length <= 1) return null;
  const top = lines.reduce((best, l) => ((l.loadMax ?? l.load) >= (best.loadMax ?? best.load) ? l : best));
  return formatPrescription([top], unit);
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
    // Round-grouping multiplier scales REPS/volume only — the set count is the
    // ×N suffix and is never multiplied (Option A: "the number to the right
    // stays the set count"). m absent ⇒ ×1, so legacy prescriptions are unchanged.
    // Set ranges ("×4-6") count at their midpoint — the honest planned estimate.
    const total_sets = Math.round(parsed.reduce((s, l) => s + rangeMid(l.sets, l.setsMax), 0));
    const total_reps = Math.round(parsed.reduce((s, l) => s + rangeMid(l.sets, l.setsMax) * (l.multiplier ?? 1) * l.totalReps, 0));
    const highest_load = Math.max(...parsed.map(l => l.loadMax ?? l.load));
    // Soft loads (≥ ≈ ≤) prescribe a bound, not a number — they carry no
    // honest average, so they are excluded from BOTH sides of the weighted
    // mean. All lines soft ⇒ avg null (the Ø override feature fills it in).
    let weighted = 0, weightedReps = 0;
    for (const l of parsed) {
      if (l.loadCmp) continue;
      const reps = rangeMid(l.sets, l.setsMax) * (l.multiplier ?? 1) * l.totalReps;
      weighted += (l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load) * reps;
      weightedReps += reps;
    }
    return { total_sets, total_reps, highest_load, avg_load: weightedReps > 0 ? weighted / weightedReps : null };
  }

  const isFreeText = unit === 'free_text';
  const isOtherUnit = unit === 'other';
  const isFreeTextReps = unit === 'free_text_reps';
  const isTextBased = isFreeText || unit === 'rpe' || isFreeTextReps;
  const isNonNumeric = isFreeText || isOtherUnit;

  const parsed = isNonNumeric ? [] : parsePrescription(prescription);
  const parsedText = isTextBased ? parseFreeTextPrescription(prescription) : [];

  if (parsed.length > 0 && !isNonNumeric && !isFreeTextReps) {
    // Rep/set ranges count at their midpoint — the honest planned estimate.
    const lineReps = (l: ParsedSetLine) => rangeMid(l.sets, l.setsMax) * rangeMid(l.reps, l.repsMax);
    const total_sets = Math.round(parsed.reduce((s, l) => s + rangeMid(l.sets, l.setsMax), 0));
    const total_reps = Math.round(parsed.reduce((s, l) => s + lineReps(l), 0));
    const highest_load = Math.max(...parsed.map(l => l.loadMax ?? l.load));
    // Soft loads (≥ ≈ ≤) are excluded from the average entirely — a bound is
    // not a number. All lines soft ⇒ avg null (Ø override feature fills it in).
    let weighted = 0, weightedReps = 0;
    for (const l of parsed) {
      if (l.loadCmp) continue;
      const reps = lineReps(l);
      weighted += (l.loadMax != null ? (l.load + l.loadMax) / 2 : l.load) * reps;
      weightedReps += reps;
    }
    return { total_sets, total_reps, highest_load, avg_load: weightedReps > 0 ? weighted / weightedReps : null };
  }
  if (parsedText.length > 0 && isTextBased) {
    const total_sets = parsedText.reduce((s, l) => s + l.sets, 0);
    const total_reps = parsedText.reduce((s, l) => s + l.sets * l.reps, 0);
    return { total_sets, total_reps, highest_load: null, avg_load: null };
  }
  return empty;
}
