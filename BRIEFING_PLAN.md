# Morning Briefing — design & prototype notes

A daily, per-coach "what happened" report, written by an LLM from numbers the
analysis engine has already computed. **Status: prototype.** The data layer
(`src/lib/analysis/briefing.ts`) is built and tested; scheduling, the external
LLM call, and delivery are intentionally NOT built (they're product/infra/
privacy decisions — see "Open decisions").

## Principle: engine does the maths, the model only writes

The LLM receives a structured `MorningBriefing` payload of **pre-computed**
figures (adherence, week-over-week deltas, ACWR, monotony, flags). It summarises;
it never calculates. This keeps every printed number correct (no hallucinated
stats), keeps the call cheap (small JSON in, a few bullets out), and keeps the
domain logic where it's testable — in the engine, not in a prompt.

## Pipeline (4 stages)

1. **Schedule** — server-side, daily (e.g. 06:00). The app is a client-only SPA,
   so this must run off-client. Options in this stack:
   - a **Supabase Edge Function** triggered by `pg_cron`, or
   - a **Netlify scheduled function** (a `netlify.toml` already exists).
2. **Gather** — `gatherBriefing(athleteIds, today)` runs two engine queries
   (28-day athlete×date performed series for ACWR/monotony/deltas; the LAST
   COMPLETED week's athlete planned-vs-performed for adherence — a graded % is a
   source of truth only once the week is over) and composes the payload. Pure,
   reuses `runAnalysisQuery` + `monitoring.ts`. No new tables, no migration.
3. **Summarise** — `briefingPrompt(payload)` → one LLM call (Claude or GPT).
4. **Deliver** — drop the prose into the coach's **Inbox** (the feature just
   merged) as a "Morning briefing" thread, and/or email.

## Data shape (`MorningBriefing`)

```
{ date,
  athletes: [{ name, perf7d, plan7d, perfPrior7d, adherencePct, deltaPct,
               acwr, acwrFlag, monotony, watch: string[], flagged }],
  squad: { athleteCount, tonnagePerf7d, avgAdherencePct, flagged } }
```

`watch[]` is the engine's terse "needs attention" list, derived from
coach-configurable thresholds (`BriefingThresholds`, never hardcoded into the
prose): ACWR high/low, adherence too low/high, big week-over-week volume change,
high Foster monotony.

## Open decisions (before this ships)

- **Privacy / consent** — this sends athlete training data to an external LLM
  provider. Pick a no-training-on-your-data API tier; decide on athlete consent.
  This is the gating decision.
- **Where it runs + secrets** — Edge/Netlify scheduled function with the API key
  as a server env var, never client-side.
- **Owner scoping** — auth/RLS are a future phase here; the scheduled job must
  resolve "this coach's athletes" deliberately by `owner_id`.
- **Model & cost** — one small call per coach per day; trivial because we feed
  aggregates, not raw rows.

## Not in v1 (future)

- Missed-session detection (planned slots are abstract — no calendar date — so
  mapping a missed planned day needs the `day_schedule` weekday resolution).
- PRs hit in the window (needs `athlete_prs` comparison).
- Today's prescribed work (planned→calendar-date mapping).
- A per-coach digest cadence / opt-out and threshold settings UI.
