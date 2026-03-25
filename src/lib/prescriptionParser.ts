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

    if (loadText && reps > 0) {
      return { loadText, reps, sets: 1 };
    }
  } else if (parts.length === 3) {
    const loadText = parts[0].trim();
    const reps = parseInt(parts[1], 10);
    const sets = parseInt(parts[2], 10);

    if (loadText && reps > 0 && sets > 0) {
      return { loadText, reps, sets };
    }
  }

  return null;
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
