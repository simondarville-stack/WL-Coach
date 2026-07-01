# EMOS — Project Context for Claude Code

> **Save this at your repo root.** If you already have a `CLAUDE.md`, merge
> the sections below into it rather than overwriting.

## What EMOS is

EMOS (Erfolg Muss Organisiert Sein) is an Olympic weightlifting (OWL) coaching
web application. The name **EMOS is fixed and must never be changed** by any
agent. Interface text stays English; i18n infrastructure is a future concern
and not in scope for this review.

It is an **expert-oriented** training-planning **and monitoring** system; its
users are coaches and athletes with high domain knowledge. Prioritise
information density, clarity, and low interaction cost over spacious or
"marketing-style" layouts.

## Stack

React 18 · TypeScript (strict) · Vite · Tailwind CSS · Supabase (Postgres;
Auth + RLS are future phases) · Recharts. German locale conventions apply only
to user-facing numeric formatting (comma decimals); UI labels remain English.

**Always use European standards for dates, times, and weeks.** Times are
24-hour (e.g. `16:00`, never `4:00 PM`). Dates are day-first
(`DD/MM/YYYY` / `DD/MM`), never US month-first. Weeks start on Monday. Any
new date/time UI, presets, parsing, or formatting must follow these
conventions.

## Product & UX principles

- Prefer compact tables, tight spacing, and a scan-friendly hierarchy.
- Avoid wizard flows and unnecessary modals; use inline editing where it fits.
- Information density and low interaction cost beat whitespace and marketing
  polish — these are expert tools.
- Styling uses Tailwind CSS and `lucide-react` icons **only** (details in the
  design-system section). Keep it professional, minimal, and compact; avoid
  cookie-cutter SaaS aesthetics.
- Use consistent numeric formatting across tables and views (comma decimals;
  see Stack).

## Current review scope

**IN SCOPE — agents may audit and propose modifications:**

- Athlete and training-group definition
- Macro cycle planning
- Weekly programme writing (`src/components/planner/*`, `WeeklyPlanner.tsx`)
- Printing weekly programmes
- Training Log — **shipped and live**: coach **Log mode** toggle on the Weekly
  Planner (`src/components/planner/log/*`) plus the mobile athlete app
  (`src/athlete/v2/*`). The old standalone `/training-log` and `/athlete-log`
  routes now redirect to the dashboard. (`TRAINING_LOG_PLAN.md` was the build
  plan; the rebuild is done, so it can be removed.)
- Analysis module (`src/components/analysis/*`, `src/lib/analysis/*`) —
  **re-enabled and actively developed**, reachable at `/analysis` with a
  Sidebar entry.
- Coach/athlete **Inbox & messaging** (`/inbox`, coach + athlete inboxes) —
  added in 0.6.0.

**OUT OF SCOPE / disabled:**

- Nothing is currently disabled — all modules are active. Analysis was
  previously hidden, but it has since been rebuilt and re-enabled, so the
  earlier "hide every Analysis nav entry/route" rule **no longer applies**.
  Do not re-disable Analysis or the Training Log; that would be a regression.
  Existing code and database tables for any feature must still never be
  deleted without explicit instruction.


## Non-negotiable principles

1. **Coach-flexibility over hardcoding.** Any OWL concept a coach might
   legitimately define differently MUST be runtime-configurable. Red flags:
   `enum WeekType { HIGH, LOW }`, hardcoded zone boundaries, fixed rep
   schemes, hardcoded exercise categories, OWL labels embedded in components.
   If in doubt, parameterize.
2. **API-first internal architecture.** The React client consumes a clean
   data/service layer (typed Supabase queries + hooks). Domain logic
   (stress formulas, lift ratios, load math) lives in dedicated modules, not
   in components. No direct Supabase calls from presentational components.
3. **Single source of truth per concept.** If two files encode the same OWL
   decision, consolidate.
4. **Last-write-wins with timestamps** for any collaborative scenario. No
   real-time sync work.

## Data integrity (planned vs. logged)

- Planned data is **coach-authored** and is **read-only in athlete-facing
  views**. Athletes never edit the plan.
- Athlete input is stored **separately as logs** (`training_log_*`) and must
  **never overwrite planned data**. Planned and performed are distinct records;
  compliance and deltas are derived by comparison, not by mutation.

## Prescription notation

Canonical logic lives in `src/lib/prescriptionParser.ts` (parsing) and
`src/components/planner/StackedNotation.tsx` (display) — don't fork it.

- **Input grammar:** `load × reps` implies `sets = 1`; `load × reps × sets`
  defines sets explicitly; comma-separated segments are allowed (e.g.
  `80×3, 85×2×3`). Combos carry `+`-tuple reps (e.g. `80×1+2×3`).
- **Display:** when `sets = 1`, never render the sets indicator.
- **Stacked Load Notation** (load above, reps below a divider, sets to the
  right) is the canonical read-only visual for kg / % / RPE, shown where
  enabled per exercise.

## Branch strategy

- Reviewer and synthesizer agents are read-only.
- Implementer creates a dedicated branch `feature/review/<YYYY-MM-DD>` off the
  current working branch. Do not push. Do not merge. Leave commits for manual
  review.

## Supabase & migrations

+ Migrations are never applied without explicit per-call user approval.
+  Agents may apply migrations only via tools that surface a confirmation
+  prompt to the user (e.g. the Supabase MCP server). Agents never apply
+  migrations via raw psql, scripts, or any path that bypasses the
+  per-call prompt.

## Code conventions

- TypeScript strict. No `any` without justification.
- Conventional Commits: `feat(...)`, `fix(...)`, `refactor(...)`, `chore(...)`.
- When a component has accumulated iteration debris (stale state, dead
  imports, commented code) and the debris-to-logic ratio is high, prefer a
  rewrite over incremental patching. Mark it explicitly as a rewrite
  candidate in the plan.

## Working style & scope

- Build in small, incremental slices; reuse existing data models, naming, and
  structures rather than inventing parallel ones.
- Do not rename or delete existing fields unless explicitly instructed.
- New packages and UI libraries are permitted when they are clearly the right
  tool — well-maintained, reasonably lightweight, MIT/permissively licensed, and
  not duplicating something already in the stack. Reuse first; when you do add a
  dependency, call it out with a one-line rationale. Still avoid introducing new
  *architectural patterns* casually — prefer the existing ones unless there is a
  clear, stated reason.
- When requirements are ambiguous: choose the simplest implementation that
  satisfies them, do not invent features or behaviours, and ask for
  clarification in the next step instead of guessing.

## Versioning

The single source of truth is the `version` field in `package.json`; Vite
injects it (plus git SHA + build time) so the running app shows it (sidebar,
hover for full provenance) and error logs carry it. See `src/lib/version.ts`.

Claude owns version bumps — bump as part of the change that ships, in the same
commit, before merging to `main`. EMOS is in beta, so stay on the `0.x` line
(`0.MINOR.PATCH`):

- **MINOR** (`0.1.0 → 0.2.0`) — any user-facing feature or new capability.
- **PATCH** (`0.1.0 → 0.1.1`) — bug fixes, refactors, chores, copy/UI tweaks.
- When a single ship mixes both, take the highest applicable bump (a feature
  wins → MINOR), and reset PATCH to 0.
- Reserve `1.0.0` for the first stable (post-beta) release; do not cross to
  `1.x` without explicit user approval.

Bump exactly once per ship (one merge to `main`), not per intermediate commit.
Mention the new version number in the reply when merging.


## UI & Design-System conventions

> **Status: guidance, not gates.** EMOS is in an active develop-and-explore
> phase — trying things out and finding out is expected and encouraged. The
> notes below describe the direction we want to *converge on* for a coherent
> product; they are **not** blockers. Hand-rolling UI, raw Tailwind, bespoke
> components, and quick experiments are all fine while iterating. Don't let
> these conventions stop you shipping an idea to see how it feels. We'll tighten
> and refactor toward them deliberately once the shape of a feature settles —
> not mid-exploration.
>
> A few genuinely useful bits below are correctness/product facts (the Tailwind
> `var()` footgun, European dates, don't-recolour data-driven colours) — keep
> those in mind because getting them wrong is a bug, not a style choice.

### Shared primitives (prefer, don't force)

- **Buttons / pages:** prefer `Button` and `StandardPage` from
  `src/components/ui` when they fit — they keep things consistent for free. But
  a hand-rolled control while prototyping is fine; converge later.
- **Brand accent** is `var(--color-accent)` (`#185FA5`), not Tailwind `blue-600`
  (`#2563EB`) — worth using the token so the app reads as on-brand, but not a
  hard rule during exploration.

### Colour tokens (preferred for chrome, optional while iterating)

- For neutral chrome, the CSS custom properties in `src/styles/tokens.css`
  (`--color-text-primary/secondary/tertiary`, `--color-bg-primary/secondary/
  page`, `--color-border-*`, `--color-accent*`, `--color-danger-*`,
  `--color-success-*`) are preferred because they theme (dark mode) and don't
  drift. Raw `gray-*/blue-*/slate-*` is acceptable while trying things out;
  tokenise when a component settles.
- **Tailwind footgun (real silent bug — worth remembering):** for
  `border`/`ring`/`outline`/`divide` colours via a CSS var you MUST add the
  `color:` hint — `border-[color:var(--token)]`. Bare `border-[var(--token)]`
  is parsed as a *length* and renders wrong. `bg-[var(--token)]` and
  `text-[color:var(--token)]` are the safe forms; the `/opacity` modifier
  doesn't resolve on an arbitrary `var()`.

### Don't recolour data-driven / semantic colour (correctness)

Leave anything that encodes meaning: phase / week-type colours, chart & SVG
series colours, heat/value colouring, `type="color"` values, competition-type
badges, category shades (`getExerciseCategoryShade(...)`). These are data, not
chrome — swapping them for neutral tokens is a bug. When unsure, leave it.

### Dates (product requirement) & chips

- **Dates:** format via `src/lib/dateUtils.ts` (`formatDateShort` → `DD/MM`,
  etc.). European day-first, 24h, Monday-first (see Stack) is a firm product
  requirement — don't hand-write a US-style formatter.
- **Chips/badges:** a chip that appears on *every* row carries no signal —
  prefer chips for actionable, non-obvious info, and a `title` tooltip for terse
  jargon. Guidance, not a gate.

### Verify

Run `npm run typecheck` and `npm run build` after a change group and skim the
diff (handlers/`onClick`/`disabled`/`title` preserved, no unused imports, no
data colour recoloured). This is about not shipping breakage, not about style.

## Review workflow artifacts (shared convention between agents)

All review agents share this filesystem layout at the repo root:

```
review/
  findings/
    ux.md              # written by emos-ux-reviewer
    engineering.md     # written by emos-engineering-reviewer
    domain.md          # written by emos-domain-reviewer
    data.md            # written by emos-data-reviewer
REVIEW_PLAN.md         # written by emos-synthesizer, read by user & implementer
```

- Specialist reviewers write ONLY to their own file under `review/findings/`.
- The synthesizer reads all four specialist reports and writes `REVIEW_PLAN.md`
  at repo root. It is the only agent that writes `REVIEW_PLAN.md`.
- The implementer reads `REVIEW_PLAN.md` and writes code. It does not read or
  modify the specialist reports.

The `review/` directory is an artifact folder, not production code. It may be
committed for traceability or gitignored — user's preference.

## Anti-goals for this review

- Do not modify the string "EMOS" anywhere.
- Do not modify branding assets (logos, SVGs in `Branding/`).
- Do not introduce i18n infrastructure.
- Do not enforce RLS or add auth gating (future phase).
- Do not re-disable or hide Analysis, the Training Log, or the Inbox — these
  modules are now active and in scope.
