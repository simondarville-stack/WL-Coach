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
  viewToggles?: { consistency?: boolean; heatmap?: boolean };
  graph?: { avg?: boolean; repsBars?: boolean; linkDrag?: boolean };
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
  notes: string | null;
  link: string | null;
  is_archived: boolean;
  pr_reference_exercise_id: string | null;  // derives % from this exercise's PR
  track_pr: boolean;                         // false = excluded from PR table
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

export interface PlannedExerciseMetadata {
  /** GPP block content when the planned_exercise points at the GPP
   *  sentinel exercise. Absent for non-GPP rows. */
  gpp?: GppSection;
  /** Coach-authored caption for IMAGE / VIDEO sentinels. Rendered next
   *  to the media in athlete log and print. */
  description?: string;
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
  reps: number;
  reps_text: string | null;
  load_value: number;
  load_max: number | null;   // null = fixed load, number = interval upper bound
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
  phase_id: string | null;
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
   *  Set by the service when the coach views the session. See UF-10 / A5. */
  coach_read_at: string | null;
  /** Timestamp when the athlete last read this message. Null = unread by athlete.
   *  Set by the service when the athlete views the session. See UF-10 / A5. */
  athlete_read_at: string | null;
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
      training_log_messages: {
        Row: TrainingLogMessage & Record<string, unknown>;
        Insert: Partial<Omit<TrainingLogMessage, 'id' | 'created_at' | 'coach_read_at' | 'athlete_read_at'>> & Record<string, unknown>;
        Update: Partial<Omit<TrainingLogMessage, 'id' | 'created_at'>> & Record<string, unknown>;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
