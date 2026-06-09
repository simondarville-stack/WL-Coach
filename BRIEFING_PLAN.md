# Morning Briefing — design notes

A per-coach squad briefing that reads like a **per-athlete training debrief**:
what each athlete did exercise-by-exercise last week, any **misses** (failed /
skipped), any **PRs**, and their **RAW readiness + a trend** worth raising — with
total tonnage demoted to a closing footnote. *Not* plan compliance.

**Status: shipped (v0.9.0).** It's live as a card at the top of the coach
dashboard, generating its text in-app (no LLM, no external call) and reading it
aloud via the browser. An LLM/TTS upgrade path for richer prose and broadcast
audio is designed but not built (see "Future").

## Principle: the app computes the numbers; the narration never invents them

The data layer (`src/lib/analysis/briefing.ts`) produces a structured
`MorningBriefing` of **pre-computed** figures (per-exercise work, misses, PRs,
RAW readiness + trend). The in-app script renders those numbers deterministically;
the optional LLM upgrade *summarises* the same payload and must never recalculate.
So every printed/spoken figure is correct, the domain logic stays testable in
code (not in a prompt), and the in-app path needs no API.

## Pipeline

For each athlete, the card (`src/components/dashboard-v2/MorningBriefingCard.tsx`)
runs all of this client-side:

1. **Gather** — `fetchWeeklyAggregates({athleteId, startDate, endDate})` over ~8
   weeks (for the RAW trend; reused from the dashboard). Resolve the **last
   COMPLETED week** (`weekState` — a week is a source of truth only once over).
   For that week's date range also fetch:
   - `fetchWeeklyPRs(athleteId, weekStart, weekEnd)` — PRs from
     `athlete_pr_history` (real rep-count + `achieved_date`), filtered to
     `track_pr` exercises, competition lifts ranked first.
   - `fetchWeeklyMisses(athleteId, weekStart, weekEnd)` — failed/skipped **sets**
     per exercise (+ heaviest failed load) and exercise-level skips, from
     `training_log_sets`/`_exercises` status. (The performed aggregation drops
     non-`completed` sets, so misses are queried separately.)
   No new tables, no migration — all read-only over existing columns.
2. **Build + compose** — `athleteDebriefFromWeeks(inputs)` extracts the
   per-exercise work (heaviest-first), RAW + delta + trend + direction, tonnage
   trend, and the primary `concern`; `composeBriefing(athletes)` does the squad
   roll-up. Pure + unit-tested.
3. **Render** — `briefingScript(briefing)`: a deterministic, TTS-friendly spoken
   script (numbers read for the ear), ordered **readiness → misses → PRs → work
   → tonnage footnote**, flagged athletes first. *No LLM.* `briefingPrompt` /
   `briefingPodcastPrompt` build prompts for the LLM upgrade path.
4. **Play** — the card reads the script aloud via the browser's `SpeechSynthesis`
   (Web Speech API), on-device, with a persisted voice picker.

## Data shape (`MorningBriefing`)

```
{ date,
  athletes: [{ name, weekStart,
               exercises:[{name, sets, reps, maxLoad}],   // what they did
               misses:[{exerciseName, failedSets, skippedSets, heaviestFailedLoad}],
               skippedExercises:[name], prs:[{exerciseName, repCount, valueKg, isCompetitionLift}],
               rawTotal, rawDelta, rawTrend:[], rawDirection,
               tonnage, prevTonnage, tonnageDeltaPct,        // footnote
               concern, flagged }],
  squad: { athleteCount, flagged, tonnage, avgRaw } }
```

`concern`/`flagged` are the "needs attention" signal, derived from
coach-configurable thresholds (`BriefingThresholds`, never hardcoded): **low RAW
readiness, sliding RAW (drop vs prior week), missed attempts, skipped work, or a
sharp training-volume drop** — readiness/quality-first, not compliance.

## Future (designed, not built)

- **Richer voice (LLM + TTS API).** Feed the payload to `briefingPrompt` /
  `briefingPodcastPrompt` for natural prose, and a TTS API (OpenAI / ElevenLabs)
  for a broadcast-quality, downloadable episode. **Gating decision: privacy /
  consent** — this sends athlete data to an external provider; pick a
  no-training-on-your-data tier and confirm athlete consent. Keep the API key
  server-side, never in the client.
- **Daily delivery.** A scheduled server-side job (Supabase Edge Function via
  `pg_cron`, or a Netlify scheduled function — `netlify.toml` exists) that
  generates the briefing each morning and drops it into the coach's **Inbox**
  and/or emails it. Must resolve "this coach's athletes" by `owner_id`
  (auth/RLS are a future phase).
- **Per-pillar RAW trend.** "Sleep trending down 4 weeks" needs a per-pillar
  weekly query (only `raw_total` is aggregated weekly today). Lowest priority.
- **More content.** Per-coach threshold settings UI, opt-out / cadence,
  by-session (not just weekly) granularity.
