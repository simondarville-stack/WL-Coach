import { useState } from 'react';
import { User, TrendingUp, TrendingDown, Minus, ChevronRight, AlertTriangle, Scale, Dumbbell } from 'lucide-react';
import type { AthleteSnapshot } from '../../hooks/useCoachDashboardV2';
import type { Athlete } from '../../lib/database.types';
import { getRawColor } from '../../lib/calculations';
import { formatDateShort } from '../../lib/dateUtils';

interface Props {
  athletes: AthleteSnapshot[];
  rawEnabled: boolean;
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
}

export function AthleteGrid({ athletes, rawEnabled, onNavigateToPlanner }: Props) {
  const [sortKey, setSortKey] = useState<'name' | 'raw' | 'bw' | 'phase' | 'status'>('name');
  const [filterGroup, setFilterGroup] = useState<string | null>(null);

  const allGroups = [...new Set(athletes.flatMap(a => a.groupNames))].sort();

  const filtered = filterGroup
    ? athletes.filter(a => a.groupNames.includes(filterGroup))
    : athletes;

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case 'raw': return (b.rawAverage ?? -1) - (a.rawAverage ?? -1);
      case 'bw': return (b.latestBodyweight ?? 0) - (a.latestBodyweight ?? 0);
      case 'phase': return (a.phaseName ?? 'zzz').localeCompare(b.phaseName ?? 'zzz');
      case 'status': {
        const aScore = (a.currentWeekPlanned ? 0 : 2) + (a.nextWeekPlanned ? 0 : 1);
        const bScore = (b.currentWeekPlanned ? 0 : 2) + (b.nextWeekPlanned ? 0 : 1);
        return bScore - aScore;
      }
      default: return a.athlete.name.localeCompare(b.athlete.name);
    }
  });

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-medium text-gray-700 uppercase tracking-wide">Athletes</h3>
        <div className="flex items-center gap-2">
          {allGroups.length > 0 && (
            <select
              value={filterGroup ?? ''}
              onChange={e => setFilterGroup(e.target.value || null)}
              className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600"
            >
              <option value="">All groups</option>
              {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as any)}
            className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600"
          >
            <option value="name">Sort: Name</option>
            {rawEnabled && <option value="raw">Sort: RAW</option>}
            <option value="bw">Sort: Bodyweight</option>
            <option value="phase">Sort: Phase</option>
            <option value="status">Sort: Needs action</option>
          </select>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {sorted.map(snap => (
          <AthleteRow
            key={snap.athlete.id}
            snap={snap}
            rawEnabled={rawEnabled}
            onNavigateToPlanner={onNavigateToPlanner}
          />
        ))}
        {sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400">No athletes found</div>
        )}
      </div>
    </div>
  );
}

function AthleteRow({ snap, rawEnabled, onNavigateToPlanner }: {
  snap: AthleteSnapshot;
  rawEnabled: boolean;
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
}) {
  const { athlete, macrocycle, macroWeek, phaseName, phaseColor, lastTrainingDate } = snap;
  const needsAttention = !snap.currentWeekPlanned ||
    !lastTrainingDate ||
    (Date.now() - lastTrainingDate.getTime()) > 7 * 86400000;

  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50/50 transition-colors group">
      <div className="flex-shrink-0">
        {athlete.photo_url ? (
          <img src={athlete.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <User size={14} className="text-gray-400" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900 truncate">{athlete.name}</span>
          {needsAttention && <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />}
          {athlete.weight_class && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">{athlete.weight_class}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {phaseName && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: phaseColor ? `${phaseColor}20` : '#f3f4f6',
                color: phaseColor || '#6b7280',
              }}
            >
              {phaseName}
              {macroWeek && <span className="ml-1 opacity-60">W{(macroWeek as any).week_number}</span>}
            </span>
          )}
          {!phaseName && macrocycle && (
            <span className="text-[10px] text-gray-400">{macrocycle.name}</span>
          )}
          {snap.groupNames.length > 0 && (
            <span className="text-[10px] text-gray-400">{snap.groupNames.join(', ')}</span>
          )}
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
        {rawEnabled && (
          <div className="text-center w-12">
            <div className={`text-xs font-medium ${getRawColor(snap.rawAverage)}`}>
              {snap.rawAverage !== null ? snap.rawAverage.toFixed(1) : '-'}
            </div>
            <div className="text-[9px] text-gray-400">RAW</div>
          </div>
        )}

        <div className="text-center w-14">
          <div className="flex items-center justify-center gap-0.5">
            <Scale size={10} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-700">
              {snap.latestBodyweight !== null ? `${snap.latestBodyweight}` : '-'}
            </span>
            {snap.bodyweightTrend === 'up' && <TrendingUp size={10} className="text-red-400" />}
            {snap.bodyweightTrend === 'down' && <TrendingDown size={10} className="text-green-500" />}
            {snap.bodyweightTrend === 'stable' && <Minus size={10} className="text-gray-300" />}
          </div>
          <div className="text-[9px] text-gray-400">kg</div>
        </div>

        {snap.targetReps !== null && (
          <div className="text-center w-16">
            <div className="text-xs font-medium text-gray-700">
              {snap.currentWeekReps}/{snap.targetReps}
            </div>
            <div className="text-[9px] text-gray-400">reps target</div>
          </div>
        )}

        <div className="text-center w-14">
          <div className="text-xs text-gray-500">
            {lastTrainingDate ? formatDateShort(lastTrainingDate.toISOString()) : 'Never'}
          </div>
          <div className="text-[9px] text-gray-400">last trained</div>
        </div>

        <div className="flex items-center gap-1 w-16">
          <PlanDot planned={snap.currentWeekPlanned} label="CW" />
          <PlanDot planned={snap.nextWeekPlanned} label="NW" />
        </div>
      </div>

      <button
        onClick={() => onNavigateToPlanner(athlete, snap.macroWeek ? new Date().toISOString().split('T')[0] : new Date().toISOString().split('T')[0])}
        className="p-1 rounded hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Open planner"
      >
        <ChevronRight size={14} className="text-gray-400" />
      </button>
    </div>
  );
}

function PlanDot({ planned, label }: { planned: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-2.5 h-2.5 rounded-full ${planned ? 'bg-green-400' : 'bg-gray-200'}`} />
      <span className="text-[8px] text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}
