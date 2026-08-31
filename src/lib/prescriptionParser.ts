import { expandFormulas } from './formulaEval';

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

/**
 * Double quotes escape the notation grammar. Text wrapped in them is a
 * literal load label and is never read as `load×reps×sets` — that is the
 * only way to prescribe a load that contains the separator itself ("30x2"
 * as a name, not as thirty for two). The quotes live in the stored
 * prescription_raw, because the free-text format is `loadText × reps × sets`
 * and re-parsing splits on the × — an unquoted "30x2" would come back as
 * load 30, reps 2 on the next read.
 *
 * Returns the inner text, or null when `raw` is not a quoted literal.
 */
export function splitQuotedLiteral(raw: string): string | null {
  const t = raw.trim();
  if (t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) return null;
  return t.slice(1, -1);
}

/** Characters that would be re-read as grammar if a load text were stored bare. */
const NEEDS_QUOTING = /[",xX×*\n\r\t]/;

/**
 * Wrap a free-text load in quotes when storing it bare would not survive the
 * round trip (it holds a separator, a quote, or edge whitespace). Plain words
 * like "Heavy" are left alone so existing prescriptions do not churn.
 */
export function quoteLoadText(text: string): string {
  const bare = text.replace(/"/g, '');
  if (bare === '' || NEEDS_QUOTING.test(bare) || bare !== bare.trim()) {
    return `"${bare}"`;
  }
  return bare;
}

/**
 * Split on the commas that separate segments, ignoring any inside a quoted
 * literal — `"a,b" × 5` is one segment, not two.
 */
export function splitPrescriptionSegments(raw: string): string[] {
  // An UNMATCHED quote is not a literal — it is an inch mark, and "2\" deficit"
  // is ordinary weightlifting prose that predates the quoting rule. Treating it
  // as an opening quote would make every following comma stop separating, so a
  // stored prescription would lose its later columns the moment it was read.
  // Only balanced quotes get the quote-aware split.
  const quoteCount = (raw.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) return raw.split(',').map(x => x.trim()).filter(Boolean);

  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    if (ch === ',' && !inQuote) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map(x => x.trim()).filter(Boolean);
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
  // A quoted literal is text by definition, whatever it contains. Checked
  // first: `"80x5"` is all digits once the quotes are ignored, so the numeric
  // test below would otherwise claim it for kilograms.
  if (splitQuotedLiteral(input) !== null) return 'free_text_reps';
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
 * One validated segment of a notation line typed into a single grid cell.
 * Carries both the numeric and the textual form of load and reps because
 * GridColumn keeps both and the three formatters each read a different one.
 */
export interface NotationSegment {
  load: number;
  loadMax: number | null;
  loadCmp: LoadCmp | null;
  loadText: string;
  reps: number;
  repsMax: number | null;
  repsText: string;
  sets: number;
  setsMax: number | null;
  multiplier: number | null;
  /** The load is a label, not a number — the row has to be free_text_reps. */
  isText: boolean;
}

/** A load number: "80", "82.5", or an interval "80-90". No leniency. */
const NOTATION_LOAD = /^\d+(?:\.\d+)?$/;
/** A rep or set count, optionally a range: "3" or "3-5". */
const NOTATION_COUNT = /^(\d+)(?:-(\d+))?$/;
/** A combo rep tuple: "2+1", "1+1+1". */
const COMBO_TUPLE = /^\d+(?:\+\d+)*$/;
/** A combo tuple wrapped in rounds: "3(2+1)". */
const COMBO_ROUNDS = /^(\d+)\((\d+(?:\+\d+)*)\)$/;

function parseNotationLoad(token: string): { load: number; loadMax: number | null } | null {
  const dash = token.indexOf('-', 1);
  if (dash !== -1) {
    const lo = token.slice(0, dash);
    const hi = token.slice(dash + 1);
    if (!NOTATION_LOAD.test(lo) || !NOTATION_LOAD.test(hi)) return null;
    const min = parseFloat(lo);
    const max = parseFloat(hi);
    if (max < min) return null;
    return { load: min, loadMax: max };
  }
  if (!NOTATION_LOAD.test(token)) return null;
  return { load: parseFloat(token), loadMax: null };
}

function parseNotationCount(token: string, floor: number): { min: number; max: number | null } | null {
  const m = token.match(NOTATION_COUNT);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const max = m[2] != null ? parseInt(m[2], 10) : null;
  if (min < floor) return null;
  if (max != null && max < min) return null;
  return { min, max };
}

function parseNotationSegment(segment: string, isCombo: boolean): NotationSegment | null {
  const { cmp, rest } = splitLoadCmp(segment);
  const trimmed = rest.trim();
  if (!trimmed) return null;

  let loadToken: string;
  let tail: string;
  let quoted = false;

  if (trimmed.startsWith('"')) {
    const close = trimmed.indexOf('"', 1);
    if (close === -1) return null;
    loadToken = trimmed.slice(1, close);
    tail = trimmed.slice(close + 1);
    quoted = true;
  } else {
    // "=" resolves per segment, so every segment of a line can carry its own
    // arithmetic. splitLoadCmp has already taken any ">=" / "<=" off the
    // front, which is what stops expandFormulas eating the "=" out of it.
    const expanded = expandFormulas(trimmed);
    const normalised = expanded.replace(/%/g, '').replace(/[*×X]/g, 'x');
    const firstX = normalised.indexOf('x');
    loadToken = (firstX === -1 ? normalised : normalised.slice(0, firstX)).trim();
    tail = firstX === -1 ? '' : normalised.slice(firstX);
  }

  if (loadToken === '') return null;

  // The tail is separator-led ("x3", "×5×3") or absent. Anything else — a
  // stray word from a text load that got split at its own "x" — is refused
  // rather than guessed at. Whitespace is closed up only AROUND the
  // separator: any that survives means two segments were run together
  // ("30x2 40x3"), which the storage parser would silently merge into a
  // single 30×240×3 column.
  const t = tail.replace(/[*×X]/g, 'x').replace(/\s*x\s*/gi, 'x').trim();
  if (/\s/.test(t)) return null;
  let parts: string[];
  if (t === '') parts = [];
  else if (t.startsWith('x')) parts = t.slice(1).split('x');
  else return null;
  if (parts.length > 2) return null;

  const numeric = quoted ? null : parseNotationLoad(loadToken);
  const isText = numeric === null;
  if (isText && loadToken.includes('"')) return null;
  // An unquoted load that starts with a digit but did not parse is a botched
  // number ("80—90" with an em dash), not a label. Storing it as text would
  // re-unit the whole row and cost every other column its ranges and signs,
  // so the edit is discarded instead. Quote it to mean it literally.
  if (!quoted && isText && /^\d/.test(loadToken)) return null;
  // An unresolved "=" means the arithmetic did not evaluate. Storing it as a
  // label would flip the row to free text and keep the broken formula as the
  // load, so the line is discarded and the caller can fall back.
  if (!quoted && isText && loadToken.includes('=')) return null;
  // A bare label cannot carry spaces without quotes — "30 40" in a line is a
  // run-together pair, not a name.
  if (!quoted && /\s/.test(loadToken)) return null;

  // reps: a bare load means one rep, which is what makes "30,40,50" a ramp.
  let reps = 1;
  let repsMax: number | null = null;
  let repsText = '1';
  let multiplier: number | null = null;

  if (parts.length >= 1) {
    const token = parts[0];
    const rounds = isCombo ? token.match(COMBO_ROUNDS) : null;
    const tuple = isCombo ? (rounds ? rounds[2] : (COMBO_TUPLE.test(token) ? token : null)) : null;
    if (tuple) {
      multiplier = rounds ? parseInt(rounds[1], 10) : null;
      repsText = tuple;
      reps = tuple.split('+').reduce((sum, n) => sum + (parseInt(n, 10) || 0), 0);
      if (reps < 1) return null;
    } else {
      const parsed = parseNotationCount(token, 1);
      if (!parsed) return null;
      reps = parsed.min;
      repsMax = parsed.max;
      repsText = repsMax != null ? `${reps}-${repsMax}` : String(reps);
    }
  } else if (isCombo) {
    // A combo column with no tuple typed is meaningless; require one.
    return null;
  }

  let sets = 1;
  let setsMax: number | null = null;
  if (parts.length === 2) {
    const parsed = parseNotationCount(parts[1], 1);
    if (!parsed) return null;
    sets = parsed.min;
    setsMax = parsed.max;
  }

  const load = numeric ? numeric.load : (parseFloat(loadToken) || 0);
  const loadMax = numeric ? numeric.loadMax : null;
  const loadText = numeric
    ? (numeric.loadMax != null ? `${numeric.load}-${numeric.loadMax}` : String(numeric.load))
    : loadToken;

  return {
    load,
    loadMax,
    // A soft-load sign on a label has nothing to compare, so it is dropped.
    loadCmp: isText ? null : cmp,
    loadText,
    reps,
    repsMax,
    repsText,
    sets,
    setsMax,
    multiplier,
    isText,
  };
}

/**
 * Parse a whole notation line typed into ONE grid cell, so a coach can write
 * a prescription instead of clicking it up.
 *
 *   "30,40,50"           → three columns, one rep each
 *   "30x2, 40x2x2, 50"   → 30×2, 40×2×2, 50×1
 *   "\"Heavy\" x3"           → a text load, three reps
 *
 * Deliberately NOT parsePrescription: that one requires every segment to
 * carry an "x" (a bare "50" parses to nothing) and drops segments it cannot
 * read without saying so, which would silently shorten a coach's line. This
 * parser is total — one bad segment returns null for the whole line, so the
 * caller can discard the edit rather than commit half of it.
 */
export function parseNotationLine(
  raw: string,
  opts: { isCombo?: boolean } = {},
): NotationSegment[] | null {
  if (!raw || !raw.trim()) return null;
  // A single-line <input> flattens a pasted block to spaces and the storage
  // parser deletes all whitespace, so "30x2 40x3" would merge into one
  // 30×240×3 column. Refuse anything carrying a break rather than guess.
  if (/[\n\r\t]/.test(raw)) return null;

  const out: NotationSegment[] = [];
  for (const segment of splitPrescriptionSegments(raw)) {
    const parsed = parseNotationSegment(segment, opts.isCombo ?? false);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

/**
 * Does this look like a notation LINE rather than a single value? The comma
 * and the multiplier are the only signals — an interval ("80-90") and a
 * range ("3-5") must keep their existing single-cell meanings.
 */
export function looksLikeNotationLine(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  const literal = splitQuotedLiteral(t);
  if (literal !== null) return false;
  // "82,5" is a German decimal, not two columns. One digit after the comma is
  // the tell: OWL loads step in halves, so a decimal is "x,5" — while a real
  // two-step ramp ("30,40") names two plausible loads. Ambiguous by nature;
  // this is the reading that does not silently invent a 5 kg column.
  if (/^\d+,\d$/.test(splitLoadCmp(t).rest.trim())) return false;
  return /,/.test(t) || /[xX×*]/.test(t.replace(/^\s*=[^,xX×]*/, ''));
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
  const segments = splitPrescriptionSegments(raw);

  for (const segment of segments) {
    const parsed = parseFreeTextSegment(segment);
    if (parsed) {
      result.push(parsed);
    }
  }

  return result;
}

function parseFreeTextSegment(segment: string): FreeTextSetLine | null {
  // A quoted load is opaque — it may contain the × separator itself — so it
  // is lifted out before the split that would otherwise cut it in half.
  const trimmed = segment.trim();
  if (trimmed.startsWith('"') && trimmed.indexOf('"', 1) !== -1) {
    const close = trimmed.indexOf('"', 1);
    const loadText = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1).trim();
    if (rest === '') return { loadText, reps: 1, sets: 1 };
    const m = rest.match(/^[x×]\s*(\d+)(?:\s*[x×]\s*(\d+))?$/i);
    if (!m) return null;
    const reps = parseInt(m[1], 10);
    const sets = m[2] != null ? parseInt(m[2], 10) : 1;
    if (isNaN(reps) || reps < 0 || sets <= 0) return null;
    return { loadText, reps, sets };
  }

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

    // A quoted load is opaque — it may hold the × separator itself — so it is
    // lifted out of the ORIGINAL segment (before whitespace was stripped)
    // rather than searched for an "x" that belongs to its own spelling.
    const rawUnsigned = splitLoadCmp(segment.replace(/×/g, 'x').replace(/–/g, '-')).rest.trim();
    let quotedLoad: string | null = null;
    let unsignedBody = unsigned;
    if (rawUnsigned.startsWith('"') && rawUnsigned.indexOf('"', 1) !== -1) {
      const close = rawUnsigned.indexOf('"', 1);
      quotedLoad = rawUnsigned.slice(1, close);
      unsignedBody = 'q' + rawUnsigned.slice(close + 1).replace(/\s+/g, '').replace(/%/g, '');
    }

    const firstX = unsignedBody.indexOf('x');
    if (firstX === -1) continue;

    const loadStr = quotedLoad !== null ? quotedLoad : unsignedBody.slice(0, firstX);
    const rest = unsignedBody.slice(firstX + 1);

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
    if (quotedLoad !== null) { load = parseFloat(quotedLoad) || 0; loadMax = null; loadIsNumeric = false; }
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
        // Same rule as the free-text formatter: quote only when storing it
        // bare would not survive the next read.
        loadPart = quoteLoadText(l.loadText);
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
      const loadStr = quoteLoadText(line.loadText);
      if (line.sets === 1) {
        return `${loadStr} × ${line.reps}`;
      } else {
        return `${loadStr} × ${line.reps} × ${line.sets}`;
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
