# Plan — one exercise catalogue shared by two (or more) coaches

Status: **proposal, not built.** Written 22/07/2026 in response to the TO-DO
item "Give me a plan for how two coaches can share the same exercise
catalogue. We need to make sure that the unique ID is the same, so they can
both plan and analyse each other's athletes."

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

---

## 2. What we want

1. One catalogue, one row per exercise, **one id**, visible to both coaches.
2. Either coach can plan for either coach's athletes without a mapping step.
3. Analysis compares athletes across both coaches with **no change to the
   analysis layer** — it already groups by `exercise_id`, so this falls out for
   free once the ids are shared.
4. Coaches who already have separate libraries can converge **without losing
   history** — existing programmes, logs and PRs must survive.
5. Fits the roadmap: keep the `owner_id` pattern so the future auth/RLS phase is
   a policy change, not schema surgery (CLAUDE.md, "Auth & access").

---

## 3. Options considered

### A. Catalogue as a first-class object (`exercise_libraries`)
New table `exercise_libraries(id, name, created_by)`; `exercises.library_id`
replaces `owner_id`; coaches get access rows. **Cleanest end state** — a
catalogue outlives the coach who created it (matters when a coach leaves a club)
— but it touches every exercise read/write in the app plus a column swap on the
largest owned table.

### B. Share the catalogue the way we already share athletes ✅ recommended
Keep `exercises.owner_id`. Add `exercise_catalogue_collaborators`, a
near-copy of `athlete_collaborators`, and let a coach select **which catalogue
they are working in**. Two coaches pointing at catalogue A get literally the
same rows and the same ids. Small schema, reuses vocabulary the codebase and the
coach already know, and it is a strict subset of A — the later promotion to
`exercise_libraries` is a mechanical `library_id = owner_id` backfill.

### C. Keep both libraries, add `canonical_exercise_id`
Each coach keeps their rows; both point at a shared "concept" row, and analysis
groups by the canonical id. No programme migration at all. **Rejected:** it
creates two rows of truth per concept (violates core principle 3), and every
read path — planner, macro, PR table, analysis, exports, the exercise tree —
would need a coalesce it doesn't have today. It solves reporting while leaving
planning split.

### D. A global EMOS system catalogue everyone reads
A canonical OWL vocabulary under a fixed `owner_id`, plus per-coach extras.
Attractive later as a *seed* (and as the answer to "new coach, empty library"),
but it does not solve the case in the request: two coaches whose shared
vocabulary is club-specific, not universal. Keep as a future seeding feature.

**Recommendation: B now, with A as the eventual shape, plus the one-time merge
tool from C's spirit (§4.2) so coaches who already diverged can converge.**

---

## 4. The plan

### Phase 1 — Shared catalogue access (schema + resolution)

**Migration** `add_exercise_catalogue_collaborators`:

```sql
CREATE TABLE exercise_catalogue_collaborators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the catalogue: the coach whose owner_id stamps the exercises/categories
  owner_coach_id  uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  coach_id        uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by      uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_coach_id, coach_id)
);
```
Same shape, indexes and transitional anon RLS as `athlete_collaborators` —
deliberately, so there is one sharing idiom in the product.

Plus, on `coach_profiles`: `active_catalogue_owner_id uuid REFERENCES
coach_profiles(id)` — nullable, defaults to the coach's own id. This is the
coach's *chosen* catalogue.

**Client:** one new resolver next to the existing two in
`src/lib/ownerContext.ts`:

```ts
/** Owner-id of the catalogue the active coach is working in. */
export function getCatalogueOwnerId(): string
```

Resolution order (most specific wins):
1. A selected athlete/group → `getContextOwnerId()` — unchanged. Planning
   someone else's athlete must keep using the host's catalogue, or the
   programme would reference exercises the host doesn't have.
2. Otherwise → `activeCoach.active_catalogue_owner_id ?? activeCoach.id`.

Then replace `getOwnerId()` with `getCatalogueOwnerId()` in the catalogue
paths only: `useExercises` (`fetchExercises`, `createExercise`,
`fetchCategories`, category CRUD, both reorders) and the ownership guard in
`updateExercise`. Nothing else moves — athletes, plans, logs and macros keep
their current owner semantics.

**UI:** a "Exercise catalogue" section in General settings — which catalogue
I am using, who else has access, invite/revoke — modelled on
`ShareAthleteModal`. Plus a catalogue name badge in the library header, because
"which catalogue am I editing" must never be ambiguous once it can differ from
"who am I".

At the end of Phase 1 two coaches can share **one** catalogue and every id is
shared by construction. What Phase 1 does *not* do is rescue the exercises they
each already created.

### Phase 2 — Adopt: merge an existing catalogue into a shared one

For Coach B, who already has a library and programmes written against it.

1. **Match.** Auto-pair B's exercises to A's on `exercise_code`
   (case-insensitive) first, then exact name, then leave unmatched. Codes are
   the coaches' own short keys and are the reliable signal.
2. **Review.** A mapping table — *reuse the template-import mapping UI in
   `MacroExcelIO`*, which is exactly this widget: one row per source exercise, a
   dropdown of target exercises, "not mapped" allowed. Unmapped exercises are
   **copied** into the target catalogue rather than dropped.
3. **Rewrite.** One transactional Postgres function
   `adopt_exercise_catalogue(from_owner uuid, to_owner uuid, mapping jsonb)`:
   - repoint every FK — `planned_exercises`, `planned_exercise_combo_members`,
     `training_log_exercises`, `athlete_prs`, `athlete_pr_history`,
     `macro_tracked_exercises`, `program_template_exercises`;
   - remap the two self-references, `parent_exercise_id` and
     `pr_reference_exercise_id`, **after** the copies exist, so a mapped child
     doesn't end up pointing at a deleted parent;
   - reconcile categories by name (`UNIQUE (owner_id, name)` means a duplicate
     name is a merge, not an insert) and repoint `exercises.category`;
   - **archive** rather than delete the source rows (`is_archived = true`).
     Deletion policy: shipped data is never removed on the tool's own
     initiative, and archiving makes the operation reversible for one release.

   It must be one transaction — a half-remapped catalogue is worse than two
   catalogues.
4. **Verify.** A dry-run report before committing: N exercises mapped, N copied,
   N programmes / logs / PRs repointed. Nothing runs without the coach reading
   that.

### Phase 3 — Permissions and provenance

- `role = 'viewer'` blocks catalogue writes in the client (and, post-auth, in
  RLS); `editor` may add, rename, recolour and reorder.
- **Delete stays with the owner.** Removing an exercise from a catalogue two
  coaches plan against breaks the other coach's programmes; keep it to the
  catalogue owner and keep the existing reassign-then-delete sequence.
- Add `exercises.created_by_coach_id` so a shared catalogue can show who added a
  row. Cheap, additive, and answers the first question a coach asks about a
  catalogue entry they don't recognise.
- Concurrency stays **last-write-wins by `updated_at`** (core principle 4). Two
  coaches renaming the same exercise is a rename race, not a data-integrity
  problem.

### Phase 4 (later) — Promote to `exercise_libraries`

When a catalogue needs to outlive a coach account (a club catalogue, or a coach
leaving), add `exercise_libraries` and backfill `library_id = owner_id`. Phase 1
is deliberately shaped so this is a backfill plus a rename of the resolver, not
a redesign.

---

## 5. Consequences worth stating up front

- **Analysis needs no changes.** Once ids are shared, `factFetch` /
  `useAnalysis` compare athletes across both coaches unmodified. This is the
  whole point of doing it at the id level rather than with a reporting-time
  mapping.
- **Categories become shared too.** They are part of the catalogue
  (`categories.owner_id`), so the merge must reconcile the category namespace
  as well — see Phase 2.3. A coach who wants private categories inside a shared
  catalogue is a *separate* feature; don't design for it now.
- **The exercise tree is a catalogue-level structure.** `parent_exercise_id`
  edges belong to the catalogue, so both coaches will see (and can reshape) one
  hierarchy. That is desirable, and it is why the remap in Phase 2.3 has to run
  after the copies.
- **Auth phase is unaffected.** `owner_id` stays on every row; the future RLS
  policy for `exercises` becomes "owner_id = me OR owner_id IN (my accepted
  catalogue collaborations)" — the same shape as the athlete policy.
- **Estimate.** Phase 1 is small (one migration, one resolver, ~8 call sites, one
  settings panel). Phase 2 is the real work and is where the risk lives — it
  rewrites live FKs, so it needs the dry-run report, the single transaction, and
  a tested rollback before it goes anywhere near a coach's data.

## 6. Open questions for the coach

1. **One shared catalogue, or a shared *core* plus private extras?** The plan
   above assumes fully shared. A "core + personal" split is possible but needs a
   second resolution rule on every read; worth it only if you actually want
   private exercises.
2. **Who owns the shared catalogue** — one of the two coaches (Phase 1), or a
   club-level object from the start (jump straight to Phase 4)?
3. **Do you already have divergent libraries** that must be merged, or is this
   for a fresh setup? If fresh, Phase 1 alone is enough and Phase 2 can wait.
