import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// ─── Formulas ────────────────────────────────────────────────────────────────

const FORMULAS: Record<string, (w: number, r: number) => number> = {
  'Epley':      (w, r) => w * (1 + r / 30),
  'Brzycki':    (w, r) => w * (36 / (37 - r)),
  'Adams':      (w, r) => w * (1 / (1 - 0.02 * r)),
  'Baechle':    (w, r) => w * (1 + 0.033 * r),
  'Berger':     (w, r) => w * (1 / (1.0261 * Math.exp(-0.0262 * r))),
  'Brown':      (w, r) => w * (0.9849 + 0.0328 * r),
  'Landers':    (w, r) => w * (1 / (1.013 - 0.0267123 * r)),
  'Lombardi':   (w, r) => w * Math.pow(r, 0.10),
  'Mayhew':     (w, r) => w * (1 / (0.522 + 0.419 * Math.exp(-0.055 * r))),
  "O'Conner":   (w, r) => w * (1 + 0.025 * r),
  'Wathen':     (w, r) => w * (1 / (0.4880 + 0.538 * Math.exp(-0.075 * r))),
};

const REVERSE_FORMULAS: Record<string, (m: number, r: number) => number> = {
  'Epley':      (m, r) => m / (1 + r / 30),
  'Brzycki':    (m, r) => m * (37 - r) / 36,
  'Adams':      (m, r) => m * (1 - 0.02 * r),
  'Baechle':    (m, r) => m / (1 + 0.033 * r),
  'Berger':     (m, r) => m * (1.0261 * Math.exp(-0.0262 * r)),
  'Brown':      (m, r) => m / (0.9849 + 0.0328 * r),
  'Landers':    (m, r) => m * (1.013 - 0.0267123 * r),
  'Lombardi':   (m, r) => m / Math.pow(r, 0.10),
  'Mayhew':     (m, r) => m * (0.522 + 0.419 * Math.exp(-0.055 * r)),
  "O'Conner":   (m, r) => m / (1 + 0.025 * r),
  'Wathen':     (m, r) => m * (0.4880 + 0.538 * Math.exp(-0.075 * r)),
};

function estimateAvg1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  const estimates = Object.values(FORMULAS).map(fn => fn(weight, reps));
  return estimates.reduce((a, b) => a + b, 0) / estimates.length;
}

function estimateWeightAtReps(oneRM: number, targetReps: number): number {
  if (targetReps === 1) return oneRM;
  const reverses = Object.values(REVERSE_FORMULAS).map(fn => fn(oneRM, targetReps));
  return reverses.reduce((a, b) => a + b, 0) / reverses.length;
}

// ─── Confidence ──────────────────────────────────────────────────────────────

type Confidence = 'exact' | 'high' | 'good' | 'moderate' | 'low';

function getConfidence(inputReps: number, targetReps: number): Confidence {
  if (targetReps === inputReps) return 'exact';
  const distance = Math.abs(targetReps - inputReps);
  if (distance <= 1) return 'high';
  if (distance <= 2) return 'good';
  if (distance <= 4) return 'moderate';
  return 'low';
}

const barConfig: Record<Confidence, { color: string; width: string }> = {
  exact:    { color: 'bg-blue-500',  width: 'w-full' },
  high:     { color: 'bg-teal-500',  width: 'w-[90%]' },
  good:     { color: 'bg-teal-400',  width: 'w-[70%]' },
  moderate: { color: 'bg-amber-400', width: 'w-[45%]' },
  low:      { color: 'bg-gray-300',  width: 'w-[20%]' },
};

const textConfig: Record<Confidence, string> = {
  exact:    'font-medium text-gray-900',
  high:     'font-medium text-gray-900',
  good:     'text-gray-700',
  moderate: 'text-gray-500',
  low:      'text-gray-400 italic',
};

const rowBgConfig: Record<Confidence, string> = {
  exact:    'bg-blue-50 border-l-[3px] border-blue-500',
  high:     '',
  good:     '',
  moderate: '',
  low:      '',
};

// ─── Component ───────────────────────────────────────────────────────────────

interface RepMaxCalculatorProps {
  onClose: () => void;
}

export function RepMaxCalculator({ onClose }: RepMaxCalculatorProps) {
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const weightRef = useRef<HTMLInputElement>(null);

  // Focus weight input on open
  useEffect(() => {
    weightRef.current?.focus();
  }, []);

  // Esc closes
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  const hasValidInput = !isNaN(w) && w > 0 && !isNaN(r) && r >= 1 && r <= 10;

  const oneRM = hasValidInput ? estimateAvg1RM(w, r) : null;

  const rows = hasValidInput && oneRM !== null
    ? Array.from({ length: 10 }, (_, i) => {
        const rep = i + 1;
        const isInput = rep === r;
        const estWeight = isInput ? w : Math.round(estimateWeightAtReps(oneRM, rep));
        const confidence = getConfidence(r, rep);
        return { rep, weight: estWeight, isInput, confidence };
      })
    : [];

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[380px] bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden flex flex-col"
      role="dialog"
      aria-label="xRM Calculator"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
        <span className="text-sm font-medium text-gray-900">xRM Calculator</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Inputs */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 flex-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">Weight</label>
            <input
              ref={weightRef}
              type="number"
              step="0.5"
              min="0"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="0"
              className="w-full font-mono text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
            />
            <span className="text-xs text-gray-400">kg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-500 whitespace-nowrap">Reps</label>
            <input
              type="number"
              step="1"
              min="1"
              max="10"
              value={reps}
              onChange={e => setReps(e.target.value)}
              placeholder="1"
              className="w-16 font-mono text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 text-right"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="px-4 pb-4">
        {!hasValidInput ? (
          <p className="text-xs text-gray-400 text-center py-4">
            Enter weight and reps to see estimates
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left font-medium text-gray-400 pb-1 w-10">RM</th>
                <th className="text-right font-medium text-gray-400 pb-1">Est. weight</th>
                <th className="pb-1 w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rep, weight: rowWeight, isInput, confidence }, idx) => {
                const bar = barConfig[confidence];
                const txt = textConfig[confidence];
                const rowBg = rowBgConfig[confidence];
                const altRow = idx % 2 === 1 && !isInput ? 'bg-gray-50/50' : '';
                return (
                  <tr
                    key={rep}
                    className={`${rowBg} ${altRow}`}
                  >
                    <td className={`py-[3px] pl-1 font-mono ${txt}`}>
                      {rep}RM
                    </td>
                    <td className={`py-[3px] text-right font-mono ${txt}`}>
                      {rowWeight} kg
                      {isInput && (
                        <span className="ml-1.5 text-[10px] text-blue-500 font-medium not-italic">
                          input
                        </span>
                      )}
                    </td>
                    <td className="py-[3px] pl-2 pr-1">
                      <div className="w-10 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${bar.color} ${bar.width}`} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
