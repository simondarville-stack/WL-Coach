# Training Log v2 — Build plan

> Lives at repo root for the duration of the rebuild. Delete when the
> module is shipped. Status updates are inline; check the box when a
> phase merges to `main`.

## Locked decisions

| Decision | Choice |
|---|---|
| Starting point | Rebuild code from scratch; keep DB schema |
| Coach view | New Log mode toggle on Weekly Planner |
| Comment threading | Per-session + per-exercise (current schema) |
| Athlete auth | Defer; keep localStorage picker |

## Scope changes vs. CLAUDE.md

- Lift `OUT OF SCOPE — Training Log` in `CLAUDE.md`
- Delete `src/components/training-log/` (eight files, all coach-side)
- Delete `src/athlete/` UI (except `AuthContext` + `ProfilePicker`)
- Keep all `training_log_*` and `bodyweight_entries` tables intact

## Module structure (new code)

```
src/lib/
  trainingLogService.ts     // typed reads/writes
  trainingLogModel.ts       // domain types, delta calc, status enums

src/components/planner/
  WeeklyPlanner.tsx         // + Log mode toggle next to Day Config
  log/
    LogModeView.tsx         // renders planned + actual stacked
    LogExerciseRow.tsx      // planned row + actual row, deltas
    LogDayHeader.tsx        // status, BW, RAW, session-RPE, day comments
    LogCommentsThread.tsx   // per-exercise inline thread
    LogPrint.tsx            // hooks into PrintWeekDesigner

src/athlete/v2/             // fresh, mobile-first
  AthleteApp.tsx
  screens/{Today,Week,Profile}Screen.tsx
  components/{SessionCard,ExerciseLogCard,SetEntryRow,RawScoreDial,CommentField}.tsx
```

## Existing schema (kept as-is)

- `training_log_sessions` — one per athlete-day. Status, BW, RAW (4 axes, total 4–12), session RPE, duration, notes
- `training_log_exercises` — links to `planned_exercises` (nullable). Technique rating, status, position
- `training_log_sets` — per-set actuals. Planned vs performed load/reps, RPE, status
- `training_log_messages` — per-session and per-exercise thread (sender_type athlete|coach)
- `bodyweight_entries` — historical BW track (separate from session snapshot)

## Coach Log mode — visual contract

Toggle in Weekly Planner header: `[ Plan | Log ]`.

Each exercise renders as paired rows:

```
┌ planned ───────────────────────────────────┐
│ Snatch        80% × 3 × 4                  │
├ actual ────────────────────────────────────┤
│            ✔  118kg × 3 × 4   RPE 8.5  💬2 │
└────────────────────────────────────────────┘
```

- Delta colour: green ≥ planned · amber 70–99% · red <70% / skipped
- Day header pill: planned / in-progress / done / skipped + BW + RAW total + session RPE
- 💬 chip opens inline per-exercise thread
- Notes icon in day header opens per-session thread
- Off-plan exercises (`planned_exercise_id = null`) render as "Added by athlete"

## Athlete app — visual contract

Mobile-first SPA. `ProfilePicker` on first load.

- **Today** (default): big card per session, today highlighted. Each exercise has planned prescription + "Log" button that opens an inline set entry pre-filled from the prescription. "Log all as prescribed" one-tap. Footer: BW input, RAW score dial, session notes
- **Week**: 7 mini-cards, status colour at a glance
- **Profile**: BW history chart, PR table, athlete switcher

## Service layer

```ts
// src/lib/trainingLogService.ts
fetchSessionForDay(athleteId, date) → SessionWithExercises
fetchWeekLog(athleteId, weekStart)  → DayLog[]
upsertSession(athleteId, date, patch) → Session
logSet(logExerciseId, setNumber, performed) → LoggedSet
addComment(scope: 'session'|'exercise', id, body, sender) → Message
deltaState(planned, actual, thresholds) → 'matched'|'amber'|'red'|'pending'
```

All planner Log-mode reads/writes go through this layer; no direct Supabase
calls in components. Matches the convention already enforced in the planner.

## Coach-flexibility audit (CLAUDE.md non-negotiable #1)

Things that MUST become runtime-configurable, not hardcoded:

- Delta thresholds (green/amber/red breakpoints)
- RAW score axes — schema fixes 4 axes; coaches might want 3 or 5 with custom labels
- Status labels (`pending|in_progress|completed|skipped|failed`)
- Technique-rating scale (currently 1–5)

P7 addresses this.

## Phased delivery

- [ ] **P1 — Foundations.** Lift scope rule. Write `trainingLogService.ts` + `trainingLogModel.ts`. No new UI yet
- [ ] **P2 — Coach Log mode (read-only).** Log toggle on Weekly Planner. Planned + actual + deltas + comments visible, not editable
- [ ] **P3 — Athlete app v2.** New Today screen, ExerciseLogCard, RawScoreDial, BW entry
- [ ] **P4 — Coach replies.** Coach posts comments inline in Log mode
- [ ] **P5 — Athlete Week + Profile.** Polish, history, PRs
- [ ] **P6 — Print parity.** PrintWeekDesigner gains "Include log" toggle
- [ ] **P7 — Coach-flex settings.** Configurable RAW axes, delta thresholds, status labels
- [ ] **P8 — Auth (deferred).** Magic link / RLS, separate effort

## Open questions

1. `bodyweight_entries` vs `training_log_sessions.bodyweight_kg` duplication — pick one as truth before P3
2. `training_log_messages.sender_type` is athlete|coach — with no real coach auth, the active coach from `coachStore` writes as `coach`. Acceptable until P8
3. Migrations — none planned P1–P7. P8 auth needs RLS migrations (written + flagged, never silently applied)

## Risks

- Deleting `src/components/training-log/` orphans any route still pointing at it. Verify nav already hides it (already done in the cleanup branch) before deletion
- `src/athlete/` has its own router and may have inbound links from tests or docs — sweep before deletion
- Delta colour depends on `summary_total_reps` being trustworthy on `planned_exercises`; if a row has no summary, deltas are undefined — treat as "pending"
