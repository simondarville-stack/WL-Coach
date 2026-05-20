# DEFERRED — items skipped during implementation

Items here were skipped because they were ambiguous or out of scope of what
the plan explicitly authorized. They are candidates for a future review cycle.

---

## C2 — getDeltaChipClass in SessionPreview.tsx

**Finding reference:** UF-28 / E-10 (getDeltaChipClass consolidation)

**Interpretation A (skipped):** Replace the inline delta-chip ternary in
`SessionPreview.tsx` with `getDeltaChipClass()` from `trainingLogModel.ts`.

**Reason deferred:** The `SessionPreview` chip uses dark-surface colour tokens
(`bg-emerald-900/40 text-emerald-300`, `bg-amber-900/40 text-amber-300`,
`bg-red-900/40 text-red-300`) because it renders on the athlete's dark theme.
The exported `getDeltaChipClass()` returns light-surface tokens
(`bg-emerald-100 text-emerald-800` etc.). Replacing them would change the
visual on the dark surface. The plan's intent may be to add a `dark` parameter
or a second helper. Without explicit authorization, no change was made.

---

## C2 — deltaClass() in LogWeekOverview.tsx

**Finding reference:** UF-28 / E-10 (delta colour extraction)

**Interpretation:** The local `deltaClass(p: number | null): string` function
in `LogWeekOverview.tsx` returns text-only colour classes (`text-emerald-700`
etc.) based on a raw ratio, not a `DeltaState`. It is structurally different
from both `getDeltaBorderClass` (border-left colours from DeltaState) and
`getDeltaChipClass` (chip bg+text from DeltaState). The plan does not
explicitly cover this third variant. Left in place.

---
