-- Per-programme soft access codes for the athlete app (/athlete).
--
-- A nullable passphrase on athletes and training_groups. NULL / empty means
-- the programme is open (current behaviour); a non-empty value gates entry in
-- the athlete app, where the viewer must type the code before the athlete's
-- Today/Week/log views or the group's read-only plan are revealed.
--
-- Deterrence only, not real auth: the value is stored in plaintext and still
-- read with the anon key (no RLS yet). This sits on the same soft-gating
-- surface as the group share link (group id token) and the VITE_COACH_GATE
-- coach-root gate, and is the natural place to graft real auth onto later.
-- See src/athlete/v2/lib/AuthContext.tsx and src/athlete/v2/lib/programmeGate.ts.

alter table public.athletes
  add column if not exists access_code text;

alter table public.training_groups
  add column if not exists access_code text;

comment on column public.athletes.access_code is
  'Optional soft-gate passphrase for the athlete app; NULL/empty = open. Deterrence only, not auth.';

comment on column public.training_groups.access_code is
  'Optional soft-gate passphrase for the group plan viewer; NULL/empty = open. Deterrence only, not auth.';
