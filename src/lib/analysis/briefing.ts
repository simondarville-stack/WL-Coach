// EMOS Analysis — "Morning Briefing" → per-athlete TRAINING DEBRIEF.
//
// A squad briefing focused on what each athlete actually did last week: their
// work exercise-by-exercise, any MISSES (failed/skipped), any PRs, and their RAW
// readiness + a trend worth raising — with total tonnage demoted to a footnote.
//
// Pure, deterministic transforms. The dashboard card fetches (weekly aggregates +
// PRs + misses) and hands plain data in; this module has no Supabase/engine
// dependency and is unit-testable. briefingScript() renders a TTS-friendly spoken
// script with no LLM; briefingPrompt()/briefingPodcastPrompt() are the LLM path.

const RAW_MAX = 12; // RAW readiness is scored out of 12 (four pillars × 3)

// ── inputs ───────────────────────────────────────────────────────────────────

/** The slice of a WeeklyAggregate the briefing reads (structural — a
 *  WeeklyAggregate satisfies this, so the card passes it straight in). */
export interface WeekStatLike {
  weekStart: string;
  weekState: 'past' | 'current' | 'future';
  performedTonnage: number;
  rawTotal: number | null;
  exerciseBreakdowns: { exerciseName: string; performedSets: number; performedReps: number; performedMaxLoad: number }[];
}

/** Failed/skipped sets on one exercise in the week (computed by the card's fetch). */
export interface WeeklyMiss {
  exerciseName: string;
  failedSets: number; // attempted and missed the lift
  skippedSets: number; // chose not to do
  heaviestFailedLoad: number | null; // how close the missed attempt was
}

/** A personal record achieved in the week (computed by the card's fetch). */
export interface WeeklyPR {
  exerciseName: string;
  repCount: number;
  valueKg: number;
  isCompetitionLift: boolean;
}

/** Per-athlete inputs passed in by the card (keeps this module pure). */
export interface AthleteInputs {
  name: string;
  weeks: WeekStatLike[];
  misses: WeeklyMiss[];
  skippedExercises: string[]; // exercise-level skips (names)
  prs: WeeklyPR[];
}

// ── output ───────────────────────────────────────────────────────────────────

export interface ExerciseLine {
  name: string;
  sets: number;
  reps: number;
  maxLoad: number; // heaviest performed kg
}

export type RawDirection = 'low' | 'sliding' | 'improving' | 'steady' | 'unknown';

export interface AthleteDebrief {
  name: string;
  weekStart: string | null;
  exercises: ExerciseLine[]; // what they did, heaviest-first
  misses: WeeklyMiss[];
  skippedExercises: string[];
  prs: WeeklyPR[];
  rawTotal: number | null;
  rawDelta: number | null; // vs the prior completed week
  rawTrend: number[]; // recent weekly RAW means, oldest → newest
  rawDirection: RawDirection;
  tonnage: number; // footnote
  prevTonnage: number;
  tonnageDeltaPct: number | null;
  concern: string | null; // primary spoken reason for attention
  flagged: boolean;
}

export interface MorningBriefing {
  date: string;
  athletes: AthleteDebrief[];
  squad: { athleteCount: number; flagged: number; tonnage: number; avgRaw: number | null };
}

/** Coach-configurable attention thresholds — readiness- and miss-led. */
export interface BriefingThresholds {
  rawLow: number; // RAW total below this (out of 12) = low readiness
  rawDropDelta: number; // RAW fall ≥ this vs prior week = sliding
  tonnageDropPct: number; // training-volume drop worth noting (footnote flag)
}

export const DEFAULT_BRIEFING_THRESHOLDS: BriefingThresholds = {
  rawLow: 7,
  rawDropDelta: 2,
  tonnageDropPct: 40,
};

const round = (n: number) => Math.round(n);
const t1 = (kg: number) => (Math.abs(kg) >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${round(kg)} kg`);

function rawDirectionOf(trend: number[], rawDelta: number | null, t: BriefingThresholds): RawDirection {
  const last = trend.length ? trend[trend.length - 1] : null;
  if (last == null) return 'unknown';
  if (last < t.rawLow) return 'low';
  if (rawDelta != null && rawDelta <= -t.rawDropDelta) return 'sliding';
  if (trend.length >= 3 && trend[trend.length - 1] < trend[trend.length - 2] && trend[trend.length - 2] < trend[trend.length - 3]) return 'sliding';
  if (rawDelta != null && rawDelta >= t.rawDropDelta) return 'improving';
  return 'steady';
}

/**
 * Pure: build an athlete's debrief from their weekly aggregates (last COMPLETED
 * week + the prior weeks for trends) plus the misses/PRs the card fetched.
 */
export function athleteDebriefFromWeeks(input: AthleteInputs, thresholds: BriefingThresholds = DEFAULT_BRIEFING_THRESHOLDS): AthleteDebrief {
  const past = input.weeks.filter((w) => w.weekState === 'past').sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const last = past[past.length - 1];
  const prev = past[past.length - 2];

  const exercises: ExerciseLine[] = last
    ? [...last.exerciseBreakdowns]
        .filter((e) => e.performedSets > 0 || e.performedReps > 0)
        .sort((a, b) => b.performedMaxLoad - a.performedMaxLoad)
        .map((e) => ({ name: e.exerciseName, sets: e.performedSets, reps: e.performedReps, maxLoad: e.performedMaxLoad }))
    : [];

  const rawTotal = last?.rawTotal ?? null;
  const prevRaw = prev?.rawTotal ?? null;
  const rawDelta = rawTotal != null && prevRaw != null ? rawTotal - prevRaw : null;
  const rawTrend = past.map((w) => w.rawTotal).filter((x): x is number => x != null).slice(-6);
  const rawDirection = rawDirectionOf(rawTrend, rawDelta, thresholds);

  const tonnage = last?.performedTonnage ?? 0;
  const prevTonnage = prev?.performedTonnage ?? 0;
  const tonnageDeltaPct = prevTonnage > 0 ? ((tonnage - prevTonnage) / prevTonnage) * 100 : null;

  const failedTotal = input.misses.reduce((s, m) => s + m.failedSets, 0);
  let concern: string | null = null;
  if (rawDirection === 'low') concern = 'readiness is low';
  else if (rawDirection === 'sliding') concern = 'readiness is sliding';
  else if (failedTotal > 0) concern = 'missed attempts in training';
  else if (input.skippedExercises.length > 0) concern = 'skipped prescribed work';
  else if (tonnageDeltaPct != null && tonnageDeltaPct <= -thresholds.tonnageDropPct) concern = 'training volume dropped';
  const flagged = concern != null;

  return {
    name: input.name,
    weekStart: last?.weekStart ?? null,
    exercises,
    misses: input.misses,
    skippedExercises: input.skippedExercises,
    prs: input.prs,
    rawTotal,
    rawDelta,
    rawTrend,
    rawDirection,
    tonnage,
    prevTonnage,
    tonnageDeltaPct,
    concern,
    flagged,
  };
}

/** Pure: assemble the squad briefing from per-athlete debriefs. */
export function composeBriefing(input: { date: string; athletes: AthleteDebrief[] }): MorningBriefing {
  const raws = input.athletes.map((a) => a.rawTotal).filter((x): x is number => x != null);
  return {
    date: input.date,
    athletes: input.athletes,
    squad: {
      athleteCount: input.athletes.length,
      flagged: input.athletes.filter((a) => a.flagged).length,
      tonnage: input.athletes.reduce((s, a) => s + a.tonnage, 0),
      avgRaw: raws.length ? raws.reduce((s, x) => s + x, 0) / raws.length : null,
    },
  };
}

// ── spoken script (deterministic, no LLM) ───────────────────────────────────

function missPhrase(a: AthleteDebrief): string | null {
  const failed = a.misses.filter((m) => m.failedSets > 0);
  const bits: string[] = [];
  for (const m of failed) {
    const close = m.heaviestFailedLoad != null ? `, heaviest ${round(m.heaviestFailedLoad)} kilos` : '';
    bits.push(`missed ${m.failedSets} ${m.failedSets === 1 ? 'attempt' : 'attempts'} on ${m.exerciseName}${close}`);
  }
  if (a.skippedExercises.length) bits.push(`skipped ${a.skippedExercises.join(' and ')}`);
  return bits.length ? bits.join('; ') : null;
}

function prPhrase(a: AthleteDebrief): string | null {
  if (!a.prs.length) return null;
  const ordered = [...a.prs].sort((x, y) => Number(y.isCompetitionLift) - Number(x.isCompetitionLift) || y.valueKg - x.valueKg).slice(0, 2);
  return ordered.map((p) => `a ${p.repCount === 1 ? 'single' : `${p.repCount}-rep`} ${p.exerciseName} at ${round(p.valueKg)} kilos`).join(', and ');
}

function workPhrase(a: AthleteDebrief): string | null {
  if (!a.exercises.length) return null;
  const top = a.exercises.slice(0, 3);
  return top.map((e) => `${e.name} top ${round(e.maxLoad)} kilos`).join(', ');
}

/** TTS-friendly spoken debrief — leads with the exception (readiness, misses,
 *  PRs), then the work, with tonnage as a closing footnote. */
export function briefingScript(b: MorningBriefing): string {
  const tonnes = (kg: number) => `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} tonnes`;
  const d = new Date(b.date + 'T00:00:00');
  const dateLabel = Number.isNaN(d.getTime()) ? b.date : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const parts: string[] = [`Good morning. Here is your squad training debrief for ${dateLabel}.`];
  if (b.athletes.length === 0) {
    parts.push('No athletes in scope yet.');
    return parts.join(' ');
  }

  const ordered = [...b.athletes].sort((a, x) => Number(x.flagged) - Number(a.flagged));
  for (const a of ordered) {
    const seg: string[] = [a.name + '.'];

    if (a.rawTotal != null) {
      let r = `Readiness ${round(a.rawTotal)} out of ${RAW_MAX}`;
      if (a.rawDelta != null && Math.abs(a.rawDelta) >= 1) r += `, ${a.rawDelta > 0 ? 'up' : 'down'} ${round(Math.abs(a.rawDelta))}`;
      else if (a.rawDirection === 'sliding') r += ', sliding';
      seg.push(r + '.');
    }
    const miss = missPhrase(a);
    if (miss) seg.push(`They ${miss}.`);
    const pr = prPhrase(a);
    if (pr) seg.push(`New PR — ${pr}.`);
    const work = workPhrase(a);
    if (work) seg.push(`Main work: ${work}.`);
    if (a.concern) seg.push(`Worth a check-in — ${a.concern}.`);
    // Tonnage footnote.
    let vol = `Volume ${tonnes(a.tonnage)}`;
    if (a.tonnageDeltaPct != null && Math.abs(a.tonnageDeltaPct) >= 10) vol += `, ${a.tonnageDeltaPct > 0 ? 'up' : 'down'} ${round(Math.abs(a.tonnageDeltaPct))} percent`;
    else vol += ', in line with last week';
    seg.push(vol + '.');

    parts.push(seg.join(' '));
  }

  parts.push(`That is ${b.squad.athleteCount} ${b.squad.athleteCount === 1 ? 'athlete' : 'athletes'}, ${b.squad.flagged} flagged. End of debrief.`);
  return parts.join(' ');
}

// ── the LLM hand-off (upgrade path) ──────────────────────────────────────────

function athleteLines(b: MorningBriefing): string[] {
  return b.athletes.map((a) => {
    const work = a.exercises.slice(0, 4).map((e) => `${e.name} ${e.sets}×${e.reps} top ${round(e.maxLoad)}kg`).join(', ') || '—';
    const miss = a.misses.filter((m) => m.failedSets > 0).map((m) => `${m.failedSets} failed on ${m.exerciseName}`).concat(a.skippedExercises.map((s) => `skipped ${s}`)).join('; ') || 'none';
    const pr = a.prs.length ? a.prs.map((p) => `${p.repCount}r ${p.exerciseName} ${round(p.valueKg)}kg`).join(', ') : 'none';
    const raw = a.rawTotal == null ? 'RAW —' : `RAW ${round(a.rawTotal)}/${RAW_MAX}${a.rawDelta != null ? ` (${a.rawDelta > 0 ? '+' : ''}${round(a.rawDelta)})` : ''} ${a.rawDirection}`;
    return `- ${a.name}: ${raw}; misses: ${miss}; PRs: ${pr}; work: ${work}; volume ${t1(a.tonnage)}${a.flagged ? `  ⚑ ${a.concern}` : ''}`;
  });
}

function squadLine(b: MorningBriefing): string {
  return `Date: ${b.date}. Squad: ${b.squad.athleteCount} athletes, ${b.squad.flagged} flagged, ${b.squad.avgRaw == null ? '—' : round(b.squad.avgRaw) + '/' + RAW_MAX} average RAW readiness (volume footnote ${t1(b.squad.tonnage)}).`;
}

/** Prompt for a longer text debrief — the model narrates the pre-computed numbers. */
export function briefingPrompt(b: MorningBriefing): string {
  return [
    "You are an Olympic-weightlifting coach's assistant. Write a concise per-athlete TRAINING DEBRIEF from the data below.",
    'For each athlete cover, in this order: their RAW readiness (and any concerning trend), any MISSES (failed attempts vs skipped work), any PRs, then what they did in the key exercises. Total tonnage is only a closing footnote — do NOT lead with it. Lead the bulletin with flagged athletes. Every number is pre-computed — summarise, never recalculate or invent. European units (kg / t), calm coaching tone, no preamble.',
    squadLine(b),
    '',
    'Per-athlete (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}

/** Prompt for a short spoken news-podcast script (TTS-ready). */
export function briefingPodcastPrompt(b: MorningBriefing): string {
  return [
    'Write a SHORT spoken audio debrief from the squad training data below, read aloud by a text-to-speech voice:',
    '- Flowing spoken sentences only — NO bullets, markdown, or headings. Open with a branded intro naming the date; end with a one-line sign-off.',
    '- Per athlete, lead with readiness and any misses or PRs (the talking points), then the key work; mention total tonnage only as a brief footnote.',
    '- Read numbers for the ear: "180 kg" → "a hundred and eighty kilos"; "RAW 6/12" → "readiness six out of twelve". Spell the date in words.',
    '- Calm sports-desk tone. Every figure is pre-computed — summarise, never invent.',
    squadLine(b),
    '',
    'Data (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}
