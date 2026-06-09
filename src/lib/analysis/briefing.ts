// EMOS Analysis — "Morning Briefing" prototype.
//
// Turns the analysis engine's PRE-COMPUTED numbers into a structured payload an
// LLM can narrate, and the prompt that asks it to. The engine does the maths
// (adherence, period deltas, ACWR, monotony); the model only writes prose, so
// it can't invent figures and the call stays cheap. Nothing here calls an LLM
// or talks to a scheduler — `gatherBriefing` produces the payload; delivery and
// the model call are deliberately out of scope (see BRIEFING_PLAN.md).

import { isoAddDays, isoMonday } from '../dateUtils';
import { acwr, latestAcwr, monotonyStrain, type AcwrFlag } from './monitoring';
import { runAnalysisQuery } from './runAnalysisQuery';
import { ANALYSIS_QUERY_VERSION, type AnalysisQuery, type MetricRegistry } from './types';

const METRIC = 'volume'; // tonnage (kg) — the registry's seed volume metric

/** Per-athlete inputs the engine has already computed. */
export interface AthleteRaw {
  name: string;
  perf7d: number; // performed tonnage, last COMPLETED week (kg)
  plan7d: number; // planned tonnage, last COMPLETED week (kg)
  perfPrior7d: number; // performed tonnage, the week before that (kg)
  acwr: number | null; // latest acute:chronic workload ratio (28d)
  acwrFlag: AcwrFlag;
  monotony: number | null; // latest Foster weekly monotony
}

export interface AthleteBrief extends AthleteRaw {
  adherencePct: number | null; // perf7d ÷ plan7d × 100
  deltaPct: number | null; // perf7d vs perfPrior7d
  watch: string[]; // terse, threshold-derived flags (the "needs attention" notes)
  flagged: boolean;
}

export interface MorningBriefing {
  date: string; // the briefing date (today)
  athletes: AthleteBrief[];
  squad: {
    athleteCount: number;
    tonnagePerf7d: number;
    avgAdherencePct: number | null;
    flagged: number;
  };
}

/** Coach-configurable thresholds (never hardcoded into the prose). */
export interface BriefingThresholds {
  acwrHigh: number;
  acwrLow: number;
  adherenceLow: number; // % below which compliance is a concern
  adherenceHigh: number; // % above which the athlete is over-doing it
  deltaBig: number; // |Δ%| week-over-week worth flagging
  monotonyHigh: number; // Foster monotony worth flagging
}

export const DEFAULT_BRIEFING_THRESHOLDS: BriefingThresholds = {
  acwrHigh: 1.5,
  acwrLow: 0.8,
  adherenceLow: 70,
  adherenceHigh: 130,
  deltaBig: 50,
  monotonyHigh: 2,
};

const round = (n: number) => Math.round(n);
const t1 = (kg: number) => (Math.abs(kg) >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${round(kg)} kg`);

/**
 * Pure: assemble the briefing (adherence, deltas, watch flags, squad roll-up)
 * from per-athlete numbers. Deterministic and unit-testable — this is the part
 * that decides "who needs attention", independent of fetching or the LLM.
 */
export function composeBriefing(
  input: { date: string; athletes: AthleteRaw[] },
  thresholds: BriefingThresholds = DEFAULT_BRIEFING_THRESHOLDS,
): MorningBriefing {
  const athletes: AthleteBrief[] = input.athletes.map((a) => {
    const adherencePct = a.plan7d > 0 ? (a.perf7d / a.plan7d) * 100 : null;
    const deltaPct = a.perfPrior7d > 0 ? ((a.perf7d - a.perfPrior7d) / a.perfPrior7d) * 100 : null;
    const watch: string[] = [];
    if (a.acwr != null && a.acwrFlag === 'high') watch.push(`ACWR ${a.acwr.toFixed(2)} — load spike, ease off`);
    if (a.acwr != null && a.acwrFlag === 'low') watch.push(`ACWR ${a.acwr.toFixed(2)} — detraining / undertraining`);
    if (adherencePct != null && adherencePct < thresholds.adherenceLow) watch.push(`adherence ${round(adherencePct)}% — well below plan`);
    if (adherencePct != null && adherencePct > thresholds.adherenceHigh) watch.push(`adherence ${round(adherencePct)}% — doing far more than prescribed`);
    if (deltaPct != null && Math.abs(deltaPct) >= thresholds.deltaBig) watch.push(`volume ${deltaPct > 0 ? '+' : ''}${round(deltaPct)}% vs prior week`);
    if (a.monotony != null && a.monotony > thresholds.monotonyHigh) watch.push(`monotony ${a.monotony.toFixed(1)} — little day-to-day variation`);
    return { ...a, adherencePct, deltaPct, watch, flagged: watch.length > 0 };
  });

  const adherences = athletes.map((a) => a.adherencePct).filter((x): x is number => x != null);
  return {
    date: input.date,
    athletes,
    squad: {
      athleteCount: athletes.length,
      tonnagePerf7d: athletes.reduce((s, a) => s + a.perf7d, 0),
      avgAdherencePct: adherences.length ? adherences.reduce((s, x) => s + x, 0) / adherences.length : null,
      flagged: athletes.filter((a) => a.flagged).length,
    },
  };
}

// ── live gathering (engine-backed) ─────────────────────────────────────────

function num(v: number | null | undefined): number {
  return typeof v === 'number' ? v : 0;
}

function query(athleteIds: string[], scope: AnalysisQuery['scope'], rows: AnalysisQuery['rows'], state: 'performed' | 'both'): AnalysisQuery {
  return {
    version: ANALYSIS_QUERY_VERSION,
    scope,
    subjects: { athletes: athleteIds, groups: [], normalization: 'none' },
    filters: [],
    rows,
    cols: [],
    measures: [{ metricId: METRIC, agg: 'sum', state }],
    viz: { type: 'table' },
  };
}

/**
 * Fetch the engine numbers for the squad and compose the briefing. Two queries:
 * a 28-day athlete×date performed series (for ACWR / monotony — rolling is fine
 * for those, they read performed only) and the LAST COMPLETED ISO week's
 * athlete planned-vs-performed total (for adherence — a graded % is only a
 * source of truth once the week is over; a rolling 7-day window straddles the
 * in-progress week and understates it). Names come from whoever the engine
 * returns, so it stays in step with owner scoping.
 */
export async function gatherBriefing(
  athleteIds: string[],
  today: string,
  opts: { registry?: MetricRegistry; thresholds?: BriefingThresholds } = {},
): Promise<MorningBriefing> {
  const run = opts.registry ? { registry: opts.registry } : {};
  // The last fully-elapsed week (Monday–Sunday) and the one before it.
  const lastMon = isoAddDays(isoMonday(today), -7);
  const lastSun = isoAddDays(lastMon, 6);
  const priorMon = isoAddDays(lastMon, -7);
  const priorSun = isoAddDays(lastMon, -1);
  const [loadResult, adhResult] = await Promise.all([
    runAnalysisQuery(query(athleteIds, { mode: 'rolling', windowDays: 28, anchor: today }, ['athlete', 'date'], 'performed'), run),
    runAnalysisQuery(query(athleteIds, { mode: 'dateRange', from: lastMon, to: lastSun }, ['athlete'], 'both'), run),
  ]);

  const perfKey = `${METRIC}::performed`;
  const planKey = `${METRIC}::planned`;

  const athletes: AthleteRaw[] = adhResult.rowKeys.map((rk) => {
    const name = rk[0];
    const series = loadResult.records
      .filter((r) => r.row[0] === name)
      .map((r) => ({ date: r.row[1], load: num(r.values[perfKey]) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    const latest = latestAcwr(acwr(series));
    const mono = monotonyStrain(series);
    const adh = adhResult.records.find((r) => r.row[0] === name)?.values ?? {};
    return {
      name,
      perf7d: num(adh[perfKey]),
      plan7d: num(adh[planKey]),
      perfPrior7d: series.filter((d) => d.date >= priorMon && d.date <= priorSun).reduce((s, d) => s + d.load, 0),
      acwr: latest?.ratio ?? null,
      acwrFlag: latest?.flag ?? null,
      monotony: mono.length ? mono[mono.length - 1].monotony : null,
    };
  });

  return composeBriefing({ date: today, athletes }, opts.thresholds);
}

// ── the LLM hand-off ────────────────────────────────────────────────────────

/** Per-athlete data lines shared by the text briefing and the podcast script. */
function athleteLines(b: MorningBriefing): string[] {
  return b.athletes.map((a) => {
    const adh = a.adherencePct == null ? '—' : `${round(a.adherencePct)}%`;
    const d = a.deltaPct == null ? '' : ` Δ${a.deltaPct > 0 ? '+' : ''}${round(a.deltaPct)}%`;
    const acwr = a.acwr == null ? '' : ` ACWR ${a.acwr.toFixed(2)}`;
    const w = a.watch.length ? `  ⚑ ${a.watch.join('; ')}` : '';
    return `- ${a.name}: ${t1(a.perf7d)} done / ${t1(a.plan7d)} planned (adherence ${adh})${d}${acwr}${w}`;
  });
}

function squadLine(b: MorningBriefing): string {
  return `Date: ${b.date}. Squad: ${b.squad.athleteCount} athletes, ${t1(b.squad.tonnagePerf7d)} performed in the last completed week, ${b.squad.avgAdherencePct == null ? '—' : round(b.squad.avgAdherencePct) + '%'} mean adherence, ${b.squad.flagged} flagged.`;
}

function flaggedLine(b: MorningBriefing): string {
  const flagged = b.athletes.filter((a) => a.flagged);
  return flagged.length ? `Flagged: ${flagged.map((a) => a.name).join(', ')}.` : 'No athletes flagged.';
}

/**
 * The prompt that turns the payload into prose. The model receives only the
 * pre-computed numbers, so every figure it prints is grounded — it summarises,
 * it never calculates. Provider-agnostic (Claude or GPT).
 */
export function briefingPrompt(b: MorningBriefing): string {
  return [
    'You are an Olympic-weightlifting coach\'s assistant. Write a concise MORNING BRIEFING from the squad data below.',
    'Rules: every number is already computed — summarise, never recalculate or invent. Lead with athletes carrying a ⚑ flag (load spikes, poor adherence). 5–8 short bullets max, no preamble or sign-off. Use European units (kg / t, comma decimals) and a calm, professional coaching tone.',
    squadLine(b),
    flaggedLine(b),
    '',
    'Per-athlete (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}

/**
 * Prompt that turns the payload into a SHORT NEWS-PODCAST SCRIPT, written to be
 * read aloud by a text-to-speech voice (so: spoken sentences, spelled-out
 * numbers, no markup). Same grounding rule — the model narrates the engine's
 * numbers, it never invents them.
 */
export function briefingPodcastPrompt(b: MorningBriefing): string {
  return [
    'Write a SHORT NEWS-style audio podcast script from the squad training data below. It will be read aloud by a text-to-speech voice, so follow these rules strictly:',
    '- About 60–90 seconds when spoken (~150 words). Flowing spoken sentences only — NO bullet points, NO markdown, no headings, no stage directions.',
    '- Open with a brief branded intro that names the date (e.g. "Good morning. This is your EMOS squad briefing for Tuesday the ninth of June."). End with a one-line sign-off.',
    '- Structure like a news bulletin: lead with the flagged athletes as the "top stories", then one positive note, then wrap up.',
    '- Read every number naturally for the ear: "17,0 t" → "seventeen tonnes"; "142%" → "a hundred and forty-two percent"; spell the date in words. Avoid jargon/abbreviations — say "his workload has spiked" or "acute-to-chronic workload ratio", never "ACWR".',
    '- Calm, professional sports-desk tone. Every figure is pre-computed — summarise it, never recalculate or invent.',
    squadLine(b),
    flaggedLine(b),
    '',
    'Data (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}
