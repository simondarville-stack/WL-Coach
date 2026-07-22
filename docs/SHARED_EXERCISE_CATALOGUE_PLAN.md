# Plan — a club exercise catalogue, plus personal extras

Status: **design decided, not built.** Written 22/07/2026 for the TO-DO item
"Give me a plan for how two coaches can share the same exercise catalogue. We
need to make sure that the unique ID is the same, so they can both plan and
analyse each other's athletes." Revised the same day with the coach's answers
to the open questions (§2).

---

## 1. Where we are today

**The catalogue is owned by a coach.** `exercises.owner_id` and
`categories.owner_id` both point at `coach_profiles.id`; `categories` carries
`UNIQUE (owner_id, name)`. Every coach therefore has a private catalogue, and
"Snatch" in Coach A's library is a *different row, with a different `id`*, from
"Snatch" in Coach B's.

**Sharing an athlete already works — sharing a catalogue does not.**
`athlete_collaborators` / `training_group_collaborators` (migration
`20260530000001_coach_sharing`) let Coach A grant Coach B access to one athlete.
The athlete keeps `owner_id = A`, and the client resolves reads/writes through
`getContextOwnerId()` (`src/lib/ownerContext.ts`), which returns the **host's**
id. That is why the planner hot-swaps the exercise library when the selected
athlete changes (`WeeklyPlanner` → `fetchExercisesByName(contextOwnerId)`) —
Coach B plans Coach A's athlete against **Coach A's exercises**.

So catalogue sharing today is *implicit, per-athlete, and one-directional*:
- ✅ B can write A's athlete's programme using A's exercises.
- ❌ B's own athletes still use B's exercises.
- ❌ Nothing ties A's "Snatch" to B's "Snatch".

**Why the ids matter.** Everything downstream keys on `exercises.id`:
`planned_exercises.exercise_id`, `training_log_exercises.exercise_id`,
`athlete_prs`, `macro_tracked_exercises`, `program_template_exercises`, plus two
*intra*-catalogue self-references — `exercises.parent_exercise_id` (the exercise
tree) and `exercises.pr_reference_exercise_id` (percentage anchoring, used by
`factFetch`). Analysis groups facts by `exercise_id`. Two ids for one lift means
two half-populated series that can never be compared — which is precisely the
symptom the request names.

### What the live data looks like (22/07/2026)

| Coach | `club_name` | Exercises | Categories |
|---|---|---:|---:|
| Simon | BVK | 56 | 19 |
| Toke Prause | Bagsværd Vægtløftnings Klub | 36 | 9 |
| Asger Søderberg | BVK | 30 | 7 |
| Coach B | — | 8 | 0 |

Two facts from this that shape the plan:

- **Divergence already exists.** Simon and Toke have **15 exercises with the
  same name** (exact, case-insensitive) — fifteen lifts that are one concept and
  two ids today. So even though the club catalogue itself doesn't exist yet
  (§2.3), this is not a greenfield: whoever doesn't seed the club catalogue will
  need their existing rows remapped. Sizing one coach: Toke's 36 exercises are
  referenced by **783 planned exercises, 397 log rows, 54 PRs, 16 macro tracked
  exercises**, plus 1 parent edge and 2 PR-reference edges — ~1 250 foreign keys
  to rewrite, which is exactly why §5.3 insists on one transaction.
- **`club_name` is free text and already inconsistent.** Simon and Asger say
  "BVK"; Toke says "Bagsværd Vægtløftnings Klub" — plausibly the same club,
  spelled two ways. Club membership must therefore be an **explicit member
  table**, never derived from `club_name`.

---

## 2. Decisions (answered by the coach, 22/07/2026)

1. **Core + personal — yes.** A coach sees the shared club catalogue *plus*
   their own private exercises, not one or the other.
2. **The catalogue is a club-level object**, not "one of the two coaches'
   libraries that the other borrows". Go straight to a first-class catalogue
   entity; skip the interim collaborator-on-a-coach model.
3. **Nothing is prepared yet** — the club catalogue is being built fresh. (But
   see §1: the *coaches'* libraries already exist and already overlap, so the
   adopt step in §5.3 is still real work, just sequenced later.)

### The consequence you must hold on to

> **The shared-id guarantee holds for the club catalogue only.**

That is the direct cost of decision 1. Two coaches who each create "Snatch pull
from blocks" *personally* are back to two ids and two half-series in Analysis.
Core + personal is the right call for day-to-day flexibility, but it makes
"which library is this in?" a question the UI has to answer constantly, and it
makes promotion (§5.4) a first-class action rather than an afterthought. Every
design choice below follows from that.

---

## 3. The model

**Every catalogue is a library row — including each coach's personal one.** One
uniform shape, no special cases, no "null means personal" branch:

```sql
CREATE TABLE exercise_libraries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,                        -- "BVK", "Simon's own"
  kind            text NOT NULL CHECK (kind IN ('club', 'personal')),
  -- personal libraries belong to exactly one coach; club libraries to none.
  owner_coach_id  uuid REFERENCES coach_profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'personal') = (owner_coach_id IS NOT NULL))
);

CREATE TABLE exercise_library_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id   uuid NOT NULL REFERENCES exercise_libraries(id) ON DELETE CASCADE,
  coach_id     uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by   uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  UNIQUE (library_id, coach_id)
);

ALTER TABLE exercises  ADD COLUMN library_id uuid REFERENCES exercise_libraries(id);
ALTER TABLE categories ADD COLUMN library_id uuid REFERENCES exercise_libraries(id);
```

`exercise_library_members` deliberately mirrors `athlete_collaborators`
(invite / accept / revoke, partial index on active rows, transitional anon RLS)
so there is one sharing idiom in the product.

**`owner_id` stays** on both tables through the transition — it keeps the
future auth/RLS phase on the pattern CLAUDE.md asks for, and it is the rollback
path if `library_id` has to be reverted. It stops being the *read* key.

**Resolution.** One new function beside the two existing owner resolvers in
`src/lib/ownerContext.ts`:

```ts
/** Library ids the catalogue should be read from, most-specific context first. */
export function getVisibleLibraryIds(): string[]
```

- A selected athlete/group → the **host coach's** visible set. Unchanged in
  spirit from `getContextOwnerId()`: planning someone else's athlete must use
  the catalogue their programme is written against.
- Otherwise → the active coach's club libraries (accepted, not revoked) **+**
  their own personal library.

Reads change from `.eq('owner_id', x)` to `.in('library_id', ids)` in
`useExercises` (`fetchExercises`, `fetchCategories`, both reorders) and the
ownership guard in `updateExercise`. Nothing else moves — athletes, week plans,
logs and macros keep their current owner semantics.

**Categories resolve across the visible set, deduped by name.** Two libraries
may both define "Squat"; the library list shows **one** "Squat" section holding
both club and personal exercises. Club definition wins for colour and display
order; a personal-only category name gets its own section. `UNIQUE (owner_id,
name)` becomes `UNIQUE (library_id, name)`.

**Writes name their library.** The exercise form gets a Library control
(Club / Personal). Default: **Personal** — the reversible direction. See §5.4.

---

## 4. Alternatives, and why not

- **Collaborator-on-a-coach** (share Coach A's library with Coach B, no
  catalogue entity). Was the original recommendation; **superseded by decision
  2**. It ties the club vocabulary to one person's account, so a coach leaving
  takes the catalogue with them.
- **`canonical_exercise_id`** — keep both libraries, point both at a shared
  concept, group by it in Analysis. No programme migration at all, but it puts
  two rows of truth behind one concept (violates core principle 3) and every
  read path would need a coalesce it doesn't have. It fixes reporting while
  leaving *planning* split, which is half the request.
- **A global EMOS system catalogue.** Still worth having later as a **seed** for
  a brand-new coach with an empty library, but it doesn't answer this request —
  a club vocabulary is club-specific, not universal.
- **A full `clubs` table now.** A club entity would also want to own athletes,
  groups and competitions; that is a product decision well beyond a catalogue.
  The **library is the club-level object** for now, and a future `clubs` table
  adopts it by adding `exercise_libraries.club_id`. Given how `club_name`
  already diverges (§1), inventing the club entity casually would create a
  reconciliation problem of its own.

---

## 5. The plan

### 5.1 Phase 1 — Schema and resolution, with zero visible change

Migration `add_exercise_libraries`: the three DDL blocks in §3, then backfill
**one personal library per coach** and set `library_id = <that library>` on
every existing `exercises` / `categories` row from its `owner_id`.

After this each coach sees exactly what they see today, because their visible
set is a single personal library. That is the point: the risky column lands
under a no-op, and can be verified against the row counts in §1 before anything
user-facing depends on it.

Client work: `getVisibleLibraryIds()`, the ~8 call sites in `useExercises`, and
a **library badge** in the exercise library and the exercise picker. Do not skip
the badge — from here on, "which library is this in?" is load-bearing.

### 5.2 Phase 2 — Create the club catalogue and seed it

New "Exercise catalogue" panel in General settings: create a club library, name
it, invite coaches (editor / viewer), accept / revoke — the athlete-share flow
with different nouns.

**Seeding is free for whoever seeds it.** Moving an exercise between libraries
is a `library_id` update, and the row **keeps its id** — so every planned
exercise, log row, PR and macro target that already points at it still points at
it. Seeding the club catalogue from an existing library costs **zero FK
rewrites**.

That has a scheduling consequence worth acting on: **seed from the largest,
most canonical library and make the others adopt.** On today's data that is
Simon's (56 exercises, 19 categories) — seeding from it means Simon pays
nothing, and only Toke (~1 250 FKs) and Asger adopt.

### 5.3 Phase 3 — Adopt: fold a coach's existing library into the club one

For each remaining coach:

1. **Match** their exercises to club ones on `exercise_code` (case-insensitive)
   first, then exact name, then leave unmatched. Codes are the coaches' own
   short keys and the most reliable signal — though note only 24 of Toke's 36
   have one, so the name pass matters.
2. **Review** in a mapping table — reuse the template-import mapping widget in
   `MacroExcelIO`, which is already exactly this control. Unmatched exercises
   are **moved** into the club library (id preserved) or kept personal — the
   coach's choice per row.
3. **Rewrite** in one transactional function
   `adopt_exercise_library(from_library uuid, to_library uuid, mapping jsonb)`:
   - repoint every FK — `planned_exercises`,
     `planned_exercise_combo_members`, `training_log_exercises`, `athlete_prs`,
     `athlete_pr_history`, `macro_tracked_exercises`,
     `program_template_exercises`;
   - remap `parent_exercise_id` and `pr_reference_exercise_id` **after** the
     moves, so a mapped child never points at an archived parent;
   - reconcile categories by name and repoint `exercises.category`;
   - **archive** the superseded source rows (`is_archived = true`), never
     delete — the deletion policy holds, and archiving keeps the operation
     reversible for a release.

   One transaction, no exceptions: a half-remapped catalogue is worse than two
   catalogues.
4. **Dry-run report first** — N matched, N moved, N kept personal, and the FK
   counts per table. Nothing commits until the coach has read it.

### 5.4 Phase 4 — Living with core + personal

This is what keeps decision 1 from silently re-splitting the ids.

- **Promote (personal → club): one click, id-preserving.** A personal exercise
  that turns out to be club vocabulary keeps its id and takes its whole history
  with it. This is the mechanism that makes "default to Personal" safe.
- **Demote (club → personal): guarded.** Blocked when another member's
  athletes reference it — that would silently remove an exercise from under
  their programmes.
- **Duplicate detection at creation time.** Creating a personal exercise whose
  code or name already exists in the club catalogue prompts "use the club one
  instead" — the cheapest possible fix, applied before any history accrues.
- **A Duplicates panel** listing personal exercises that match club ones, each
  with a one-row version of the §5.3 remap. Ongoing hygiene, not a one-time
  migration.
- **Delete stays with club editors**, and keeps the existing
  reassign-then-delete sequence.
- **`exercises.created_by_coach_id`** so a shared catalogue can say who added a
  row — the first question anyone asks about an entry they don't recognise.
- Concurrency stays **last-write-wins by `updated_at`** (core principle 4). Two
  coaches renaming the same exercise is a rename race, not a corruption risk.

---

## 6. Consequences

- **Analysis needs no changes.** Once two coaches' athletes reference the same
  club exercise id, `factFetch` / `useAnalysis` compare them unmodified. Doing
  this at the id level rather than with a reporting-time mapping is the whole
  point.
- **…but only for club exercises.** Repeat of §2: anything you want to compare
  across coaches has to live in the club catalogue. The Duplicates panel and the
  create-time prompt exist to keep that true over time.
- **The exercise tree becomes shared.** `parent_exercise_id` edges belong to the
  catalogue, so club members see and can reshape one hierarchy. Desirable — and
  the reason the remap in §5.3 runs after the moves. A personal exercise
  parented to a club one is fine; a club exercise parented to someone's personal
  one is not, and should be rejected on save.
- **Auth phase is unaffected.** `owner_id` stays on every row; the RLS policy
  for `exercises` becomes "library_id IN (my accepted libraries + my personal
  one)" — the same shape as the athlete policy.
- **Effort.** Phase 1 is small and safe (one migration, one resolver, ~8 call
  sites, a badge) and lands as a no-op. Phase 2 is a settings panel plus a
  `library_id` flip — cheap because ids are preserved. **Phase 3 is where the
  risk lives**: it rewrites live foreign keys (~1 250 for Toke alone), so it
  needs the dry-run report, the single transaction, and a tested rollback before
  it goes near real data. Phase 4 is small, incremental, and never urgent —
  but skipping it is how core + personal quietly re-splits your ids.

---

## 7. What I need from you before building

1. **Confirm the seed library.** Recommendation: seed the BVK club catalogue
   from Simon's (56 exercises / 19 categories), because seeding is free and
   adoption is not — that choice alone decides who pays the migration.
2. **Is Toke's club the same club as Simon's and Asger's?** `club_name` says
   "Bagsværd Vægtløftnings Klub" vs "BVK". One club library or two?
3. **Default library for a new exercise** — this plan says Personal (reversible,
   with one-click promote). Say if you'd rather it default to Club.
4. **Go / no-go on Phase 1**, which is the safe no-op and can ship on its own.
