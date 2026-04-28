# EMOS — PROMPT 4B: LAYOUT REFINEMENT + CATEGORY MODAL MIGRATION

Visual tuning pass for the Exercise Library, based on review of the
first migration. This prompt does three things:

1. Updates `<StandardPage>` to use symmetric padding instead of a
   fixed max-width, and to behave differently when a side panel is open
2. Fixes small visual issues spotted in review (column header size,
   current-row highlight, empty code cells, section header weight)
3. Migrates the `CategoryManagerModal` (embedded in ExerciseLibrary.tsx)
   to use design system primitives

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with message:
`refactor(exercise-library): layout tuning + category modal migration`.

---

## STEP 1: UPDATE `<StandardPage>` PRIMITIVE

Edit `src/components/ui/StandardPage.tsx`. Replace the entire file
with:

```tsx
import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
  /**
   * When true, the work surface becomes edge-to-edge with no border/radius.
   * Use when a side panel is open — the panel becomes the dominant surface
   * and the underlying list recedes to background.
   * Defaults to false (framed card treatment).
   */
  hasSidePanel?: boolean;
}

/**
 * Framing A — standard content page.
 *
 * Used for: macro detail, exercise library, athlete list, settings.
 *
 * Default (framed):
 * - Off-white page background (--color-bg-page)
 * - White work surface card with hairline border and 8px radius
 * - Symmetric 24px vertical, 48px horizontal padding from viewport edges
 * - Work surface fills available width (no max-width cap)
 *
 * When hasSidePanel=true (edge-to-edge):
 * - Same off-white page background
 * - No border, no radius, no horizontal padding — list goes to the viewport edge
 * - Keeps 24px top/bottom padding for breathing room from chrome
 * - Signals that the panel is the dominant focus; this list is background
 */
export function StandardPage({ children, hasSidePanel = false }: StandardPageProps) {
  return (
    <div
      style={{
        background: 'var(--color-bg-page)',
        minHeight: '100%',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div
        style={{
          padding: hasSidePanel
            ? 'var(--space-xl) 0'
            : 'var(--space-xl) 48px',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: hasSidePanel
              ? 'none'
              : '0.5px solid var(--color-border-tertiary)',
            borderRadius: hasSidePanel
              ? 0
              : 'var(--radius-lg)',
            minHeight: 'calc(100% - 2px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
```

**Key changes:**
- Removed `max-width: 1400px` — work surface now fills available space
- Horizontal padding is `48px` in framed mode (generous air)
- Vertical padding is `24px` in both modes
- New `hasSidePanel` prop for the edge-to-edge variant
- When `hasSidePanel` is true: no horizontal padding, no border, no radius — the list becomes background context

Run `npm run build`. Must pass.

---

## STEP 2: WIRE `hasSidePanel` IN `ExerciseLibrary`

Edit `src/components/exercise-library/ExerciseLibrary.tsx`.

Find the return statement (around line 795) which currently reads:
```tsx
return (
  <StandardPage>
    {/* Toolbar */}
    ...
```

Update to pass the `hasSidePanel` prop based on whether an exercise
is selected:

```tsx
return (
  <StandardPage hasSidePanel={selectedExerciseId !== null}>
    {/* Toolbar */}
    ...
```

That's the only change needed. The `selectedExerciseId` state already
exists and flips correctly when the user selects or deselects an
exercise row.

Run `npm run build`. Visit `/library` to visually verify:
1. No exercise selected → framed white card treatment as before
2. Click an exercise → panel slides in, and the work surface becomes
   edge-to-edge with no border

---

## STEP 3: FIX LIST VIEW COLUMN HEADERS

Find the `ListViewHeader` function in ExerciseLibrary.tsx.

Current typography uses `text-label` (13px). The design system calls
for column headers at `text-caption` (11px), regular 400 weight,
in `--color-text-secondary`.

Also remove the Category column since rows are already grouped under
category section headers (redundancy).

Replace the entire `ListViewHeader` function with:

```tsx
function ListViewHeader() {
  const cell: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-caption)',
    fontWeight: 400,
    color: 'var(--color-text-secondary)',
    letterSpacing: '0',
    textTransform: 'none',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px',
        gap: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-lg)',
        borderBottom: '0.5px solid var(--color-border-secondary)',
        position: 'sticky',
        top: 0,
        background: 'var(--color-bg-primary)',
        zIndex: 2,
      }}
    >
      <div style={cell}>Code</div>
      <div style={cell}></div>
      <div style={cell}>Name</div>
      <div style={cell}>Unit</div>
      <div style={{ ...cell, textAlign: 'right' }}>PR</div>
    </div>
  );
}
```

**Changes:**
- Font size drops from 13px to 11px
- Explicitly sets `letterSpacing: 0` and `textTransform: 'none'` in
  case anything higher up tried to uppercase the text
- Removes the trailing 120px column (was for Category)
- Grid is now 5 columns, not 6

Update `ExerciseListRow` to match the 5-column grid. Find the
`gridTemplateColumns` in `ExerciseListRow` and change it from:
```tsx
gridTemplateColumns: '60px 56px 1fr 60px 80px 120px',
```
to:
```tsx
gridTemplateColumns: '60px 56px 1fr 60px 80px',
```

And remove the trailing empty `<div />` at the end of the row markup
(the spacer for the removed column).

Run `npm run build`. Visit `/library`, switch to list view, verify:
1. Column headers are smaller (11px) and not bold
2. No "Category" column on the right
3. Rows align with the new header

---

## STEP 4: FIX CURRENT-ROW HIGHLIGHT

In `ExerciseListRow`, find the style block. The intent is:
- Selected row: `info-bg` background + 2px accent left border
- Not selected row: transparent background + 2px transparent left border

Review the current implementation. If the 2px accent border isn't
showing clearly (it's meant to be `var(--color-accent)` = ink blue),
check that:

1. `borderLeft` uses `2px solid var(--color-accent)` (not
   `--color-border-primary` or similar)
2. The transparent border is `2px solid transparent` (so the row
   doesn't jump when the border appears)
3. The selected background is `var(--color-info-bg)`
4. The selected row overrides the alternating tint (if row is
   selected, use info-bg regardless of odd/even)

The final block should look like:

```tsx
<div
  onClick={onClick}
  style={{
    display: 'grid',
    gridTemplateColumns: '60px 56px 1fr 60px 80px',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: '8px var(--space-lg)',
    background: isSelected
      ? 'var(--color-info-bg)'
      : 'transparent',
    borderLeft: isSelected
      ? '2px solid var(--color-accent)'
      : '2px solid transparent',
    borderBottom: '0.5px solid var(--color-border-tertiary)',
    cursor: 'pointer',
    transition: 'background 100ms ease-out',
    fontSize: 'var(--text-label)',
  }}
  onMouseEnter={e => {
    if (!isSelected) e.currentTarget.style.background = 'var(--color-bg-secondary)';
  }}
  onMouseLeave={e => {
    if (!isSelected) e.currentTarget.style.background = 'transparent';
  }}
>
  ...
</div>
```

(Note: I've also removed the zebra stripe logic since the existing
commit history shows it was reverted. Rows now have clean transparent
background with hover tint.)

Remove the `rowIndex` parameter from `ExerciseListRow` if it's no
longer used.

Run `npm run build`. Verify:
1. Selected row shows 2px ink-blue left border clearly
2. Selected row background is subtly blue-tinted (info-bg)
3. No zebra stripe — clean alternating-free look

---

## STEP 5: HIDE EMPTY EXERCISE CODES

In `ExerciseListRow`, find the code cell:

```tsx
<span
  style={{
    fontFamily: 'var(--font-mono)',
    ...
  }}
>
  {exercise.exercise_code || '—'}
</span>
```

The `—` placeholder is visually noisy when most exercises don't have
codes. Replace with an empty string (keeps the cell width intact for
alignment, but no dash):

```tsx
<span
  style={{
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-label)',
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }}
>
  {exercise.exercise_code || ''}
</span>
```

The column width reservation (60px in the grid) still keeps rows
aligned. Codes simply don't render if absent.

Do the same in `ExerciseCard` (grid view): if `exercise.exercise_code`
is empty, fall back to `exercise.name` as the primary label (as is
already done), and don't render a separate placeholder.

Run `npm run build`. Verify: exercises without codes just show blank
space in the code column, not `—`.

---

## STEP 6: VERIFY SECTION HEADER WEIGHT

Find the `CategorySectionHeader` function. Locate the category name
span:

```tsx
<span
  style={{
    fontSize: 'var(--text-label)',
    fontWeight: 500,
    ...
  }}
>
  {category.name}
</span>
```

Confirm `fontWeight: 500` is set. If the header still looks heavier
than expected, the cause is likely:

1. A parent `<strong>` or `<b>` tag — remove if present
2. An inherited `font-weight` from Tailwind classes — check for
   `font-bold` or `font-semibold` on any ancestor
3. The default browser styling for `<span>` inside certain contexts

If any parent element has Tailwind's `font-bold` or `font-semibold`,
remove it. The section header should be weight 500 only.

No change required if it's already correct. Just verify visually on
`/library` — the section labels like "K2: DKØ" should feel "medium"
not "bold."

---

## STEP 7: MIGRATE `CategoryManagerModal`

The `CategoryManagerModal` component lives inside
`src/components/exercise-library/ExerciseLibrary.tsx`, roughly lines
171-383. It's currently the largest remaining source of visual drift
in this file (shadows, bright blue, hardcoded gray classes, arbitrary
font sizes).

Replace the entire `CategoryManagerModal` function with a version that
uses primitives. Import additions at the top of the file:

```tsx
import {
  StandardPage, Button, Input, Badge, ColorDot, Modal,
} from '../ui';
```

Then replace `CategoryManagerModal` (keep its props interface as-is;
only the return JSX changes):

```tsx
function CategoryManagerModal({
  categories,
  exercises,
  onClose,
  onRename,
  onRecolor,
  onReorder,
  onAdd,
  onDelete,
}: CategoryManagerModalProps) {
  // Existing state (keep as-is)
  const sorted = [...categories].sort((a, b) => a.display_order - b.display_order);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0]);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const exerciseCounts = new Map<string, number>();
  for (const cat of sorted) {
    exerciseCounts.set(cat.id, exercises.filter(e => (e.category as unknown as string) === cat.name).length);
  }

  function openColorPicker(e: React.MouseEvent, id: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setColorPickerPos({ x: rect.left, y: rect.bottom + 4, targetId: id });
  }

  function openNewColorPicker(e: React.MouseEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setColorPickerPos({ x: rect.left, y: rect.top - 140, targetId: null });
  }

  return (
    <>
      <Modal
        isOpen={true}
        onClose={onClose}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Layers size={14} style={{ color: 'var(--color-text-secondary)' }} />
            <span>Manage categories</span>
            <span
              style={{
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                fontWeight: 400,
                marginLeft: 'var(--space-xs)',
              }}
            >
              Drag to reorder
            </span>
          </span>
        }
        size="md"
        footer={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)',
              width: '100%',
            }}
          >
            <button
              onClick={openNewColorPicker}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--radius-sm)',
                border: '0.5px solid var(--color-border-secondary)',
                background: newColor,
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
              title="Pick color"
            />
            <Input
              placeholder="New category name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newName.trim()) {
                  onAdd(newName.trim(), newColor);
                  setNewName('');
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Check size={12} />}
              disabled={!newName.trim()}
              onClick={() => {
                if (newName.trim()) {
                  onAdd(newName.trim(), newColor);
                  setNewName('');
                }
              }}
            >
              Add
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {sorted.map((cat, idx) => {
            const count = exerciseCounts.get(cat.id) ?? 0;
            const isEditing = editingId === cat.id;
            const isConfirming = confirmDeleteId === cat.id;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;

            return (
              <div
                key={cat.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragEnter={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={async () => {
                  if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                    await onReorder(dragIdx, dragOverIdx);
                  }
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                className="group"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-sm)',
                  padding: '8px var(--space-sm)',
                  borderRadius: 'var(--radius-md)',
                  background: isDragOver ? 'var(--color-info-bg)' : 'transparent',
                  border: isDragOver
                    ? '0.5px solid var(--color-info-border)'
                    : '0.5px solid transparent',
                  opacity: dragIdx === idx ? 0.4 : 1,
                  transition: 'background 100ms ease-out',
                }}
                onMouseEnter={e => {
                  if (!isDragOver) e.currentTarget.style.background = 'var(--color-bg-secondary)';
                }}
                onMouseLeave={e => {
                  if (!isDragOver) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Drag handle */}
                <GripVertical
                  size={13}
                  style={{
                    color: 'var(--color-text-tertiary)',
                    cursor: 'grab',
                    flexShrink: 0,
                  }}
                />

                {/* Color swatch — button to open picker */}
                <button
                  onClick={(e) => openColorPicker(e, cat.id)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: 'var(--radius-sm)',
                    border: '0.5px solid var(--color-border-secondary)',
                    background: cat.color ?? 'var(--color-gray-400)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    padding: 0,
                    transition: 'transform 100ms ease-out',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  title="Change color"
                />

                {/* Name */}
                {isEditing ? (
                  <Input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onRename(cat.id, editName); setEditingId(null); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => { if (editName.trim()) onRename(cat.id, editName); setEditingId(null); }}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditName(cat.name); setEditingId(cat.id); }}
                    style={{
                      flex: 1,
                      fontSize: 'var(--text-body)',
                      color: 'var(--color-text-primary)',
                      cursor: 'text',
                    }}
                  >
                    {cat.name}
                  </span>
                )}

                {/* Count */}
                <span
                  style={{
                    fontSize: 'var(--text-caption)',
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    width: '24px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count}
                </span>

                {/* Delete */}
                {isConfirming ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 'var(--text-caption)',
                        color: 'var(--color-warning-text)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {count > 0 ? `Move ${count} to Unspecified?` : 'Delete?'}
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={async () => {
                        try { await onDelete(cat.id); } catch {}
                        setConfirmDeleteId(null);
                      }}
                    >
                      Yes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      No
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(cat.id)}
                    title="Delete category"
                    style={{
                      padding: '2px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      opacity: 0,
                      transition: 'opacity 100ms ease-out, color 100ms ease-out',
                      flexShrink: 0,
                      display: 'flex',
                    }}
                    className="group-hover:opacity-100"
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger-text)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Color picker popover — unchanged, still fixed-positioned */}
      {colorPickerPos && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 190,
            }}
            onClick={() => setColorPickerPos(null)}
          />
          <div
            style={{
              position: 'fixed',
              left: colorPickerPos.x,
              top: colorPickerPos.y,
              background: 'var(--color-bg-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-sm)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              width: '132px',
              zIndex: 200,
            }}
          >
            {PRESET_COLORS.map(color => {
              const isActive = colorPickerPos.targetId
                ? categories.find(c => c.id === colorPickerPos.targetId)?.color === color
                : newColor === color;
              return (
                <button
                  key={color}
                  onClick={() => {
                    if (colorPickerPos.targetId) {
                      onRecolor(colorPickerPos.targetId, color);
                    } else {
                      setNewColor(color);
                    }
                    setColorPickerPos(null);
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: 'var(--radius-sm)',
                    border: isActive
                      ? '2px solid var(--color-text-primary)'
                      : '2px solid transparent',
                    background: color,
                    cursor: 'pointer',
                    transition: 'transform 100ms ease-out',
                    padding: 0,
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
```

**Changes:**
- Wrapped in `<Modal>` primitive (provides backdrop, escape-to-close, radius, border)
- Header uses the `title` prop of Modal, with Layers icon inline
- Footer (add-category row) uses the `footer` prop of Modal — sticks to bottom
- All `text-[10px]` and similar arbitrary sizes replaced with token sizes
- Hardcoded `bg-blue-50 border-blue-200` drag-over states use `info-bg/info-border` tokens
- `bg-gray-50` hover backgrounds use `bg-secondary` tokens
- All buttons use `<Button>` primitive with appropriate variants
- The `<input>` for name editing and new-category input use `<Input>` primitive
- Color picker popover uses tokens but retains its fixed-position behavior (that's correct — it must be able to appear outside the modal bounds)

Run `npm run build`. Must pass.

---

## STEP 8: VERIFY EVERYTHING

Navigate to `/library` and verify:

1. ✅ No exercise selected: framed white work surface with hairline border, 48px air on left/right from sidebar
2. ✅ Click an exercise: work surface becomes edge-to-edge (no border, no radius), panel slides in from right
3. ✅ Click the same exercise again (or close panel): back to framed mode
4. ✅ In list view, column headers are small (11px), not bold, no uppercase
5. ✅ Selected row has visible 2px ink-blue left border + subtle blue tint
6. ✅ Rows have no zebra stripe, just hover tint
7. ✅ Empty code cells show as blank space, not `—`
8. ✅ Section headers ("K2: DKØ 4") feel medium-weight, not bold
9. ✅ Open "Categories" modal → uses Modal primitive, clean footer with color/input/button row
10. ✅ Drag category row — drag-over state shows info-bg tint
11. ✅ Click color swatch — color picker popover appears with tokens
12. ✅ Confirm delete state uses `<Button variant="danger">` and `variant="ghost">`
13. ✅ No console errors

Fix anything that doesn't pass before committing.

---

## STEP 9: FINAL BUILD + COMMIT

```bash
npm run build
```

Must pass with no errors.

```bash
git add -A
git commit -m "refactor(exercise-library): layout tuning + category modal migration

- <StandardPage>: remove max-width 1400, use symmetric 48px horizontal
  padding instead; new hasSidePanel prop flips to edge-to-edge mode
  when a side panel is open
- ExerciseLibrary wires hasSidePanel={selectedExerciseId !== null}
- List view column headers: 11px regular, not 13px medium
- Remove redundant Category column from list rows (rows are grouped
  under category section headers already)
- Fix current-row highlight: clean 2px accent left border +
  info-bg background, no zebra stripe
- Hide em-dash placeholder for empty exercise codes
- CategoryManagerModal: migrate to Modal, Input, Button, primitives;
  remove all hardcoded gray/blue classes and arbitrary font sizes

Visual-only changes. No behavioral differences."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `<StandardPage>` supports `hasSidePanel` prop
3. ✅ Exercise Library uses the prop correctly
4. ✅ Framed mode has 48px horizontal air
5. ✅ Edge-to-edge mode (when panel open) has no border/radius/H-padding
6. ✅ List view column headers at 11px regular
7. ✅ Category column removed from rows
8. ✅ Selected row shows accent border clearly
9. ✅ Empty codes don't show em-dash
10. ✅ Category modal uses primitives throughout
11. ✅ Drag-and-drop still works in Category modal
12. ✅ Color picker still works
13. ✅ Committed and pushed

---

## NEXT STEP

After this is committed and verified, **Prompt 4c** handles the
usability improvements:
- Hide empty categories by default (toggle to show)
- Duplicate exercise detection with warning indicator
- "0 / 7 athletes using" reframed
- Differentiate Edit vs Archive buttons in detail panel
- Roster PR aggregation when no athlete is selected
- Handle empty PR section in detail panel

Then **Prompt 4d** adds customizable list columns (new feature).
