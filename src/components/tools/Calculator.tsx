import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Delete } from 'lucide-react';
import { evaluate } from 'mathjs';

function toMathExpr(input: string): string {
  return input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
}

function safeEvaluate(input: string): string {
  const expr = toMathExpr(input).trim();
  if (!expr) return '';
  try {
    const result = evaluate(expr);
    if (typeof result === 'number') {
      if (!isFinite(result)) return 'Error';
      return parseFloat(result.toPrecision(10)).toString();
    }
    return String(result);
  } catch {
    return '';
  }
}

type BtnStyle = 'number' | 'operator' | 'action' | 'equals';

const BUTTONS: { label: string; value: string; style: BtnStyle }[] = [
  // Row 1
  { label: 'C',  value: 'C',  style: 'action'   },
  { label: '⌫',  value: '⌫',  style: 'action'   },
  { label: '(',  value: '(',  style: 'operator'  },
  { label: ')',  value: ')',  style: 'operator'  },
  // Row 2
  { label: '7',  value: '7',  style: 'number'   },
  { label: '8',  value: '8',  style: 'number'   },
  { label: '9',  value: '9',  style: 'number'   },
  { label: '÷',  value: '÷',  style: 'operator' },
  // Row 3
  { label: '4',  value: '4',  style: 'number'   },
  { label: '5',  value: '5',  style: 'number'   },
  { label: '6',  value: '6',  style: 'number'   },
  { label: '×',  value: '×',  style: 'operator' },
  // Row 4
  { label: '1',  value: '1',  style: 'number'   },
  { label: '2',  value: '2',  style: 'number'   },
  { label: '3',  value: '3',  style: 'number'   },
  { label: '−',  value: '−',  style: 'operator' },
  // Row 5
  { label: '0',  value: '0',  style: 'number'   },
  { label: '.',  value: '.',  style: 'number'   },
  { label: '=',  value: '=',  style: 'equals'   },
  { label: '+',  value: '+',  style: 'operator' },
];

const buttonStyles: Record<BtnStyle, string> = {
  number:   'bg-white hover:bg-gray-50 text-gray-800 border border-gray-200',
  operator: 'bg-gray-50 hover:bg-gray-100 text-blue-600 font-medium border border-gray-200',
  action:   'bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200',
  equals:   'bg-blue-600 hover:bg-blue-700 text-white font-medium',
};

interface CalculatorProps {
  onClose: () => void;
  /** Extra Tailwind classes for positioning override, e.g. "bottom-4 right-[300px]" */
  positionClass?: string;
}

export function Calculator({ onClose, positionClass = 'bottom-4 right-4' }: CalculatorProps) {
  const [input, setInput] = useState('');
  const [justEvaled, setJustEvaled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }

      // Only intercept keyboard if no other input is focused
      const active = document.activeElement;
      const isInputFocused = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (isInputFocused && !panelRef.current?.contains(active)) return;

      if (e.key === 'Enter') { e.preventDefault(); handlePress('='); return; }
      if (e.key === 'Backspace') { e.preventDefault(); handlePress('⌫'); return; }
      if (e.key === 'Delete') { e.preventDefault(); handlePress('C'); return; }

      const keyMap: Record<string, string> = { '*': '×', '/': '÷' };
      const allowed = '0123456789.+-()';
      const mapped = keyMap[e.key] ?? e.key;
      if (allowed.includes(e.key) || keyMap[e.key]) {
        e.preventDefault();
        handlePress(mapped);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, justEvaled, onClose]);

  const liveResult = useMemo(() => safeEvaluate(input), [input]);

  function handlePress(value: string) {
    if (value === 'C') {
      setInput('');
      setJustEvaled(false);
      return;
    }
    if (value === '⌫') {
      setInput(p => p.slice(0, -1));
      setJustEvaled(false);
      return;
    }
    if (value === '=') {
      const result = safeEvaluate(input);
      if (result === '') return;
      setInput(result === 'Error' ? 'Error' : result);
      setJustEvaled(true);
      return;
    }

    const isOperator = ['+', '−', '×', '÷'].includes(value);

    if (justEvaled) {
      // After eval: operator continues from result, digit starts fresh
      if (isOperator && input !== 'Error') {
        setInput(p => p + value);
      } else {
        setInput(value);
      }
      setJustEvaled(false);
      return;
    }

    setInput(p => p + value);
  }

  // Show expression above result when live result differs from input
  const showExpression = Boolean(liveResult) && liveResult !== input && !justEvaled;
  const displayValue = justEvaled ? input : (showExpression ? liveResult : input);

  return (
    <div
      ref={panelRef}
      className={`fixed z-50 w-[280px] bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden flex flex-col ${positionClass}`}
      role="dialog"
      aria-label="Calculator"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
        <span className="text-sm font-medium text-gray-900">Calculator</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Display */}
      <div className="px-4 pt-3 pb-2 flex flex-col items-end min-h-[60px] justify-end">
        {showExpression && (
          <div className="text-[11px] text-gray-400 font-mono truncate max-w-full">{input}</div>
        )}
        <div
          className={`font-mono leading-snug truncate max-w-full ${
            input === 'Error'
              ? 'text-red-500 text-xl'
              : 'text-xl text-gray-900'
          }`}
        >
          {displayValue || '0'}
        </div>
      </div>

      {/* Buttons — 4 × 5 grid */}
      <div className="px-3 pb-3 grid grid-cols-4 gap-1.5">
        {BUTTONS.map(btn => (
          <button
            key={btn.label}
            onClick={() => handlePress(btn.value)}
            className={`rounded-lg py-3 text-sm transition-colors flex items-center justify-center ${buttonStyles[btn.style]}`}
          >
            {btn.label === '⌫' ? <Delete size={14} /> : btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
