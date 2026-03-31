import { ChevronLeft, ChevronRight, Settings, Printer, BarChart3, Copy, Clipboard } from 'lucide-react';

interface WeeklyPlannerHeaderProps {
  selectedDate: string;
  dateRangeLabel: string;
  hasAthlete: boolean;
  hasWeekPlan: boolean;
  isCurrentWeekCopied: boolean;
  hasCopiedWeek: boolean;
  showLoadDistribution: boolean;
  onDateChange: (rawDate: string) => void;
  onToggleLoadDistribution: () => void;
  onCopyWeek: () => void;
  onPasteWeek: () => void;
  onPrint: () => void;
  onOpenSettings: () => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
}

export function WeeklyPlannerHeader({
  selectedDate,
  dateRangeLabel,
  hasAthlete,
  hasWeekPlan,
  isCurrentWeekCopied,
  hasCopiedWeek,
  showLoadDistribution,
  onDateChange,
  onToggleLoadDistribution,
  onCopyWeek,
  onPasteWeek,
  onPrint,
  onOpenSettings,
  onPreviousWeek,
  onNextWeek,
}: WeeklyPlannerHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <label htmlFor="weekDate" className="text-sm font-medium text-gray-700">
          Week of:
        </label>
        <input
          type="date"
          id="weekDate"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-gray-600">{dateRangeLabel}</span>
      </div>

      <div className="flex gap-2">
        {hasAthlete && (
          <button
            onClick={onToggleLoadDistribution}
            className={`px-4 py-2 border rounded-md transition-colors flex items-center gap-2 ${
              showLoadDistribution
                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
            title="Toggle Load Distribution"
          >
            <BarChart3 size={18} />
            {showLoadDistribution ? 'Hide' : 'Show'} Load Distribution
          </button>
        )}
        <button
          onClick={onCopyWeek}
          disabled={!hasWeekPlan}
          className={`px-4 py-2 border rounded-md transition-colors flex items-center gap-2 ${
            isCurrentWeekCopied
              ? 'bg-blue-600 text-white border-blue-600'
              : 'border-gray-300 hover:bg-gray-50'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Copy current week to clipboard"
        >
          <Copy size={18} />
          Copy
        </button>
        <button
          onClick={onPasteWeek}
          disabled={!hasCopiedWeek}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title={hasCopiedWeek ? 'Paste copied week here' : 'No week copied'}
        >
          <Clipboard size={18} />
          Paste
        </button>
        <button
          onClick={onPrint}
          className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
          title="Print Week"
        >
          <Printer size={18} />
          Print
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          title="Settings"
        >
          <Settings size={20} />
        </button>
        <button
          onClick={onPreviousWeek}
          className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={onNextWeek}
          className="p-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
