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
export type DefaultUnit = 'percentage' | 'absolute_kg' | 'rpe' | 'free_text' | 'free_text_reps' | 'other';
export type WeekType = 'High' | 'Medium' | 'Low' | 'Vacation' | 'Deload' | 'Taper' | 'Competition' | 'Transition' | 'Testing';
export type PhaseType = 'preparatory' | 'strength' | 'competition' | 'transition' | 'custom';

export interface Athlete {
  id: string;
  owner_id: string;
  name: string;
  birthdate: string | null;
  bodyweight: number | null;
  weight_class: string | null;
  club: string | null;
  notes: string | null;
  photo_url: string | null;
  is_active: boolean;
  track_bodyweight: boolean;
  competition_total: number | null;  // manual override for K-value denominator
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
  created_at: string;
  updated_at: string;
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
  source: 'group' | 'individual' | null;  // origin of exercise in individual plan
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
  week_type: WeekType;
  week_type_text: string;
  notes: string;
  total_reps_target: number | null;
  phase_id: string | null;
  volume_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface MacroPhase {
  id: string;
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
  default_tracked_exercise_ids: string[];
  bodyweight_ma_days: number;
  visible_summary_metrics: string[];
  visible_card_metrics: string[];
  show_stress_metric: boolean;
  dialog_mode: 'center' | 'sidebar';
  created_at: string;
  updated_at: string;
}

export interface TrainingLogSession {
  id: string;
  athlete_id: string;
  date: string;
  week_start: string;
  day_index: number;
  session_notes: string;
  status: string;
  raw_sleep: number | null;
  raw_physical: number | null;
  raw_mood: number | null;
  raw_nutrition: number | null;
  raw_total: number | null;
  raw_guidance: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  session_rpe: number | null;
  bodyweight_kg: number | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingLogExercise {
  id: string;
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
}

export interface TrainingLogExerciseWithExercise extends TrainingLogExercise {
  exercise: Exercise;
}

export interface TrainingLogSet {
  id: string;
  log_exercise_id: string;
  set_number: number;
  planned_load: number | null;
  planned_reps: number | null;
  performed_load: number | null;
  performed_reps: number | null;
  rpe: number | null;
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingLogMessage {
  id: string;
  session_id: string;
  exercise_id: string | null;
  sender_type: 'athlete' | 'coach';
  message: string;
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

export interface Database {
  public: {
    Tables: {
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
        Insert: Omit<TrainingLogMessage, 'id' | 'created_at'>;
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
    };
  };
}
