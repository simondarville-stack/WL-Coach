// EMOS Analysis — "Morning Briefing".
//
// A squad briefing focused on WHAT ATHLETES ACTUALLY DID — the numbers they hit
// in training (performed tonnage + their heaviest lifts) and how their RAW
// readiness scored — rather than plan-compliance. Pure, deterministic transforms
// over the weekly aggregates the dashboard already fetches; the card does the
// fetching, so this module has no Supabase/engine dependency and is unit-testable.
//
// briefingScript() renders a text-to-speech-friendly spoken script with no LLM.
// briefingPrompt()/briefingPodcastPrompt() build prompts for an LLM upgrade path.

const RAW_MAX = 12; // RAW readiness is scored out of 12 (four pillars × 3)

/** The slice of a WeeklyAggregate the briefing reads (structural — a
 *  WeeklyAggregate satisfies this, so callers pass it directly). */
export interface WeekStatLike {
  weekStart: string;
  weekState: 'past' | 'current' | 'future';
  performedTonnage: number;
  rawTotal: number | null;
  sessionRpe: number | null;
  exerciseBreakdowns: { exerciseName: string; performedMaxLoad: number }[];
}

export interface TopLift {
  exercise: string;
  load: number; // heaviest performed kg on that exercise, last completed week
}

/** Per-athlete numbers, extracted from the last completed week (+ the one before). */
export interface AthleteRaw {
  name: string;
  tonnage: number; // performed tonnage (kg) — what they actually moved
  prevTonnage: number; // the week before, for the trend
  topLifts: TopLift[]; // heaviest lifts hit that week
  rawTotal: number | null; // mean RAW readiness (0–12)
  prevRawTotal: number | null;
  rpe: number | null; // mean session RPE
}

export interface AthleteBrief extends AthleteRaw {
  tonnageDeltaPct: number | null; // vs the prior completed week
  rawDelta: number | null; // rawTotal − prevRawTotal
  watch: string[];
  /** Primary, human-readable reason this athlete needs attention (for the script). */
  concern: string | null;
  flagged: boolean;
}

export interface MorningBriefing {
  date: string;
  athletes: AthleteBrief[];
  squad: {
    athleteCount: number;
    tonnage: number; // total performed tonnage
    avgRaw: number | null; // mean RAW readiness across the squad
    flagged: number;
  };
}

/** Coach-configurable attention thresholds — readiness-first, not compliance. */
export interface BriefingThresholds {
  rawLow: number; // RAW total below this (out of 12) = low readiness
  rawDropDelta: number; // RAW fall ≥ this vs prior week = sliding readiness
  tonnageDropPct: number; // training-volume drop worth surfacing
}

export const DEFAULT_BRIEFING_THRESHOLDS: BriefingThresholds = {
  rawLow: 7,
  rawDropDelta: 2,
  tonnageDropPct: 40,
};

const round = (n: number) => Math.round(n);
const t1 = (kg: number) => (Math.abs(kg) >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${round(kg)} kg`);

/**
 * Pure: extract an athlete's numbers from their weekly aggregates — the last
 * COMPLETED week (and the one before, for trends). Top lifts are the heaviest
 * performed loads that week. Structural over WeekStatLike so a WeeklyAggregate[]
 * passes straight in.
 */
export function athleteRawFromWeeks(name: string, weeks: WeekStatLike[]): AthleteRaw {
  const past = weeks.filter((w) => w.weekState === 'past').sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const last = past[past.length - 1];
  const prev = past[past.length - 2];
  const topLifts: TopLift[] = last
    ? [...last.exerciseBreakdowns]
        .filter((e) => e.performedMaxLoad > 0)
        .sort((a, b) => b.performedMaxLoad - a.performedMaxLoad)
        .slice(0, 2)
        .map((e) => ({ exercise: e.exerciseName, load: e.performedMaxLoad }))
    : [];
  return {
    name,
    tonnage: last?.performedTonnage ?? 0,
    prevTonnage: prev?.performedTonnage ?? 0,
    topLifts,
    rawTotal: last?.rawTotal ?? null,
    prevRawTotal: prev?.rawTotal ?? null,
    rpe: last?.sessionRpe ?? null,
  };
}

/**
 * Pure: assemble the briefing (trends, readiness watch flags, squad roll-up).
 * Attention is readiness-led — low or sliding RAW, or a sharp training-volume
 * drop — not plan compliance.
 */
export function composeBriefing(
  input: { date: string; athletes: AthleteRaw[] },
  thresholds: BriefingThresholds = DEFAULT_BRIEFING_THRESHOLDS,
): MorningBriefing {
  const athletes: AthleteBrief[] = input.athletes.map((a) => {
    const tonnageDeltaPct = a.prevTonnage > 0 ? ((a.tonnage - a.prevTonnage) / a.prevTonnage) * 100 : null;
    const rawDelta = a.rawTotal != null && a.prevRawTotal != null ? a.rawTotal - a.prevRawTotal : null;

    const watch: string[] = [];
    let concern: string | null = null;
    if (a.rawTotal != null && a.rawTotal < thresholds.rawLow) {
      watch.push(`RAW ${round(a.rawTotal)} of ${RAW_MAX} — low readiness`);
      concern = 'readiness is low';
    }
    if (rawDelta != null && rawDelta <= -thresholds.rawDropDelta) {
      watch.push(`RAW down ${round(Math.abs(rawDelta))} on last week`);
      concern ??= 'readiness is sliding';
    }
    if (tonnageDeltaPct != null && tonnageDeltaPct <= -thresholds.tonnageDropPct) {
      watch.push(`training volume down ${round(Math.abs(tonnageDeltaPct))}%`);
      concern ??= 'training volume has dropped';
    }
    return { ...a, tonnageDeltaPct, rawDelta, watch, concern, flagged: watch.length > 0 };
  });

  const raws = athletes.map((a) => a.rawTotal).filter((x): x is number => x != null);
  return {
    date: input.date,
    athletes,
    squad: {
      athleteCount: athletes.length,
      tonnage: athletes.reduce((s, a) => s + a.tonnage, 0),
      avgRaw: raws.length ? raws.reduce((s, x) => s + x, 0) / raws.length : null,
      flagged: athletes.filter((a) => a.flagged).length,
    },
  };
}

// ── spoken script (deterministic, no LLM) ───────────────────────────────────

/**
 * Text-to-speech-friendly spoken briefing — leads with what each athlete lifted
 * and their readiness, flags low/sliding RAW. Numbers are read for the ear.
 */
export function briefingScript(b: MorningBriefing, thresholds: BriefingThresholds = DEFAULT_BRIEFING_THRESHOLDS): string {
  void thresholds; // reasons are precomputed in `concern`
  const tonnes = (kg: number) => `${(kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} tonnes`;
  const d = new Date(b.date + 'T00:00:00');
  const dateLabel = Number.isNaN(d.getTime()) ? b.date : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const parts: string[] = [`Good morning. Here is your squad training briefing for ${dateLabel}.`];
  if (b.athletes.length === 0) {
    parts.push('No athletes in scope yet.');
    return parts.join(' ');
  }

  // Flagged athletes (readiness concerns) lead the bulletin.
  const ordered = [...b.athletes].sort((a, x) => Number(x.flagged) - Number(a.flagged));
  for (const a of ordered) {
    let s = `${a.name} lifted ${tonnes(a.tonnage)}`;
    if (a.topLifts.length) {
      s += `, topped by ${a.topLifts.map((l) => `${round(l.load)} kilo ${l.exercise}`).join(' and ')}`;
    }
    s += '.';
    if (a.rawTotal != null) {
      s += ` Readiness ${round(a.rawTotal)} out of ${RAW_MAX}`;
      if (a.rawDelta != null && Math.abs(a.rawDelta) >= 1) s += `, ${a.rawDelta > 0 ? 'up' : 'down'} ${round(Math.abs(a.rawDelta))}`;
      s += '.';
    }
    if (a.concern) s += ` Worth a check-in — ${a.concern}.`;
    parts.push(s);
  }

  const avgRaw = b.squad.avgRaw == null ? '' : `, average readiness ${round(b.squad.avgRaw)} out of ${RAW_MAX}`;
  parts.push(`Across the squad, ${tonnes(b.squad.tonnage)} lifted${avgRaw}. That is your briefing.`);
  return parts.join(' ');
}

// ── the LLM hand-off (upgrade path) ──────────────────────────────────────────

function athleteLines(b: MorningBriefing): string[] {
  return b.athletes.map((a) => {
    const lifts = a.topLifts.length ? `; top lifts ${a.topLifts.map((l) => `${round(l.load)} kg ${l.exercise}`).join(', ')}` : '';
    const raw = a.rawTotal == null ? '; RAW —' : `; RAW ${round(a.rawTotal)}/${RAW_MAX}${a.rawDelta != null ? ` (${a.rawDelta > 0 ? '+' : ''}${round(a.rawDelta)})` : ''}`;
    const w = a.watch.length ? `  ⚑ ${a.watch.join('; ')}` : '';
    return `- ${a.name}: lifted ${t1(a.tonnage)}${lifts}${raw}${w}`;
  });
}

function squadLine(b: MorningBriefing): string {
  return `Date: ${b.date}. Squad: ${b.squad.athleteCount} athletes, ${t1(b.squad.tonnage)} performed in the last completed week, ${b.squad.avgRaw == null ? '—' : round(b.squad.avgRaw) + '/' + RAW_MAX} average RAW readiness, ${b.squad.flagged} flagged.`;
}

function flaggedLine(b: MorningBriefing): string {
  const flagged = b.athletes.filter((a) => a.flagged);
  return flagged.length ? `Flagged (readiness): ${flagged.map((a) => a.name).join(', ')}.` : 'No readiness flags.';
}

/** Prompt for a longer text briefing — the model narrates the pre-computed numbers. */
export function briefingPrompt(b: MorningBriefing): string {
  return [
    "You are an Olympic-weightlifting coach's assistant. Write a concise MORNING BRIEFING from the squad data below.",
    'Focus on what athletes ACTUALLY DID — the numbers they hit (tonnage and their heaviest lifts) and how their RAW readiness scored (out of 12). Lead with anyone carrying a ⚑ readiness flag. Every number is pre-computed — summarise, never recalculate or invent. 5–8 short bullets, no preamble, European units (kg / t), calm coaching tone.',
    squadLine(b),
    flaggedLine(b),
    '',
    'Per-athlete (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}

/** Prompt for a short spoken news-podcast script (TTS-ready). */
export function briefingPodcastPrompt(b: MorningBriefing): string {
  return [
    'Write a SHORT NEWS-style audio podcast script from the squad training data below, to be read aloud by a text-to-speech voice:',
    '- ~60–90 seconds (~150 words). Flowing spoken sentences only — NO bullets, markdown, or headings.',
    '- Open with a branded intro naming the date; end with a one-line sign-off.',
    '- Lead with what they LIFTED (tonnage + heaviest lifts) and their RAW readiness; flag anyone with low or sliding readiness as the "top story".',
    '- Read numbers for the ear: "17,0 t" → "seventeen tonnes"; "180 kg" → "a hundred and eighty kilos"; "RAW 6/12" → "readiness of six out of twelve". Spell the date in words.',
    '- Calm sports-desk tone. Every figure is pre-computed — summarise, never invent.',
    squadLine(b),
    flaggedLine(b),
    '',
    'Data (last completed week):',
    ...athleteLines(b),
  ].join('\n');
}
