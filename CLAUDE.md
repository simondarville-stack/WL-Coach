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
  added in 0.6.0. From 0.91.0 a comment can be **tagged** to what it is
  about — a logged exercise, one set of it, or a session metric — from the
  review reel's composer on session cards and session-bound thread cards
  (`#` picker, or tap the row / set column / chip on the card;
  `src/components/review/TagComposer.tsx`). `#`, not `@`: a comment is
  *about* an exercise, and `@` stays free for people. The text stays plain
  (`#Snatch looked slow`, a set as a path: `#Snatch/3`); the structure
  rides in `training_log_messages.tags` (migration 20260905090000) and the
  grammar lives in `src/lib/messageTags.ts` — every thread surface renders
  tags through `src/components/chat/MessageText.tsx`, the athlete's Today
  screen files a tagged comment under its exercise card, and the Analysis
  module joins coach comments to exercises through the same tags (the
  `coachComments` measure, "Coach feedback by lift" preset). `exercise_id`
  on the message row is a separate, older per-exercise scope that several
  surfaces hide; tagged comments leave it null on purpose.
- **KinEMOS** (`src/kinemos/*`) — the kinematic-analysis module: video library
  at `/kinemos` (0.78.0) and the manual analysis viewer at
  `/kinemos/analysis/:kind/:id` (0.79.0), plus the measurement pipeline —
  filtering, velocity, phases, power and the A/B/C quality grade (0.80.0) — and
  assisted bar tracking, anchor-and-supervise, in pure TypeScript (0.81.0), and
  lift-vs-lift comparison inside the viewer — charts 0.82.0, synced
  side-by-side playback 0.83.0 — and metric trends (0.84.0): a TRENDS view in
  the viewer plus KinEMOS measures inside the Analysis builder, both read
  through `src/kinemos/lib/analysisAdapter.ts` (design §13 Q3: metrics stay
  adjacent, Analysis never imports the engine) — and a per-athlete reference
  lift that comparison opens on and trends draw as a line — and the OpenCV
  assists: find the plate with no click, snap an outline to the rim at
  sub-pixel, stabilise a handheld camera's track (`src/kinemos/cv/*`,
  `@techstark/opencv-js` loaded lazily as its own chunk; the tracker itself
  stays pure TypeScript, having out-measured OpenCV's trackers) — and, from
  the two-view accuracy study (`docs/KINEMOS_ACCURACY_STUDY.md`, the
  reference for why the pipeline is shaped as it is): gravity-anchored
  calibration (the plate outline gives scales, never which way is up), a
  timing repair for mis-stamped frames before resampling
  (`src/kinemos/engine/timing.ts`), per-frame re-centring of the track on the
  plate outline, and a peak-stability factor in the grade — and, from the
  first phone footage of whole sets (`docs/KINEMOS_P3_PLAN.md` §8): a
  tracker whose search radius follows the physics of the clip and that
  survives a blurred second pull, and `src/kinemos/engine/reps.ts`, which
  cuts a track of a set into its reps from rests and rises alone.
  The metric set includes the German Weightlifting Analyzer's measures
  (V1/V2/Vmax/Vmin, t_turn, S_vmax/S_max/S_fly/S_remain/S_sit/S_fall, F1–Fbr
  as % of load, PSK) as `AnalyzerMetrics` in `engine/phases.ts` — from
  Simon's 2018 DTU report, P3 plan §9 — and `engine/reps.ts` cuts a set into
  reps — and, from 0.86.0 (P3 plan §10): TRACK THE SET in the viewer (one
  click on a double or triple gives a rep per lift, each calibrated at its
  own rest; `src/kinemos/lib/setTracker.ts`, the same procedure the harness
  runs), the plate found again by its colour after a loss
  (`engine/plateColour.ts`, pure), charts against height with V1/V2/Vmax/Vmin
  marked (`vs time | vs height` on the analysis panel), and a knee-height
  mark (KNEE tool) that checks the phase edges against the coach's eye.
  `src/kinemos/engine/*` is a pure core — no React, no Supabase, no EMOS
  imports, and it never imports `cv/`. Design and phase plan in `docs/KINEMOS_DESIGN.md`; per-phase scope
  in `docs/KINEMOS_P0_PLAN.md`, `_P1_PLAN.md`, `_P2_PLAN.md`, `_P3_PLAN.md`,
  `_P4_PLAN.md` and `_P5_PLAN.md`.
  From 0.87.0 (P3 plan §11–§12, P4 plan): **sharing** — a rep handed to its
  athlete as a card in their coach thread, to a colleague coach via "Shared
  with you" on the library, as an mp4/WebM with the bar path burned in
  (`lib/overlayExport.ts`), or as a talkover recorded over the scrubbed lift
  (`lib/talkover.ts`); the **lens tier** (`engine/distortion.ts`,
  `engine/edgeChains.ts`, `lib/distortionFit.ts`) fitting a one-parameter
  division model to the gym's own straight edges, with `probeSensitivity` so
  a refusal says whether the lens is clean or the edges simply cannot tell;
  **marker mode** (`engine/markerTracker.ts`, design §6.2 tier 2); and P4's
  **consent + labelled export** (`lib/flywheel.ts`, design §10), the
  **benchmark** (`npm run bench`, `verify/bench.mjs`) and **zero-click
  analysis** (`lib/autoAnalyse.ts`) — whose `persistRep` is the single
  definition of a stored rep. The learned tracker of design §6.2 tier 3 is
  deliberately not built; P4 plan §5 says what would have to be true first.
  From 0.88.0 (P5 plan): **load–velocity profiles**
  (`engine/loadVelocity.ts`) — expected velocity at a load, the load for a
  target velocity, a 1RM estimated from submaximal work, and velocity loss
  measured from the best rep of a set, with explicit refusals rather than a
  confident line through four points; a **model-lift library** (`is_model` /
  `model_label` on an analysis) for comparing against a lift that is simply
  correct, alongside P3c's per-athlete reference lift; **live mode** at
  `/kinemos/live` (`engine/liveReps.ts`, a three-state machine fed one
  sample at a time) — which answers design §13 open question 4 as a VBT-unit
  readout rather than live path drawing, stores nothing and grades nothing;
  and **pre-analysed arrivals** (`lib/arrivals.ts`) running the P4c pipeline
  on import from the local file and on a stoppable backlog sweep, since a
  pure client-side SPA has no server to pre-analyse on. Lifter pose tracking
  is deliberately not built; P5 plan §6 says why.
  `verify/*.html` are browser harnesses (frame-server checks, a design bench
  for the analysis panels, a trends bench with a Playwright screenshot driver)
  — open them under `npm run dev`; `npm run bench` scores engine variants.

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

**The binding spec is `docs/DISPLAY_CONVENTIONS.md`** — read it before rendering
a prescription, a number, a date or a time on any new surface.

Canonical logic lives in `src/lib/prescriptionParser.ts` (parsing) and
`src/components/planner/StackedNotation.tsx` (display) — don't fork it.

- **Stacked Load Notation is the ONLY coach-facing display format for a
  prescription.** Inline `load×reps×sets` text is an input/storage form, never a
  display form. This holds on every surface, including the ones that keep
  getting missed: clipboard previews, template previews, print output. If you
  are calling `parsePrescription` and joining the result into a string for
  display, use `<StackedNotation raw unit isCombo />` instead.

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

## Hosting & deploy

EMOS is a pure client-side SPA (Vite → `dist/`, Supabase called straight from
the browser). It is hosted on **Cloudflare Workers static assets**:

- `wrangler.toml` — assets-only Worker (no `main`, no ASSETS binding).
  `not_found_handling = "single-page-application"` is what makes deep links
  like `/analysis` or `/athlete/a/<id>` survive a hard refresh.
- `public/_headers` — cache + security headers; Vite copies it into `dist/`.
- `public/.assetsignore` — `*.map`. **The load-bearing guard.** vite emits
  `.map` files (`sourcemap: 'hidden'` hides the comment, not the file) and a
  map embeds `sourcesContent`, i.e. the whole EMOS source verbatim. This file
  stops wrangler uploading them however the build was invoked. It is enforced
  at deploy time and does not depend on anyone choosing the right script —
  which is exactly how the source leaked once, in 0.60.1.
- `npm run build:deploy` — `vite build` plus `scripts/strip-sourcemaps.mjs`.
  Second, independent guard; prefer it as the CI build command.
- Build-time env: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are baked
  into the bundle at build time — they are Workers Builds **environment
  variables**, not runtime secrets.
- `preview_urls = false` in `wrangler.toml`. Versioned preview URLs are public
  and keep serving each version's own assets after it stops being live — that
  is how 0.60.1's sourcemaps outlived the fix on the main hostname. Keep this
  in the file, not just the dashboard: the dashboard toggle is overwritten by
  the next deploy, and every push to `main` deploys. Re-enable only together
  with Cloudflare Access.
- `netlify.toml` is the **rollback target**, not the live config. Its header
  and redirect rules mirror the Cloudflare ones — change both or neither, or
  retire it once Cloudflare has been stable.

Adding an `/api/*` route later means giving the Worker a `main` script plus
`assets.run_worker_first = ["/api/*"]`; nothing else has to move.

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
