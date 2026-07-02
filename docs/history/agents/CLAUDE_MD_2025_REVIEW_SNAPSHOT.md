# EMOS — Project Context for Claude Code

> **Save this at your repo root.** If you already have a `CLAUDE.md`, merge
> the sections below into it rather than overwriting.

## What EMOS is

EMOS (Erfolg Muss Organisiert Sein) is an Olympic weightlifting (OWL) coaching
web application. The name **EMOS is fixed and must never be changed** by any
agent. Interface text stays English; i18n infrastructure is a future concern
and not in scope for this review.

## Stack

React 18 · TypeScript (strict) · Vite · Tailwind CSS · Supabase (Postgres;
Auth + RLS are future phases) · Recharts. German locale conventions apply only
to user-facing numeric formatting (comma decimals); UI labels remain English.

## Current review scope

**IN SCOPE — agents may audit and propose modifications:**

- Athlete and training-group definition
- Macro cycle planning
- Weekly programme writing (`src/components/planner/*`, `WeeklyPlanner.tsx`)
- Printing weekly programmes

**OUT OF SCOPE — disable in UI, keep code intact, do not delete:**

- Analysis module
- Training Log module

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

## Branch strategy

- Reviewer and synthesizer agents are read-only.
- Implementer creates a dedicated branch `feature/review/<YYYY-MM-DD>` off the
  current working branch. Do not push. Do not merge. Leave commits for manual
  review.

## Supabase & migrations

- Schema changes require an explicit migration file under
  `supabase/migrations/<timestamp>_<n>.sql`.
- Migrations are **never applied silently** by agents. They are written and
  flagged; the user applies them.

## Code conventions

- TypeScript strict. No `any` without justification.
- Conventional Commits: `feat(...)`, `fix(...)`, `refactor(...)`, `chore(...)`.
- When a component has accumulated iteration debris (stale state, dead
  imports, commented code) and the debris-to-logic ratio is high, prefer a
  rewrite over incremental patching. Mark it explicitly as a rewrite
  candidate in the plan.

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
