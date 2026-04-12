import { Check, X, ChevronRight } from 'lucide-react';
import type { AthleteSnapshot } from '../../hooks/useCoachDashboardV2';
import type { Athlete } from '../../lib/database.types';

interface Props {
  athletes: AthleteSnapshot[];
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
}

export function PlanningMatrix({ athletes, onNavigateToPlanner }: Props) {
  const needsPlanning = athletes.filter(a => !a.currentWeekPlanned || !a.nextWeekPlanned);
  const allPlanned = athletes.filter(a => a.currentWeekPlanned && a.nextWeekPlanned);

  if (needsPlanning.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-3 py-2 border-b border-gray-100">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Planning status</h3>
        </div>
        <div className="py-6 text-center">
          <div className="inline-flex items-center gap-1.5 text-sm text-green-600 font-medium">
            <Check size={16} />
            All athletes planned for this and next week
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Planning status</h3>
        <span className="text-[10px] text-gray-400">
          {allPlanned.length}/{athletes.length} fully planned
        </span>
      </div>
      <div className="divide-y divide-gray-50">
        {needsPlanning.map(snap => (
          <div key={snap.athlete.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50/50 group">
            <span className="text-xs font-medium text-gray-800 flex-1 truncate">{snap.athlete.name}</span>

            <div className="flex items-center gap-2">
              <StatusChip label="CW" planned={snap.currentWeekPlanned} />
              <StatusChip label="NW" planned={snap.nextWeekPlanned} />
            </div>

            <button
              onClick={() => {
                const weekStart = !snap.currentWeekPlanned
                  ? new Date().toISOString().split('T')[0]
                  : new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
                onNavigateToPlanner(snap.athlete, weekStart);
              }}
              className="p-0.5 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Plan now"
            >
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ label, planned }: { label: string; planned: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded ${
      planned
        ? 'bg-green-50 text-green-700'
        : 'bg-red-50 text-red-600'
    }`}>
      {planned ? <Check size={9} /> : <X size={9} />}
      {label}
    </span>
  );
}
