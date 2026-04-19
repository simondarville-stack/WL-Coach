import type { MacroCycle, MacroWeek, MacroPhase, MacroCompetition, TrainingGroup } from '../../lib/database.types';
import type { GroupMemberWithAthlete } from '../../lib/database.types';
import { MacroCompetitionBadge } from './MacroCompetitionBadge';
import { Users } from 'lucide-react';

interface MacroPhaseTimelineProps {
  selectedCycle: MacroCycle;
  macroWeeks: MacroWeek[];
  phases: MacroPhase[];
  competitions: MacroCompetition[];
  isGroupMode: boolean;
  selectedGroup: TrainingGroup | null;
  groupMembers: GroupMemberWithAthlete[];
  onEditPhase: (phase: MacroPhase) => void;
}

function isoWeek(dateStr: string): number {
  const d = new Date(dateStr);
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt.getTime() - y0.getTime()) / 86400000) + 1) / 7);
}

function fmtMD(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function addDaysToMD(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function MacroPhaseTimeline({
  selectedCycle,
  macroWeeks,
  phases,
  competitions,
  isGroupMode,
  selectedGroup,
  groupMembers,
  onEditPhase,
}: MacroPhaseTimelineProps) {
  const total = macroWeeks.length;
  const colPct = 100 / total;

  // Month groups
  type MonthGroup = { label: string; spanWeeks: number };
  const monthGroups: MonthGroup[] = [];
  macroWeeks.forEach(w => {
    const d = new Date(w.week_start);
    const label = d.toLocaleString('default', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2);
    if (!monthGroups.length || monthGroups[monthGroups.length - 1].label !== label) {
      monthGroups.push({ label, spanWeeks: 1 });
    } else {
      monthGroups[monthGroups.length - 1].spanWeeks++;
    }
  });

  // Phase segments
  const sorted = [...phases].sort((a, b) => a.start_week_number - b.start_week_number);
  type Seg = { type: 'phase'; phase: MacroPhase; startIdx: number; endIdx: number }
           | { type: 'gap'; startIdx: number; endIdx: number };
  const segs: Seg[] = [];
  let cur = 1;
  for (const p of sorted) {
    if (p.start_week_number > cur) segs.push({ type: 'gap', startIdx: cur - 1, endIdx: p.start_week_number - 2 });
    segs.push({ type: 'phase', phase: p, startIdx: p.start_week_number - 1, endIdx: p.end_week_number - 1 });
    cur = p.end_week_number + 1;
  }
  if (cur <= total) segs.push({ type: 'gap', startIdx: cur - 1, endIdx: total - 1 });

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
      {/* Meta row */}
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-gray-600 flex-wrap">
        <span className="font-medium text-gray-800">{selectedCycle.name}</span>
        <span className="text-gray-400">{selectedCycle.start_date} → {selectedCycle.end_date}</span>
        <span className="text-gray-400">{macroWeeks.length} weeks</span>
        {isGroupMode && selectedGroup && (
          <span className="flex items-center gap-1 text-purple-600 font-medium">
            <Users size={11} />
            {selectedGroup.name}
            {groupMembers.length > 0 && (
              <span className="text-gray-400 font-normal ml-1">
                ({groupMembers.length} members: {groupMembers.map(m => m.athlete.name).join(', ')})
              </span>
            )}
          </span>
        )}
        {competitions.map(comp => (
          <MacroCompetitionBadge key={comp.id} competition={comp} />
        ))}
      </div>

      {/* Phase timeline */}
      {macroWeeks.length > 0 && (
        <div className="w-full border-t border-gray-200 overflow-hidden select-none">
          {/* Month row */}
          <div className="flex w-full bg-white border-b border-gray-200" style={{ height: 18 }}>
            {monthGroups.map((mg, i) => (
              <div
                key={i}
                className="flex items-center border-r border-gray-300 px-1 overflow-hidden flex-shrink-0"
                style={{ width: `${mg.spanWeeks * colPct}%` }}
              >
                <span className="text-[11px] font-medium text-gray-500 truncate">{mg.label}</span>
              </div>
            ))}
          </div>

          {/* Phase band + week dividers */}
          <div className="relative w-full flex" style={{ height: 22 }}>
            {segs.map((seg, i) => {
              const weekCount = seg.endIdx - seg.startIdx + 1;
              const w = `${weekCount * colPct}%`;
              if (seg.type === 'phase') {
                return (
                  <button
                    key={seg.phase.id}
                    onClick={() => onEditPhase(seg.phase)}
                    className="relative flex items-center justify-center text-[11px] font-medium hover:brightness-95 transition-all overflow-hidden flex-shrink-0"
                    style={{ width: w, backgroundColor: seg.phase.color }}
                    title={`${seg.phase.name} · Wk ${seg.phase.start_week_number}–${seg.phase.end_week_number}`}
                  >
                    <span className="truncate px-1 text-white/90">{seg.phase.name}</span>
                  </button>
                );
              }
              return <div key={`gap-${i}`} className="bg-gray-200 flex-shrink-0" style={{ width: w }} />;
            })}
            {/* Week divider lines overlay */}
            <div className="absolute inset-0 flex pointer-events-none">
              {macroWeeks.map(w => (
                <div key={w.id} className="border-r border-white/25 h-full flex-shrink-0" style={{ width: `${colPct}%` }} />
              ))}
            </div>
          </div>

          {/* Week label row */}
          <div className="flex w-full bg-white border-t border-gray-200">
            {macroWeeks.map(w => (
              <div
                key={w.id}
                className="flex flex-col items-center justify-center border-r border-gray-100 py-0.5 overflow-hidden flex-shrink-0"
                style={{ width: `${colPct}%` }}
              >
                <span className="text-[11px] font-medium text-gray-700 leading-none">{w.week_number}</span>
                <span className="text-[7px] text-gray-400 leading-none mt-px">W{isoWeek(w.week_start)}</span>
                <span className="text-[7px] text-gray-300 leading-none mt-px">{fmtMD(w.week_start)}–{addDaysToMD(w.week_start, 6)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
