// Groups view — one row per training group, with the group's own plan state
// surfaced. Expanding a group shows its roster with per-member status.

import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Star, UsersRound } from 'lucide-react';
import type { AthleteStatus, GroupStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import {
  Avatar, WeekPill, RawChip, EventTag, FlagDot, ComplianceSpark, lastTrainLabel,
} from './atoms';

interface Props {
  groupStatuses: GroupStatus[];
  statuses: AthleteStatus[];
  getEnrichment: (athleteId: string) => AthleteEnrichment;
  expandedId: string | null;
  onSetExpanded: (id: string | null) => void;
  pinned: string[];
  onTogglePin: (groupId: string) => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
  onOpenGroupPlanner: (groupStatus: GroupStatus) => void;
}

export function GroupBoard({
  groupStatuses, statuses, getEnrichment, expandedId, onSetExpanded,
  pinned, onTogglePin, onJumpToAthlete, onOpenGroupPlanner,
}: Props) {
  const statusByAthleteId = useMemo(() => {
    const m: Record<string, AthleteStatus> = {};
    statuses.forEach(s => { m[s.athlete.id] = s; });
    return m;
  }, [statuses]);

  const ordered = useMemo(() => {
    if (!pinned.length) return groupStatuses;
    const idx = (id: string) => {
      const i = pinned.indexOf(id);
      return i === -1 ? 999 : i;
    };
    return [...groupStatuses].sort((a, b) => idx(a.group.id) - idx(b.group.id));
  }, [groupStatuses, pinned]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-8 py-2.5 px-2"></th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Training group</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Members</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">This wk</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Next wk</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Earliest event</th>
              <th className="w-6 py-2.5 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                  No training groups defined yet.
                </td>
              </tr>
            )}
            {ordered.map(gs => {
              const isExpanded = expandedId === gs.group.id;
              const memberStatuses = gs.members
                .map(m => statusByAthleteId[m.id])
                .filter((s): s is AthleteStatus => !!s);
              return (
                <GroupRow
                  key={gs.group.id}
                  groupStatus={gs}
                  memberStatuses={memberStatuses}
                  getEnrichment={getEnrichment}
                  expanded={isExpanded}
                  pinned={pinned.includes(gs.group.id)}
                  onTogglePin={() => onTogglePin(gs.group.id)}
                  onSetExpanded={() => onSetExpanded(isExpanded ? null : gs.group.id)}
                  onJumpToAthlete={onJumpToAthlete}
                  onOpenGroupPlanner={onOpenGroupPlanner}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  groupStatus: GroupStatus;
  memberStatuses: AthleteStatus[];
  getEnrichment: (athleteId: string) => AthleteEnrichment;
  expanded: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onSetExpanded: () => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
  onOpenGroupPlanner: (gs: GroupStatus) => void;
}

function GroupRow({
  groupStatus, memberStatuses, getEnrichment, expanded, pinned,
  onTogglePin, onSetExpanded, onJumpToAthlete, onOpenGroupPlanner,
}: RowProps) {
  const earliestEvent = useMemo(() => {
    const all = memberStatuses.flatMap(s => getEnrichment(s.athlete.id).athleteEvents);
    if (!all.length) return null;
    return all.slice().sort((a, b) => a.daysUntil - b.daysUntil)[0];
  }, [memberStatuses, getEnrichment]);

  const flaggedCount = memberStatuses.filter(
    s => getEnrichment(s.athlete.id).flags.length > 0,
  ).length;

  const tintBg = !groupStatus.currentWeekPlanned ? 'bg-red-50/30'
    : !groupStatus.nextWeekPlanned ? 'bg-amber-50/30' : '';
  const borderL = !groupStatus.currentWeekPlanned ? 'border-l-2 border-l-red-300'
    : !groupStatus.nextWeekPlanned ? 'border-l-2 border-l-amber-300'
    : 'border-l-2 border-l-transparent';
  const expandedBg = expanded ? 'bg-gray-50' : '';

  return (
    <>
      <tr
        id={`v2-group-${groupStatus.group.id}`}
        onClick={onSetExpanded}
        className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${expandedBg || tintBg} ${borderL}`}
      >
        <td className="w-8 py-3 px-2">
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
            title={pinned ? 'Unpin' : 'Pin to top'}
            className={`p-0 bg-transparent border-none cursor-pointer ${pinned ? 'text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}
          >
            <Star size={13} className={pinned ? 'fill-current' : ''} />
          </button>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 inline-flex items-center justify-center flex-shrink-0">
              <UsersRound size={14} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-gray-900 truncate">{groupStatus.group.name}</span>
              <span className="text-[11px] text-gray-400 truncate">
                {groupStatus.group.description || 'Training group'}
              </span>
            </div>
            {flaggedCount > 0 && <FlagDot flags={['next-week-gap']} />}
          </div>
        </td>
        <td className="py-3 px-4 text-sm text-gray-900 tabular-nums">
          {groupStatus.memberCount}
        </td>
        <td className="py-3 px-4">
          <WeekPill state={groupStatus.currentWeekPlanned ? 'planned' : 'missing'} compact />
        </td>
        <td className="py-3 px-4">
          <WeekPill state={groupStatus.nextWeekPlanned ? 'planned' : 'missing'} compact />
        </td>
        <td className="py-3 px-4">
          {earliestEvent ? (
            <EventTag
              name={earliestEvent.note}
              kind={earliestEvent.eventData.event_type === 'competition' ? 'comp' : 'camp'}
              daysOut={earliestEvent.daysUntil}
              compact
            />
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>
        <td className="w-6 py-3 px-2 text-right">
          {expanded
            ? <ChevronDown size={14} className="text-gray-400 inline" />
            : <ChevronRight size={14} className="text-gray-400 inline" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={7} className="p-0">
            <GroupExpansion
              groupStatus={groupStatus}
              memberStatuses={memberStatuses}
              getEnrichment={getEnrichment}
              flaggedCount={flaggedCount}
              onJumpToAthlete={onJumpToAthlete}
              onOpenGroupPlanner={onOpenGroupPlanner}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function GroupExpansion({
  groupStatus, memberStatuses, getEnrichment, flaggedCount,
  onJumpToAthlete, onOpenGroupPlanner,
}: {
  groupStatus: GroupStatus;
  memberStatuses: AthleteStatus[];
  getEnrichment: (athleteId: string) => AthleteEnrichment;
  flaggedCount: number;
  onJumpToAthlete: (status: AthleteStatus) => void;
  onOpenGroupPlanner: (gs: GroupStatus) => void;
}) {
  const athletesPlanned = memberStatuses.filter(s => s.currentWeekPlanned).length;
  const athletesNextPlanned = memberStatuses.filter(s => s.nextWeekPlanned).length;

  return (
    <div className="px-5 py-4 flex flex-col gap-3">
      <div className="flex gap-4 items-center flex-wrap text-xs text-gray-500">
        <span>
          Individual plans:{' '}
          <span className="text-gray-900 font-medium tabular-nums">
            {athletesPlanned}/{memberStatuses.length}
          </span>{' '}
          this ·{' '}
          <span className="text-gray-900 font-medium tabular-nums">
            {athletesNextPlanned}/{memberStatuses.length}
          </span>{' '}
          next
        </span>
        <span>
          Flagged athletes:{' '}
          <span className={`font-medium tabular-nums ${flaggedCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {flaggedCount}
          </span>
        </span>
        <span className="flex-1" />
        <button
          onClick={() => onOpenGroupPlanner(groupStatus)}
          className="px-3 py-1 text-xs rounded-md border border-blue-200 bg-white text-blue-600 hover:bg-blue-50"
        >
          Open group plan →
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="w-8 py-2 px-2"></th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Athlete</th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Last</th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">RAW</th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Compliance</th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">This wk</th>
              <th className="text-left py-2 px-3 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Next event</th>
            </tr>
          </thead>
          <tbody>
            {memberStatuses.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-400 italic">
                  No active members.
                </td>
              </tr>
            )}
            {memberStatuses.map(s => {
              const enr = getEnrichment(s.athlete.id);
              const lastDays = s.lastTrainingDate
                ? Math.floor((Date.now() - s.lastTrainingDate.getTime()) / 86_400_000)
                : null;
              const nextEvent = enr.athleteEvents[0];
              return (
                <tr
                  key={s.athlete.id}
                  onClick={() => onJumpToAthlete(s)}
                  className="border-b border-gray-50 last:border-b-0 hover:bg-blue-50/40 cursor-pointer"
                >
                  <td className="w-8 py-2 px-2">
                    <Avatar name={s.athlete.name} size={22} />
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 truncate">{s.athlete.name}</span>
                      <FlagDot flags={enr.flags} />
                    </div>
                  </td>
                  <td className={`py-2 px-3 text-xs tabular-nums ${lastDays !== null && lastDays > 4 ? 'text-red-600' : 'text-gray-600'}`}>
                    {lastTrainLabel(lastDays)}
                  </td>
                  <td className="py-2 px-3">
                    <RawChip pillars={enr.rawPillars} avg={s.rawAverage} size="sm" />
                  </td>
                  <td className="py-2 px-3">
                    <ComplianceSpark values={enr.compTrend} width={50} height={16} />
                  </td>
                  <td className="py-2 px-3">
                    <WeekPill state={s.currentWeekPlanned ? 'planned' : 'missing'} compact />
                  </td>
                  <td className="py-2 px-3">
                    {nextEvent ? (
                      <EventTag
                        name={nextEvent.note}
                        kind={nextEvent.eventData.event_type === 'competition' ? 'comp' : 'camp'}
                        daysOut={nextEvent.daysUntil}
                        compact
                      />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
