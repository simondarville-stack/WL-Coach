# EMOS — Project Context for Claude Code

## What EMOS is

EMOS (Erfolg Muss Organisiert Sein) is an Olympic weightlifting (OWL) coaching
web application. The name **EMOS is fixed and must never be changed** by any
agent. Interface text stays English; i18n infrastructure is a future concern
and currently out of scope.

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
- Default to inline editing and dense tables over modals; multi-step/wizard
  flows need a justification (a genuinely sequential task), not permission.
- Information density and low interaction cost beat whitespace and marketing
  polish — these are expert tools.
- Styling uses Tailwind CSS and `lucide-react` icons **only** (details in the
  design-system section). Keep it professional, minimal, and compact; avoid
  cookie-cutter SaaS aesthetics.
- Use consistent numeric formatting across tables and views (comma decimals;
  see Stack).

## Claude's role — co-designer, not just implementer

EMOS is in a **fuzzy front end**: the shape of the product is still being
discovered. Claude is expected to act as a **co-designer** of the application,
not only as an executor of instructions.

- **Explore, then converge.** Don't silently build unrequested features — but
  DO surface them. When a task reveals an adjacent capability, a richer
  variant, a domain opportunity a coach would value, or a simplification the
  user may not have seen, say so explicitly.
- For feature work, end replies with a short **Ideas** note (1–4 bullets) when
  there is something worth surfacing: possibilities the current change opens
  up, alternatives considered, or gaps noticed along the way. Skip it when
  there is genuinely nothing to add — an empty ritual is noise.
- Ambitious options presented **alongside** the simple implementation are
  welcome; unspoken ones are the failure mode. Recommend, don't just enumerate.
- Challenging a requirement is allowed: if a request seems to fight the
  product's grain (density, coach flexibility, planned-vs-logged separation),
  say so and propose the variant that fits.

## Module map & status

All modules are **active** — nothing is currently disabled or hidden:

- Athlete and training-group definition
- Macro cycle planning
- Weekly programme writing (`src/components/planner/*`, `WeeklyPlanner.tsx`)
- Printing weekly programmes
- Training Log — coach **Log mode** toggle on the Weekly Planner
  (`src/components/planner/log/*`) plus the mobile athlete app
  (`src/athlete/v2/*`). The old standalone `/training-log` and `/athlete-log`
  routes redirect to the dashboard.
- Analysis module (`src/components/analysis/*`, `src/lib/analysis/*`) —
  rebuilt and actively developed, reachable at `/analysis` with a Sidebar
  entry. (It was hidden for a while; any old "hide Analysis" instruction is
  obsolete — re-disabling it would be a regression.)
- Coach/athlete **Inbox & messaging** (`/inbox`, coach + athlete inboxes) —
  added in 0.6.0.

**Deletion policy:** shipped code and database tables are never deleted
without explicit instruction. **Carve-out for failed experiments:** once the
user has declared an experiment dead (or asks for a prototype to be torn
down), its code may be removed without further ceremony — say what was
removed in the reply.


## Core principles (staged: hard at ship time, flexible mid-exploration)

Principles 1 and 2 are **convergence targets, staged by maturity**: a
prototype may take the shortcut if the shortcut is *flagged*; anything that
settles and ships must satisfy the full rule. Principles 3 and 4 apply always.

1. **Coach-flexibility over hardcoding.** Any OWL concept a coach might
   legitimately define differently should be runtime-configurable. Red flags:
   `enum WeekType { HIGH, LOW }`, hardcoded zone boundaries, fixed rep
   schemes, hardcoded exercise categories, OWL labels embedded in components.
   *Exploration staging:* a hardcoded first version is fine while a feature is
   being tried out — mark it `// COACH-CONFIG candidate` and avoid data shapes
   that would make later parameterization painful. Parameterize when the
   feature settles; if in doubt at ship time, parameterize.
2. **API-first internal architecture.** The React client consumes a clean
   data/service layer (typed Supabase queries + hooks). Domain logic
   (stress formulas, lift ratios, load math) lives in dedicated modules, not
   in components. No direct Supabase calls from presentational components.
   *Exploration staging:* a spike may inline a query or a formula to test an
   idea — tag it (`// TODO extract to hook/lib`) and lift it into the layer
   when the feature settles.
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

- Substantial features are built on `feature/<topic>` branches and merged to
  `main` with the version bump (see Versioning). Small fixes may go straight
  to `main`.

## Supabase & migrations

- Claude **may apply migrations directly** via the Supabase MCP server
  (`apply_migration`) — no per-call approval needed.
- Every schema change is still captured as a migration (never ad-hoc DDL via
  `execute_sql`), so the migration history stays complete. Mention applied
  migrations in the reply.
- **Destructive migrations** (dropping tables/columns that hold real data,
  irreversible rewrites) still require explicit confirmation first — the
  failed-experiment carve-out above applies to those too.

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
- When requirements are ambiguous: build the simplest implementation that
  satisfies them and ask for clarification in the next step instead of
  guessing. Don't *silently* build unrequested behaviour — but per the
  co-designer role above, do surface richer variants and adjacent
  possibilities as explicit proposals.

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

## Historical artifacts

- The one-time EMOS specialist review team (2025) is **retired**; its agent
  definitions are archived under `docs/history/agents/`. Ad-hoc reviewer
  agents can be composed on demand when a review is requested — scope always
  comes from this file, never from an archived agent definition.
- `review/`, `REVIEW.md`, and `REFACTOR_ROADMAP.md` are review artifacts, not
  production code. `REVIEW.md`/`REFACTOR_ROADMAP.md` are the most recent
  (2026) review outputs; roadmap execution is gated on user approval.
- Executed one-shot build prompts and completed design docs live under
  `docs/history/` — they are provenance, **not** live guidance. When a
  history doc contradicts this file, this file wins.

## Auth & access (roadmap)

An **authentication gate ships in a later phase** — possibly governed by a
subscription model. Until then: do not enforce RLS or add auth gating unless
explicitly asked; the interim soft-gating (athlete access codes, coach-root
gate) stays. New tables should keep following the `owner_id` pattern so the
future auth/RLS phase doesn't require schema surgery.

## Standing anti-goals

- Do not modify the string "EMOS" anywhere.
- Do not modify branding assets (logos, SVGs in `Branding/`).
- Do not introduce i18n infrastructure.
- Do not enforce RLS or add auth gating on your own initiative (see Auth &
  access above).
- Do not re-disable or hide Analysis, the Training Log, or the Inbox — these
  modules are active.
