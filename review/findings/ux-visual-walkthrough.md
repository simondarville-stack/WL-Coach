# EMOS — Live Visual UX Walkthrough (2026-05-31)

Companion to `review/findings/ux.md` (code audit). This file records findings
from a live Chrome walkthrough of the running app at `localhost:5173`, judged
against the S-tier SaaS design checklist (Stripe / Linear / Airbnb). Viewport
tested: ~1098×427 (the user's actual usable screen) plus the taller dashboard
render.

Goal framing from the user: make EMOS look **professional, not "vibe-coded"**,
**remove chips that add no value**, and keep **consistent UI logic + buttons**
so it stays intuitive.

## User stories walked

1. Coach lands on Dashboard and triages the squad → `/dashboard`
2. Coach manages the athlete roster → `/athletes`
3. Coach writes a weekly programme → `/planner` → week → day editor
4. Coach plans a macro cycle → `/macrocycles` (year wheel)
5. Coach defines a training group → `/training-groups`
6. Coach prints a weekly programme → Print Preview

---

## Visual findings (V-series — new, not in code audit)

### V-A — Sidebar nav is not scrollable; primary links vanish at normal laptop heights — **HIGH**
On every route except the Dashboard, the middle nav group (Dashboard, Weekly
planner, Programme templates, Macro cycles, Calendar, Athletes, Training
groups, Inbox, PRs, Settings, …) renders only the section *headers* — the links
themselves are not visible, and the sidebar does not scroll. TOOLS is pinned to
the bottom; the nav between ENVIRONMENT and TOOLS is clipped. DOM confirms the
route renders a *reduced* link set (6 links on `/athletes` vs 14 on
`/dashboard`). Net effect: at a short browser window a coach cannot navigate
between core modules from the sidebar at all. This is the single biggest
"feels broken" issue. Fix: make the nav column `overflow-y: auto` with the
TOOLS block either inside the scroll area or as a sticky footer; ensure the
full link set renders on every route.

### V-B — Duplicate period-navigation rows in the week overview — **HIGH (vibe-coded tell)**
The planner week overview stacks **two** period navigators directly on top of
each other:
- Row 1: `‹ Earlier   [Today]   Later ›`
- Row 2: `← Earlier   2026-04-20 → 2026-07-12   Today   Later →`
Same function, two visual styles, two different arrow glyphs (`‹` vs `←`).
This reads as leftover iteration debris. Collapse to one navigator.

### V-C — Three different date formats on one screen — **MEDIUM**
Within the planner: `Apr 27 — Jun 26` (US-style month-abbrev), ISO
`2026-04-20 → 2026-07-12`, and `27 Apr` / `4 May`. Print uses `01-07/06/2026`.
CLAUDE.md mandates European day-first. Pick one format (`DD.MM.YYYY` /
`DD–DD.MM`) and apply it everywhere via a shared date formatter.

### V-D — Unlabeled metric numbers under day cells — **MEDIUM**
Each day cell in the week grid shows two/four bare numbers (e.g. `53 19`,
`37 19 110 81`) with no column header or unit in view. A coach cannot tell if
these are sets, reps, tonnage, or intensity. Add a tiny inline label/legend or
a header row, or show on hover.

### V-E — Dashboard "mystery dot" next to athlete names — **MEDIUM (unclear chip)**
Several athletes show a small orange/amber dot after their name on the
dashboard table with no legend. Either give it a tooltip + legend (if it means
"attention/flagged") or remove it. Decorative-looking status with no key is
exactly the kind of noise to cut.

### V-F — Repetitive "TRAINING LOGGED" chip on every activity row — **MEDIUM (low-value chip)**
The Activity feed stamps a green `TRAINING LOGGED` pill on literally every row.
When every item has the same chip, the chip carries no information. Drop it (or
reserve a chip only for the *exception* events), and lean on the green check
icon already present.

### V-G — "RAW 11/12" chip is unexplained — **LOW/MEDIUM (unclear chip)**
Appears on the dashboard roster and the activity feed. Meaning (readiness?
RPE? a wellness score out of 12?) is not discoverable. Label it or tooltip it.

### V-H — Dashboard roster shows a long plain "Loading…" — **MEDIUM**
The athlete table sat on centered "Loading…" text for ~2s with layout shift
when data arrived. Replace with a skeleton table. (Corroborates code U-17 for
the planner overview — same pattern, two places.)

### V-I — Inconsistent count badges on tabs — **LOW**
Dashboard "Athletes / Groups" tabs: the **Groups** tab has a `2` count badge,
**Athletes** does not. Either both show counts or neither.

### V-J — Training Groups: title duplication, truncated names, unguarded delete — **MEDIUM**
- The page H1 "Training Groups" duplicates the top-bar title "Training groups".
- Group names truncate hard ("Konk…") because three inline action icons
  (share / card / delete) crowd the row.
- The red trash icon deletes inline with no visible confirmation guard — risky
  for a destructive action. Move destructive actions behind a kebab menu or add
  a confirm step; give the name room.

### V-K — Odd microcopy: "Section by group · 0 athletes / 4 athletes" — **LOW**
The dashboard "Section by group" checkbox is paired with a count that reads
awkwardly. Rephrase ("Group by training group").

### V-L — Inconsistent empty-value glyphs — **LOW**
Empty week metrics panel mixes `—` and `0` for the same "no data" state
(Reps `— 0`, K `— —`). Pick one representation for "no data".

### V-M — Macro year-wheel: striking but inefficient — **MEDIUM**
The radial year calendar is a signature visual, but it occupies the full
viewport (heavy scrolling to see the whole ring) and the phase labels are set
*along the curved arc* ("Opbyg DM Hold 2026") which is hard to read. Consider a
compact wheel + a linear timeline/table beside it, and horizontal labels.

### V-N — Athletes list: blue TOTAL numbers look clickable but aren't — **LOW**
The `TOTAL` column renders the number in accent-blue, which signals a link.
Either make it a link to the athlete's PRs or use neutral emphasis (bold,
not blue).

---

## Corroborated code findings (visually confirmed)

- **Macro module hardcoded blue** (code U-06/U-11): the `+ New macrocycle`
  button and wheel legend render in literal `bg-blue-600` blue — visually a
  slightly different blue from the rest of the app. Confirmed on screen.
- **Combo chip redundancy** (code U-01/U-03): confirmed in the day editor and
  in Print Preview — `Stødvend + Knickstød` carries a `Combo` chip while the
  line *directly below* already spells out the combo members. Pure noise.
- **Print blue summary box** (code U-15): the SETS/REPS/LOAD box prints as a
  faint blue fill (`bg-blue-50`) — would wash out on a mono laser printer.
- **Gradient page backgrounds** (code U-12): Athletes + Training Groups use a
  slate gradient wrapper not used anywhere else — subtle "different app" feel.

## What already looks professional (keep)

- The athlete-picker (`Select an athlete to continue`, grouped by team) is
  clean and is consistently reused across Planner and Macro cycles.
- The Print Preview output is genuinely "Fachsoftware"-grade: dense per-category
  sets·reps·kg summary, European dates, tidy exercise rows.
- Two-pane day editor with min–max prescription boxes + italic coach notes is
  coherent and information-dense in a good way.
- Training Groups empty state ("Select a group to view members" + icon) is well
  done.
