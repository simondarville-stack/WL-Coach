-- adopt_exercise_library — Phase 3 of the shared-catalogue plan (§5.3).
--
-- Folds a coach's personal library into a club catalogue in ONE transaction,
-- driven by a per-exercise mapping the coach reviewed in the adopt wizard:
--
--   [{ "source_id": uuid, "action": "merge"|"move"|"keep", "target_id": uuid? }]
--
--   merge — the source exercise IS the club one: every reference (plans,
--           logs, PRs, macro tracking, templates, combos, Soll-Ist rows)
--           is repointed to target_id, the source's name+aliases fold into
--           the target's aliases, and the source row is ARCHIVED (never
--           deleted — deletion policy, and the reversibility window).
--   move  — the exercise joins the club catalogue keeping its id (zero FK
--           rewrites). Its category name is created in the target library
--           if missing so it doesn't fall into "Unspecified" for members.
--   keep  — stays personal, untouched.
--
-- p_dry_run = true computes the full report without writing anything —
-- the wizard shows it before the coach confirms. The same report shape is
-- returned by the real run.
--
-- Conflict handling on unique constraints (rows that can't be repointed
-- keep pointing at the archived source row — preserved, reported, invisible
-- in day-to-day UI because the source is archived):
--   athlete_prs              UNIQUE (athlete_id, exercise_id)
--   macro_tracked_exercises  UNIQUE (macrocycle_id, exercise_id)
--   sollist_model_rows       UNIQUE (model_id, exercise_id, reps)
--
-- Self-FK edges: references to merged sources are repointed everywhere
-- (parent_exercise_id, pr_reference_exercise_id); a moved exercise whose
-- parent stays personal has its parent link CLEARED (a club exercise must
-- never hang off someone's personal exercise — plan §6); its pr_reference
-- is left as-is (id-based percentage anchoring still resolves).
--
-- Rollback: DROP FUNCTION IF EXISTS adopt_exercise_library(uuid, uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION adopt_exercise_library(
  p_from    uuid,
  p_to      uuid,
  p_mapping jsonb,
  p_dry_run boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner uuid;
  n_merge int; n_move int; n_keep int;
  n_planned int; n_planned_combo_members int; n_planned_combo_items int;
  n_log int; n_pr_hist int; n_combo_tpl_parts int;
  n_tpl int; n_tpl_combo int;
  n_pr int; n_pr_conflicts int;
  n_macro int; n_macro_conflicts int;
  n_sollist int; n_sollist_conflicts int;
  n_parent_repointed int; n_prref_repointed int; n_parent_cleared int;
  n_categories int; n_refs_total int;
BEGIN
  SELECT owner_coach_id INTO v_owner
  FROM exercise_libraries WHERE id = p_from AND kind = 'personal';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Source library is not a personal library';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM exercise_libraries WHERE id = p_to AND kind = 'club') THEN
    RAISE EXCEPTION 'Target library is not a club catalogue';
  END IF;

  DROP TABLE IF EXISTS _adopt_map;
  CREATE TEMP TABLE _adopt_map ON COMMIT DROP AS
  SELECT (e->>'source_id')::uuid            AS source_id,
         e->>'action'                       AS action,
         nullif(e->>'target_id', '')::uuid  AS target_id
  FROM jsonb_array_elements(p_mapping) e;

  -- ── Validation ─────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM _adopt_map WHERE action NOT IN ('merge', 'move', 'keep')) THEN
    RAISE EXCEPTION 'Unknown action in mapping (expected merge / move / keep)';
  END IF;
  IF EXISTS (SELECT 1 FROM _adopt_map GROUP BY source_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate source exercise in mapping';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _adopt_map m
    LEFT JOIN exercises s ON s.id = m.source_id AND s.library_id = p_from
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Mapping references an exercise outside the source library';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _adopt_map m
    WHERE m.action = 'merge' AND (
      m.target_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM exercises t WHERE t.id = m.target_id AND t.library_id = p_to)
    )
  ) THEN
    RAISE EXCEPTION 'A merge row is missing a valid target exercise in the club catalogue';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _adopt_map m
    JOIN exercises s ON s.id = m.source_id
    WHERE m.action = 'move' AND s.exercise_code IS NOT NULL
      AND EXISTS (SELECT 1 FROM exercises t WHERE t.library_id = p_to AND t.exercise_code = s.exercise_code)
  ) THEN
    RAISE EXCEPTION 'A moved exercise has a code that already exists in the club catalogue — merge it or keep it personal';
  END IF;

  -- ── Report counts (identical for dry run and real run) ─────────────
  SELECT count(*) FILTER (WHERE action = 'merge'),
         count(*) FILTER (WHERE action = 'move'),
         count(*) FILTER (WHERE action = 'keep')
    INTO n_merge, n_move, n_keep
  FROM _adopt_map;

  SELECT count(*) INTO n_planned FROM planned_exercises x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_planned_combo_members FROM planned_exercise_combo_members x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_planned_combo_items FROM planned_combo_items x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_log FROM training_log_exercises x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_pr_hist FROM athlete_pr_history x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_combo_tpl_parts FROM exercise_combo_template_parts x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_tpl FROM program_template_exercises x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_tpl_combo FROM program_template_combo_members x
    WHERE x.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');

  SELECT count(*) INTO n_pr_conflicts
  FROM athlete_prs pr
  JOIN _adopt_map m ON m.source_id = pr.exercise_id AND m.action = 'merge'
  WHERE EXISTS (SELECT 1 FROM athlete_prs t WHERE t.athlete_id = pr.athlete_id AND t.exercise_id = m.target_id);
  SELECT count(*) - n_pr_conflicts INTO n_pr FROM athlete_prs pr
    WHERE pr.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');

  SELECT count(*) INTO n_macro_conflicts
  FROM macro_tracked_exercises mt
  JOIN _adopt_map m ON m.source_id = mt.exercise_id AND m.action = 'merge'
  WHERE EXISTS (SELECT 1 FROM macro_tracked_exercises t WHERE t.macrocycle_id = mt.macrocycle_id AND t.exercise_id = m.target_id);
  SELECT count(*) - n_macro_conflicts INTO n_macro FROM macro_tracked_exercises mt
    WHERE mt.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');

  SELECT count(*) INTO n_sollist_conflicts
  FROM sollist_model_rows sr
  JOIN _adopt_map m ON m.source_id = sr.exercise_id AND m.action = 'merge'
  WHERE EXISTS (
    SELECT 1 FROM sollist_model_rows t
    WHERE t.model_id = sr.model_id AND t.exercise_id = m.target_id AND t.reps IS NOT DISTINCT FROM sr.reps
  );
  SELECT count(*) - n_sollist_conflicts INTO n_sollist FROM sollist_model_rows sr
    WHERE sr.exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');

  SELECT count(*) INTO n_parent_repointed FROM exercises e
    WHERE e.parent_exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  SELECT count(*) INTO n_prref_repointed FROM exercises e
    WHERE e.pr_reference_exercise_id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');

  -- Moved rows whose parent stays personal: the edge will be cleared.
  SELECT count(*) INTO n_parent_cleared
  FROM _adopt_map m
  JOIN exercises s ON s.id = m.source_id
  JOIN exercises p ON p.id = s.parent_exercise_id
  WHERE m.action = 'move'
    AND p.library_id = p_from
    AND p.id NOT IN (SELECT source_id FROM _adopt_map WHERE action IN ('move', 'merge'));

  SELECT count(DISTINCT s.category) INTO n_categories
  FROM _adopt_map m
  JOIN exercises s ON s.id = m.source_id
  WHERE m.action = 'move'
    AND s.category IS NOT NULL AND s.category <> 'Unspecified' AND s.category NOT ILIKE '%system%'
    AND EXISTS (SELECT 1 FROM categories sc WHERE sc.library_id = p_from AND sc.name = s.category)
    AND NOT EXISTS (SELECT 1 FROM categories tc WHERE tc.library_id = p_to AND tc.name = s.category);

  n_refs_total := n_planned + n_planned_combo_members + n_planned_combo_items + n_log
    + n_pr_hist + n_combo_tpl_parts + n_tpl + n_tpl_combo + n_pr + n_macro + n_sollist;

  -- ── Execute (one transaction — the function's own) ─────────────────
  IF NOT p_dry_run THEN
    -- 1. Fold merged sources' name + aliases into their targets, so future
    --    imports/Soll-Ist labels resolve to the club exercise automatically.
    UPDATE exercises t
    SET aliases = (
      SELECT coalesce(array_agg(DISTINCT a), '{}')
      FROM unnest(coalesce(t.aliases, '{}') || s.name || coalesce(s.aliases, '{}')) a
      WHERE btrim(a) <> '' AND lower(a) <> lower(t.name)
    )
    FROM _adopt_map m
    JOIN exercises s ON s.id = m.source_id
    WHERE m.action = 'merge' AND t.id = m.target_id;

    -- 2. Plain FK repoints (no unique constraint on exercise_id).
    UPDATE planned_exercises x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE planned_exercise_combo_members x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE planned_combo_items x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE training_log_exercises x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE athlete_pr_history x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE exercise_combo_template_parts x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE program_template_exercises x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;
    UPDATE program_template_combo_members x SET exercise_id = m.target_id
      FROM _adopt_map m WHERE m.action = 'merge' AND x.exercise_id = m.source_id;

    -- 3. Unique-guarded repoints; conflicting rows stay on the archived source.
    UPDATE athlete_prs pr SET exercise_id = m.target_id
      FROM _adopt_map m
      WHERE m.action = 'merge' AND pr.exercise_id = m.source_id
        AND NOT EXISTS (SELECT 1 FROM athlete_prs t WHERE t.athlete_id = pr.athlete_id AND t.exercise_id = m.target_id);
    UPDATE macro_tracked_exercises mt SET exercise_id = m.target_id
      FROM _adopt_map m
      WHERE m.action = 'merge' AND mt.exercise_id = m.source_id
        AND NOT EXISTS (SELECT 1 FROM macro_tracked_exercises t WHERE t.macrocycle_id = mt.macrocycle_id AND t.exercise_id = m.target_id);
    UPDATE sollist_model_rows sr SET exercise_id = m.target_id
      FROM _adopt_map m
      WHERE m.action = 'merge' AND sr.exercise_id = m.source_id
        AND NOT EXISTS (
          SELECT 1 FROM sollist_model_rows t
          WHERE t.model_id = sr.model_id AND t.exercise_id = m.target_id AND t.reps IS NOT DISTINCT FROM sr.reps
        );

    -- 4. Self-FK repoints everywhere (a child of a merged source becomes a
    --    child of the club target). A target that pointed at its own merge
    --    source would self-reference — clear those edges instead.
    UPDATE exercises e SET parent_exercise_id = NULL
      FROM _adopt_map m
      WHERE m.action = 'merge' AND e.parent_exercise_id = m.source_id AND e.id = m.target_id;
    UPDATE exercises e SET parent_exercise_id = m.target_id
      FROM _adopt_map m
      WHERE m.action = 'merge' AND e.parent_exercise_id = m.source_id AND e.id <> m.target_id;
    UPDATE exercises e SET pr_reference_exercise_id = NULL
      FROM _adopt_map m
      WHERE m.action = 'merge' AND e.pr_reference_exercise_id = m.source_id AND e.id = m.target_id;
    UPDATE exercises e SET pr_reference_exercise_id = m.target_id
      FROM _adopt_map m
      WHERE m.action = 'merge' AND e.pr_reference_exercise_id = m.source_id AND e.id <> m.target_id;

    -- 5. Ensure the target library has the moved rows' category names
    --    (copying colour/order from the source library's definition).
    INSERT INTO categories (name, display_order, color, owner_id, library_id)
    SELECT DISTINCT ON (sc.name) sc.name, sc.display_order, sc.color, v_owner, p_to
    FROM _adopt_map m
    JOIN exercises s ON s.id = m.source_id
    JOIN categories sc ON sc.library_id = p_from AND sc.name = s.category
    WHERE m.action = 'move'
      AND s.category <> 'Unspecified' AND s.category NOT ILIKE '%system%'
      AND NOT EXISTS (SELECT 1 FROM categories tc WHERE tc.library_id = p_to AND tc.name = sc.name);

    -- 6. Move rows into the club catalogue (ids preserved).
    UPDATE exercises SET library_id = p_to
      WHERE id IN (SELECT source_id FROM _adopt_map WHERE action = 'move');

    -- 7. A moved (now club) exercise must not stay parented to a personal
    --    one (merged parents were repointed in step 4; moved parents came
    --    along in step 6 — only genuinely-personal parents remain).
    UPDATE exercises s SET parent_exercise_id = NULL
      FROM exercises p
      WHERE s.id IN (SELECT source_id FROM _adopt_map WHERE action = 'move')
        AND p.id = s.parent_exercise_id AND p.library_id <> p_to;

    -- 8. Archive merged sources — never delete.
    UPDATE exercises SET is_archived = true
      WHERE id IN (SELECT source_id FROM _adopt_map WHERE action = 'merge');
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'merged', n_merge,
    'moved', n_move,
    'kept', n_keep,
    'categories_created', n_categories,
    'references_repointed', n_refs_total,
    'references', jsonb_build_object(
      'planned_exercises', n_planned,
      'planned_combo_members', n_planned_combo_members,
      'planned_combo_items', n_planned_combo_items,
      'training_log_exercises', n_log,
      'athlete_prs', n_pr,
      'athlete_pr_history', n_pr_hist,
      'macro_tracked_exercises', n_macro,
      'program_template_exercises', n_tpl,
      'program_template_combo_members', n_tpl_combo,
      'combo_template_parts', n_combo_tpl_parts,
      'sollist_model_rows', n_sollist
    ),
    'conflicts_kept', jsonb_build_object(
      'athlete_prs', n_pr_conflicts,
      'macro_tracked_exercises', n_macro_conflicts,
      'sollist_model_rows', n_sollist_conflicts
    ),
    'parent_links_repointed', n_parent_repointed,
    'pr_references_repointed', n_prref_repointed,
    'parent_links_cleared', n_parent_cleared
  );
END $$;
