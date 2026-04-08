# EMOS - Complete Product Documentation

## Product Overview

EMOS is an expert-oriented training planning and monitoring system for Olympic weightlifting coaches and athletes. Built with React, TypeScript, Tailwind CSS, and Supabase, it provides comprehensive tools for program design, athlete management, training logging, and performance tracking.

### Target Users
- Olympic weightlifting coaches
- Elite athletes and their support teams
- Users with high domain knowledge who prefer information density over spacious layouts

### Core Design Principles
- Information density and compact layouts
- Low interaction cost (inline editing, minimal modals)
- Planned data remains read-only for athletes; athlete input stored separately as logs
- dd/mm/yyyy date format throughout
- Professional, minimal styling (no cookie-cutter SaaS aesthetics)

---

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Icons**: lucide-react
- **Database**: Supabase (PostgreSQL)
- **Charting**: Recharts

---

## Main Navigation Structure

The app has 8 main pages accessible from the top navigation:

1. **Coach Dashboard** - Overview of all athletes and training groups
2. **Planning** (dropdown menu)
   - Weekly Planner - Week-by-week training prescription
   - Macro Cycles - Long-term periodization planning
   - Events - Competition management
   - Training Groups - Group programming
3. **Athlete View** (dropdown menu)
   - My Programme - Read-only view of athlete's plan
   - Training Log - Athlete performance logging
4. **Athletes** - Athlete roster and profiles
5. **Library** - Exercise database
6. **Settings** - General application settings

### Global Elements
- **Athlete Selector** (top-right) - Global dropdown to select active athlete for planning views

---

## Core Data Models

### 1. Athletes
Athletes are the central entity. Each athlete has:
- Basic info: name, birthdate, bodyweight, weight class, club, notes
- Photo URL
- Active/inactive status
- Related data: PRs, week plans, macro cycles, training logs, event participation

**Key relationships**:
- `athlete_prs` - Personal records for exercises
- `week_plans` - Weekly training plans
- `macrocycles` - Long-term training cycles
- `training_log_sessions` - Training diary entries
- `event_athletes` - Event participation

### 2. Exercises
The exercise library contains all movements used in planning:
- Name and optional exercise code (e.g., "Sq" for Squat)
- Category (stored as plain strings in `categories` table)
- Competition lift flag
- Default unit: `percentage`, `absolute_kg`, `rpe`, `free_text`, `other`
- Color (hex value for visual identification)
- `counts_towards_totals` - Whether reps count in volume tracking
- `use_stacked_notation` - Display format toggle for read-only views
- Notes

**Exercise Categories**: Managed separately in `categories` table (e.g., "Snatch", "Clean & Jerk", "Squats", "Pulls", "Accessories")

### 3. Week Plans
Weekly training plans are the core programming unit:
- Week start date (Monday of the training week)
- Optional name
- Either athlete-specific OR group-specific:
  - `athlete_id` for individual plans
  - `is_group_plan` + `group_id` for group plans
- `active_days`: array of day indices (0=Monday, 6=Sunday)
- `day_labels`: custom labels for days (e.g., "Session A", "Session B")
- `day_display_order`: custom ordering of days in UI
- `week_description`: optional notes

**Important**: One athlete can have only one week plan per week start date.

#### Planned Exercises
Each week plan contains exercises organized by day:
- `day_index` (0-6)
- `position` (ordering within day)
- Reference to exercise
- Unit override (can differ from exercise default)
- `prescription_raw` - Text input (e.g., "100x5x3", "70%x3x5")
- Summary metrics (auto-calculated from prescription):
  - `summary_total_sets`
  - `summary_total_reps`
  - `summary_highest_load`
  - `summary_avg_load`

**Prescription notation**:
- Input: "load x reps" (implies 1 set) or "load x reps x sets"
- Comma-separated segments allowed: "100x5x3, 120x3x2"
- Display: If sets=1, don't show "×1"

#### Planned Set Lines
Detailed breakdown of prescription (alternative to raw text):
- Each set line: sets, reps, load_value, position
- Used for more granular control

#### Planned Combos
Complex exercises performed sequentially (e.g., "Snatch + Back Squat"):
- Contains multiple exercises via `planned_combo_items`
- Each combo has `set_lines` with:
  - `load_value` (shared weight)
  - `sets` (number of times combo is performed)
  - `reps_tuple_text` (e.g., "1+3" = 1 snatch + 3 back squats)
- Can be based on reusable `exercise_combo_templates`
- `combo_name` for custom naming
- Unit and color for display
- Creates linked `planned_exercise` entries for each component exercise

**Combo Structure**:
```
PlannedCombo
├── PlannedComboItems (link to exercises)
├── PlannedComboSetLines (load, sets, reps per exercise)
└── PlannedExercises (created for each component)
```

### 4. Training Groups
Groups enable programming for multiple athletes simultaneously:
- Name and description
- Members via `group_members` table (with join/left dates)
- Week plans with `is_group_plan=true`

### 5. Macro Cycles
Long-term periodization planning (e.g., 12-week training block):
- Athlete-specific
- Start and end dates
- `is_active` flag (only one active per athlete)

#### Macro Weeks
Individual weeks within a macro cycle:
- Week start date and week number
- Week type: High, Medium, Low, Vacation, Deload, Taper, Competition
- `week_type_text` for custom descriptions
- `total_reps_target` (optional volume target)
- Notes

#### Macro Tracked Exercises
Selected exercises to monitor across the cycle:
- Links exercise to macro cycle
- Position (display order)

#### Macro Targets
Per-week targets for each tracked exercise:
- `target_reps` - Total rep count
- `target_ave` - Average load (kg)
- `target_hi` - Highest load (kg)
- `target_rhi` - Reps at highest load (single set)
- `target_shi` - Number of sets at highest load
- Links to `macro_weeks` and `macro_tracked_exercises`

**Macro Validation**: Component compares planned prescriptions against targets, showing actual vs target with color coding (green=on target, yellow=close, red=off).

### 6. Training Log
Athlete-facing training diary:

#### Training Log Sessions
- Date and athlete
- Week start and day index (links to planned week)
- Session notes
- Status
- RAW (Readiness Assessment for Weightlifting) scores:
  - `raw_sleep`, `raw_physical`, `raw_mood`, `raw_nutrition` (1-10 scales)
  - `raw_total` (calculated sum)
  - `raw_guidance` (text feedback based on score)

#### Training Log Exercises
- Links to session
- Exercise reference
- Optional link to `planned_exercise_id` (what was prescribed)
- `performed_raw` - What athlete actually did (text format)
- `performed_notes`
- Position (ordering)

**Key principle**: Log data NEVER overwrites planned data. They remain separate.

### 7. Events
Competition management:
- Event name, date, description
- Athletes registered via `event_athletes`

#### Event Attempts
Competition attempt tracking per athlete:
- Planned attempts: `planned_snatch_1/2/3`, `planned_cj_1/2/3`
- Actual results: `actual_snatch_1/2/3`, `actual_cj_1/2/3`
- Competition notes

#### Event Videos
Video links for competition lifts:
- Athlete and event
- Lift type: `snatch` or `clean_jerk`
- Attempt number (1-3)
- Video URL and description

### 8. Athlete PRs
Personal records tracking:
- Exercise and athlete
- PR value (kg) and date
- Notes

### 9. General Settings
Application-wide settings:
- `raw_enabled` - Toggle RAW scoring system
- `raw_average_days` - Rolling window for RAW averages

---

## Key Features & Components

### Weekly Planner
The main programming interface (WeeklyPlanner.tsx):

**Features**:
- Plan selector (date navigation with week number)
- Active days configuration
- Custom day labels and display order
- Week description
- Drag-and-drop exercise ordering (within days)
- Add exercises, combos, or free text entries
- Inline prescription editing with instant summary calculations
- Print view
- Copy week functionality
- Load distribution panel (volume visualization)
- Macro validation panel (if macro cycle active)

**Prescription Editing**:
- Modal or inline text input
- Parser extracts sets/reps/load from text like "100x5x3"
- Auto-calculates summary metrics
- Supports stacked notation display (load over reps with divider)

**Combo Creation**:
- Modal to select exercises and set reps/load
- Creates linked planned exercises
- Displays as single card with summary

### Macro Cycles
Long-term planning interface (MacroCycles.tsx):

**Features**:
- Create/edit cycles with date ranges
- Define tracked exercises
- Calendar view of weeks with type indicators
- Per-week target entry for each exercise (5 metrics)
- Total reps tracking across cycle
- Graphs showing volume trends

**MacroGraph.tsx**: Line chart showing total reps over time (using Recharts)
**TotalRepsGraph.tsx**: Week-by-week volume visualization
**MacroValidation.tsx**: Real-time comparison of planned vs targets in Weekly Planner

### Athlete Programme
Read-only view of athlete's plan (AthleteProgramme.tsx):
- Shows prescribed exercises only
- Cannot edit (coach-only data)
- Displays using stacked notation if enabled
- Week navigation
- PRs display panel (AthletePRs.tsx)

### Training Log
Athlete input interface (AthleteLog.tsx):
- Session-based structure
- RAW scoring input (if enabled)
- Add performed exercises (linked to plan or standalone)
- Text-based performance entry
- Notes per exercise and session
- RAW guidance ("Reduce volume", "Train as planned", etc.)

### Coach Dashboard
Overview page (CoachDashboard.tsx):
- Quick access to all athletes
- Recently active plans
- Training group overview
- Upcoming events

### Exercise Library
Exercise management (ExerciseList.tsx, ExerciseForm.tsx):
- CRUD operations
- Category filtering
- Color-coded display
- Competition lift indicators
- Exercise code for shorthand

### Events Management
Competition tracking (Events.tsx, EventOverviewModal.tsx, EventAttemptsModal.tsx):
- Event creation with date
- Athlete registration
- Attempt planning and result entry
- Video attachment per attempt
- Competition summary view

### Training Groups
Group programming (TrainingGroups.tsx):
- Create groups
- Manage membership
- Link week plans to groups
- All group members inherit the plan

### Settings
- Exercise categories management (Settings.tsx)
- General settings (GeneralSettings.tsx)
  - RAW system toggle
  - RAW averaging period

### Athlete Management
Athlete CRUD (Athletes.tsx):
- Profile creation
- Photo upload
- Active/inactive status
- Bodyweight, weight class, club
- Notes

### Athlete PRs
PR tracking (AthletePRs.tsx):
- Exercise-specific records
- Date and value (kg)
- Notes
- Display in athlete programme view

---

## Data Flow & Key Interactions

### Planning Flow (Coach)
1. Select athlete in global selector
2. Navigate to Weekly Planner
3. Select or create week plan
4. Configure active days and labels
5. Add exercises or combos to days
6. Enter prescriptions (text or modal)
7. Prescriptions auto-calculate summaries
8. Macro validation shows if targets are met (if cycle active)
9. Copy week to future dates if needed
10. Print for athlete handout

### Macro Planning Flow (Coach)
1. Select athlete
2. Navigate to Macro Cycles
3. Create new cycle with dates
4. Add tracked exercises
5. Define week types across cycle
6. Set per-week targets for each exercise
7. Navigate to Weekly Planner
8. Validation panel shows progress against targets

### Logging Flow (Athlete)
1. Select self in athlete selector
2. Navigate to Training Log
3. Select or create session for date
4. Enter RAW scores (if enabled)
5. Add exercises performed
6. Enter performance (text format)
7. Add notes
8. System stores separately from plan

### Group Programming Flow (Coach)
1. Navigate to Training Groups
2. Create group and add members
3. Navigate to Weekly Planner
4. Create week plan for group (not individual athlete)
5. All group members automatically assigned plan

### Event Management Flow (Coach)
1. Navigate to Events
2. Create event with date
3. Register athletes
4. Enter planned attempts per athlete
5. During/after competition: enter actual results
6. Add video links to attempts

---

## Database Relationships

```
athletes
├── athlete_prs (exercise_id → exercises)
├── week_plans
│   ├── planned_exercises (exercise_id → exercises)
│   │   └── planned_set_lines
│   └── planned_combos
│       ├── planned_combo_items (exercise_id → exercises)
│       │   └── creates planned_exercises
│       └── planned_combo_set_lines
├── macrocycles
│   ├── macro_weeks
│   │   └── macro_targets (tracked_exercise_id → macro_tracked_exercises)
│   └── macro_tracked_exercises (exercise_id → exercises)
├── training_log_sessions
│   └── training_log_exercises (exercise_id → exercises)
└── event_athletes (event_id → events)
    ├── event_attempts
    └── event_videos

training_groups
└── group_members (athlete_id → athletes)

week_plans (group)
├── is_group_plan = true
└── group_id → training_groups

exercise_combo_templates
└── exercise_combo_template_parts (exercise_id → exercises)

categories (independent table)

general_settings (singleton)
```

---

## Prescription Parser Logic

Location: `src/lib/prescriptionParser.ts`

Handles text input like:
- "100x5" → 100kg, 5 reps, 1 set
- "100x5x3" → 100kg, 5 reps, 3 sets
- "70%x3x5" → 70% of max, 3 reps, 5 sets
- "100x5, 110x3, 120x1" → Multiple segments

**Parsing rules**:
1. Split by comma for segments
2. Match pattern: `(load) x (reps) [x (sets)]`
3. If sets omitted, assume 1
4. Calculate totals and averages
5. Store in summary fields

**Display rules**:
- If sets=1, don't show "×1"
- Compact format in tables
- Stacked notation for read-only views (if enabled)

---

## Styling & UI Patterns

### Design System
- **Colors**:
  - Primary: Blue (#3B82F6)
  - Exercise ribbons: Custom per exercise
  - Status indicators: Green (on target), Yellow (close), Red (off)
- **Spacing**: Tailwind's default scale (compact)
- **Typography**: System font stack, bold for emphasis
- **Icons**: Lucide-react (16-20px typical)

### Common Patterns
- **Modals**: Centered overlay with max-width, scrollable
- **Tables**: Compact with hover states, color-coded cells
- **Cards**: Border-left color ribbon for exercises/combos
- **Inline editing**: Click to edit, auto-save on blur
- **Dropdowns**: Custom select components with search
- **Drag handles**: Grip icon with cursor-move

### Responsive Behavior
- Desktop-first (coach application)
- Mobile views secondary priority
- Tables scroll horizontally on small screens

---

## Important Business Rules

1. **Planned data immutability for athletes**: Athletes see plans read-only; logs are separate
2. **One week plan per athlete per week**: Unique constraint on (athlete_id, week_start)
3. **Date format**: Always dd/mm/yyyy
4. **Sets display**: If sets=1, omit from display
5. **Combo reps**: Use `+` separator (e.g., "1+3" not "1,3")
6. **Macro validation**: Only for absolute_kg exercises
7. **RAW scoring**: Optional system, toggle in settings
8. **Active macro cycles**: Only one per athlete at a time
9. **Group plans**: Mutually exclusive with athlete_id
10. **Counts towards totals**: Only exercises with this flag contribute to volume metrics

---

## File Structure

```
src/
├── components/
│   ├── App.tsx (main layout, navigation)
│   ├── Athletes.tsx (athlete roster)
│   ├── AthleteSelector.tsx (global dropdown)
│   ├── AthleteProgramme.tsx (read-only athlete view)
│   ├── AthleteLog.tsx (training diary)
│   ├── AthletePRs.tsx (PR display)
│   ├── CoachDashboard.tsx (overview)
│   ├── WeeklyPlanner.tsx (main planning interface)
│   ├── DayColumn.tsx (day container in planner)
│   ├── PlanSelector.tsx (week navigation)
│   ├── ExerciseForm.tsx (exercise CRUD form)
│   ├── ExerciseFormModal.tsx (modal wrapper)
│   ├── ExerciseList.tsx (library display)
│   ├── PrescriptionModal.tsx (prescription editor)
│   ├── PrescriptionDisplay.tsx (read-only prescription)
│   ├── SetLineEditor.tsx (detailed set editor)
│   ├── ComboCard.tsx (combo display in planner)
│   ├── ComboCreatorModal.tsx (combo builder)
│   ├── ComboEditorModal.tsx (combo editor)
│   ├── CopyWeekModal.tsx (week copy utility)
│   ├── PrintWeek.tsx (printable view)
│   ├── LoadDistributionPanel.tsx (volume chart)
│   ├── MacroCycles.tsx (macro cycle management)
│   ├── MacroGraph.tsx (cycle-wide chart)
│   ├── TotalRepsGraph.tsx (weekly volume chart)
│   ├── MacroValidation.tsx (target comparison)
│   ├── Events.tsx (event management)
│   ├── EventOverviewModal.tsx (event details)
│   ├── EventAttemptsModal.tsx (attempt editor)
│   ├── TrainingGroups.tsx (group management)
│   ├── Settings.tsx (category management)
│   ├── GeneralSettings.tsx (app settings)
│   └── RAWScoring.tsx (readiness assessment)
├── lib/
│   ├── supabase.ts (database client)
│   ├── database.types.ts (TypeScript types)
│   ├── prescriptionParser.ts (parsing logic)
│   ├── dateUtils.ts (date helpers)
│   └── constants.ts (shared constants)
└── (Vite/React config files)
```

---

## Database Schema Summary

See `supabase/migrations/` for full SQL definitions. Key tables:

- `athletes` - Athlete profiles
- `athlete_prs` - Personal records
- `exercises` - Exercise library
- `categories` - Exercise categories
- `week_plans` - Weekly training plans
- `planned_exercises` - Exercises in plans
- `planned_set_lines` - Detailed set data
- `planned_combos` - Complex exercise combinations
- `planned_combo_items` - Exercises in combos
- `planned_combo_set_lines` - Set data for combos
- `exercise_combo_templates` - Reusable combo definitions
- `exercise_combo_template_parts` - Exercises in templates
- `training_groups` - Athlete groups
- `group_members` - Group membership
- `macrocycles` - Long-term training cycles
- `macro_weeks` - Weeks within cycles
- `macro_tracked_exercises` - Monitored exercises
- `macro_targets` - Per-week targets
- `training_log_sessions` - Training diary entries
- `training_log_exercises` - Performed exercises
- `events` - Competitions
- `event_athletes` - Event registration
- `event_attempts` - Competition attempts
- `event_videos` - Video links
- `general_settings` - App configuration

**RLS (Row Level Security)**: Most tables allow anonymous access (single-user coach app). Adjust for production multi-tenancy.

---

## Extension Points

Common areas for future development:

1. **Multi-tenancy**: Add user auth and RLS policies per coach
2. **Exercise templates**: Save common workout structures
3. **Auto-progression**: Suggest next week based on progression rules
4. **Mobile app**: Native athlete view with offline support
5. **Analytics**: Advanced volume/intensity tracking
6. **Video analysis**: Integrated form review
7. **Team communication**: Comments/feedback on plans
8. **Export/import**: Share programs between coaches
9. **RPE/RIR tracking**: Beyond just load prescription
10. **Injury tracking**: Link to training adjustments

---

## Development Notes

### Running the App
```bash
npm install
npm run dev
```

### Building
```bash
npm run build
```

### Database Setup
Supabase CLI or Dashboard:
1. Create project
2. Run migrations in order from `supabase/migrations/`
3. Set env vars in `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Type Safety
TypeScript types in `database.types.ts` match Supabase schema. Regenerate with Supabase CLI:
```bash
supabase gen types typescript --project-id <project> > src/lib/database.types.ts
```

### Code Conventions
- Functional components with hooks
- Tailwind for all styling
- Lucide icons
- Supabase client in `lib/supabase.ts`
- Date handling in `lib/dateUtils.ts`
- No auth layer currently (single-coach assumption)

---

## Common Use Cases & Workflows

### UC1: Create Training Plan for New Athlete
1. Add athlete in Athletes page
2. Select athlete in global selector
3. Navigate to Weekly Planner
4. Create week plan for current/future week
5. Configure active days (e.g., Mon/Wed/Fri/Sat)
6. Add exercises from library to each day
7. Enter prescriptions (e.g., "Back Squat: 100x5x5")
8. Repeat for subsequent weeks or use Copy Week

### UC2: Program a 12-Week Training Cycle
1. Select athlete
2. Navigate to Macro Cycles
3. Create cycle with 12-week span
4. Add tracked exercises (Snatch, C&J, Squat, etc.)
5. Define week types (2x High, 1x Medium, 1x Low)
6. Set targets for each week/exercise
7. Return to Weekly Planner
8. Create weekly plans
9. Validate against targets in real-time

### UC3: Athlete Logs Training Session
1. Athlete navigates to Training Log
2. Creates session for today
3. Enters RAW scores (sleep, mood, etc.)
4. Adds exercises performed
5. Enters actual loads/reps (may differ from plan)
6. Adds session notes
7. Coach reviews later in Coach Dashboard

### UC4: Plan Competition Peaking
1. Navigate to Events
2. Create event for competition date
3. Register athlete
4. Enter planned openers/attempts
5. Navigate to Macro Cycles
6. Create cycle ending at competition
7. Set final weeks as Taper/Competition type
8. Build weekly plans with reducing volume
9. On comp day, log actual attempts in Event Attempts

### UC5: Group Programming
1. Navigate to Training Groups
2. Create "Intermediate Group"
3. Add 5 athletes as members
4. Navigate to Weekly Planner
5. Select "Plan for Training Group" instead of athlete
6. Select "Intermediate Group"
7. Build week plan
8. All 5 athletes automatically assigned plan
9. Each athlete logs individually

### UC6: Track and Update PRs
1. Select athlete
2. Navigate to Athlete Programme or Athletes page
3. View PRs panel
4. Add new PR (e.g., "Back Squat: 180kg on 15/03/2026")
5. PRs display in athlete programme view
6. Used for % calculations in prescriptions

---

## Glossary

- **Macro Cycle**: Long-term training block (typically 4-16 weeks)
- **Week Plan**: Single week of training (Monday-Sunday)
- **Day Index**: 0=Monday, 1=Tuesday, ..., 6=Sunday
- **Prescription**: Text-based training instruction (e.g., "100x5x3")
- **Combo**: Multi-exercise complex (e.g., Snatch + Overhead Squat)
- **Set Line**: Individual row of sets/reps/load
- **Reps Tuple**: Comma or plus-separated reps per exercise in combo (e.g., "1+3")
- **RAW**: Readiness Assessment for Weightlifting (sleep/physical/mood/nutrition scores)
- **Rhi**: Reps at highest load (single set)
- **Shi**: Sets at highest load
- **Ave**: Average load across all sets
- **Hi**: Highest load used
- **Stacked Notation**: Display format with load above reps (divided by line)
- **Active Days**: Days of the week with training (not all 7 typically used)
- **Group Plan**: Week plan assigned to training group (not individual)
- **Competition Lift**: Snatch or Clean & Jerk (vs accessories)
- **Counts Towards Totals**: Flag to include exercise in volume metrics
- **Event**: Competition or testing day
- **Attempts**: 3 tries each for Snatch and Clean & Jerk in competition

---

## Quick Reference: Key Metrics

### Weekly Volume Metrics (per exercise)
- **Total Reps**: Sum of all reps across all sets
- **Total Sets**: Sum of all sets
- **Highest Load**: Maximum weight used
- **Average Load**: Weighted average across all reps

### Macro Targets (per week, per exercise)
- **Reps**: Total rep count target
- **Ave**: Average load target (kg)
- **Hi**: Highest load target (kg)
- **Rhi**: Reps at highest load target (single set)
- **Shi**: Sets at highest load target

### RAW Scoring
- **Sleep**: 1-10 (quality and duration)
- **Physical**: 1-10 (soreness, recovery)
- **Mood**: 1-10 (mental readiness)
- **Nutrition**: 1-10 (diet quality)
- **Total**: Sum of 4 scores (4-40 range)
- **Guidance**: Text advice based on total (<25="Reduce volume", 25-30="Monitor", >30="Train as planned")

---

## Contact & Support

This is a custom-built application for Olympic weightlifting coaching. For questions about functionality or extending the system, refer to this documentation or examine the source code in the repository.

For database schema questions, see migration files in `supabase/migrations/`.

For component structure, see `src/components/` directory.

For data models and types, see `src/lib/database.types.ts`.

---

## Version History

- **v2.0**: Current version
  - Complete rewrite with React + Supabase
  - Added macro cycle planning
  - Added training groups
  - Added event management
  - Added RAW scoring system
  - Added combo exercises
  - Improved UI/UX for compact display

---

## Summary

EMOS is a comprehensive training management system centered around weekly planning with support for long-term periodization, athlete logging, and competition tracking. The architecture separates coach-authored plans from athlete-performed logs, maintaining data integrity while allowing flexible retrospective analysis. The UI prioritizes information density and fast navigation for expert users, with inline editing and minimal modal interference.

Key workflows revolve around:
1. Building weekly plans with prescriptions
2. Creating macro cycles with tracked exercises and targets
3. Athletes logging actual performance separately
4. Monitoring progress against targets and PRs
5. Planning and tracking competitions

The system is built on React/TypeScript/Supabase and follows modern component architecture with type safety throughout.
