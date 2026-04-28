# UX Review — EMOS
_Reviewer: emos-ux-reviewer · Date: 2026-04-19_

## Summary
| Severity | Count |
|----------|-------|
| Critical |   2   |
| Major    |  14   |
| Minor    |  12   |
| Info     |   5   |

---

## Findings

### [UX-001] Analysis and Training Log modules reachable via sidebar nav
**Severity:** Critical
**File:** `src/components/Sidebar.tsx:43,52`
**Issue:** Both `/analysis` (line 43) and `/training-log` (line 52) are present as explicit nav items in the sidebar `sections` array and are fully routed in `src/App.tsx:161,160`. Per audit scope, these modules must NOT be reachable via any nav link, route, or button.
**Recommendation:** Remove the `{ path: '/analysis', label: 'Analysis', icon: LineChart }` and `{ path: '/training-log', label: 'Training log', icon: ClipboardList }` entries from the sidebar sections array, and either remove or guard their `<Route>` entries in `App.tsx`.

---

### [UX-002] Sub-11px font sizes in production coach UI
**Severity:** Critical
**File:** `src/components/exercise-library/ExerciseDetailPanel.tsx:229,293,294,296,703,729`; `src/components/macro/MacroDraggableChart.tsx:491,507`; `src/components/macro/MacroCycles.tsx:773`; `src/components/Athletes.tsx:253-258,301,311,457,479`
**Issue:** Multiple locations render text at 8px or 9px — well below the 11px minimum (`var(--text-caption)`). Examples:
- `ExerciseDetailPanel.tsx:293` — `fontSize: 8` for chart axis labels
- `ExerciseDetailPanel.tsx:229` — `fontSize: 9` for xRM chart tick labels
- `MacroDraggableChart.tsx:491` — `fontSize: 8` for reference-line labels
- `MacroCycles.tsx:773` — `text-[8px]` for macro group labels in the timeline
- `Athletes.tsx:253–258` — `text-[9px]` for all six column header labels in the athlete list
This is a systematic violation across the three most-used screens.
**Recommendation:** Replace every sub-11px size with `var(--text-caption)` (11px). For chart axis labels that must be compact, 11px is the floor; consider shortening label strings rather than shrinking type.

---

### [UX-003] font-weight 600/700 used extensively in coach UI (non-athlete)
**Severity:** Major
**File:** `src/components/exercise-library/ExerciseDetailPanel.tsx:72,161,462,572,649,665,704,723`; `src/components/planner/PRTrackingPanel.tsx:207,236,240,244`; `src/components/planner/WeeklyPlanner.tsx:692`; `src/styles/tokens.css:376`
**Issue:** The EMOS type system allows only 400 and 500. The following coach-UI files use `fontWeight: 600` or `fontWeight: 700`:
- `ExerciseDetailPanel.tsx` — 8 separate occurrences of 600 or 700 in inline styles for the PR hero number, xRM table headers, and section headings
- `PRTrackingPanel.tsx` — 4 occurrences of `fontWeight: 600` on table headers and the panel title
- `WeeklyPlanner.tsx:692` — `fontWeight: 600` on "Group plan:" label
- `tokens.css:376` — `.pgrid-btn` rule declares `font-weight: 600`; this propagates to every prescription cell in the planner
**Recommendation:** Replace all `fontWeight: 600` / `fontWeight: 700` occurrences with `fontWeight: 500`. For `.pgrid-btn` in `tokens.css`, change the rule to `font-weight: 500`.

---

### [UX-004] Pervasive Tailwind `font-bold` and `font-semibold` across the coach interface
**Severity:** Major
**File:** `src/components/Athletes.tsx` (multiple); `src/components/CoachDashboard.tsx:196`; `src/components/dashboard-v2/StatsBar.tsx:87`; `src/components/dashboard-v2/ReadinessHeatmap.tsx:56`; `src/components/dashboard-v2/BodyweightPanel.tsx:43`; `src/components/dashboard-v2/AthleteGrid.tsx:139`; `src/components/dashboard-v2/DashboardV2.tsx:62`; `src/components/macro/MacroTableV2.tsx:417`; `src/components/macro/PlanningPRPanel.tsx:78`; `src/components/planner/PrintWeek.tsx` (multiple); `src/components/macro/MacroCycles.tsx:788,814`
**Issue:** Tailwind's `font-bold` (700) and `font-semibold` (600) are used heavily across Dashboard V2, Athletes, Macro Cycles, and PrintWeek. While PrintWeek is a print view and may warrant different treatment, the live-UI occurrences in DashboardV2, Athletes, and MacroCycles violate the 400/500-only rule.
**Recommendation:** Replace `font-bold` → `font-medium` and `font-semibold` → `font-medium` throughout non-print coach-UI components. Consider creating a Tailwind plugin or ESLint rule to flag `font-bold` and `font-semibold` going forward.

---

### [UX-005] `font-black` on EMOS wordmark in Sidebar
**Severity:** Major
**File:** `src/components/Sidebar.tsx:100,104`
**Issue:** The "EMOS" wordmark and its collapsed "E" variant both use `font-black` (900 weight) with a custom `fontFamily: 'Arial Black, Impact, Helvetica, sans-serif'`. This is a double violation: the weight is outside the 400/500 scale, and the font family overrides the EMOS design system font (`--font-sans`).
**Recommendation:** If the wordmark must be visually heavy, use an SVG logo asset or a purpose-built logotype treatment outside the type-scale rules. Otherwise, render it with the standard font at weight 500. Document the intentional exception if the logotype treatment is retained.

---

### [UX-006] Systematic `bg-white`, `text-gray-*`, `border-gray-*` — hardcoded Tailwind colors instead of EMOS tokens
**Severity:** Major
**File:** `src/components/Athletes.tsx` (dozens); `src/components/AthleteCardPicker.tsx:147`; `src/components/AthletePRs.tsx:143`; `src/components/BodyweightPopup.tsx`; `src/components/CoachDashboard.tsx`; `src/components/dashboard-v2/*`; `src/components/Sidebar.tsx:87,93,112,204,250`; `src/App.tsx:144`
**Issue:** The entire coach shell — sidebar, app header, Athletes panel, AthletePRs, BodyweightPopup, and every Dashboard V2 card — is built with Tailwind gray-scale classes (`bg-white`, `bg-gray-50`, `bg-gray-100`, `text-gray-400`, `text-gray-900`, `border-gray-200`, etc.) instead of `var(--color-*)` tokens. This means the components do not respond to the dark theme defined in `tokens.css` and will break if the EMOS theme is switched.
**Recommendation:** Systematically replace all hardcoded Tailwind color utilities with the corresponding EMOS token. Key mappings:
- `bg-white` → `bg-[var(--color-bg-primary)]` or `style={{ background: 'var(--color-bg-primary)' }}`
- `bg-gray-50` → `var(--color-bg-secondary)`
- `bg-gray-100` → `var(--color-bg-tertiary)`
- `text-gray-900` → `var(--color-text-primary)`
- `text-gray-500` → `var(--color-text-secondary)` / `var(--color-text-tertiary)`
- `border-gray-200` → `var(--color-border-secondary)` at `0.5px`

---

### [UX-007] Box-shadow on card and container elements
**Severity:** Major
**File:** `src/components/exercise-library/ExerciseDetailPanel.tsx:146`; `src/components/exercise-library/ExerciseLibrary.tsx:692,1180`; `src/components/Athletes.tsx:61`; `src/components/BodyweightPopup.tsx:133`; `src/components/calendar/EventDetailModal.tsx:50`; `src/components/calendar/EventFormModal.tsx:83`; `src/components/TrainingGroups.tsx:245,292,337`; `src/components/macro/MacroCreateModal.tsx:64`; `src/components/macro/MacroExcelIO.tsx:812,912`; `src/components/tools/RepMaxCalculator.tsx:150`; `src/components/tools/Calculator.tsx:142`; `src/components/tools/CalendarTool.tsx:164`
**Issue:** Flat design is the EMOS rule — no `box-shadow` on cards or containers. The pattern `shadow-xl`, `shadow-2xl` (Tailwind), and inline `boxShadow` values are used on virtually every modal, popup, and floating panel. `ExerciseDetailPanel.tsx:146` applies `0 20px 40px rgba(0,0,0,0.18)` to the slide-in panel; `ExerciseLibrary.tsx:1180` applies `-8px 0 32px rgba(0,0,0,0.10)` to a container.
**Recommendation:** Remove `box-shadow` from all card/container elements. For modals and overlays that need depth cues, rely on a semi-transparent backdrop (already used in several places) and a `0.5px solid` border. The floating tools (Calculator, RepMaxCalculator, CalendarTool) may retain a single subtle shadow as they are interactive overlays.

---

### [UX-008] 1px borders on cards and containers — should be 0.5px hairlines
**Severity:** Major
**File:** `src/components/planner/WeekSummary.tsx:12-19,106,165`; `src/components/planner/WeeklyPlanner.tsx:767,819`; `src/components/macro/MacroPhaseBlock.tsx:151`; `src/components/macro/MacroDraggableChart.tsx:463`; `src/styles/tokens.css:406,419,440`; `src/components/AthleteCardPicker.tsx:147`; `src/components/AthletePRs.tsx`; `src/components/calendar/*`; `src/components/Sidebar.tsx`
**Issue:** EMOS specifies `0.5px solid` hairlines for all card/container borders. The `WeekSummary` intensity-badge styles (lines 12–19) all use `1px solid`, as does the DayEditor/WeeklyPlanner side-panel container. In `tokens.css`, `.pgrid-interval` (line 406), `.pgrid-add-btn` (line 419), and `.pgrid-editing` (line 440) all declare `border: 1px`. The Tailwind-based code (Sidebar, AthleteCardPicker, calendar) also defaults to full-pixel borders.
**Recommendation:** Change `1px solid` to `0.5px solid` for all card/container borders, including the token-layer rules in `tokens.css`. Verify on high-DPI displays (retina) where 0.5px renders as a true hairline.

---

### [UX-009] Hardcoded hex colors outside the exercise-palette exception
**Severity:** Major
**File:** `src/components/planner/WeekSummary.tsx:18`; `src/components/planner/WeeklyPlanner.tsx:692`; `src/components/dashboard-v2/AthleteGrid.tsx:119,120`; `src/components/dashboard-v2/EventsPanel.tsx:30`; `src/components/dashboard-v2/PhaseOverview.tsx:46,56`; `src/components/index.css:9,29,30`; `src/components/BodyweightPopup.tsx:223,225,231`
**Issue:** Hardcoded hex values appear in contexts that are not exercise/category accent colors:
- `WeekSummary.tsx:18` — `'#7C3AED'` as a `Testing` week badge color (should use `var(--color-purple-600)`)
- `WeeklyPlanner.tsx:692` — `'#3730a3'` hardcoded color for "Group plan:" label
- `dashboard-v2/AthleteGrid.tsx:119,120` — `'#f3f4f6'` and `'#6b7280'` fallback colors
- `dashboard-v2/EventsPanel.tsx:30` and `PhaseOverview.tsx:46,56` — hex fallbacks for missing event/phase colors
- `index.css:9` — `#f8fafc` html background (should be `var(--color-bg-page)`)
- `index.css:29,30` — `#dbeafe` / `#1e3a5f` selection colors (not in token system)
- `BodyweightPopup.tsx:223,225,231` — `#3b82f6`, `#f97316` hardcoded Recharts line colors
**Recommendation:** Replace each hardcoded hex with its nearest EMOS token or EMOS palette token. For Recharts lines, use `var(--color-accent)` and `var(--color-amber-200)`. Add the selection colors to `tokens.css` as `--color-selection-bg` and `--color-selection-text`. Fix `index.css:9` to use `var(--color-bg-page)`.

---

### [UX-010] `text-[12px]` and `fontSize: 12` used in coach UI — not in the type scale
**Severity:** Major
**File:** `src/components/Athletes.tsx:309`; `src/components/macro/MacroTableV2.tsx:417`; `src/components/planner/ExerciseHistoryChart.tsx:194`; `src/components/planner/SollIstChart.tsx:106,113`; `src/components/analysis/IntensityZones.tsx:158`; `src/components/analysis/presets/*.tsx` (tooltip `contentStyle: { fontSize: 12 }`)
**Issue:** 12px does not exist in the EMOS type scale (11, 13, 14, 16, 22 px only). Multiple components use 12px for coach-facing text labels and chart tooltips.
**Recommendation:** Raise 12px occurrences to `var(--text-caption)` (11px) or `var(--text-label)` (13px) depending on context. For Recharts/Chart.js `contentStyle`, apply `fontSize: 'var(--text-caption)'` or pass an integer 11.

---

### [UX-011] `fontSize: 30` and `fontSize: 24` in ExerciseDetailPanel — unscaled display values
**Severity:** Major
**File:** `src/components/exercise-library/ExerciseDetailPanel.tsx:571,648`
**Issue:** The PR hero number uses `fontSize: 30, fontWeight: 700` and the "Athletes with a PR" count uses `fontSize: 24, fontWeight: 700`. Neither size nor weight is part of the EMOS type system.
**Recommendation:** The largest token is `var(--text-display)` at 22px / weight 500. Use it for both hero numbers, or introduce a deliberate `--text-hero` token (e.g., 28px, weight 500) documented in `tokens.css` if a larger display size is required. Remove the `fontWeight: 700`.

---

### [UX-012] App header uses hardcoded colors and a Tailwind box-shadow utility
**Severity:** Major
**File:** `src/App.tsx:144`
**Issue:** The main coach app header (`<header>`) is styled: `border-b border-gray-200 bg-white flex-shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]`. Three violations in one element: `bg-white` (hardcoded), `border-gray-200` (hardcoded), and a Tailwind arbitrary shadow (flat-design violation).
**Recommendation:** Replace with token-based styles: `background: var(--color-bg-primary)`, `border-bottom: 0.5px solid var(--color-border-secondary)`. Remove the shadow.

---

### [UX-013] Sidebar uses hardcoded Tailwind colors and `border-r border-gray-200`
**Severity:** Major
**File:** `src/components/Sidebar.tsx:87,93,112,126,204,250`
**Issue:** The sidebar aside, its section dividers, the environment dropdown, and the border between sidebar and content all use Tailwind gray utilities (`bg-gray-50`, `border-gray-200`, `bg-white`, `text-gray-600`, `hover:bg-gray-100`) instead of EMOS tokens. This means the sidebar will not adapt to dark mode.
**Recommendation:** Migrate the sidebar to use inline `style` props or a dedicated CSS class that references `var(--color-*)` tokens throughout.

---

### [UX-014] Modal and dialog containers use `shadow-xl` / `shadow-2xl` (flat-design violation, flagged Major)
**Severity:** Major
**File:** `src/components/ModalShell.tsx:11`; `src/components/Athletes.tsx:61`; `src/components/ExerciseBulkImportModal.tsx:193,210`; `src/components/ExerciseFormModal.tsx:24`; `src/components/MediaInputModal.tsx:75`; `src/components/macro/MacroEditModal.tsx:75`; `src/components/macro/MacroCreateModal.tsx:64`; `src/components/macro/MacroPhaseModal.tsx:84`; `src/components/planner/ComboCreatorModal.tsx:106`; `src/components/planner/CopyWeekModal.tsx:149`
**Issue:** Every modal shell uses `shadow-xl` or equivalent. The audit rules flag shadows on interactive overlays as Major (borderline). The flat-design system relies on a backdrop + hairline border for layering, which these components partially implement (backdrop is present) but still add shadow on top.
**Recommendation:** Remove `shadow-xl` / `shadow-2xl` from modal containers. Add `border: 0.5px solid var(--color-border-primary)` to provide visual separation from the backdrop, consistent with flat EMOS aesthetics.

---

### [UX-015] Sidebar nav items have insufficient tap-target height (py-1.5 = ~28px)
**Severity:** Minor
**File:** `src/components/Sidebar.tsx:175`
**Issue:** Expanded sidebar nav items use `py-1.5` (6px top + 6px bottom) plus an icon at 16px height, resulting in an effective row height of approximately 28px — below the 36px minimum for comfortable tap targets on touch or high-DPI displays. The collapsed icon-only mode uses `py-2` (8+8+16 = 32px) which is also marginally short.
**Recommendation:** Increase expanded nav items to `py-2` (32px) or `py-2.5` (36px) minimum. Collapsed items should be at least `py-2.5` with a 40px square touch area.

---

### [UX-016] `text-[10px]` used widely as a de-facto sixth type-scale size
**Severity:** Minor
**File:** `src/components/AthleteSelector.tsx:51,71,98`; `src/components/CoachDashboard.tsx:195,253,529`; `src/components/macro/ExerciseToggleBar.tsx:52,66,76,93`; `src/components/macro/MacroDraggableChart.tsx:337,358,370,388,396`; `src/components/macro/MacroDistributionChart.tsx:290,294,298,304,324,342`; `src/components/DayConfigModal.tsx:204,207,213,227`; `src/components/Sidebar.tsx:113,155,206`
**Issue:** `text-[10px]` (10px) is used pervasively for labels, section headers, filter chips, and callouts — creating an unofficial sixth scale step between `--text-caption` (11px) and nothing. This is 1px below the system minimum.
**Recommendation:** Raise all `text-[10px]` occurrences to `var(--text-caption)` (11px). In dense contexts where 11px feels too large, reconsider the UI density rather than shrinking text below the threshold.

---

### [UX-017] Recharts chart axis labels use hardcoded `#9ca3af` / `#4b5563` fill colors
**Severity:** Minor
**File:** `src/components/BodyweightPopup.tsx:202,207`; `src/components/macro/MacroDraggableChart.tsx:443,453`; (and analysis presets — omitted per scope)
**Issue:** Chart axis tick colors are hardcoded Tailwind gray hex values (`#9ca3af`, `#4b5563`, `#6b7280`) rather than EMOS tokens.
**Recommendation:** Use `var(--color-text-tertiary)` or `var(--color-text-secondary)` for axis labels. Recharts accepts CSS variable strings in `tick.fill` props.

---

### [UX-018] Hardcoded `rgba` colors on coaching UI overlays and DayEditor
**Severity:** Minor
**File:** `src/components/planner/DayEditor.tsx:273`; `src/components/planner/ExerciseSearch.tsx:150`; `src/components/planner/ComboCreatorModal.tsx:222,250`; `src/components/macro/MacroDistributionChart.tsx:157,179,200,224`
**Issue:** Inline rgba values such as `rgba(240,149,149,0.06)` (rest-day tint in DayEditor), `rgba(0,0,0,0.1)` (ExerciseSearch dropdown shadow), and `rgba(0,0,0,0.04)` (chart gridlines) bypass the token system.
**Recommendation:** Map to the closest EMOS semantic token or use `var(--color-danger-bg)` at reduced opacity for danger tints. For chart grid colors, `var(--color-border-tertiary)` is the right token.

---

### [UX-019] `1px solid` in `tokens.css` PrescriptionGrid classes
**Severity:** Minor
**File:** `src/styles/tokens.css:390,406,419,440`
**Issue:** Four rules inside the token stylesheet itself use `1px` borders/outlines:
- Line 390: `.pgrid-btn:hover` — `outline: 1px solid var(--color-accent-border)`
- Line 406: `.pgrid-interval` — `border: 1px solid rgba(59,130,246,0.15)`
- Line 419: `.pgrid-add-btn` — `border: 1px dashed var(--color-border-secondary)`
- Line 440: `.pgrid-editing` — `border: 1px solid var(--color-accent)`
**Recommendation:** Change all four to `0.5px solid` (or `0.5px dashed` for the add button).

---

### [UX-020] TestingWeek badge color `#7C3AED` not using EMOS purple token
**Severity:** Minor
**File:** `src/components/planner/WeekSummary.tsx:18`
**Issue:** The `Testing` week type badge uses `color: '#7C3AED'` (a Tailwind purple-700 value) and `background: 'rgba(139,92,246,0.1)'` instead of EMOS purple tokens.
**Recommendation:** Replace with `color: 'var(--color-purple-600)'`, `background: 'var(--color-purple-50)'`, `border: '0.5px solid var(--color-purple-200)'`.

---

### [UX-021] AthleteCardPicker card uses `bg-white border-gray-200` — not dark-mode safe
**Severity:** Minor
**File:** `src/components/AthleteCardPicker.tsx:147`
**Issue:** Athlete picker cards use `bg-white hover:bg-blue-50/40 border border-gray-200 hover:border-blue-300`. These are raw Tailwind colors that bypass EMOS tokens and will not adapt to dark mode.
**Recommendation:** Replace with token equivalents: `background: var(--color-bg-primary)`, `border: 0.5px solid var(--color-border-secondary)`, hover uses `var(--color-accent-muted)` and `var(--color-accent-border)`.

---

### [UX-022] Transition durations inconsistent — mix of `0.1s`, `0.15s`, `100ms`, `150ms` without token use
**Severity:** Minor
**File:** `src/components/planner/DayCard.tsx:286,306,324`; `src/components/planner/CopyWeekModal.tsx:193,210`; `src/components/planner/PlannerControlPanel.tsx:114,752,779`; `src/components/Sidebar.tsx:172,214`
**Issue:** Transition durations are specified directly as `'0.1s'`, `'0.15s'`, `'100ms'`, `'150ms'`, `duration-100`, `duration-150` rather than using the `var(--transition-fast)` (100ms), `var(--transition-base)` (150ms), and `var(--transition-slow)` (200ms) tokens defined in `tokens.css`.
**Recommendation:** Standardise all transitions to reference the token variables. In inline style objects: `transition: \`border-color var(--transition-fast)\``. In Tailwind classes, this requires a CSS layer approach or direct `style` prop.

---

### [UX-023] `AthletePRs.tsx` uses old-style Tailwind UI throughout (bg-white, border-gray)
**Severity:** Minor
**File:** `src/components/AthletePRs.tsx:143,149,150,160,166,174,186,198,204–264`
**Issue:** The entire AthletePRs component is built in legacy Tailwind style with `bg-white`, `border-gray-200`, `text-gray-600`, `bg-gray-200`, `hover:bg-gray-300` etc. — it has not been migrated to EMOS tokens.
**Recommendation:** Migrate AthletePRs to use EMOS tokens. This component is low-traffic (linked from Sidebar's Athletes section) but visible on every athlete profile.

---

### [UX-024] `MacroDraggableChart` tooltip uses hardcoded colors and incorrect font size
**Severity:** Minor
**File:** `src/components/macro/MacroDraggableChart.tsx:462-464`
**Issue:** The Recharts custom tooltip container uses `fontSize: 10` (below scale), `border: '1px solid #e5e7eb'` (1px + hex color), and `boxShadow: '0 2px 8px rgba(0,0,0,0.08)'` (shadow on a UI card) — three simultaneous violations.
**Recommendation:** Update to `fontSize: 'var(--text-caption)'`, `border: '0.5px solid var(--color-border-secondary)'`, remove `boxShadow`.

---

### [UX-025] MacroDistributionChart chart axis font sizes are 9px
**Severity:** Minor
**File:** `src/components/macro/MacroDistributionChart.tsx:156,157,178,179,199,200,223,224`
**Issue:** All four Chart.js configurations in `MacroDistributionChart` set `font: { size: 9 }` on both x and y axes — 2px below the 11px minimum.
**Recommendation:** Change to `font: { size: 11 }` throughout.

---

### [UX-026] `bg-slate-50` on the app root container — not an EMOS token
**Severity:** Info
**File:** `src/App.tsx:105,135`
**Issue:** The loading spinner wrapper and the main coach layout container both use `bg-slate-50` (a Tailwind color not in the EMOS palette) as the root background. This differs from the `--color-bg-page` (#FAFAF9) token defined in `tokens.css`.
**Recommendation:** Replace `bg-slate-50` with an inline style `background: var(--color-bg-page)` or equivalent token class.

---

### [UX-027] `index.css` html background is hardcoded `#f8fafc`
**Severity:** Info
**File:** `src/index.css:9`
**Issue:** `html { background-color: #f8fafc; }` is close to but not exactly `--color-bg-page` (#FAFAF9). It also hard-codes a value that will not change when the dark theme is applied.
**Recommendation:** Change to `html { background-color: var(--color-bg-page); }`.

---

### [UX-028] Dashboard V2 cards and header sections not using EMOS tokens
**Severity:** Info
**File:** `src/components/dashboard-v2/ActivityFeed.tsx:13,14`; `src/components/dashboard-v2/AthleteGrid.tsx:40,41`; `src/components/dashboard-v2/StatsBar.tsx:87`; `src/components/dashboard-v2/DashboardV2.tsx:62`
**Issue:** Dashboard V2 components use `font-semibold text-gray-700`, `border-gray-100`, `font-bold text-gray-900` for headings and dividers. These are coherent within Tailwind but outside the EMOS token/weight system.
**Recommendation:** Migrate dashboard card headers to `style={{ fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-tertiary)' }}` for section labels, and `var(--text-body)` / weight 500 for value displays.

---

### [UX-029] ExerciseLibrary slide-in panel uses `boxShadow` on a container (not overlay)
**Severity:** Info
**File:** `src/components/exercise-library/ExerciseLibrary.tsx:1180`
**Issue:** The exercise detail slide-in panel applies `boxShadow: '-8px 0 32px rgba(0,0,0,0.10)'` to what is effectively a permanent content panel (not a transient overlay). This is a flat-design violation. A similar shadow at line 692 applies to a filter container.
**Recommendation:** Remove both shadows. For the slide-in panel, a `border-left: 0.5px solid var(--color-border-primary)` provides sufficient visual separation.

---

### [UX-030] Small confirm buttons in BodyweightPopup are below 36px tap target
**Severity:** Info
**File:** `src/components/BodyweightPopup.tsx:317,318`
**Issue:** The "Yes" / "No" delete confirmation buttons are styled `text-[10px]` with no padding declaration, resulting in a tap target well below 36px.
**Recommendation:** Add at minimum `padding: 4px 8px` and raise font size to `var(--text-caption)` (11px). Consider a dedicated confirmation popover instead of inline text buttons.

---
