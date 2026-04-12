// TODO: Consider extracting athlete-status loading into useAthleteStatuses hook
// TODO: Consider extracting group-status section into GroupStatusPanel component
import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Minus, Calendar, ChevronDown, ChevronRight, ArrowUp, ArrowDown, UsersRound } from 'lucide-react';
import { fetchWeeklyAggregates } from '../hooks/useAnalysis';
import type { Athlete, Event, BodyweightEntry, TrainingGroup } from '../lib/database.types';
import { formatDateToDDMMYYYY } from '../lib/dateUtils';
import { calculateAge, getRawColor, getRawBgColor, getRelativeTime, needsAttentionCheck } from '../lib/calculations';
import { EventOverviewModal } from './EventOverviewModal';
import { BodyweightPopup } from './BodyweightPopup';
import { supabase } from '../lib/supabase';
import {
  useCoachDashboard,
  type AthleteStatus,
  type ActivityEvent,
  type UpcomingEvent,
  type MacroAlignment,
  type GroupStatus,
} from '../hooks/useCoachDashboard';

type SortColumn = 'name' | 'macrocycle' | 'week' | 'lastTraining' | 'latestRaw' | 'rawAvg' | 'thisWeek' | 'nextWeek';
type SortDirection = 'asc' | 'desc';

interface CoachDashboardProps {
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
  onNavigateToGroupPlanner: (group: TrainingGroup, weekStart: string) => void;
}

export function CoachDashboard({ onNavigateToPlanner, onNavigateToGroupPlanner }: CoachDashboardProps) {
  const {
    athleteStatuses,
    activityFeed,
    macroAlignments,
    upcomingEvents,
    groupStatuses,
    settings,
    loading,
    loadDashboardData,
  } = useCoachDashboard();

  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showEventOverview, setShowEventOverview] = useState(false);
  const [bodyweightPopupAthlete, setBodyweightPopupAthlete] = useState<Athlete | null>(null);
  const [bwEntriesMap, setBwEntriesMap] = useState<Record<string, BodyweightEntry[]>>({});
  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [complianceTrends, setComplianceTrends] = useState<Record<string, number[]>>({});

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!athleteStatuses.length) return;
    const maDays = settings?.bodyweight_ma_days ?? 7;
    const trackedAthletes = athleteStatuses
      .filter(s => s.athlete.track_bodyweight)
      .map(s => s.athlete.id);
    if (!trackedAthletes.length) return;

    Promise.all(
      trackedAthletes.map(async (athleteId) => {
        const { data } = await supabase
          .from('bodyweight_entries')
          .select('*')
          .eq('athlete_id', athleteId)
          .order('date', { ascending: false })
          .limit(maDays * 2);
        return { athleteId, entries: (data || []).reverse() as BodyweightEntry[] };
      })
    ).then(results => {
      const map: Record<string, BodyweightEntry[]> = {};
      results.forEach(r => { map[r.athleteId] = r.entries; });
      setBwEntriesMap(map);
    });
  }, [athleteStatuses, settings]);

  // Fetch 4-week compliance trend per athlete
  const loadComplianceTrends = useCallback(async () => {
    if (!athleteStatuses.length) return;
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const trends: Record<string, number[]> = {};
    await Promise.all(
      athleteStatuses.map(async (s) => {
        const aggs = await fetchWeeklyAggregates({ athleteId: s.athlete.id, startDate, endDate });
        trends[s.athlete.id] = aggs.slice(-4).map(a => a.complianceReps);
      })
    );
    setComplianceTrends(trends);
  }, [athleteStatuses]);

  useEffect(() => { loadComplianceTrends(); }, [loadComplianceTrends]);

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  function getSortedStatuses(): AthleteStatus[] {
    const sorted = [...athleteStatuses];
    const dir = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return dir * a.athlete.name.localeCompare(b.athlete.name);
        case 'macrocycle':
          return dir * (a.currentMacrocycle?.name || '').localeCompare(b.currentMacrocycle?.name || '');
        case 'week':
          return dir * ((a.currentMacroWeek?.week_number || 0) - (b.currentMacroWeek?.week_number || 0));
        case 'lastTraining': {
          const aTime = a.lastTrainingDate?.getTime() || 0;
          const bTime = b.lastTrainingDate?.getTime() || 0;
          return dir * (aTime - bTime);
        }
        case 'latestRaw':
          return dir * ((a.latestRaw || 0) - (b.latestRaw || 0));
        case 'rawAvg':
          return dir * ((a.rawAverage || 0) - (b.rawAverage || 0));
        case 'thisWeek':
          return dir * ((a.currentWeekPlanned ? 1 : 0) - (b.currentWeekPlanned ? 1 : 0));
        case 'nextWeek':
          return dir * ((a.nextWeekPlanned ? 1 : 0) - (b.nextWeekPlanned ? 1 : 0));
        default:
          return 0;
      }
    });

    return sorted;
  }

  function SortHeader({ column, label }: { column: SortColumn; label: string }) {
    const isActive = sortColumn === column;
    return (
      <th
        className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-50 select-none"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {label}
          {isActive && (
            sortDirection === 'asc'
              ? <ArrowUp size={12} className="text-blue-600" />
              : <ArrowDown size={12} className="text-blue-600" />
          )}
        </div>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  const sortedStatuses = getSortedStatuses();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const activeThisWeek = athleteStatuses.filter(s => s.currentWeekPlanned).length;
  const needsAttentionCount = athleteStatuses.filter(s => needsAttentionCheck(s.lastTrainingDate)).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-base font-medium text-gray-900">{greeting}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{todayLabel}</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Athletes', value: athleteStatuses.length },
          { label: 'Active this week', value: activeThisWeek },
          { label: 'Upcoming events', value: upcomingEvents.length },
          { label: 'Needs attention', value: needsAttentionCount, warn: needsAttentionCount > 0 },
        ].map(({ label, value, warn }) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 py-2.5 px-4 hover:border-gray-300 transition-colors">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{label}</div>
            <div className={`text-xl font-semibold tabular-nums ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-medium text-gray-900 mb-4">Athletes</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="w-6 py-3 px-2"></th>
                <SortHeader column="name" label="Athlete" />
                <SortHeader column="macrocycle" label="Macrocycle" />
                <SortHeader column="week" label="Week" />
                <SortHeader column="lastTraining" label="Last Training" />
                {settings?.raw_enabled && (
                  <>
                    <SortHeader column="latestRaw" label="Latest RAW" />
                    <SortHeader column="rawAvg" label="RAW Avg" />
                  </>
                )}
                <SortHeader column="thisWeek" label="This Week" />
                <SortHeader column="nextWeek" label="Next Week" />
              </tr>
            </thead>
            <tbody>
              {sortedStatuses.map((status) => {
                const isExpanded = expandedAthleteId === status.athlete.id;
                const athleteAlignments = macroAlignments.filter(
                  ma => ma.athleteId === status.athlete.id
                );

                return (
                  <AthleteRow
                    key={status.athlete.id}
                    status={status}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpandedAthleteId(isExpanded ? null : status.athlete.id)}
                    rawEnabled={settings?.raw_enabled || false}
                    alignments={athleteAlignments}
                    needsAttention={needsAttentionCheck(status.lastTrainingDate)}
                    onNavigateToPlanner={onNavigateToPlanner}
                    bwEntries={bwEntriesMap[status.athlete.id] || []}
                    maDays={settings?.bodyweight_ma_days ?? 7}
                    onOpenBodyweightPopup={setBodyweightPopupAthlete}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick analysis — compliance sparklines */}
      {athleteStatuses.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mb-3">Quick analysis — 4-week compliance trend</h2>
          <div className="flex flex-wrap gap-3">
            {athleteStatuses.map(s => {
              const values = complianceTrends[s.athlete.id] ?? [];
              const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
              const color = avg == null ? '#9ca3af' : avg >= 95 ? '#1D9E75' : avg >= 85 ? '#378ADD' : avg >= 75 ? '#EF9F27' : '#E24B4A';
              // Build SVG sparkline points
              const w = 50, h = 20;
              const points = values.map((v, i) => {
                const x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
                const y = h - (Math.min(v, 100) / 100) * h;
                return `${x},${y}`;
              }).join(' ');
              return (
                <div key={s.athlete.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-[12px] font-medium text-gray-700 whitespace-nowrap">{s.athlete.name.split(' ')[0]}</div>
                  {values.length > 1 ? (
                    <svg width={w} height={h} className="overflow-visible">
                      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
                      {values.map((v, i) => {
                        const x = (i / (values.length - 1)) * w;
                        const y = h - (Math.min(v, 100) / 100) * h;
                        return <circle key={i} cx={x} cy={y} r={2} fill={color} />;
                      })}
                    </svg>
                  ) : (
                    <div className="text-[11px] text-gray-300">—</div>
                  )}
                  {avg != null && (
                    <div className="text-[11px] font-medium" style={{ color }}>{avg}%</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groupStatuses.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
            <UsersRound className="w-4 h-4" />
            Training Groups
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="w-6 py-3 px-2"></th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Group</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Members</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">This Week</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wide">Next Week</th>
                </tr>
              </thead>
              <tbody>
                {groupStatuses.map((gs) => {
                  const isExpanded = expandedGroupId === gs.group.id;
                  return (
                    <GroupRow
                      key={gs.group.id}
                      groupStatus={gs}
                      isExpanded={isExpanded}
                      onToggleExpand={() => setExpandedGroupId(isExpanded ? null : gs.group.id)}
                      onNavigateToPlanner={onNavigateToGroupPlanner}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <ActivityFeed events={activityFeed} />
        <UpcomingEventsList
          events={upcomingEvents}
          onEventClick={(event) => { setSelectedEvent(event); setShowEventOverview(true); }}
        />
      </div>

      {showEventOverview && selectedEvent && (
        <EventOverviewModal
          event={selectedEvent}
          onClose={() => {
            setShowEventOverview(false);
            setSelectedEvent(null);
          }}
        />
      )}

      {bodyweightPopupAthlete && (
        <BodyweightPopup
          athlete={bodyweightPopupAthlete}
          maDays={settings?.bodyweight_ma_days ?? 7}
          onClose={() => setBodyweightPopupAthlete(null)}
        />
      )}
    </div>
  );
}

interface AthleteRowProps {
  status: AthleteStatus;
  isExpanded: boolean;
  onToggleExpand: () => void;
  rawEnabled: boolean;
  alignments: MacroAlignment[];
  needsAttention: boolean;
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
  bwEntries: BodyweightEntry[];
  maDays: number;
  onOpenBodyweightPopup: (athlete: Athlete) => void;
}

function AthleteRow({
  status,
  isExpanded,
  onToggleExpand,
  rawEnabled,
  alignments,
  needsAttention,
  onNavigateToPlanner,
  bwEntries,
  maDays,
  onOpenBodyweightPopup,
}: AthleteRowProps) {
  const currentMA = bwEntries.length
    ? Math.round(bwEntries.slice(-maDays).reduce((s, e) => s + Number(e.weight_kg), 0) / Math.min(bwEntries.length, maDays) * 10) / 10
    : null;
  const prevEntries = bwEntries.slice(-maDays * 2, -maDays);
  const prevMA = prevEntries.length
    ? Math.round(prevEntries.reduce((s, e) => s + Number(e.weight_kg), 0) / prevEntries.length * 10) / 10
    : null;
  const bwTrend = currentMA !== null && prevMA !== null ? currentMA - prevMA : null;
  const BwTrendIcon = bwTrend === null ? Minus : bwTrend > 0.3 ? TrendingUp : bwTrend < -0.3 ? TrendingDown : Minus;
  const bwTrendColor = bwTrend === null ? 'text-gray-400' : bwTrend > 0.3 ? 'text-red-500' : bwTrend < -0.3 ? 'text-green-500' : 'text-gray-400';
  const colCount = 8 + (rawEnabled ? 2 : 0);

  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
        onClick={onToggleExpand}
      >
        <td className="py-3 px-2">
          {isExpanded
            ? <ChevronDown size={14} className="text-gray-400" />
            : <ChevronRight size={14} className="text-gray-400" />
          }
        </td>
        <td className="py-3 px-4" onClick={(e) => { e.stopPropagation(); onNavigateToPlanner(status.athlete, status.currentWeekStart); }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-[11px] font-medium text-blue-700 flex-shrink-0">
              {status.athlete.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-gray-900 hover:text-blue-600 transition-colors leading-tight">{status.athlete.name}</span>
              {status.athlete.weight_class && (
                <span className="text-[11px] text-gray-400">{status.athlete.weight_class}</span>
              )}
            </div>
            {needsAttention && (
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 ml-1" />
            )}
          </div>
        </td>
        <td className="py-3 px-4 text-sm text-gray-600">
          {status.currentMacrocycle?.name || '-'}
        </td>
        <td className="py-3 px-4 text-sm text-gray-600">
          {status.currentMacroWeek ? (
            <div>
              <div>
                Week {status.currentMacroWeek.week_number}
                {status.totalMacroWeeks && `/${status.totalMacroWeeks}`}
              </div>
              {status.currentMacroWeek.week_type_text && (
                <div className="text-xs text-gray-500">
                  {status.currentMacroWeek.week_type_text}
                </div>
              )}
            </div>
          ) : (
            '-'
          )}
        </td>
        <td className="py-3 px-4 text-sm text-gray-600">
          {getRelativeTime(status.lastTrainingDate)}
        </td>
        {rawEnabled && (
          <>
            <td className="py-3 px-4">
              {status.latestRaw !== null ? (
                <div
                  className={`inline-flex items-center px-2 py-1 rounded-full text-sm font-medium ${getRawBgColor(
                    status.latestRaw
                  )} ${getRawColor(status.latestRaw)}`}
                >
                  {status.latestRaw}
                </div>
              ) : (
                <span className="text-sm text-gray-400">-</span>
              )}
            </td>
            <td className="py-3 px-4">
              {status.rawAverage !== null ? (
                <div
                  className={`inline-flex items-center px-2 py-1 rounded-full text-sm font-medium ${getRawBgColor(
                    status.rawAverage
                  )} ${getRawColor(status.rawAverage)}`}
                >
                  {status.rawAverage.toFixed(1)}
                </div>
              ) : (
                <span className="text-sm text-gray-400">-</span>
              )}
            </td>
          </>
        )}
        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onNavigateToPlanner(status.athlete, status.currentWeekStart)}
            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors hover:ring-2 hover:ring-blue-300 ${
              status.currentWeekPlanned
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
            title="Go to this week's plan"
          >
            {status.currentWeekPlanned ? 'Planned' : 'Not Planned'}
          </button>
        </td>
        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onNavigateToPlanner(status.athlete, status.nextWeekStart)}
            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors hover:ring-2 hover:ring-blue-300 ${
              status.nextWeekPlanned
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
            title="Go to next week's plan"
          >
            {status.nextWeekPlanned ? 'Planned' : 'Not Planned'}
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={colCount} className="px-4 py-4">
            <div className="ml-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Club:</span>{' '}
                  <span className="font-medium text-gray-900">{status.athlete.club || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Age:</span>{' '}
                  <span className="font-medium text-gray-900">
                    {calculateAge(status.athlete.birthdate) ?? '-'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Bodyweight:</span>{' '}
                  {status.athlete.track_bodyweight ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenBodyweightPopup(status.athlete); }}
                      className="inline-flex items-center gap-1 hover:text-blue-600 transition-colors"
                      title="Open bodyweight history"
                    >
                      {currentMA !== null ? (
                        <>
                          <span className="font-medium text-gray-900">{currentMA.toFixed(1)} kg</span>
                          <BwTrendIcon size={12} className={bwTrendColor} />
                          <span className="text-[10px] text-gray-400">{maDays}-day avg</span>
                        </>
                      ) : (
                        <span className="font-medium text-gray-400">No data</span>
                      )}
                    </button>
                  ) : (
                    <span className="font-medium text-gray-900">
                      {status.athlete.bodyweight ? `${status.athlete.bodyweight}kg` : '-'}
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500">Weight Class:</span>{' '}
                  <span className="font-medium text-gray-900">{status.athlete.weight_class || '-'}</span>
                </div>
              </div>

              {status.athlete.notes && (
                <div className="text-sm">
                  <span className="text-gray-500">Notes:</span>{' '}
                  <span className="text-gray-700">{status.athlete.notes}</span>
                </div>
              )}

              {alignments.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Macro Alignment
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {alignments.map((alignment, index) => (
                      <div
                        key={index}
                        className={`px-3 py-2 rounded-lg border-2 ${
                          alignment.status === 'on-target'
                            ? 'bg-green-50 border-green-400'
                            : alignment.status === 'close'
                            ? 'bg-yellow-50 border-yellow-400'
                            : 'bg-red-50 border-red-400'
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {alignment.exerciseName}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          {alignment.planned}/{alignment.target} reps
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface GroupRowProps {
  groupStatus: GroupStatus;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onNavigateToPlanner: (group: TrainingGroup, weekStart: string) => void;
}

function GroupRow({ groupStatus, isExpanded, onToggleExpand, onNavigateToPlanner }: GroupRowProps) {
  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
        onClick={onToggleExpand}
      >
        <td className="py-3 px-2">
          {isExpanded
            ? <ChevronDown size={14} className="text-gray-400" />
            : <ChevronRight size={14} className="text-gray-400" />
          }
        </td>
        <td className="py-3 px-4">
          <span className="font-medium text-gray-900">{groupStatus.group.name}</span>
          {groupStatus.group.description && (
            <div className="text-xs text-gray-500 mt-0.5">{groupStatus.group.description}</div>
          )}
        </td>
        <td className="py-3 px-4 text-sm text-gray-600">
          {groupStatus.memberCount} athlete{groupStatus.memberCount !== 1 ? 's' : ''}
        </td>
        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onNavigateToPlanner(groupStatus.group, groupStatus.currentWeekStart)}
            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors hover:ring-2 hover:ring-blue-300 ${
              groupStatus.currentWeekPlanned
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
            title="Go to this week's group plan"
          >
            {groupStatus.currentWeekPlanned ? 'Planned' : 'Not Planned'}
          </button>
        </td>
        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onNavigateToPlanner(groupStatus.group, groupStatus.nextWeekStart)}
            className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors hover:ring-2 hover:ring-blue-300 ${
              groupStatus.nextWeekPlanned
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
            title="Go to next week's group plan"
          >
            {groupStatus.nextWeekPlanned ? 'Planned' : 'Not Planned'}
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-4 py-4">
            <div className="ml-6">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Members
              </h4>
              {groupStatus.members.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {groupStatus.members.map(member => (
                    <span
                      key={member.id}
                      className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200"
                    >
                      {member.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic">No members</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        Activity Feed
      </h2>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {events.map((event, index) => (
          <div key={index} className="flex items-start gap-3 text-sm">
            <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-600" />
            <div className="flex-1">
              {event.type === 'training_logged' && (
                <div>
                  <span className="font-medium text-gray-900">{event.athleteName}</span>
                  {' logged training on '}
                  <span className="text-gray-600">{event.details}</span>
                  {event.rawScore !== null && event.rawScore !== undefined && (
                    <span className={`ml-2 ${getRawColor(event.rawScore)}`}>
                      (RAW {event.rawScore})
                    </span>
                  )}
                </div>
              )}
              {event.type === 'session_skipped' && (
                <div>
                  <span className="font-medium text-gray-900">{event.athleteName}</span>
                  {' skipped session on '}
                  <span className="text-gray-600">{event.details}</span>
                </div>
              )}
              {event.type === 'macrocycle_created' && (
                <div>
                  New macrocycle{' '}
                  <span className="font-medium text-gray-900">{event.details}</span>
                  {' started for '}
                  <span className="font-medium text-gray-900">{event.athleteName}</span>
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1">
                {getRelativeTime(event.timestamp)}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-gray-500 italic text-center py-8">No recent activity</div>
        )}
      </div>
    </div>
  );
}

function UpcomingEventsList({
  events,
  onEventClick,
}: {
  events: UpcomingEvent[];
  onEventClick: (event: Event) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-base font-medium text-gray-900 mb-4 flex items-center gap-2">
        <Calendar className="w-4 h-4" />
        Upcoming Events
      </h2>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {events.map((event, index) => {
          const color = event.eventData.color ?? '#3b82f6';
          return (
            <button
              key={index}
              onClick={() => onEventClick(event.eventData)}
              className="w-full border-l-4 pl-3 py-2 text-left hover:bg-gray-50 rounded-r transition-colors"
              style={{ borderLeftColor: color }}
            >
              <div className="font-medium text-gray-900">{event.note}</div>
              <div className="text-sm text-gray-600">{event.athleteName}</div>
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                <span>{formatDateToDDMMYYYY(event.date.toISOString())}</span>
                <span className="font-medium" style={{ color }}>{event.daysUntil}d / {event.weeksUntil}w</span>
              </div>
            </button>
          );
        })}
        {events.length === 0 && (
          <div className="text-gray-500 italic text-center py-8">No upcoming events</div>
        )}
      </div>
    </div>
  );
}
