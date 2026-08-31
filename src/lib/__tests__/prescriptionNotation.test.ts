import { describe, it, expect } from 'vitest';
import {
  parseNotationLine,
  looksLikeNotationLine,
  splitQuotedLiteral,
  quoteLoadText,
  splitPrescriptionSegments,
  detectIntendedUnit,
  parseFreeTextPrescription,
  formatFreeTextPrescription,
  parsePrescription,
  parseComboPrescription,
  formatComboPrescription,
} from '../prescriptionParser';

/** Terse view of a parsed segment, so the expectations read like notation. */
const shape = (raw: string, isCombo = false) =>
  (parseNotationLine(raw, { isCombo }) ?? []).map(s => ({
    load: s.load, loadMax: s.loadMax, reps: s.reps, sets: s.sets,
    text: s.isText ? s.loadText : null,
  }));

describe('parseNotationLine — the grammar a coach types into one cell', () => {
  it('expands a bare comma list into one column per load, 1 rep each', () => {
    expect(shape('30,40,50')).toEqual([
      { load: 30, loadMax: null, reps: 1, sets: 1, text: null },
      { load: 40, loadMax: null, reps: 1, sets: 1, text: null },
      { load: 50, loadMax: null, reps: 1, sets: 1, text: null },
    ]);
  });

  it('mixes bare, reps and reps×sets segments in one line', () => {
    expect(shape('30x2, 40x2x2, 50')).toEqual([
      { load: 30, loadMax: null, reps: 2, sets: 1, text: null },
      { load: 40, loadMax: null, reps: 2, sets: 2, text: null },
      { load: 50, loadMax: null, reps: 1, sets: 1, text: null },
    ]);
  });

  it('accepts every multiplier spelling the storage parser accepts', () => {
    for (const line of ['80x3, 90x2', '80X3, 90X2', '80×3, 90×2', '80*3, 90*2']) {
      expect(shape(line)).toEqual([
        { load: 80, loadMax: null, reps: 3, sets: 1, text: null },
        { load: 90, loadMax: null, reps: 2, sets: 1, text: null },
      ]);
    }
  });

  it('keeps intervals, rep ranges and set ranges', () => {
    const [seg] = parseNotationLine('80-90x3-5x4-6') ?? [];
    expect(seg).toMatchObject({ load: 80, loadMax: 90, reps: 3, repsMax: 5, sets: 4, setsMax: 6 });
  });

  it('keeps a soft-load sign per segment, and does not spread it', () => {
    const segs = parseNotationLine('>=85x3, 90x2') ?? [];
    expect(segs[0].loadCmp).toBe('>=');
    expect(segs[1].loadCmp).toBeNull();
  });

  it('resolves a formula inside each segment', () => {
    expect(shape('=160*0.5x3, 85x2')).toEqual([
      { load: 80, loadMax: null, reps: 3, sets: 1, text: null },
      { load: 85, loadMax: null, reps: 2, sets: 1, text: null },
    ]);
  });

  it('resolves a formula the single-cell branch cannot — "=160*0.5x3"', () => {
    // resolveFormulaCell treats the whole cell as one expression and errors on
    // the "x", which is why the expansion is checked before it.
    expect(shape('=160*0.5x3')).toEqual([
      { load: 80, loadMax: null, reps: 3, sets: 1, text: null },
    ]);
    expect(shape('=80/2, 90x2')).toEqual([
      { load: 40, loadMax: null, reps: 1, sets: 1, text: null },
      { load: 90, loadMax: null, reps: 2, sets: 1, text: null },
    ]);
  });

  it('strips a percent sign per segment, not just at the end', () => {
    expect(shape('30,40,50%')).toEqual([
      { load: 30, loadMax: null, reps: 1, sets: 1, text: null },
      { load: 40, loadMax: null, reps: 1, sets: 1, text: null },
      { load: 50, loadMax: null, reps: 1, sets: 1, text: null },
    ]);
  });

  it('is total — one unreadable segment discards the whole line', () => {
    expect(parseNotationLine('30x2, 50kg, 40x3')).toBeNull();
    expect(parseNotationLine('30x2, , 40x3')).not.toBeNull(); // empty segments are dropped
    expect(parseNotationLine('')).toBeNull();
  });

  it('refuses run-together segments instead of merging them', () => {
    // The storage parser deletes all whitespace: "30x2 40x3" would become a
    // single 30×240×3 column.
    expect(parseNotationLine('30x2 40x3')).toBeNull();
    expect(parseNotationLine('30 40, 50')).toBeNull();
    expect(parseNotationLine('30x2\n40x3')).toBeNull();
  });

  it('refuses a botched number rather than demoting the row to text', () => {
    expect(parseNotationLine('80—90x3')).toBeNull();   // em dash
    expect(parseNotationLine('80kgx3')).toBeNull();
    expect(parseNotationLine('1e2x3')).toBeNull();
  });

  it('rejects an inverted interval and a zero count', () => {
    expect(parseNotationLine('90-80x3')).toBeNull();
    expect(parseNotationLine('80x0')).toBeNull();
    expect(parseNotationLine('80x3x0')).toBeNull();
  });

  it('takes a bare word as a text load, and a word with an x only when quoted', () => {
    expect(shape('Heavy, 90x2')).toEqual([
      { load: 0, loadMax: null, reps: 1, sets: 1, text: 'Heavy' },
      { load: 90, loadMax: null, reps: 2, sets: 1, text: null },
    ]);
    expect(parseNotationLine('Box squat x3')).toBeNull();
    expect(shape('"Box squat" x3')).toEqual([
      { load: 0, loadMax: null, reps: 3, sets: 1, text: 'Box squat' },
    ]);
  });

  it('reads combo tuples and rounds', () => {
    const segs = parseNotationLine('80x2+1, 90x2+1x3', { isCombo: true }) ?? [];
    expect(segs[0]).toMatchObject({ load: 80, repsText: '2+1', reps: 3, sets: 1 });
    expect(segs[1]).toMatchObject({ load: 90, repsText: '2+1', reps: 3, sets: 3 });
    const [rounds] = parseNotationLine('80x3(2+1)', { isCombo: true }) ?? [];
    expect(rounds).toMatchObject({ multiplier: 3, repsText: '2+1' });
  });
});

describe('looksLikeNotationLine — when a cell edit becomes a line', () => {
  it('fires on a comma or a multiplier', () => {
    expect(looksLikeNotationLine('30,40,50')).toBe(true);
    expect(looksLikeNotationLine('80x3')).toBe(true);
    expect(looksLikeNotationLine('=160*0.5x3')).toBe(true);
  });

  it('leaves the single-cell meanings alone', () => {
    expect(looksLikeNotationLine('80')).toBe(false);
    expect(looksLikeNotationLine('80-90')).toBe(false);   // interval load
    expect(looksLikeNotationLine('3-5')).toBe(false);     // rep range
    expect(looksLikeNotationLine('=160*0.5')).toBe(false); // formula, keeps reps
    expect(looksLikeNotationLine('"30x2"')).toBe(false);  // quoted literal
    expect(looksLikeNotationLine('')).toBe(false);
  });
});

describe('double quotes escape the grammar', () => {
  it('unwraps a literal', () => {
    expect(splitQuotedLiteral('"30x2"')).toBe('30x2');
    expect(splitQuotedLiteral('  "Heavy"  ')).toBe('Heavy');
    expect(splitQuotedLiteral('Heavy')).toBeNull();
    expect(splitQuotedLiteral('"')).toBeNull();
  });

  it('claims a quoted literal for free text however numeric it looks', () => {
    expect(detectIntendedUnit('"80x5"')).toBe('free_text_reps');
    expect(detectIntendedUnit('"80"')).toBe('free_text_reps');
    expect(detectIntendedUnit('80x5')).toBe('absolute_kg');
  });

  it('quotes on storage only when the text would not survive re-reading', () => {
    expect(quoteLoadText('Heavy')).toBe('Heavy');
    expect(quoteLoadText('30x2')).toBe('"30x2"');
    expect(quoteLoadText('Box squat')).toBe('"Box squat"');
    expect(quoteLoadText('a,b')).toBe('"a,b"');
  });

  it('round-trips a literal that contains the separator', () => {
    const stored = formatFreeTextPrescription([{ loadText: '30x2', reps: 1, sets: 1 }]);
    expect(stored).toBe('"30x2" × 1');
    expect(parseFreeTextPrescription(stored)).toEqual([{ loadText: '30x2', reps: 1, sets: 1 }]);
  });

  it('round-trips a multi-word literal, and does not churn a plain one', () => {
    const stored = formatFreeTextPrescription([
      { loadText: 'Box squat', reps: 5, sets: 3 },
      { loadText: 'Heavy', reps: 2, sets: 1 },
    ]);
    expect(stored).toBe('"Box squat" × 5 × 3, Heavy × 2');
    expect(parseFreeTextPrescription(stored)).toEqual([
      { loadText: 'Box squat', reps: 5, sets: 3 },
      { loadText: 'Heavy', reps: 2, sets: 1 },
    ]);
  });

  it('does not split a comma inside a literal', () => {
    expect(splitPrescriptionSegments('"a,b" × 5, Heavy × 3')).toEqual(['"a,b" × 5', 'Heavy × 3']);
    expect(parseFreeTextPrescription('"a,b" × 5')).toEqual([{ loadText: 'a,b', reps: 5, sets: 1 }]);
  });
});

describe('regressions found by review, pinned', () => {
  it('an unmatched quote is an inch mark, not a literal — segments still split', () => {
    // "2\" deficit" is ordinary OWL prose written before the quoting rule
    // existed. Treating the lone quote as an opener made every later comma
    // stop separating, dropping the following columns on READ.
    expect(splitPrescriptionSegments('2" deficit × 5, 90 × 3')).toEqual(['2" deficit × 5', '90 × 3']);
    expect(parseFreeTextPrescription('2" deficit × 5, 90 × 3')).toEqual([
      { loadText: '2" deficit', reps: 5, sets: 1 },
      { loadText: '90', reps: 3, sets: 1 },
    ]);
    expect(parseFreeTextPrescription('4" block × 3 × 5, 100 × 2')).toHaveLength(2);
  });

  it('treats a German decimal comma as one number, not two columns', () => {
    expect(looksLikeNotationLine('82,5')).toBe(false);
    expect(looksLikeNotationLine('>=82,5')).toBe(false);
    // Two plausible loads is still a ramp.
    expect(looksLikeNotationLine('30,40')).toBe(true);
    expect(looksLikeNotationLine('30,40,50')).toBe(true);
  });

  it('never stores a broken formula as a text load', () => {
    expect(parseNotationLine('=80/, 90x2')).toBeNull();
    expect(parseNotationLine('=abcx3')).toBeNull();
  });

  it('lets a text load whose spelling contains an x through as a single value', () => {
    // The grid falls through to its single-value path when there is no comma,
    // so these reach the free-text branch instead of being refused.
    expect(parseNotationLine('Max')).toBeNull();
    expect(parseNotationLine('Box squat')).toBeNull();
    expect(parseNotationLine('Complex')).toBeNull();
    // ...and once stored, quoting keeps them readable.
    expect(quoteLoadText('Max')).toBe('"Max"');
    const stored = formatFreeTextPrescription([{ loadText: 'Max', reps: 1, sets: 1 }]);
    expect(parseFreeTextPrescription(stored)).toEqual([{ loadText: 'Max', reps: 1, sets: 1 }]);
  });

  it('round-trips a quoted load inside a combo', () => {
    const stored = formatComboPrescription(
      [{ sets: 3, setsMax: null, repsText: '2+1', totalReps: 3, load: 0, loadMax: null, loadText: 'Box squat' }],
      'free_text_reps',
    );
    expect(stored).toBe('"Box squat"×2+1×3');
    const back = parseComboPrescription(stored);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ loadText: 'Box squat', repsText: '2+1', sets: 3 });
  });

  it('keeps a plain combo load unquoted and unchanged', () => {
    const stored = formatComboPrescription(
      [{ sets: 3, setsMax: null, repsText: '2+1', totalReps: 3, load: 80, loadMax: null }],
      'absolute_kg',
    );
    expect(stored).toBe('80×2+1×3');
    expect(parseComboPrescription(stored)[0]).toMatchObject({ load: 80, repsText: '2+1', sets: 3 });
  });
});

describe('the storage parser is untouched', () => {
  it('still requires a multiplier and still drops what it cannot read', () => {
    expect(parsePrescription('30,40,50')).toEqual([]);
    expect(parsePrescription('80x5x3')).toEqual([
      { sets: 3, setsMax: null, reps: 5, repsMax: null, load: 80, loadMax: null, loadCmp: null },
    ]);
  });
});
