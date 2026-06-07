// EMOS Analysis — monitoring & intelligence (Phase 5). Pure functions over a
// daily performed-load series. ACWR and Foster monotony/strain are computed on
// PERFORMED dated sessions only (planned abstract slots have no calendar date,
// REVIEW_PLAN inv-3). Thresholds are coach-configurable, never hardcoded — the
// defaults below are starting points, overridable from settings. These models
// are contested for OWL; the UI presents them as indicative.

import { isoAddDays, isoMonday } from '../dateUtils';
import type { AnalysisResult } from './types';

export interface DailyLoad {
  date: string; // YYYY-MM-DD
  load: number;
}

export interface AcwrThresholds {
  acuteDays: number; // default 7
  chronicDays: number; // default 28
  high: number; // flag ratio above (default 1.5)
  low: number; // flag ratio below (default 0.8)
}

export const DEFAULT_ACWR: AcwrThresholds = { acuteDays: 7, chronicDays: 28, high: 1.5, low: 0.8 };

export type AcwrFlag = 'low' | 'ok' | 'high' | null;

export interface AcwrPoint {
  date: string;
  acute: number; // mean daily load over the acute window
  chronic: number; // mean daily load over the chronic window
  ratio: number | null;
  flag: AcwrFlag;
}

/** Extract a sorted daily performed-load series from a `date`-grouped result. */
export function dailyLoadSeries(result: AnalysisResult, measureKey: string): DailyLoad[] {
  const dateIdx = result.rowDimensions.filter((a) => a !== 'state').indexOf('date');
  if (dateIdx < 0) return [];
  const out: DailyLoad[] = [];
  for (const rec of result.records) {
    const date = rec.row[dateIdx];
    if (!date || date === '(planned)' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const load = rec.values[measureKey];
    out.push({ date, load: typeof load === 'number' ? load : 0 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fill rest days with 0 so rolling windows count calendar days, not sessions. */
export function densifyDaily(series: DailyLoad[]): DailyLoad[] {
  if (series.length === 0) return [];
  const byDate = new Map(series.map((d) => [d.date, d.load]));
  const out: DailyLoad[] = [];
  let cur = series[0].date;
  const end = series[series.length - 1].date;
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    out.push({ date: cur, load: byDate.get(cur) ?? 0 });
    cur = isoAddDays(cur, 1);
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Acute:chronic workload ratio per day (only once the chronic window is full). */
export function acwr(series: DailyLoad[], t: AcwrThresholds = DEFAULT_ACWR): AcwrPoint[] {
  const days = densifyDaily(series);
  const loads = days.map((d) => d.load);
  const out: AcwrPoint[] = [];
  for (let i = 0; i < days.length; i++) {
    if (i + 1 < t.chronicDays) continue; // need a full chronic window
    const acute = mean(loads.slice(i - t.acuteDays + 1, i + 1));
    const chronic = mean(loads.slice(i - t.chronicDays + 1, i + 1));
    const ratio = chronic > 0 ? acute / chronic : null;
    const flag: AcwrFlag = ratio == null ? null : ratio > t.high ? 'high' : ratio < t.low ? 'low' : 'ok';
    out.push({ date: days[i].date, acute, chronic, ratio, flag });
  }
  return out;
}

export interface WeekMonotony {
  weekStart: string;
  weeklyLoad: number;
  monotony: number | null; // mean daily load ÷ SD (Foster)
  strain: number | null; // weeklyLoad × monotony
}

/** Foster monotony & strain per ISO week from the daily series. */
export function monotonyStrain(series: DailyLoad[]): WeekMonotony[] {
  const days = densifyDaily(series);
  const byWeek = new Map<string, number[]>();
  for (const d of days) {
    const wk = isoMonday(d.date);
    (byWeek.get(wk) ?? byWeek.set(wk, []).get(wk)!).push(d.load);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, loads]) => {
      const sd = stddev(loads);
      const m = mean(loads);
      const monotony = sd > 0 ? m / sd : null;
      const weeklyLoad = loads.reduce((a, b) => a + b, 0);
      return { weekStart, weeklyLoad, monotony, strain: monotony == null ? null : weeklyLoad * monotony };
    });
}

/** Latest ACWR flag for a summary strip. */
export function latestAcwr(points: AcwrPoint[]): AcwrPoint | null {
  return points.length ? points[points.length - 1] : null;
}
