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
* Save this to a day where it is the only one. Ask me before doing it: Should we test out a way to view the log, so it resembles the daycards more from the planning?
  _(untouched on purpose — it says "ask me before doing it". See the note under
  #Batch of 04/08/2026 for what I'd want to know before starting.)_
* Is it possibile to have push notifications from a webapp?
  _(Answered 18/08/2026, and the cheap half is BUILT — see #Desktop
  notifications below. The remaining half is real Web Push for the ATHLETE app,
  which needs the full PWA project and is still open: manifest + service worker
  + a push_subscriptions table + a Supabase edge function with VAPID keys, plus
  Home-Screen-install onboarding for iOS. Athletes have no email column, so
  there is no simple email fallback for that side without adding one.)_
* We need to ideate on a way to input excercises that is a "Skill Based Entry". This is a more soft-constrained excercise block. The idea is not entirely finish, but I want to be able to use the way we are currently prescriping a series. But it should be possible to set a time cap, a rep range, a load anchor (max set) and some ghost values like reps and average weight (for analysis purposes, not to show the athlete). Lets ideate on this and prototype before implementing. So ask me a series of quoestions and give me some ideas on how this should/could work. It would be preferable if we can stille manipulate from the planner without having to enter the excercise menu. 
  _(questions asked 18/08/2026 — see the reply; blocked on your answers. Most of
  the primitives it would compose from already shipped in 0.41.0: rep/set/load
  ranges, ≥≈≤ soft signs, ⏱ durations, and the Σ/S/Ø summary overrides, which
  are the closest existing analogue to "ghost" analysis-only values.)_
* We have two ways of creating the day cards. they can either be free and names "Unit 1" "unit 2" etc, and are by default NOT bound to a specific time of the week. We need the following options:
- to be able to reorganize these cards
- when it is a specific week, the current design is very messy. I would like it to be more structured and easy to see where in the week a training has been placed. Ask me some quoestions about this, build a prototype and then lets build a better way to display this. Please call on UI skills to assist you. 
  _(questions asked 18/08/2026 — blocked on your answers before prototyping.
  Note reordering free cards DOES already exist, but only inside the Day-config
  modal (drag the rows), not by dragging the cards in the planner grid. The
  AM/PM fix below landed as an interim step and is deliberately reversible.)_

_(everything below is done; new items go above this line.)_

##DONE
For every item that has been done, write what was wrong, what was changed and add a date.

#Desktop notifications for the coach (18/08/2026, v0.47.0 → 0.48.0)
The cheap half of the push-notification question, built on its own because it
needs no PWA, no service worker, no VAPID keys and no backend — just the
Notifications API.

**Wrong:** both inboxes polled every 60 s **and only while the tab was
visible**, so a coach with EMOS open in a background tab learned nothing until
they looked. Which is the case the inbox was already designed around — its own
code comment says coaches leave it in a background tab waiting for athletes to
log.

**Changed:** a bell toggle in the inbox rail header. With it on, a new unread
raises a desktop notification naming the athletes ("2 unread conversations —
Ida Mørck, Emilia Wódzka"); clicking it focuses the window and lands on
`/inbox?unread=1`, the same deep link the sidebar badge uses.

Four decisions worth recording:
- **Permission is only ever requested from that click.** It is one-shot per
  origin — a denied prompt cannot be re-asked from script, only undone by the
  user in browser settings — so asking on load would be a permanent own goal.
  A blocked browser shows the bell disabled and says where to fix it.
- **The preference is device-local**, not a DB setting. Permission is granted
  per browser, so a stored "on" would lie on every other device the coach opens.
- **Hidden tabs are polled only when notifications are on.** That flips the
  existing `if (!document.hidden)` guard, which would otherwise have made the
  whole feature inert — but it stays off for everyone else rather than spending
  a query a minute on a tab nobody is watching.
- **Nothing fires on a visible tab** (the badge is already the notification),
  nothing fires on first load (or every page load would announce old mail), and
  all alerts share one tag so three arrivals replace each other instead of
  stacking.
`fetchInboxUnreadCount` became a wrapper over a new `fetchInboxUnreadSummary`
so the badge and the notification read the same single query and cannot
disagree about what is unread.

**Verified** against live data with the Notification constructor stubbed (the
automated browser blocks the real prompt — which incidentally verified the
denied branch for real: bell disabled, correct explanation). Going 0 → 2 unread
on a hidden tab produced exactly one notification, titled "2 unread
conversations" with body "Ida Mørck, Emilia Wódzka" and tag
`emos-inbox-unread`. Raising it to 3 on a *visible* tab produced none. Another
poll window at an unchanged count produced none. All borrowed read-state was
restored.

**Not built — still the open half:** athlete-side push. That needs the PWA.

#Inbox unread navigation — all 3 proposals built (18/08/2026, v0.46.0 → 0.47.0)
**Wrong:** unread had badges, unread-first sorting and an Unread filter chip —
everything needed to *count* unread, nothing to *reach* it. Opening a long
thread dropped the coach in with no cue where the unread part started, and
finding the next unread meant scanning the rail by eye.

**1. A "new messages" divider, and the thread opens on it.** The tricky part is
that opening a thread marks it read, so a live computation would erase the
divider in the same breath as drawing it. `useThreadChat` now captures the
unread boundary on the FIRST load of each thread and freezes it
(`firstUnreadId`), which is also the behaviour a reader wants — the marker must
not move while they read under it. The capture is gated on the thread key, not
on the message list, because a unit thread's key changes when its session row is
born mid-conversation and that must not re-capture. The view scrolls to the
divider rather than the bottom: landing at the bottom past a block of unread
messages is exactly how they get missed, and on the mobile pane the jump is
guarded to fire once per boundary, or every later send would yank the view back
up to the divider.
*It shipped to all three thread surfaces*, because they share the hook and the
two mobile ones share `MobileThreadPane` — the coach inbox, the athlete app and
the field app.
Verified on both sides with real threads: coach-side, the divider landed after
four read messages and immediately before the one marked unread; athlete-side,
after three and immediately before the coach message marked unread — not at the
top, not at the bottom.

**2. The sidebar Inbox item deep-links to the unread.** With unread waiting it
points at `/inbox?unread=1` (title "Inbox — 4 unread"); the inbox switches on
the Unread filter, opens the first unread thread, then drops the parameter so a
refresh or a Back doesn't hijack a later visit. With nothing unread it is a
plain `/inbox` as before. *Chose the whole nav item rather than the badge*: a
button nested inside a link is invalid markup and a poor keyboard target, and
the Unread chip inside toggles straight back to everything.

**3. A "Next unread" stepper** beside the Unread chip, showing how many are
left. It walks unread **threads**, not athletes — one athlete can have several
unread units, and stopping at the athlete leaves the coach hunting again. It
always goes to the first unread that isn't the one already open, which stays
correct as the list reshuffles: opening a thread marks it read, so it drops out
and "first remaining" *is* "next". Verified end to end: 4 unread → the deep link
opened one → the stepper walked 3 → 2 → 1 → 0 and disabled itself, with exactly
one divider rendered at every stop, and the sidebar badge cleared.

All read-state used for the test was captured first and restored exactly,
including the one message that was genuinely unread beforehand.

**Found while testing, NOT fixed — needs a decision.** A coach message in the
GENERAL thread of a **shared** athlete is stamped with the coach's environment,
so the athlete's app never renders it, while their unread badge counts it
forever and can never be cleared. `fetchGeneralThreadMessages` filters
`owner_id`; `fetchAthleteGeneralUnreadCount` does not. The session path already
solved this by stamping the athlete's HOST env (`sessionOwnerId`), but the
general path never got the same treatment. One row in production is affected
(Mikkel Maryat Johansen). It isn't a one-line fix: re-stamping to the host env
may hide the message from the *coach* instead, since the coach's queries scope
by their own env — so it needs a call on whether the general thread should scope
by `athlete_id` alone, the way the planner's week queries already do. Spun out
as its own task.

#Batch of 18/08/2026 — 8 items (v0.45.2 → 0.46.0)

**The planner overview placed units by slot number, not weekday — and hid most
of the week.** `usePlannerWeekOverview` bucketed rows by
`planned_exercises.day_index`, which is a *slot* (a unit's identity), never
resolving the weekday through `week_plans.day_schedule` — which it fetched and
then never read. A unit sitting in slot 0 but scheduled for Saturday rendered
under **Mon**. Worse, the seven buckets truncated at index 7: `addNewDay`
allocates `max+1`, so adding and removing units pushes slots past 7, and every
such unit vanished from the grid **and from every total derived from it**.
Measured on Ida Mørck's 17/08 week: 23 of its 33 rows sat at slot ≥ 7, so the
overview reported **119 of 460 reps** — 74 % of the week's volume missing, with
tonnage and compliance wrong to match.
*Changed:* units resolve through `day_schedule`, the day list covers every slot
present (ordered by `day_display_order`), and totals read the exercise rows
directly so they can't drift from the grid's bucketing. Units with no weekday
left-pack into free columns, which reproduces the old reading for free weeks
exactly. Verified against the live DB: all 9 units now render on Mon/Mon/Tue/
Tue/Wed/Wed/Fri/Fri/Sat with 33 exercise bands, and the totals read 460 / 124 /
27,0 t — an exact match for the database.

**AM/PM divider aligned across the week.** There was no divider at all: each
weekday column stacked its sessions at natural card height, so the boundary sat
wherever that column's first card happened to end (Mon's PM card began at
y≈1247, Tue's at y≈1111 — a 136 px stagger). Sessions now split into morning
and afternoon **grid rows spanning the whole week**, so the line is at one
height for every day; measured after: every AM card starts at 689, the PM band
at 1276, for all four two-session days. That alignment is only definable in a
single row, so the week no longer wraps — it scrolls sideways inside its own
container (page itself does not scroll horizontally). Untimed sessions sit in
the first band: DayConfigModal requires a time as soon as two units share a
weekday, so an untimed one is the day's only session and has no AM/PM meaning
to guess at. A weekday label row was added because a fixed grid has to name its
columns. Boundary is `AM_END_MINUTES`, flagged COACH-CONFIG.
*Interim by intent* — the scheduled-week redesign is still open above.

**A table of previous actuals, and both tables follow the chart window.** The
exercise view listed what had been *prescribed* and plotted what was performed,
but never listed the actuals. New `ExerciseActualsHistory` reads the log the
same way the chart's Performed series does — per-set rows from
`training_log_sets`, falling back to a v1 `performed_raw` summary — so the table
and the chart cannot disagree; rows are dated by the session, not the week,
because a log is an event. Both tables now filter to the chart's visible window
and sit side by side beneath it: on Ida's Træk the default 16-week window shows
11 prescriptions / 9 actuals, and Show-all takes them to 13 / 10 (all 10 logged
rows). The prescriptions fetch went 104 → 156 weeks to match the chart's pannable
range.

**The athlete dropdown now re-points the Inbox.** Planner, macro, analysis, PRs
and the library already followed the global athlete store; the inbox kept a
private `selectedAthleteId`, so switching athlete in the header left the coach
reading the previous athlete's threads. Only a positive selection re-points —
clearing it, or picking a group (which the inbox has no notion of), leaves the
open conversation alone. *Not changed:* the competition calendar, which is a
multi-athlete surface by design.

**Settings split into sub-menus, 1:1 with the app's modules.** It was one
~1000-line scroll of 13 sections, so finding the planner's grid options meant
knowing roughly how far down they lived. Now seven tabs — General · Weekly
planner · Macro cycles · Analysis · Dashboard · Athletes · Fieldcoach — with the
chosen tab remembered per device. All 13 sections were preserved and verified
present tab by tab; nothing was dropped or rewritten, only grouped.

**Per-instance exercise names (variations).** A coach writing "Snatch from
blocks" had no way to rename one row: `planned_exercises` had no name field at
all, and the combo's name (`combo_notation`) was editable only in a Settings
block ~500 px *below* the title it fed. New `planned_exercises.display_name`
holds the override and the **exercise view's title is now the editor** for both
row kinds, which is also where the combo name moved to. `exercise_id` is never
touched, so every set, log and analysis row stays attached to the catalogue
exercise — a caption under the title says what it is logged as. Eight separate
label fallback chains now route through one `lib/plannedRowLabel`, which is what
would otherwise have let the override reach some surfaces and not others; it
renders in the day card, day editor, log rows, print, Fieldcoach and the athlete
app. Verified live: renaming one Træk row wrote `display_name` while
`exercise_id` stayed on the catalogue Træk, the two other Træk rows kept their
own name, and clearing it restored the original. *Fixed on the way:* the
exercise view's **back arrow was a pure view switch** with no flush and no
refresh, so a renamed row — or a renamed combo, true all along — kept showing
its old name on the day card until something else refetched. Both leaving routes
now run one `flushPendingEdits`. All test renames were reverted; the column
holds no rows.
*Not carried:* programme templates, which would need their own column — applying
a template gives the catalogue name.

**Clipboard previews, in stacked notation, and a specifications sheet.**
Double-click preview existed only for parked *weeks*; exercise and training-unit
items had none. All three now open one dialog. Their prescriptions — and the
programme-template preview's — rendered inline `load×reps×sets` via a
`readableLines` helper, which is exactly the notation you didn't want; both now
use `StackedNotation`, and `readableLines` is gone. Verified: both preview kinds
render divider rules and contain no `×` string.
**There was no specifications sheet in the repo** — display conventions lived
ad hoc in CLAUDE.md and code comments, which is why this kept getting lost. Now
`docs/DISPLAY_CONVENTIONS.md`, binding, covering stacked notation (with the
exact exceptions), comma decimals, European dates/times/Monday weeks, the
slot-vs-weekday distinction, and data-driven colour. CLAUDE.md points at it and
states the notation rule as a hard requirement.

**Timer in the athlete app.** ⏱ total time and ⏸ rest were display-only chips.
They're now tappable countdowns. Two things drove the design: it counts
**wall-clock** (state is the absolute end timestamp, the interval only
re-renders), so a sleeping phone or backgrounded tab can't silently make a rest
run slow; and it's mirrored to sessionStorage per row, so collapsing the card or
leaving the screen resumes the same countdown instead of resetting a rest the
athlete is relying on. Tap to start/pause, ✕ to reset, one vibration at zero.
Writes no training data — a timer is not a log.

*Also here:* the three duplicated 30-prop `DayCard` call sites in `WeekOverview`
collapsed into one.

#Per-exercise planner summary toggle (already shipped 17/08/2026, commit 5784219)
**Wrong:** every exercise showed the summary column in the weekly planner with no
way to turn it off.
**Changed:** the exercise form (create AND edit) carries a checkbox "Individual
Exercise Summary in the planner", stored as `exercises.show_planner_summary`
(migration `20260816090000`, default on). `DayCard` passes it into
`AnalysisColumn`; when off, only the corner +/#/eye icon strip renders. Note the
toggle is **catalogue-level** — it affects the exercise everywhere, not one
planned instance. If a per-instance override is wanted, that's a new item.
Verified in code on 18/08/2026 while triaging this list; no further work done.

#Ratio Analysis: symmetric analysis blocks, and search instead of a 300-option dropdown (05/08/2026, v0.38.1 → 0.39.0)
**Wrong (columns):** the sheet asked the same question at two levels and answered
it in two different shapes. The current level got `Target kg`, `Δ kg` and `Δ %`;
the goal level got `Goal kg` and a single `To go` — differently named, missing
the percentage, and signed the OPPOSITE way (`To go` was target − actual, `Δ kg`
was actual − target), so a coach scanning one row had to remember which column
was inverted. `Actual kg` also named the athlete's own number as if it belonged
to the model's analysis.

**Changed:** the table now reads **general information → analysis at the current
level → analysis at the goal level**, with the same three answers in each block:

| general | now | goal |
|---|---|---|
| Exercise · Reference · Reps · **Current best** | Index % · Target kg · Δ kg · Δ % | **Goal target kg** · Δ kg · Δ % |

- `Actual kg` → **`Current best`**, and it moved into the general block. It is
  the athlete's own number, and both levels are measured against it — the
  side-by-side view already placed it there, so the two modes now agree instead
  of the single-model view being a special case.
- `Goal kg` → **`Goal target kg`**, and the goal block gained `Δ kg` and `Δ %`,
  computed exactly like the current level's pair (`macro`-style guards included:
  the percentage is null rather than dividing by a zero goal).
- **Both Δ pairs are signed the same way** — current best minus that level's
  target. `To go` survives as the friendlier phrasing in the cell's tooltip
  ("15 kg still to go") and as a sort key, so nothing is lost, but the column a
  coach reads across is consistent.
- A **band row** now names the blocks (`NOW` / `GOAL`) in both modes. Two
  identically-labelled `Δ kg / Δ %` pairs need it, and it makes the block
  structure visible rather than implied.

*Fixed on the way:* the side-by-side band row hardcoded `colSpan={2}` over the
goal block while `To go` only rendered with an athlete selected — so with a
second model shown and no athlete, the band was one column wider than the body.
All four band spans are now computed from the same flags the body uses. The
`Δ %` column in side-by-side mode was gated on `diff` alone rather than
`diff && hasAthlete`, so it rendered a column of dashes with no athlete.

*Also corrected:* the legend still described the pre-rename vocabulary and was
factually wrong — it claimed `Target` was index × **goal** reference, which is
what `Goal target kg` is. Three "Ist"/"Soll" survivors in the legend and two
tooltips went with it.

**Wrong (mapping):** every row carried a `<select>` listing the entire
catalogue — a few hundred options — including the rows that most need it: the
ones a preset or CSV could not resolve, which show as `⚠ Jerk-drive squat
(unmapped)`. Finding the right lift in that list is the one job the control
exists for, and a native select is the worst tool for it.

**Changed:** an unmapped row now renders its label as a button. Click it and the
app's ranked `ExerciseSearch` — the same one the weekly planner, the macro
toolbar and this sheet's own "Add exercise…" field use — opens in the cell.
Type, arrow, Enter, and the row maps. Escape or clicking away closes it without
changing anything. Mapped rows keep the dropdown: repointing an already-correct
row is a different job, and the coach asked for the empty case.

Three details that make it behave: the open cell is keyed on the row OBJECT, not
the render key, because that key changes the instant a row becomes mapped; the
trigger opens on `click`, not `mousedown`, or it would race the search's own
outside-mousedown dismissal when moving between cells; and focus lands on the
select that replaces the search, so tab order does not restart at the top of the
document. No change to the shared `ExerciseSearch` — dismissal lives in the
cell, so the other six call sites are untouched.

**Verified end to end** against Ida Mørck / BVDG — U23. The header renders 4 + 4
+ 3 + 1 = 12 columns and every body row renders 12. A mapped row read
`Target 106 · −16,5 · 84 % | Goal target 108,5 · −19 · 82 %` — both gaps
negative, both percentages under 100, consistent. Clicking `⚠ Jerk-drive squat`
opened a 220 px search; "knick" ranked `Knickstød 12 Jerk`; picking it mapped the
row, closed the search and left focus on the new select inside the table. Escape
and focus-out both closed without mapping. All test mappings were reverted: the
two `exercise_aliases` entries the test wrote were removed and the device draft
cleared.

No migration — display and interaction only.


#Macro units, round two: %-native fills, honest Excel imports, and the reference (04/08/2026, v0.36.0 → 0.37.0)
The three follow-ups the 0.36.0 reply flagged, plus three real defects found while
building them — one of them introduced by 0.36.0 itself.

**1. The fill guide writes percentages now.**
*Wrong:* the engine produced kilograms, so 0.36.0 made the fill guide SKIP every
non-kg column. But a percentage cycle is exactly where a rhythm fill is most
natural — "85 / 90 / 92,5 / deload" is the shape a coach thinks in.

*Changed:* the unit a fill writes follows the target column. It needed no engine
change at all: `computeExerciseFill`'s `unit` option only decides whether the
anchors are divided through a reference on the way in, and `'kg'` is a pure
identity pass-through — so a fill whose anchors are already percentages asks for
`'kg'` and gets percentages out. `fillGuidePlan` picks the output unit from
`unitOf(te)`, requires a reference ONLY when the anchor unit and the output unit
differ, and skips only free text (there is no number to compute for prose).
Percentages round on a 0,5 grid, not the coach's kilogram step — a 2,5 grid is a
barbell fact and would flatten a percentage ramp into steps.

A % column locks the anchor toggle to `%`: its anchors are already in its own
unit, so there is nothing for a kg anchor to be converted into, and locking is
honest where defaulting would silently re-interpret "100 → 140 kg" as
"100 → 140 %". An all-exercises fill still means "80 % → 100 % of each
exercise's level" — kg columns resolve that through their own reference, %
columns store it verbatim. Both in one pass.

The chart's ◆ ramp anchors now report in the filled column's unit (`W1 = 80 %`,
not the 120 kg that reference would have produced), and the guide inverts a
drag with the same rule. `selectedTe?.target_unit` joined that effect's
dependencies — typing one character into a cell re-units a whole column, and a
setter left over from the old unit would invert every later drag wrongly, with
plausible numbers.

*Also fixed while in there:* the "skipped" line only rendered for all-exercises
fills, so a single-exercise fill on a skipped column showed "Nothing to fill —
check the anchors", which was untrue; `switchUnit` compared against the raw
`unit` state instead of the effective one, so in all-exercises mode clicking the
already-active "% of reference" divided the anchors by the reference a second
time; and the ghost preview cells printed raw JS numbers, so a 0,5 grid would
have shown "87.5" in a table that is comma-decimal everywhere else.

**2. Excel "Import as %" stamps the unit instead of corrupting the column.**
*Wrong:* it wrote the raw percentage straight into `target_max` and never
touched the column's unit, so 80 landed in a column that still said kilograms
and every reader believed it. Unconditional — the PR-resolution code in that
modal only ever served the "Import as kg" button. The modal's own group-mode
note promised "PRs will be resolved per-athlete later"; nothing was.

*Changed:* a `%` import now stamps `target_unit = 'percentage'` on every column
that actually receives a load (a template column carrying reps alone says
nothing about a load's unit and must not re-unit anything), which makes the
existing copy true. The kg direction stamps `absolute_kg` for the mirror-image
reason. Values are written first and units second, matching the convert flow: a
failed write then leaves the column as it was rather than re-united over numbers
that never arrived. Plumbed by widening the existing `onImportTargets` callback
rather than threading a new prop through three layers.

*Round-trip, which 0.36.0 broke:* the export tags a non-kg column's header
(`SN [%]`), and neither import path stripped it — the plain import silently
dropped the column, and the template import listed it twice (once tagged,
holding the data and unmapped; once bare, mapped and empty). `splitExerciseHeader`
now returns the tag, stripping the `(Target)`/`(Actual)` suffix FIRST since the
tag is not trailing until it is gone. Only the three strings `unitLabel` emits
count as units, so an exercise a coach named "Snatch [comp]" keeps its brackets.

*Guards:* the plain import refuses a column whose current unit is free text (a
number written there is never rendered — it would look like it worked and change
nothing) and refuses a file whose header tag disagrees with the column, rather
than turning 85 % into 85 kg without a word. And because an Excel import has no
undo, the modal now names the columns an import would re-unit and how many cells
it does not cover — those keep their current numbers under the new meaning.

**3. `reference_kg` — one concept, but the convert flow was clobbering it.**
*Wrong:* 0.36.0's convert flow wrote the approved reference to the column
unconditionally, so converting silently replaced the level a coach had set for
filling, heat-shading, copy-rescaling and templating. (This is what ate Ida
Mørck's Træk reference during the 0.36.0 test — see the note under that entry.)

*Changed:* the write is direction-aware, which matters both ways.
- **kg → %** must write it: the numbers now MEAN "% of this reference" and
  nothing else records that anchor. Leaving a stale one would make the column
  claim a level its own values contradict — and a pct template would bake that
  into every cycle made from it. (A plain write-if-empty rule looks safer and is
  worse here for exactly that reason.)
- **% → kg** must not: the numbers are absolute again and need no anchor, so the
  coach's planned level stays. It is still filled in when the column has none.

The modal shows the column's own reference whenever it disagrees with the
suggested PR — the only staleness signal in the app — and says "will be
re-anchored" on the direction that replaces it.

*Two more of the same class, found and fixed:*
- `buildTemplatePayload` fell back to the column's PEAK when it had no reference.
  On a percentage column that peak is a percent, so 95 became "written toward
  95 kg", stored in the template and restored as a kg reference on every cycle
  made from it. Introduced by 0.36.0, which created % columns; the fallback now
  applies to kilogram columns only.
- Ctrl+drag column copy rescaled across units with no check — a % column dropped
  on a kg column mirrored percentages and scaled them by a kilogram ratio, while
  the confirm text still said "scaled X kg → Y kg". It now refuses a cross-unit
  copy and points at the convert chip, and never rescales a % column (85 % is
  85 % at any level).
- The fill guide's Reference input accepted 0 and negatives, which every reader
  treats as unset — a column that LOOKS anchored and behaves as though it were
  not, and whose stored 0 pre-filled the convert modal with a value that
  disabled the entire dialog. Normalised to null on blur, and one
  `storedReference` helper now owns the `> 0` and the PostgREST string
  coercion.
- Re-modulate replays a fill's stored anchors with `overwrite: true` and no
  preview. Since one keystroke re-units a whole column, "100 → 140" written as
  kilograms could come back as "100 % → 140 %" across every week at once. It
  now records the units the fill ran under and refuses, naming the column and
  pointing at the fill guide, which previews.

**Verified end to end** against Ida Mørck's NM 2026 cycle. A % column's fill
preview produced `70,5%  76,5%  81%  85%  86%` — comma decimals, 0,5 grid,
rhythm-modulated, no reference needed — and the ◆ anchors read "W1 = 80 %".
Converting % → kg at an athlete PR of 80 left `reference_kg` at the coach's 105
(the defect above, now fixed) and produced 45,5 kg from 57 %. Converting kg → %
at 100 wrote 100, as it must. Rows whose PR box was cleared were skipped
untouched. All test data restored: the database holds no `target_unit` and no
`target_text`, and every reference in that cycle is back at 105.

No migration — all three changes are behavioural.


#Macro percentages & free text (04/08/2026, v0.35.1 → 0.36.0)
**Wrong:** every macro target cell was kilograms, and "kg" was implicit in
fourteen readers — no unit column existed anywhere. A coach could not write the
percentage-based programmes they actually use, and Excel's *Import as %* mode
wrote raw percentages straight into `target_max`, so the table rendered "80" and
every consumer treated it as 80 kg.

**Changed:** the unit is now explicit and lives on the **column**
(`macro_tracked_exercises.target_unit`), mirroring `planned_exercises.unit` in
the weekly planner, plus `macro_targets.target_text` for a prose load. NULL
reads as kilograms, so all 380 existing rows are correct without a backfill.
One module, `src/lib/macroTargetUnit.ts`, answers "what does this cell mean" for
every reader.

- **Authoring:** type it. `88%` makes the column percentages, `Heavy` makes it
  free text, `117,5` makes it kilograms — the same rule the prescription grid
  uses. The load input became `type="text"` (a number input cannot accept `%` or
  letters) and finally accepts comma decimals; it used to `parseInt`, so `117,5`
  was silently 117. The header carries a `kg` / `%` / `text` chip that cycles on
  click, so a typo-driven unit flip is visible and one click to undo.
- **Aggregates follow the column:** Ø and peak read in the column's own unit
  (`74%`, `88%`), a free-text column's aggregates stay blank, and tonnage counts
  **only** kilogram columns — its tooltip names the ones it left out rather than
  quietly reporting a smaller total. The collapsed heat strip shades a % column
  against 100 instead of `reference_kg`.
- **Chart:** a % series plots on the same kg axis (85 % sits where 85 kg sits) —
  deliberately, so there is one shape to read — and is marked as different:
  squares instead of circles, a dashed line, and a legend key that only appears
  when a % column is on the chart. Free-text columns plot nothing.
- **Convert:** `% → kg` and `kg → %` chips appear only when a column can
  actually convert. They open the planner's own `ResolvePercentagesModal`, which
  suggests the athlete's PR per column — resolved through
  `pr_reference_exercise_id`, falling back to the column's `reference_kg` — and
  lets the coach overwrite every one. Reps, sets and notes are level-independent
  and are never touched. The approved reference is stored so converting back
  suggests the same anchor.
- **Weekly planner (the "evaluate accordingly" half):** the category table's
  `↳ target` row renders in the macro column's unit, shows prose for a free-text
  column, and **only grades planned-vs-target when the two units match** — a
  red/green verdict comparing 85 % against 102 kg would be invented. The avg
  cell grades % against the planned % average and kg against the kg average.
  `ExerciseDetail`'s Macro-targets block and `DayEditor`'s per-row target chip
  got the same treatment.
- **Everything that moves a cell carries the unit:** `swapMacroWeeks` (both
  field lists), column copy, paste, fill-guide undo, and templates. A template
  stores the column's unit, and 'pct' mode no longer divides an
  already-percentage column by a reference a second time — that would have
  turned 85 % into 85 % of 85 %.
- **Fill guide:** the engine produces kilograms, so it now **skips** non-kg
  columns and says which ones, instead of stamping a kg number into a % column
  and leaving a silent 120 % target.
- **Excel:** a non-kg column's header reads `[%]` / `[text]` (the field labels
  all say "(kg)"), the template export passes an already-% column through
  untouched, and such a column is no longer reported as "missing a PR" it does
  not need.

New tracked exercises inherit the unit from `exercises.default_unit`
(`rpe`/`other` fall back to kg — a macro cell is a planned load).

**Migration:** `20260804120000_macro_target_unit_and_text.sql` — additive, two
nullable columns, no backfill.

**Verified end to end** against a real cycle (Ida Mørck, NM 2026): typing `88%`
flipped the column and wrote `target_max = 88` in one row upsert with
`target_reps_at_max` intact; the whole column re-rendered with `%`, Ø showed
`74%` and peak `88%` while the kg columns stayed bare; the chart drew 14 squares
reading "88 %" beside 49 kg circles. Converting at a coach-entered reference of
100 kg with a 2,5 step gave 87,5 / 62,5 / 67,5 / 70. Typing `Tungt løft` flipped
the column to text, blanked its aggregates, and dropped it from the chart. All
test data was restored afterwards — the database holds no `target_unit` or
`target_text` anywhere.

**One caveat:** the test overwrote `reference_kg` on Ida Mørck's *Træk* column
(NM 2026). Its original value was not recoverable, so it was restored to **105**
to match every other filled column in that cycle. Worth a glance if that column
was meant to differ.

**Answers to the four open questions**, for the record: (1) percent stays
percent — nothing converts silently; the deliberate convert flow suggests the PR
and the coach can overwrite it. (2) Per **column**, not per cell — it matches
the planner and keeps aggregates honest. (3) % and free-text cells are excluded
from tonnage and the exclusion is *named*. (4) The fill guide skips them.


#History points sit at the session, not the week (04/08/2026, v0.35.0 → 0.35.1)
**Wrong:** every session in a week collapsed onto one data point at the week
divider. An athlete who snatched twice that week showed as a single dot with the
two sessions merged into one max and one average — which is exactly the
comparison a load-history chart exists to make.

**Changed:** the x-axis is numeric and continuous — the integer part is the
week, the fraction is where in that week the session sits. Two sessions in a
week are two points. The dense Monday grid is still there, but as the *ruler*
rather than the list of points, so the axis stays proportional to time and the
viewport keeps counting in weeks ("16 wk").

Placement follows the two ways EMOS lets a week be written, in priority order
(new pure `src/lib/weekTimeline.ts`):
1. **It was actually logged** — use the real date. Beats every rule below,
   because it is what happened.
2. **Fixed time** — the unit's weekday (and clock time) from `day_schedule`.
   A weekday with no time sits at midday of that day, not on its midnight edge.
3. **Free sessions** — spread evenly and strictly INSIDE the week: session k of
   n at k/(n+1), so three sessions sit at 1/4, 2/4, 3/4.
4. A leftover row on a day since switched off has no ordinal; it sits mid-week
   rather than being dropped.

Sessions are keyed `<weekStart>|<dayIndex>`, so a planned unit and the session
logged against it merge into ONE point carrying both numbers. The macro Target
stays a week-level number on the divider, still drawn as a step.

**On the k/(n+1) rule:** it shipped as k/n first — the literal reading of
"session 2 of 3 sits 2/3 between the dividers" — but that put the LAST session
of every week exactly on the next week's divider, where it collides with the
gridline and reads as the wrong week. 0.35.1 changed it to k/(n+1): n sessions
across n+1 equal gaps, so the gap at each end matches the gaps between sessions.

**Verified by measuring the rendered geometry against the week dividers**, not
by eye: Ida Mørck's Rygøvelse on units 1, 3, 5 of a five-unit free week landed
at 0.2 / 0.6 / 1.0 under the first rule and at **0.167 / 0.5 / 0.833** (= 1/6,
3/6, 5/6) after. Her earlier weeks of the same exercise sit on **Mon / Wed /
Fri** instead — those sessions were logged, so the real date wins, which is the
intended precedence. Caroline Gernsøe's scheduled week puts her Saturday 10:00
unit at ~0.77. Zoom, pan, wheel-zoom and Show-all all still operate in weeks.
**Not verified:** the tooltip's new position line ("Wed 16:00" / "Session 2 of
3") was never driven by a real mouse hover — the Browser pane could not
composite frames, the same limit noted when the tooltip was first built.

#The planner's SOLL / IST renamed to Target / Planned (04/08/2026, v0.34.1)
Follows the Ratio Analysis rename, but deliberately **not** with the same words.
Checked what the two series actually are: `soll_*` comes from `macro_targets`
and `ist_*` from `planned_exercises.summary_*`, so this is the macro's target
against what the coach has WRITTEN INTO THE WEEK. Nothing in it is a logged
lift, so calling it "Actual" would have been wrong in the more damaging
direction — it would read as performance data.

The planner's vocabulary is now **Target** (from the macro) vs **Planned**
(written this week) vs **Performed** (logged), which is what
`ExerciseHistoryChart` already called its other two series and what
`WeekCategoryTable` already called its "↳ target" row. Changed in `SollIstChart`
(legend + tooltip), `ExerciseHistoryChart` (the Target series and its tooltip
row), `ExerciseDetail` (the Macro-targets block, label column widened 32 → 52 px
because "Planned" does not fit where "IST" did), and the code comments that
describe the series. Component and field names (`SollIstChart`, `soll_max`) are
untouched — internal, and renaming them is churn with no user-visible payoff.
No SOLL or IST string survives anywhere in `src`.

#Ratio Analysis — renamed, measured-only mode, and it stops resetting (04/08/2026, v0.34.0)
Five items in one pass.

**Renamed from Soll–Ist.** The mode tab, sheet header, model manager, wizard and
default analysis name all read "Ratio Analysis". The columns follow the English
this codebase already used for the pair in `macroExcelHeaders`: **Soll → Target
kg**, **Ist → Actual kg**. That collided with the existing "Target kg" column,
which is a different quantity — `soll` is the ratio at the athlete's CURRENT
reference, `target` the same ratio at their GOAL, and it already sat under a
"Goal (model)" group header — so it is now **Goal kg**, which is what it always
was. Internal identifiers (`sollist_*` tables, `SollIst*` components, `preset:`
keys, the `'sollist'` mode id) are untouched: renaming them is schema surgery,
and `sollist_analyses.preset_key` has no FK, so a preset rename orphans saved
analyses silently.

**"Measured only".** A toggle that builds Actual from xRM the athlete has
actually hit, ignoring the PR table's estimates — a ratio between two estimates
is a ratio between two guesses. Coach-typed overrides still win either way,
since those are measurements too, just entered by hand. Persisted with the
analysis. On Jon Herskind it moves the sheet from 12 resolved rows to 8.

**"It fails to load Jon Herskind's PRs" — and the real defect behind it.**
Jon had **0 PR rows** at the time (he has 18 now), so there was nothing to load.
But chasing it exposed something worse: **the sheet could show one athlete's PRs
under another athlete's name.** `fetchPRHistory` is async, so for a moment after
switching athlete the sheet's `athleteId` is the new one while the loaded
history is still the previous one's — and the reference autofill ran in that
window. History is now stored together with the athlete it belongs to, and every
consumer (autofill, the Actual map, the empty state) refuses rows that do not
match. A `refsFilledFor` marker on the sheet clears bound references filled from
someone else, closing the same hole for the paths that set the athlete WITHOUT
going through `onAthleteChange` — the Analysis scope at mount, and the restored
draft. Measured live: Jon 135/175, Ida 80/102, switching back and forth keeps
each athlete's own; before the fix Ida → Jon left Jon showing Ida's 80/102. Both
pairs confirmed against `athlete_pr_history`.
Also added an explicit "<name> has no personal records yet" banner so an athlete
with no PRs reads as empty rather than broken. **Not exercised against real
data** — every athlete in the environment now has PRs.

**The sheet survives navigation.** Walking to the PR page to look up a number
unmounted the view and threw away the whole sheet — which is exactly when a
coach walks over there. The in-flight sheet now mirrors to localStorage
(`src/lib/ratioAnalysisDraft.ts`) and restores on mount; device-local for the
same reason `logViewPrefs` is (unsaved working state, not athlete data). The
draft wins over the Analysis scope's athlete, so arriving from a one-athlete
scope cannot silently re-point a sheet already being built. `isSheetState`
validates it, because JSON from localStorage is untrusted — a bad draft is
discarded rather than crashing the surface. Verified: toggled Measured only,
went to /prs, came back with athlete, model, 23 rows and the toggle intact.

#Migration history closed; ghost training units repaired (04/08/2026, v0.33.0)
Two loose ends from the 18-item batch below.

**Three migrations existed in the remote DB with no local file** —
`sollist_models_and_analyses`, `sollist_generic_references` and
`exercise_aliases`, all applied 31/07 via the MCP server. Reconstructed from the
live schema and captured under their original version stamps.
They are a RECONSTRUCTION, not a transcript, and say so in their headers:
`sollist_analyses` carries six dropped columns (attnum 7–12) whose names
Postgres does not retain, so the original per-reference columns that `refs
jsonb` replaced cannot be recovered. A database rebuilt from the folder lands on
the CURRENT schema directly instead of re-walking the history. **Proved to be a
no-op** by fingerprinting the three tables plus `exercises.aliases` before and
after re-applying the whole reconstruction to production: identical hash, 29
columns, 12 policies still anon-scoped.

**The ghost training units** the old sync created (see the group-sync item in
the batch below) — 0.33.0 fixed the creation path, but forward-only. Migration
`20260804000000_repair_ghost_days_on_synced_plans` removes a day from a synced
athlete's `active_days` only when the group does not train it AND it holds
nothing at all: no planned rows, no logged session, no typed label, no schedule
entry. Of 10 candidate slots, **9 were empty ghosts and 1 was real** — Asger
Søderberg's "Friday" on 25/05 with 5 planned rows and a completed session, which
the guard correctly left alone. Rehearsed in a rolled-back transaction first,
which is how a null-handling bug in the predicate was caught: `NULL ? 'x'` is
NULL, not false, so a null `day_schedule` made the whole condition NULL and
matched nothing. After: the four 13/07 athletes went `{1,2,3,4,5}` → `{1,2,3}`,
Carl lost only his empty day 5, Asger's week is untouched, and `planned_exercises`
and `training_log_sessions` are unchanged at 2 059 / 262 rows.

#Batch of 04/08/2026 — 18 items (v0.33.0)
Everything else in the list above, shipped across eight commits. What was wrong
and what changed, per item.

**Exercise history chart: zoom, pan, and an expandable entries table.** The
chart fetched a hard 16 weeks and rendered all of it — nothing to navigate to
and no way to navigate. Worse, its x-axis was the sparse *union* of weeks that
had data, so two adjacent dots could be one week apart or nine and a training
gap read as continuous progress. It now fetches three years and builds a dense
contiguous Monday series, with an index viewport (`src/lib/chartViewport.ts`)
deciding what is shown: **wheel zooms about the cursor, shift+wheel and drag
pan**, plus buttons, arrow keys, +/− and 0, and a range readout. The chosen span
persists per device. The wheel handler is a native `{ passive: false }` listener
— React registers wheel passively, so `preventDefault()` in a JSX `onWheel` is a
no-op and the dialog would have scrolled under the cursor instead. Trackpad
pinch arrives as ctrl+wheel and works for free. The entries table fetched ~40
weeks and threw all but 6 away with no affordance saying so; it now keeps them
behind "Show all N". Both mounts (planner and macro) got this without a change.
*True two-finger pinch on a touchscreen is NOT covered — that needs 2-pointer
touchmove tracking; trackpad pinch and the +/− buttons cover the rest.*

**GPP blocks autosave.** The GPP editor was the last surface in the coach app
holding edits behind a Save button. Text edits now debounce at 350 ms,
structural ones commit at once, and closing flushes. New shared
`useSaveQueue` coalesces a burst of keystrokes into one round-trip. Cancel is
gone — nothing is held back to discard, same as a prescription. Three supporting
fixes were mandatory, not polish: `saveGppSection` patches the in-memory row so
the call sites could drop their per-save full refetch; the seed effect now fires
only on open (it would otherwise eat characters mid-typing); and Log mode's "no
session for this day" case used to swallow the save silently, which under
autosave is silent data loss.

**GPP blocks turn red under held Delete.** Rows with a PrescriptionGrid recolour
every cell while Delete is held; the gridless rows (GPP + the text/video/image
sentinels) armed nothing, so half a day card lit up and half looked safe. Their
content now takes the danger token on the same trigger. Content only — tinting
the row background hover-independently would turn the whole week pink. *Found on
the way:* in DayEditor the GPP body had no delete guard, so arming Delete and
clicking a GPP block opened the editor instead of deleting it; and its two
delete tints were hardcoded dark-theme pink at 4–6 % alpha, invisible in light
mode.

**Throw an item away.** Dropping an exercise, a whole training unit or a
clipboard card outside every drop target deletes it, with a 4 s undo. The
condition needs no geometry: a `drop` only fires where something
`preventDefault()`ed the `dragover`, so "outside any receivable area" is exactly
*a drop that reached the planner root with `defaultPrevented` still false*.
Deliberately not `dragend` + `dropEffect === 'none'`, which also fires on Escape
and on leaving the browser window — both would delete silently. Library and
template drags carry no marker and are un-throwable by construction.

**Group unit names reach every synced athlete.** The sync copied a unit's NAME
only for days the athlete did not already have, so a rename reached nobody and
in the common case (athlete already has days 1–5) it copied nothing at all —
12 synced plans in production had NULL `day_labels` against a group plan with
real Danish names. The merge moved into a pure `src/lib/groupPlanSync.ts` and is
now unconditional: the group owns the identity of the units it trains, the
athlete keeps everything else. Scoping to `active_days` is load-bearing — group
plans carry 40 placeholder keys ("Unit 6") for days they don't train, and the
old code would have pushed those over an athlete's bonus-day name. *Also fixed:*
a plan the sync creates inherited the column default `[1,2,3,4,5]`, so a group
training 3 units handed every athlete two permanently empty, unnamed cards no
later sync could remove.

**"=" evaluates a prescription cell.** `=140*0.85` commits 119. New
`src/lib/formulaEval.ts` — a hand-rolled recursive-descent evaluator, no
eval/Function/mathjs, because a prescription cell is a number and identifiers,
calls and property access have no meaning there. It resolves before anything
else reads the cell, so unit detection, interval parsing and the combo tuple
test need no formula awareness. A broken formula discards the edit rather than
committing 0 — commit also fires on blur.

**Fill-guide trend shapes.** `trendAt` was hardcoded linear. It now takes a
shape (linear / late jump / early step / S-curve) with a 0–100 bend, or
intermediate waypoints for a multi-point piecewise-linear model. Every shape is
anchored, so the two endpoints are hit exactly at any bend, and an omitted model
reproduces the old ramp byte-for-byte.

**Phase notes show in the ribbon.** Written in the phase panel, round-tripped
correctly, and rendered by exactly one thing in the app: the Excel export.
*The bug behind it:* `fetchPhases` filtered by `owner_id`, alone among the macro
fetches — so a co-coach opening a shared athlete's or group's macro saw **no
phases at all**: no band, no colours, no notes. Measured live on "2. Halvår
2026".

**Per-exercise week notes in the Category Table: already shipped** in 0.31.1
(commit 3fb6fa4) — verified live on week 14/09, all three notes render. Two
readability residuals fixed instead: the note was one nowrap line in a 240 px
box (hover-only past ~30 characters) and now clamps to two, and DayEditor showed
a bare hover-only ✎ glyph with no text.

**Macro context in the exercise detail.** `macroContext` already carried the
macro name, week n/N, week type, phase and week note — and ExerciseDetail read
none of it. There is now a context strip with all of it plus the phase/week
notes. `MacroCycles`'s own construction site hardcoded `phaseName: null`, which
now resolves properly. Two gating defects went with it: a COMBO gets the
week-level context (it is exercise-independent), and the Macro-targets section
no longer hides the SollIstChart when an exercise is tracked but has no target
that week — silence that read as a bug.

**Drag-reorder macro exercise columns.** The ← / → arrows are gone. The hard
part is `UNIQUE (macrocycle_id, position)`: the old arrows parked a row on a
negative sentinel, which only covers a two-row swap, while a drag moves a column
past several at once. New RPC `reorder_macro_tracked_exercises` parks the whole
cycle and lands the caller's order in one transaction. Collapsed columns are
draggable too — they had no move affordance at all before.

**Permanent add-exercise search in the macro toolbar**, replacing a button that
swapped itself for a search field.

**Ctrl+drag copies a macro prescription** onto another exercise. It mirrors
rather than merges (a week the source left empty clears the destination — a
merge would leave stale numbers on exactly the weeks you deliberately blanked),
and it **rescales by `reference_kg` when both exercises have one**, because
copying a snatch's 120 kg column literally onto a squat is almost never what you
mean. The confirm says which happened and how many weeks it would overwrite.

**Soll–Ist: exercise codes, and a model manager.** Codes render inline before
the name and the search box matches them — the add-exercise field right beside
them already ranked on code, so searching "bsq" and getting nothing was
inconsistent. New model manager lists the three textbook presets with a live
"how many of the 23 rows resolve against YOUR catalogue" figure (16/23 on the
real Danish one), opens a copy of any of them, and renames / duplicates /
deletes saved models. *The bug it exposed:* `sollist_model_rows.exercise_id` was
NOT NULL, so forking a preset **silently dropped 7 of 23 rows**. Migration
`20260803230000` makes the fork lossless. **Not built — needs your call:**
making a preset editable *in place*, so "BVDG — Senior" shows your corrected
numbers from then on. That changes what a textbook reference means.

**/Coach-overview renamed to /fieldcoach**, all 30 route literals, with both old
prefixes still redirecting (query string intact). Nothing internal was renamed —
"fieldcoach" re-embraces "field", and renaming the localStorage keys would have
reset every coach's group filter and collapsed cards.

**Read-only macro on the Fieldcoach surface.** New `/fieldcoach/a/:id/macro` and
`/fieldcoach/g/:id/macro`, reached from a button in the athlete and group week
headers. The athlete app's macro tab is deliberately number-free; the coach on
the gym floor IS the numbers audience, so tapping a week expands its target
table (code, top set in stacked notation, avg, Σreps, note). Two traps avoided
by design: no `owner_id` filter on `macrocycles` (that would blank the macro for
every shared athlete), and phases resolved through the week-number range rather
than the dropped `macro_weeks.phase_id`.

**No ghost on an unactivated macro cell.** An empty cell drew the previous
week's load as faint italic text, so a mostly-empty cycle read as full and the
real plan drowned. Click-to-seed is unchanged; the previous value moved into the
tooltip.

**Worth knowing — `npm run typecheck` is `tsc -p tsconfig.app.json`.** The root
`tsconfig.json` is `{"files": [], "references": [...]}`, so
`tsc --noEmit -p tsconfig.json` type-checks **nothing** and exits 0. I was using
the wrong one for part of this batch; running the right one surfaced three real
errors (including a missing import that made Soll–Ist model deletion a silent
no-op). All fixed, and the whole `src` tree checks clean.

**Migration history hole closed (04/08/2026).** Three migrations existed in the
remote database with no local file — `sollist_models_and_analyses`,
`sollist_generic_references` and `exercise_aliases`, all applied 31/07 via the
MCP server without one being written. Reconstructed from the live schema and
committed under their original version stamps, so the remote will not re-run
them and a database rebuilt from the folder now lands on the right schema.
They are **reconstructions, not transcripts**: `sollist_analyses` carries six
dropped columns (attnum 7–12) whose names Postgres does not retain, so the
per-reference columns that `sollist_generic_references` replaced with
`refs jsonb` cannot be recovered — the files assert the end state instead.
Proven safe by re-applying all three to production and diffing a schema
fingerprint over the four objects: **identical before and after
(`0e0f80ce…`, 29 columns), 12 policies still anon-scoped.**

**Ghost training units repaired (04/08/2026, migration
`20260804000000_repair_ghost_days_on_synced_plans`).** The `active_days` fix
above is forward-only, so plans already carrying the inherited `[1,2,3,4,5]`
kept their empty extra unit cards. 10 candidate slots existed; the repair
removes a day only when the group does not train it **and** it holds no planned
row, no logged session, no typed label and no schedule entry. **9 removed, 1
kept:** Asger Søderberg's "Friday" on 25/05 has 5 planned rows and a completed
session, and is untouched — verified after the fact, along with the four 13/07
plans going `[1,2,3,4,5]` → `[1,2,3]`. Nothing was deleted; `active_days` only
decides which units a week shows. Re-running now finds 0 candidates.

**On the log-as-daycards question (the one that says "ask me first"):** before
starting I'd want to know whether you mean the coach's Log mode in the weekly
planner, the athlete app, or both; whether a day card should show plan and log
in one card (today they are paired per exercise) or the log card should simply
adopt the planner's visual grammar; and whether it replaces the current Log view
or sits beside it as a toggle.

#Group sync is self-healing; three position bugs behind it (done 29/07/2026, v0.28.0)
Follow-up to the reorder audit. The proposal was "normalize positions after the
group sync"; investigating it turned up three separate defects.
* **The sync creates ties by construction.** The per-athlete merge combines
  three unrelated numbering sequences — individual overrides keep the athlete's
  own positions, logged-protected rows keep theirs, and fresh copies arrive
  carrying the **group plan's**. Measured against production: the next sync
  would have created **5 collisions**. The bigger class is the logged-protected
  rows (deliberately left in place while the rest of the day is rebuilt from the
  group's numbering); the second is `source = NULL` rows, which are invisible to
  the sync *twice over* — they survive the delete (which filters
  `source='group'`) and fail to suppress the incoming copy (the override check
  filters `source='individual'`), so a group row lands right on top of them.
* **Normalising per athlete is not enough.** The copies are written in one batch
  insert, so they all share a single `created_at` (verified: 23 rows, 1 distinct
  timestamp). If the *group* plan has a tie, position and `created_at` are both
  equal on the copies and the tiebreak falls through to the row id — a random
  uuid per athlete — so the same group day would come out **in a different order
  for each athlete**. The sync now normalises the **source** plan first, before
  reading it, which is what makes the copies deterministic. `handleSyncGroupPlan`
  refreshes afterwards since the group plan on screen can now have moved.
* **`applyTemplateDayToPlanDay` was minting ties and 0-based days.** Its base
  position was `count ?? 0`: applying a template to a **cleared** day produced a
  day numbered from 0 (**25 such rows across 25 days in production**), and
  appending to a day of n rows started at n — colliding with the row already
  there, every time. Now `max(position) + 1`, which is correct in both modes and
  survives gaps. Migration
  `20260729225500_repair_zero_based_planned_exercise_positions` renumbers the 25
  rows; each affected day was a clean `0,1,2`, so order is preserved exactly.
  The same function also hardcoded **`source: null`**, so a template applied to a
  group-synced athlete produced rows the next sync neither deletes nor treats as
  an override — the athlete saw the exercise **twice**, unbadged. It now takes
  the caller's source, and `WeeklyPlanner` passes the same `plannedSource` it
  already passes everywhere else.

**Changed:** new `normalize_planned_exercise_positions(weekplan_id, day_index)`
(migrations `20260729222000` + `20260729224500`) renumbers a plan or one unit
densely in **one atomic statement**, ordering by `(position, COALESCE(created_at,
'-infinity'), id)` and writing only rows that actually move. `normalizePositions`
in `useWeekPlans` is now a thin RPC wrapper with an optional day — the old shape
was a SELECT plus one UPDATE per row, which the sync would have multiplied into
~100 round trips, non-atomically. Verified at the DB level: no-op on a clean
plan, and an induced tie renumbers back to a dense 1..5 with the original order
intact (run in a transaction and rolled back). Production now has **0 ties and
0 zero-based rows**.
**Verified by running a real sync** (coach-authorised): Konkurrenceholdsprogram,
week 22/06/2026 — the worst case in the data, with **4 collisions projected**
for the next sync. Before/after, measured:
* **0 ties created** (4 projected), 0 zero-based rows, every unit a dense 1..n.
* **The group plan came out byte-identical** — same 21 rows, same order; the
  source normalise was a no-op because it was already dense, which is the
  correct behaviour for a healthy plan.
* **No log was orphaned.** 42 linked `training_log_exercises` before and after;
  orphans for that week stayed at 8 (all pre-existing). Logged-protected rows
  kept their identity, only their numbering moved.
* **Every athlete without protected/NULL rows got byte-identical order** — days
  3, 4 and 5 resolved to exactly one sequence across all four athletes. Days 1–2
  diverge only for Maya Bjørnvik, and only because of her own logged-protected
  rows and legacy NULL-source rows, which is the designed behaviour (deleting
  them would orphan her log).
* Maya's plan went 13 → 26 rows, gaining the day 3 and day 5 she was missing,
  every day dense. Her previously-colliding NULL row and the incoming group row
  now sit at consecutive positions, ordered oldest-first by the `created_at`
  tiebreak — the tie was resolved, not papered over.
* UI confirmed: 23 G badges on her 23 group rows, the 3 NULL-source rows
  correctly unbadged, and the rendered order matches the database.
The only non-dense days left in the whole table are two of Simon Darville's
Feb/March plans — outside the synced scope, pre-existing gaps, harmless for
ordering.

#Dead-column sweep — 27 benign, 5 real, 2 false alarms (done 29/07/2026, v0.28.0)
Swept every nullable column that is ~100% NULL in production (a null-ratio
census over `information_schema`), mapped each one's readers and writers across
`src/` and `supabase/`, then put every non-benign claim through an adversarial
pass whose job was to *refute* it. 34 columns examined.
**Confirmed and fixed:**
* **`training_log_sessions.duration_minutes`** (medium) — the athlete's session
  preview and the coach's Log-mode day card both render a `⏱ Nm` chip, and
  **nothing had written the column** since the v1 hook was deleted, so the chip
  could never appear. `started_at` is stamped at session creation and is
  athlete-editable, so the value was computable all along. `handleFinishSession`
  now derives it, guarded against a missing start and against clock skew (a
  negative or >24 h span writes null rather than a nonsense number).
  *Correction to the audit:* it called the 6 existing values "misleading test
  junk". They aren't — each matches its real `started_at`→`completed_at` span
  (sub-minute sessions from April 2026 testing). The data is accurate and was
  left alone.
* **`training_log_sessions.session_label`** (low, but it loses athlete input) —
  added specifically so athlete-created bonus sessions could be named, read by
  the coach's week-review strip, and **never written**. The name went only into
  `week_plans.day_labels`, which `setAthleteDayLabel`'s own doc comment admits is
  *silently dropped when the athlete has no week plan for that week* — precisely
  the bonus-day case. So the name the athlete typed was lost and the coach saw
  "Unit N". `createBonusSession` now stamps `session_label` on the session, where
  it always lands; the `day_labels` write is kept so nothing the coach sees today
  changes. Also nudges the planned-vs-logged separation the right way — athlete
  input now lands on the log row rather than only in coach-authored plan data.
* **`planned_exercises.source`** — the `templateService` gap above.
**Confirmed, needs a product decision — not changed:**
* **`training_log_exercises.technique_rating`** — a half-removed feature. The
  coach's Log still renders a `tech n/5` chip, but the v2 athlete rebuild dropped
  the input and never replaced it, so nothing can populate it after 06/04/2026.
  Restoring an input the coach may have removed on purpose (RPE was removed
  deliberately in the same rebuild) isn't mine to decide: **do you want the
  technique rating back, or should the coach-side chip go?**
* **`athlete_collaborators.notes`** — the share dialog has no note field, so the
  upsert always writes null. Same question: build the field, or drop the column?
**False alarms killed by the verify pass (worth recording so they aren't
re-reported):** `training_log_sessions.session_rpe` — genuinely write-dead, but
both readers are **unreachable**: `PivotBuilder.tsx` and `QuickAnalyses.tsx` are
imported by nothing (the `/analysis` route renders `AnalysisModule`), so there is
no UI to fix. `training_log_sets.rpe` — a writer *does* exist
(`upsertLoggedSet` writes it on every set save); RPE input was removed by
explicit coach request and the column is dormant-by-design, not orphaned.
**Benign (27).** Notably `training_log_exercises.owner_id` and
`training_log_sets.owner_id` are 94–95% NULL but **nothing filters on them** —
so this is *not* a repeat of the `training_log_messages.owner_id` bug fixed in
0.24.1. The rest are unused-but-wired features (`macro_weeks.avg_intensity_target`,
`macrocycles.group_id`, `events.start_time`/`end_time`, `training_groups.access_code`,
`exercises.link`/`display_order`) or genuinely optional free-text. Pure dead
weight, droppable whenever you want the schema tidied: `week_plans.name`,
`planned_set_lines.notes`, `athlete_prs.notes`, `athlete_pr_history.notes`,
`planned_combos.combo_name`/`notes`, `athletes.auth_user_id`, and the entire
**`planned_exercise_media`** table (0 rows — superseded by sentinel metadata).

#Phase resolution fixed; macro_weeks.phase_id dropped (done 29/07/2026, v0.28.0)
**Wrong (a live bug, not just tidiness):** a phase claims a **week-number
range** (`start_week_number`…`end_week_number`) — that is what the coach's
phase panel writes and what the coverage strip drags. `macro_weeks.phase_id`
was a parallel FK that **nothing ever wrote**: 0 of 158 rows populated. Three
consumers resolved a week's phase through it and therefore got NULL every
time — so **the Phase dimension in Analysis was empty for every row**, and the
`phaseId`/`phaseName` facts were always null. (The v2 dashboard had already
been bitten and carried a hand-rolled range fallback with a comment about
preferring the FK "if it happens to be populated" — it never was.)
**Changed:** one shared resolver, `src/lib/macroPhases.ts`
(`findPhaseForWeek` / `findPhaseInCycle`), now used by the analysis fact layer
(`factFetch`), the weekly aggregates (`useAnalysis`), the dashboard
(`useCoachDashboardV2`), the macro timeline (which owned the original private
copy) and the athlete macro tab. Both Analysis queries now select the phases'
week-number bounds, ordered by `position` so overlapping ranges resolve in the
coach's own order. The column was then **dropped** (migration
`20260729211022_drop_macro_weeks_phase_id`) rather than backfilled: keeping it
would mean the phase panel has to fan every range edit out to its member weeks
forever — two places encoding one decision, which is the shape of the bug being
removed. No data lost (entirely NULL) and no DB function, view or trigger
referenced it. Verified live: Analysis grouped by **Macro: Phase** for Caroline
Gernsøe now returns real names across two cycles ("Opbyg 2", "Konkurrence",
"Konditionering") where the column was previously blank.
Also captured `20260729095212_macro_cycles_span_whole_weeks.sql`, a migration
that had been applied to the remote DB without a file.

#Athlete Macro tab is navigation, not just a reference (done 29/07/2026, v0.28.0)
Tapping a training week in the athlete's Macro tab now opens that week in the
**Week** tab (`/athlete/week?week=<monday>`), with a chevron affordance and an
`aria-label` on each row. `WeekScreen` seeds its week from `?week=` — the
convention `TodayScreen` already used for `?week=&slot=` — and, because the tab
stays mounted, also **re-syncs on a later arrival with a different week** (an
initial-state seed alone would have kept showing the first one). Mid-week
values are snapped to Monday. Verified live: W5 → "10-16/08/2026", then W9 →
"07-13/09/2026" without a remount, and W3 → the real current week with
"2/3 sessions done".

#Reorder audit: 19 silent position collisions repaired (done 29/07/2026, v0.28.0)
Follow-up to the macro tracked-exercise swap fix — the same defect class in its
siblings. **`macro_tracked_exercises` is the only one of these tables with a
UNIQUE (parent, position) constraint**, which is why its collision threw a
visible error; `planned_exercises` and `macro_phases` have none, so the same
mistake there fails *silently*.
* **`planned_exercises` — 19 real collisions in production.** All ten "add
  exercise / add combo / add sentinel" call sites computed the new position as
  `exercises.length + 1` from the React render's snapshot, so two adds before
  the refetch landed gave both the same number. Tied rows come back from
  Postgres in arbitrary order, so a coach's day could re-shuffle between loads —
  and the group sync copied the group plan's ties out to every athlete, which is
  why one collision appeared on five plans at once ("Træk | Stødhiv", both at
  day 4 position 1). **Changed:** `addExerciseToDay` and `createComboExercise`
  take `position: number | null`, where `null` means append and is resolved from
  the **database** (`nextPositionInDay`); all ten append sites pass `null`, while
  the copy/paste/sync paths keep placing rows explicitly. Migration
  `20260729214500_repair_duplicate_planned_exercise_positions` renumbers the 19
  affected (week plan, day) pairs — 25 rows — preserving the current order with
  `created_at` then `id` as tiebreakers. Scoped to days that actually contain a
  tie: days with mere *gaps* (1,2,4,7) order fine and were left alone (a blanket
  renumber would have touched 109 rows for no benefit). Now 0 collisions.
* **`macro_phases`** — 0 collisions today (the phase form is a modal, so a race
  is unlikely) but the same client-side `phases.length + 1`. `createPhase` now
  derives the position from the DB too.
* **Deliberately NOT adding a unique constraint to `planned_exercises`.** It
  would turn these silent ties into loud errors, but every reorder path renumbers
  a whole day 1..n in parallel — exactly the pattern that made the constrained
  `macro_tracked_exercises` swap explode. Positions-as-ordering-hints plus an
  idempotent normalize pass is the more robust shape here; the fix is to stop
  *creating* ties, which is what the above does.

#Width caps checked — the planner was the only one (done 29/07/2026, v0.28.0)
Investigated whether the macro table and Analysis carried the same artificial
cap the planner did. **They don't** — measured live at a 2400 px viewport, the
macro page's table container spans 2065 px (the full width beside the sidebar;
the table itself is narrower only because that cycle tracks 3 exercises) and
Analysis's result table renders 1855 px next to its 264 px config rail. Neither
needed a change, so none was made. The remaining caps in the app are on
genuinely non-dense surfaces where a reading width is right (system guide
1400 px, error log, invitations, templates list) — the one arguable candidate is
`TemplateEditor`'s 900 px `PageShell`, but it is a single-column editor, not a
grid, so widening it would need a layout redesign rather than a cap removal.

#Athlete Macro tab — the shape of the plan, without the numbers (done 29/07/2026, v0.28.0)
**Wrong (missing capability):** the athlete app had no view of the macro at
all. An athlete could see this week's units and log them, but nothing about
what the *next eight weeks* look like — so planning life around a heavy block
or a competition meant asking the coach.
**Changed:** new **Macro** tab (`/athlete/macro`, between Week and Coach) with
one screen per macro cycle: training week number, the Mon–Sun date range
(`DD/MM–DD/MM`), the week-type chip in the coach's own colour, the events in
range with their per-type glyph, and the coach's week note — grouped under
phase headers. Deliberately **number-free**: no targets, no tonnage, no
per-exercise loads, per the item's intent. The cycle covering today opens
expanded, older ones collapse. New `src/lib/athleteMacroService.ts` scopes by
athlete id (own macros + macros of groups they are still an active member of)
rather than by coach owner-context, which the athlete app doesn't have; it also
resolves week-type names/colours **per macro owner**, so an athlete seeing two
coaches' cycles gets each coach's own vocabulary. Read-only by construction.
**Note:** phases attach to weeks by **week-number range**
(`start_week_number`…`end_week_number`), not by `macro_weeks.phase_id` — the
first draft read `phase_id` and every week came back phase-less. Now matches
the coach timeline's rule (`findPhaseForWeek`). Verified live on Emilia Wódzka:
W1–W11 of "VM 2026" with High/Medium/Low chips, the "now" marker on the current
week, "Limfjords Cup 12/09" bucketed into W9, and the phase band on
"Forår 2026". Nav fits 375 px with five tabs (no overflow).

#Group/individual badge now on every row type (done 29/07/2026, v0.28.0)
**Wrong:** on a synced athlete's plan the G / I origin badge rendered in
**one** of `DayCard`'s six row branches — the plain-exercise one. Combos, GPP
blocks and the text / video / image sentinels showed nothing, and `DayEditor`
had no badge at all. On real data that is most of the plan: of the 21 rows in
Maya Bjørnvik's 27/07 week, 8 are `free_text` sentinels and 6 are combos, so
only 7 carried a badge. **Two writers also stamped `source` NULL**, which is
both invisible *and* wrong for sync: a coach-created combo
(`createComboExercise`) and a drag-copy (`copyExerciseWithSetLines` /
`copyDayExercises`) were neither protected as an individual override nor
replaced as a group row — the group's copy landed next to them.
**Changed:** extracted `SourceBadge` (`src/components/planner/SourceBadge.tsx`)
— one definition of the marker, its colours and its tooltip copy — and rendered
it in every `DayCard` branch plus once in `DayEditor`'s item header (which
covers all its branches). `createComboExercise` takes a `source`, and
`copyExerciseWithSetLines`/`copyDayExercises` take the origin to stamp on the
copy; `WeeklyPlanner` passes a single `plannedSource` to all of them, matching
the paste/clipboard paths that already did this. A NULL `source` still renders
nothing — that is honestly unknown, not "individual". Verified live: 21/21 rows
badged on the synced week.

#Unplanned weeks inherit the training rhythm (done 29/07/2026, v0.28.0)
**Wrong:** a week plan is created on first visit with no `active_days`, so it
fell through to the column default `ARRAY[1,2,3,4,5]`. An athlete training 3
units — or 9 — got a fresh 5-unit week every single time and the coach
re-configured the units by hand, every week.
**Changed:** `fetchOrCreateWeekPlan` now seeds a new plan from the most recent
**earlier** week of the same athlete-or-group — `active_days`, `day_labels`,
`day_display_order`, `day_schedule` (structure only; no exercises, no week
description). A week whose `active_days` is empty is skipped so a deliberately
blanked week doesn't propagate emptiness forward, and a first-ever week keeps
the DB defaults. Changing the rhythm afterwards simply overwrites the seed.
Verified live: Emilia Wódzka trains 3 units, and a brand-new 10/08 week was
created with `active_days [1,2,3]` instead of `[1,2,3,4,5]`.
**Already covered:** the second half of the item — "pastes a training plan with
more days than what is active (use the wizard)" — is the existing Apply-week
dialog, which lists the units the paste would introduce with an opt-out
checkbox and skips them when unchecked. No change needed.

#Chart settings are saved with the macro (done 29/07/2026, v0.28.0)
**Wrong:** which exercises and metrics the chart shows was ephemeral React
state, and an effect reset it to "everything visible" whenever the tracked-
exercise count changed. Hiding four of six exercises to read one line survived
neither a reload nor tracking a new exercise.
**Changed:** the chart block persists to `macrocycles.table_layout.graph` —
series visibility plus the avg-lines, reps-bars and link toggles (the type
already anticipated `graph`; it was unused). Visibility is stored as the
**hidden** sets, not the visible ones, so a newly tracked exercise shows by
default and a removed one leaves no stale id; `visibleExercises` is now derived
(tracked ∖ hidden) instead of being state, which is what removes the resetting
effect entirely. Every persist carries the full graph block, so a table-only
change can't wipe the series selection — the same rule `baseColumns` already
follows. Verified live: hid an exercise + turned Reps off, reloaded, both came
back hidden/off.

#Link drag couples Max & Avg of one exercise (done 29/07/2026, v0.28.0)
**Wrong:** "link drag" moved **every other visible exercise's** Max by the same
delta — dragging Snatch dragged Clean & Jerk and the squats with it. That is
almost never what a coach wants, and the thing they do want (Max and Avg of the
lift they're editing moving together, preserving its spread) was hidden behind
Ctrl.
**Changed:** the toggle is now **"link max & avg"** and couples the two series
of the **dragged exercise only** — in both directions, so dragging Avg carries
Max too. The cross-exercise `linkStarts` path is gone. Ctrl/⌘+drag still does
the same ad-hoc while the toggle is off, and the drag bubble shows both values.
The state is persisted with the macro (see above).

#Chart drags snap to 1 kg (done 29/07/2026, v0.28.0)
**Wrong:** `snapKg` rounded to 2,5 kg, so a coach could not write 118 by
dragging. **Changed:** loads snap to whole kilograms; the header hint now reads
"snaps to 1 kg". Reps (integer) and tonnage (0,1 t) are unchanged, and the fill
guide's own coach-configurable rounding (2,5 kg default, selectable) is a
separate deliberate setting and was left alone.

#"Double-click to focus chart" no longer errors (done 29/07/2026, v0.28.0)
**Wrong:** two defects stacked. (1) `swapTrackedExercisePositions` wrote id1
straight into id2's slot **while id2 still held it** — with
`UNIQUE(macrocycle_id, position)` on the table, that is the reported
`macro_tracked_exercises_macrocycle_id_position_key` violation, and it fired on
*every* column move, not just double-clicks. (2) The ← / → reorder arrows sit
inside the header cell whose double-click focuses the chart and didn't
`stopPropagation`, so double-clicking near them fired two reorders **and** the
focus — which is why the coach met the error while trying to focus a chart.
**Changed:** the swap now parks id1 on a negative sentinel position (derived
from its id, so concurrent swaps can't collide) before moving id2 and landing
id1, and rolls id1 back if the middle write fails — no collision, no row left
parked. Every button in the header cell now stops the double-click, and the
move handlers carry an in-flight guard so a rapid second click can't compute
from the pre-swap list. **Also fixed the same defect class in `addTrackedExercise`:**
it took a caller-computed `max(position)+1`, and the picker deliberately stays
open to add several exercises in a row — so the second add reused the first's
number and hit the same constraint. Position is now resolved from the database,
with one retry on 23505. Verified live: double-clicking a reorder arrow performs
exactly one move, with no error and the chart still open.

#Weekly planner uses the whole window (done 29/07/2026, v0.28.0)
**Wrong:** the day grid is already `repeat(auto-fill, minmax(360px, 1fr))`, but
the planner page was wrapped in `maxWidth: 1600` — and 5 columns need ~1848 px,
so a 2560 px monitor was pinned to 4 unit cards per row with empty margins on
both sides. **Changed:** dropped the cap; the planner is a dense expert surface
and should use the window. Verified live: 4 columns at 1900 px viewport,
**5 at 2400 px**, no horizontal scroll at either.

#Exercise history tooltip shows the reps behind each load (done 29/07/2026, v0.28.0)
**Wrong:** hovering a point on the planner's Load-history chart said
"100 kg · Performed max" and nothing else — a 100 kg single and 100×3×5 read
identically, which is the whole difference between the two sessions.
**Changed:** each week point now carries the **stacked prescription** behind it
for both planned and performed work, and the tooltip is a real card:
SOLL / planned / performed values plus `Planned: 65×3, 78×3, 91×3, 104×2, 117×2,
125×1×2` and the matching `Performed:` line. Performed sets arrive one row per
set, so consecutive equal (load, reps) pairs collapse (`85×2×2`); two sessions
in the same week join with ` · `; `sets = 1` is never rendered, per the
prescription display rule; loads use comma decimals. Planned detail comes from
`prescription_raw` through the canonical `parsePrescription`, so "80x5x3" and
"80 × 5 × 3" normalise the same way. Formatting lives in
`src/lib/loadRepsFormat.ts`, covered by `loadRepsFormat.test.ts` (12 cases).
Verified against real data on Ida Mørck's Stød Dødløft — planned
`65×3, 78×3, 91×3, 104×2, 117×2, 125×1×2` and performed
`65×3, 80×3, 95×3, 105×3, 110×3×2 · 117,5×2×2, …`. **Not driven by a real mouse
hover:** the Browser pane couldn't composite frames in this session, so the
hover gesture itself was not exercised; the data feeding the tooltip was read
off the live chart and the formatting is unit-tested.

#Combination exercises are named in the coach's Log (done 22/07/2026, v0.27.0)
**Wrong:** in the weekly planner's **Log** mode a coach-planned combination
rendered as the name of its **first member** only ("Push press" for
`Push press + Knickstød`). `LogExerciseRow` had a combo-name branch, but only
for **athlete-added** combos, which carry their members in
`training_log_exercises.metadata.combo`. A coach-planned combo keeps its
members in `planned_exercise_combo_members` — a table the whole Log chain
never received, so the row fell back to `planned.exercise.name`, which is the
anchor member. The `Combo` chip was there; the name was wrong.
**Changed:** `comboMembers` (already loaded by `useWeekPlans` for Plan mode) is
threaded `WeeklyPlanner → LogModeView → LogDayCard → LogExerciseRow`, and the
row resolves the name with the planner's own rule —
`combo_notation || members.join(' + ')` — so Plan and Log can't disagree. The
member dots that off-plan combos already showed now render for planned combos
too, and the coach's set-edit modal is titled with the combo name instead of
the anchor. Verified live: Log mode shows "Træk PP + trækbalance + overhead
squat" and "Push press + Knickstød" with their member chips.

#The date picker is European, not the browser's (done 22/07/2026, v0.27.0)
**Wrong:** `DateInput`'s calendar button opened the **native**
`<input type="date">` picker, which renders in the **browser's** locale — on an
en-US profile that is a Sunday-first grid in US date order. So the calendar a
coach saw when creating a macrocycle depended on their machine, not on the
product, and contradicted CLAUDE.md (European standards, weeks start Monday).
**Changed:** new `CalendarPopover` (`src/components/ui`) — EMOS's own month
grid, **Monday-first and DD/MM/YYYY regardless of locale**, with the **ISO week
number** in a leading `W` column (the unit coaches actually plan in), today
outlined, month paging and a "This week" shortcut. `DateInput` uses it instead
of the native picker; with `snapToMonday` (macro start/end) the whole week row
highlights and any day resolves to that week's Monday. All date maths goes
through the UTC-consistent `isoMonday`/`isoAddDays` helpers. Verified live in
Create Macrocycle: header reads `W Mo Tu We Th Fr Sa Su`, weeks 27–32 for July
2026, and clicking Wed 22/07 filled `20/07/2026`.
**Note:** the item said the calendar "starts on a monday … wrong for european
standards", but Monday-first *is* the European convention, so this was read as
the locale-dependent picker being the defect. If something else was meant, say
so — the four remaining native `type="date"` inputs (event form, athlete PR
form, session header, analysis date range) are still browser-rendered and can
be moved onto the same component.

#Macro exercises open their PRs and history (done 22/07/2026, v0.27.0)
**Wrong (missing capability):** while writing macro targets there was no way to
see what the athlete actually lifts. Clicking a tracked exercise in the table's
top banner did nothing; the PR table and the load-history chart existed but only
elsewhere (`/prs`, the planner's exercise dialog).
**Changed:** new `MacroExerciseDetail` — the athlete's PR grid (1RM–10RM, real
values with dates, estimates in italic, e1RM, the Weighted / 1RM-only toggle and
its Δ column) plus the planner's `ExerciseHistoryChart`, which already draws
planned / performed / **SOLL** against this cycle's targets. Both are the
existing modules (`lib/prTable`, `ExerciseHistoryChart`), reused rather than
rebuilt. It opens from **two** places: the exercise name in the macro table's
header band, and the colour dot on its toggle chip (the chip label keeps
toggling visibility — the existing behaviour is untouched). It honours the
coach's **Layout preference**: centered dialog or side panel. Group macros
without an athlete in view say so instead of rendering an empty table.
Extracted `AdaptiveDialog` (`src/components/ui`) for the dialog-vs-side-panel
decision and moved the planner's two hand-rolled copies onto it, so
`dialog_mode` is now honoured in one place. Verified live on Emma Munch's
"Sommer 26": header → panel with e1RM 70 kg, real 1RM on 20/07, and the W1–W11
history with the "This week" marker.

#Macro import/export reviewed — 6 fixes (done 22/07/2026, v0.27.0)
Reviewed both Excel paths end to end. Findings, all fixed:
* **The round trip imported nothing (the headline bug).** Export writes
  `"<code> (Target)"` / `"<code> (Actual)"` over each exercise's column block;
  import matched that whole cell against the exercise code, so `"SN (Target)"`
  never found `SN`, `currentTe` stayed null and **every** column was skipped —
  a file EMOS had just exported imported **0 rows**, silently. Now a shared
  `splitExerciseHeader` (`macroExcelHeaders.ts`, unit-tested) splits code from
  suffix, and the `(Actual)` block is explicitly skipped: those are derived
  values, never plan input. The Summary sheet is skipped too.
* **`Template (%)` could export kilograms in a `%` column.** The conversion
  divided by the exercise's own `athlete_prs` row and, when there was none —
  no PR, or a **group** macro with no athlete at all — silently left the raw
  **kg** in the cell. Re-importing that as kg multiplied it by PR/100. It also
  ignored `pr_reference_exercise_id`, which the *import* side honours, so a
  derived exercise round-tripped against the wrong anchor. Now export resolves
  through the PR reference exactly as import does, blocks the group case with an
  explanation, lists the exercises with no PR for confirmation, and writes an
  **empty cell** rather than a wrong number.
* **Template import silently dropped the week rhythm.** `weekType`, `weekLabel`
  and `totalReps` were parsed into `TemplateWeekData` and then never used — so
  the exported "Type" and "Total Reps" columns round-tripped to nothing. Now
  imported (opt-out checkbox) via `bulkUpdateWeeks`; a `week_type` is only
  applied when the abbreviation exists in the coach's own week-type settings, so
  an import can't inject a type the cycle has no definition or colour for.
  `week_type_text` is deliberately **not** written — `week_type` has been the
  single source of truth since 0.24.0.
* **Import was one HTTP round-trip per field.** Rows arrive one field at a time
  (5 per exercise per week), so a 12-week × 6-exercise file was ~360 sequential
  upserts against a stale `targets` snapshot. Now folded to one row per
  (week, exercise) and written with the existing `bulkUpsertTargets` — a handful
  of requests.
* **`Exercises:` parsing broke on commas.** The template's exercise list is
  comma-joined in Template Info, so a name containing a comma split into codes
  that mapped to nothing. The data sheets' column headers are now the
  authoritative list, with Info-only codes appended.
* **Unhandled rejection.** `handleExportTemplate` is async and was called
  un-awaited from `onClick`; a failure escaped into `error_logs` instead of
  telling the coach. Now caught and surfaced.
  *(Verified: `splitExerciseHeader` covered by `macroExcelIO.test.ts`, 5 cases;
  the other fixes are typechecked and build-clean but were not driven through a
  real file upload in the browser.)*

#Empty exercise categories are visible (done 22/07/2026, v0.27.0)
**Wrong:** in the exercise library's List and Grid views, categories with no
exercises were hidden behind a "N empty categories hidden · Show" link that
defaulted to **hidden** — so a category the coach had *just created* was
invisible, and there was no way to put the first exercise into it. (Tree view
already showed them as drop targets.)
**Changed:** empty categories are shown by **default** (the toggle still hides
them for coaches who want a tight list), and an empty section now renders
"Empty category. **Add an exercise here** or drag one in from Tree view" — the
link opens the create form with **that category preselected** (new optional
`initialCategory` on `ExerciseForm` / `ExerciseFormModal`). Verified live on a
real empty category ("K3: Hiv"): it now appears with count 0, and the link opens
the form with Category = K3: Hiv.

#"Open unit" lands on the unit, with the comment open (done 22/07/2026, v0.27.0)
**Wrong:** the Inbox's "Open unit" navigated to `/planner/<week>` — plan mode,
no day, no comment. Two causes: `ChatPane` never received the session's slot, so
it had **no day index at all** and guessed the week from the *performed* date
(which can fall outside the week the unit was planned for), and it passed none
of the deep-link params the planner already supports.
**Changed:** the resolved `SessionSlotRef` (`week_start` + `day_index`, already
fetched for the thread labels) is passed into `ChatPane`, and the jump is now
`/planner/<week_start>?mode=log&day=<n>&comments=1`. The new `comments` param
opens that day's session thread and scrolls to it (a long day would otherwise
leave the comment below the fold). Verified live: from Asger Søderberg's session
thread, "Open unit" landed on `2026-05-25?mode=log&day=5&comments=1` with Unit 5
expanded and "Session comments (2)" open on the message that was clicked.

#Plan: one exercise catalogue shared by two coaches (done 22/07/2026, v0.27.0)
Written to `docs/SHARED_EXERCISE_CATALOGUE_PLAN.md`. Summary: catalogues are
per-coach today (`exercises.owner_id`), so "Snatch" has a different `id` per
coach and cross-coach analysis can't group. Recommended path is to share a
catalogue the same way athletes are already shared — a
`exercise_catalogue_collaborators` table mirroring `athlete_collaborators`, plus
`getCatalogueOwnerId()` next to the two existing owner resolvers — which makes
the ids identical **by construction** and needs no change to the analysis layer.
Phase 2 is the risky part: a transactional `adopt_exercise_catalogue` RPC that
remaps every FK (`planned_exercises`, logs, `athlete_prs`,
`macro_tracked_exercises`, templates) **and** the two self-references
(`parent_exercise_id`, `pr_reference_exercise_id`) for coaches who already
diverged, with a dry-run report first. Alternatives (a `canonical_exercise_id`
mapping, a global system catalogue, a first-class `exercise_libraries` table)
are compared in the doc, with three open questions for the coach at the end.
**Revised same day** with the coach's answers — core + personal catalogues, and
a **club-level** catalogue object rather than one coach's library borrowed by
the other. The doc is now a decided design: `exercise_libraries` (every
catalogue is a row, including each coach's personal one) +
`exercise_library_members`, `getVisibleLibraryIds()` replacing the single-owner
read, and a 4-phase rollout whose Phase 1 lands as a **no-op**. Key finding
from the live data: moving an exercise between libraries **preserves its id**,
so seeding the club catalogue costs zero FK rewrites — only the coaches who
*adopt* pay (Toke alone is ~1 250 foreign keys). Simon and Toke already share
15 same-named exercises, so this is not greenfield. Four follow-up questions at
the end of the doc; **nothing is built** — execution is gated on approval.

#Text-type exercise no longer shows a "0%" done label (done 20/07/2026, v0.26.1)
**Wrong:** the athlete day-preview badge (`SessionPreview`) showed a compliance
`%` next to "Did" computed as performed-reps ÷ planned-reps. A "Text"-type
exercise (unit `free_text` / `other`, or any exercise whose prescription parses
to no numeric reps) has **zero** planned reps, so the ratio was always 0 — once
the athlete logged/marked it done it rendered a **green "0%"** on fully-done
work. **Changed:** the `%` badge is now gated on `plannedReps > 0` — with no
numeric target there is nothing to compute a compliance ratio against, so no
badge is shown (completion is already signalled by the DoneChip by the exercise
name). Legitimate numeric exercises are unaffected. Verified live: real
compliance badges still render (108%, 100%…) and no "0%" appears; no current
data has a non-numeric plan *with* logged sets to show the exact before/after,
but the guard is correct by construction and causes no regression.

#Exercise note shows before the prescription (done 20/07/2026, v0.26.1)
**Wrong:** the coach's exercise note (`plannedNote` = `notes`/`variation_note`)
rendered **below** the prescription on every surface. Athletes start on the
numbers and read the note (which qualifies the variation) later. **Changed:**
the note now renders **above** the prescription across the display/read
surfaces: `SessionPreview` (athlete Today/Week + all field detail screens — one
edit, 7 screens), `ExerciseLogCard` (athlete edit card, note also un-truncated
so the full variation is readable), planner `DayCard` (both combo + normal
branches), `PrintWeek`, `PrintWeekDesigner`, the coach `LogExerciseRow`, and the
`TemplatePreviewDialog` / `ClipboardWeekPreviewDialog` previews. Verified live:
DOM order is name → note → prescription in both the planner and the athlete
view. **Left as-is (deliberate):** the editable forms `DayEditor` and
`TemplateEditor` (moving an editable field changes authoring ergonomics) and
`ExerciseDetail`, which already shows the note above. `CompactSessionTable` and
`WeekCategoryTable` carry no note (would need a data-model change). Easy to
extend to the editors if wanted.

#Message notification badge clears when read in Log mode (done 20/07/2026, v0.26.1)
**Wrong (re-report after 0.24.1):** the 0.24.1 fix wired the read-state channel
into the two count-badge hooks and fixed the inbox threads, but the coach's
**main** workflow — reading an athlete's session comment in the planner **Log
view** — had **no mark-read path at all**. So `coach_read_at` stayed null, and
the sidebar/Inbox "unread" badge never cleared no matter how many times the
coach read the comment. **Changed:** `LogDayCard` now marks the session read
(`markMessagesRead`, which emits `onInboxChanged`) the moment the coach opens
the comment thread — so the badge clears immediately. Also subscribed the two
inbox **list** views (`CoachInbox`, `FieldInboxScreen`) to `onInboxChanged` so
their per-athlete unread counts stay in sync when read happens elsewhere.
Verified live: opening Ida's Unit-2 comments in Log mode dropped the sidebar
from "Inbox 3" → "Inbox 2" instantly and wrote `coach_read_at` (restored after,
since it was a real unread message I only opened to test). The athlete side was
left as-is: it marks read on entering a day's edit mode (deliberate, UF-10/E3)
and currently has 0 unread; its session-message-vs-badge breadth is noted below
as a follow-up.

#Text prescription box grows as you type (done 20/07/2026, v0.26.1)
**Wrong:** when a coach set an exercise's prescription to free text (unit
`free_text`), the editor was a fixed 2-row `textarea` with `resize: none`, so a
long note was clipped/scrolled and hidden. **Changed:** added a reusable
`AutoGrowTextarea` (`src/components/ui`) that grows to fit its content (height =
scrollHeight on every input/render, `overflow: hidden`), and applied it to the
free-text prescription editor (`PrescriptionGrid`) and the related "Text
content" editor (`ExerciseDetail`). Verified the growth mechanism live
(42 px → 281 px as lines are added). Reusable for the other fixed textareas
(media descriptions) if wanted.

#Two mobile chat views share one component (done 16/07/2026, v0.24.3)
Follow-up to the 0.24.2 `useThreadChat` consolidation, which unified the thread
*logic* but left three copies of the *presentation*. The two mobile views —
the athlete app's coach thread (`CoachThreadScreen`) and the coach field app
(`FieldConversationScreen`) — had near-identical Tailwind for the message list,
loading spinner, empty state, bubble, error strip and composer, plus their own
copies of `Bubble` and `formatStamp`.
**Changed:** extracted `src/components/chat/MobileThreadPane.tsx` — the shared
list + composer (it calls `useThreadChat` itself; the surface passes the hook
config plus a few presentation props: `senderLabelFor`, `emptyHint`,
`placeholder`, `onAttach`/`attachLabel`, `safeArea`). Each surface keeps only
its own chrome: the athlete app wraps the pane with a header + session-
discussions panel, the field app's parent renders those above it. `Bubble`,
`EmptyChat` and `formatStamp` now exist once. Net −~300 duplicated lines across
the two screens for +164 shared.
Two small unifications settled in the shared version: the error now renders as a
strip **below** the list rather than replacing it (a failed send no longer
blanks the athlete's conversation, matching the field app), and left-bubble
(other-party) name labels are accent-coloured on both surfaces (previously only
the athlete app tinted them). The desktop coach inbox stays separate — it is
inline-token styled, a different rendering system, as decided in 0.24.2.
Verified live on both surfaces: athlete sees coach bubbles left + blue "Simon",
own right; field coach sees athlete bubbles left + blue "Ida Mørck", own "You"
right with safe-area padding; send blanks neither. typecheck + 707/707 tests +
eslint clean.

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
