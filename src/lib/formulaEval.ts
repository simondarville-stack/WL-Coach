/**
 * formulaEval — Excel-style "=" arithmetic for prescription inputs.
 *
 * A coach writing loads does arithmetic in their head all day ("85 % of 140",
 * "half of last week"). Typing `=140*0.85` into the cell and getting `119`
 * removes that step. The `=` is an explicit opt-in, so nothing about the
 * existing prescription grammar changes for anyone who doesn't type it.
 *
 * Deliberately hand-rolled rather than `eval`/`new Function`/mathjs:
 *  - a coach's cell is a *number*, not a program — identifiers, calls and
 *    property access have no meaning here and are simply not in the grammar;
 *  - mathjs is already bundled for the Calculator, but it would happily
 *    evaluate things a prescription cell should never contain.
 *
 * The parser is a plain recursive descent over
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/' | '%') factor)*      // '%' is modulo
 *   factor  := ('+' | '-')* power                      // unary sign
 *   power   := primary ('^' factor)?                   // right-associative
 *   primary := NUMBER | '(' expr ')'
 *   NUMBER  := digits [('.' | ',') digits]
 * with comma accepted as a decimal separator, matching the German locale
 * convention the rest of the app uses for numeric input.
 */

/** Longest expression we will even attempt — a runaway-paste guard. */
const MAX_EXPRESSION_LENGTH = 128;

/**
 * Evaluate a bare arithmetic expression (no leading '='). Returns null for
 * anything that isn't a well-formed, finite number — malformed syntax,
 * trailing garbage, division by zero.
 */
export function evaluateExpression(expr: string): number | null {
  if (!expr || expr.length > MAX_EXPRESSION_LENGTH) return null;

  let pos = 0;
  const peek = (): string => expr[pos] ?? '';
  const skipWs = (): void => { while (pos < expr.length && /\s/.test(expr[pos])) pos++; };

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== '+' && op !== '-') return left;
      pos++;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== '*' && op !== '/' && op !== '%') return left;
      pos++;
      const right = parseFactor();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else left = left % right;
    }
  }

  function parseFactor(): number {
    skipWs();
    const op = peek();
    if (op === '+') { pos++; return parseFactor(); }
    if (op === '-') { pos++; return -parseFactor(); }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipWs();
    if (peek() !== '^') return base;
    pos++;
    // Right-associative: 2^3^2 is 2^(3^2). parseFactor so "-" binds in the exponent.
    return Math.pow(base, parseFactor());
  }

  function parsePrimary(): number {
    skipWs();
    if (peek() === '(') {
      pos++;
      const v = parseExpr();
      skipWs();
      if (peek() !== ')') throw new Error('unbalanced parenthesis');
      pos++;
      return v;
    }
    const start = pos;
    while (pos < expr.length && /[0-9]/.test(expr[pos])) pos++;
    if (pos < expr.length && (expr[pos] === '.' || expr[pos] === ',')) {
      pos++;
      while (pos < expr.length && /[0-9]/.test(expr[pos])) pos++;
    }
    if (pos === start) throw new Error('number expected');
    const n = parseFloat(expr.slice(start, pos).replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error('not a number');
    return n;
  }

  try {
    const value = parseExpr();
    skipWs();
    if (pos !== expr.length) return null; // trailing garbage — reject, don't guess
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Render an evaluated result back into the prescription grammar.
 *
 * 'decimal' is for loads — two decimals is finer than any plate on the bar and
 * keeps `=100/3` readable. The separator is '.', because the *stored*
 * prescription string is parsed with `parseFloat`; comma decimals are a
 * display-layer concern (`loadRepsFormat.formatKg`).
 *
 * 'integer' is for reps / sets / multipliers, and rounds rather than truncates:
 * `=10/3` is 3, and `=10/4` is 3 — a coach writing a division wants the nearest
 * whole rep, not the floor.
 */
export function formatFormulaResult(n: number, mode: 'decimal' | 'integer'): string {
  if (mode === 'integer') return String(Math.round(n));
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

export interface FormulaResult {
  /** Resolved text to commit — the input verbatim when it wasn't a formula. */
  text: string;
  /** Did the input start with '='? */
  isFormula: boolean;
  /** A formula that failed to evaluate. `text` is left untouched. */
  error: boolean;
}

/**
 * Single-cell adapter: one cell holds one number, so there is no ambiguity
 * between the arithmetic operators and the prescription separators.
 *
 * A trailing '%' is peeled off and re-attached, so the grid's sticky-percentage
 * affordance keeps working: `=160*0.5%` commits `80%` and still reads as a
 * percentage prescription.
 *
 * Note the deliberate consequence: inside a formula `-` is subtraction, so
 * `=90-10` is 80, not the interval 90–10. That is unambiguous precisely because
 * `=` is opt-in — an interval is typed `70-80`, with no `=`.
 */
export function resolveFormulaCell(
  input: string,
  mode: 'decimal' | 'integer' = 'decimal',
): FormulaResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('=')) return { text: input, isFormula: false, error: false };

  const hasPct = trimmed.endsWith('%');
  const body = hasPct ? trimmed.slice(1, -1) : trimmed.slice(1);
  const value = evaluateExpression(body);
  if (value === null) return { text: input, isFormula: true, error: true };

  return {
    text: formatFormulaResult(value, mode) + (hasPct ? '%' : ''),
    isFormula: true,
    error: false,
  };
}

/**
 * Whole-string adapter for the free-form prescription textarea, where one
 * string holds several segments.
 *
 * A formula token runs from '=' until the first character that belongs to the
 * prescription grammar rather than to arithmetic — `x`, `×`, `*` used as a set
 * separator can't be distinguished from multiplication, so the token ends at
 * `x`/`X`/`×`/`,` or end of string. Two consequences, both worth stating in the
 * input's own help text:
 *  - ',' separates segments, so a decimal inside a formula must use '.'
 *    (`=80.5*2, 85x3` works; `=80,5*2` does not);
 *  - '*' inside a formula is always multiplication, so write the set separator
 *    as 'x' or '×' (`=160*0.5x3` → `80x3`).
 * A token that fails to evaluate is left exactly as typed.
 */
export function expandFormulas(raw: string): string {
  if (!raw || !raw.includes('=')) return raw;
  return raw.replace(/=[0-9.+\-*/%^()\s]*/g, match => {
    const value = evaluateExpression(match.slice(1).trim());
    return value === null ? match : formatFormulaResult(value, 'decimal');
  });
}
