# EMOS — Auth & Billing Roadmap

Status: **agreed plan, not yet started** (18/08/2026). Supersedes the
"auth is a future phase" note in CLAUDE.md once execution begins; until a
phase ships, the interim soft-gating stays live.

## Scope decisions (locked with Simon, 18/08/2026)

1. **Athlete sign-in:** email invite (real Supabase Auth accounts), with the
   current personal-link + access-code path kept as a fallback for athletes
   without email. Both coexist; code-fallback athletes can be upgraded to an
   email account later without data migration.
2. **Coach onboarding:** invite-only during beta. The super admin creates and
   invites coach accounts. Self-serve signup ships together with Stripe.
3. **Payments:** entitlement/subscription scaffolding now, driven by a manual
   admin switch; live Stripe integration (Checkout, webhooks, customer
   portal) is the final phase.
4. **Super admin:** full impersonation — operate any coach workspace exactly
   as that coach, with a visible banner and an audit trail — plus an admin
   console (accounts, error logs, diagnostics).

## Where we start from (already in place)

The schema is further along than the app: multi-coach phase 1 shipped long
ago, so this effort is mostly *auth integration + RLS cutover*, not data
modelling.

- `coach_profiles` + `owner_id NOT NULL` on all root tables
  (`20260406_multi_coach_phase1.sql`); all existing data owned by the seeded
  default coach `00000000-…-0001`.
- Coach-to-coach sharing (`athlete_collaborators`,
  `training_group_collaborators`, `20260530000001_coach_sharing.sql`).
- `athletes.auth_user_id` (nullable, unique) **already exists**, along with a
  set of authenticated athlete RLS policies from `20260412125302` — written
  before several schema rebuilds. **Treat those policies as stale: audit,
  drop, and rewrite in Phase 3. Do not build on them.**
- Everything runs on the anon key (`src/lib/supabase.ts`) with transitional
  allow-all anon RLS policies on every table.
- Coach app gate: `VITE_COACH_GATE` build-time passphrase (`App.tsx`).
- Athlete app gate: localStorage picker + personal/group capability links +
  access codes (`src/athlete/v2/lib/AuthContext.tsx`, `programmeGate.ts`) —
  explicitly deterrence-only today.
- Owner scoping helpers: `src/lib/ownerContext.ts` (`getOwnerId`,
  `getContextOwnerId`) reading `coachStore.activeCoach` — the single seam
  where "who am I acting as" already lives. Auth plugs in here.
- `error_logs` table exists (feeds the future admin console).

## Target state

- Supabase Auth (email) for coaches, athletes-with-email, and the super
  admin. Anonymous-auth sessions for code-fallback athletes.
- Roles: `super_admin`, `coach`, `athlete` — derived from linkage, not a
  free-floating role column:
  - coach ⇔ `coach_profiles.auth_user_id = auth.uid()`
  - athlete ⇔ `athletes.auth_user_id = auth.uid()`
  - super admin ⇔ row in a new `super_admins(auth_user_id)` table
- RLS enforced end-to-end; the allow-all anon policies are gone.
- Coach manages athlete access from the Athletes page (invite / revoke /
  reset / status).
- `coach_subscriptions` entitlements table gates the app; Stripe fills it
  later via webhooks instead of the admin switch.

## Core design decisions

### SQL helper layer (Phase 0)

Small set of `SECURITY DEFINER STABLE` functions so policies stay readable
and fast (no repeated inline subqueries):

- `app_is_super_admin()`
- `app_current_coach_id()` → `coach_profiles.id` for `auth.uid()`, else null
- `app_current_athlete_id()`
- `app_athlete_ids_for_viewer()` → athlete ids reachable by the current
  session: own linkage **or** an active row in `athlete_access_grants` (below)
- collaborator predicates reuse the existing `accessScope` semantics in SQL

Every policy in Phase 3 is composed from these. If policy evaluation ever
shows up in query timings, the escape hatch is moving role/coach-id into JWT
custom claims via an access-token hook — deferred until measured.

### Code-fallback athletes: grants instead of open anon reads

The current fallback (anon key reads everything, code checked client-side)
cannot survive RLS. Replacement that keeps the exact same athlete UX:

1. Athlete opens `/athlete/a/<id>` or `/athlete/g/<token>` → app performs a
   **Supabase anonymous sign-in** (built-in feature) so the device has a real
   auth session.
2. An Edge Function `claim-programme` (service role) verifies the access code
   server-side against the athlete/group row and writes a row to a new
   `athlete_access_grants` (`auth_user_id`, `athlete_id`/`group_id`,
   `granted_at`, `revoked_at`). Programmes without a code grant on bare
   link-knowledge — same capability semantics as today, but now auditable
   and revocable.
3. Athlete-read RLS policies accept `auth_user_id` linkage **or** an active
   grant. Rotating a code or revoking a grant genuinely cuts access —
   today's version only pretends to.

### Impersonation = the existing coach switcher, gated + audited

Super admin RLS policies pass everywhere, so impersonation needs no auth
tricks: the admin signs in as themselves and the client sets
`coachStore.activeCoach` to the target coach — exactly what the multi-coach
dropdown does today. Phase 1 hides that switcher from ordinary coaches
(their active coach is fixed by their session); Phase 4 re-exposes it to the
super admin as "Open as coach…", writes to `admin_audit_log`
(`admin_user_id`, `action`, `target_coach_id`, `at`, `details jsonb`), and
shows a persistent banner while active.

### Existing data

No row migration needed: Simon's auth user is linked to the default coach
profile `00000000-…-0001` (renamed to his real name) in Phase 1. All
existing data is thereby his.

## Phases

Each phase = one `feature/*` branch, one MINOR bump, one merge to `main`.
Order 1→2→3 is fixed (RLS cutover needs both auth populations to exist);
4 and 5 are independent of each other and can swap.

### Phase 0 — Foundations (folds into the Phase 1 ship)

- Policy inventory script + audit of the stale `20260412` policies.
- `super_admins` table; `coach_profiles.auth_user_id` column; helper
  functions above; seed Simon as super admin.
- **Custom SMTP** (e.g. Resend) + branded auth email templates — Supabase
  built-in email is rate-limited to uselessness for invites. Needs a sender
  domain decision.
- Dev ergonomics: seeded dev users + a `VITE_AUTH_BYPASS`-style dev flag so
  local work never fights the login screen. The flag must be inert in
  production builds.

### Phase 1 — Coach auth (MINOR)

- Sign-in page (email + password, magic-link secondary) replacing
  `CoachGate`; session handling + sign-out in the shell.
- `getOwnerId()` derives from the session's coach profile instead of
  `coachStore` selection; the coach switcher disappears for non-admins.
- Invite-a-coach flow (super-admin-only UI + Edge Function using
  `auth.admin.inviteUserByEmail`, since the client can't call admin APIs):
  creates the `coach_profiles` row, sends the invite; accept-invite page
  sets the password and lands in an empty workspace.
- `VITE_COACH_GATE` retired at the end of this phase.
- **Exit criteria:** Simon signs in as super admin; a second invited coach
  reaches an isolated empty workspace; nothing in the app still reads the
  default-coach fallback in `ownerContext.ts`.

### Phase 2 — Athlete accounts + coach-managed access (MINOR)

- Athletes page gains an **Access** column/panel per athlete: status
  (`no access` / `code link` / `invited` / `active`), invite by email,
  resend, revoke, reset password — all via an Edge Function wrapping the
  auth admin API, authorised for the owning coach (and collaborator
  co-coaches).
- Athlete accept-invite → lands in `/athlete` with `mode: 'athlete'`,
  linkage via the existing `athletes.auth_user_id`.
- `AuthContext` v2: session-first (email athletes), anonymous-session +
  `claim-programme` grant flow for links/codes (see design above). The
  picker UX and share links stay as they are.
- **Exit criteria:** one email athlete and one code-only athlete both use
  the full athlete app; revoking either genuinely locks them out.

### Phase 3 — RLS cutover (MINOR; the risk phase)

- Drop the stale `20260412` athlete policies. Write the full policy set from
  the helper functions: coach = own `owner_id` + collaborator grants;
  athlete = linkage/grant reads (+ writes only to `training_log_*` and
  bodyweight, preserving the planned-vs-logged integrity rule); super admin
  = everything.
- Test on a **Supabase branch** (MCP `create_branch`) with a written smoke
  checklist per surface: planner, log mode, analysis, inbox, macro, print,
  athlete app, share links, exports.
- Flip: remove allow-all anon policies table-group by table-group, smoke
  after each group. RLS failures surface as *empty results*, not errors —
  the service layer must log/surface unexpected-empty during the cutover
  window.
- **Exit criteria:** anon key alone can read nothing meaningful; all smoke
  surfaces pass as coach, collaborator, email athlete, code athlete, admin.

### Phase 4 — Super admin console (MINOR)

- `/admin` (super-admin-only route): coach account list (plan, athlete
  count, last activity), invite management, `error_logs` viewer,
  impersonation ("Open as coach…" + banner + `admin_audit_log`), basic
  diagnostics (DB advisors output, failed auth events).

### Phase 5 — Billing scaffolding (MINOR)

- `coach_subscriptions`: `coach_id` (FK, unique), `plan` (text, default
  `'beta'`), `status`, `max_athletes` (null = unlimited), `features jsonb`,
  `stripe_customer_id` / `stripe_subscription_id` / `current_period_end`
  (all null until Phase 6), timestamps. Pricing-agnostic on purpose — the
  plan *names* are config, not code (coach-flexibility principle applies to
  our own product too).
- `useEntitlements()` hook + gate helpers. Gating is **soft-first**: warn at
  limits, never destroy or hide data. Admin console gets plan controls.
- **Exit criteria:** flipping a coach's plan in `/admin` visibly changes
  their limits without a deploy.

### Phase 6 — Stripe + self-serve signup (MINOR, ships when we decide to charge)

- Stripe products/prices (test mode first); Checkout session Edge Function;
  webhook Edge Function (`checkout.session.completed`,
  `customer.subscription.updated/deleted`, `invoice.payment_failed`) →
  writes `coach_subscriptions`; customer-portal link for self-service card
  management and cancellation.
- Self-serve coach signup opens here: register → trial/free plan →
  subscribe. Invite-only switch retired.
- Dunning/lapse behaviour per the open question below.

## Risks

- **RLS flip silently blanking surfaces** — the queries succeed with empty
  results. Mitigated by the branch rehearsal, per-group flips, and
  unexpected-empty logging; this is why Phase 3 is its own ship.
- **Policy performance** on hot deep tables (`planned_exercises`,
  `training_log_sets`). Helper functions + existing owner indexes should
  hold; JWT claims are the measured escape hatch.
- **Email deliverability** — invites are the front door; custom SMTP + real
  sender domain is a Phase 0 blocker, not a nice-to-have.
- **Anonymous-session growth** — anon auth users accumulate per device;
  periodic cleanup of grant-less anon users is a small admin-console chore.

## Open questions (decide before the phase that needs them)

1. **Pricing shape** (needed Phase 6, informs Phase 5 defaults): flat
   monthly vs. tiers by athlete count? Trial length?
2. **Lapse behaviour** (Phase 5/6): expired subscription → read-only
   workspace (recommended — never hold data hostage) vs. hard lock?
3. **Sender domain** (Phase 0): which domain do auth/invite emails come
   from?
4. **GDPR posture** (before public signup): EU athletes, many minors —
   data export, deletion-on-request (needs a carve-out from the project's
   no-deletion policy), and consent flow for minors need explicit decisions.
   Not a code phase yet, but Phase 6 must not ship publicly without it.
