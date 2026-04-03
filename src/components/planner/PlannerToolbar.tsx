import { Settings2, Copy, ClipboardPaste, Printer, BarChart2 } from 'lucide-react';

interface PlannerToolbarProps {
  canCopyPaste: boolean;
  copiedWeekStart: string | null;
  showLoadDistribution: boolean;
  onDayConfig: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPrint: () => void;
  onToggleLoadDistribution: () => void;
}

export function PlannerToolbar({
  canCopyPaste,
  copiedWeekStart,
  showLoadDistribution,
  onDayConfig,
  onCopy,
  onPaste,
  onPrint,
  onToggleLoadDistribution,
}: PlannerToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onDayConfig}
        title="Day configuration"
        className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500"
      >
        <Settings2 size={16} />
      </button>
      {canCopyPaste && (
        <>
          <button
            onClick={onCopy}
            title="Copy week"
            className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={onPaste}
            title={copiedWeekStart ? 'Paste week' : 'No week copied'}
            className={[
              'p-1.5 rounded transition-colors',
              copiedWeekStart ? 'hover:bg-gray-100 text-gray-500' : 'text-gray-300 cursor-not-allowed',
            ].join(' ')}
          >
            <ClipboardPaste size={16} />
          </button>
        </>
      )}
      <button
        onClick={onPrint}
        title="Print week"
        className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500"
      >
        <Printer size={16} />
      </button>
      <button
        onClick={onToggleLoadDistribution}
        title="Load distribution"
        className={[
          'p-1.5 rounded transition-colors',
          showLoadDistribution ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-500',
        ].join(' ')}
      >
        <BarChart2 size={16} />
      </button>
    </div>
  );
}
