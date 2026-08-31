/**
 * PKsCalculator — the Toolbox desk calculator.
 *
 * Modelled on the TA L 1210 solar: olive plastic shell, solar strip,
 * pale LCD with ghosted segments, the decimal-place and rounding
 * sliders, and the full 7-column key face (function column, digits,
 * arithmetic, memory bank).
 *
 * Unlike the previous expression-based version this is a **chain
 * arithmetic** machine, the way the physical device works: each
 * operator commits the operand on the display. That makes every key on
 * the face meaningful (sqrt, %, MU, EX, n, M+/M-) at the cost of the
 * old parenthesis support, which had no key on this device.
 *
 * Domain notes for the less obvious keys:
 *   ->   shift right — drops the last keyed digit
 *   EX   exchange — swaps the pending accumulator with the display
 *   n    recalls how many terms the current +/- chain has taken, so
 *        "sum a column, divide by n, =" gives an average
 *   MU   mark-up: with x pending it adds the percent, with / pending it
 *        grosses up by the margin (acc / (1 - p/100))
 *
 * The case keeps its own colours in dark mode on purpose — it is a
 * physical object in the UI, not chrome.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

type Op = '+' | '−' | '×' | '÷';

const MAX_DIGITS = 12;
const OVERFLOW = 1e12;

interface CalcState {
  /** Digits currently being keyed. '' means the display shows `value`. */
  entry: string;
  value: number;
  acc: number | null;
  op: Op | null;
  /** Terms committed in the current additive chain — the `n` key. */
  count: number;
  memory: number;
  error: boolean;
  /** True right after `=`, so the next keyed digit starts a fresh chain. */
  chainDone: boolean;
}

const INITIAL: CalcState = {
  entry: '', value: 0, acc: null, op: null,
  count: 0, memory: 0, error: false, chainDone: false,
};

function current(s: CalcState): number {
  if (s.entry === '') return s.value;
  const n = Number(s.entry);
  return Number.isFinite(n) ? n : 0;
}

function settle(s: CalcState, value: number): CalcState {
  if (!Number.isFinite(value) || Math.abs(value) >= OVERFLOW) {
    return { ...s, entry: '', value: 0, acc: null, op: null, error: true };
  }
  return { ...s, entry: '', value };
}

function apply(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
  }
}

/** Fold the pending operation, if any, over the displayed operand. */
function resolve(s: CalcState): number {
  const cur = current(s);
  return s.op !== null && s.acc !== null ? apply(s.acc, cur, s.op) : cur;
}

export type KeyId =
  | 'OFF' | 'EX' | 'MU' | 'n'
  | 'ONC' | 'SIGN' | 'SHR' | 'AC'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.'
  | 'SQRT' | 'PCT' | '+' | '−' | '×' | '÷' | '='
  | 'MC' | 'MR' | 'MSUB' | 'MADD';

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

function reduce(s: CalcState, key: KeyId): CalcState {
  // Once the machine is in error only a clear key gets through.
  if (s.error && key !== 'AC' && key !== 'ONC') return s;

  if (DIGITS.has(key) || key === '00' || key === '.') {
    // A digit after `=` abandons the finished chain.
    const base = s.chainDone
      ? { ...s, acc: null, op: null, count: 0, chainDone: false, entry: '' }
      : s;
    let entry = base.entry;
    if (key === '.') {
      if (entry.includes('.')) return base;
      entry = entry === '' ? '0.' : entry + '.';
    } else if (key === '00') {
      entry = entry === '' || entry === '0' ? '0' : entry + '00';
    } else {
      entry = entry === '' || entry === '0' ? key : entry + key;
    }
    if (entry.replace(/[^0-9]/g, '').length > MAX_DIGITS) return base;
    return { ...base, entry };
  }

  switch (key) {
    case 'ONC':
      // Clear entry only — the pending operation survives, as on the device.
      return { ...s, entry: '', value: 0, error: false };

    case 'AC':
      return { ...INITIAL, memory: s.memory };

    case 'SHR': {
      if (s.entry !== '') {
        const next = s.entry.slice(0, -1);
        return { ...s, entry: next === '' || next === '-' ? '' : next };
      }
      return { ...s, value: Math.trunc(s.value / 10) };
    }

    case 'SIGN':
      if (s.entry !== '') {
        return { ...s, entry: s.entry.startsWith('-') ? s.entry.slice(1) : '-' + s.entry };
      }
      return { ...s, value: -s.value };

    case 'SQRT': {
      const cur = current(s);
      if (cur < 0) return { ...s, entry: '', value: 0, acc: null, op: null, error: true };
      return settle(s, Math.sqrt(cur));
    }

    case 'PCT': {
      const cur = current(s);
      if (s.acc === null || s.op === null) return settle(s, cur / 100);
      if (s.op === '×') {
        return { ...settle(s, (s.acc * cur) / 100), acc: null, op: null, chainDone: true };
      }
      if (s.op === '÷') {
        if (cur === 0) return { ...s, entry: '', value: 0, acc: null, op: null, error: true };
        return { ...settle(s, s.acc / (cur / 100)), acc: null, op: null, chainDone: true };
      }
      // Additive: the percent becomes the operand, `=` finishes the sum.
      return settle(s, (s.acc * cur) / 100);
    }

    case 'MU': {
      const cur = current(s);
      if (s.acc === null || (s.op !== '×' && s.op !== '÷')) return s;
      if (s.op === '×') {
        return { ...settle(s, s.acc * (1 + cur / 100)), acc: null, op: null, chainDone: true };
      }
      if (cur >= 100) return { ...s, entry: '', value: 0, acc: null, op: null, error: true };
      return { ...settle(s, s.acc / (1 - cur / 100)), acc: null, op: null, chainDone: true };
    }

    case 'EX': {
      if (s.acc === null) return s;
      const cur = current(s);
      return { ...s, entry: '', value: s.acc, acc: cur };
    }

    case 'n':
      return { ...s, entry: String(s.count), chainDone: false };

    case '+': case '−': case '×': case '÷': {
      const additive = s.op === '+' || s.op === '−';
      const startingChain = s.op === null && !s.chainDone;
      const next = settle({ ...s, chainDone: false }, resolve(s));
      if (next.error) return next;
      let count = s.count;
      if (additive) count += 1;
      else if (startingChain && (key === '+' || key === '−')) count = 1;
      return { ...next, acc: next.value, op: key, count };
    }

    case '=': {
      if (s.op === null || s.acc === null) {
        return { ...s, entry: '', value: current(s), chainDone: true };
      }
      const additive = s.op === '+' || s.op === '−';
      const next = settle(s, resolve(s));
      if (next.error) return next;
      return {
        ...next,
        acc: null,
        op: null,
        chainDone: true,
        count: additive ? s.count + 1 : s.count,
      };
    }

    case 'MC': return { ...s, memory: 0 };
    case 'MR': return { ...s, entry: '', value: s.memory, chainDone: false };
    case 'MADD': return { ...s, memory: s.memory + current(s), entry: '', value: current(s) };
    case 'MSUB': return { ...s, memory: s.memory - current(s), entry: '', value: current(s) };

    case 'OFF': return s; // handled by the caller — it closes the panel

    // Digit-ish keys never reach here; they are consumed above.
    default: return s;
  }
}

/* ------------------------------------------------------------------ *
 * Display formatting — driven by the two case sliders
 * ------------------------------------------------------------------ */

/** Decimal-place selector, exactly as legended on the case. */
const DECIMAL_POSITIONS = ['A', '0', '1', '2', '3', '4', '6', 'F'] as const;
type DecimalPos = (typeof DECIMAL_POSITIONS)[number];

/** Rounding selector: away from zero / half up / truncate. */
const ROUND_POSITIONS = ['↑', '5/4', '↓'] as const;
type RoundPos = (typeof ROUND_POSITIONS)[number];

function fixedPlaces(pos: DecimalPos): number | null {
  if (pos === 'F') return null;
  if (pos === 'A') return 2; // add mode — two places, as on a till
  return Number(pos);
}

function roundAt(n: number, places: number, mode: RoundPos): number {
  const f = Math.pow(10, places);
  const x = n * f;
  const mag = Math.abs(x);
  const sign = x < 0 ? -1 : 1;
  const r = mode === '↑' ? Math.ceil(mag) : mode === '↓' ? Math.floor(mag) : Math.round(mag);
  return (sign * r) / f;
}

function formatValue(n: number, decimals: DecimalPos, rounding: RoundPos): string {
  if (!Number.isFinite(n)) return 'E';
  const places = fixedPlaces(decimals);
  if (places === null) {
    const trimmed = parseFloat(n.toPrecision(MAX_DIGITS));
    return Object.is(trimmed, -0) ? '0' : String(trimmed);
  }
  const rounded = roundAt(n, places, rounding);
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(places);
}

/* ------------------------------------------------------------------ *
 * Case
 * ------------------------------------------------------------------ */

const SHELL = {
  top: '#8a8371',
  body: '#7a7361',
  deep: '#635d4e',
  edge: '#4b473c',
  ink: '#efece1',
  inkDim: 'rgba(239, 236, 225, 0.62)',
};

const LCD = {
  glass: 'linear-gradient(175deg, #d5d9c0 0%, #c7ccb2 55%, #cfd4ba 100%)',
  digit: '#2c3226',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

type Tone = 'digit' | 'light' | 'amber' | 'orange' | 'plus' | 'ac';

const LIGHT_PLASTIC = 'linear-gradient(180deg, #d6d1c1 0%, #c7c1b0 55%, #b7b1a0 100%)';
const LIGHT_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 1.5px rgba(0,0,0,0.34)';

const TONES: Record<Tone, CSSProperties> = {
  digit: {
    background: 'linear-gradient(180deg, #555046 0%, #47433a 55%, #3d3931 100%)',
    color: '#dcd8cb',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 1.5px rgba(0,0,0,0.38)',
  },
  light: { background: LIGHT_PLASTIC, color: '#33302a', boxShadow: LIGHT_SHADOW },
  amber: {
    background: 'linear-gradient(180deg, #e6ac41 0%, #d99a2b 55%, #c68a1f 100%)',
    color: '#3b3013',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 1px 1.5px rgba(0,0,0,0.36)',
  },
  orange: {
    background: 'linear-gradient(180deg, #dd8450 0%, #d0703c 55%, #bd6130 100%)',
    color: '#fdf6ee',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.34), 0 1px 1.5px rgba(0,0,0,0.36)',
  },
  plus: {
    background: LIGHT_PLASTIC,
    color: '#2f6f9e',
    boxShadow: 'inset 0 0 0 1.5px #4f7fa8, inset 0 1px 0 rgba(255,255,255,0.45), 0 1px 1.5px rgba(0,0,0,0.34)',
  },
  ac: { background: LIGHT_PLASTIC, color: '#b8801a', boxShadow: LIGHT_SHADOW },
};

interface KeySpec {
  id: KeyId;
  label: string;
  tone: Tone;
  col: number;
  row: number;
  rowSpan?: number;
  title?: string;
  aria?: string;
  size?: number;
}

/** The face, laid out as on the device: 7 columns, 5 rows. */
const KEYS: KeySpec[] = [
  { id: 'OFF', label: 'OFF', tone: 'light', col: 1, row: 1, title: 'Off — close the calculator' },
  { id: 'EX', label: 'EX', tone: 'light', col: 5, row: 1, title: 'Exchange — swap the pending value with the display' },
  { id: 'MU', label: 'MU', tone: 'light', col: 6, row: 1, title: 'Mark-up — with × it adds the percent, with ÷ it grosses up by the margin' },
  { id: 'n', label: 'n', tone: 'light', col: 7, row: 1, title: 'Term count of the current + / − chain' },

  { id: 'ONC', label: 'ON/C', tone: 'amber', col: 1, row: 2, title: 'Clear entry', size: 8.5 },
  { id: 'SIGN', label: '±', tone: 'light', col: 1, row: 3, title: 'Change sign', aria: 'Change sign' },
  { id: 'SHR', label: '→', tone: 'light', col: 1, row: 4, title: 'Shift right — delete the last digit', aria: 'Delete last digit' },
  { id: 'AC', label: 'AC', tone: 'ac', col: 1, row: 5, title: 'All clear' },

  { id: '7', label: '7', tone: 'digit', col: 2, row: 2 },
  { id: '8', label: '8', tone: 'digit', col: 3, row: 2 },
  { id: '9', label: '9', tone: 'digit', col: 4, row: 2 },
  { id: '4', label: '4', tone: 'digit', col: 2, row: 3 },
  { id: '5', label: '5', tone: 'digit', col: 3, row: 3 },
  { id: '6', label: '6', tone: 'digit', col: 4, row: 3 },
  { id: '1', label: '1', tone: 'digit', col: 2, row: 4 },
  { id: '2', label: '2', tone: 'digit', col: 3, row: 4 },
  { id: '3', label: '3', tone: 'digit', col: 4, row: 4 },
  { id: '0', label: '0', tone: 'digit', col: 2, row: 5 },
  { id: '00', label: '00', tone: 'digit', col: 3, row: 5 },
  { id: '.', label: '·', tone: 'digit', col: 4, row: 5, aria: 'Decimal point', size: 15 },

  { id: 'SQRT', label: '√', tone: 'light', col: 5, row: 2, title: 'Square root', aria: 'Square root' },
  { id: '−', label: '−', tone: 'orange', col: 5, row: 3, aria: 'Minus', size: 15 },
  { id: '+', label: '+', tone: 'plus', col: 5, row: 4, rowSpan: 2, aria: 'Plus', size: 17 },

  { id: 'PCT', label: '%', tone: 'light', col: 6, row: 2, title: 'Percent' },
  { id: '÷', label: '÷', tone: 'light', col: 6, row: 3, aria: 'Divide' },
  { id: '×', label: '×', tone: 'light', col: 6, row: 4, aria: 'Multiply' },
  { id: '=', label: '=', tone: 'light', col: 6, row: 5, aria: 'Equals' },

  { id: 'MC', label: 'MC', tone: 'light', col: 7, row: 2, title: 'Memory clear', size: 10 },
  { id: 'MR', label: 'MR', tone: 'light', col: 7, row: 3, title: 'Memory recall', size: 10 },
  { id: 'MSUB', label: 'M−', tone: 'light', col: 7, row: 4, title: 'Subtract from memory', size: 10 },
  { id: 'MADD', label: 'M+', tone: 'light', col: 7, row: 5, title: 'Add to memory', size: 10 },
];

interface PKsCalculatorProps {
  onClose: () => void;
  /** Extra Tailwind classes for positioning override, e.g. "bottom-4 right-[300px]" */
  positionClass?: string;
}

export function PKsCalculator({ onClose, positionClass = 'bottom-4 right-4' }: PKsCalculatorProps) {
  const [state, setState] = useState<CalcState>(INITIAL);
  const [decimals, setDecimals] = useState<DecimalPos>('F');
  const [rounding, setRounding] = useState<RoundPos>('5/4');
  const panelRef = useRef<HTMLDivElement>(null);
  const { containerStyle, handleProps } = useDraggable(panelRef);

  const press = useCallback((key: KeyId) => {
    if (key === 'OFF') { onClose(); return; }
    setState(s => reduce(s, key));
  }, [onClose]);

  useEffect(() => {
    const KEY_MAP: Record<string, KeyId> = {
      '*': '×', 'x': '×', '/': '÷', ':': '÷', '+': '+', '-': '−', '=': '=',
      '%': 'PCT', 'r': 'SQRT', 'e': 'EX',
    };
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }

      // Only intercept the keyboard when no other field owns it.
      const active = document.activeElement;
      const isInputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (isInputFocused && !panelRef.current?.contains(active)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Enter') { e.preventDefault(); press('='); return; }
      if (e.key === 'Backspace') { e.preventDefault(); press('SHR'); return; }
      if (e.key === 'Delete') { e.preventDefault(); press('AC'); return; }
      if (DIGITS.has(e.key)) { e.preventDefault(); press(e.key as KeyId); return; }
      if (e.key === '.' || e.key === ',') { e.preventDefault(); press('.'); return; }
      const mapped = KEY_MAP[e.key.toLowerCase()];
      if (mapped) { e.preventDefault(); press(mapped); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [press, onClose]);

  const readout = state.error
    ? 'E'
    : state.entry !== ''
      ? state.entry
      : formatValue(state.value, decimals, rounding);

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 w-[320px] rounded-[12px] overflow-hidden flex flex-col ${positionClass}`}
      style={{
        ...containerStyle,
        background: `linear-gradient(180deg, ${SHELL.top} 0%, ${SHELL.body} 42%, ${SHELL.deep} 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px ${SHELL.edge}, 0 18px 40px -12px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3)`,
      }}
      role="dialog"
      aria-label="PKs Calculator"
    >
      {/* Upper case — solar strip, nameplate, display, sliders. Also the drag handle. */}
      <div {...handleProps} className="relative px-3 pt-2.5 pb-2">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-1.5 right-1.5 z-10 rounded-full p-[3px]"
          style={{ color: 'rgba(255,255,255,0.45)', background: 'rgba(0,0,0,0.16)' }}
        >
          <X size={11} />
        </button>

        {/* Solar strip */}
        <div
          className="h-[13px] rounded-[2px] mr-6 flex overflow-hidden"
          style={{
            background: 'linear-gradient(170deg, #35322b 0%, #24221d 60%, #2c2924 100%)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.14)',
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex-1"
              style={{ borderRight: i < 5 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
            />
          ))}
        </div>

        {/* Nameplate */}
        <div className="flex items-baseline gap-1.5 mt-1.5 mb-1.5">
          <span
            className="italic font-bold leading-none"
            style={{ fontSize: 15, color: SHELL.ink, letterSpacing: '-0.02em', textShadow: '0 1px 0 rgba(0,0,0,0.32)' }}
          >
            PK
          </span>
          <span
            className="uppercase leading-none"
            style={{ fontSize: 7, color: SHELL.inkDim, letterSpacing: '0.13em' }}
          >
            Peter D. Käks
          </span>
          <span className="ml-auto leading-none" style={{ fontSize: 9.5, color: SHELL.inkDim }}>
            L 1210 <span className="italic">solar</span>
          </span>
        </div>

        {/* LCD */}
        <div
          className="relative rounded-[2px] h-[46px] px-2 flex items-end justify-end overflow-hidden"
          style={{
            background: LCD.glass,
            boxShadow: `inset 0 2px 4px rgba(0,0,0,0.34), 0 1px 0 rgba(255,255,255,0.16), 0 0 0 1px ${SHELL.edge}`,
          }}
        >
          {/* Annunciators */}
          <div
            className="absolute left-2 top-1 flex gap-1.5 leading-none"
            style={{ fontSize: 8, color: LCD.digit, opacity: 0.72, fontFamily: LCD.mono }}
          >
            <span style={{ visibility: state.memory !== 0 ? 'visible' : 'hidden' }}>M</span>
            <span style={{ visibility: state.op ? 'visible' : 'hidden' }}>{state.op ?? '+'}</span>
            {decimals !== 'F' && <span>{decimals === 'A' ? 'A' : `F${decimals}`}</span>}
          </div>

          {/* Ghosted segments, the way an idle LCD leaks its unlit digits */}
          <div
            aria-hidden
            className="absolute right-2 bottom-[6px] leading-none pointer-events-none select-none"
            style={{
              fontFamily: LCD.mono, fontSize: 26, letterSpacing: '0.05em',
              color: LCD.digit, opacity: 0.075,
            }}
          >
            888888888888
          </div>

          <div
            className="relative mb-[6px] leading-none truncate max-w-full"
            style={{
              fontFamily: LCD.mono, fontSize: 26, letterSpacing: '0.05em', color: LCD.digit,
              fontVariantNumeric: 'tabular-nums',
              textShadow: '0 1px 0 rgba(255,255,255,0.22)',
            }}
          >
            {readout}
          </div>
        </div>

        {/* Slider bank: rounding at the left, decimal places at the right */}
        <div className="flex items-end justify-between mt-2">
          <Slider positions={ROUND_POSITIONS} value={rounding} onChange={setRounding} label="Rounding" width={46} />
          <Slider positions={DECIMAL_POSITIONS} value={decimals} onChange={setDecimals} label="Decimal places" width={148} />
        </div>
      </div>

      {/* Key face */}
      <div
        className="px-2.5 pt-2 pb-1.5 grid gap-[4px]"
        style={{
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: '17px repeat(4, 29px)',
          background: `linear-gradient(180deg, ${SHELL.body} 0%, ${SHELL.deep} 100%)`,
          borderTop: '1px solid rgba(0,0,0,0.14)',
        }}
      >
        {KEYS.map(k => (
          <button
            key={k.id}
            onClick={() => press(k.id)}
            title={k.title}
            aria-label={k.aria ?? k.title ?? k.label}
            className="rounded-[4px] flex items-center justify-center leading-none active:translate-y-[1px]"
            style={{
              ...TONES[k.tone],
              gridColumn: k.col,
              gridRow: k.rowSpan ? `${k.row} / span ${k.rowSpan}` : k.row,
              fontSize: k.size ?? (k.row === 1 ? 8.5 : 12),
              fontWeight: k.tone === 'digit' ? 500 : 600,
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Case foot */}
      <div className="flex items-center justify-end px-3 pb-1.5 pt-0.5">
        <span
          style={{
            fontSize: 7,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.14)',
            textShadow: '0 1px 0 rgba(0,0,0,0.2)',
          }}
        >
          16.3.2024
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Case slider — legend above a recessed track, knob under the setting
 * ------------------------------------------------------------------ */

interface SliderProps<T extends string> {
  positions: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  width: number;
}

function Slider<T extends string>({ positions, value, onChange, label, width }: SliderProps<T>) {
  const index = Math.max(0, positions.indexOf(value));
  const slot = width / positions.length;

  return (
    <div style={{ width }} title={`${label}: ${value}`}>
      <div className="flex" style={{ marginBottom: 1 }}>
        {positions.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-label={`${label} ${p}`}
            aria-pressed={p === value}
            className="leading-none"
            style={{
              width: slot,
              fontSize: 6.5,
              color: p === value ? SHELL.ink : SHELL.inkDim,
              textShadow: '0 1px 0 rgba(0,0,0,0.28)',
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <div
        className="relative rounded-[2px]"
        style={{
          height: 8,
          background: 'linear-gradient(180deg, #4d4941 0%, #5d584d 100%)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.16)',
        }}
      >
        <div
          className="absolute rounded-[1.5px] pointer-events-none"
          style={{
            top: 1,
            bottom: 1,
            left: index * slot + slot * 0.16,
            width: slot * 0.68,
            background: 'linear-gradient(180deg, #ddd8c8 0%, #b9b3a2 100%)',
            boxShadow: '0 1px 1px rgba(0,0,0,0.4)',
            transition: 'left 120ms ease',
          }}
        />
      </div>
    </div>
  );
}
