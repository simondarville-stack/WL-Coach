-- Consolidate competitions onto the shared events model so the calendar and
-- macros read/write ONE source. A macro's "primary/target" competition is now a
-- pointer to an event; existing standalone macro_competitions are migrated into
-- competition events attached to the macro's athlete(s).
--
-- Applied to the remote project as migration 20260714141523. The data-migration
-- block is guarded on `event_id IS NULL`, so it is a no-op once rows are linked
-- (safe to replay on a fresh DB / db reset).

ALTER TABLE public.macrocycles
  ADD COLUMN IF NOT EXISTS primary_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

DO $mig$
DECLARE
  r RECORD;
  new_event_id uuid;
BEGIN
  FOR r IN
    SELECT c.id, c.macrocycle_id, c.competition_name, c.competition_date, c.is_primary, c.owner_id,
           m.athlete_id, m.group_id
    FROM public.macro_competitions c
    JOIN public.macrocycles m ON m.id = c.macrocycle_id
    WHERE c.event_id IS NULL
  LOOP
    INSERT INTO public.events (owner_id, name, event_date, event_type, is_all_day)
    VALUES (r.owner_id, r.competition_name, r.competition_date, 'competition', true)
    RETURNING id INTO new_event_id;

    IF r.athlete_id IS NOT NULL THEN
      INSERT INTO public.event_athletes (event_id, athlete_id) VALUES (new_event_id, r.athlete_id);
    ELSIF r.group_id IS NOT NULL THEN
      INSERT INTO public.event_athletes (event_id, athlete_id)
      SELECT new_event_id, gm.athlete_id FROM public.group_members gm WHERE gm.group_id = r.group_id;
    END IF;

    -- keep the legacy row traceable to its event
    UPDATE public.macro_competitions SET event_id = new_event_id WHERE id = r.id;

    IF r.is_primary THEN
      UPDATE public.macrocycles SET primary_event_id = new_event_id WHERE id = r.macrocycle_id;
    END IF;
  END LOOP;
END $mig$;
