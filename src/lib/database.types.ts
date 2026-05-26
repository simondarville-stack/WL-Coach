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
}

export interface TrainingGroup {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
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
  phase_type_presets: PhaseTypePreset[] | null;
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

export interface TrainingLogExerciseMetadata {
  /** Set numbers from the planned prescription the athlete chose to
   *  drop. The set wasn't skipped (no ✗ press) — it was actively
   *  removed from the day's plan. Rendered as a gap on coach Log. */
  removed_set_numbers?: number[];
  /** Athlete-side state of a GPP block: the rows the athlete checked
   *  off, plus any edits they made (e.g. they did 12 reps not 10).
   *  When absent, the athlete view falls back to planned rows. */
  gpp?: GppSection;
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

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: CategoryRow;
        Insert: Omit<CategoryRow, 'id' | 'created_at'>;
        Update: Partial<Omit<CategoryRow, 'id' | 'created_at'>>;
      };
      athletes: {
        Row: Athlete;
        Insert: Omit<Athlete, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Athlete, 'id' | 'created_at' | 'updated_at'>>;
      };
      bodyweight_entries: {
        Row: BodyweightEntry;
        Insert: Omit<BodyweightEntry, 'id' | 'created_at'>;
        Update: Partial<Omit<BodyweightEntry, 'id' | 'created_at'>>;
      };
      athlete_prs: {
        Row: AthletePR;
        Insert: Omit<AthletePR, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AthletePR, 'id' | 'created_at' | 'updated_at'>>;
      };
      athlete_pr_history: {
        Row: AthletePRHistory;
        Insert: Omit<AthletePRHistory, 'id' | 'created_at'>;
        Update: Partial<Omit<AthletePRHistory, 'id' | 'created_at'>>;
      };
      exercises: {
        Row: Exercise;
        Insert: Omit<Exercise, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Exercise, 'id' | 'created_at' | 'updated_at'>>;
      };
      week_plans: {
        Row: WeekPlan;
        Insert: Omit<WeekPlan, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<WeekPlan, 'id' | 'created_at' | 'updated_at'>>;
      };
      planned_exercises: {
        Row: PlannedExercise;
        Insert: Omit<PlannedExercise, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<PlannedExercise, 'id' | 'created_at' | 'updated_at'>>;
      };
      planned_set_lines: {
        Row: PlannedSetLine;
        Insert: Omit<PlannedSetLine, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<PlannedSetLine, 'id' | 'created_at' | 'updated_at'>>;
      };
      planned_exercise_combo_members: {
        Row: PlannedExerciseComboMember;
        Insert: Omit<PlannedExerciseComboMember, 'id' | 'created_at'>;
        Update: Partial<Omit<PlannedExerciseComboMember, 'id' | 'created_at'>>;
      };
      macrocycles: {
        Row: MacroCycle;
        Insert: Omit<MacroCycle, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MacroCycle, 'id' | 'created_at' | 'updated_at'>>;
      };
      macro_weeks: {
        Row: MacroWeek;
        Insert: Omit<MacroWeek, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MacroWeek, 'id' | 'created_at' | 'updated_at'>>;
      };
      macro_phases: {
        Row: MacroPhase;
        Insert: Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>>;
      };
      macro_tracked_exercises: {
        Row: MacroTrackedExercise;
        Insert: Omit<MacroTrackedExercise, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MacroTrackedExercise, 'id' | 'created_at' | 'updated_at'>>;
      };
      macro_targets: {
        Row: MacroTarget;
        Insert: Omit<MacroTarget, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MacroTarget, 'id' | 'created_at' | 'updated_at'>>;
      };
      general_settings: {
        Row: GeneralSettings;
        Insert: Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<GeneralSettings, 'id' | 'created_at' | 'updated_at'>>;
      };
      training_log_sessions: {
        Row: TrainingLogSession;
        Insert: Omit<TrainingLogSession, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<TrainingLogSession, 'id' | 'created_at' | 'updated_at'>>;
      };
      athlete_metric_definitions: {
        Row: AthleteMetricDefinition;
        Insert: Omit<AthleteMetricDefinition, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AthleteMetricDefinition, 'id' | 'created_at' | 'updated_at'>>;
      };
      athlete_week_metrics_config: {
        Row: AthleteWeekMetricsConfig;
        Insert: Omit<AthleteWeekMetricsConfig, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AthleteWeekMetricsConfig, 'id' | 'created_at' | 'updated_at'>>;
      };
      training_log_exercises: {
        Row: TrainingLogExercise;
        Insert: Omit<TrainingLogExercise, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<TrainingLogExercise, 'id' | 'created_at' | 'updated_at'>>;
      };
      training_log_sets: {
        Row: TrainingLogSet;
        Insert: Omit<TrainingLogSet, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<TrainingLogSet, 'id' | 'created_at' | 'updated_at'>>;
      };
      training_log_messages: {
        Row: TrainingLogMessage;
        Insert: Omit<TrainingLogMessage, 'id' | 'created_at' | 'coach_read_at' | 'athlete_read_at'>;
        Update: Partial<Omit<TrainingLogMessage, 'id' | 'created_at'>>;
      };
      events: {
        Row: Event;
        Insert: Omit<Event, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Event, 'id' | 'created_at' | 'updated_at'>>;
      };
      event_athletes: {
        Row: EventAthlete;
        Insert: Omit<EventAthlete, 'id' | 'created_at'>;
        Update: Partial<Omit<EventAthlete, 'id' | 'created_at'>>;
      };
      event_attempts: {
        Row: EventAttempts;
        Insert: Omit<EventAttempts, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<EventAttempts, 'id' | 'created_at' | 'updated_at'>>;
      };
      event_videos: {
        Row: EventVideo;
        Insert: Omit<EventVideo, 'id' | 'created_at'>;
        Update: Partial<Omit<EventVideo, 'id' | 'created_at'>>;
      };
      exercise_combo_templates: {
        Row: ExerciseComboTemplate;
        Insert: Omit<ExerciseComboTemplate, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ExerciseComboTemplate, 'id' | 'created_at' | 'updated_at'>>;
      };
      exercise_combo_template_parts: {
        Row: ExerciseComboTemplatePart;
        Insert: Omit<ExerciseComboTemplatePart, 'id' | 'created_at'>;
        Update: Partial<Omit<ExerciseComboTemplatePart, 'id' | 'created_at'>>;
      };
      planned_combos: {
        Row: PlannedCombo;
        Insert: Omit<PlannedCombo, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<PlannedCombo, 'id' | 'created_at' | 'updated_at'>>;
      };
      planned_combo_items: {
        Row: PlannedComboItem;
        Insert: Omit<PlannedComboItem, 'id' | 'created_at'>;
        Update: Partial<Omit<PlannedComboItem, 'id' | 'created_at'>>;
      };
      training_groups: {
        Row: TrainingGroup;
        Insert: Omit<TrainingGroup, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<TrainingGroup, 'id' | 'created_at' | 'updated_at'>>;
      };
      group_members: {
        Row: GroupMember;
        Insert: Omit<GroupMember, 'id' | 'joined_at'>;
        Update: Partial<Omit<GroupMember, 'id' | 'joined_at'>>;
      };
      coach_profiles: {
        Row: CoachProfile;
        Insert: Omit<CoachProfile, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<CoachProfile, 'id' | 'created_at' | 'updated_at'>>;
      };
      macro_competitions: {
        Row: MacroCompetition;
        Insert: Omit<MacroCompetition, 'id' | 'created_at'>;
        Update: Partial<Omit<MacroCompetition, 'id' | 'created_at'>>;
      };
      program_templates: {
        Row: ProgramTemplate;
        Insert: Omit<ProgramTemplate, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProgramTemplate, 'id' | 'created_at' | 'updated_at'>>;
      };
      program_template_days: {
        Row: ProgramTemplateDay;
        Insert: Omit<ProgramTemplateDay, 'id' | 'created_at'>;
        Update: Partial<Omit<ProgramTemplateDay, 'id' | 'created_at'>>;
      };
      program_template_exercises: {
        Row: ProgramTemplateExercise;
        Insert: Omit<ProgramTemplateExercise, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProgramTemplateExercise, 'id' | 'created_at' | 'updated_at'>>;
      };
      program_template_combo_members: {
        Row: ProgramTemplateComboMember;
        Insert: Omit<ProgramTemplateComboMember, 'id' | 'created_at'>;
        Update: Partial<Omit<ProgramTemplateComboMember, 'id' | 'created_at'>>;
      };
    };
  };
}
