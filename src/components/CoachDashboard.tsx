import { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Calendar, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Athlete,
  MacroCycle,
  MacroWeek,
  TrainingLogSession,
  PlannedExerciseWithExercise,
  MacroTrackedExercise,
  MacroTarget,
  GeneralSettings as GeneralSettingsType,
  Event,
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
  athleteName: string;
  exerciseName: string;
  status: 'on-target' | 'close' | 'off-target';
  planned: number;
  target: number;
}

export function CoachDashboard() {
  const [athleteStatuses, setAthleteStatuses] = useState<AthleteStatus[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [macroAlignments, setMacroAlignments] = useState<MacroAlignment[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [settings, setSettings] = useState<GeneralSettingsType | null>(null);
  const [showMacroAlignment, setShowMacroAlignment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showEventOverview, setShowEventOverview] = useState(false);

  useEffect(() => {
    loadDashboardData();
    const interval = setInterval(loadDashboardData, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadDashboardData() {
    try {
      setLoading(true);
      await Promise.all([
        loadSettings(),
        loadAthleteStatuses(),
        loadActivityFeed(),
        loadMacroAlignments(),
        loadUpcomingEvents(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadSettings() {
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .maybeSingle();
    setSettings(data);
  }

  async function loadAthleteStatuses() {
    const { data: athletes } = await supabase
      .from('athletes')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (!athletes) return;

    const rawAverageDays = settings?.raw_average_days || 7;
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

      const today = new Date();
      const monday = new Date(today);
      monday.setDate(monday.getDate() - monday.getDay() + 1);
      const weekStartISO = monday.toISOString().split('T')[0];

      const nextMonday = new Date(monday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      const nextWeekStartISO = nextMonday.toISOString().split('T')[0];

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
        currentMacroWeek: currentMacroWeek,
        totalMacroWeeks,
        lastTrainingDate,
        latestRaw,
        rawAverage,
        currentWeekPlanned,
        nextWeekPlanned,
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

    const today = new Date();
    const monday = new Date(today);
    monday.setDate(monday.getDate() - monday.getDay() + 1);
    const weekStartISO = monday.toISOString().split('T')[0];

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

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-600">Loading dashboard...</div>
      </div>
    );
  }

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
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Athlete</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Macrocycle</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Week</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Last Training</th>
                {settings?.raw_enabled && (
                  <>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Latest RAW</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">RAW Avg</th>
                  </>
                )}
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">This Week</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Next Week</th>
              </tr>
            </thead>
            <tbody>
              {athleteStatuses.map((status) => (
                <tr
                  key={status.athlete.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {needsAttention(status) && (
                        <AlertCircle className="w-4 h-4 text-red-600" />
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
                  {settings?.raw_enabled && (
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
                  <td className="py-3 px-4">
                    {status.currentWeekPlanned ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
                        Planned
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-800">
                        Not Planned
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {status.nextWeekPlanned ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
                        Planned
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-yellow-100 text-yellow-800">
                        Not Planned
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Macro Alignment Signals</h2>
          <button
            onClick={() => setShowMacroAlignment(!showMacroAlignment)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {showMacroAlignment ? (
              <>
                <EyeOff className="w-4 h-4" />
                Hide
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" />
                Show
              </>
            )}
          </button>
        </div>

        {showMacroAlignment && (
          <div className="space-y-4">
            {athleteStatuses
              .filter(status => status.currentMacrocycle)
              .map((status) => {
                const athleteAlignments = macroAlignments.filter(
                  ma => ma.athleteName === status.athlete.name
                );

                if (athleteAlignments.length === 0) return null;

                return (
                  <div key={status.athlete.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="font-semibold text-gray-900 mb-3">{status.athlete.name}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {athleteAlignments.map((alignment, index) => (
                        <div
                          key={index}
                          className="relative group"
                          title={`Planned: ${alignment.planned}, Target: ${alignment.target}`}
                        >
                          <div
                            className={`px-3 py-2 rounded-lg border-2 cursor-help ${
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
                            <div className="text-xs text-gray-600 mt-1">
                              {alignment.planned}/{alignment.target} reps
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            {macroAlignments.length === 0 && (
              <div className="text-gray-500 italic text-center py-8">
                No macro alignment data available
              </div>
            )}
          </div>
        )}
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
