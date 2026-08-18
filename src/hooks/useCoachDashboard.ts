import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import {
  fetchAccessibleAthletes,
  fetchAccessibleGroups,
  resolveGroupAccess,
} from '../lib/accessScope';
import { fetchByIds } from '../lib/queryPaging';
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
  type: 'training_logged' | 'session_skipped' | 'macrocycle_created' | 'pr_set';
  timestamp: Date;
  athleteName: string;
  details: string;
  rawScore?: number | null;
  // Deep-link payload for click-through to the Log. Null for macrocycle rows
  // (which only jump to the athlete on the board).
  weekStart?: string | null;
  dayIndex?: number | null;
  // For PR rows: the exercise + rep count to highlight in the PR table.
  exerciseId?: string | null;
  repCount?: number | null;
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

interface ResolvedMacro {
  macrocycle: MacroCycle;
  macroWeeks: MacroWeek[];
  currentMacroWeek: MacroWeek | null;
}

/**
 * The macrocycle to show as "current" per athlete, resolved for the whole
 * roster in two round trips. Several cycles can carry is_active=true at once
 * (creating a new cycle doesn't deactivate the old one), so per athlete we
 * pick the active cycle whose weeks cover today; if none does, fall back to
 * the most recently created active one.
 */
async function resolveCurrentMacros(athleteIds: string[]): Promise<Map<string, ResolvedMacro>> {
  const result = new Map<string, ResolvedMacro>();
  if (athleteIds.length === 0) return result;

  const { data: actives } = await supabase
    .from('macrocycles')
    .select('*')
    .in('athlete_id', athleteIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  const activeCycles = (actives ?? []) as MacroCycle[];
  if (activeCycles.length === 0) return result;

  const weeks = await fetchByIds(activeCycles.map(m => m.id), (ids, from, to) =>
    supabase
      .from('macro_weeks')
      .select('*')
      .in('macrocycle_id', ids)
      .order('week_start')
      .order('id')
      .range(from, to),
  );
  const weeksByCycle = new Map<string, MacroWeek[]>();
  for (const w of weeks as MacroWeek[]) {
    const arr = weeksByCycle.get(w.macrocycle_id);
    if (arr) arr.push(w);
    else weeksByCycle.set(w.macrocycle_id, [w]);
  }

  // Query order is created_at DESC, so each athlete's list keeps that order.
  const cyclesByAthlete = new Map<string, MacroCycle[]>();
  for (const m of activeCycles) {
    if (!m.athlete_id) continue;
    const arr = cyclesByAthlete.get(m.athlete_id);
    if (arr) arr.push(m);
    else cyclesByAthlete.set(m.athlete_id, [m]);
  }

  for (const [athleteId, cycles] of cyclesByAthlete) {
    let resolved: ResolvedMacro | null = null;
    let fallback: ResolvedMacro | null = null;
    for (const macrocycle of cycles) {
      const macroWeeks = weeksByCycle.get(macrocycle.id) ?? [];
      const currentMacroWeek = findCurrentMacroWeek(macroWeeks);
      if (currentMacroWeek) {
        resolved = { macrocycle, macroWeeks, currentMacroWeek };
        break;
      }
      if (!fallback) fallback = { macrocycle, macroWeeks, currentMacroWeek: null };
    }
    const pick = resolved ?? fallback;
    if (pick) result.set(athleteId, pick);
  }
  return result;
}

interface WeekPlanContext {
  weekStartISO: string;
  nextWeekStartISO: string;
  /** `${athleteId}|${weekStart}` → week plan id */
  athletePlanByKey: Map<string, string>;
  /** `${groupId}|${weekStart}` → week plan id (group plans only) */
  groupPlanByKey: Map<string, string>;
  /** Week plan ids that contain at least one planned exercise. */
  plansWithExercises: Set<string>;
}

/**
 * Current + next week plans for every athlete and group, plus which of those
 * plans actually contain exercises — shared by the status board, the group
 * board and the macro-alignment panel so none of them re-query per row.
 */
async function fetchWeekPlanContext(
  athleteIds: string[],
  groupIds: string[],
  weekStartISO: string,
  nextWeekStartISO: string,
): Promise<WeekPlanContext> {
  const weekStarts = [weekStartISO, nextWeekStartISO];
  const [athletePlans, groupPlans] = await Promise.all([
    fetchByIds(athleteIds, (ids, from, to) =>
      supabase
        .from('week_plans')
        .select('id, athlete_id, week_start')
        .in('athlete_id', ids)
        .in('week_start', weekStarts)
        .order('id')
        .range(from, to),
    ),
    fetchByIds(groupIds, (ids, from, to) =>
      supabase
        .from('week_plans')
        .select('id, group_id, week_start')
        .eq('is_group_plan', true)
        .in('group_id', ids)
        .in('week_start', weekStarts)
        .order('id')
        .range(from, to),
    ),
  ]);

  const athletePlanByKey = new Map<string, string>();
  for (const p of athletePlans) {
    if (p.athlete_id) athletePlanByKey.set(`${p.athlete_id}|${p.week_start}`, p.id);
  }
  const groupPlanByKey = new Map<string, string>();
  for (const p of groupPlans) {
    if (p.group_id) groupPlanByKey.set(`${p.group_id}|${p.week_start}`, p.id);
  }

  const planIds = [...athletePlans.map(p => p.id), ...groupPlans.map(p => p.id)];
  const plansWithExercises = new Set<string>();
  const peRows = await fetchByIds(planIds, (ids, from, to) =>
    supabase
      .from('planned_exercises')
      .select('weekplan_id')
      .in('weekplan_id', ids)
      .order('id')
      .range(from, to),
  );
  for (const row of peRows) plansWithExercises.add(row.weekplan_id);

  return { weekStartISO, nextWeekStartISO, athletePlanByKey, groupPlanByKey, plansWithExercises };
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

  async function loadAthleteStatuses(
    settingsData: GeneralSettingsType | null,
    athletes: Athlete[],
    macros: Map<string, ResolvedMacro>,
    ctx: WeekPlanContext,
  ) {
    const rawAverageDays = settingsData?.raw_average_days || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - rawAverageDays);
    const cutoffISO = cutoffDate.toISOString().split('T')[0];

    const recentSessions = await fetchByIds(athletes.map(a => a.id), (ids, from, to) =>
      supabase
        .from('training_log_sessions')
        .select('id, athlete_id, date, raw_total')
        .in('athlete_id', ids)
        .neq('status', 'planned')
        .gte('date', cutoffISO)
        .order('date', { ascending: false })
        .order('id')
        .range(from, to),
    );

    // Query order is date DESC, so each athlete's list keeps latest-first.
    const sessionsByAthlete = new Map<string, { date: string; raw_total: number | null }[]>();
    for (const s of recentSessions) {
      const arr = sessionsByAthlete.get(s.athlete_id);
      if (arr) arr.push(s);
      else sessionsByAthlete.set(s.athlete_id, [s]);
    }

    const { weekStartISO, nextWeekStartISO, athletePlanByKey, plansWithExercises } = ctx;
    const statuses: AthleteStatus[] = athletes.map(athlete => {
      const macro = macros.get(athlete.id) ?? null;
      const sessions = sessionsByAthlete.get(athlete.id) ?? [];
      const currentPlanId = athletePlanByKey.get(`${athlete.id}|${weekStartISO}`);
      const nextPlanId = athletePlanByKey.get(`${athlete.id}|${nextWeekStartISO}`);
      return {
        athlete,
        currentMacrocycle: macro?.macrocycle ?? null,
        currentMacroWeek: macro?.currentMacroWeek ?? null,
        totalMacroWeeks: macro ? macro.macroWeeks.length : null,
        lastTrainingDate: sessions.length > 0 ? new Date(sessions[0].date) : null,
        latestRaw: sessions.length > 0 ? sessions[0].raw_total : null,
        rawAverage: computeRawAverage(sessions.map(s => s.raw_total)),
        currentWeekPlanned: currentPlanId ? plansWithExercises.has(currentPlanId) : false,
        nextWeekPlanned: nextPlanId ? plansWithExercises.has(nextPlanId) : false,
        currentWeekStart: weekStartISO,
        nextWeekStart: nextWeekStartISO,
      };
    });

    setAthleteStatuses(statuses);
  }

  async function loadActivityFeed(accessibleAthleteIds: string[]) {
    const idFilter = accessibleAthleteIds.length > 0 ? accessibleAthleteIds : [''];

    // The three sources are independent — fetch them together. Each carries
    // its own LIMIT, so no paging is needed here.
    const [sessionsRes, macrocyclesRes, prsRes] = await Promise.all([
      supabase
        .from('training_log_sessions')
        .select('*, athlete:athletes(name)')
        .in('athlete_id', idFilter)
        .order('date', { ascending: false })
        .limit(30),
      // Scope recent-macrocycle activity to accessible athletes (owned +
      // shared) rather than owner_id, so a co-coach sees activity on
      // athletes shared with them.
      supabase
        .from('macrocycles')
        .select('*, athlete:athletes(name)')
        .in('athlete_id', idFilter)
        .order('created_at', { ascending: false })
        .limit(10),
      // Recent PRs — deep-link to the Log for the week the PR was achieved.
      supabase
        .from('athlete_pr_history')
        .select('athlete_id, exercise_id, rep_count, value_kg, achieved_date, created_at, athlete:athletes(name), exercise:exercises(name)')
        .in('athlete_id', idFilter)
        .order('achieved_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const events: ActivityEvent[] = [];

    if (sessionsRes.data) {
      for (const session of sessionsRes.data) {
        const athlete = session.athlete as unknown as { name: string };
        if (session.status === 'completed') {
          events.push({
            type: 'training_logged',
            timestamp: new Date(session.date),
            athleteName: athlete.name,
            details: formatDateToDDMMYYYY(session.date),
            rawScore: session.raw_total,
            weekStart: session.week_start,
            dayIndex: session.day_index,
          });
        } else if (session.status === 'skipped') {
          // Surface the athlete's reason (sick / injured / …) inline so the
          // coach sees WHY at a glance, not just that a day was missed.
          const reason = (session.skipped_reason ?? '').trim();
          events.push({
            type: 'session_skipped',
            timestamp: new Date(session.date),
            athleteName: athlete.name,
            details: reason
              ? `${formatDateToDDMMYYYY(session.date)} · ${reason}`
              : formatDateToDDMMYYYY(session.date),
            weekStart: session.week_start,
            dayIndex: session.day_index,
          });
        }
      }
    }

    if (macrocyclesRes.data) {
      for (const macro of macrocyclesRes.data) {
        const athlete = macro.athlete as unknown as { name: string };
        events.push({
          type: 'macrocycle_created',
          timestamp: new Date(macro.created_at),
          athleteName: athlete.name,
          details: macro.name,
        });
      }
    }

    if (prsRes.data) {
      for (const pr of prsRes.data) {
        const athlete = pr.athlete as unknown as { name: string } | null;
        const exercise = pr.exercise as unknown as { name: string | null } | null;
        if (!athlete) continue;
        events.push({
          type: 'pr_set',
          timestamp: new Date(pr.achieved_date),
          athleteName: athlete.name,
          details: `${exercise?.name ?? 'Lift'} · ${pr.value_kg} kg × ${pr.rep_count}`,
          exerciseId: pr.exercise_id,
          repCount: pr.rep_count,
        });
      }
    }

    events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    setActivityFeed(events.slice(0, 30));
  }

  async function loadMacroAlignments(
    athletes: Athlete[],
    macros: Map<string, ResolvedMacro>,
    ctx: WeekPlanContext,
  ) {
    // Only athletes with an active cycle, a macro week covering today AND a
    // week plan this week can produce alignment rows.
    const eligible: {
      athlete: Athlete;
      macrocycle: MacroCycle;
      currentWeekId: string;
      weekPlanId: string;
    }[] = [];
    for (const athlete of athletes) {
      const macro = macros.get(athlete.id);
      const weekPlanId = ctx.athletePlanByKey.get(`${athlete.id}|${ctx.weekStartISO}`);
      if (!macro?.currentMacroWeek || !weekPlanId) continue;
      eligible.push({
        athlete,
        macrocycle: macro.macrocycle,
        currentWeekId: macro.currentMacroWeek.id,
        weekPlanId,
      });
    }
    if (eligible.length === 0) {
      setMacroAlignments([]);
      return;
    }

    type TrackedRow = {
      id: string;
      macrocycle_id: string;
      exercise_id: string;
      exercise: { name: string } | null;
    };
    const cycleIds = Array.from(new Set(eligible.map(e => e.macrocycle.id)));
    const trackedRows = (await fetchByIds(cycleIds, (ids, from, to) =>
      supabase
        .from('macro_tracked_exercises')
        .select('id, macrocycle_id, exercise_id, exercise:exercises(name)')
        .in('macrocycle_id', ids)
        .order('id')
        .range(from, to),
    )) as unknown as TrackedRow[];

    const trackedByCycle = new Map<string, TrackedRow[]>();
    for (const t of trackedRows) {
      const arr = trackedByCycle.get(t.macrocycle_id);
      if (arr) arr.push(t);
      else trackedByCycle.set(t.macrocycle_id, [t]);
    }

    const macroWeekIds = Array.from(new Set(eligible.map(e => e.currentWeekId)));
    const weekPlanIds = Array.from(new Set(eligible.map(e => e.weekPlanId)));

    const [targetRows, plannedRows] = await Promise.all([
      fetchByIds(macroWeekIds, (ids, from, to) =>
        supabase
          .from('macro_targets')
          .select('macro_week_id, tracked_exercise_id, target_reps')
          .in('macro_week_id', ids)
          .order('macro_week_id')
          .order('tracked_exercise_id')
          .range(from, to),
      ),
      fetchByIds(weekPlanIds, (ids, from, to) =>
        supabase
          .from('planned_exercises')
          .select('weekplan_id, exercise_id, summary_total_reps')
          .in('weekplan_id', ids)
          .order('id')
          .range(from, to),
      ),
    ]);

    const targetRepsByKey = new Map<string, number>();
    for (const t of targetRows) {
      targetRepsByKey.set(`${t.macro_week_id}|${t.tracked_exercise_id}`, t.target_reps || 0);
    }
    const plannedRepsByKey = new Map<string, number>();
    for (const pe of plannedRows) {
      const key = `${pe.weekplan_id}|${pe.exercise_id}`;
      plannedRepsByKey.set(key, (plannedRepsByKey.get(key) ?? 0) + (pe.summary_total_reps || 0));
    }

    const alignments: MacroAlignment[] = [];
    for (const e of eligible) {
      for (const tracked of trackedByCycle.get(e.macrocycle.id) ?? []) {
        const targetKey = `${e.currentWeekId}|${tracked.id}`;
        if (!targetRepsByKey.has(targetKey)) continue;
        const targetReps = targetRepsByKey.get(targetKey)!;
        if (targetReps === 0) continue;

        const totalPlannedReps = plannedRepsByKey.get(`${e.weekPlanId}|${tracked.exercise_id}`) ?? 0;

        let status: 'on-target' | 'close' | 'off-target' = 'off-target';
        if (totalPlannedReps === targetReps) {
          status = 'on-target';
        } else if (Math.abs(totalPlannedReps - targetReps) <= targetReps * 0.15) {
          status = 'close';
        }

        alignments.push({
          athleteId: e.athlete.id,
          athleteName: e.athlete.name,
          exerciseName: tracked.exercise?.name ?? '',
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

    if (!eventsData || eventsData.length === 0) {
      setUpcomingEvents([]);
      return;
    }

    type EventAthleteRow = { event_id: string; athlete: { name: string } | null };
    const links = (await fetchByIds(eventsData.map(e => e.id), (ids, from, to) =>
      supabase
        .from('event_athletes')
        .select('event_id, athlete:athletes(name)')
        .in('event_id', ids)
        .order('event_id')
        .order('athlete_id')
        .range(from, to),
    )) as unknown as EventAthleteRow[];

    const namesByEvent = new Map<string, string[]>();
    for (const link of links) {
      const name = link.athlete?.name ?? '';
      if (!name) continue;
      const arr = namesByEvent.get(link.event_id);
      if (arr) arr.push(name);
      else namesByEvent.set(link.event_id, [name]);
    }

    const events: UpcomingEvent[] = eventsData.map(event => {
      const athleteNames = (namesByEvent.get(event.id) ?? []).join(', ') || 'All Athletes';
      const eventDate = new Date(event.event_date);
      eventDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const weeksUntil = Math.ceil(daysUntil / 7);
      return {
        date: eventDate,
        athleteName: athleteNames,
        note: event.name,
        daysUntil,
        weeksUntil,
        eventData: event,
      };
    });

    setUpcomingEvents(events);
  }

  async function loadGroupStatuses(groups: TrainingGroup[], ctx: WeekPlanContext) {
    if (groups.length === 0) {
      setGroupStatuses([]);
      return;
    }

    type GroupMemberRow = { group_id: string; athlete: { id: string; name: string } | null };
    const memberRows = (await fetchByIds(groups.map(g => g.id), (ids, from, to) =>
      supabase
        .from('group_members')
        .select('group_id, athlete:athlete_id(id, name)')
        .in('group_id', ids)
        .is('left_at', null)
        .order('group_id')
        .order('athlete_id')
        .range(from, to),
    )) as unknown as GroupMemberRow[];

    const membersByGroup = new Map<string, { id: string; name: string }[]>();
    for (const row of memberRows) {
      if (!row.athlete?.id) continue;
      const entry = { id: row.athlete.id, name: row.athlete.name };
      const arr = membersByGroup.get(row.group_id);
      if (arr) arr.push(entry);
      else membersByGroup.set(row.group_id, [entry]);
    }

    const { weekStartISO, nextWeekStartISO, groupPlanByKey, plansWithExercises } = ctx;
    const statuses: GroupStatus[] = groups.map(group => {
      const memberList = membersByGroup.get(group.id) ?? [];
      const currentPlanId = groupPlanByKey.get(`${group.id}|${weekStartISO}`);
      const nextPlanId = groupPlanByKey.get(`${group.id}|${nextWeekStartISO}`);
      return {
        group,
        memberCount: memberList.length,
        members: memberList,
        currentWeekPlanned: currentPlanId ? plansWithExercises.has(currentPlanId) : false,
        nextWeekPlanned: nextPlanId ? plansWithExercises.has(nextPlanId) : false,
        currentWeekStart: weekStartISO,
        nextWeekStart: nextWeekStartISO,
      };
    });

    setGroupStatuses(statuses);
  }

  async function loadDashboardData() {
    try {
      setLoading(true);
      const ownerId = getOwnerId();

      // One access-scope resolution shared by the athlete and group fetches —
      // this used to run four times per refresh, each a multi-stage waterfall.
      const groupAccess = await resolveGroupAccess(ownerId);
      const [settingsData, accessible, accessibleGroups] = await Promise.all([
        loadSettings(),
        // Owned + shared (direct and via group cascade), active only.
        fetchAccessibleAthletes(ownerId, { activeOnly: true, groupAccess }),
        fetchAccessibleGroups(ownerId, groupAccess),
      ]);
      const athletes = accessible.athletes;
      // accessById covers ALL accessible athletes (including inactive) — the
      // activity feed keeps that wider scope, as before.
      const allAccessibleIds = Object.keys(accessible.accessById);
      const groups = accessibleGroups.groups;
      const athleteIds = athletes.map(a => a.id);
      const { weekStartISO, nextWeekStartISO } = getCurrentAndNextWeekStart();

      const [macros, ctx] = await Promise.all([
        resolveCurrentMacros(athleteIds),
        fetchWeekPlanContext(athleteIds, groups.map(g => g.id), weekStartISO, nextWeekStartISO),
      ]);

      await Promise.all([
        loadAthleteStatuses(settingsData, athletes, macros, ctx),
        loadActivityFeed(allAccessibleIds),
        loadMacroAlignments(athletes, macros, ctx),
        loadUpcomingEvents(),
        loadGroupStatuses(groups, ctx),
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
