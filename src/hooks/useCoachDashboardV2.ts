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
import type { BodyweightEntry, MacroPhase } from '../lib/database.types';

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
}): V2FlagId[] {
  const flags: V2FlagId[] = [];
  const { status, rawAvg, rawTrend, compTrend, lastDays } = args;

  if (rawAvg !== null && rawAvg < 8) flags.push('raw-drop');
  // also flag if RAW trend is monotonically decreasing across last 3 entries
  if (
    rawTrend.length >= 3 &&
    rawTrend[rawTrend.length - 1] < rawTrend[rawTrend.length - 2] &&
    rawTrend[rawTrend.length - 2] < rawTrend[rawTrend.length - 3] &&
    !flags.includes('raw-drop')
  ) {
    flags.push('raw-drop');
  }

  if (!status.currentWeekPlanned) flags.push('this-week-gap');
  if (!status.nextWeekPlanned) flags.push('next-week-gap');

  const lastComp = compTrend.length ? compTrend[compTrend.length - 1] : null;
  if (lastComp !== null && lastComp < 85) flags.push('compliance');

  if (lastDays !== null && lastDays >= 5) flags.push('missed-recent');

  return flags;
}

export function useCoachDashboardV2() {
  const base = useCoachDashboard();
  const [enrichments, setEnrichments] = useState<Record<string, AthleteEnrichment>>({});
  const [enrichLoading, setEnrichLoading] = useState(false);

  const loadEnrichments = useCallback(async (statuses: AthleteStatus[], events: UpcomingEvent[]) => {
    if (!statuses.length) {
      setEnrichments({});
      return;
    }
    setEnrichLoading(true);
    try {
      const ownerId = getOwnerId();
      const athleteIds = statuses.map(s => s.athlete.id);

      // 1) Latest non-planned session per athlete for RAW pillars.
      // We pull a window of recent sessions and pick the latest one per athlete.
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
      const rawTrendByAthlete: Record<string, number[]> = {};
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
        if (s.raw_total !== null) {
          (rawTrendByAthlete[s.athlete_id] ||= []).push(s.raw_total);
        }
      });
      // collected newest-first; reverse to chronological for the sparkline
      Object.keys(rawTrendByAthlete).forEach(k => {
        rawTrendByAthlete[k] = rawTrendByAthlete[k].slice(0, 4).reverse();
      });

      // 2) Bodyweight entries (last 35 days covers 28d MA)
      const bwSince = new Date();
      bwSince.setDate(bwSince.getDate() - 35);
      const trackedIds = statuses
        .filter(s => s.athlete.track_bodyweight)
        .map(s => s.athlete.id);
      let bwRows: BodyweightEntry[] = [];
      if (trackedIds.length) {
        const { data } = await supabase
          .from('bodyweight_entries')
          .select('*')
          .in('athlete_id', trackedIds)
          .gte('date', bwSince.toISOString().slice(0, 10))
          .order('date', { ascending: true });
        bwRows = (data || []) as BodyweightEntry[];
      }
      const bwByAthlete: Record<string, BodyweightEntry[]> = {};
      bwRows.forEach(e => { (bwByAthlete[e.athlete_id] ||= []).push(e); });

      // 3) 4-week compliance trend per athlete (reuse useAnalysis helper)
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const compEntries = await Promise.all(
        statuses.map(async (s) => {
          const aggs = await fetchWeeklyAggregates({
            athleteId: s.athlete.id, startDate, endDate,
          });
          return [s.athlete.id, aggs.slice(-4).map(a => a.complianceReps)] as const;
        }),
      );
      const compByAthlete: Record<string, number[]> = {};
      compEntries.forEach(([id, vals]) => { compByAthlete[id] = vals; });

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

      // 5) Map upcoming events to athletes via event_athletes
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
        const bw = computeBwSummary(bwByAthlete[s.athlete.id] || []);
        const phase = resolvePhase(s);
        const flags = deriveFlags({
          status: s, rawAvg: s.rawAverage, rawTrend, compTrend, lastDays,
        });
        next[s.athlete.id] = {
          rawPillars, rawTrend, compTrend, bw,
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

  // When statuses/events change, reload the enrichment layer.
  useEffect(() => {
    loadEnrichments(base.athleteStatuses, base.upcomingEvents);
  }, [base.athleteStatuses, base.upcomingEvents, loadEnrichments]);

  const getEnrichment = useCallback(
    (athleteId: string): AthleteEnrichment => enrichments[athleteId] || EMPTY_ENRICHMENT,
    [enrichments],
  );

  const totalFlagged = useMemo(
    () => base.athleteStatuses.filter(s => (enrichments[s.athlete.id]?.flags.length || 0) > 0).length,
    [base.athleteStatuses, enrichments],
  );

  return {
    ...base,
    enrichments,
    enrichLoading,
    getEnrichment,
    totalFlagged,
  };
}
