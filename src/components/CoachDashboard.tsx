import { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Calendar, ChevronDown, ChevronRight, ArrowUp, ArrowDown, UsersRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Athlete,
  MacroCycle,
  MacroWeek,
  GeneralSettings as GeneralSettingsType,
  Event,
  TrainingGroup,
} from '../lib/database.types';
import { formatDateToDDMMYYYY } from '../lib/dateUtils';
import { EventOverviewModal } from './EventOverviewModal';

interface AthleteStatus {
  athlete: Athlete;
  currentMacrocycle: MacroCycle | null;
  currentMacroWeek: MacroWeek | null;
  totalMacroWeeks: number | null;
  lastTrainingDate: Date | null;
  latestRaw: number | null;
  rawAverage: number | null;
  currentWeekPlanned: boolean;
  nextWeekPlanned: boolean;
  currentWeekStart: string;
  nextWeekStart: string;
}

interface ActivityEvent {
  type: 'training_logged' | 'session_skipped' | 'macrocycle_created';
  timestamp: Date;
  athleteName: string;
  details: string;
  rawScore?: number | null;
}

interface UpcomingEvent {
  date: Date;
  athleteName: string;
  note: string;
  daysUntil: number;
  weeksUntil: number;
  eventData: Event;
}

interface MacroAlignment {
  athleteId: string;
  athleteName: string;
  exerciseName: string;
  status: 'on-target' | 'close' | 'off-target';
  planned: number;
  target: number;
}

interface GroupStatus {
  group: TrainingGroup;
  memberCount: number;
  members: { id: string; name: string }[];
  currentWeekPlanned: boolean;
  nextWeekPlanned: boolean;
  currentWeekStart: string;
  nextWeekStart: string;
}

type SortColumn = 'name' | 'macrocycle' | 'week' | 'lastTraining' | 'latestRaw' | 'rawAvg' | 'thisWeek' | 'nextWeek';
type SortDirection = 'asc' | 'desc';

interface CoachDashboardProps {
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
}

export function CoachDashboard({ onNavigateToPlanner }: CoachDashboardProps) {
  const [athleteStatuses, setAthleteStatuses] = useState<AthleteStatus[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [macroAlignments, setMacroAlignments] = useState<MacroAlignment[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [groupStatuses, setGroupStatuses] = useState<GroupStatus[]>([]);
  const [settings, setSettings] = useState<GeneralSettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showEventOverview, setShowEventOverview] = useState(false);
  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboardData() {
    try {
      setLoading(true);
      const settingsData = await loadSettings();
      await Promise.all([
        loadAthleteStatuses(settingsData),
        loadActivityFeed(),
        loadMacroAlignments(),
        loadUpcomingEvents(),
        loadGroupStatuses(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings(): Promise<GeneralSettingsType | null> {
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .maybeSingle();
    setSettings(data);
    return data;
  }

  function getWeekDates() {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
    const weekStartISO = monday.toISOString().split('T')[0];

    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const nextWeekStartISO = nextMonday.toISOString().split('T')[0];

    return { weekStartISO, nextWeekStartISO };
  }

  async function loadAthleteStatuses(settingsData: GeneralSettingsType | null) {
    const { data: athletes } = await supabase
      .from('athletes')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (!athletes) return;

    const rawAverageDays = settingsData?.raw_average_days || 7;
    const { weekStartISO, nextWeekStartISO } = getWeekDates();
    const statuses: AthleteStatus[] = [];

    for (const athlete of athletes) {
      const { data: macrocycle } = await supabase
        .from('macrocycles')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('is_active', true)
        .maybeSingle();

      let currentMacroWeek: MacroWeek | null = null;
      let totalMacroWeeks: number | null = null;
      if (macrocycle) {
        const today = new Date();
        const { data: macroWeeks } = await supabase
          .from('macro_weeks')
          .select('*')
          .eq('macrocycle_id', macrocycle.id)
          .order('week_start');

        if (macroWeeks) {
          totalMacroWeeks = macroWeeks.length;
          currentMacroWeek = macroWeeks.find(mw => {
            const start = new Date(mw.week_start);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            return today >= start && today < end;
          }) || null;
        }
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rawAverageDays);

      const { data: recentSessions } = await supabase
        .from('training_log_sessions')
        .select('*')
        .eq('athlete_id', athlete.id)
        .gte('date', cutoffDate.toISOString().split('T')[0])
        .order('date', { ascending: false });

      const lastTrainingDate = recentSessions && recentSessions.length > 0
        ? new Date(recentSessions[0].date)
        : null;

      const latestRaw = recentSessions && recentSessions.length > 0
        ? recentSessions[0].raw_total
        : null;

      let rawAverage: number | null = null;
      if (recentSessions && recentSessions.length > 0) {
        const rawTotals = recentSessions
          .map(s => s.raw_total)
          .filter((r): r is number => r !== null);
        if (rawTotals.length > 0) {
          rawAverage = rawTotals.reduce((a, b) => a + b, 0) / rawTotals.length;
        }
      }

      const { data: currentWeekPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('athlete_id', athlete.id)
        .eq('week_start', weekStartISO)
        .maybeSingle();

      const { data: nextWeekPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('athlete_id', athlete.id)
        .eq('week_start', nextWeekStartISO)
        .maybeSingle();

      let currentWeekPlanned = false;
      if (currentWeekPlan) {
        const { data: plannedExercises } = await supabase
          .from('planned_exercises')
          .select('id')
          .eq('weekplan_id', currentWeekPlan.id)
          .limit(1);
        currentWeekPlanned = (plannedExercises?.length || 0) > 0;
      }

      let nextWeekPlanned = false;
      if (nextWeekPlan) {
        const { data: plannedExercises } = await supabase
          .from('planned_exercises')
          .select('id')
          .eq('weekplan_id', nextWeekPlan.id)
          .limit(1);
        nextWeekPlanned = (plannedExercises?.length || 0) > 0;
      }

      statuses.push({
        athlete,
        currentMacrocycle: macrocycle || null,
        currentMacroWeek,
        totalMacroWeeks,
        lastTrainingDate,
        latestRaw,
        rawAverage,
        currentWeekPlanned,
        nextWeekPlanned,
        currentWeekStart: weekStartISO,
        nextWeekStart: nextWeekStartISO,
      });
    }

    setAthleteStatuses(statuses);
  }

  async function loadActivityFeed() {
    const { data: sessions } = await supabase
      .from('training_log_sessions')
      .select('*, athlete:athletes(name)')
      .order('date', { ascending: false })
      .limit(30);

    const events: ActivityEvent[] = [];

    if (sessions) {
      for (const session of sessions) {
        const athlete = session.athlete as unknown as { name: string };
        if (session.status === 'completed') {
          events.push({
            type: 'training_logged',
            timestamp: new Date(session.date),
            athleteName: athlete.name,
            details: formatDateToDDMMYYYY(session.date),
            rawScore: session.raw_total,
          });
        } else if (session.status === 'skipped') {
          events.push({
            type: 'session_skipped',
            timestamp: new Date(session.date),
            athleteName: athlete.name,
            details: formatDateToDDMMYYYY(session.date),
          });
        }
      }
    }

    const { data: macrocycles } = await supabase
      .from('macrocycles')
      .select('*, athlete:athletes(name)')
      .order('created_at', { ascending: false })
      .limit(10);

    if (macrocycles) {
      for (const macro of macrocycles) {
        const athlete = macro.athlete as unknown as { name: string };
        events.push({
          type: 'macrocycle_created',
          timestamp: new Date(macro.created_at),
          athleteName: athlete.name,
          details: macro.name,
        });
      }
    }

    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    setActivityFeed(events.slice(0, 30));
  }

  async function loadMacroAlignments() {
    const alignments: MacroAlignment[] = [];

    const { data: athletes } = await supabase
      .from('athletes')
      .select('*')
      .eq('is_active', true);

    if (!athletes) return;

    const { weekStartISO } = getWeekDates();

    for (const athlete of athletes) {
      const { data: macrocycle } = await supabase
        .from('macrocycles')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!macrocycle) continue;

      const { data: macroWeeks } = await supabase
        .from('macro_weeks')
        .select('*')
        .eq('macrocycle_id', macrocycle.id);

      if (!macroWeeks) continue;

      const today = new Date();
      const currentWeek = macroWeeks.find(mw => {
        const start = new Date(mw.week_start);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        return today >= start && today < end;
      });

      if (!currentWeek) continue;

      const { data: trackedExercises } = await supabase
        .from('macro_tracked_exercises')
        .select('*, exercise:exercises(name)')
        .eq('macrocycle_id', macrocycle.id);

      if (!trackedExercises) continue;

      const { data: weekPlan } = await supabase
        .from('week_plans')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('week_start', weekStartISO)
        .maybeSingle();

      if (!weekPlan) continue;

      for (const tracked of trackedExercises) {
        const exercise = tracked.exercise as unknown as { name: string };

        const { data: targets } = await supabase
          .from('macro_targets')
          .select('*')
          .eq('macro_week_id', currentWeek.id)
          .eq('tracked_exercise_id', tracked.id)
          .maybeSingle();

        if (!targets) continue;

        const { data: plannedExercises } = await supabase
          .from('planned_exercises')
          .select('summary_total_reps')
          .eq('weekplan_id', weekPlan.id)
          .eq('exercise_id', tracked.exercise_id);

        const totalPlannedReps = (plannedExercises || []).reduce(
          (sum, pe) => sum + (pe.summary_total_reps || 0),
          0
        );

        const targetReps = targets.target_reps || 0;

        if (targetReps === 0) continue;

        let status: 'on-target' | 'close' | 'off-target' = 'off-target';

        if (totalPlannedReps === targetReps) {
          status = 'on-target';
        } else if (Math.abs(totalPlannedReps - targetReps) <= targetReps * 0.15) {
          status = 'close';
        }

        alignments.push({
          athleteId: athlete.id,
          athleteName: athlete.name,
          exerciseName: exercise.name,
          status,
          planned: totalPlannedReps,
          target: targetReps,
        });
      }
    }

    setMacroAlignments(alignments);
  }

  async function loadUpcomingEvents() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eightWeeksFromNow = new Date(today);
    eightWeeksFromNow.setDate(eightWeeksFromNow.getDate() + 56);

    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .gte('event_date', today.toISOString().split('T')[0])
      .lte('event_date', eightWeeksFromNow.toISOString().split('T')[0])
      .order('event_date');

    const events: UpcomingEvent[] = [];

    if (eventsData) {
      for (const event of eventsData) {
        const { data: eventAthletes } = await supabase
          .from('event_athletes')
          .select('athlete:athletes(name)')
          .eq('event_id', event.id);

        const athleteNames = eventAthletes?.map((ea: any) => ea.athlete.name).join(', ') || 'All Athletes';

        const eventDate = new Date(event.event_date);
        eventDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const weeksUntil = Math.ceil(daysUntil / 7);

        events.push({
          date: eventDate,
          athleteName: athleteNames,
          note: event.name,
          daysUntil,
          weeksUntil,
          eventData: event,
        });
      }
    }

    setUpcomingEvents(events);
  }

  async function loadGroupStatuses() {
    const { data: groups } = await supabase
      .from('training_groups')
      .select('*')
      .order('name');

    if (!groups || groups.length === 0) {
      setGroupStatuses([]);
      return;
    }

    const { weekStartISO, nextWeekStartISO } = getWeekDates();
    const statuses: GroupStatus[] = [];

    for (const group of groups) {
      const { data: members } = await supabase
        .from('group_members')
        .select('athlete:athlete_id(id, name)')
        .eq('group_id', group.id)
        .is('left_at', null);

      const memberList = (members || []).map((m: any) => ({
        id: m.athlete.id,
        name: m.athlete.name,
      }));

      const { data: currentWeekPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('group_id', group.id)
        .eq('is_group_plan', true)
        .eq('week_start', weekStartISO)
        .maybeSingle();

      const { data: nextWeekPlan } = await supabase
        .from('week_plans')
        .select('id')
        .eq('group_id', group.id)
        .eq('is_group_plan', true)
        .eq('week_start', nextWeekStartISO)
        .maybeSingle();

      let currentWeekPlanned = false;
      if (currentWeekPlan) {
        const { data: pe } = await supabase
          .from('planned_exercises')
          .select('id')
          .eq('weekplan_id', currentWeekPlan.id)
          .limit(1);
        currentWeekPlanned = (pe?.length || 0) > 0;
      }

      let nextWeekPlanned = false;
      if (nextWeekPlan) {
        const { data: pe } = await supabase
          .from('planned_exercises')
          .select('id')
          .eq('weekplan_id', nextWeekPlan.id)
          .limit(1);
        nextWeekPlanned = (pe?.length || 0) > 0;
      }

      statuses.push({
        group,
        memberCount: memberList.length,
        members: memberList,
        currentWeekPlanned,
        nextWeekPlanned,
        currentWeekStart: weekStartISO,
        nextWeekStart: nextWeekStartISO,
      });
    }

    setGroupStatuses(statuses);
  }

  function getRelativeTime(date: Date | null): string {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 14) return '1 week ago';
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }

  function getRawColor(avg: number | null): string {
    if (avg === null) return 'text-gray-400';
    if (avg >= 10) return 'text-green-600';
    if (avg >= 7) return 'text-yellow-600';
    return 'text-red-600';
  }

  function getRawBgColor(avg: number | null): string {
    if (avg === null) return 'bg-gray-100';
    if (avg >= 10) return 'bg-green-100';
    if (avg >= 7) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  const needsAttention = (status: AthleteStatus) => {
    if (!status.lastTrainingDate) return true;
    const daysSinceTraining = Math.floor(
      (new Date().getTime() - status.lastTrainingDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceTraining > 7;
  };

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
        className="text-left py-3 px-4 text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 select-none"
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
        <div className="text-lg text-gray-600">Loading dashboard...</div>
      </div>
    );
  }

  const sortedStatuses = getSortedStatuses();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Coach Dashboard</h1>
        <div className="text-sm text-gray-500">
          Updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Athlete Status Overview</h2>
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
                    needsAttention={needsAttention(status)}
                    getRawColor={getRawColor}
                    getRawBgColor={getRawBgColor}
                    getRelativeTime={getRelativeTime}
                    onNavigateToPlanner={onNavigateToPlanner}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {groupStatuses.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <UsersRound className="w-5 h-5" />
            Training Groups Overview
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="w-6 py-3 px-2"></th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Group</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Members</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">This Week</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Next Week</th>
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
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Activity Feed
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {activityFeed.map((event, index) => (
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
            {activityFeed.length === 0 && (
              <div className="text-gray-500 italic text-center py-8">No recent activity</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Upcoming Events
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {upcomingEvents.map((event, index) => (
              <button
                key={index}
                onClick={() => {
                  setSelectedEvent(event.eventData);
                  setShowEventOverview(true);
                }}
                className="w-full border-l-4 border-blue-600 pl-3 py-2 text-left hover:bg-gray-50 rounded-r transition-colors"
              >
                <div className="font-medium text-gray-900">{event.note}</div>
                <div className="text-sm text-gray-600">{event.athleteName}</div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                  <span>{formatDateToDDMMYYYY(event.date.toISOString())}</span>
                  <span className="font-medium text-blue-600">
                    {event.daysUntil} days ({event.weeksUntil} weeks)
                  </span>
                </div>
              </button>
            ))}
            {upcomingEvents.length === 0 && (
              <div className="text-gray-500 italic text-center py-8">No upcoming events</div>
            )}
          </div>
        </div>
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
  getRawColor: (avg: number | null) => string;
  getRawBgColor: (avg: number | null) => string;
  getRelativeTime: (date: Date | null) => string;
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
}

function AthleteRow({
  status,
  isExpanded,
  onToggleExpand,
  rawEnabled,
  alignments,
  needsAttention,
  getRawColor,
  getRawBgColor,
  getRelativeTime,
  onNavigateToPlanner,
}: AthleteRowProps) {
  const colCount = 8 + (rawEnabled ? 2 : 0);

  function calculateAge(birthdate: string | null): number | null {
    if (!birthdate) return null;
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

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
          <div className="flex items-center gap-2">
            {needsAttention && (
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
            )}
            <span className="font-medium text-gray-900">{status.athlete.name}</span>
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
                  <span className="font-medium text-gray-900">
                    {status.athlete.bodyweight ? `${status.athlete.bodyweight}kg` : '-'}
                  </span>
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
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
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
}

function GroupRow({ groupStatus, isExpanded, onToggleExpand }: GroupRowProps) {
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
        <td className="py-3 px-4">
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
            groupStatus.currentWeekPlanned
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}>
            {groupStatus.currentWeekPlanned ? 'Planned' : 'Not Planned'}
          </span>
        </td>
        <td className="py-3 px-4">
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
            groupStatus.nextWeekPlanned
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}>
            {groupStatus.nextWeekPlanned ? 'Planned' : 'Not Planned'}
          </span>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={5} className="px-4 py-4">
            <div className="ml-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
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
