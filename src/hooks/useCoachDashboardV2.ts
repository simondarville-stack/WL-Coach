import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type {
  Athlete,
  MacroCycle,
  MacroWeek,
  GeneralSettings,
  Event,
  TrainingGroup,
} from '../lib/database.types';
import { getCurrentAndNextWeekStart, findCurrentMacroWeek } from '../lib/weekUtils';
import { computeRawAverage } from '../lib/calculations';

/** Supabase nested join shapes for the dashboard macro query */
interface MacroWeekJoin {
  id: string;
  week_number: number;
  total_reps_target: number | null;
  week_type: string | null;
  week_start?: string; // computed locally
  [key: string]: unknown;
}

interface MacroPhaseJoin {
  id: string;
  name: string;
  color: string | null;
  start_week_number: number;
  end_week_number: number;
}

interface MacroCycleWithRelations extends Omit<MacroCycle, 'owner_id'> {
  owner_id: string;
  macro_weeks: MacroWeekJoin[];
  macro_phases: MacroPhaseJoin[];
}

/** Supabase nested join shape for events query */
interface EventAthleteJoin {
  athlete_id: string;
}

interface EventWithAthletes extends Omit<Event, 'id'> {
  id: string;
  event_athletes: EventAthleteJoin[];
}

export interface AthleteSnapshot {
  athlete: Athlete;
  macrocycle: MacroCycle | null;
  macroWeek: MacroWeek | null;
  totalMacroWeeks: number;
  phaseName: string | null;
  phaseColor: string | null;
  lastTrainingDate: Date | null;
  latestRaw: number | null;
  rawAverage: number | null;
  latestBodyweight: number | null;
  bodyweightTrend: 'up' | 'down' | 'stable' | null;
  currentWeekPlanned: boolean;
  nextWeekPlanned: boolean;
  currentWeekReps: number;
  currentWeekTonnage: number;
  targetReps: number | null;
  sessionRpe: number | null;
  compliancePct: number | null;
  groupNames: string[];
}

export interface WeeklyOverview {
  weekStart: string;
  athletesPlanned: number;
  athletesNotPlanned: number;
  groupsPlanned: number;
  groupsNotPlanned: number;
}

export interface UpcomingEventV2 {
  event: Event;
  athleteNames: string[];
  daysUntil: number;
}

export interface RecentSession {
  athleteName: string;
  athleteId: string;
  date: string;
  status: string;
  rawTotal: number | null;
  sessionRpe: number | null;
  dayIndex: number;
  weekStart: string;
}

export interface AttentionItem {
  athleteId: string;
  athleteName: string;
  type: 'no_plan' | 'inactive' | 'low_raw' | 'low_compliance' | 'off_target';
  message: string;
  severity: 'warning' | 'alert';
}

export function useCoachDashboardV2() {
  const [athletes, setAthletes] = useState<AthleteSnapshot[]>([]);
  const [weekOverview, setWeekOverview] = useState<WeeklyOverview | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEventV2[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const ownerId = getOwnerId();
      const { weekStartISO, nextWeekStartISO } = getCurrentAndNextWeekStart();

      const [settingsRes, athletesRes, groupsRes] = await Promise.all([
        supabase.from('general_settings').select('*').eq('owner_id', ownerId).maybeSingle(),
        supabase.from('athletes').select('*').eq('owner_id', ownerId).eq('is_active', true).order('name'),
        supabase.from('training_groups').select('*').eq('owner_id', ownerId).order('name'),
      ]);
      const groupIds = (groupsRes.data || []).map(g => g.id);
      const membersRes = groupIds.length > 0
        ? await supabase.from('group_members').select('group_id, athlete_id').is('left_at', null).in('group_id', groupIds)
        : { data: [] };

      const s = settingsRes.data;
      setSettings(s);
      const activeAthletes: Athlete[] = athletesRes.data || [];
      const groups: TrainingGroup[] = groupsRes.data || [];
      const members = membersRes.data || [];

      const athleteGroupMap = new Map<string, string[]>();
      const groupNameMap = new Map<string, string>();
      for (const g of groups) groupNameMap.set(g.id, g.name);
      for (const m of members) {
        const list = athleteGroupMap.get(m.athlete_id) || [];
        const gName = groupNameMap.get(m.group_id);
        if (gName) list.push(gName);
        athleteGroupMap.set(m.athlete_id, list);
      }

      const rawDays = s?.raw_average_days || 7;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rawDays);
      const cutoffISO = cutoffDate.toISOString().split('T')[0];

      const athleteIds = activeAthletes.map(a => a.id);

      const [macrosRes, sessionsRes, plansRes, bwRes] = await Promise.all([
        supabase.from('macrocycles').select('*, macro_weeks(*), macro_phases(*)').eq('owner_id', ownerId).eq('is_active', true).in('athlete_id', athleteIds.length > 0 ? athleteIds : ['__none__']) as unknown as Promise<{ data: MacroCycleWithRelations[] | null; error: unknown }>,
        supabase.from('training_log_sessions').select('athlete_id, date, status, raw_total, session_rpe, day_index, week_start').eq('owner_id', ownerId).in('athlete_id', athleteIds.length > 0 ? athleteIds : ['__none__']).gte('date', cutoffISO).order('date', { ascending: false }),
        supabase.from('week_plans').select('athlete_id, group_id, is_group_plan, week_start, id').eq('owner_id', ownerId).in('week_start', [weekStartISO, nextWeekStartISO]),
        supabase.from('bodyweight_entries').select('athlete_id, date, weight_kg').in('athlete_id', athleteIds.length > 0 ? athleteIds : ['__none__']).order('date', { ascending: false }).limit(200),
      ]);

      const macros: MacroCycleWithRelations[] = (macrosRes as unknown as { data: MacroCycleWithRelations[] | null }).data || [];
      const sessions = sessionsRes.data || [];
      const plans = plansRes.data || [];
      const bwEntries = bwRes.data || [];

      const planIds = plans.map(p => p.id);
      const { data: plannedExercises } = planIds.length > 0
        ? await supabase.from('planned_exercises').select('weekplan_id, summary_total_reps, summary_total_sets, summary_highest_load, summary_avg_load').in('weekplan_id', planIds)
        : { data: [] };
      const peList = plannedExercises || [];

      const planExerciseMap = new Map<string, { reps: number; tonnage: number; count: number }>();
      for (const pe of peList) {
        const existing = planExerciseMap.get(pe.weekplan_id) || { reps: 0, tonnage: 0, count: 0 };
        existing.reps += pe.summary_total_reps || 0;
        existing.tonnage += (pe.summary_total_reps || 0) * (pe.summary_avg_load || 0);
        existing.count += 1;
        planExerciseMap.set(pe.weekplan_id, existing);
      }

      const macroByAthlete = new Map<string, typeof macros[0]>();
      for (const m of macros) if (m.athlete_id) macroByAthlete.set(m.athlete_id, m);

      const sessionsByAthlete = new Map<string, typeof sessions>();
      for (const sess of sessions) {
        const list = sessionsByAthlete.get(sess.athlete_id) || [];
        list.push(sess);
        sessionsByAthlete.set(sess.athlete_id, list);
      }

      const bwByAthlete = new Map<string, typeof bwEntries>();
      for (const bw of bwEntries) {
        const list = bwByAthlete.get(bw.athlete_id) || [];
        list.push(bw);
        bwByAthlete.set(bw.athlete_id, list);
      }

      const athletePlans = new Map<string, { current: string | null; next: string | null }>();
      for (const p of plans) {
        if (!p.athlete_id || p.is_group_plan) continue;
        const entry = athletePlans.get(p.athlete_id) || { current: null, next: null };
        if (p.week_start === weekStartISO) entry.current = p.id;
        if (p.week_start === nextWeekStartISO) entry.next = p.id;
        athletePlans.set(p.athlete_id, entry);
      }

      const attention: AttentionItem[] = [];
      const snapshots: AthleteSnapshot[] = [];

      for (const athlete of activeAthletes) {
        const macro = macroByAthlete.get(athlete.id) || null;
        let macroWeek: MacroWeek | null = null;
        let totalMacroWeeks = 0;
        let phaseName: string | null = null;
        let phaseColor: string | null = null;
        let targetReps: number | null = null;

        if (macro) {
          const mw: MacroWeekJoin[] = macro.macro_weeks || [];
          totalMacroWeeks = mw.length;
          macroWeek = findCurrentMacroWeek(mw.map(w => ({
            ...w,
            week_start: (() => {
              const d = new Date(macro.start_date + 'T00:00:00');
              d.setDate(d.getDate() + (w.week_number - 1) * 7);
              return d.toISOString().split('T')[0];
            })(),
          })));
          if (macroWeek) {
            const macroWeekJoin = mw.find(w => w.id === macroWeek!.id);
            targetReps = macroWeekJoin?.total_reps_target ?? null;
            const phases: MacroPhaseJoin[] = macro.macro_phases || [];
            const currentWeekNumber = macroWeekJoin?.week_number ?? 0;
            const phase = phases.find(p =>
              currentWeekNumber >= p.start_week_number &&
              currentWeekNumber <= p.end_week_number
            );
            if (phase) {
              phaseName = phase.name;
              phaseColor = phase.color;
            }
          }
        }

        const aSessions = sessionsByAthlete.get(athlete.id) || [];
        const completedSessions = aSessions.filter(s => s.status === 'completed');
        const lastTraining = completedSessions.length > 0 ? new Date(completedSessions[0].date) : null;
        const rawTotals = completedSessions.map(s => s.raw_total).filter((r): r is number => r !== null);
        const latestRaw = rawTotals.length > 0 ? rawTotals[0] : null;
        const rawAverage = computeRawAverage(rawTotals);
        const rpeValues = completedSessions.map(s => s.session_rpe).filter((r): r is number => r !== null);
        const sessionRpe = rpeValues.length > 0 ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : null;

        const bws = bwByAthlete.get(athlete.id) || [];
        const latestBw = bws.length > 0 ? bws[0].weight_kg : null;
        let bwTrend: 'up' | 'down' | 'stable' | null = null;
        if (bws.length >= 3) {
          const recent3 = bws.slice(0, 3).reduce((s, b) => s + b.weight_kg, 0) / 3;
          const older = bws.length >= 6
            ? bws.slice(3, 6).reduce((s, b) => s + b.weight_kg, 0) / Math.min(3, bws.slice(3, 6).length)
            : null;
          if (older !== null) {
            const diff = recent3 - older;
            bwTrend = diff > 0.3 ? 'up' : diff < -0.3 ? 'down' : 'stable';
          }
        }

        const ap = athletePlans.get(athlete.id);
        const currentPlanId = ap?.current ?? null;
        const nextPlanId = ap?.next ?? null;
        const currentPlanData = currentPlanId ? planExerciseMap.get(currentPlanId) : null;
        const currentWeekPlanned = (currentPlanData?.count ?? 0) > 0;
        const nextWeekPlanned = nextPlanId ? (planExerciseMap.get(nextPlanId)?.count ?? 0) > 0 : false;

        let compliancePct: number | null = null;
        if (currentWeekPlanned && currentPlanData && currentPlanData.reps > 0) {
          const performedReps = completedSessions
            .filter(s => s.week_start === weekStartISO)
            .length;
          if (performedReps > 0) {
            compliancePct = Math.min(100, Math.round((performedReps / currentPlanData.count) * 100));
          }
        }

        snapshots.push({
          athlete,
          macrocycle: macro ? { ...macro, macro_weeks: undefined, macro_phases: undefined } as unknown as MacroCycle : null,
          macroWeek,
          totalMacroWeeks,
          phaseName,
          phaseColor,
          lastTrainingDate: lastTraining,
          latestRaw,
          rawAverage,
          latestBodyweight: latestBw,
          bodyweightTrend: bwTrend,
          currentWeekPlanned,
          nextWeekPlanned,
          currentWeekReps: currentPlanData?.reps ?? 0,
          currentWeekTonnage: currentPlanData?.tonnage ?? 0,
          targetReps,
          sessionRpe,
          compliancePct,
          groupNames: athleteGroupMap.get(athlete.id) || [],
        });

        if (!currentWeekPlanned) {
          attention.push({
            athleteId: athlete.id,
            athleteName: athlete.name,
            type: 'no_plan',
            message: 'No plan for this week',
            severity: 'warning',
          });
        }
        if (!lastTraining || (Date.now() - lastTraining.getTime()) > 7 * 86400000) {
          attention.push({
            athleteId: athlete.id,
            athleteName: athlete.name,
            type: 'inactive',
            message: lastTraining ? `Last trained ${Math.floor((Date.now() - lastTraining.getTime()) / 86400000)} days ago` : 'Never logged training',
            severity: lastTraining ? 'warning' : 'alert',
          });
        }
        if (rawAverage !== null && rawAverage < 7) {
          attention.push({
            athleteId: athlete.id,
            athleteName: athlete.name,
            type: 'low_raw',
            message: `Low RAW average: ${rawAverage.toFixed(1)}`,
            severity: rawAverage < 5 ? 'alert' : 'warning',
          });
        }
      }

      setAthletes(snapshots);
      setAttentionItems(attention);

      const groupPlans = plans.filter(p => p.is_group_plan);
      const groupsPlanned = new Set(groupPlans.filter(p => p.week_start === weekStartISO && planExerciseMap.get(p.id)?.count).map(p => p.group_id));
      const groupsPlannedNext = new Set(groupPlans.filter(p => p.week_start === nextWeekStartISO && planExerciseMap.get(p.id)?.count).map(p => p.group_id));

      setWeekOverview({
        weekStart: weekStartISO,
        athletesPlanned: snapshots.filter(a => a.currentWeekPlanned).length,
        athletesNotPlanned: snapshots.filter(a => !a.currentWeekPlanned).length,
        groupsPlanned: groupsPlanned.size,
        groupsNotPlanned: groups.length - groupsPlanned.size,
      });

      const eventsRes = await supabase
        .from('events')
        .select('*, event_athletes(athlete_id)')
        .eq('owner_id', ownerId)
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date')
        .limit(10);
      const events: EventWithAthletes[] = (eventsRes.data || []) as unknown as EventWithAthletes[];
      const athleteNameMap = new Map(activeAthletes.map(a => [a.id, a.name]));

      setUpcomingEvents(events.map(ev => ({
        event: ev as unknown as Event,
        athleteNames: (ev.event_athletes || []).map((ea: EventAthleteJoin) => athleteNameMap.get(ea.athlete_id) || 'Unknown'),
        daysUntil: Math.ceil((new Date(ev.event_date).getTime() - Date.now()) / 86400000),
      })));

      const recentRes = await supabase
        .from('training_log_sessions')
        .select('athlete_id, date, status, raw_total, session_rpe, day_index, week_start')
        .eq('owner_id', ownerId)
        .order('date', { ascending: false })
        .limit(15);
      setRecentSessions((recentRes.data || []).map(s => ({
        athleteName: athleteNameMap.get(s.athlete_id) || 'Unknown',
        athleteId: s.athlete_id,
        date: s.date,
        status: s.status,
        rawTotal: s.raw_total,
        sessionRpe: s.session_rpe,
        dayIndex: s.day_index,
        weekStart: s.week_start,
      })));

    } catch (err) {
      console.error('Dashboard V2 load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    athletes,
    weekOverview,
    upcomingEvents,
    recentSessions,
    attentionItems,
    settings,
    loading,
    loadDashboard,
  };
}
