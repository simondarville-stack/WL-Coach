# Domain Review — EMOS
_Reviewer: emos-domain-reviewer · Date: 2026-04-19_

## Summary

| Severity | Count |
|----------|-------|
| Critical |   5   |
| Major    |   6   |
| Minor    |   5   |
| Info     |   4   |

---

## Findings

### [DOM-001] `MacroTableV2` owns a hardcoded WEEK_TYPES array and parallel color/abbreviation maps

**Severity:** Critical  
**File:** `src/components/macro/MacroTableV2.tsx:47–66`  
**Issue:**  
`MacroTableV2` defines its own private, static list of week types completely independent of the coach-configured `GeneralSettings.week_types`:

```ts
const WEEK_TYPE_COLORS: Record<string, string> = {
  High: '#E24B4A', Medium: '#EF9F27', Low: '#1D9E75', Deload: '#5DCAA5',
  Competition: '#378ADD', Taper: '#7F77DD', Vacation: '#888780',
  Testing: '#D85A30', Transition: '#D4537E',
};

const WEEK_TYPES: WeekType[] = [
  'High', 'Medium', 'Low', 'Deload', 'Taper',
  'Competition', 'Vacation', 'Testing', 'Transition'
];
```

The `cycleWeekType()` function cycles through this hardcoded array. Any week type a coach adds in GeneralSettings is invisible here; removing a default one still cycles it. The color map is also duplicated — `GeneralSettings`, `MacroPhaseBlock`, `weekUtils.getWeekTypeColor`, and `macroPhaseBarData.resolveWeekType` all have separate representations of the same information.  
**Recommendation:** Remove `WEEK_TYPES`, `WEEK_TYPE_COLORS`, `getWeekTypeAbbr`, and `getWeekTypeColor` from this file. Accept `weekTypes: WeekTypeConfig[]` as a prop (same as `MacroPhaseBlock` already does) and resolve color/abbreviation via the shared `getWeekTypeColor()` from `weekUtils`. The cycle function should iterate over the injected `weekTypes` array.

---

### [DOM-002] `PlannerControlPanel` week-type badge uses hardcoded switch on lift-type names

**Severity:** Critical  
**File:** `src/components/planner/PlannerControlPanel.tsx:46–57`  
**Issue:**  
`weekTypeBadgeColor()` is a switch statement over hardcoded strings `'High'`, `'Medium'`, `'Low'`, `'Deload'`, `'Competition'`, `'Taper'`, `'Testing'`. Any week type a coach defines (e.g. `'Shock'`, `'Maximal'`, `'GPP'`) falls into the `default` branch and receives a grey badge, silently losing the coach's chosen color:

```ts
function weekTypeBadgeColor(weekType: string): { bg: string; text: string } {
  switch (weekType) {
    case 'High':        return { bg: 'var(--color-amber-50)',  text: 'var(--color-amber-800)' };
    ...
    default:            return { bg: 'var(--color-bg-secondary)', text: 'var(--color-text-secondary)' };
  }
}
```

**Recommendation:** Derive badge colors from `WeekTypeConfig.color` (already stored as a hex string). Pass `weekTypes: WeekTypeConfig[]` down to this component and compute badge bg/text by lightening the `color` field rather than switching on the name.

---

### [DOM-003] `kValue.ts` auto-derives competition total using category name-matching instead of `is_competition_lift`

**Severity:** Critical  
**File:** `src/lib/kValue.ts:35–49`  
**Issue:**  
The auto-derivation of competition total (Snatch + C&J) first correctly gates on `is_competition_lift`, but then further discriminates *which* competition lift is the Snatch vs. C&J by pattern-matching the category string:

```ts
const cat = (ex.category || '').toLowerCase();
if (cat.includes('snatch') && !cat.includes('pull') && !cat.includes('power')) {
  bestSnatch = Math.max(bestSnatch, val);
} else if (
  (cat.includes('clean') && cat.includes('jerk')) ||
  cat === 'clean & jerk' || cat === 'clean and jerk'
) {
  bestCJ = Math.max(bestCJ, val);
}
```

A coach who uses category names like `'Olympic Lifts'`, `'Competitive Movements'`, or a non-English taxonomy gets `bestSnatch = 0` and `bestCJ = 0`, so the total returns `null` even when exercises are correctly flagged `is_competition_lift = true`.  
This is a non-negotiable violation: business logic (which lift contributes to the total) depends on name-matching rather than the DB field designed for this purpose.  
**Recommendation:** The DB schema has `is_competition_lift` but no structured way to say "this is the snatch lift" vs "this is the C&J lift". Two approaches: (1) Add a `lift_slot` enum (`'snatch' | 'clean_and_jerk' | null`) to the `exercises` table so coaches can designate slots explicitly. (2) Keep the category heuristic only as a fallback when `lift_slot` is null. Until the schema is extended, at minimum document that auto-derivation only works for coaches whose categories contain the words "snatch" and "clean".

---

### [DOM-004] `EventAttempts` schema hardcodes two competition lifts with exactly three attempts each

**Severity:** Critical  
**File:** `src/lib/database.types.ts:377–396`, `src/components/EventAttemptsModal.tsx`  
**Issue:**  
The `EventAttempts` table has 12 fixed columns: `planned_snatch_1/2/3`, `planned_cj_1/2/3`, `actual_snatch_1/2/3`, `actual_cj_1/2/3`. The field names encode the OWL-specific rule that there are exactly two competition lifts (Snatch and Clean & Jerk) and exactly three attempts each. The `EventVideo` type has `lift_type: 'snatch' | 'clean_jerk'`.  
This makes the competition structure completely inextensible: a Crossfit-style coach, Masters federation with only C&J, or any future IWF rule change cannot be modelled. The `EventAttemptsModal` has headings `"Snatch"` and `"Clean & Jerk"` hardcoded in JSX.  
**Recommendation:** Replace `EventAttempts` with a flexible `event_attempt_entries` table: `(event_id, athlete_id, exercise_id, attempt_number, planned_kg, actual_kg)`. The coach selects which exercises are attempted per event. `EventVideo` should reference `exercise_id` rather than a `'snatch' | 'clean_jerk'` enum. This is a schema migration but is the correct long-term fix.

---

### [DOM-005] `analysisInsights.ts` hardcodes 85% compliance threshold and 70% intensity zone threshold

**Severity:** Critical  
**File:** `src/lib/analysisInsights.ts:15, 47`  
**Issue:**  
Two business-logic thresholds are hardcoded:

```ts
if (agg.plannedReps > 0 && agg.complianceReps < 85) { ... }
// ...
const lowZone = zones.find(z => z.zone === '<70%');
if (lowZone && lowZone.percentage > 50) { ... }
```

The 85% compliance threshold and 50% low-intensity warning are specific to one coaching philosophy. A powerlifting-oriented coach may accept 95% or 70%. The intensity zone boundary `70%` is the OWL convention but not universal.  
**Recommendation:** Expose these as configurable thresholds in `GeneralSettings` (e.g. `compliance_warning_threshold`, `low_intensity_zone_max_pct`). Read them from settings before generating insights. Since the Analysis feature is noted as "hidden but internal logic is out of scope to fix", flag this as Critical but note the fix is deferred to the Analysis work stream.

---

### [DOM-006] `src/lib/constants.ts` exports hardcoded `CATEGORIES` array (used as fallback)

**Severity:** Major  
**File:** `src/lib/constants.ts:3–10`  
**Issue:**  
```ts
export const CATEGORIES: Category[] = [
  'Snatch', 'Clean & Jerk', 'Squat', 'Pull', 'Press', 'Accessory',
];
```
The `useExercises` hook correctly fetches categories from the `categories` table in Supabase. However, `CATEGORIES` is exported and could silently be used anywhere that does not call `fetchCategories` first. `ExerciseBulkImportModal` falls back to `categories[0]?.name ?? 'Snatch'` — if the categories table is empty the fallback string `'Snatch'` leaks. The `HINT_ROW` in `ExerciseBulkImportModal` says `'e.g. Snatch / Clean & Jerk / ...'`, implying to users that these are the only valid options.  
**Recommendation:** Delete `CATEGORIES` from `constants.ts`. The bulk import hint row should be dynamic — load from the `categories` table and show the coach's actual categories. The Supabase `categories` table is the single source of truth; static fallbacks should not exist.

---

### [DOM-007] `MacroCycles` defaults new macro weeks to hardcoded `week_type: 'Medium'`

**Severity:** Major  
**File:** `src/components/macro/MacroCycles.tsx:222, 440`  
**Issue:**  
When creating a new macrocycle or extending one, every new week is seeded with:
```ts
week_type: 'Medium' as WeekType,
```
`'Medium'` may not exist in a given coach's week type configuration. A coach who has defined `'Normal'`, `'Standard'`, or uses entirely different nomenclature will see an unresolvable week type badge until they manually change every week.  
**Recommendation:** Seed with the first entry of `GeneralSettings.week_types[0].abbreviation` rather than the string literal `'Medium'`. Fall back to an empty string `''` if week types are not yet configured.

---

### [DOM-008] `PhaseType` is a closed union with OWL-specific preset names

**Severity:** Major  
**File:** `src/lib/database.types.ts:22`  
**Issue:**  
```ts
export type PhaseType = 'preparatory' | 'strength' | 'competition' | 'transition' | 'custom';
```
The `phase_type` field on `MacroPhase` encodes OWL-specific periodization nomenclature (`preparatory`, `strength`, `competition`, `transition`) as a fixed TypeScript union. The preset colors in `MacroPhaseModal` (`PHASE_TYPE_OPTIONS`) further reinforce these four concepts. The only escape hatch is `'custom'`.  
A coach working in a different system (e.g. GPP/SPP/Competitive/Transition, or simply a free-label system) is forced into this vocabulary at the schema level.  
**Recommendation:** Either (a) make `phase_type` a free string and document the four values as informational suggestions, or (b) remove `phase_type` entirely and let the phase `name` field carry all semantic meaning. The `color` field is already coach-configurable; phase type only gates preset color selection in the modal, which is minor UX.

---

### [DOM-009] `useAnalysis.ts` — intensity zones hardcode OWL-standard percentage boundaries

**Severity:** Major  
**File:** `src/hooks/useAnalysis.ts:470–474`  
**Issue:**  
```ts
const zones = [
  { zone: '<70%', min: 0, max: 0.7, reps: 0 },
  { zone: '70-80%', min: 0.7, max: 0.8, reps: 0 },
  { zone: '80-90%', min: 0.8, max: 0.9, reps: 0 },
  { zone: '90%+', min: 0.9, max: Infinity, reps: 0 },
];
```
The 70/80/90 boundaries are the conventional OWL intensity classification. A powerlifting or hybrid coach using different zone definitions cannot reconfigure them. The zone labels are also hardcoded strings that drive downstream `analysisInsights.ts` logic (which compares against the string `'<70%'`).  
**Recommendation:** Allow coaches to define intensity zones in GeneralSettings as `{ label: string; max_pct: number }[]`. Since analysis is out of scope for immediate fixes, flag as deferred Major. At minimum, decouple the zone definitions from the zone-name string `'<70%'` used in insights (DOM-005 above).

---

### [DOM-010] `useAnalysis.ts:fetchLiftRatios` — lift identification uses name-pattern matching, not `is_competition_lift`

**Severity:** Major  
**File:** `src/hooks/useAnalysis.ts:526–555`  
**Issue:**  
`fetchLiftRatios` searches exercise names with patterns like:
```ts
const snatch = findBest(n => n.includes('snatch') && !n.includes('pull') && !n.includes('press') && !n.includes('balance'));
const cj = findBest(n => n.includes('clean') && n.includes('jerk'));
const bsq = findBest(n => n.includes('back squat'));
```
This is the same pattern as DOM-003 but in the analysis module. It does not use `is_competition_lift` at all — the query on line 501 only fetches `id, name` with no `is_competition_lift` column. Lift ratios like `Snatch / C&J` and `Snatch / Back squat` are hardcoded OWL-specific benchmarks with hardcoded target percentages (80–85%, 65–70%, etc.).  
**Recommendation:** Since analysis is out of scope for immediate fix, flag as Major deferred. Long-term: replace name-matching with `is_competition_lift` plus `lift_slot` (from DOM-003). The target ratio ranges should be configurable in settings.

---

### [DOM-011] `src/components/analysis/presets/BodyweightTrend.tsx` hardcodes IWF weight classes

**Severity:** Major  
**File:** `src/components/analysis/presets/BodyweightTrend.tsx:9`  
**Issue:**  
```ts
const WEIGHT_CLASSES = [49, 55, 59, 64, 71, 76, 81, 87, 96, 102, 109];
```
These are current IWF men's weight categories. Women's classes (45, 49, 55, 59, 64, 71, 76, 87, +87), Masters classes, Youth classes, and non-IWF federation classes are absent. The `athlete.weight_class` field is a free string, so coaches can enter any value, but the chart reference lines will never match a women's athlete or a Masters athlete competing at +109.  
**Recommendation:** Drive chart reference lines from `athlete.weight_class` (the string value already on the athlete record) combined with a coach-configurable weight class list per federation stored in settings. Since this is in the out-of-scope Analysis module, this is flagged as Major deferred.

---

### [DOM-012] `PrintWeekCompact` uses a hardcoded `CATEGORY_ABBREVIATIONS` map with specific exercise names

**Severity:** Minor  
**File:** `src/components/planner/PrintWeekCompact.tsx:53–73`  
**Issue:**  
```ts
const CATEGORY_ABBREVIATIONS: Record<string, string> = {
  'Snatch': 'Sn', 'Clean': 'Cl', 'Jerk': 'Jk', 'Clean & Jerk': 'C&J',
  'Squat': 'Sq', 'Back Squat': 'BSq', 'Front Squat': 'FSq', ...
};
```
These are display-only abbreviations used in print output. A graceful fallback (`getCategoryAbbr`) is present for unknown categories (initials or 3-char truncation). The hardcoded map has no business-logic consequence, but a coach with different category names will see auto-generated codes rather than the intentional abbreviations.  
**Recommendation:** The `exercise_code` field on each exercise already contains the coach-assigned short code (e.g. `SN`, `C&J`). The print view should prefer `exercise.exercise_code` when present (which it does via `getExerciseCode()`), making the category-based abbreviation map only a secondary display heuristic. Consider removing `CATEGORY_ABBREVIATIONS` entirely or making it a user-editable setting. Low priority.

---

### [DOM-013] `PlannerControlPanel.abbreviateExercise` duplicates name-based abbreviation logic

**Severity:** Minor  
**File:** `src/components/planner/PlannerControlPanel.tsx:35–43`  
**Issue:**  
A second independent name-pattern-to-abbreviation function exists:
```ts
function abbreviateExercise(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('snatch'))                     return 'Sn';
  if (l.includes('clean') && l.includes('jerk')) return 'C&J';
  if (l.includes('clean'))                      return 'Clean';
  if (l.includes('jerk'))                       return 'Jerk';
  if (l.includes('squat'))                      return 'Sq';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3);
}
```
This is a second instance of the same pattern as `PrintWeekCompact.CATEGORY_ABBREVIATIONS` and represents a single-source-of-truth violation. Any exercise whose name does not match the OWL keywords falls through to the initials fallback, but the primary path depends on knowing OWL exercise names.  
**Recommendation:** Consolidate into a single utility that checks `exercise.exercise_code` first, then falls back to initials. Remove both `abbreviateExercise` and `CATEGORY_ABBREVIATIONS`.

---

### [DOM-014] Training log's `getDefaultRestSeconds` uses exercise name pattern-matching for rest times

**Severity:** Minor  
**File:** `src/components/training-log/SessionView.tsx:45–50`  
**Issue:**  
```ts
function getDefaultRestSeconds(exerciseName: string): number {
  const lower = exerciseName.toLowerCase();
  if (lower.includes('snatch') || lower.includes('clean') || lower.includes('jerk')) return 180;
  if (lower.includes('squat') || lower.includes('deadlift') || lower.includes('pull')) return 120;
  return 90;
}
```
The rest-time defaults (180s / 120s / 90s) are OWL-domain heuristics and are derived from exercise name rather than from a configurable rest parameter. A coach may prefer different defaults per exercise category, or the `Exercise` record should carry a `default_rest_seconds` field.  
**Recommendation:** Add `default_rest_seconds: number | null` to the `Exercise` schema. When null, fall back to a single global default from `GeneralSettings`. Since the training log is out of scope for immediate fix, flag as Minor deferred.

---

### [DOM-015] `K-value` description encodes specific optimal range (38–42%) as a string

**Severity:** Minor  
**File:** `src/lib/metrics.ts:58`  
**Issue:**  
```ts
description: 'Average intensity / competition total (optimal: 38-42%)',
```
The 38–42% K-value range is a widely-cited heuristic from Soviet/Bulgarian OWL literature, but it is not a universal constant. Some coaches target 40–45%, some argue it depends on the athlete's training age. Hardcoding this in the metric description makes it appear authoritative.  
**Recommendation:** Move the optimal range into a coach-configurable setting (e.g. `k_value_target_min` / `k_value_target_max` in `GeneralSettings`). The metric description text should be dynamic, or simply say `'Average intensity as % of competition total'` without prescribing the target range.

---

### [DOM-016] `MacroCycles` phase-preset logic hardcodes phase names, colors, and week ratios

**Severity:** Info  
**File:** `src/components/macro/MacroCycles.tsx:246–257`  
**Issue:**  
The 8-week and 12-week phase presets that fire on macrocycle creation hardcode:
- Phase names (`'Preparatory'`, `'Accumulation'`, `'Strength'`, `'Competition'`)
- Phase colors (`'#DBEAFE'`, `'#FEE2E2'`, `'#FEF3C7'`)
- Week distribution ratios (40% + 35% + remainder)

These are reasonable OWL defaults, but they are defaults only — the coach can freely rename and recolor phases after creation. The preset is a creation-time convenience shortcut, not a runtime constraint.  
**Observation:** This is acceptable as a "starter preset" UX pattern as long as it is documented that these values are immediately editable after creation. No immediate action required, but consider allowing coaches to define their own named presets in settings in a future iteration.

---

### [DOM-017] `MacroPhaseBlock` correctly reads week types from `WeekTypeConfig[]` prop

**Severity:** Info  
**File:** `src/components/macro/MacroPhaseBlock.tsx`  
**Observation:** `MacroPhaseBlock` properly accepts `weekTypes: WeekTypeConfig[]` as a prop and uses `getWeekTypeColor(abbreviation, weekTypes)` from `weekUtils`. The cycle function iterates over the injected array. This is the correct pattern that `MacroTableV2` (DOM-001) should adopt.

---

### [DOM-018] `macroPhaseBarData.resolveWeekType` silently drops unknown week types

**Severity:** Info  
**File:** `src/lib/macroPhaseBarData.ts:41–58`  
**Observation:** When a macro week's `week_type` value does not match any entry in the coach's `WeekTypeConfig[]`, `resolveWeekType` returns `{ abbr: '', name: '' }` and the bar cell renders empty. This is intentional and documented in a comment ("Unknown values render as empty so the cell stays clean"). However, this could silently mask stale week type data after a coach renames or deletes a week type.  
**Recommendation:** Consider showing a visual indicator (e.g. a `?` badge or warning color) when a macro week references an unknown week type, so coaches can identify rows that need updating after renaming a type.

---

### [DOM-019] Weight class field is a free text string — no validation or federation-specific class list

**Severity:** Info  
**File:** `src/lib/database.types.ts:31`, `src/components/Athletes.tsx:137`  
**Observation:** `Athlete.weight_class` is `string | null` and rendered as a plain text input. This is actually the more flexible design — coaches can enter any federation's weight class (e.g. `'73'`, `'+109'`, `'87 Masters'`). However, there is no validation or autocomplete, so typos are invisible and cross-athlete filtering/grouping by weight class can yield false non-matches.  
**Recommendation:** Consider a light validation or autocomplete list that can be seeded from a federation preset (IWF, IPF, USAPL, etc.) while remaining overridable. This is informational — the current free-text approach is technically the most flexible.

---

## Cross-Cutting Summary

**Strongest area:** Week type system. `WeekTypeConfig` in `GeneralSettings`, `getWeekTypeColor` in `weekUtils`, and `MacroPhaseBlock` form a consistent, DB-driven week type system. The architecture is correct.

**Worst area:** `MacroTableV2` completely bypasses the week type system with its own hardcoded arrays and maps (DOM-001), making it the primary blocker for coach flexibility in the macro table view.

**Structural violation:** The `EventAttempts` schema (DOM-004) bakes OWL's two-lift / three-attempt structure into column names. This is the most expensive finding to fix (schema migration required) but is also the most fundamental constraint on competition structure flexibility.

**Pattern to fix everywhere:** Name-matching for OWL lift identification (DOM-003, DOM-010, DOM-013, DOM-014). All four instances should be replaced with `exercise.exercise_code` lookup or an explicit `lift_slot` DB field.
