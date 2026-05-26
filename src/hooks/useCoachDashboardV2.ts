// Wraps the existing useCoachDashboard hook and layers on the per-athlete
// enrichment the v2 dashboard needs: RAW pillar breakdown, bodyweight delta
// vs 7d/28d MA, weekly compliance trend, phase name/color, athlete-scoped
// upcoming events, and computed attention flags.
//
// Kept separate from useCoachDashboard so the v1 dashboard is untouched and
// the v2 fetch surface stays a single import.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import { fetchWeeklyAggregates } from './useAnalysis';
import {
  useCoachDashboard,
  type AthleteStatus,
  type UpcomingEvent,
} from './useCoachDashboard';
import type { BodyweightEntry, MacroPhase, TrainingGroup } from '../lib/database.types';
import {
  DEFAULT_DASHBOARD_FLAGS,
  loadDashboardFlagSettings,
  type DashboardFlagSettings,
} from '../lib/dashboardFlagSettings';

/** How many weeks of compliance + RAW history we pull for the in-row
 *  sparkline and the planned-vs-actual chart. The chart renders as many
 *  weeks as it has data for. */
const HISTORY_WEEKS = 12;
const SETTINGS_EVENT = 'emos:dashboard-flag-settings-changed';

export type V2FlagId =
  | 'raw-drop'
  | 'this-week-gap'
  | 'next-week-gap'
  | 'compliance'
  | 'missed-recent';

export interface RawPillars {
  sleep: number | null;
  physical: number | null;
  mood: number | null;
  nutrition: number | null;
  total: number | null;
}

export interface BwSummary {
  now: number;
  ma7: number;
  ma28: number;
  delta: number;
}

export interface AthleteEnrichment {
  rawPillars: RawPillars | null;
  rawTrend: number[];
  compTrend: number[];
  /** Weekly planned rep totals from the same window as compTrend.
   *  Plotted as the "Planned" baseline in the Reps view. */
  repsPlannedTrend: number[];
  /** Weekly performed rep totals — actually-logged sets summed. */
  repsActualTrend: number[];
  bw: BwSummary | null;
  phaseName: string | null;
  phaseColor: string | null;
  athleteEvents: UpcomingEvent[];
  flags: V2FlagId[];
}

const EMPTY_ENRICHMENT: AthleteEnrichment = {
  rawPillars: null,
  rawTrend: [],
  compTrend: [],
  repsPlannedTrend: [],
  repsActualTrend: [],
  bw: null,
  phaseName: null,
  phaseColor: null,
  athleteEvents: [],
  flags: [],
};

function average(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function computeBwSummary(entries: BodyweightEntry[]): BwSummary | null {
  if (!entries.length) return null;
  // entries arrive ascending by date in v1 dashboard; sort defensively
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const now = last.weight_kg;

  const cutoff7 = new Date();
  cutoff7.setDate(cutoff7.getDate() - 7);
  const cutoff28 = new Date();
  cutoff28.setDate(cutoff28.getDate() - 28);

  const last7 = sorted.filter(e => new Date(e.date) >= cutoff7).map(e => e.weight_kg);
  const last28 = sorted.filter(e => new Date(e.date) >= cutoff28).map(e => e.weight_kg);

  const ma7 = last7.length ? average(last7) : now;
  const ma28 = last28.length ? average(last28) : now;
  return { now, ma7, ma28, delta: now - ma7 };
}

function deriveFlags(args: {
  status: AthleteStatus;
  rawAvg: number | null;
  rawTrend: number[];
  compTrend: number[];
  lastDays: number | null;
  settings: DashboardFlagSettings;
}): V2FlagId[] {
  const flags: V2FlagId[] = [];
  const { status, rawAvg, rawTrend, compTrend, lastDays, settings } = args;
  const en = settings.enabled;

  if (en['raw-drop']) {
    let trip = rawAvg !== null && rawAvg < settings.rawDropThreshold;
    if (
      !trip && settings.rawDropTrendEnabled &&
      rawTrend.length >= 3 &&
      rawTrend[rawTrend.length - 1] < rawTrend[rawTrend.length - 2] &&
      rawTrend[rawTrend.length - 2] < rawTrend[rawTrend.length - 3]
    ) trip = true;
    if (trip) flags.push('raw-drop');
  }

  if (en['this-week-gap'] && !status.currentWeekPlanned) {
    flags.push('this-week-gap');
  }

  if (en['next-week-gap'] && !status.nextWeekPlanned) {
    // Only flag if next week starts within the configured window.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeekStart = new Date(status.nextWeekStart + 'T00:00:00');
    const days = Math.ceil((nextWeekStart.getTime() - today.getTime()) / 86_400_000);
    if (days < settings.nextWeekGapDaysBeforeWindow) flags.push('next-week-gap');
  }

  if (en['compliance']) {
    const lastComp = compTrend.length ? compTrend[compTrend.length - 1] : null;
    if (lastComp !== null && lastComp < settings.complianceThreshold) {
      flags.push('compliance');
    }
  }

  if (en['missed-recent'] && lastDays !== null && lastDays >= settings.missedRecentDays) {
    flags.push('missed-recent');
  }

  return flags;
}

export function useCoachDashboardV2() {
  const base = useCoachDashboard();
  const [enrichments, setEnrichments] = useState<Record<string, AthleteEnrichment>>({});
  const [athleteGroupMap, setAthleteGroupMap] = useState<Record<string, TrainingGroup[]>>({});
  const [enrichLoading, setEnrichLoading] = useState(false);
  // Read once per loadEnrichments cycle. We also listen for changes so the
  // dashboard recomputes flags when the coach edits thresholds in settings.
  const [flagSettings, setFlagSettings] = useState<DashboardFlagSettings>(
    () => loadDashboardFlagSettings(),
  );

  useEffect(() => {
    const onChange = () => setFlagSettings(loadDashboardFlagSettings());
    window.addEventListener(SETTINGS_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const loadEnrichments = useCallback(async (
    statuses: AthleteStatus[],
    events: UpcomingEvent[],
    settings: DashboardFlagSettings,
  ) => {
    if (!statuses.length) {
      setEnrichments({});
      setAthleteGroupMap({});
      return;
    }
    setEnrichLoading(true);
    try {
      const ownerId = getOwnerId();
      const athleteIds = statuses.map(s => s.athlete.id);

      // 1) Latest non-planned session per athlete for RAW pillars only —
      // the per-week RAW trend now comes from fetchWeeklyAggregates below
      // so it aligns with the compliance/reps trends and weekly labels.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data: recentSessions } = await supabase
        .from('training_log_sessions')
        .select('athlete_id, date, raw_sleep, raw_physical, raw_mood, raw_nutrition, raw_total, status')
        .in('athlete_id', athleteIds)
        .neq('status', 'planned')
        .gte('date', since.toISOString().slice(0, 10))
        .order('date', { ascending: false });

      const pillarsByAthlete: Record<string, RawPillars> = {};
      (recentSessions || []).forEach(s => {
        if (!pillarsByAthlete[s.athlete_id] && s.raw_total !== null) {
          pillarsByAthlete[s.athlete_id] = {
            sleep: s.raw_sleep,
            physical: s.raw_physical,
            mood: s.raw_mood,
            nutrition: s.raw_nutrition,
            total: s.raw_total,
          };
        }
      });

      // 2) Bodyweight entries (last 35 days covers 28d MA).
      // Source of truth is training_log_sessions.bodyweight_kg — that's
      // where the athlete app writes when they fill the BW field on
      // Today, and it's also what the athlete-side profile chart reads
      // via fetchBodyweightHistory. The legacy bodyweight_entries table
      // is no longer written to, so reading from it leaves the
      // dashboard's BW delta perpetually empty.
      const bwSince = new Date();
      bwSince.setDate(bwSince.getDate() - 35);
      const trackedIds = statuses
        .filter(s => s.athlete.track_bodyweight)
        .map(s => s.athlete.id);
      let bwRows: BodyweightEntry[] = [];
      if (trackedIds.length) {
        const { data } = await supabase
          .from('training_log_sessions')
          .select('id, athlete_id, date, bodyweight_kg, created_at')
          .in('athlete_id', trackedIds)
          .not('bodyweight_kg', 'is', null)
          .gte('date', bwSince.toISOString().slice(0, 10))
          .order('date', { ascending: true });
        bwRows = ((data || []) as Array<{
          id: string;
          athlete_id: string;
          date: string;
          bodyweight_kg: number;
          created_at: string;
        }>).map(r => ({
          id: r.id,
          athlete_id: r.athlete_id,
          date: r.date,
          weight_kg: r.bodyweight_kg,
          created_at: r.created_at,
        }));
      }
      const bwByAthlete: Record<string, BodyweightEntry[]> = {};
      bwRows.forEach(e => { (bwByAthlete[e.athlete_id] ||= []).push(e); });

      // 3) Compliance / RAW / reps trends per athlete over the full history
      // window. We compute all three from the same weekly aggregates so the
      // chart's x-axis is consistent regardless of which metric is selected.
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - HISTORY_WEEKS * 7 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const compEntries = await Promise.all(
        statuses.map(async (s) => {
          const aggs = await fetchWeeklyAggregates({
            athleteId: s.athlete.id, startDate, endDate,
          });
          const window = aggs.slice(-HISTORY_WEEKS);
          return [
            s.athlete.id,
            {
              comp: window.map(a => a.complianceReps),
              raw: window.map(a => a.rawTotal ?? 0),
              repsPlanned: window.map(a => a.plannedReps),
              repsActual: window.map(a => a.performedReps),
            },
          ] as const;
        }),
      );
      const compByAthlete: Record<string, number[]> = {};
      const rawTrendByAthlete: Record<string, number[]> = {};
      const repsPlannedByAthlete: Record<string, number[]> = {};
      const repsActualByAthlete: Record<string, number[]> = {};
      compEntries.forEach(([id, vals]) => {
        compByAthlete[id] = vals.comp;
        rawTrendByAthlete[id] = vals.raw;
        repsPlannedByAthlete[id] = vals.repsPlanned;
        repsActualByAthlete[id] = vals.repsActual;
      });

      // 4) Phase metadata per athlete.
      //
      // Phases are defined as week-number ranges on a macrocycle
      // (start_week_number..end_week_number), not as a direct FK on
      // macro_weeks — so we fetch all phases for every athlete's active
      // macrocycle and resolve the current phase per athlete by matching
      // the current macro-week's week_number into the range.
      const macrocycleIds = Array.from(
        new Set(
          statuses
            .map(s => s.currentMacrocycle?.id)
            .filter((id): id is string => !!id),
        ),
      );
      let phasesByCycle: Record<string, MacroPhase[]> = {};
      if (macrocycleIds.length) {
        const { data } = await supabase
          .from('macro_phases')
          .select('*')
          .in('macrocycle_id', macrocycleIds)
          .eq('owner_id', ownerId)
          .order('position');
        const phases = (data || []) as MacroPhase[];
        phases.forEach(p => { (phasesByCycle[p.macrocycle_id] ||= []).push(p); });
      }
      const resolvePhase = (status: AthleteStatus): MacroPhase | null => {
        const macroId = status.currentMacrocycle?.id;
        const weekNumber = status.currentMacroWeek?.week_number;
        if (!macroId || weekNumber === undefined || weekNumber === null) return null;
        const phases = phasesByCycle[macroId];
        if (!phases) return null;
        // Prefer the direct FK if it happens to be populated; otherwise resolve
        // by week-number range.
        const directId = status.currentMacroWeek?.phase_id;
        if (directId) {
          const direct = phases.find(p => p.id === directId);
          if (direct) return direct;
        }
        return phases.find(
          p => p.start_week_number <= weekNumber && p.end_week_number >= weekNumber,
        ) || null;
      };

      // 5a) Group memberships per athlete — the v2 dashboard uses this for the
      //     "Section by group" toggle and the Groups tab. We fetch active
      //     memberships (left_at IS NULL) and join the group rows.
      const { data: memberRows } = await supabase
        .from('group_members')
        .select('athlete_id, group:training_groups(id, owner_id, name, description, created_at, updated_at)')
        .in('athlete_id', athleteIds)
        .is('left_at', null);
      type MemberRow = { athlete_id: string; group: TrainingGroup | null };
      const groupsByAthlete: Record<string, TrainingGroup[]> = {};
      (memberRows as unknown as MemberRow[] | null || []).forEach(row => {
        if (!row.group) return;
        (groupsByAthlete[row.athlete_id] ||= []).push(row.group);
      });
      setAthleteGroupMap(groupsByAthlete);

      // 5b) Map upcoming events to athletes via event_athletes
      const eventIds = events.map(e => e.eventData.id);
      const athleteEventMap: Record<string, UpcomingEvent[]> = {};
      if (eventIds.length) {
        const { data: links } = await supabase
          .from('event_athletes')
          .select('event_id, athlete_id')
          .in('event_id', eventIds);
        const byEvent: Record<string, string[]> = {};
        (links || []).forEach(l => { (byEvent[l.event_id] ||= []).push(l.athlete_id); });
        events.forEach(ev => {
          const ids = byEvent[ev.eventData.id] || [];
          // If no athletes linked, treat as "everyone" — coach can still see it on the row
          const recipients = ids.length ? ids : athleteIds;
          recipients.forEach(aid => {
            if (!athleteIds.includes(aid)) return;
            (athleteEventMap[aid] ||= []).push(ev);
          });
        });
        // sort each list by daysUntil
        Object.keys(athleteEventMap).forEach(k => {
          athleteEventMap[k].sort((a, b) => a.daysUntil - b.daysUntil);
        });
      }

      // 6) Assemble enrichment per athlete + derive flags
      const next: Record<string, AthleteEnrichment> = {};
      statuses.forEach(s => {
        const lastDays = s.lastTrainingDate
          ? Math.floor((Date.now() - s.lastTrainingDate.getTime()) / 86_400_000)
          : null;
        const rawPillars = pillarsByAthlete[s.athlete.id] || null;
        const rawTrend = rawTrendByAthlete[s.athlete.id] || [];
        const compTrend = compByAthlete[s.athlete.id] || [];
        const repsPlannedTrend = repsPlannedByAthlete[s.athlete.id] || [];
        const repsActualTrend = repsActualByAthlete[s.athlete.id] || [];
        const bw = computeBwSummary(bwByAthlete[s.athlete.id] || []);
        const phase = resolvePhase(s);
        const flags = deriveFlags({
          status: s, rawAvg: s.rawAverage, rawTrend, compTrend, lastDays, settings,
        });
        next[s.athlete.id] = {
          rawPillars, rawTrend, compTrend, repsPlannedTrend, repsActualTrend, bw,
          phaseName: phase?.name || null,
          phaseColor: phase?.color || null,
          athleteEvents: athleteEventMap[s.athlete.id] || [],
          flags,
        };
      });
      setEnrichments(next);
    } finally {
      setEnrichLoading(false);
    }
  }, []);

  // Reload the foundational dashboard data once on mount + every minute, same
  // cadence as v1 so the two stay in sync if someone toggles between them.
  useEffect(() => {
    base.loadDashboardData();
    const id = setInterval(() => base.loadDashboardData(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When statuses/events/settings change, reload the enrichment layer so
  // flags reflect the freshest config without a manual refresh.
  useEffect(() => {
    loadEnrichments(base.athleteStatuses, base.upcomingEvents, flagSettings);
  }, [base.athleteStatuses, base.upcomingEvents, flagSettings, loadEnrichments]);

  const getEnrichment = useCallback(
    (athleteId: string): AthleteEnrichment => enrichments[athleteId] || EMPTY_ENRICHMENT,
    [enrichments],
  );

  const totalFlagged = useMemo(
    () => base.athleteStatuses.filter(s => (enrichments[s.athlete.id]?.flags.length || 0) > 0).length,
    [base.athleteStatuses, enrichments],
  );

  const getAthleteGroups = useCallback(
    (athleteId: string): TrainingGroup[] => athleteGroupMap[athleteId] || [],
    [athleteGroupMap],
  );

  return {
    ...base,
    enrichments,
    enrichLoading,
    getEnrichment,
    athleteGroupMap,
    getAthleteGroups,
    totalFlagged,
    flagSettings,
  };
}

// Re-export so the consumer doesn't need to import from two places.
export { DEFAULT_DASHBOARD_FLAGS };
