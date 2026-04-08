# EMOS 2.0 — xRM CALCULATOR TOOL

Add a standalone rep-max calculator as a floating dialog accessible
from a new "Tools" section in the sidebar. It does NOT interact with
any page data — it's a utility the coach opens, uses, then closes.

Work on the current branch. Run `npm run build` after each group.
Commit each group separately. Do not ask for confirmation.

---

## GROUP 1: ADD "TOOLS" SECTION TO SIDEBAR

File: src/components/Sidebar.tsx

Add a new navigation section at the bottom, before SYSTEM:

```
TOOLS
  ⊞ xRM Calculator
```

Clicking "xRM Calculator" does NOT navigate to a page — it opens a
floating dialog on top of whatever page the coach is currently on.

Manage the open/close state in a Zustand store so both Sidebar and
App.tsx can access it (or lift state to App.tsx with a callback).

Render the calculator at the App level, outside of routes, so it
floats above any page.

---

## GROUP 2: CALCULATOR COMPONENT

Create: src/components/tools/RepMaxCalculator.tsx

### Layout
A floating panel, not a full modal. Compact utility feel — like a
calculator app you pop open.

```tsx
<div className="fixed bottom-4 right-4 z-50 w-[380px]
     bg-white rounded-xl border border-gray-200 shadow-xl
     overflow-hidden flex flex-col">
  {/* Header */}
  <div className="flex items-center justify-between px-4 py-2.5
       border-b border-gray-100 bg-gray-50/50">
    <span className="text-sm font-medium text-gray-900">xRM Calculator</span>
    <button onClick={onClose} ...><X size={14} /></button>
  </div>

  {/* Input */}
  <div className="px-4 pt-3 pb-2">
    {/* weight + reps inputs */}
  </div>

  {/* Results table */}
  <div className="px-4 pb-4">
    {/* 1RM-10RM table */}
  </div>
</div>
```

---

## GROUP 3: INPUT SECTION

Two inputs, side by side:

```
Weight:  [______] kg     Reps:  [___]
```

- Weight: number input, step 0.5, min 0
- Reps: number input, integer, min 1, max 10

Results update instantly on every change — no calculate button.

If reps = 1, the table still renders but the 1RM row simply shows
the input weight (it IS the 1RM).

If either field is empty or 0, show a gentle placeholder:
"Enter weight and reps to see estimates"

---

## GROUP 4: RESULTS TABLE — 1RM THROUGH 10RM

### Core concept
The coach enters ONE data point (e.g., "100 kg for 5 reps").
The table shows estimated max weights for ALL rep ranges 1-10.

### Calculation
Use the average of multiple formulas to estimate the 1RM, then
derive all other rep maxes from that 1RM.

```typescript
const FORMULAS: Record<string, (w: number, r: number) => number> = {
  'Epley':      (w, r) => w * (1 + r / 30),
  'Brzycki':    (w, r) => w * (36 / (37 - r)),
  'Adams':      (w, r) => w * (1 / (1 - 0.02 * r)),
  'Baechle':    (w, r) => w * (1 + 0.033 * r),
  'Berger':     (w, r) => w * (1 / (1.0261 * Math.exp(-0.0262 * r))),
  'Brown':      (w, r) => w * (0.9849 + 0.0328 * r),
  'Landers':    (w, r) => w * (1 / (1.013 - 0.0267123 * r)),
  'Lombardi':   (w, r) => w * Math.pow(r, 0.10),
  'Mayhew':     (w, r) => w * (1 / (0.522 + 0.419 * Math.exp(-0.055 * r))),
  "O'Conner":   (w, r) => w * (1 + 0.025 * r),
  'Wathen':     (w, r) => w * (1 / (0.4880 + 0.538 * Math.exp(-0.075 * r))),
};

const REVERSE_FORMULAS: Record<string, (m: number, r: number) => number> = {
  'Epley':      (m, r) => m / (1 + r / 30),
  'Brzycki':    (m, r) => m * (37 - r) / 36,
  'Adams':      (m, r) => m * (1 - 0.02 * r),
  'Baechle':    (m, r) => m / (1 + 0.033 * r),
  'Berger':     (m, r) => m * (1.0261 * Math.exp(-0.0262 * r)),
  'Brown':      (m, r) => m / (0.9849 + 0.0328 * r),
  'Landers':    (m, r) => m * (1.013 - 0.0267123 * r),
  'Lombardi':   (m, r) => m / Math.pow(r, 0.10),
  'Mayhew':     (m, r) => m * (0.522 + 0.419 * Math.exp(-0.055 * r)),
  "O'Conner":   (m, r) => m / (1 + 0.025 * r),
  'Wathen':     (m, r) => m * (0.4880 + 0.538 * Math.exp(-0.075 * r)),
};

// Step 1: estimate 1RM as the average across all formulas
function estimateAvg1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  const estimates = Object.values(FORMULAS).map(fn => fn(weight, reps));
  return estimates.reduce((a, b) => a + b, 0) / estimates.length;
}

// Step 2: estimate weight at target reps from the avg 1RM
function estimateWeightAtReps(oneRM: number, targetReps: number): number {
  if (targetReps === 1) return oneRM;
  const reverses = Object.values(REVERSE_FORMULAS).map(fn => fn(oneRM, targetReps));
  return reverses.reduce((a, b) => a + b, 0) / reverses.length;
}
```

### Table output

Example: coach enters 100 kg × 5 reps

```
 RM      Est. weight
──────────────────────
 1RM     115 kg
 2RM     111 kg
 3RM     108 kg
 4RM     104 kg
 5RM     100 kg        ← INPUT
 6RM      97 kg
 7RM      94 kg
 8RM      91 kg
 9RM      88 kg
10RM      85 kg
```

The input row (5RM = 100 kg) is the known data point. Everything
else is estimated from it.

---

## GROUP 5: HIGHLIGHT AND UNCERTAINTY COLOR CODING

### Input row highlight
The row matching the input reps gets a distinct treatment:
- Blue left border (3px)
- Blue-tinted background (bg-blue-50)
- The weight value shows the EXACT input weight (not re-estimated)
- Small "input" label next to the value

### Uncertainty color coding
Estimation accuracy degrades the further you get from the input.
A 4RM estimate from a 5RM input is very reliable (±1 rep).
A 1RM estimate from a 10RM input is a rough guess (±9 reps).

Color each row by distance from the input rep count:

```typescript
function getConfidence(
  inputReps: number, targetReps: number
): 'exact' | 'high' | 'good' | 'moderate' | 'low' {
  if (targetReps === inputReps) return 'exact';
  const distance = Math.abs(targetReps - inputReps);
  if (distance <= 1) return 'high';
  if (distance <= 2) return 'good';
  if (distance <= 4) return 'moderate';
  return 'low';
}
```

### Confidence bar
Each row gets a small horizontal bar (40px max width) showing
confidence. The bar shrinks and changes color with distance:

```
 1RM  115 kg  ████░░░░  moderate (4 away from input 5)
 2RM  111 kg  ██████░░  good     (3 away)
 3RM  108 kg  ████████  good     (2 away)
 4RM  104 kg  █████████ high     (1 away)
 5RM  100 kg  ██████████ exact   INPUT
 6RM   97 kg  █████████ high     (1 away)
 7RM   94 kg  ████████  good     (2 away)
 8RM   91 kg  ██████░░  good     (3 away)
 9RM   88 kg  ████░░░░  moderate (4 away)
10RM   85 kg  ██░░░░░░  low      (5 away)
```

### Visual mapping
```typescript
const barConfig = {
  exact:    { color: 'bg-blue-500',  width: 'w-full',  text: '' },
  high:     { color: 'bg-teal-500',  width: 'w-[90%]', text: '' },
  good:     { color: 'bg-teal-400',  width: 'w-[70%]', text: '' },
  moderate: { color: 'bg-amber-400', width: 'w-[45%]', text: '' },
  low:      { color: 'bg-gray-300',  width: 'w-[20%]', text: '' },
};
```

Text treatment per confidence level:
- exact: font-medium, text-gray-900
- high: font-medium, text-gray-900
- good: text-gray-700
- moderate: text-gray-500
- low: text-gray-400, italic

---

## GROUP 6: NUMBER FORMATTING AND EDGE CASES

### Rounding
Round all estimated weights to nearest 1 kg. Display as integers.

### Edge cases
- Reps = 1: 1RM row is the input. Rows 2-10RM estimated downward.
  The 1RM confidence bar is full blue, everything else fans out.
- Reps = 10: 10RM row is the input. 1RM estimated (least reliable,
  gray bar, muted text). This correctly shows the coach that
  estimating a 1RM from a 10RM is unreliable.
- Empty input: show placeholder text, no table.

### What NOT to show
- No individual formula breakdown (average only — keeps it clean)
- No percentage table (coach can do that math)
- No mode toggle (the single table does everything)
- No reps above 10 (irrelevant for Olympic weightlifting)

---

## GROUP 7: KEYBOARD AND UX

### Keyboard
- Esc → close the calculator
- Tab → move between weight and reps inputs

### Floating behavior
- Opens in bottom-right corner
- Page behind is still fully interactive
- Stays open when navigating between pages
- Stays open when other dialogs are opened
- Does NOT close on outside click (only X button or Esc)
- Opens fresh each time (no saved state between opens)

### Visual design
- Monospace font for all numbers (font-mono)
- Subtle alternating row tint for readability
- Input row stands out clearly with blue treatment
- Compact — no wasted space, this is a utility

---

## GROUP 8: WIRE INTO APP

File: src/App.tsx

Render at the top level, outside routes:
```tsx
{showRepMaxCalc && (
  <RepMaxCalculator onClose={() => setShowRepMaxCalc(false)} />
)}
```

File: src/components/Sidebar.tsx

TOOLS section with Calculator icon from lucide-react:
```tsx
<div className="...section-header">TOOLS</div>
<button onClick={() => openCalc()} className="...nav-item">
  <Calculator size={18} />
  xRM Calculator
</button>
```

---

## GROUP 9: TESTING

1. Click "xRM Calculator" in sidebar → panel appears bottom-right
2. Enter 100 kg, 5 reps → table shows 1RM through 10RM
3. 5RM row highlighted blue with "input" label, shows exactly 100 kg
4. 4RM and 6RM rows have tall green confidence bars (high)
5. 3RM and 7RM rows have medium green bars (good)
6. 1RM and 2RM rows have short amber/gray bars (moderate/low)
7. 10RM row has shortest gray bar (low)
8. Text gets progressively muted toward the edges
9. Change reps to 3 → 3RM row now highlighted, bars redistribute
10. Change reps to 1 → 1RM row highlighted (exact input), rest fan down
11. Change reps to 10 → 10RM highlighted, 1RM has tiny gray bar (very unreliable)
12. Clear weight → placeholder, no table
13. Navigate to another page → calculator stays open
14. Press Esc → closes
15. Reopen → empty inputs
16. Open a day editor dialog → calculator still visible on top
17. No console errors

Fix any issues found.
