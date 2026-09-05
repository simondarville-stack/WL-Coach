export interface CoachProfile {
  id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  club_name: string | null;
  locale: string;
  created_at: string;
  updated_at: string;
}

export type Category = string;

export interface CategoryRow {
  id: string;
  owner_id: string;
  name: string;
  display_order: number;
  color: string;
  /** Which catalogue this category belongs to (exercise_libraries.id).
   *  Null only on rows predating the shared-catalogue migration. */
  library_id: string | null;
  created_at: string;
}
export type DefaultUnit = 'percentage' | 'absolute_kg' | 'rpe' | 'free_text' | 'free_text_reps' | 'other';
/** @deprecated week_type is now a free string matching a WeekTypeConfig.abbreviation */
export type WeekType = string;

export interface WeekTypeConfig {
  name: string;          // "High", "Deload", "Shock"
  abbreviation: string;  // "h", "dl", "sh" (1-3 chars)
  color: string;         // hex color "#E24B4A"
}

export interface PhaseTypePreset {
  value: string;   // stored in phase_type column, e.g. 'preparatory'
  label: string;   // display name, e.g. 'Preparatory'
  color: string;   // default hex color for this phase type
}

/** One rhythm step: multipliers in % of the interpolated trend, for load and reps. */
export interface RhythmStep {
  load: number;  // e.g. 88 = week lands at 88 % of the load trend
  reps: number;  // e.g. 110 = week lands at 110 % of the reps trend
}

/**
 * Coach-defined fill-guide rhythm preset (general_settings.rhythm_presets; NULL column =
 * DEFAULT_RHYTHM_PRESETS).
 * - mode 'weektype': one step per week-type abbreviation — follows the types already on the
 *   weeks; abbreviations missing from `mult` count as 100/100 (sandbox-safe for custom types).
 * - mode 'pattern': repeating step sequence starting at the fill's first in-range week;
 *   `stampTypes` optionally carries a week-type abbreviation per step to write onto the weeks
 *   on apply (entries may be null = leave that week's type alone).
 */
export interface RhythmPreset {
  id: string;
  name: string;
  mode: 'weektype' | 'pattern';
  mult?: Record<string, RhythmStep>;
  pattern?: RhythmStep[];
  stampTypes?: (string | null)[] | null;
}

/** macro_templates row; payload typed loosely here to avoid a module cycle —
 *  the rich payload types live in src/lib/macroTemplate.ts (MacroTemplateRow). */
export interface MacroTemplateDbRow {
  id: string;
  owner_id: string;
  name: string;
  mode: 'kg' | 'pct';
  week_count: number;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

/** Per-macro table view config (macrocycles.table_layout; NULL = app defaults). */
export interface MacroTableLayout {
  /** keyed by tracked-exercise id */
  exercises?: Record<string, { collapsed?: boolean; expanded?: boolean; hidden?: boolean; graphed?: boolean }>;
  /** ordered exercise-metric registry state; highest priority first */
  metrics?: Array<{ key: string; on: boolean }>;
  /** visible base/general columns (MacroTableColumnKey[]); absent = settings default */
  baseColumns?: string[];
  viewToggles?: { consistency?: boolean; heatmap?: boolean; notesCollapsed?: boolean };
  /** Chart settings — persisted with the macro so a coach's series selection
   *  survives navigation and is the same on every device. Visibility is stored
   *  as the HIDDEN sets: a newly tracked exercise then shows by default and a
   *  removed one leaves no stale entry behind. */
  graph?: {
    avg?: boolean;
    repsBars?: boolean;
    linkDrag?: boolean;
    /** tracked-exercise ids hidden from the chart & table */
    hiddenExercises?: string[];
    /** general-metric keys ('k' | 'tonnage' | 'avg') hidden from the chart */
    hiddenGeneral?: string[];
  };
  /** Layout schema version. Absent = pre-versioning (predates the Training
   *  Week / Dates / Events columns); such layouts get those columns unioned in
   *  on load so they aren't silently hidden. Stamped to the current version on
   *  the next persist. */
  v?: number;
}
/** Open string — the four preset values ('preparatory', 'strength', 'competition', 'transition')
 * are suggestions only; free-text entry is allowed. See REVIEW_PLAN.md ENG-037. */
export type PhaseType = string;

export interface Athlete {
  id: string;
  owner_id: string;
  auth_user_id: string | null;
  name: string;
  birthdate: string | null;
  bodyweight: number | null;
  weight_class: string | null;
  club: string | null;
  notes: string | null;
  photo_url: string | null;
  is_active: boolean;
  track_bodyweight: boolean;
  competition_total: number | null;
  /** Optional soft-gate passphrase for the athlete app; null/empty = open. Deterrence only, not auth. */
  access_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface BodyweightEntry {
  id: string;
  athlete_id: string;
  date: string;
  weight_kg: number;
  created_at: string;
}

export interface AthletePRHistory {
  id: string;
  athlete_id: string;
  exercise_id: string;
  rep_count: number;        // 1–10
  value_kg: number;
  achieved_date: string;    // ISO date string
  notes: string | null;
  created_at: string;
}

export interface AthletePR {
  id: string;
  athlete_id: string;
  exercise_id: string;
  pr_value_kg: number | null;
  pr_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  owner_id: string;
  name: string;
  exercise_code: string | null;
  category: Category;
  is_competition_lift: boolean;
  default_unit: DefaultUnit;
  color: string;
  counts_towards_totals: boolean;
  use_stacked_notation: boolean;
  /** Show the individual R/S/Hi/Ø analysis column on this exercise's planner
   *  rows. Backfilled from counts_towards_totals; new exercises default true. */
  show_planner_summary: boolean;
  notes: string | null;
  link: string | null;
  is_archived: boolean;
  pr_reference_exercise_id: string | null;  // derives % from this exercise's PR
  track_pr: boolean;                         // false = excluded from PR table
  /** Alternative names this exercise is known by (BVDG German names, local
   *  Danish names …). Written by Soll–Ist repointing; read by preset/CSV
   *  resolution so the same source label maps automatically next time. */
  aliases: string[];
  /** Optional self-FK to the parent exercise for catalogue trees. NULL = root.
   *  A child (e.g. "Snatch from low hang") rolls its reps/tonnage/metrics up
   *  into its parent for analysis + planner totals, while still being planned
   *  and logged as its own variation. Arbitrary depth; cycle/owner guards live
   *  in src/lib/exerciseHierarchy.ts. */
  parent_exercise_id: string | null;
  /** Manual sort order within a parent/category for the catalogue tree view.
   *  NULL sorts after ordered siblings, then by name. Display-only. */
  display_order: number | null;
  lift_slot: 'snatch' | 'clean_and_jerk' | 'front_squat' | 'back_squat' | 'snatch_pull' | 'clean_pull' | null;
  /** Which catalogue this exercise lives in (exercise_libraries.id).
   *  Personal library = private to its coach; club library = shared with the
   *  library's members. Moving between libraries preserves the id, so all
   *  planned/logged/PR references survive. Null only on rows predating the
   *  shared-catalogue migration (inserts default via DB trigger). */
  library_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * ExerciseStub — minimal subset of Exercise used when only id/name/color
 * are available at call time (e.g. immediately after addOffPlanLogExercise or
 * setSubstitutedExercise, before a full reload). Type-safe replacement for
 * `as unknown as Exercise` casts. (E-05 / UF-32)
 */
export interface ExerciseStub {
  id: string;
  name: string;
  color: string | null;
  /** Sentinel discriminator (TEXT / GPP / …) when known at optimistic-add
   *  time, so an off-plan note/GPP card renders the right branch before the
   *  next full reload hydrates the real Exercise. Absent for plain picks. */
  exercise_code?: string | null;
  /** Carried from the picker so the totals gate is correct optimistically
   *  (a non-counting exercise must not briefly inflate the week's numbers).
   *  Absent ⇒ countsTowardsTotals defaults to true, as before. */
  counts_towards_totals?: boolean;
  /** Parent link, carried on optimistic adds so tree rendering doesn't drop the
   *  row before the next full reload hydrates the real Exercise. Absent ⇒ root. */
  parent_exercise_id?: string | null;
}

export interface TrainingGroup {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  /** Optional soft-gate passphrase for the group plan viewer; null/empty = open. Deterrence only, not auth. */
  access_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  athlete_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface GroupMemberWithAthlete extends GroupMember {
  athlete: Athlete;
}

export interface WeekPlan {
  id: string;
  owner_id: string;
  week_start: string;
  name: string | null;
  athlete_id: string | null;
  is_group_plan: boolean;
  group_id: string | null;
  source_group_plan_id: string | null;  // links individual plan back to its source group plan
  active_days: number[];
  day_labels: Record<number, string> | null;
  day_display_order: number[] | null;
  week_description: string | null;
  day_schedule: Record<number, { weekday: number; time: string | null }> | null;
  /** Which coach last touched this week plan. Null on rows created before
   *  the column existed or only ever edited by the host. Lets the planner
   *  show "Updated by Coach X" when last_edited_by_coach_id ≠ owner_id. */
  last_edited_by_coach_id: string | null;
  /** GROUP plans only: when this plan was last synced to its athletes and by
   *  whom (see GroupSyncModal). Optional because rows read before the
   *  20260831 migration is applied don't carry the columns at all. */
  last_synced_at?: string | null;
  last_synced_by_coach_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** Single row inside a GPP (General Physical Preparation) section. */
export interface GppRow {
  exercise: string;
  /** Reps text, kept as string to allow "12", "10-12", "AMRAP", "30 sec". */
  reps: string;
  sets: number;
  /** Optional load, free-form string ("24 kg", "BW", "moderate"). */
  load: string;
  /** Athlete-only: true once they've ticked this row. Coach-side rows
   *  use the planner metadata where this field is absent. */
  done?: boolean;
}

/**
 * GppSection is stored in two locations:
 *   - planned_exercises.metadata.gpp — the coach's planned section (source of truth for title/description/prescribed rows)
 *   - training_log_exercises.metadata.gpp — the athlete's live copy (rows have done flags; athlete field overrides planned)
 *
 * Merge behaviour (intended — Q-14 2026-05-20): when the coach edits planned rows after the athlete has
 * already saved, GppLogCard appends new coach rows to the athlete copy and preserves athlete edits.
 * The athlete's per-row values are always kept when the athlete array is longer than planned.
 */
export interface GppSection {
  title: string;
  description: string;
  rows: GppRow[];
}

/**
 * Exercise features — optional per-exercise enrichments (see
 * src/lib/exerciseFeatures.ts for helpers). Absent keys mean the feature
 * is off; a present key is an active feature.
 */
export interface ExerciseFeatures {
  /** Total time for the exercise block, in seconds. Athlete-visible. */
  totalTime?: number;
  /** Prescribed rest between sets, in seconds. Athlete-visible. */
  restTime?: number;
  /** Time-under-tension tempo, stored canonically as "A-B-C-D" =
   *  eccentric-pause-concentric-pause seconds. Athlete-visible. */
  tempo?: string;
  /** Coach override for summary_total_reps ("overwrites the summation").
   *  Coach/analysis-only, never athlete-visible. */
  totalReps?: number;
  /** Coach override for summary_total_sets. Coach/analysis-only. */
  totalSets?: number;
  /** Coach override for summary_highest_load. Coach/analysis-only. */
  highestLoad?: number;
  /** Coach override for summary_avg_load. Coach/analysis-only. */
  avgLoad?: number;
}

/** DORMANT — row badges were removed (2026-08-15): presets configure a row,
 *  they don't tag it. The type stays because a handful of rows written
 *  during the feature's short life still carry metadata.preset; nothing
 *  reads or writes it anymore. */
export interface PresetTag {
  name: string;
  color: string;
}

/** Parts of a planned exercise the coach can hide from the athlete app.
 *  'prescription' hides the plan numbers entirely (the athlete logs freely),
 *  'belowTopSet' shows only the heaviest set line ("work up to" without
 *  revealing the build), 'durations' hides the ⏱/⏸/⧖ timing chips,
 *  'note' hides the coach note. */
export type AthleteHiddenKey = 'prescription' | 'belowTopSet' | 'durations' | 'note';

export interface PlannedExerciseMetadata {
  /** GPP block content when the planned_exercise points at the GPP
   *  sentinel exercise. Absent for non-GPP rows. */
  gpp?: GppSection;
  /** Row parts hidden from the athlete app (eye menu in the planner).
   *  Absent/empty = everything visible, as always. */
  athleteHidden?: AthleteHiddenKey[];
  /** Coach-authored caption for IMAGE / VIDEO sentinels. Rendered next
   *  to the media in athlete log and print. */
  description?: string;
  /** Exercise features (total time, summary overrides). */
  features?: ExerciseFeatures;
  /** #preset badge (planner rows, print, athlete card). */
  preset?: PresetTag;
}

/** A coach-defined # prescription preset (coach_presets table). */
export interface CoachPreset {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  /** Show the #NAME badge on rows this preset is applied to. Off = the
   *  preset is a silent coach shortcut (e.g. #5x5). */
  show_badge: boolean;
  /** Prescription template in the canonical grammar; null = feature/badge-only preset. */
  prescription_raw: string | null;
  unit: DefaultUnit | null;
  features: ExerciseFeatures;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlannedExercise {
  id: string;
  weekplan_id: string;
  day_index: number;
  exercise_id: string;
  position: number;
  notes: string | null;
  unit: string | null;
  prescription_raw: string | null;
  summary_total_sets: number | null;
  summary_total_reps: number | null;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  variation_note: string | null;
  /** Coach override for this row's displayed name (a variation like "Snatch
   *  from blocks"). NULL = use the catalogue name. Never affects exercise_id,
   *  so logs and analysis stay under the original exercise. Resolve it through
   *  `plannedRowLabel`, never by reading this field directly. */
  display_name: string | null;
  is_combo: boolean;
  combo_notation: string | null;
  combo_color: string | null;
  source: 'group' | 'individual' | null;
  metadata: PlannedExerciseMetadata;
  created_at: string;
  updated_at: string;
}

export interface PlannedExerciseWithExercise extends PlannedExercise {
  exercise: Exercise;
}

export interface PlannedSetLine {
  id: string;
  planned_exercise_id: string;
  sets: number;
  sets_max: number | null;   // null = fixed set count, number = range upper bound
  reps: number;
  reps_max: number | null;   // null = fixed reps, number = range upper bound
  reps_text: string | null;
  load_value: number;
  load_max: number | null;   // null = fixed load, number = interval upper bound
  load_cmp: '>=' | '~' | '<=' | null;  // soft-load comparator (≥ ≈ ≤)
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannedExerciseComboMember {
  id: string;
  planned_exercise_id: string;
  exercise_id: string;
  position: number;
  created_at: string;
}

export interface PlannedExerciseComboMemberWithExercise extends PlannedExerciseComboMember {
  exercise: Exercise;
}

export type ComboMemberEntry = { exerciseId: string; exercise: Exercise; position: number };

export interface MacroCycle {
  id: string;
  owner_id: string;
  athlete_id: string | null;   // null for group macros
  group_id: string | null;     // null for individual macros
  name: string;
  start_date: string;
  end_date: string;
  /** Per-macro table view config (column states, metric registry, toggles). NULL = app defaults. */
  table_layout: MacroTableLayout | null;
  /** The macro's primary / target competition — an event id (events model).
   *  Competitions now live in `events`; this pointer marks which one is the
   *  target for this cycle. NULL = no primary set. */
  primary_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MacroWeek {
  id: string;
  macrocycle_id: string;
  week_start: string;
  week_number: number;
  week_type: string;
  week_type_text: string;
  notes: string;
  total_reps_target: number | null;
  tonnage_target: number | null;
  avg_intensity_target: number | null;
  /* phase_id was dropped in 20260729_drop_macro_weeks_phase_id — a week's
   * phase is resolved from macro_phases' week-number range via
   * lib/macroPhases.findPhaseForWeek, which is the only assignment the coach
   * ever makes. */
  volume_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface MacroPhase {
  id: string;
  owner_id: string;
  macrocycle_id: string;
  name: string;
  phase_type: PhaseType;
  start_week_number: number;
  end_week_number: number;
  color: string;
  notes: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface MacroCompetition {
  id: string;
  owner_id: string;
  macrocycle_id: string;
  competition_name: string;
  competition_date: string;
  is_primary: boolean;
  event_id: string | null;
  created_at: string;
}

export interface MacroTrackedExercise {
  id: string;
  macrocycle_id: string;
  exercise_id: string;
  position: number;
  /** Reference load (kg) for %-anchored fills and general-model templates. NULL = unset. */
  reference_kg: number | null;
  /**
   * Unit this column's targets are written in. NULL = 'absolute_kg' (every row
   * predating the column). The unit is per COLUMN, not per cell — see
   * src/lib/macroTargetUnit.ts, which is the only place that interprets it.
   */
  target_unit: 'absolute_kg' | 'percentage' | 'free_text_reps' | null;
  created_at: string;
  updated_at: string;
}

export interface MacroTrackedExerciseWithExercise extends MacroTrackedExercise {
  exercise: Exercise;
}

export interface MacroTarget {
  id: string;
  macro_week_id: string;
  tracked_exercise_id: string;
  target_reps: number | null;
  target_avg: number | null;
  target_max: number | null;
  target_reps_at_max: number | null;
  target_sets_at_max: number | null;
  /** Coach note for this exercise+week (e.g. "Go for a 3RM this week"). A row may hold only a note. */
  note: string | null;
  /** Free-text load ("Heavy", "Max out") when the column's target_unit is
   *  free_text_reps. Null for numeric columns, which use target_max/_avg. */
  target_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneralSettings {
  id: string;
  owner_id: string;
  raw_enabled: boolean;
  raw_average_days: number;
  grid_load_increment: number;
  grid_click_increment: number;
  default_prescription_load: number;
  percent_to_kg_round_enabled: boolean;
  percent_to_kg_round_increment: number;
  default_tracked_exercise_ids: string[];
  bodyweight_ma_days: number;
  visible_summary_metrics: string[];
  visible_card_metrics: string[];
  week_types: WeekTypeConfig[];
  show_stress_metric: boolean;
  dialog_mode: 'center' | 'sidebar';
  macro_table_columns: string[] | null;
  lift_ratio_targets: Record<string, { min: number; max: number }> | null;
  intensity_zones: Array<{ zone: string; min: number; max: number }> | null;
  compliance_warning_threshold: number | null;
  low_intensity_zone_max_pct: number | null;
  /** Field View: intensity (%) at or above which an exercise row renders bold.
   *  Null falls back to DEFAULT_FIELD_BOLD_PCT (90). */
  field_bold_intensity_pct: number | null;
  phase_type_presets: PhaseTypePreset[] | null;
  /** Coach-defined fill-guide rhythm presets. NULL = DEFAULT_RHYTHM_PRESETS. */
  rhythm_presets: RhythmPreset[] | null;
  /** Metric driving the macro timeline's load silhouette + week-planned
   *  marker. Null falls back to 'reps'. */
  timeline_metric: 'reps' | 'tonnage' | null;
  /** Which target metrics the macro review table expands on the active
   *  (selected) week. Null falls back to all three. */
  timeline_week_detail: Array<'reps' | 'max' | 'avg'> | null;
  /** Coach-defined quick-reaction chips on Review cards. NULL =
   *  DEFAULT_QUICK_REACTIONS; an empty array means "no chips". */
  review_quick_reactions: string[] | null;
  /** Show the 1–5 technique rating control on Review cards. */
  review_technique_rating_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Map of athlete_metric_definitions.id -> the value the athlete
 *  entered. value_number wins for numeric metrics, value_text for
 *  free-text metrics — they're mutually exclusive per metric. */
export type CustomMetricEntry =
  | { value_number: number; value_text?: never }
  | { value_text: string; value_number?: never };

export interface TrainingLogSession {
  id: string;
  owner_id: string;
  athlete_id: string;
  date: string;
  week_start: string;
  day_index: number;
  /** Athlete-provided label for this session (mainly used for bonus days).
   *  Falls back to the week_plans.day_labels lookup when null. */
  session_label: string | null;
  session_notes: string;
  status: string;
  /** Athlete's reason when the whole session is marked "not done"
   *  (status = 'skipped') — e.g. sick, injured. Null otherwise. Kept
   *  separate from session_notes so neither overwrites the other. */
  skipped_reason: string | null;
  raw_sleep: number | null;
  raw_physical: number | null;
  raw_mood: number | null;
  raw_nutrition: number | null;
  raw_total: number | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  session_rpe: number | null;
  bodyweight_kg: number | null;
  vas_score: number | null;
  custom_metrics: Record<string, CustomMetricEntry>;
  /** Stamped when a coach reviews this session in the Review feed.
   *  Null = new (not yet reviewed). See migration add_session_coach_reviewed_at. */
  coach_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AthleteMetricDefinition {
  id: string;
  athlete_id: string;
  owner_id: string;
  label: string;
  value_type: 'number' | 'text';
  unit: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AthleteWeekMetricsConfig {
  id: string;
  athlete_id: string;
  owner_id: string;
  week_start: string;
  track_raw: boolean;
  track_bodyweight: boolean;
  track_vas: boolean;
  enabled_custom_metric_ids: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Descriptor for an athlete-authored off-plan combination. Lives on the log
 * row (training_log_exercises.metadata.combo) because the log schema has no
 * is_combo / combo-members table — combos are otherwise a planned-only
 * construct. Member name/color are denormalised so the off-plan cards render
 * member dots without an extra exercises join (logs are point-in-time, so a
 * later rename of the underlying exercise intentionally does not propagate).
 * The lead member's exerciseId is also stored as the row's exercise_id, so
 * code that reads a single exercise off the row still gets a sensible value.
 */
export interface LogComboDescriptor {
  /** Athlete-given name; null ⇒ derive "A + B + …" from members. */
  name: string | null;
  /** Ribbon/accent colour; null ⇒ fall back to the lead member's colour. */
  color: string | null;
  members: { exerciseId: string; name: string; color: string | null; position: number }[];
}

export interface TrainingLogExerciseMetadata {
  /** Set numbers from the planned prescription the athlete chose to
   *  drop. The set wasn't skipped (no ✗ press) — it was actively
   *  removed from the day's plan. Rendered as a gap on coach Log. */
  removed_set_numbers?: number[];
  /** Athlete-side state of a GPP block: the rows the athlete checked
   *  off, plus any edits they made (e.g. they did 12 reps not 10).
   *  When absent, the athlete view falls back to planned rows. */
  gpp?: GppSection;
  /** Body text for an athlete-authored off-plan note (TEXT sentinel row).
   *  Coach TEXT lines read planned_exercises.notes; an off-plan row has no
   *  planned row, so the note body lives here instead. */
  text?: string;
  /** Combo descriptor for an athlete-authored off-plan combination. */
  combo?: LogComboDescriptor;
}

export interface TrainingLogExercise {
  id: string;
  owner_id: string | null;
  session_id: string;
  exercise_id: string | null;  // null = exercise was deleted
  planned_exercise_id: string | null;
  performed_raw: string;
  performed_notes: string;
  position: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  technique_rating: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: TrainingLogExerciseMetadata;
}

export interface TrainingLogExerciseWithExercise extends TrainingLogExercise {
  exercise: Exercise;
}

export interface TrainingLogSet {
  id: string;
  owner_id: string | null;
  log_exercise_id: string;
  set_number: number;
  planned_load: number | null;
  planned_reps: number | null;
  performed_load: number | null;
  performed_reps: number | null;
  /** Athlete-entered free-text performed value for non-quantified exercises.
   *  Distinct from notes (athlete annotation) — see UF-43 / DC-01. */
  performed_text: string | null;
  rpe: number | null;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A video clip attached to one logged exercise. Athletes record these from
 *  the log; coaches watch them from Log mode and the coach mobile app. */
export interface TrainingLogVideo {
  id: string;
  log_exercise_id: string;
  athlete_id: string;
  /** Which set the clip shows, when the athlete tagged one. Null for a clip
   *  that covers the exercise as a whole. */
  set_number: number | null;
  video_url: string;
  /** Object key inside the `log-videos` bucket. Null only for rows written
   *  before the column existed; deletes fall back to parsing the URL. */
  storage_path: string | null;
  /** Poster JPEG captured at upload (or the Stream thumbnail). Null on rows
   *  predating the column — tiles fall back to a lazy <video> poster. */
  thumbnail_url: string | null;
  description: string | null;
  uploaded_by: 'athlete' | 'coach';
  /** Stamped the first time a coach opens the clip — drives "new footage". */
  coach_reviewed_at: string | null;
  owner_id: string | null;
  created_at: string;
}

/** Per-coach review record for the Review feed (migration
 *  add_review_feed_seen). One row = this coach has reviewed this item;
 *  other coaches keep their own rows, so a shared athlete's material is
 *  reviewed by everyone independently. */
export interface ReviewFeedSeen {
  id: string;
  /** The reviewing coach (coach_profiles.id). */
  owner_id: string;
  item_type: 'video' | 'thread' | 'session';
  /** Video id / session id / latest athlete message id of a thread. */
  item_key: string;
  seen_at: string;
}

/** Per-coach inbox read watermark (migration add_coach_thread_reads).
 *  A thread is unread for a coach when it holds an athlete message newer
 *  than their last_read_at. thread_key = session id or 'general:<athleteId>'. */
export interface CoachThreadRead {
  id: string;
  /** The reading coach (coach_profiles.id). */
  owner_id: string;
  thread_key: string;
  last_read_at: string;
}

/**
 * What a message is *about*, when the sender tagged something on the
 * session it hangs off — one exercise the athlete logged, or one metric
 * they entered (bodyweight, RAW, VAS, a custom metric, session RPE…).
 *
 * The message text stays plain and carries the same tag as an `@Label`
 * token (`@Snatch looked slow on set 3`), so a surface that knows nothing
 * about tags still reads correctly; tag-aware surfaces highlight the token
 * and file the comment under the thing it names. `label` is frozen at send
 * time: renaming the exercise later must not orphan the token in the text.
 */
export type MessageTag =
  | {
      kind: 'exercise';
      /** training_log_exercises.id — the logged row, not the catalogue id. */
      logExerciseId: string;
      label: string;
    }
  | {
      kind: 'metric';
      /** Same keys as the session card's metric chips: `bw`, `raw`,
       *  `raw:Sleep`, `vas`, `custom:<definition id>`, plus `rpe`,
       *  `duration` and `notes` for the session-level fields. */
      key: string;
      label: string;
      /** The value as it read when tagged (formatted, unit included). */
      value: string | null;
    };

export interface TrainingLogMessage {
  id: string;
  owner_id: string | null;
  /** Session this message belongs to. NULL for "general" athlete↔coach
   *  threads that are not tied to a specific training day. */
  session_id: string | null;
  /** Athlete the thread is with. Populated for both session-bound and
   *  general messages; backfilled from session.athlete_id for session
   *  rows (see migration 20260526000001). */
  athlete_id: string | null;
  exercise_id: string | null;
  sender_type: 'athlete' | 'coach';
  /** Which coach posted this message. Null for sender_type='athlete' and
   *  for legacy rows written before the column existed. Used by the
   *  shared-inbox UI to label messages from multiple coaches. */
  sender_coach_id: string | null;
  message: string;
  /** Timestamp when the coach last read this message. Null = unread by coach.
   *  Set by the service when the coach views the session. See UF-10 / A5.
   *  POLICY: read state is one-way surveillance — this field is NEVER shown
   *  in athlete-facing UI. The coach sees athlete_read_at ("Seen") on their
   *  own messages; the athlete never learns whether the coach has read. */
  coach_read_at: string | null;
  /** Timestamp when the athlete last read this message. Null = unread by athlete.
   *  Set by the service when the athlete views the session. See UF-10 / A5. */
  athlete_read_at: string | null;
  /** What the message is about (see MessageTag). Optional because rows
   *  written before migration 20260905090000 have no column at all; read it
   *  through `messageTags()` in src/lib/messageTags.ts, never directly. */
  tags?: MessageTag[] | null;
  created_at: string;
}

export type EventType = 'competition' | 'training_camp' | 'seminar' | 'testing_day' | 'team_meeting' | 'other';

export interface Event {
  id: string;
  owner_id: string;
  name: string;
  event_date: string;
  end_date: string | null;
  description: string | null;
  event_type: EventType;
  location: string | null;
  color: string | null;
  notes: string | null;
  is_all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventAthlete {
  id: string;
  event_id: string;
  athlete_id: string;
  created_at: string;
}

export interface EventAttempts {
  id: string;
  event_id: string;
  athlete_id: string;
  planned_snatch_1: number | null;
  planned_snatch_2: number | null;
  planned_snatch_3: number | null;
  planned_cj_1: number | null;
  planned_cj_2: number | null;
  planned_cj_3: number | null;
  actual_snatch_1: number | null;
  actual_snatch_2: number | null;
  actual_snatch_3: number | null;
  actual_cj_1: number | null;
  actual_cj_2: number | null;
  actual_cj_3: number | null;
  competition_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventVideo {
  id: string;
  event_id: string;
  athlete_id: string;
  lift_type: 'snatch' | 'clean_jerk';
  attempt_number: number;
  video_url: string;
  description: string | null;
  created_at: string;
}

/* ExerciseComboTemplate: currently global (no owner_id). Intentionally
 * shared across coaches until DAT-014 decision is made.
 * See REVIEW_PLAN.md DAT-014. */
export interface ExerciseComboTemplate {
  id: string;
  name: string;
  unit: DefaultUnit | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExerciseComboTemplatePart {
  id: string;
  template_id: string;
  exercise_id: string;
  position: number;
  created_at: string;
}

export interface ExerciseComboTemplatePartWithExercise extends ExerciseComboTemplatePart {
  exercise: Exercise;
}

export interface ExerciseComboTemplateWithParts extends ExerciseComboTemplate {
  parts: ExerciseComboTemplatePartWithExercise[];
}

export interface PlannedCombo {
  id: string;
  weekplan_id: string;
  day_index: number;
  position: number;
  template_id: string | null;
  combo_name: string | null;
  unit: DefaultUnit;
  shared_load_value: number;
  sets: number;
  reps_tuple_text: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannedComboItem {
  id: string;
  planned_combo_id: string;
  exercise_id: string;
  position: number;
  planned_exercise_id: string;
  created_at: string;
}

export interface PlannedComboItemWithExercise extends PlannedComboItem {
  exercise: Exercise;
}

export interface PlannedComboSetLine {
  id: string;
  planned_combo_id: string;
  position: number;
  load_value: number;
  sets: number;
  reps_tuple_text: string;
  created_at: string;
}

export interface PlannedComboWithDetails extends PlannedCombo {
  template: ExerciseComboTemplate | null;
  items: PlannedComboItemWithExercise[];
  set_lines: PlannedComboSetLine[];
}

// ── Programme templates (Weekly Designer Dock) ───────────────────────
// Reusable bundles of one or more "template days", each containing
// exercises with prescriptions. Per-coach (owner_id). The exercise
// row shape mirrors PlannedExercise so applying a template into a
// week_plan is a structured copy with no field translation.

export interface ProgramTemplate {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ProgramTemplateDay {
  id: string;
  template_id: string;
  day_index: number;          // 1-based within the template
  label: string;
  created_at: string;
}

export interface ProgramTemplateExercise {
  id: string;
  template_day_id: string;
  exercise_id: string;
  position: number;
  unit: string | null;
  prescription_raw: string | null;
  notes: string | null;
  variation_note: string | null;
  is_combo: boolean;
  combo_notation: string | null;
  combo_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramTemplateComboMember {
  id: string;
  template_exercise_id: string;
  exercise_id: string;
  position: number;
  created_at: string;
}

export interface ProgramTemplateComboMemberWithExercise extends ProgramTemplateComboMember {
  exercise: Exercise;
}

export interface ProgramTemplateExerciseWithExercise extends ProgramTemplateExercise {
  exercise: Exercise;
  combo_members?: ProgramTemplateComboMemberWithExercise[];
}

export interface ProgramTemplateDayWithExercises extends ProgramTemplateDay {
  exercises: ProgramTemplateExerciseWithExercise[];
}

export interface ProgramTemplateFull extends ProgramTemplate {
  days: ProgramTemplateDayWithExercises[];
}

/** A template day stripped down to just what the dock needs to render
 *  drag handles and a short exercise preview. */
export interface ProgramTemplateDayLite {
  id: string;
  day_index: number;
  label: string;
  exercise_names: string[];
}

/** Lightweight shape used by list views — header + computed day_count
 *  and the lite list of days (id/index/label only). */
export interface ProgramTemplateSummary extends ProgramTemplate {
  day_count: number;
  days: ProgramTemplateDayLite[];
}

/** Single breadcrumb captured by the in-app error logger.
 *  Persisted as one element in error_logs.breadcrumbs (jsonb). */
export interface ErrorBreadcrumb {
  ts: string;
  category: 'nav' | 'click' | 'mutation' | 'query' | 'auth' | 'info';
  message: string;
  data?: Record<string, unknown>;
}

export interface ErrorLogEntry {
  id: string;
  created_at: string;
  source: 'react' | 'window' | 'promise' | 'manual' | 'supabase';
  name: string | null;
  message: string;
  stack: string | null;
  error_code: string | null;
  url: string | null;
  user_agent: string | null;
  app_version: string | null;
  actor_role: 'coach' | 'athlete' | 'unknown' | null;
  actor_id: string | null;
  actor_label: string | null;
  breadcrumbs: ErrorBreadcrumb[];
  context: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_note: string | null;
}

export type CollaboratorRole = 'co_coach' | 'viewer';

/** Coach-to-coach sharing of an athlete. Created when a host coach
 *  invites another coach to co-coach or view; accepted_at flips on
 *  acceptance, revoked_at on revocation. The host coach is
 *  athletes.owner_id; this row only ever describes additional access. */
export interface AthleteCollaborator {
  id: string;
  athlete_id: string;
  coach_id: string;
  role: CollaboratorRole;
  invited_by: string;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface TrainingGroupCollaborator {
  id: string;
  group_id: string;
  coach_id: string;
  role: CollaboratorRole;
  invited_by: string;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
}

/* ---- Shared exercise catalogues (exercise_libraries) ---- */

export type LibraryRole = 'editor' | 'viewer';

/** A catalogue of exercises + categories. Every coach has exactly one
 *  'personal' library; 'club' libraries are shared via
 *  exercise_library_members (editors shape the tree, viewers lock on
 *  read-only). */
export interface ExerciseLibrary {
  id: string;
  name: string;
  kind: 'club' | 'personal';
  owner_coach_id: string | null; // set iff kind = 'personal'
  /** The club this catalogue is attached to. Null = standalone (ad-hoc
   *  shared catalogue, the 0.52.0 flow). Attached catalogues are managed
   *  from the club admin page: club membership provisions catalogue access. */
  club_id: string | null;
  created_at: string;
}

/* ---- Clubs (organisation layer above coaches) ---- */

export type ClubRole = 'admin' | 'coach';

/** An organisation of coaches. Owns club catalogues via
 *  exercise_libraries.club_id; will grow toward athletes/groups later.
 *  Membership is explicit (club_members) — never derived from the free-text
 *  coach_profiles.club_name. */
export interface Club {
  id: string;
  name: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** A coach's membership of a club. 'admin' runs the club (members,
 *  catalogues, roles); 'coach' is a member. Invite lifecycle mirrors
 *  athlete_collaborators. */
export interface ClubMember {
  id: string;
  club_id: string;
  coach_id: string;
  role: ClubRole;
  invited_by: string;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
}

/** Membership of a coach in a club library. Mirrors athlete_collaborators
 *  (invite / accept / revoke lifecycle). */
export interface ExerciseLibraryMember {
  id: string;
  library_id: string;
  coach_id: string;
  role: LibraryRole;
  invited_by: string;
  invited_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
}

/* ---- Soll–Ist analysis (sollist_*). Domain-facing shapes live in
 * src/lib/sollIst.ts; these are the raw table rows. ---- */
export interface SollIstModelDbRow {
  id: string;
  owner_id: string;
  name: string;
  kind: 'individual' | 'custom';
  athlete_id: string | null;
  notes: string | null;
  /** jsonb list of references: { key, label, exercise_id } (generic — any
   *  exercise or none can anchor the index; see src/lib/sollIst.ts). */
  refs: unknown;
  created_at: string;
  updated_at: string;
}

export interface SollIstModelRowDbRow {
  id: string;
  model_id: string;
  exercise_id: string;
  /** Points at a reference key in the owning model's `refs` jsonb. */
  ref_key: string;
  index_pct: number;
  reps: number;
  display_order: number | null;
}

export interface SollIstAnalysisDbRow {
  id: string;
  owner_id: string;
  name: string;
  athlete_id: string | null;
  model_id: string | null;
  preset_key: string | null;
  /** jsonb list of { key, label, exercise_id, current, goal }. */
  refs: unknown;
  ist_overrides: Record<string, number>;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * A video imported directly into KinEMOS (migration 20260901120000).
 *
 * Only direct imports live here — log clips and competition footage stay in
 * their own tables and the library reads all three (src/kinemos/lib/
 * videoLibrary.ts). Bytes live in R2 under `r2_key`; the row deliberately
 * stores the key rather than a URL, so moving the serving origin cannot rot
 * every stored link the way it did in the Netlify era.
 */
export interface KinemosVideo {
  id: string;
  owner_id: string | null;
  /** Both nullable: unattached footage (seminar clips, other clubs' lifters)
   *  is first-class in KinEMOS. */
  athlete_id: string | null;
  exercise_id: string | null;
  r2_key: string;
  /** Poster frame's key — same UUID, `.jpg`. Null when the capture failed. */
  thumb_key: string | null;
  original_name: string | null;
  size_bytes: number | null;
  /** Probed at import; null when the container could not be read. fps and the
   *  dimensions are what later phases grade analysis accuracy against. */
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  /** From container metadata where the phone left it — seeds the model-lookup
   *  calibration tier. Frequently absent. */
  device_make: string | null;
  device_model: string | null;
  trimmed: boolean;
  original_duration_s: number | null;
  /** When the lift happened, as opposed to when it was imported. */
  recorded_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** KinEMOS analysis record — one per REP, not one per clip (design §7: a
 *  three-rep set yields three bar paths and three metric rows). Its source is
 *  polymorphic so a log clip, a competition attempt and a direct import are all
 *  analysable without mirroring any of them. */
export interface KinemosAnalysis {
  id: string;
  owner_id: string | null;
  /** Which of the library's three sources `source_id` points into. */
  source_kind: 'log' | 'event' | 'direct';
  source_id: string;
  /** 1-based, as a coach counts reps. */
  rep_index: number;
  label: string | null;
  /** Frame geometry the points were captured in — display space, rotation
   *  already applied. Lets a later reader tell whether stored pixels still mean
   *  what they meant. */
  frame_width: number | null;
  frame_height: number | null;
  rotation: number | null;
  /** Mass for the power computation P2 will do. Captured now because it is free
   *  here and expensive to reconstruct later. */
  mass_kg: number | null;
  mass_source: 'logged' | 'manual' | null;
  status: string;
  notes: string | null;

  /** Phase edges as the coach has them: engine proposals until one is dragged,
   *  and each carries where it came from — see engine/phases.ts. */
  phase_boundaries: KinemosPhaseBoundaryRow[] | null;
  /** Which phase model segmented this rep. Coaches disagree about how a lift
   *  divides, so "second pull" only means something alongside the set that
   *  defined it. */
  phase_set_id: string;
  /** Computed metrics. A cache of what the engine derives from the track and
   *  the calibration, not a source of truth — recomputed on every load, stored
   *  so a trend view can read a season without re-running the pipeline. */
  metrics: Record<string, unknown> | null;

  grade: 'A' | 'B' | 'C' | null;
  /** The error estimate behind the letter. Stored with it, because a grade
   *  without its number is decoration. */
  grade_error_ms: number | null;
  grade_factors: Record<string, unknown>[] | null;

  /** How the clip was filmed. The coach's to state until a stabiliser can
   *  infer it, and worth about half the error budget. */
  camera: 'tripod' | 'stabilised' | 'handheld' | 'unknown' | null;

  /** The athlete's reference lift for this exercise — the one their other
   *  lifts are judged against. One per (athlete, exercise), enforced by
   *  `referenceService`, not the database (see migration 20260902200000). */
  is_reference: boolean;

  /** A model lift: an exemplar offered when comparing ANY athlete, not only
   *  its own (design §8 comparison item 3, the club-wide half that the
   *  per-athlete reference above does not cover). Several may exist for one
   *  lift; choosing between them is the coach's business. */
  is_model: boolean;
  /** What it is a model OF, in the coach's words — "Textbook second pull".
   *  A model lift without a name is an anonymous bar path. */
  model_label: string | null;

  created_at: string;
  updated_at: string;
}

/** One stored phase edge. Mirrors `PhaseBoundary` in engine/phases.ts; kept
 *  structurally separate so the database shape and the engine's own type can
 *  diverge without one silently reinterpreting the other. */
export interface KinemosPhaseBoundaryRow {
  phaseId: string | null;
  t: number;
  rule: string;
  source: 'detected' | 'fallback' | 'coach';
}

/** The px→cm record: the coach's confirmed plate ellipse plus the scales
 *  derived from it. Two scales, never one — the plate's minor axis is its
 *  diameter squashed by cos θ (design §6.1). */
export interface KinemosCalibration {
  id: string;
  owner_id: string | null;
  analysis_id: string;
  frame_index: number | null;
  frame_t: number | null;
  ellipse_cx: number;
  ellipse_cy: number;
  semi_major_px: number;
  semi_minor_px: number;
  tilt_deg: number;
  plate_diameter_cm: number;
  cm_per_px_v: number | null;
  cm_per_px_h: number | null;
  viewing_angle_deg: number | null;
  confidence: string | null;
  distortion_source: 'none' | 'model' | 'profile';
  stabilised: boolean;
  created_at: string;
  updated_at: string;
}

/** One stored track point. `t` is the frame's real presentation timestamp —
 *  never an index over a nominal fps (design §6.3). `s` records whether a hand
 *  or a tracker put it there. */
export interface KinemosTrackPoint {
  t: number;
  x: number;
  y: number;
  s?: 'm' | 't';
}

/** The point series for one tracked thing on one rep. JSONB because it is read
 *  and written as a unit and nothing queries a single frame across analyses. */
export interface KinemosTrack {
  id: string;
  owner_id: string | null;
  analysis_id: string;
  kind: string;
  points: KinemosTrackPoint[];
  tracker_tier: 'manual' | 'assisted' | 'marker' | 'ml';
  correction_count: number;
  filter_settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Snapshots, notes and hand measurements: one table, because to a coach they
 *  are the same object — a thing said about a moment in the lift. */
export interface KinemosAnnotation {
  id: string;
  owner_id: string | null;
  analysis_id: string;
  kind: 'snapshot' | 'note' | 'measurement' | 'talkover';
  frame_index: number | null;
  frame_t: number | null;
  body: string | null;
  /** R2 object key for a snapshot JPEG. Only the key, never a URL. */
  asset_key: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Whether one athlete's coach-corrected tracks may be used as machine-
 *  learning training data (design §10). Granting and revoking are both
 *  dated, because a withdrawal ends future use rather than rewriting what
 *  was lawfully done before it. */
export interface KinemosTrainingConsent {
  id: string;
  owner_id: string | null;
  athlete_id: string;
  granted_at: string | null;
  revoked_at: string | null;
  recorded_by_coach_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A lens, measured once and reused for every clip from the same phone
 *  (design §6.1's model/profile tiers). `k1` is the division model's single
 *  coefficient, normalised by half the image diagonal so it describes the
 *  lens rather than the recording. */
export interface KinemosDeviceProfile {
  id: string;
  owner_id: string | null;
  /** Normalised "<make> <model>", lower case — what a clip is looked up by. */
  device_key: string;
  device_make: string | null;
  device_model: string | null;
  athlete_id: string | null;
  k1: number;
  method: 'plumb-line' | 'manual';
  residual_before_px: number | null;
  residual_after_px: number | null;
  chains: number | null;
  frames: number | null;
  frame_width: number | null;
  frame_height: number | null;
  source_kind: 'log' | 'event' | 'direct' | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What a share's card says — frozen when the coach shared it, so a rep
 *  re-tracked later does not rewrite what the athlete was sent. */
export interface KinemosShareSummary {
  athleteName: string | null;
  exerciseName: string | null;
  /** The lift's date, YYYY-MM-DD. */
  date: string | null;
  loadKg: number | null;
  repIndex: number;
  label: string | null;
  vmaxMs: number | null;
  peakHeightCm: number | null;
  grade: 'A' | 'B' | 'C' | null;
  /** Where the clip plays from, when the athlete may watch it. */
  clipUrl: string | null;
  /** The coach talking through the lift, when a talkover was included. */
  talkoverUrl?: string | null;
}

/** One analysed rep handed to an athlete (or, later, a colleague or an
 *  export): the picture, the numbers as they stood, and a reference to the
 *  message that carried the coach's words. */
export interface KinemosShare {
  id: string;
  owner_id: string | null;
  analysis_id: string;
  channel: 'athlete' | 'club' | 'export';
  athlete_id: string | null;
  sender_coach_id: string | null;
  message_id: string | null;
  /** The colleague it went to, on the club channel. */
  recipient_coach_id: string | null;
  /** The sender's words on a club share — coaches have no thread of their
   *  own to carry them. */
  note: string | null;
  /** R2 key of the share's picture. Only the key, never a URL. */
  asset_key: string | null;
  summary: KinemosShareSummary;
  created_at: string;
  athlete_read_at: string | null;
  /** When the colleague first opened a club share. */
  coach_read_at: string | null;
}

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: CategoryRow & Record<string, unknown>;
        Insert: Partial<Omit<CategoryRow, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<CategoryRow, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athletes: {
        Row: Athlete & Record<string, unknown>;
        Insert: Partial<Omit<Athlete, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<Athlete, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      bodyweight_entries: {
        Row: BodyweightEntry & Record<string, unknown>;
        Insert: Partial<Omit<BodyweightEntry, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<BodyweightEntry, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athlete_prs: {
        Row: AthletePR & Record<string, unknown>;
        Insert: Partial<Omit<AthletePR, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<AthletePR, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athlete_pr_history: {
        Row: AthletePRHistory & Record<string, unknown>;
        Insert: Partial<Omit<AthletePRHistory, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<AthletePRHistory, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      exercises: {
        Row: Exercise & Record<string, unknown>;
        Insert: Partial<Omit<Exercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<Exercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      week_plans: {
        Row: WeekPlan & Record<string, unknown>;
        Insert: Partial<Omit<WeekPlan, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<WeekPlan, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      planned_exercises: {
        Row: PlannedExercise & Record<string, unknown>;
        Insert: Partial<Omit<PlannedExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<PlannedExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      planned_set_lines: {
        Row: PlannedSetLine & Record<string, unknown>;
        Insert: Partial<Omit<PlannedSetLine, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<PlannedSetLine, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      planned_exercise_combo_members: {
        Row: PlannedExerciseComboMember & Record<string, unknown>;
        Insert: Partial<Omit<PlannedExerciseComboMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<PlannedExerciseComboMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      coach_presets: {
        Row: CoachPreset & Record<string, unknown>;
        Insert: Partial<Omit<CoachPreset, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<CoachPreset, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macrocycles: {
        Row: MacroCycle & Record<string, unknown>;
        Insert: Partial<Omit<MacroCycle, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroCycle, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_weeks: {
        Row: MacroWeek & Record<string, unknown>;
        Insert: Partial<Omit<MacroWeek, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroWeek, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_phases: {
        Row: MacroPhase & Record<string, unknown>;
        Insert: Partial<Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_tracked_exercises: {
        Row: MacroTrackedExercise & Record<string, unknown>;
        Insert: Partial<Omit<MacroTrackedExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroTrackedExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_targets: {
        Row: MacroTarget & Record<string, unknown>;
        Insert: Partial<Omit<MacroTarget, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroTarget, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_templates: {
        Row: MacroTemplateDbRow & Record<string, unknown>;
        Insert: Partial<Omit<MacroTemplateDbRow, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroTemplateDbRow, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      sollist_models: {
        Row: SollIstModelDbRow & Record<string, unknown>;
        Insert: Partial<Omit<SollIstModelDbRow, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<SollIstModelDbRow, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      sollist_model_rows: {
        Row: SollIstModelRowDbRow & Record<string, unknown>;
        Insert: Partial<Omit<SollIstModelRowDbRow, 'id'>> & Record<string, unknown>;
        Update: Partial<Omit<SollIstModelRowDbRow, 'id'>> & Record<string, unknown>;
        Relationships: [];
      };
      sollist_analyses: {
        Row: SollIstAnalysisDbRow & Record<string, unknown>;
        Insert: Partial<Omit<SollIstAnalysisDbRow, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<SollIstAnalysisDbRow, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      general_settings: {
        Row: GeneralSettings & Record<string, unknown>;
        Insert: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_log_sessions: {
        Row: TrainingLogSession & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogSession, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogSession, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athlete_metric_definitions: {
        Row: AthleteMetricDefinition & Record<string, unknown>;
        Insert: Partial<Omit<AthleteMetricDefinition, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<AthleteMetricDefinition, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athlete_week_metrics_config: {
        Row: AthleteWeekMetricsConfig & Record<string, unknown>;
        Insert: Partial<Omit<AthleteWeekMetricsConfig, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<AthleteWeekMetricsConfig, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_log_exercises: {
        Row: TrainingLogExercise & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_log_sets: {
        Row: TrainingLogSet & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogSet, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogSet, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_log_videos: {
        Row: TrainingLogVideo & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogVideo, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogVideo, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_log_messages: {
        Row: TrainingLogMessage & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogMessage, 'id' | 'created_at' | 'coach_read_at' | 'athlete_read_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogMessage, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      review_feed_seen: {
        Row: ReviewFeedSeen & Record<string, unknown>;
        Insert: Partial<Omit<ReviewFeedSeen, 'id' | 'seen_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ReviewFeedSeen, 'id'>> & Record<string, unknown>;
        Relationships: [];
      };
      coach_thread_reads: {
        Row: CoachThreadRead & Record<string, unknown>;
        Insert: Partial<Omit<CoachThreadRead, 'id'>> & Record<string, unknown>;
        Update: Partial<Omit<CoachThreadRead, 'id'>> & Record<string, unknown>;
        Relationships: [];
      };
      events: {
        Row: Event & Record<string, unknown>;
        Insert: Partial<Omit<Event, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<Event, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      event_athletes: {
        Row: EventAthlete & Record<string, unknown>;
        Insert: Partial<Omit<EventAthlete, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<EventAthlete, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      event_attempts: {
        Row: EventAttempts & Record<string, unknown>;
        Insert: Partial<Omit<EventAttempts, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<EventAttempts, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      event_videos: {
        Row: EventVideo & Record<string, unknown>;
        Insert: Partial<Omit<EventVideo, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<EventVideo, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      exercise_combo_templates: {
        Row: ExerciseComboTemplate & Record<string, unknown>;
        Insert: Partial<Omit<ExerciseComboTemplate, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ExerciseComboTemplate, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      exercise_combo_template_parts: {
        Row: ExerciseComboTemplatePart & Record<string, unknown>;
        Insert: Partial<Omit<ExerciseComboTemplatePart, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ExerciseComboTemplatePart, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      planned_combos: {
        Row: PlannedCombo & Record<string, unknown>;
        Insert: Partial<Omit<PlannedCombo, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<PlannedCombo, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      planned_combo_items: {
        Row: PlannedComboItem & Record<string, unknown>;
        Insert: Partial<Omit<PlannedComboItem, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<PlannedComboItem, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_groups: {
        Row: TrainingGroup & Record<string, unknown>;
        Insert: Partial<Omit<TrainingGroup, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingGroup, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      group_members: {
        Row: GroupMember & Record<string, unknown>;
        Insert: Partial<Omit<GroupMember, 'id' | 'joined_at'>> & Record<string, unknown>;
        Update: Partial<Omit<GroupMember, 'id' | 'joined_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      coach_profiles: {
        Row: CoachProfile & Record<string, unknown>;
        Insert: Partial<Omit<CoachProfile, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<CoachProfile, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      macro_competitions: {
        Row: MacroCompetition & Record<string, unknown>;
        Insert: Partial<Omit<MacroCompetition, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<MacroCompetition, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      program_templates: {
        Row: ProgramTemplate & Record<string, unknown>;
        Insert: Partial<Omit<ProgramTemplate, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ProgramTemplate, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      program_template_days: {
        Row: ProgramTemplateDay & Record<string, unknown>;
        Insert: Partial<Omit<ProgramTemplateDay, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ProgramTemplateDay, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      program_template_exercises: {
        Row: ProgramTemplateExercise & Record<string, unknown>;
        Insert: Partial<Omit<ProgramTemplateExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ProgramTemplateExercise, 'id' | 'created_at' | 'updated_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      program_template_combo_members: {
        Row: ProgramTemplateComboMember & Record<string, unknown>;
        Insert: Partial<Omit<ProgramTemplateComboMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ProgramTemplateComboMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      error_logs: {
        Row: ErrorLogEntry & Record<string, unknown>;
        Insert: Partial<Omit<ErrorLogEntry, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ErrorLogEntry, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      athlete_collaborators: {
        Row: AthleteCollaborator & Record<string, unknown>;
        Insert: Partial<Omit<AthleteCollaborator, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<AthleteCollaborator, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      training_group_collaborators: {
        Row: TrainingGroupCollaborator & Record<string, unknown>;
        Insert: Partial<Omit<TrainingGroupCollaborator, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingGroupCollaborator, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      exercise_libraries: {
        Row: ExerciseLibrary & Record<string, unknown>;
        Insert: Partial<Omit<ExerciseLibrary, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ExerciseLibrary, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      exercise_library_members: {
        Row: ExerciseLibraryMember & Record<string, unknown>;
        Insert: Partial<Omit<ExerciseLibraryMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ExerciseLibraryMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      clubs: {
        Row: Club & Record<string, unknown>;
        Insert: Partial<Omit<Club, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<Club, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      club_members: {
        Row: ClubMember & Record<string, unknown>;
        Insert: Partial<Omit<ClubMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<ClubMember, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      kinemos_analyses: {
        Row: KinemosAnalysis & Record<string, unknown>;
        Insert: Partial<Omit<KinemosAnalysis, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosAnalysis, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Relationships: [];
      };
      kinemos_calibrations: {
        Row: KinemosCalibration & Record<string, unknown>;
        Insert: Partial<Omit<KinemosCalibration, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosCalibration, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Relationships: [];
      };
      kinemos_tracks: {
        Row: KinemosTrack & Record<string, unknown>;
        Insert: Partial<Omit<KinemosTrack, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosTrack, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Relationships: [];
      };
      kinemos_annotations: {
        Row: KinemosAnnotation & Record<string, unknown>;
        Insert: Partial<Omit<KinemosAnnotation, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosAnnotation, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Relationships: [];
      };
      kinemos_training_consent: {
        Row: KinemosTrainingConsent & Record<string, unknown>;
        Insert: Partial<Omit<KinemosTrainingConsent, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosTrainingConsent, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      kinemos_device_profiles: {
        Row: KinemosDeviceProfile & Record<string, unknown>;
        Insert: Partial<Omit<KinemosDeviceProfile, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosDeviceProfile, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      kinemos_shares: {
        Row: KinemosShare & Record<string, unknown>;
        Insert: Partial<Omit<KinemosShare, 'id' | 'created_at'>> & Record<string, unknown>;
        Update: Partial<Omit<KinemosShare, 'id' | 'created_at'>> & Record<string, unknown>;
        Relationships: [];
      };
      kinemos_videos: {
        Row: KinemosVideo & Record<string, unknown>;
        Insert: Partial<Omit<KinemosVideo, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Update: Partial<Omit<KinemosVideo, 'id' | 'created_at' | 'updated_at'>> &
          Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      shift_macro_weeks: {
        Args: { p_cycle_id: string; p_shift_days: number };
        Returns: undefined;
      };
      /** Renumber a week plan's exercises densely (1..n) per training unit.
       *  p_day_index null = every unit. Returns how many rows moved. */
      normalize_planned_exercise_positions: {
        Args: { p_weekplan_id: string; p_day_index: number | null };
        Returns: number;
      };
      /** Phase-3 adoption: fold a personal library into a club catalogue in
       *  one transaction, driven by a reviewed per-exercise mapping.
       *  p_dry_run=true returns the full report without writing. Domain
       *  types (AdoptMappingEntry / AdoptReport) live in useExerciseLibraries. */
      adopt_exercise_library: {
        Args: { p_from: string; p_to: string; p_mapping: unknown; p_dry_run: boolean };
        Returns: unknown;
      };
      /** Planned/logged occurrence counts per exercise since a date, for the
       *  catalogue's usage column. p_exercise_ids null = every exercise.
       *  Rows with no usage are omitted (callers default them to zero). */
      exercise_usage_counts: {
        Args: { p_since: string; p_exercise_ids: string[] | null };
        Returns: Array<{ exercise_id: string; planned_count: number; logged_count: number }>;
      };
      /** Last time each exercise was planned / logged, no window. Null in a
       *  column means never. Drives the prune flow's staleness column. */
      exercise_last_used: {
        Args: { p_exercise_ids: string[] | null };
        Returns: Array<{ exercise_id: string; last_planned: string | null; last_logged: string | null }>;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
