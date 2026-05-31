/**
 * Segmented control to flip between the weighted multi-anchor estimator
 * (default) and the 1RM-only analyser. Reads/writes the localStorage-backed
 * preference via usePREstimationMode and is safe to drop in any PR view.
 *
 * Layout matches the small filter-pill controls already used elsewhere on
 * the coach UI (Athletes search row, PR table header).
 */
import type { PREstimationMode } from '../lib/prTable';

interface Props {
  mode: PREstimationMode;
  onChange: (mode: PREstimationMode) => void;
  /** When true, the 1RM-only option is shown but disabled with a hint —
   *  used in single-exercise views where the loaded exercise has no real
   *  1RM and the mode would have nothing to project from. */
  oneRMUnavailable?: boolean;
  /** Optional dark-theme styling for the athlete app. */
  theme?: 'light' | 'dark';
}

export function PREstimationModeToggle({ mode, onChange, oneRMUnavailable, theme = 'light' }: Props) {
  const isDark = theme === 'dark';
  const baseBtn =
    'px-2.5 py-1 text-[11px] font-medium rounded transition-colors border';
  const selectedCls = isDark
    ? 'bg-blue-600 text-white border-blue-500'
    : 'bg-blue-100 text-blue-800 border-blue-200';
  const idleCls = isDark
    ? 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50';
  const labelCls = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`text-[10px] uppercase tracking-wide ${labelCls}`}>Estimate</span>
      <div className="inline-flex gap-1">
        <button
          onClick={() => onChange('weighted')}
          className={`${baseBtn} ${mode === 'weighted' ? selectedCls : idleCls}`}
          title="Estimate using every real entry, weighted by rep distance (close anchors dominate)."
        >
          Weighted
        </button>
        <button
          onClick={() => !oneRMUnavailable && onChange('one_rm_only')}
          disabled={oneRMUnavailable}
          className={`${baseBtn} ${
            mode === 'one_rm_only' ? selectedCls : idleCls
          } ${oneRMUnavailable ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={
            oneRMUnavailable
              ? 'Enter a 1RM on this exercise to use 1RM-only analysis.'
              : 'Project every cell from the real 1RM; show delta vs prediction on real entries.'
          }
        >
          1RM-only
        </button>
      </div>
    </div>
  );
}
