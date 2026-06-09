# Morning Briefing — design notes

A per-coach squad briefing focused on **what athletes actually did** — the
numbers they hit in training and how their RAW readiness scored — *not* plan
compliance.

**Status: shipped (v0.8.0).** It's live as a card at the top of the coach
dashboard, generating its text in-app (no LLM, no external call) and reading it
aloud via the browser. An LLM/TTS upgrade path for richer prose and broadcast
audio is designed but not built (see "Future").

## Principle: the app computes the numbers; the narration never invents them

The data layer (`src/lib/analysis/briefing.ts`) produces a structured
`MorningBriefing` of **pre-computed** figures (performed tonnage, heaviest lifts,
RAW readiness + trend, readiness flags). The in-app script renders those numbers
deterministically; the optional LLM upgrade *summarises* the same payload and
must never recalculate. So every printed/spoken figure is correct, the domain
logic stays testable in code (not in a prompt), and the in-app path needs no API.

## Pipeline

1. **Gather** — for each athlete, `fetchWeeklyAggregates({athleteId, startDate,
   endDate})` (last ~3 weeks; reused from the dashboard) → `athleteRawFromWeeks`
   pulls the **last COMPLETED week** (a week is a source of truth only once it's
   over, per `weekState`): performed tonnage, the two heaviest performed lifts,
   mean RAW readiness + RPE, plus the prior week for trends. No new tables, no
   migration.
2. **Compose** — `composeBriefing(athletes)` derives the tonnage trend, RAW
   delta, **readiness-led watch flags**, and the squad roll-up. Pure + unit-tested.
3. **Render** — `briefingScript(briefing)`: a deterministic, TTS-friendly spoken
   script (numbers read for the ear). *No LLM.* `briefingPrompt` /
   `briefingPodcastPrompt` build prompts for the LLM upgrade path.
4. **Play** — the dashboard card reads the script aloud via the browser's
   `SpeechSynthesis` (Web Speech API), on-device, with a persisted voice picker.

The dashboard card (`src/components/dashboard-v2/MorningBriefingCard.tsx`) does
stages 1–4 client-side today.

## Data shape (`MorningBriefing`)

```
{ date,
  athletes: [{ name, tonnage, prevTonnage, topLifts:[{exercise, load}],
               rawTotal, prevRawTotal, rpe,
               tonnageDeltaPct, rawDelta, watch:[], concern, flagged }],
  squad: { athleteCount, tonnage, avgRaw, flagged } }
```

`watch[]`/`concern` are the "needs attention" notes, derived from
coach-configurable thresholds (`BriefingThresholds`, never hardcoded): **low RAW
readiness, sliding RAW (drop vs prior week), and a sharp training-volume drop**
— readiness-first, not compliance.

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
- **More content.** PRs hit in the window (`athlete_prs` comparison), per-coach
  threshold settings UI, opt-out / cadence.
