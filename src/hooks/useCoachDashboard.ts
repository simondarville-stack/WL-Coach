import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type {
  Athlete,
  MacroCycle,
  MacroWeek,
  GeneralSettings as GeneralSettingsType,
  Event,
  TrainingGroup,
} from '../lib/database.types';
import { formatDateToDDMMYYYY } from '../lib/dateUtils';
import { getCurrentAndNextWeekStart, findCurrentMacroWeek } from '../lib/weekUtils';
import { computeRawAverage } from '../lib/calculations';

export interface AthleteStatus {
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

export interface ActivityEvent {
  type: 'training_logged' | 'session_skipped' | 'macrocycle_created';
  timestamp: Date;
  athleteName: string;
  details: string;
  rawScore?: number | null;
}

export interface UpcomingEvent {
  date: Date;
  athleteName: string;
  note: string;
  daysUntil: number;
  weeksUntil: number;
  eventData: Event;
}

export interface MacroAlignment {
  athleteId: string;
  athleteName: string;
  exerciseName: string;
  status: 'on-target' | 'close' | 'off-target';
  planned: number;
  target: number;
}

export interface GroupStatus {
  group: TrainingGroup;
  memberCount: number;
  members: { id: string; name: string }[];
  currentWeekPlanned: boolean;
  nextWeekPlanned: boolean;
  currentWeekStart: string;
  nextWeekStart: string;
}

export function useCoachDashboard() {
  const [athleteStatuses, setAthleteStatuses] = useState<AthleteStatus[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [macroAlignments, setMacroAlignments] = useState<MacroAlignment[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [groupStatuses, setGroupStatuses] = useState<GroupStatus[]>([]);
  const [settings, setSettings] = useState<GeneralSettingsType | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadSettings(): Promise<GeneralSettingsType | null> {
    const { data } = await supabase
      .from('general_settings')
      .select('*')
      .eq('owner_id', getOwnerId())
      .maybeSingle();
    setSettings(data);
    return data;
  }

  async function loadAthleteStatuses(settingsData: GeneralSettingsType | null) {
    const { data: athletes } = await supabase
      .from('athletes')
      .select('*')
      .eq('owner_id', getOwnerId())
      .eq('is_active', true)
      .order('name');

    if (!athletes) return;

    const rawAverageDays = settingsData?.raw_average_days || 7;
    const { weekStartISO, nextWeekStartISO } = getCurrentAndNextWeekStart();
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
        const { data: macroWeeks } = await supabase
          .from('macro_weeks')
          .select('*')
          .eq('macrocycle_id', macrocycle.id)
          .order('week_start');

        if (macroWeeks) {
          totalMacroWeeks = macroWeeks.length;
          currentMacroWeek = findCurrentMacroWeek(macroWeeks);
        }
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rawAverageDays);

      const { data: recentSessions } = await supabase
        .from('training_log_sessions')
        .select('*')
        .eq('athlete_id', athlete.id)
        .neq('status', 'planned')
        .gte('date', cutoffDate.toISOString().split('T')[0])
        .order('date', { ascending: false });

      const lastTrainingDate = recentSessions && recentSessions.length > 0
        ? new Date(recentSessions[0].date)
        : null;

      const latestRaw = recentSessions && recentSessions.length > 0
        ? recentSessions[0].raw_total
        : null;

      const rawAverage = computeRawAverage(
        (recentSessions || []).map(s => s.raw_total)
      );

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
    const { data: ownerAthletes } = await supabase
      .from('athletes')
      .select('id')
      .eq('owner_id', getOwnerId());
    const athleteIds = ownerAthletes?.map(a => a.id) || [];
    const idFilter = athleteIds.length > 0 ? athleteIds : [''];

    const { data: sessions } = await supabase
      .from('training_log_sessions')
      .select('*, athlete:athletes(name)')
      .in('athlete_id', idFilter)
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
      .eq('owner_id', getOwnerId())
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
      .eq('owner_id', getOwnerId())
      .eq('is_active', true);

    if (!athletes) return;

    const { weekStartISO } = getCurrentAndNextWeekStart();

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

      const currentWeek = findCurrentMacroWeek(macroWeeks);

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
      .eq('owner_id', getOwnerId())
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

        type EventAthleteRow = { athlete: { name: string } | null };
        const athleteNames = eventAthletes?.map((ea: EventAthleteRow) => ea.athlete?.name ?? '').filter(Boolean).join(', ') || 'All Athletes';

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
      .eq('owner_id', getOwnerId())
      .order('name');

    if (!groups || groups.length === 0) {
      setGroupStatuses([]);
      return;
    }

    const { weekStartISO, nextWeekStartISO } = getCurrentAndNextWeekStart();
    const statuses: GroupStatus[] = [];

    for (const group of groups) {
      const { data: members } = await supabase
        .from('group_members')
        .select('athlete:athlete_id(id, name)')
        .eq('group_id', group.id)
        .is('left_at', null);

      type GroupMemberRow = { athlete: { id: string; name: string } | null };
      const memberList = (members || []).map((m: GroupMemberRow) => ({
        id: m.athlete?.id ?? '',
        name: m.athlete?.name ?? '',
      })).filter(m => m.id);

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

  return {
    athleteStatuses,
    activityFeed,
    macroAlignments,
    upcomingEvents,
    groupStatuses,
    settings,
    loading,
    loadDashboardData,
  };
}
