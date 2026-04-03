export interface ParsedSetLine {
  sets: number;
  reps: number;
  load: number;
}

export interface FreeTextSetLine {
  sets: number;
  reps: number;
  loadText: string;
}

/**
 * Parses a prescription string into set lines
 * Supports formats like:
 * - "80x5" or "80×5" = 80kg/% for 5 reps (1 set implied)
 * - "80x5x3" or "80×5×3" = 80kg/% for 5 reps for 3 sets
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

  if (parts.length === 2) {
    const load = parseFloat(parts[0]);
    const reps = parseInt(parts[1], 10);
    const sets = 1;

    if (reps > 0 && load >= 0) {
      return { sets, reps, load };
    }
  } else if (parts.length === 3) {
    const load = parseFloat(parts[0]);
    const reps = parseInt(parts[1], 10);
    const sets = parseInt(parts[2], 10);

    if (sets > 0 && reps > 0 && load >= 0) {
      return { sets, reps, load };
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
      if (line.sets === 1) {
        return `${line.load}${unitSymbol}×${line.reps}`;
      } else {
        return `${line.load}${unitSymbol}×${line.reps}×${line.sets}`;
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

    const load = parseFloat(loadStr);
    const loadIsNumeric = !isNaN(load);
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
      const loadPart = l.loadText ?? `${l.load}${sym}`;
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
