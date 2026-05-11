-- Drop the legacy CHECK constraint on exercises.category.
--
-- The original 20260211 migration hardcoded the allowed categories to
--   'Snatch', 'Clean & Jerk', 'Squat', 'Pull', 'Press', 'Accessory'.
-- Categories have since become a per-coach table (20260427_categories_per_coach)
-- and the FK from exercises.category → categories.name was dropped, but the
-- CHECK constraint stayed and silently blocked any insert with a coach-defined
-- category (e.g. "Unspecified", "Olympic Lifts", or anything the coach renamed).
--
-- Coach-flexibility is a project non-negotiable, so the constraint must go.

ALTER TABLE exercises DROP CONSTRAINT IF EXISTS valid_category;
