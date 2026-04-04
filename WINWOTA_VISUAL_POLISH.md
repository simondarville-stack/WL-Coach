# WINWOTA 2.0 — VISUAL POLISH & DIALOG MODE SETTING

This prompt fixes the "prototype feel" of the app. The app works functionally
but lacks visual hierarchy, density control, and interaction feedback.
These changes are purely visual/UX — no new features, no data model changes.

Start with `npm run dev`. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 1: DIALOG MODE SETTING

### 1a. Database migration (create file only — do NOT run)

Create: `supabase/migrations/20260404_dialog_mode.sql`

```sql
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS dialog_mode text DEFAULT 'center'
  CHECK (dialog_mode IN ('center', 'sidebar'));
```

### 1b. Update types

File: src/lib/database.types.ts

Add to GeneralSettings interface:
```typescript
dialog_mode: 'center' | 'sidebar';
```

### 1c. Add setting to GeneralSettings page

File: src/components/GeneralSettings.tsx

Add a new section "Layout preferences" with a toggle between two options:
- "Centered dialog" (default) — dialogs open as centered overlays
- "Side panel" — dialogs slide in from the right

Use two radio-style cards (not a dropdown). Each card shows:
- A small visual preview (tiny rectangles showing layout)
- Label: "Centered dialog" / "Side panel"
- Active card gets border-blue-500 bg-blue-50

Save immediately on click via updateSettings.

### 1d. Use dialog_mode in WeeklyPlanner

File: src/components/planner/WeeklyPlanner.tsx

Read `settings?.dialog_mode` (default 'center').

When dialog_mode === 'center':
```
<div className="fixed inset-0 z-50 flex items-center justify-center p-6">
  <div className="absolute inset-0 bg-black/20" .../>
  <div className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-white rounded-xl
       border border-gray-200 shadow-lg overflow-y-auto">
```

When dialog_mode === 'sidebar':
```
<div className="fixed inset-0 z-50 flex items-start justify-end">
  <div className="absolute inset-0 bg-black/15" .../>
  <div className="relative z-10 w-full max-w-lg h-full bg-white shadow-xl
       border-l border-gray-200 overflow-y-auto">
```

Apply to BOTH DayEditor and ExerciseDetail dialog wrappers.
Add a CSS transition: the sidebar should slide in from the right
(translate-x-full → translate-x-0, transition duration-200).
The centered dialog should scale up (scale-95 opacity-0 → scale-100 opacity-100).

### 1e. Use dialog_mode in other dialogs too

Any modal/dialog across the app that uses a centered overlay pattern
should respect this setting. Check:
- Calendar event detail modal
- Combo creator modal
- Print modal
- Copy/paste modal

For these smaller modals, always use centered regardless of setting
(only DayEditor and ExerciseDetail are large enough for sidebar mode).

---

## GROUP 2: COLLAPSE THE CONTROL PANEL

### Problem
The control panel (PlannerControlPanel) is ~250px tall and pushes day cards
below the fold. Coaches spend 90% of time in day cards.

### Fix
File: src/components/planner/PlannerControlPanel.tsx

Restructure into a SINGLE compact toolbar (~70px total):

**Row 1 (main toolbar, ~44px):**
```
[Avatar 32px] [Name + "32yr · 99kg"] ... [← Last week] [30/03 - 05/04] [Next week →] ... [Days] [Copy] [Paste] [Print] [Charts]
```

- Left zone: athlete avatar + name (compact, inline)
- Center zone: week date range, "Week 1 of 1" below in text-xs
- Right zone: icon buttons in a tight row with 1px dividers between groups

**Row 2 (metrics strip, ~28px):**
```
S 39  ·  R 118 / 300 (39%)  ·  T 285 kg  ·  [▸ Categories]  ·  Macro: DM Hold W1 — Medium
```

- All inline text, no boxed cards
- Compliance colored: green ≥90%, amber ≥70%, red <70%
- Macro info as a subtle badge at the end
- "Categories" toggles a collapsible section below
- Week description as an editable inline input below this row

**Macro timeline (conditional, only if macro exists, ~20px):**
- Thin horizontal bar showing phase segments
- Phase name labels inside segments
- Small marker showing current week position
- If no macro, this row is hidden entirely

Total height: 70-90px instead of 250px.

### Key CSS
```css
/* Toolbar row */
display: flex; align-items: center; justify-content: space-between;
padding: 8px 16px; border-bottom: 0.5px solid border-gray-100;

/* Metrics strip */
display: flex; align-items: center; gap: 16px;
padding: 4px 16px; font-size: 12px; color: text-gray-500;
border-bottom: 0.5px solid border-gray-100;

/* Macro bar */
height: 16px; display: flex; font-size: 9px;
```

---

## GROUP 3: DAY CARD VISUAL HIERARCHY

File: src/components/planner/DayCard.tsx

### Card container
```
bg-white rounded-lg border border-gray-200 hover:border-gray-300
hover:shadow-sm transition-all duration-150
```

### Header (clickable → opens day editor)
```
cursor-pointer px-3 py-2 flex justify-between items-center
border-b border-gray-100 hover:bg-gray-50 transition-colors
```
- Day name: text-sm font-medium text-gray-900
- S/R badges: text-xs text-gray-400 with values in text-gray-700 font-medium

### Exercise rows
Each exercise is a micro-row with clear boundaries:
```
px-3 py-1.5 border-b border-gray-50 last:border-b-0
hover:bg-gray-50 cursor-pointer transition-colors
```
- 3px left border using exercise color (border-radius: 0)
- Exercise name: text-xs font-medium text-gray-900 truncate
- Variation/notes: text-[10px] text-gray-400 italic
- Combo badge: text-[9px] bg-blue-50 text-blue-700 rounded px-1.5

### Stacked notation (grid preview)
```
font-mono text-[10px]
```
- Load value: text-gray-900 font-medium (12px if space allows)
- Divider: border-t border-gray-300 (clearly visible)
- Reps value: text-gray-500 font-medium
- Sets superscript: text-[9px] text-gray-400, only when > 1
- Columns: gap-2 between
- Overall: the loads tell the story, reps are supporting

### Empty day state
When a day has no exercises:
```
text-center py-6 text-xs text-gray-300 italic
```
Show "Rest day" or "No exercises planned" — don't show a tall empty card.
Reduce min-height for empty days to min-h-[120px].

### Search input at bottom
```
px-3 pb-2 pt-1
input: text-xs border-0 border-b border-transparent
  hover:border-gray-200 focus:border-blue-300
  placeholder-gray-300 bg-transparent
  placeholder: "+ Add exercise..."
```

### Sentinel exercises (TEXT / VIDEO / IMAGE)
- Free text: no left border, italic text-gray-500, no grid
- Video: small icon + "Video" label + thumbnail (if YouTube)
- Image: small icon + thumbnail
- These should look distinctly different from regular exercises

---

## GROUP 4: TYPOGRAPHY SCALE

Apply consistently across ALL planner components:

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Page title ("Weekly planner") | 16px | 500 | gray-900 |
| Day name in card header | 14px | 500 | gray-900 |
| Exercise name | 12px | 500 | gray-900 |
| Variation note | 11px | 400 | gray-400 italic |
| Coach notes below exercise | 11px | 400 | gray-400 italic |
| Grid load numbers | 11px | 500 | gray-900 font-mono |
| Grid reps numbers | 10px | 500 | gray-500 font-mono |
| Grid sets superscript | 9px | 500 | gray-400 font-mono |
| S/R totals in header | 11px | 500 | gray-700 (labels gray-400) |
| Metric values in toolbar | 13px | 500 | gray-900 |
| Metric labels in toolbar | 10px | 500 | gray-400 uppercase |
| Combo badge | 9px | 500 | blue-700 on blue-50 |
| "+ Add exercise" placeholder | 11px | 400 | gray-300 |

Remove ALL instances of font-semibold (600) and font-bold (700).
Replace with font-medium (500). The only exception: the app name
"WinWota 2.0" in the sidebar can stay bold.

---

## GROUP 5: DEPTH AND LAYERING

### Page backgrounds
File: src/App.tsx or the layout wrapper

- Page background: bg-slate-50 (slightly cool, not pure gray)
- Control panel: bg-white, flush with content (no card wrapper needed),
  border-b border-gray-200 at bottom
- Day cards: bg-white with border — these "float" on the slate background
- Dialogs: bg-white with shadow-lg (not shadow-xl)

### Remove unnecessary card wrappers
The control panel currently sits inside a bg-white rounded-lg border card.
Remove the card wrapper — let the control panel be flush with the top of
the content area, separated only by a bottom border. This removes one
layer of nesting and makes it feel like a toolbar, not a separate widget.

### Day card hover state
```css
.day-card {
  transition: border-color 150ms, box-shadow 150ms;
}
.day-card:hover {
  border-color: #d1d5db; /* gray-300 */
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
```

---

## GROUP 6: INTERACTION FEEDBACK

### Day card header
- cursor-pointer on the header row (click opens day editor)
- hover:bg-gray-50 on the header
- Small chevron-right icon (12px, text-gray-300) appears on hover
  at the right side of the header — indicates "click to open"

### Exercise rows in day card
- cursor-pointer (click opens exercise detail)
- hover:bg-gray-50 with transition
- The left color border gets slightly wider on hover (3px → 4px)

### Toolbar buttons
- Icon-only buttons: p-1.5 rounded hover:bg-gray-100
- Active toggle (Charts): bg-blue-50 text-blue-600
- Copied state (Copy): bg-green-50 text-green-600 briefly

### Grid cells (in DayEditor)
- hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 on each cell
- active:bg-blue-100 on click
- Shift-held state: bg-red-50 text-red-600
- After clicking: brief flash of bg-green-50 for 200ms

---

## GROUP 7: SIDEBAR POLISH

File: src/components/Sidebar.tsx

### Section headers
```
text-[10px] font-medium uppercase tracking-widest text-gray-400
px-4 py-1 mt-4 mb-1
```

### Navigation items
```
flex items-center gap-3 px-4 py-2 text-sm rounded-lg mx-2
transition-colors duration-100
```
- Default: text-gray-600 hover:bg-gray-100 hover:text-gray-900
- Active: bg-blue-50 text-blue-700 font-medium
- Icon: 18px, same color as text

### App branding
- "WinWota 2.0" in top left: text-base font-medium text-gray-900
- Small icon/logo next to it (the existing one is fine)
- Bottom of sidebar: subtle "v2.0" version text in text-[10px] text-gray-300

---

## GROUP 8: CONSISTENT SPACING

Apply everywhere:

| Context | Spacing |
|---------|---------|
| Between day cards | gap-3 (12px) |
| Inside day cards | px-3 py-2 header, px-3 py-1.5 exercise rows |
| Between exercises | 0 (border-b handles separation) |
| Grid columns | gap-1.5 (6px) |
| Grid load-to-reps | 1px border (the divider line) |
| Toolbar sections | gap-2 between buttons, 8px divider gap |
| Metrics strip items | gap-4 (16px) with · dot separators |
| Page padding | p-4 md:p-5 |
| Max content width | max-w-[1600px] mx-auto |

Remove any padding > 24px inside components (p-6 → p-4, p-8 → p-4).
The app should feel tight and dense, not spread out.

---

## GROUP 9: EMPTY AND LOADING STATES

### Loading spinner (reusable)
Create: src/components/ui/Spinner.tsx
```tsx
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500"
      style={{ width: size, height: size }}
    />
  );
}
```

Replace ALL "Loading..." text across the app with this spinner centered
in the container.

### Empty states
When no data exists, show a helpful message:
- No exercises in a day: "Rest day" (centered, text-gray-300, italic)
- No athlete selected: centered icon + "Select an athlete to start"
- No macrocycle: hide macro bar entirely (no error, no placeholder)
- No events in calendar: "No upcoming events" with + button
- Empty roster: "Add your first athlete" with link to add form

---

## GROUP 10: MICRO-ANIMATIONS

### Dialog open/close
File: tailwind.config.js (or inline styles)

Add subtle enter animations:
```css
@keyframes dialog-enter {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes sidebar-enter {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes backdrop-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Apply:
- Centered dialog content: animate-dialog-enter (duration 150ms)
- Sidebar panel: animate-sidebar-enter (duration 200ms)
- Backdrop: animate-backdrop-enter (duration 150ms)

### Exercise row transitions
- Adding an exercise: the new row fades in (opacity 0→1, 150ms)
- Deleting (shift+click): the row collapses (height → 0, opacity → 0, 200ms)

### Metric value changes
When S/R/T values update, briefly pulse the number:
```css
@keyframes pulse-value {
  0% { color: inherit; }
  50% { color: #378ADD; }
  100% { color: inherit; }
}
```

---

## GROUP 11: PAGE HEADER CONSISTENCY

Every page should have the same header pattern:

```
<div className="flex items-center justify-between mb-4">
  <h1 className="text-base font-medium text-gray-900">{pageTitle}</h1>
  {/* action buttons on the right if any */}
</div>
```

- NOT text-2xl font-bold (too heavy)
- text-base (16px) font-medium (500) is enough
- The sidebar already tells you what page you're on
- The "Weekly planner" text at the top of the planner page can be removed
  entirely — the sidebar active state is sufficient, and it saves 40px

Check and fix: Dashboard, Roster, Training Groups, Exercise Library,
Calendar, Analysis, Settings, Macro Cycles, Training Log.

---

## GROUP 12: FINAL TESTING

Open Chrome and verify:

1. Settings page → "Layout preferences" section visible
2. Toggle between "Centered dialog" and "Side panel" → saves
3. Weekly planner → control panel is compact (~70-90px tall)
4. Day cards visible without scrolling
5. Day card hover → subtle border/shadow change
6. Click day header → dialog opens in selected mode (center or sidebar)
7. Exercise rows hover → bg-gray-50 highlight
8. Grid numbers: loads dark, reps lighter, divider visible
9. Empty days show "Rest day" with reduced height
10. Typography: no bold (700) text anywhere except app name
11. Sidebar: active state blue, hover gray, section headers uppercase
12. Page backgrounds: slate-50 behind white cards
13. Loading states: spinner instead of text
14. Smooth dialog enter animation
15. All pages have consistent header pattern
16. No console errors

Fix any issues found.
