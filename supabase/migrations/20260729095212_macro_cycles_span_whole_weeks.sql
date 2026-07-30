-- A macrocycle spans WHOLE weeks (Mon–Sun): the week holding its start date
-- and the week holding its end date are both fully part of the cycle.
--
-- Two defects put the stored data out of line with that rule:
--   1. The client generated weeks by stepping a local-time Date by 7 days
--      while comparing against a UTC-midnight end bound. A cycle crossing the
--      October DST change drifted an hour past the bound and lost its final
--      week (macro "NM 2026" ends 2026-11-16 but had no week row for it).
--   2. The end-date field snapped to its week's MONDAY, so `end_date` named
--      the first day of the last week instead of the last. Everything that
--      renders or filters on [start_date, end_date] — annual wheel, calendar
--      overlay, analysis window — clipped the final week to a single day.
--
-- date_trunc('week', d) is ISO/Monday-based in Postgres, matching the app's
-- European week convention.

-- 1) Restore tail weeks that never got created.
WITH bounds AS (
  SELECT m.id,
         date_trunc('week', m.end_date)::date AS last_monday,
         MAX(w.week_start)  AS cur_last_start,
         MAX(w.week_number) AS cur_last_number
  FROM macrocycles m
  JOIN macro_weeks w ON w.macrocycle_id = m.id
  GROUP BY m.id, m.end_date
),
-- Inherit the previous last week's type so the restored week carries a value
-- the coach has actually configured (week_type is NOT NULL and is validated
-- against the coach's own week-type list).
tail AS (
  SELECT b.id,
         b.last_monday,
         b.cur_last_number,
         lw.week_type,
         lw.week_type_text
  FROM bounds b
  JOIN macro_weeks lw
    ON lw.macrocycle_id = b.id AND lw.week_start = b.cur_last_start
  WHERE b.last_monday > b.cur_last_start
),
missing AS (
  SELECT t.id,
         gs::date AS week_start,
         t.cur_last_number + ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY gs) AS week_number,
         t.week_type,
         t.week_type_text
  FROM tail t
  CROSS JOIN LATERAL generate_series(
    (SELECT MAX(week_start) FROM macro_weeks WHERE macrocycle_id = t.id) + 7,
    t.last_monday,
    INTERVAL '7 day'
  ) AS gs
)
INSERT INTO macro_weeks (macrocycle_id, week_start, week_number, week_type, week_type_text, notes)
SELECT id, week_start, week_number, week_type, week_type_text, ''
FROM missing;

-- 2) Anchor the stored range to the weeks it actually covers: start_date on
--    the Monday opening the first week, end_date on the Sunday closing the last.
UPDATE macrocycles
SET start_date = date_trunc('week', start_date)::date,
    end_date   = date_trunc('week', end_date)::date + 6
WHERE start_date <> date_trunc('week', start_date)::date
   OR end_date   <> date_trunc('week', end_date)::date + 6;
