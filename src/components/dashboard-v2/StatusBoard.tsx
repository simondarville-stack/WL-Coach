// Status Board — the main athlete roster for the v2 dashboard.
//
// Styled to match the rest of EMOS: <table>, rounded-lg panel, soft
// gray-100 row borders, hover:bg-gray-50, sentence-case headers. The
// per-row severity tint (red for "no plan this week", amber for warnings)
// is preserved because it's the panel's primary signal.

import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Star } from 'lucide-react';
import type { AthleteStatus, GroupStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import type { TrainingGroup } from '../../lib/database.types';
import {
  Avatar, PhasePill, WeekPill, RawChip, ComplianceSpark, BwDelta, EventTag,
  FlagDot, rowAlertTone, lastTrainLabel,
} from './atoms';
import { AthleteExpansion } from './AthleteExpansion';

export type GroupBy = 'none' | 'group';

interface Props {
  statuses: AthleteStatus[];
  getEnrichment: (athleteId: string) => AthleteEnrichment;
  getAthleteGroups: (athleteId: string) => TrainingGroup[];
  groupStatuses: GroupStatus[];
  pinned: string[];
  onTogglePin: (id: string) => void;
  groupBy: GroupBy;
  expandedId: string | null;
  onSetExpanded: (id: string | null) => void;
  pulseId: string | null;
  onOpenPlanner: (status: AthleteStatus) => void;
}

interface Section {
  key: string;
  label: string | null;
  groupStatus: GroupStatus | null;
  statuses: AthleteStatus[];
}

const UNGROUPED_KEY = '__ungrouped__';

function bucketByGroup(
  statuses: AthleteStatus[],
  groupBy: GroupBy,
  getAthleteGroups: (athleteId: string) => TrainingGroup[],
  groupStatuses: GroupStatus[],
): Section[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, groupStatus: null, statuses }];
  }
  const byGroup: Record<string, AthleteStatus[]> = {};
  const ungrouped: AthleteStatus[] = [];
  statuses.forEach(s => {
    const groups = getAthleteGroups(s.athlete.id);
    if (!groups.length) { ungrouped.push(s); return; }
    groups.forEach(g => { (byGroup[g.id] ||= []).push(s); });
  });
  const sections: Section[] = [];
  groupStatuses.forEach(gs => {
    const list = byGroup[gs.group.id];
    if (!list || !list.length) return;
    sections.push({
      key: gs.group.id, label: gs.group.name, groupStatus: gs, statuses: list,
    });
  });
  Object.entries(byGroup).forEach(([gid, list]) => {
    if (sections.find(s => s.key === gid)) return;
    sections.push({ key: gid, label: gid, groupStatus: null, statuses: list });
  });
  if (ungrouped.length) {
    sections.push({
      key: UNGROUPED_KEY, label: 'Ungrouped', groupStatus: null, statuses: ungrouped,
    });
  }
  return sections;
}

export function StatusBoard({
  statuses, getEnrichment, getAthleteGroups, groupStatuses,
  pinned, onTogglePin, groupBy,
  expandedId, onSetExpanded, pulseId, onOpenPlanner,
}: Props) {
  const sections = useMemo(
    () => bucketByGroup(statuses, groupBy, getAthleteGroups, groupStatuses),
    [statuses, groupBy, getAthleteGroups, groupStatuses],
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="w-8 py-2.5 px-2"></th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Athlete</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Phase / week</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Last</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">RAW</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Compliance</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Bodyweight</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">This wk</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Next wk</th>
              <th className="text-left py-2.5 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Next event</th>
              <th className="w-6 py-2.5 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              <SectionContent
                key={section.key}
                section={section}
                expandedId={expandedId}
                pulseId={pulseId}
                pinned={pinned}
                getEnrichment={getEnrichment}
                onTogglePin={onTogglePin}
                onSetExpanded={onSetExpanded}
                onOpenPlanner={onOpenPlanner}
              />
            ))}
            {statuses.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400 text-sm">
                  No active athletes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionContent({
  section, expandedId, pulseId, pinned, getEnrichment,
  onTogglePin, onSetExpanded, onOpenPlanner,
}: {
  section: Section;
  expandedId: string | null;
  pulseId: string | null;
  pinned: string[];
  getEnrichment: (id: string) => AthleteEnrichment;
  onTogglePin: (id: string) => void;
  onSetExpanded: (id: string | null) => void;
  onOpenPlanner: (status: AthleteStatus) => void;
}) {
  return (
    <>
      {section.label && (
        <SectionHeaderRow
          label={section.label}
          statuses={section.statuses}
          groupStatus={section.groupStatus}
        />
      )}
      {section.statuses.map(s => (
        <AthleteRowV2
          key={`${section.key}-${s.athlete.id}`}
          status={s}
          enrichment={getEnrichment(s.athlete.id)}
          expanded={expandedId === s.athlete.id}
          pulse={pulseId === s.athlete.id}
          pinned={pinned.includes(s.athlete.id)}
          onTogglePin={() => onTogglePin(s.athlete.id)}
          onSetExpanded={() => onSetExpanded(expandedId === s.athlete.id ? null : s.athlete.id)}
          onOpenPlanner={onOpenPlanner}
        />
      ))}
    </>
  );
}

function SectionHeaderRow({
  label, statuses, groupStatus,
}: { label: string; statuses: AthleteStatus[]; groupStatus: GroupStatus | null }) {
  const planned = statuses.filter(s => s.currentWeekPlanned).length;
  const nextPlanned = statuses.filter(s => s.nextWeekPlanned).length;
  return (
    <tr className="bg-gray-50/60 border-b border-gray-100">
      <td colSpan={11} className="py-2 px-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span className="text-xs text-gray-400 tabular-nums">
            {statuses.length} {statuses.length === 1 ? 'athlete' : 'athletes'}
          </span>
          {groupStatus && (
            <span
              title="The group's own weekly plan, separate from each athlete's plan."
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5"
            >
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Group plan</span>
              <WeekPill
                state={groupStatus.currentWeekPlanned ? 'planned' : 'missing'}
                compact
                label={groupStatus.currentWeekPlanned ? 'this ✓' : 'this ✕'}
              />
              <WeekPill
                state={groupStatus.nextWeekPlanned ? 'planned' : 'missing'}
                compact
                label={groupStatus.nextWeekPlanned ? 'next ✓' : 'next ✕'}
              />
            </span>
          )}
          <span className="flex-1" />
          <span className="text-xs text-gray-400 tabular-nums">
            Individual plans: {planned}/{statuses.length} this · {nextPlanned}/{statuses.length} next
          </span>
        </div>
      </td>
    </tr>
  );
}

interface RowProps {
  status: AthleteStatus;
  enrichment: AthleteEnrichment;
  expanded: boolean;
  pulse: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onSetExpanded: () => void;
  onOpenPlanner: (status: AthleteStatus) => void;
}

function AthleteRowV2({
  status, enrichment, expanded, pulse, pinned,
  onTogglePin, onSetExpanded, onOpenPlanner,
}: RowProps) {
  const a = status.athlete;
  const tone = rowAlertTone(enrichment.flags);
  const tintBg = tone === 'danger' ? 'bg-red-50/30'
    : tone === 'warn'   ? 'bg-amber-50/30'
    : '';
  const borderL = tone === 'danger' ? 'border-l-2 border-l-red-300'
    : tone === 'warn'   ? 'border-l-2 border-l-amber-300'
    : 'border-l-2 border-l-transparent';
  const pulseBg = pulse ? 'bg-blue-50' : '';
  const expandedBg = expanded && !pulse ? 'bg-gray-50' : '';

  const lastDays = status.lastTrainingDate
    ? Math.floor((Date.now() - status.lastTrainingDate.getTime()) / 86_400_000)
    : null;
  const nextEvent = enrichment.athleteEvents[0];

  return (
    <>
      <tr
        id={`v2-row-${a.id}`}
        onClick={onSetExpanded}
        className={`border-b border-gray-100 cursor-pointer transition-colors duration-200 hover:bg-gray-50 ${pulseBg || expandedBg || tintBg} ${borderL}`}
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
            <Avatar name={a.name} />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-gray-900 leading-tight truncate">
                {a.name}
              </span>
              <span className="text-[11px] text-gray-400 truncate">
                {a.weight_class || '—'}
                {a.club ? ` · ${a.club}` : ''}
              </span>
            </div>
            <FlagDot flags={enrichment.flags} />
          </div>
        </td>
        <td className="py-3 px-4">
          <PhasePill
            name={enrichment.phaseName}
            color={enrichment.phaseColor}
            week={status.currentMacroWeek?.week_number ?? null}
            total={status.totalMacroWeeks}
          />
        </td>
        <td className={`py-3 px-4 text-sm tabular-nums ${lastDays !== null && lastDays > 4 ? 'text-red-600' : 'text-gray-600'}`}>
          {lastTrainLabel(lastDays)}
        </td>
        <td className="py-3 px-4">
          <RawChip pillars={enrichment.rawPillars} avg={status.rawAverage} size="sm" />
        </td>
        <td className="py-3 px-4">
          <ComplianceSpark values={enrichment.compTrend} />
        </td>
        <td className="py-3 px-4">
          <BwDelta bw={enrichment.bw} />
        </td>
        <td className="py-3 px-4">
          <WeekPill state={status.currentWeekPlanned ? 'planned' : 'missing'} compact />
        </td>
        <td className="py-3 px-4">
          <WeekPill state={status.nextWeekPlanned ? 'planned' : 'missing'} compact />
        </td>
        <td className="py-3 px-4">
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
        <td className="w-6 py-3 px-2 text-right">
          {expanded
            ? <ChevronDown size={14} className="text-gray-400 inline" />
            : <ChevronRight size={14} className="text-gray-400 inline" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={11} className="p-0">
            <AthleteExpansion
              status={status}
              enrichment={enrichment}
              onOpenPlanner={onOpenPlanner}
            />
          </td>
        </tr>
      )}
    </>
  );
}
