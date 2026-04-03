import { ChevronLeft, ChevronRight, Settings, Printer, BarChart3, Copy, Clipboard } from 'lucide-react';

interface WeeklyPlannerHeaderProps {
  selectedDate: string;
  dateRangeLabel: string;
  hasAthlete: boolean;
  hasWeekPlan: boolean;
  isCurrentWeekCopied: boolean;
  hasCopiedWeek: boolean;
  showLoadDistribution: boolean;
  macroWeekNumber?: string | null;
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
  dateRangeLabel,
  hasAthlete,
  hasWeekPlan,
  isCurrentWeekCopied,
  hasCopiedWeek,
  showLoadDistribution,
  macroWeekNumber,
  onToggleLoadDistribution,
  onCopyWeek,
  onPasteWeek,
  onPrint,
  onOpenSettings,
  onPreviousWeek,
  onNextWeek,
}: WeeklyPlannerHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      {/* Left: prev week */}
      <button
        onClick={onPreviousWeek}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1 px-2 rounded hover:bg-gray-50"
      >
        <ChevronLeft size={14} />
        <span className="hidden sm:inline">Last week</span>
      </button>

      {/* Center: current week */}
      <div className="text-center">
        <div className="text-base font-medium text-gray-900">{dateRangeLabel}</div>
        {macroWeekNumber && (
          <div className="text-xs text-gray-400 mt-0.5">{macroWeekNumber}</div>
        )}
      </div>

      {/* Right: next week + toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={onNextWeek}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1 px-2 rounded hover:bg-gray-50"
        >
          <span className="hidden sm:inline">Next week</span>
          <ChevronRight size={14} />
        </button>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        {/* Compact icon toolbar */}
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Training days"
          >
            <Settings size={15} />
          </button>
          <button
            onClick={onCopyWeek}
            disabled={!hasWeekPlan}
            className={`p-1.5 rounded transition-colors ${
              isCurrentWeekCopied
                ? 'text-blue-600 bg-blue-50'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title="Copy week"
          >
            <Copy size={15} />
          </button>
          <button
            onClick={onPasteWeek}
            disabled={!hasCopiedWeek}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={hasCopiedWeek ? 'Paste week' : 'No week copied'}
          >
            <Clipboard size={15} />
          </button>
          <button
            onClick={onPrint}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Print"
          >
            <Printer size={15} />
          </button>
          {hasAthlete && (
            <button
              onClick={onToggleLoadDistribution}
              className={`p-1.5 rounded transition-colors ${
                showLoadDistribution
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title="Load distribution"
            >
              <BarChart3 size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
