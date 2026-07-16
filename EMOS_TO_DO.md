EMOS TO-DO LIST 

#GENERAL INSTRUCTIONS
Here TO DOs live. They will be updated as smaller errors, bugs and feature requests are made for EMOS. 
Claude will evaluate and solve these. When an item is done, it should be moved to the #DONE section

**Default behavior (unless the user specifies otherwise):** solve *all* unsolved
items in the `##TO DOs` section — do not wait for the user to pick individual
items. Work through every open item, then move each finished item to `##DONE`.
For every completed item, write a short description under it stating **what was
wrong, what was changed, and the date** (European `DD/MM/YYYY`). Only deviate
from "solve everything" when the user names specific items to do (or explicitly
defers others).

##TO DOs

_(empty — everything below is done; new items go here.)_

##DONE
For every item that has been done, write what was wrong, what was changed and add a date.

#One thread implementation, not three (done 16/07/2026, v0.24.2)
**Wrong:** the coach inbox, the athlete app and the coach field app each carried
their own copy of the same thread logic — load, mark-read, send, the
session-born-mid-conversation lifecycle. Copy-pasted, comments and all. That
duplication was the defect generator behind the whole 0.24.1 batch: the same two
bugs existed in every copy, fixing them took three separate edits, and the third
(the field app) was missed on the first pass and only caught by the adversarial
review. Every copy also carried an `eslint-disable react-hooks/exhaustive-deps`,
which is precisely what let the stale-deps bug hide in all three.

**Changed:** the logic moved to `src/hooks/useThreadChat.ts` and all three
surfaces now consume it; each keeps its own presentation. The surfaces differ
only in parameters — `role` ('coach'/'athlete'), `kind`, `ownerId`,
`sessionOwnerId` (the athlete's host env, which a coach-created session must be
stamped with), `senderCoachId` — not in branches, so they became arguments
rather than forks. **No eslint-disable survives**: every effect dep is a
primitive or a ref, so the dep arrays are honest.

The hook also **owns the per-thread state reset** (React's adjust-state-during-
render pattern) instead of relying on callers to pass a `key`. That is the exact
bug from 0.24.1 — the session id was seeded once at mount and one call site had
no key — so a caller can no longer reintroduce it by forgetting.

**Deliberately NOT one `<ThreadChat>` component.** Investigation showed why:
the desktop pane is styled entirely with inline CSS-var tokens, the two mobile
views entirely with Tailwind over a hardcoded dark palette, and they own
different chrome (the field app renders only list+composer as a fragment; its
parent owns the header and panel). One component serving all three would need
~20 config props and a styling fork on ~40 nodes — a switch statement wearing a
component costume. The logic was one thing pretending to be three; the
presentation is genuinely three things. Merging the two *mobile* views'
presentation is a sound follow-up (their class strings are near-identical) and
is now cheap, since it would touch zero logic.

Verified live on all three surfaces: desktop sub-thread renders + badge 3→2;
athlete badge "COACH 1"→"COACH"; field general thread writes `coach_read_at`
(it never did before). 707/707 tests pass.

#Source maps no longer published (done 16/07/2026, v0.24.2)
**Wrong:** `vite.config.ts` used `sourcemap: 'hidden'`, which omits the
`//# sourceMappingURL` comment but still *writes* the `.map` — and Netlify
published `dist` wholesale, so the complete EMOS source sat at
`/assets/index-*.js.map` (~15 MB) for anyone who guessed the URL. The intent
was to keep production stacks mappable (it works — it is how the "Script error."
logger bug was diagnosed); the exposure was the unintended half.
**Changed:** the Netlify build now deletes `dist/**/*.map` after building.
Nothing fetches them at runtime, so the deploy loses nothing. Local builds keep
the map, and building the SHA the error log reports reproduces the same bundle
offsets — so a production stack is still one command from being mapped, without
shipping the source. Verified the strip command against a real `dist`: the
14.9 MB map goes, the bundle stays, 0 maps left.

#Duplicate names get a real message (done 16/07/2026, v0.24.2)
**Wrong:** adding a category whose name already existed showed the coach
**nothing at all** — `ExerciseCategoryNav` fired `onAdd`/`onRename` without
awaiting or catching, so the modal silently failed and cleared the typed name
anyway, while the raw `duplicate key value violates unique constraint
"categories_owner_name_unique"` escaped as an unhandled rejection into
`error_logs`. That is why these were in the log at all. Two supporting defects:
`useExercises` caught with `err instanceof Error`, which is always false for a
postgrest error object, so the real reason was replaced by a generic string —
into an `error` channel `/library` never renders anyway; and `describeError`
*appended* the Postgres detail, making the leak worse.
**Changed:** `describeError` now maps Postgres `23505` to coach-facing copy via
a constraint→message table (every entry verified against the live schema — the
first draft invented three constraints that don't exist). Add/rename/reorder/
recolor await and catch into an inline banner mirroring the existing delete
error, and **keep the typed name** on failure so it can be corrected.
`ExerciseForm` dropped its hand-rolled copy of `describeError` for the shared
one. Covered by `src/lib/__tests__/errorMessage.test.ts`. Verified live: adding
"Squat" now says "A category with that name already exists." with no
`constraint`/`owner_id` leak, no unhandled rejection, and no duplicate row.

**Error log now fully triaged: 0 unresolved of 86.**

#Inbox: stuck unread badges, invisible session threads (done 16/07/2026, v0.24.1)
All three messaging items traced to **two defects duplicated in both inboxes**
(`CoachInbox.tsx` and the athlete app's `CoachThreadScreen.tsx` are the same
component written twice), plus a badge-refresh gap. Verified live against the
real data, not just reasoned about.

* **An athlete's message with a training session attached never appeared in the
  thread.** Wrong: the chat component seeds `sessionId` from its prop *once*, at
  mount — but only the *unit* branch had a React `key`, so switching from the
  general thread into a session sub-thread **did not remount it**. `sessionId`
  stayed at the general view's `null`, and the loader's `sessionId ? fetch : []`
  took the empty branch, so **every session sub-thread rendered "No messages
  yet", always**. The message was in the database and perfectly formed the whole
  time; only the render was broken. Changed: both call sites now key the chat
  per view (`general` / `session:<id>` / `unit:…`), the pattern
  `FieldConversationScreen` already used.
* **The coach's unread icon never went away.** Same missing-key defect: with
  `sessionId` stuck at `null`, the mark-read branch fell through to
  `Promise.resolve()`, so `coach_read_at` was **never written** for any
  session-bound message — while the badge counts exactly those. Opening the
  athlete only marked the *general* thread read (`markGeneralThreadRead` filters
  `session_id IS NULL`), so the count could never reach zero. Fixed by the same
  keying; verified live (badge 3 → 2 on opening the thread, and the write landed).
* **The athlete's badge did not clear after reading.** A *second*, distinct
  defect: the mark-read effect bailed on `unreadCount === 0`, but on first render
  the threads list is still loading, so it saw a **synthetic** thread with
  `unreadCount: 0` and returned early — and its deps (`[thread.kind, sessionId]`)
  never changed when the real count arrived, so it **never re-ran** and
  `athlete_read_at` was never written. It only ever cleared via a side door
  (entering a sub-thread and back, which flips `thread.kind`). Changed: added
  `thread.unreadCount` to the deps of both effects. Re-running is safe — the
  write only touches rows whose read column is still null.
* **Badges lagged up to 60 s even after a correct write.** Both badges were
  self-contained pollers with no channel from the inbox. Added `lib/inboxEvents.ts`
  — a tiny pub/sub the service layer emits on every read-state change and both
  badge hooks subscribe to — so the badge clears the moment the thread is read
  (in-app navigation fires no `focus` event, which is why nothing woke them).
* **Data fix: 3 athlete messages were invisible to the coach.** Found while
  investigating: 4 rows had `owner_id NULL` (written before the fill-from-session
  trigger existed; migration `20260526000001` backfilled `athlete_id` but not
  `owner_id`). Every coach-side read filters on `owner_id`, so real athlete
  messages could never be seen, answered, or counted. Migration
  `20260716090000_backfill_training_log_message_owner_id` fills them from their
  session using the same rule as the trigger. Additive only; now 0 orphans.
* **European date/time in the coach inbox.** Spotted during verification: the
  inbox used `toLocaleTimeString/DateString(undefined, …)`, which follows the
  *browser's* locale — it rendered `09:23 AM` and `May 31` on an en-US machine
  while the athlete app showed `09:23` / `31/05` for the same messages. Now on
  the shared `dateUtils` helpers (24h, day-first), per CLAUDE.md.

#Training-log week overview: unit names + context-free Max (done 16/07/2026, v0.24.1)
`WeekReviewPanel` (the review strip above the week).
* **Wrong names.** It re-derived labels itself instead of reusing the planner's
  rule: `session_label || day_labels[i] || \`Day ${i + 1}\``. Two bugs — the
  athlete's `session_label` **outranked the coach's own unit name**, and the
  fallback said `Day ${i + 1}` where `i` is the 1-based `day_index`, so an
  unnamed first unit rendered as **"Day 2"** while the planner called it
  "Unit 1". Changed to the planner's resolution: `day_labels[i]` first, then
  `session_label` (bonus days the coach never planned), then
  `defaultUnitLabel(i, displayOrder)` — with `day_display_order` now selected and
  the same *sorted* `active_days` fallback the planner uses, so the two surfaces
  can't number units differently. Verified live: a week with coach-named units
  shows "Mandag · Onsdag · Tor/Fre"; an unnamed week shows "Unit 1…Unit 5"
  (was "Day 2…Day 6").
* **Removed "Max".** It was the heaviest single load across the whole week and
  every exercise, passed `planned = null` — so it rendered as a bare "180 kg"
  with no `∕ planned` and no %, while every neighbouring total had both. The
  per-exercise and per-day Max in the log itself keep their context and stay.

#Production error log reviewed (done 16/07/2026, v0.24.1)
Reviewed all 12 unresolved rows in `error_logs`; they collapse to two real
causes, both fixed at the root, plus one that had to be diagnosed before it
could be believed.
* **`/dashboard` — "NetworkError when attempting to fetch resource" (recurring).**
  The dashboard's 60 s poller called `loadDashboardData()` **un-awaited, with no
  `.catch`, and — alone among the app's pollers — no `document.hidden` guard**, so
  a tab left open on the dashboard kept firing it while the machine slept; each
  failure escaped as an unhandled rejection and logged an error. (`UnknownError`
  was the giveaway: postgrest resolves with an error *object*, so only an
  explicit `if (error) throw error` in `accessScope` could turn it into a
  rejection.) Now guarded on visibility and its rejection swallowed — a failed
  poll needs no handling, the next tick resyncs, but it must not read as a crash.
* **`/athlete/profile` — "Script error." (v0.24.0).** The recorded stack pointed
  at `index.js:704`, which decompiled to **the error logger's own listener**:
  `logError(event.error ?? new Error(event.message))` synthesised the Error
  *inside* the handler, capturing **its own** stack and filing it as the throw
  site — a fabricated lead. Now it passes a plain `{name, message, stack: null}`
  (a null stack is honest) and records `muted: true` in context, so an opaque
  third-party throw — the likely cause here, e.g. an injected script in an in-app
  webview — is distinguishable from a real app error at a glance. The underlying
  event carried no information about what threw; **no ProfileScreen defect was
  found**, and CORS/`crossorigin` was ruled out (assets are same-origin, so the
  config was already correct).
* **App could hang on the splash spinner forever.** Found in passing: `App.tsx`
  awaited `fetchCoaches()` un-caught, and `coachesLoaded` gates a full-screen
  spinner — one rejected call on boot (offline, a Supabase blip) and the coach
  stares at a spinner with no way out. Now fails open: logs and boots.

#Pre-merge adversarial review — 9 confirmed fixes (done 14/07/2026, v0.24.0)
A full multi-agent review of the whole 0.24.0 diff before merge found and I fixed:
* (HIGH) two planner display sites (`WeekTimelineHeader`, `PlannerControlPanel`)
  still read `week_type_text` first — flipped to `week_type` like the other
  readers, so cycling a week type no longer shows a stale label in the planner.
* (MED) the events-consolidation migration was applied to the remote DB but had
  no file — committed `supabase/migrations/20260714141523_consolidate_macro_competitions_into_events.sql`.
* (MED) the annual wheel double-drew multi-day competition events (diamond +
  arc) — the dedup now skips any competition already drawn as a comp diamond.
* (MED) unchecking the *last* table column inverted the toggle (all columns
  reappeared) — the menu now keeps ≥1 column visible.
* (MED) header competition chips used raw cycle dates while the table/strip use
  the week-aligned range — `fetchCompetitions` now week-aligns too.
* (LOW) restored a way to set the target/primary competition after creation
  (click a header chip); removed the orphaned `macro_competitions` CRUD writers;
  added a `+N` overflow indicator to the Events column.

#Events unified: symbols for all types, add-from-macro, one source (done 14/07/2026, v0.24.0)
* **Every event type gets a symbol** in both the macro table's Events column and
  the timeline strip. Wrong: only competitions (Trophy) and camps (Tent) had a
  glyph; seminars / testing days / team meetings / other showed nothing in the
  table and a plain dot on the strip. Changed: a shared `eventTypeIcons` registry
  (Trophy / Tent / GraduationCap / Gauge / Users / CalendarDays) drives both
  surfaces; the `TimelineMarker` now carries the raw `eventType`.
* **Add events for additional athletes from the macro.** The macro's "Add event"
  modal now lists the full athlete roster (current athlete/group preselected), so
  a coach can attach a competition/camp to extra athletes in one go — not just
  the macro's scope.
* **Competitions live in ONE place (events).** Wrong: `macro_competitions` was a
  parallel table, so a competition added at cycle-creation never reached the
  calendar, and a calendar competition never reached the macro's chips/chart.
  Changed: competitions are now the shared `events` model end-to-end —
  - migration `consolidate_macro_competitions_into_events`: added
    `macrocycles.primary_event_id` (the target competition) and migrated the
    existing standalone `macro_competitions` into competition events attached to
    their athlete(s), setting the primary pointer;
  - the macro derives its competitions from events (`useMacroCycles.fetchCompetitions`,
    the timeline markers, and the annual wheel all read events now; primary comes
    from `primary_event_id`), and cycle-creation writes competition **events**;
  - so adding a competition/camp in the calendar surfaces it in the athlete's
    macro and vice-versa. `macro_competitions` is now unused (kept, not dropped).
  Badge/chart/graph consumers are unchanged — events are mapped to the
  `MacroCompetition` shape. Self-review fix: adding a competition via the macro
  "Add event" menu now refreshes the header chips/chart too (`fetchCompetitions`),
  not just the timeline strip. (Annual-wheel dedup verified safe — comp-arc event
  ids populate `usedEventIds`, so competition events aren't drawn twice.)

#Macro "Track exercise" reuses the planner's ranked search (done 14/07/2026, v0.24.0)
Wrong: the macro toolbar's add-exercise picker did a flat, unranked substring
`.includes()` filter with a clunky select-then-click-Add step. Changed: it now
renders the planner's shared `ExerciseSearch` (ranked via `rankExercises`: exact
code > code prefix > name prefix > code contains > name contains), so a match is
added on selection and the field stays open to add several in a row. Added an
opt-in `autoFocus` prop to `ExerciseSearch` (planner unaffected); removed the
toolbar's bespoke query/matches state and the `selectedExerciseId`/`onAddExercise`
plumbing in favour of a single `onAddExerciseDirect(exercise)`. The exercise
**swap/replace picker** (planner `ExerciseDetail`, "Swap exercise (keeps
prescription)") already used the same `ExerciseSearch`; aligned it to `autoFocus`
on open so every exercise add/swap surface now feels identical. (Confirmed with
the coach that the macro table itself doesn't need a swap/replace for now.)

#Macro toolbar, events menu & table controls (done 14/07/2026, v0.24.0)
Follow-up batch on the combined macro experience:
* **Camp = lucide Tent in the strip.** The timeline strip's training-camp glyph
  was a hand-drawn triangle; swapped to the lucide `Tent` so the strip mirrors
  the table's Trophy/Tent pairing exactly.
* **Notes drag is horizontal now.** Replaced the per-row vertical height drag
  with a **column-width** resize (drag the Notes header's right edge); notes
  wrap and each row auto-grows to show all text — no fixed height, no inner
  scrollbar. When the column is collapsed to an icon, **tapping an empty cell
  now opens a new note** (previously empty cells were inert); the collapsed-note
  editor is a **portal popover** (renders on top, never clipped by the table's
  scroll container, flips up near the bottom edge).
* **All table fields are toggleable.** Training Week / Dates / Events are no
  longer forced-on — every column is in the "Table view" menu now. Choices
  persist **per macrocycle** (`table_layout.baseColumns`, coach-confirmed scope)
  with a layout `v` so cycles customised before these columns existed don't lose
  them. `showCol` is now a pure membership test; `GeneralSettings` lists all
  columns as the default set for new cycles.
* **Competitions & camps added from a top menu.** New "Add event" dropdown in
  the toolbar (Competition / Training camp) opens the shared `EventFormModal`
  preset to that type with the current athlete/group preselected, saved via the
  events model (so it shows on the macro timeline, the calendar and the
  dashboard alike). The competition editor was **removed from Edit cycle**
  (now just name + dates); existing `macro_competitions` still render read-only.
* **Toolbar regrouped.** The ribbon now reads in labelled groups separated by
  dividers — NAV · BUILD (Track exercise · Fill guide · Phases · Add event) ·
  VIEWS (Chart · Distribution) · REUSE (Template · Export/Import) · MANAGE
  (Edit cycle · Delete, right-aligned) — with icons added where missing.
* **Adversarial-review fixes (same ship).** A multi-agent review of the diff
  surfaced and I fixed: (HIGH) `persistLayout` didn't carry `baseColumns`, so any
  non-column view change (collapse, metric reorder, a tint toggle) silently wiped
  the coach's hidden columns on the next reload — now every persist includes the
  current column set; (MED) cycling a week type stopped syncing the legacy
  `week_type_text`, so Analysis / distribution / week-review / planner read stale
  types — those readers now resolve `week_type` first (single source of truth),
  `week_type_text` kept only as a fallback; (LOW) an event added with no athletes
  in scope attached to nobody and never showed — now blocked with a prompt; (LOW)
  reconciled the structural-column doc + kept those three out of the *global*
  settings chooser (they seed every table) while staying toggleable per macro.

#Macro timeline & notes — trophy marker, collapsible/draggable notes (done 14/07/2026, v0.24.0)
* **Strip competition marker = the table's Trophy.** Wrong: the top timeline
  strip drew competitions as a bespoke pennant *flag*, while the table uses a
  lucide **Trophy** — two symbols for one thing. Changed (`MacroTimelineStrip`):
  competitions now render as a Trophy in the **top-left corner of their week
  cell** (primary=red / secondary=orange, matching the table), co-existing with
  the notes dot (top-right); the compliance dot drops to bottom-left when a
  competition shares the cell. Competitions left the separate markers lane
  (which now carries only camps + events), so a competition-only macro no longer
  reserves an empty lane.
* **Notes column collapsible + drag-to-reveal.** Added a "Collapse notes to
  icon" toggle in the Table-view menu (persisted in `table_layout.viewToggles`):
  collapsed, the Notes column shrinks to a 30 px strip showing a note icon only
  where a week has a note (click reads/edits it in a widened overlay). Expanded,
  the per-row drag handle (now with a hover grip) grows the cell to show **all**
  the text — the inner scrollbar was removed (`overflow: hidden`, max height
  raised) per the coach's "no scroll on notes" preference.

#Macro table — week columns split, resizable, single week-type chip (done 14/07/2026, v0.24.0)
Restructure of the macro cycle table's identity columns (`MacroTableV2`):
* **Duplicate week-type indicator removed.** Wrong: the Type cell showed *two*
  things that read the same — a coloured chip (from `week_type`) and a small
  uncoloured label (from `week_type_text`) — because cycling the type stamped
  the abbreviation into `week_type_text` too. Changed: dropped the uncoloured
  label (display + inline edit) and the stamping (its "origin"), leaving one
  coloured chip. The now-dead `onUpdateWeekLabel` prop and `handleUpdateWeekLabel`
  were removed so nothing in the table listens to `week_type_text` anymore. The
  DB column stays (read-only fallback consumers — analysis, distribution chart,
  Excel export — resolve `week_type_text || week_type`, so an empty label just
  falls back to the abbreviation); it was **not** dropped (destructive change,
  live readers).
* **Week identity split into three columns.** The single cramped "Week" cell
  (number + ISO week + dates + event icons) became: **Training Week** (the
  sequential number, and the column is now user-**resizable** via a right-edge
  drag handle — sticky offsets of the following columns recompute from the
  width), **Dates** (ISO `W##` over the Mon–Sun `DD/MM–DD/MM` range), and
  **Events** (the Trophy/Tent competition & training-camp icons, now larger in
  their own column; more event kinds can be added later). These three are
  structural — always shown, kept out of the show/hide toggle set so older saved
  column sets still render them. Verified live: headers, single chip, the
  Limfjords-Cup trophy bucketed into the correct week, and the resize handle.

#Macro date inputs snap to Monday (done 14/07/2026, v0.23.3)
The macro start/end date fields now snap any chosen date to that week's Monday
(new opt-in `snapToMonday` on `DateInput`), so cycles stay Monday-aligned and
editing the start+end reliably re-ranges the table (the atomic shift RPC below
makes the update itself robust). Competition/event date fields are unaffected.

#Bug fixes (done 14/07/2026, v0.23.1–0.23.2)
* **Shifting a macro's start date failed with "duplicate key value violates
  unique_macrocycle_week".** Wrong: `shiftMacroWeeks` updated every week's
  `week_start` in parallel (`Promise.all`), so moving the cycle forward made a
  week momentarily land on the next week's not-yet-vacated slot, tripping the
  `(macrocycle_id, week_start)` unique constraint — and, being separate
  transactions, it committed *partial* shifts before aborting, corrupting some
  cycles (gaps / misaligned starts). Fixed (0.23.2) with an **atomic DB function
  `shift_macro_weeks(cycle_id, shift_days)`** (migration
  `add_shift_macro_weeks_function`) that updates the rows in a collision-safe
  order (latest-first forward, earliest-first back) inside one transaction, so
  it can never collide *or* leave a partial shift; the hook calls it via
  `supabase.rpc`. Verified at the DB level against the real corrupted data
  (naive bulk update reproduces the error; the ordered function does not).
* **Switching athlete in the top-right selector while viewing a macro stayed on
  the previous athlete's macro.** Wrong: `AthleteSelector` changes the athlete
  but doesn't navigate; the stale `/macrocycles/:cycleId` couldn't be resolved
  in the new athlete's cycle list, so the page stayed pinned. Changed:
  `MacroCycles` now drops the stale `:cycleId` (routes to `/macrocycles`) on an
  actual athlete/group switch — a ref skips the initial mount so deep-links still
  resolve, and clearing the selection (handled by `AthleteSelector` → dashboard)
  is left alone.

#Weekly planner day view — GPP module (done 13/07/2026, v0.22.0)
**Wrong:** the full-day edit surface (`DayEditor`, opened from a day's top
banner) had no GPP-sentinel handling, so a GPP block fell through to the
generic branch — an empty prescription grid + notes textarea — and couldn't be
viewed or edited there (only `DayCard` handled GPP).
**Changed:** `DayEditor.tsx` now mirrors `DayCard`'s GPP handling — a `gpp`
sentinel header (Dumbbell + title + row count), a read-only row summary in the
body, the gear button opening the `GppBlockEditor` (instead of the exercise
detail), and the editor modal wired via a new `saveGppSection` prop passed from
`WeeklyPlanner`.

#Combo exercises — round-multiplier notation (done 13/07/2026, v0.22.0)
**Wrong:** a combo tuple like `2+2+2` was ambiguous (2 rounds of 1+1+1, or one
round of 2+2+2).
**Changed:** added an optional per-column round multiplier serialized as
`m(a+b)` — a `()` toggle in the combo reps cell wraps the tuple and shows an
editable `m` cell that behaves like the other cells (starts at 1, left +1,
right −1, ctrl+click to type). Semantics (coach's choice): **reps only** — `m`
scales volume within each set, the set count (×N) is unchanged, and `m`
absent/`1`… is a perfect no-op for existing prescriptions. Threaded through the
parser (`prescriptionParser`), counting (`comboExpansion`,
`computePrescriptionSummary`), the athlete cache (`useWeekPlans`), all display
surfaces (`StackedNotation`, `PrintWeek`, `PrintWeekDesigner`,
`TemplatePreviewDialog`, `fieldView`), the interactive grid (`PrescriptionGrid`),
the kg↔% convert/resolve paths (`WeeklyPlanner`), and analysis
(`factFetch`, `useAnalysis`). Covered by `comboMultiplier.test.ts`.

#Autosave is now standard for text fields (done 13/07/2026, v0.22.0)
**Wrong:** the coach's `/text` sentinel field in `ExerciseDetail` required an
explicit Save button; everywhere else autosaves on blur. (Its textarea updated
only local state, not `notesRef`, so an X-close would have persisted a stale
value — hence the Save button existed.)
**Changed:** the sentinel-text textarea now autosaves like every other note
field (updates `notesRef` + debounce on change, flush on blur), and the
now-redundant footer Save button + `saveSentinelNotes` helper (and the unused
`Save` icon import) were removed. Video/image sentinels already autosaved.

#Combo creation via `+` on the add line (done 13/07/2026, v0.22.0)
**Wrong:** a combo could only be built via the `/combo` wizard.
**Changed:** `ExerciseSearch` gained an inline builder — pressing `+` on the
highlighted match (by name or code) stages it as a combo member (shown as a
chip) and awaits the next; Enter commits (1 staged → plain add, 2+ → a combo via
the same `createComboExercise` path the modal uses), Backspace on an empty query
pops the last chip, Escape clears. Opt-in via a new `onAddCombo` prop
(`DayCard`/`DayEditor` pass it; other call sites keep single-add behaviour).

#Follow-up ideas from the 0.22.0 batch (done 13/07/2026, v0.23.0)
Four co-designer ideas surfaced alongside the multiplier work, all now done:
* **Athlete-side multiplier symmetry.** `parseRepsInput` (and the analysis
  off-plan combo path in `factFetch`) now parse a grouped `m(a+b)` reps entry as
  `m × Σ(parts)`, so an athlete echoing the coach's `2(1+1)` placeholder logs the
  right volume — same Option-A semantics as the planner.
* **Macro combo model honors the multiplier.** Investigation found the macro's
  structured combo tables (`planned_combos`/`planned_combo_set_lines`) are a
  **legacy, write-dead model with no editor** — the disambiguation already works
  for every combo a coach can author today (via the prescription-string model +
  the multiplier-aware summary cache). Made the one remaining consumer (the
  legacy combo counter in `useMacroCycles`) honor a grouped `m(a+b)` tuple
  (reps ×m, sets unchanged), migration-free. See Ideas below for the bigger,
  still-open consolidation this uncovered.
* **Removed dead code.** Deleted the orphaned `MacroWeekNotes.tsx` (0 importers;
  the resizable notes cell was built inline in `MacroTableV2`).
* **Interactive phase coverage strip.** The phase panel's coverage strip is now
  click-and-drag — click a week to set the phase start, drag across weeks to set
  the range — wired live to the start/end selects.

#Macro (done 13/07/2026, v0.22.0)
* **Editing a macro's dates now updates the table.** Wrong: only an end-date
  change mutated `macro_weeks`; a start-date edit updated the header only, so
  the table's derived week dates didn't move. Changed: a start-date edit now
  slides the whole cycle (new `shiftMacroWeeks` in `useMacroCycles`, week
  structure/types/notes/targets preserved), the end slides with it unless
  explicitly changed, and the top timeline strip re-fetches via a reload key.
* **Week notes expand.** Added a draggable top handle to the notes cell
  (`MacroTableV2`) — drag up to reveal, down to shorten — with a scrollable
  pre-wrap body and a textarea editor.
* **Competitions & training camps in the overview.** `TimelineMarker` gained a
  `camp` kind; the timeline strip renders camps as a labelled band, and each
  week cell shows Trophy (competition, primary=red) / Tent (camp) icons fed by a
  per-week marker bucket. Event colours extracted to `lib/eventTypes.ts`.
* **Phase week coverage.** The phase panel's coverage strip now hatches free
  weeks (vs solid claimed), shows a legend + week numbers, lists the free weeks
  ("N free weeks: W7–W9, W14"), and annotates the Start/End week dropdowns with
  each week's phase name or "(free)".
