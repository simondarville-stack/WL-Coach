/*
  # Add auth_user_id to athletes for Supabase Auth linkage

  1. Modified Tables
    - `athletes`
      - `auth_user_id` (uuid, nullable, unique) - Links athlete to a Supabase Auth user

  2. Security
    - Add RLS policies for authenticated athletes to read their own data
    - Athletes can only see their own week_plans, planned_exercises, training_log data

  3. Notes
    - Existing anon policies remain for coach access
    - New authenticated policies allow athlete self-service
    - auth_user_id is nullable so existing athletes without auth still work
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'athletes' AND column_name = 'auth_user_id'
  ) THEN
    ALTER TABLE athletes ADD COLUMN auth_user_id uuid UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_athletes_auth_user_id ON athletes(auth_user_id);

CREATE POLICY "Athletes can read own profile via auth"
  ON athletes FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Athletes can update own profile via auth"
  ON athletes FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Authenticated athletes can read their week plans"
  ON week_plans FOR SELECT
  TO authenticated
  USING (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
    OR
    group_id IN (
      SELECT group_id FROM group_members
      WHERE athlete_id IN (SELECT id FROM athletes WHERE auth_user_id = auth.uid())
      AND left_at IS NULL
    )
  );

CREATE POLICY "Authenticated athletes can read their planned exercises"
  ON planned_exercises FOR SELECT
  TO authenticated
  USING (
    weekplan_id IN (
      SELECT id FROM week_plans WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can read their set lines"
  ON planned_set_lines FOR SELECT
  TO authenticated
  USING (
    planned_exercise_id IN (
      SELECT pe.id FROM planned_exercises pe
      JOIN week_plans wp ON wp.id = pe.weekplan_id
      WHERE wp.athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can read exercises"
  ON exercises FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated athletes can manage their training log sessions"
  ON training_log_sessions FOR ALL
  TO authenticated
  USING (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated athletes can manage their training log exercises"
  ON training_log_exercises FOR ALL
  TO authenticated
  USING (
    session_id IN (
      SELECT id FROM training_log_sessions
      WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM training_log_sessions
      WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can manage their training log sets"
  ON training_log_sets FOR ALL
  TO authenticated
  USING (
    log_exercise_id IN (
      SELECT tle.id FROM training_log_exercises tle
      JOIN training_log_sessions tls ON tls.id = tle.session_id
      WHERE tls.athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    log_exercise_id IN (
      SELECT tle.id FROM training_log_exercises tle
      JOIN training_log_sessions tls ON tls.id = tle.session_id
      WHERE tls.athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can read their PRs"
  ON athlete_prs FOR SELECT
  TO authenticated
  USING (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated athletes can read their bodyweight"
  ON bodyweight_entries FOR SELECT
  TO authenticated
  USING (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated athletes can insert bodyweight"
  ON bodyweight_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated athletes can read macrocycles"
  ON macrocycles FOR SELECT
  TO authenticated
  USING (
    athlete_id IN (
      SELECT id FROM athletes WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated athletes can read macro weeks"
  ON macro_weeks FOR SELECT
  TO authenticated
  USING (
    macrocycle_id IN (
      SELECT id FROM macrocycles
      WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can read macro phases"
  ON macro_phases FOR SELECT
  TO authenticated
  USING (
    macrocycle_id IN (
      SELECT id FROM macrocycles
      WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Authenticated athletes can read macro competitions"
  ON macro_competitions FOR SELECT
  TO authenticated
  USING (
    macrocycle_id IN (
      SELECT id FROM macrocycles
      WHERE athlete_id IN (
        SELECT id FROM athletes WHERE auth_user_id = auth.uid()
      )
    )
  );
