# EMOS 2.0 — COMPACT PRINT CLEANUP + NEW BRANCH

First create a new branch for today's work, then fix the compact print layout.

Start with `npm run dev`. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 0: CREATE BRANCH

```bash
git checkout main
git pull
git checkout -b feature/compact-print-and-polish
```

All work goes on this branch.

---

## GROUP 1: FIX EXERCISE CODE DISPLAY

File: src/components/planner/PrintWeekCompact.tsx

### Problem
Exercise names are shown truncated ("Back S..") instead of proper codes.
The IAT format uses short numeric or alphabetic codes (1, 3, 7, 20, BS, PU).

### Fix
1. The `getExerciseCode` function should prioritize `exercise.exercise_code`.
   If exercise_code is set (e.g., "1", "3", "7", "20"), use it directly.
2. If exercise_code is null, generate a SHORT abbreviation:
   - Single word: first 3 chars → "Sna", "Pul"
   - Multi-word: initials → "BS" for Back Squat, "FS" for Front Squat,
     "PU" for Pull Ups, "PP" for Push Press, "KB" for KB Snatch
   - Max 4 characters
3. For combos: show the member codes joined with "+" truncated to fit:
   "BS+BS" not "Back Squat + Back Squat"
4. The code column width should be 45px (enough for "BS+BS" or "KB Sn")

---

## GROUP 2: FIX WEIGHT / LOAD REPRESENTATION

File: src/components/planner/PrintWeekCompact.tsx

### Problems visible in the screenshot
- Percentage exercises show "5%, 10%, 15%..." — the % suffix is correct
  but every cell gets it, which is noisy. Show % only on the FIRST cell
  of the row, then plain numbers for the rest. Or show it on ALL cells
  — match the IAT convention (no suffix, just numbers — the unit is
  implied by the exercise and shown in the summary table).
- Zero loads show as "—" which is confusing. Show "0" instead, or skip
  the cell entirely if load is 0 (just show the reps below).
- The loads and reps don't align vertically across exercises because
  flex-wrap causes different column counts per row.

### Fix
1. **Unit suffix**: Show NO suffix on individual load cells. The exercise
   code identifies the exercise, and the unit is implied. If you must
   show it, add it ONCE in the code column: "1 (%)" or "BS (kg)".
   Actually, simplest approach matching IAT: just show numbers, no suffix.
   The coach knows what unit each exercise uses.

2. **Zero loads**: When load is 0, display "—" (this is correct for combos
   where some positions have no load). But when ALL cells have load 0
   (free text exercise), don't show the grid at all.

3. **Column alignment**: Use a CSS grid with fixed columns instead of
   flex-wrap. Maximum 12 columns at 34px each = 408px. The grid should be:
   ```
   grid-template-columns: 45px repeat(var(--col-count), 34px) 1fr 40px 40px 40px;
   ```
   Where --col-count is the number of set columns for that exercise.
   The 1fr spacer pushes WH/MHG/BW to the right edge.

4. **Number formatting**: Loads should be integers (no decimals).
   Round with Math.round(). MHG in summary should also be integer.

---

## GROUP 3: FIX SETS SUPERSCRIPT

File: src/components/planner/PrintWeekCompact.tsx

### Problem
The sets superscript appears to be misplaced in some cases. Looking at
the screenshot: "5⁵ 7" on exercise 1 — the superscript should be on the
REPS value, not the LOAD value. And it should indicate how many
consecutive columns share that sets count.

### IAT convention
```
Load row:  80   85   90
Reps row:   3    3    3²

The ² means: the preceding 2 columns each have 2 sets.
Actually: the superscript IS the sets count.
3² means "3 reps × 2 sets" for the last group of columns with sets=2.
```

### Fix
1. Superscript goes ONLY on the reps row, never on the load row
2. It appears ONLY on the last cell of a consecutive group with same sets > 1
3. The number IS the sets count (not the group length)
4. Format: `{reps}<sup>{sets}</sup>` e.g., "3²" means 3 reps, 2 sets
5. Verify the `buildGridCells` function marks `showSuperscript` correctly:
   - Group consecutive cells by `.sets` value
   - For each group where sets > 1, mark ONLY the last cell
   - All other cells in the group show just the reps number

### Example from IAT PDF
```
Exercise 7:  50  55  60  65
              2   2   2   2²     ← superscript ² on last cell
                                    means all 4 cells are ×2 sets

Exercise 15: 80  85  90
              3   3   3²        ← 3 reps × 2 sets for last group

Exercise 20: 86  91  96  101  106  112  115
              4   4   4    4    4    4    4
              ← no superscript because sets=1 for all cells
              Actually wait, in the IAT PDF sets ARE shown when >1.
```

Wait, re-reading the IAT PDF more carefully:
- Exercise 7: "50 55 60 65₂ 2" → the "₂" and "2" are separate. 
  Actually: "65₂" means the last 2 columns are ×2 sets. The ₂ is the
  number of columns in the group.

NO — re-reading again. In the IAT format:
```
7  50  55  60  65
    2   2   2   2  ²  2        12  59  65
```
The "²" after the reps means "the preceding group has 2 sets each".
The "2" after "²" seems to be a frequency or different notation.

Actually the IAT PDF shows: `65₂ 2` on the load row. Looking at the
original text: `65 2 2` where the subscript 2 is attached to 65.

Let me simplify: in EMOS, use this convention:
- If a cell has sets > 1, show the sets count as a superscript on the
  REPS value: `3²` means "3 reps × 2 sets"
- Show it on EVERY cell that has sets > 1 (simpler than IAT grouping)
- This is clearer and less ambiguous

Update the code:
```tsx
// In ExerciseGridRow, reps row:
{cells.map((c, i) => (
  <div key={i} className="print-cell text-right">
    {c.reps}
    {c.sets > 1 && <sup className="text-[6px]">{c.sets}</sup>}
  </div>
))}
```

Remove the `showSuperscript` logic entirely — just show superscript
whenever sets > 1 for any cell. This is simpler and unambiguous.

---

## GROUP 4: FIX COLUMN ALIGNMENT

File: src/components/planner/PrintWeekCompact.tsx

### Problem
Load and reps values don't align vertically between different exercises
because each exercise has a different number of columns and they use
flex-wrap. The WH/MHG/BW columns on the right should always be at the
same position regardless of how many load columns exist.

### Fix
Use a table-based layout instead of flex for the exercise grid.
Each exercise row becomes a `<tr>` in a day's `<table>`:

```html
<table class="print-day-table">
  <tr><!-- exercise 1 load row --></tr>
  <tr><!-- exercise 1 reps row --></tr>
  <tr><!-- exercise 1 notes row (if any) --></tr>
  <tr><!-- exercise 2 load row --></tr>
  <tr><!-- exercise 2 reps row --></tr>
  <!-- ... -->
</table>
```

Table structure:
```
| Code (45px) | Col1 | Col2 | ... | ColN | spacer | WH | MHG | BW |
```

- First column: exercise code, rowspan=2 (spans load and reps rows)
- Middle columns: one per set-line, fixed width 34px
- Spacer: auto-width (fills remaining space)
- Last 3 columns: WH, MHG, BW (40px each, right-aligned)

For the LOAD row: code cell + load values + empty spacer + empty WH/MHG/BW
For the REPS row: load values with superscripts + spacer + WH + MHG + BW

The key advantage of a table: columns align across all exercises in a day.

Calculate the maximum number of set-line columns for the day, and use
that as the column count. Exercises with fewer columns get empty cells.

```typescript
const maxCols = Math.max(
  ...dayExs.map(ex => {
    const cells = buildGridCells(ex.prescription_raw);
    return cells.length;
  }),
  1
);
```

---

## GROUP 5: FIX COMBO DISPLAY

File: src/components/planner/PrintWeekCompact.tsx

### Problem
Combo exercises show "Back S.. + Back S.. Combo" which is too long
and truncated.

### Fix
1. Show combo as member codes joined: "BS+BS" not full names
2. The "Combo" badge is unnecessary in compact mode — the tuple reps
   (5+1, 3+1) already indicate it's a combo
3. If combo has a `combo_notation` set by the coach, use that directly
4. Member dots (●●) are fine to keep — they add visual distinction

Display format:
```
●● BS+BS    5   10   15   20   25   30   35   40
           5+1  5+1  0+1  3+1  3+1² 3+1  3+1  3+1    37  22  40
```

---

## GROUP 6: FIX SENTINEL DISPLAY

File: src/components/planner/PrintWeekCompact.tsx

### Problems
- Image URLs show as full Supabase storage URLs (very long)
- Video URLs show full URLs too

### Fix
1. **Images**: Show just "📎 Image attached" — no URL
2. **Videos**: If YouTube, show "📎 Video: YouTube" with the video ID only.
   Otherwise show "📎 Video: [domain name]" truncated.
3. **Free text**: Show as `— [text content]` with italic styling
4. All sentinel rows should NOT have WH/MHG/BW columns (leave empty)
5. Keep sentinel rows visually distinct: slightly indented, italic

```tsx
// Video
if (sentinel === 'video') {
  const url = ex.notes?.trim() || '';
  const ytId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/)?.[1];
  const display = ytId ? `YouTube (${ytId})` : new URL(url).hostname;
  return <div className="print-text-row">📎 Video: {display}</div>;
}

// Image
if (sentinel === 'image') {
  return <div className="print-text-row">📎 Image attached</div>;
}
```

---

## GROUP 7: IMPROVE DENSITY AND SPACING

File: src/components/planner/PrintWeekCompact.tsx

### Problem
The current layout is less dense than the IAT original. Too much
vertical spacing between exercises and sections.

### Fix CSS
```css
.print-exercise-block {
  margin-bottom: 1px;  /* was probably more */
}

.print-day-block {
  margin-bottom: 6px;  /* tight between days */
  page-break-inside: avoid;
}

.print-notes-row {
  font-style: italic;
  font-size: 7.5px;
  color: #444;
  padding-left: 45px;  /* align with exercise content, past code column */
  margin: 0;
  line-height: 1.3;
}

.print-day-header {
  font-weight: bold;
  font-size: 10px;
  border-top: 0.5px solid #000;
  margin-top: 4px;
  padding-top: 2px;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.print-day-name {
  font-weight: bold;
  white-space: nowrap;
}

.print-day-rule {
  flex: 1;
  border-bottom: 0.5px solid #000;
  margin: 0 4px;
}

/* Day total aligned right */
.print-day-total {
  text-align: right;
  font-size: 8px;
  color: #444;
  margin-top: 1px;
}
```

### Exercise grid rows
- Load row: line-height 1.2, margin 0
- Reps row: line-height 1.2, margin 0, margin-bottom 1px
- Notes row: line-height 1.1, margin 0
- No padding between load and reps rows

### Overall targets
- Each exercise should take ~20px vertical space (load + reps + maybe notes)
- Each day block: header + exercises + total ≈ 100-150px for 4 exercises
- 5 training days should fit in ~600-750px, leaving room for header and
  summary on a single A4 page (842px at 72dpi minus margins)

---

## GROUP 8: FIX EXERCISE SUMMARY TABLE

File: src/components/planner/PrintWeekCompact.tsx

### Problem
The exercise summary table at the top needs proper alignment.

### Fix
Use a true table (not flex divs) for the summary:

```html
<table class="print-summary-table">
  <tr>
    <td class="code">1</td>
    <td class="stat">21</td>
    <td class="stat">69</td>
    <td class="stat">76</td>
    <td class="freq">2</td>
    <td class="sep">│</td>
    <td class="code">13</td>
    <td class="stat">21</td>
    ...
  </tr>
</table>
```

- 3 "sections" of exercises side by side, separated by a thin vertical line
- Each section: Code | WH | MHG | BW | Freq
- Fixed widths: code 25px, stats 30px each, freq 15px
- Monospace font throughout
- Sort by category then by exercise code

---

## GROUP 9: ADD PERCENTAGE/UNIT INDICATOR

File: src/components/planner/PrintWeekCompact.tsx

### Problem
When an exercise uses percentage unit, the loads are relative (e.g., 80
means 80% of 1RM). The viewer needs to know which unit is in use.

### Fix
Show the unit indicator ONCE per exercise, in the code column:
```
1 (%)    80   85   90   95   100
          3    3    3    3    3²        15  90  100

BS       80   85   90   95   100
          4    4    4    3    3         24  99  115
```

- If unit is `percentage`: append ` (%)` after the code
- If unit is `absolute_kg`: show nothing (kg is default/implied)
- If unit is `rpe`: append ` RPE`
- If unit is `free_text`: show exercise name instead of code

---

## GROUP 10: PRINT QUALITY CHECK

### Test in Chrome
1. Open the print dialog for an athlete with exercises
2. Select "Compact" mode
3. Verify:
   - Exercise codes are short and readable (not truncated names)
   - Load numbers are clean integers with no unit suffix
   - Percentage exercises show (%) in the code column
   - Reps have superscript sets count where sets > 1
   - Superscripts are on the REPS row only
   - WH/MHG/BW align to the right edge across all exercises
   - Combo exercises show short codes (BS+BS) with tuple reps
   - Images show "📎 Image attached" not full URLs
   - Videos show "📎 Video: YouTube" not full URLs
   - Free text shows as indented italic
   - Day headers are clean: "Monday ————————— WH  MHG  BW"
   - Exercise summary table has aligned columns
   - Spacing is tight (IAT-level density)
   - Notes appear below exercises in smaller italic font
4. Click Ctrl+P (browser print):
   - Content fits on one A4 page (for a typical 5-day week)
   - Numbers are readable when printed
   - Borders print cleanly
   - No background colors (print-friendly)
5. Switch to "Programme" mode — verify existing layout still works
6. No console errors

Fix any issues found during testing.
