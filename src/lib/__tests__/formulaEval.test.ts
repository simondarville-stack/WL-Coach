import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  expandFormulas,
  formatFormulaResult,
  resolveFormulaCell,
} from '../formulaEval';

describe('evaluateExpression', () => {
  it('does the four operations', () => {
    expect(evaluateExpression('80/2')).toBe(40);
    expect(evaluateExpression('80+20')).toBe(100);
    expect(evaluateExpression('120-15')).toBe(105);
    expect(evaluateExpression('140*0.85')).toBeCloseTo(119, 9);
  });

  it('respects precedence and parentheses', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('(2+3)*4')).toBe(20);
    expect(evaluateExpression('100-10-10')).toBe(80); // left-associative
    expect(evaluateExpression('100/10/2')).toBe(5);
  });

  it('handles unary signs', () => {
    expect(evaluateExpression('-5')).toBe(-5);
    expect(evaluateExpression('10*-2')).toBe(-20);
    expect(evaluateExpression('--5')).toBe(5);
  });

  it('is right-associative for the power operator', () => {
    expect(evaluateExpression('2^3')).toBe(8);
    expect(evaluateExpression('2^3^2')).toBe(512); // 2^(3^2), not (2^3)^2
    expect(evaluateExpression('2^-1')).toBe(0.5);
  });

  it('does modulo with %', () => {
    expect(evaluateExpression('10%3')).toBe(1);
  });

  it('accepts both decimal separators and whitespace', () => {
    expect(evaluateExpression('82,5*2')).toBe(165);
    expect(evaluateExpression('82.5*2')).toBe(165);
    expect(evaluateExpression(' 80 / 2 ')).toBe(40);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(evaluateExpression('')).toBeNull();
    expect(evaluateExpression('80/')).toBeNull();
    expect(evaluateExpression('(80')).toBeNull();
    expect(evaluateExpression('80)')).toBeNull();
    expect(evaluateExpression('80x5')).toBeNull();     // set separator is not arithmetic
    expect(evaluateExpression('abc')).toBeNull();
    expect(evaluateExpression('80 90')).toBeNull();
  });

  it('rejects non-finite results', () => {
    expect(evaluateExpression('1/0')).toBeNull();
    expect(evaluateExpression('0/0')).toBeNull();
  });

  it('evaluates no identifier, call or property access', () => {
    expect(evaluateExpression('alert(1)')).toBeNull();
    expect(evaluateExpression('constructor')).toBeNull();
    expect(evaluateExpression('[].constructor')).toBeNull();
  });

  it('refuses absurdly long input', () => {
    expect(evaluateExpression('1+'.repeat(200) + '1')).toBeNull();
  });
});

describe('formatFormulaResult', () => {
  it('keeps loads to two decimals with a full stop', () => {
    expect(formatFormulaResult(119, 'decimal')).toBe('119');
    expect(formatFormulaResult(100 / 3, 'decimal')).toBe('33.33');
    expect(formatFormulaResult(-0, 'decimal')).toBe('0');
  });

  it('rounds reps to the nearest whole number, not the floor', () => {
    expect(formatFormulaResult(10 / 3, 'integer')).toBe('3');
    expect(formatFormulaResult(10 / 4, 'integer')).toBe('3'); // 2,5 → 3
    expect(formatFormulaResult(6, 'integer')).toBe('6');
  });
});

describe('resolveFormulaCell', () => {
  it('passes non-formulas through untouched', () => {
    expect(resolveFormulaCell('80')).toEqual({ text: '80', isFormula: false, error: false });
    expect(resolveFormulaCell('70-80')).toEqual({ text: '70-80', isFormula: false, error: false });
    expect(resolveFormulaCell('Heavy')).toEqual({ text: 'Heavy', isFormula: false, error: false });
  });

  it('resolves a load formula', () => {
    expect(resolveFormulaCell('=80/2')).toEqual({ text: '40', isFormula: true, error: false });
    expect(resolveFormulaCell('=140*0.85')).toEqual({ text: '119', isFormula: true, error: false });
  });

  it('keeps the sticky percentage suffix', () => {
    expect(resolveFormulaCell('=160*0.5%')).toEqual({ text: '80%', isFormula: true, error: false });
  });

  it('treats "-" inside a formula as subtraction, not an interval', () => {
    expect(resolveFormulaCell('=90-10').text).toBe('80');
    // …while the same value without "=" stays an interval for the caller to parse
    expect(resolveFormulaCell('90-10').text).toBe('90-10');
  });

  it('rounds to a whole number in integer mode', () => {
    expect(resolveFormulaCell('=10/3', 'integer').text).toBe('3');
  });

  it('flags a broken formula and leaves the text alone', () => {
    expect(resolveFormulaCell('=80/')).toEqual({ text: '=80/', isFormula: true, error: true });
    expect(resolveFormulaCell('=')).toEqual({ text: '=', isFormula: true, error: true });
  });
});

describe('expandFormulas', () => {
  it('leaves a formula-free prescription untouched', () => {
    expect(expandFormulas('80x5, 85x3x2')).toBe('80x5, 85x3x2');
  });

  it('resolves a formula in front of a set separator', () => {
    expect(expandFormulas('=160*0.5x3')).toBe('80x3');
    expect(expandFormulas('=80/2×5×3')).toBe('40×5×3');
  });

  it('resolves each segment independently', () => {
    expect(expandFormulas('=80/2x5, =100-10x3')).toBe('40x5, 90x3');
  });

  it('mixes formulas with plain segments', () => {
    expect(expandFormulas('80x5, =100*0.9x3')).toBe('80x5, 90x3');
  });

  it('leaves a token that does not evaluate exactly as typed', () => {
    expect(expandFormulas('=80/x5')).toBe('=80/x5');
  });
});
