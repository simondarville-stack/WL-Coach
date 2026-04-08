# EMOS 2.0 — ANALYSIS MODULE BUILD

Build a full analysis module for Olympic weightlifting coaches. The module
has a pivot-style chart builder, pre-built OWL analyses, lift ratio tracking,
and intensity zone breakdowns. All data comes from existing Supabase tables.

Start with `npm run dev`. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation at any point.
Complete all groups sequentially and stop when done.

---

## DATA SOURCES (existing — do NOT modify these tables)

- `planned_exercises` → prescription_raw, unit, summary_total_sets/reps/highest_load/avg_load, day_index, is_combo
- `planned_set_lines` → load_value, reps, sets, reps_text
- `exercises` → name, category, color, exercise_code, default_unit
- `week_plans` → week_start, athlete_id, active_days, day_labels
- `macrocycles` → name, start_date, end_date, athlete_id
- `macro_weeks` → week_number, week_type, week_type_text, total_reps_target, week_start
- `macro_phases` → name, color, start_week_number, end_week_number
- `athlete_prs` → exercise_id, load, reps, date
- `training_log_sessions` → date, status, raw_sleep/physical/mood/nutrition/total, session_notes
- `training_log_exercises` → performed_raw, performed_notes, planned_exercise_id
- `bodyweight_entries` → weight_kg, measured_at, athlete_id
- `athletes` → name, weight_class, birthdate

---

## GROUP 1: DATA HOOK

Create: src/hooks/useAnalysis.ts

This hook fetches and aggregates data for any athlete over any date range.
All data transformation happens client-side after fetching.

```typescript
interface AnalysisParams {
  athleteId: string;
  startDate: string;   // ISO date
  endDate: string;     // ISO date
  exerciseFilter?: string[];  // exercise IDs to include (empty = all)
  categoryFilter?: string[];  // category names to include (empty = all)
}

interface WeeklyAggregate {
  weekStart: string;
  weekNumber: number;         // macro week number if available
  weekType: string | null;    // High/Medium/Low/Deload/Comp
  phaseName: string | null;
  phaseColor: string | null;
  totalRepsTarget: number | null;
  // Planned
  plannedSets: number;
  plannedReps: number;
  plannedTonnage: number;
  plannedExerciseCount: number;
  // Performed (from training_log)
  performedSets: number;
  performedReps: number;
  performedTonnage: number;
  performedExerciseCount: number;
  skippedExercises: number;
  // Derived
  complianceReps: number;     // performed/planned as %
  complianceTonnage: number;
  // Per-exercise breakdowns
  exerciseBreakdowns: ExerciseBreakdown[];
  // Readiness
  rawTotal: number | null;
  sessionRpe: number | null;
  // Bodyweight
  avgBodyweight: number | null;
}

interface ExerciseBreakdown {
  exerciseId: string;
  exerciseName: string;
  category: string;
  color: string;
  plannedSets: number;
  plannedReps: number;
  plannedMaxLoad: number;
  plannedAvgLoad: number;
  performedSets: number;
  performedReps: number;
  performedMaxLoad: number;
  performedAvgLoad: number;
}

interface IntensityZone {
  zone: string;        // '<70%', '70-80%', '80-90%', '90%+'
  reps: number;
  percentage: number;
}

// Functions to export:
fetchWeeklyAggregates(params: AnalysisParams): Promise<WeeklyAggregate[]>
fetchExerciseTimeSeries(athleteId, exerciseId, startDate, endDate): Promise<{date, maxLoad, avgLoad, totalReps, totalSets}[]>
fetchIntensityZones(athleteId, exerciseId, startDate, endDate, oneRepMax): Promise<IntensityZone[]>
fetchLiftRatios(athleteId): Promise<{name, value, target, color}[]>
fetchBodyweightSeries(athleteId, startDate, endDate): Promise<{date, weight}[]>
fetchPRTimeline(athleteId, startDate, endDate): Promise<{date, exerciseName, load, reps, isCompetition}[]>
```

Implementation notes:
- Fetch all data for the date range in parallel (Promise.all)
- Parse prescription_raw using the existing parsePrescription/parseComboPrescription from src/lib/prescriptionParser.ts
- For intensity zones: require the athlete's 1RM (from athlete_prs) and calculate each set's load as % of 1RM
- For lift ratios: compare latest PR for each pair (Snatch/CJ, Snatch/BSq, etc.)
- Cache results in state to avoid re-fetching on chart type changes

---

## GROUP 2: ANALYSIS PAGE SHELL

Create: src/components/analysis/AnalysisPage.tsx

Top-level layout:
- Athlete selector (use the existing AthleteSelector from the top bar)
- Period selector: pills for 4w, 8w, 12w, Current macro, YTD, Custom range
- When "Custom range" selected, show two date pickers
- Tab navigation: Pivot builder | Quick analyses | Lift ratios | Intensity zones
- Content area below tabs (renders the active tab component)

Routing:
- File: src/App.tsx — add route `/analysis`
- File: src/components/Sidebar.tsx — add entry between "Macro cycles" and "Calendar":
  `{ path: '/analysis', label: 'Analysis', icon: BarChart3 }`

---

## GROUP 3: PIVOT BUILDER

Create: src/components/analysis/PivotBuilder.tsx

Three dropdown slots in a row:
1. **X axis**: Week (default), Day, Session, Macro week number
2. **Primary metric** (rendered as bars or scatter points):
   - Total tonnage (kg)
   - Total reps
   - Total sets
   - Exercise avg load
   - Exercise max load
   - Exercise total reps
   - Compliance %
   - Session RPE
   - RAW readiness total
3. **Overlay** (rendered as a line on secondary Y axis):
   - None (default)
   - Bodyweight
   - Total tonnage
   - Total reps
   - Compliance %
   - RAW readiness
   - Session RPE

Below the dropdowns:
- Exercise filter pills: All (default), Snatch, Clean & jerk, Back squat,
  Front squat, Pulls, or pick from full exercise list
- Category filter pills: All, Classical, Squats, Pulls, Accessories

When selections change, re-render the chart using Chart.js:
- Primary metric → bar chart (or scatter if X axis = session)
- Overlay → line chart on secondary Y axis
- Bar colors tinted by macro phase if macro data exists
- Tooltip shows all values on hover

Above the chart, show 4 summary metric cards:
- Metric 1: primary metric average for the period
- Metric 2: primary metric total for the period
- Metric 3: delta vs previous equal-length period (e.g., "this 8w vs prev 8w")
- Metric 4: overlay metric average (if overlay selected)

Each metric card: bg-gray-50 rounded-lg py-2 px-4, label text-[10px]
uppercase, value text-xl font-medium, delta colored green/red.

Use Recharts (already in the project) instead of Chart.js for consistency
with the rest of the app. Import from 'recharts':
- BarChart, Bar, LineChart, Line, ComposedChart, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend

---

## GROUP 4: QUICK ANALYSES (PRESETS)

Create: src/components/analysis/QuickAnalyses.tsx

Grid of clickable preset cards. Each card configures the pivot builder
with specific settings and renders that chart. Cards:

1. **Competition lift trends**
   - X: Week, Primary: Exercise max load, Filter: Snatch + C&J
   - Two series (one per lift), line chart
   - Shows macro phase bands as colored background regions

2. **Volume distribution**
   - Stacked bar chart: tonnage per week split by category
   - Categories: Classical lifts, Squats, Pulls, Accessories
   - Each category a different color

3. **Planned vs performed**
   - X: Week, Two grouped bars (planned reps ghost, performed reps solid)
   - Compliance % as overlay line on secondary axis
   - Color bars by compliance: green ≥95%, blue ≥85%, amber ≥75%, red <75%
   - Summary table below: week, phase, planned, performed, compliance %, tonnage gap, skipped

4. **Readiness vs performance**
   - Scatter plot: X = RAW readiness total, Y = session max load or compliance
   - Color points by session RPE
   - Trendline showing correlation

5. **Squat-to-lift transfer**
   - Two Y axes: squat max load (left), competition lift max load (right)
   - Show if squat gains transfer to competition lifts
   - Calculate and display current ratios

6. **PR timeline**
   - Horizontal timeline with PR markers
   - Each PR: exercise name, load, date
   - Colored by exercise category
   - Macro phase bands as background

7. **Training patterns**
   - Heatmap or grouped bars: sessions by day of week
   - Volume by day of week
   - Identify which days are most productive

8. **Bodyweight trend**
   - Line chart: bodyweight over time
   - Moving average (7-day)
   - Overlay competition lift maxes as scatter points
   - Show weight class boundaries as horizontal lines

Each card: bg-white border border-gray-200 rounded-lg p-3, hover effect,
small icon, title (13px font-medium), description (11px text-gray-500).
Clicking a card renders the full chart below the grid (or replaces the grid).
Include a "← Back to presets" button to return.

---

## GROUP 5: LIFT RATIOS

Create: src/components/analysis/LiftRatios.tsx

OWL-specific lift ratio analysis. Show current ratios as horizontal
bars against target ranges:

| Ratio | Target | Formula |
|---|---|---|
| Snatch / C&J | 80-85% | Best Sn 1RM / Best CJ 1RM |
| Snatch / Back squat | 65-70% | Best Sn 1RM / Best BSq 1RM |
| C&J / Back squat | 78-83% | Best CJ 1RM / Best BSq 1RM |
| Front squat / Back squat | 83-87% | Best FSq 1RM / Best BSq 1RM |
| Snatch pull / Snatch | 105-110% | Best SnPull 1RM / Best Sn 1RM |
| Clean pull / C&J | 110-115% | Best ClPull 1RM / Best CJ 1RM |

Each ratio rendered as:
- Label (100px) | horizontal bar fill | current value | target range text
- Bar color: green if in target, amber if within 3%, red if further

Below the bars, a trend chart (Recharts line) showing how the primary
ratio (Sn/CJ) has moved over the last 12 weeks.

Auto-generated insight text:
- If Sn/BSq < 65%: "Snatch efficiency is below target — consider more overhead strength and receiving position work"
- If FSq/BSq > 87%: "Front squat close to back squat — posterior chain may be underdeveloped"
- If Sn/CJ > 85%: "Snatch-to-CJ ratio is high — potential for more CJ gains"
- etc.

Data source: athlete_prs table. Match exercises by name pattern:
- Snatch: exercise name contains "snatch" and NOT "pull" and NOT "press"
- C&J: exercise name contains "clean" AND "jerk"
- Back squat: exercise name contains "back squat"
- Front squat: exercise name contains "front squat"
- Snatch pull: exercise name contains "snatch pull"
- Clean pull: exercise name contains "clean pull"

Use the highest load with reps=1 (or the highest load regardless if
no 1RM exists, and note it's estimated).

---

## GROUP 6: INTENSITY ZONES

Create: src/components/analysis/IntensityZones.tsx

Show distribution of training reps across intensity bands relative
to the athlete's 1RM.

Zones:
- < 70% 1RM (warm-up / technique)
- 70-80% (volume zone)
- 80-90% (strength zone)
- 90%+ (peak / max effort)

Visualization:
- 4 metric cards at top showing % of reps in each zone
- Stacked bar chart (Recharts): weeks on X, reps per zone stacked
- Zone colors: lightest blue → darkest blue (4 shades)
- Exercise filter: show for specific lift or all competition lifts

Below the chart, an insight comparing the athlete's zone distribution
to typical OWL periodization targets:
- Volume phase: ~35% <70%, ~30% 70-80%, ~25% 80-90%, ~10% 90%+
- Intensity phase: ~20% <70%, ~25% 70-80%, ~35% 80-90%, ~20% 90%+
- Competition week: ~15% <70%, ~15% 70-80%, ~30% 80-90%, ~40% 90%+

Show as a small comparison table: "Your distribution" vs "Target for [phase]"

---

## GROUP 7: INSIGHT ENGINE

Create: src/lib/analysisInsights.ts

Auto-generate text insights from the data. Each function returns a
string or null (null = nothing notable to say).

```typescript
function generateInsights(aggregates: WeeklyAggregate[], ratios: LiftRatio[], zones: IntensityZone[]): string[] {
  const insights: string[] = [];
  // Check for:
  // - Compliance dropping below 85% for 2+ consecutive weeks
  // - Volume spike (>20% increase week-over-week)
  // - RAW readiness correlation with performance
  // - Ratio drift outside target ranges
  // - Intensity zone imbalance for current phase
  // - Bodyweight trend vs performance trend
  // - PR drought (no PRs in 4+ weeks)
  // - Tonnage increase without load increase (junk volume)
  // - Load increase without tonnage increase (quality improvement)
  return insights;
}
```

Display insights as blue info cards above or below charts.
Limit to 2-3 most relevant insights per view. Don't overwhelm.

---

## GROUP 8: PLANNED VS PERFORMED DETAIL VIEW

Create: src/components/analysis/PlannedVsPerformed.tsx

This is the most detailed preset — gets its own component because
it has both charts and a table.

Layout (matching the prototype I showed):
1. Macro phase bar at top (colored segments showing phases)
2. Summary metrics: planned reps, performed reps, planned tonnage,
   performed tonnage, avg compliance
3. Insight card with auto-generated text
4. Reps chart: grouped bars (planned ghost, performed solid),
   compliance % line on secondary axis
5. Tonnage chart: overlaid area/line (planned dashed, performed solid)
6. Weekly breakdown table with:
   - Week number
   - Phase badge (colored pill)
   - Planned reps
   - Performed reps
   - Compliance % with mini progress bar
   - Tonnage gap (+ or -)
   - Skipped exercises count

Bar colors by compliance:
- ≥95%: green (#1D9E75)
- ≥85%: blue (#378ADD)
- ≥75%: amber (#EF9F27)
- <75%: red (#E24B4A)

Table rows with zebra striping. Phase badges use macro phase colors.

---

## GROUP 9: DASHBOARD INTEGRATION

File: src/components/CoachDashboard.tsx

Add a small "Quick analysis" section to the dashboard showing the
athlete overview. For each athlete row, add a small sparkline or
mini metric showing their compliance trend (last 4 weeks).

Use a tiny inline chart (50px wide, 20px tall) — a simple SVG path
is fine, no need for full Recharts for sparklines.

---

## GROUP 10: UI POLISH

### Chart styling (all charts)
- Use Recharts throughout (not Chart.js — keep consistent with macro module)
- Tooltip: white bg, subtle shadow, 12px font
- Axis labels: 11px, text-gray-500
- Grid: light gray dashes
- Bar border-radius: 4px
- Line tension: monotone curve type
- Responsive: use ResponsiveContainer with 100% width

### Page layout
- Max width 1400px, centered
- Consistent spacing between sections (gap-3 for cards, margin-bottom 1rem for sections)
- Cards: bg-white border border-gray-200 rounded-lg
- Metric cards: bg-gray-50 rounded-lg py-2 px-4
- Section labels: text-[10px] uppercase text-gray-400 tracking-wider font-medium

### Transitions
- Tab switching: no animation needed, instant swap
- Chart rendering: Recharts built-in animation is fine
- Preset card hover: border-color transition

### Empty states
- No data for period: "No training data found for this period. Try selecting a longer date range."
- No PRs: "No personal records found. PRs are tracked from training log entries."
- No macro: "No macrocycle covers this period. Ratio trends require PR data."

---

## GROUP 11: TESTING

Open Chrome and test:

1. Navigate to Analysis from sidebar
2. Select an athlete
3. Default view: Pivot builder with 8-week period
4. Change X axis to Day → chart updates
5. Change primary metric to Total tonnage → chart updates
6. Add bodyweight overlay → second Y axis appears with line
7. Filter to Snatch only → bars show snatch data only
8. Switch to Quick analyses tab → preset cards visible
9. Click "Competition lift trends" → chart renders
10. Click "Planned vs performed" → full view with charts + table
11. Click back → preset grid returns
12. Switch to Lift ratios tab → ratio bars show with targets
13. Insight text appears if any ratio is outside target
14. Switch to Intensity zones tab → stacked bars by zone
15. Change period to "Current macro" → data updates
16. Change period to "Custom range" → date pickers appear
17. No console errors on any interaction
18. Charts resize properly on window resize
19. Empty states show correctly for athlete with no data

Fix any issues found during testing.
