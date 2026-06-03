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
- Training Log (rebuild in progress — see `TRAINING_LOG_PLAN.md`)

**OUT OF SCOPE — disable in UI, keep code intact, do not delete:**

- Analysis module

Agents must hide every nav entry, route, and reachable entry point for the
out-of-scope modules. The underlying code and database tables remain for
future reactivation. Deleting them is a SCOPE VIOLATION.

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
- Do not introduce new packages, UI libraries, or architectural patterns
  unless explicitly requested.
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

> Distilled from the 2026-06 UX/design review. The goal is a professional,
> coherent product — not a "vibe-coded" patchwork. Follow these for any UI work.

### Use the shared primitives — never hand-roll

- **Buttons:** always use `Button` from `src/components/ui` (re-exported via the
  `ui` barrel). Variants: `primary | secondary | ghost | danger`; sizes
  `sm | md | lg`; props `icon`, `iconPosition`, `iconOnly` (square, label-less).
  **Never** hand-roll `bg-blue-600` / `bg-blue-700` buttons or bespoke
  `onMouseEnter/onMouseLeave` hover-colour icon buttons — use
  `<Button iconOnly variant="ghost|danger" icon={…} />`.
- **Pages:** use `StandardPage` (or at minimum the `var(--color-bg-page)`
  background). No gradient page backgrounds (`bg-gradient-to-br from-slate-*`).
- The brand accent is `var(--color-accent)` (`#185FA5`) — **not** Tailwind
  `blue-600` (`#2563EB`). They look similar and reading like the latter is the
  single most common "off-brand" tell.

### Colour = design tokens, not raw Tailwind palette

- Use the CSS custom properties in `src/styles/tokens.css`
  (`var(--color-text-primary)`, `…-secondary`, `…-tertiary`,
  `--color-bg-primary/secondary/page`, `--color-border-tertiary`,
  `--color-accent[-muted/-border/-hover]`, `--color-danger-text/-bg/-border`,
  `--color-success-*`). Raw `gray-*/blue-*/slate-*` literals can't theme
  (dark mode) and drift. Migration mapping used in the review:
  `text-gray-900/800 → text-primary`, `gray-700/600/500 → text-secondary`,
  `gray-400/300/200 → text-tertiary`, `bg-white → bg-primary`,
  `bg-gray-50/100 → bg-secondary`, `border-gray-* → border-tertiary`,
  `blue-600 → accent`, `bg-blue-50 → accent-muted`,
  `border/ring-blue-* → accent-border`, `red-* → danger-*`.
- Prefer inline `style={{ color: 'var(--token)' }}` for a static colour; use a
  Tailwind arbitrary-value class only when a `hover:`/`group-hover:`/`focus:`
  variant must be preserved.
- **Tailwind gotcha (silent bug):** for `border`/`ring`/`outline`/`divide`
  colours via a CSS var, you MUST add the `color:` type hint —
  `border-[color:var(--token)]`, `ring-[color:var(--token)]`. Bare
  `border-[var(--token)]` is parsed as a *length* (border-width) and silently
  renders wrong. `bg-[var(--token)]` and `text-[color:var(--token)]` are the
  safe forms. Do **not** use the `/opacity` modifier on an arbitrary `var()`
  (`bg-[var(--x)]/60` won't resolve).

### Never tokenise data-driven or semantic colour

When migrating colours, leave anything that encodes meaning: phase / week-type
colours, chart & SVG series colours, heat/value colouring, `type="color"`
values, competition-type badges, and category shades (e.g.
`getExerciseCategoryShade(...)`). Only neutral chrome (greys, generic blue
accents, delete-mode reds) becomes tokens. When unsure whether a colour is
data-driven, **leave it**.

### Dates, chips, and density

- **Dates:** format via `src/lib/dateUtils.ts` (`formatDateShort` → `DD/MM`,
  `formatDateToDDMMYYYY`, `formatDateRange`). Never write a local US-style
  formatter (`'Apr 27'`). European day-first, 24h, Monday-first (see Stack).
- **Chips/badges:** render a chip only when it conveys actionable, non-obvious
  information. A chip that appears on *every* row carries no signal — drop it.
  Prefer a `title` tooltip for terse/jargon labels (e.g. a `RAW …/12` score)
  rather than an unexplained chip.

### Verify before you trust

Run `npm run typecheck` and `npm run build` after each change group. Typecheck
and build both pass even when a Tailwind arbitrary-value class is malformed, so
also read the diff: confirm handlers/`onClick`/`disabled`/`title` are preserved,
no imports went unused, and no data colour was touched.

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
- Do not touch Analysis or Training Log beyond hiding their UI entry points.
