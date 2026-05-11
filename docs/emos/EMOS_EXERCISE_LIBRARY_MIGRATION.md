# EMOS — PROMPT 4A: EXERCISE LIBRARY VISUAL MIGRATION

This begins the page-by-page migration of EMOS pages to the new
design system. The Exercise Library is first because it's the most
recent build and has the most Bolt-era drift visible.

This prompt is **visual-only**. No behavioral changes. The goal is
that the page does exactly what it does today, but looks the way the
design system says it should.

Prerequisites (already committed):
- Design tokens in `src/styles/tokens.css` (Prompt 1)
- `/system` style guide at `/system` route (Prompt 2)
- Primitives library in `src/components/ui/` (Prompt 3)

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each major section. Commit once at the end with message:
`refactor(exercise-library): migrate to design system`.

**Scope:** Only `src/components/exercise-library/ExerciseLibrary.tsx`
and the new `<StandardPage>` primitive. The `ExerciseDetailPanel.tsx`
will be migrated in a separate prompt (4b). Do not touch it here.

---

## STEP 1: CREATE `<StandardPage>` PRIMITIVE

This is a new primitive that implements Framing A from the design
system — the default content page framing.

Create `src/components/ui/StandardPage.tsx`:

```tsx
import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
}

/**
 * Framing A — standard content page.
 *
 * Used for: macro detail, exercise library, athlete list, settings.
 *
 * Structure:
 * - Off-white page background (--color-bg-page)
 * - White work surface card inset by 24px
 * - 8px radius, 0.5px hairline border
 * - Max width 1400px centered
 * - Children fill the work surface with their own padding
 */
export function StandardPage({ children }: StandardPageProps) {
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
          maxWidth: 'var(--work-area-max-width)',
          margin: '0 auto',
          padding: 'var(--space-xl)',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--radius-lg)',
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

Add to `src/components/ui/index.ts`:

```typescript
export { StandardPage } from './StandardPage';
```

Run `npm run build`. Must pass.

---

## STEP 2: PLAN THE MIGRATION

The Exercise Library has the following structure. Each section will
be migrated:

```
ExerciseLibrary (744 lines)
├── ExerciseCard (helper component, lines ~32-68)
├── ExerciseListRow (helper component, lines ~70-136)
├── ListViewHeader (helper component, lines ~138-169)
├── CategoryManagerModal (helper component, lines ~171-383)
└── Main ExerciseLibrary component (lines ~385-744)
    ├── Toolbar (search, view toggle, buttons)
    ├── Category sections with headers
    ├── Exercise cards/rows rendering
    ├── Empty-state rendering
    └── Modal mounting
```

We'll migrate each sub-component in order, keeping behavior identical.

---

## STEP 3: MIGRATE `ExerciseCard`

Find the `ExerciseCard` function (around line 41). Replace the entire
implementation with:

```tsx
import { ColorDot, Badge } from '../ui';

function ExerciseCard({ exercise, isSelected, athletePR, onClick }: ExerciseCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        border: isSelected
          ? '0.5px solid var(--color-accent)'
          : '0.5px solid var(--color-border-tertiary)',
        background: isSelected ? 'var(--color-info-bg)' : 'var(--color-bg-primary)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'all 100ms ease-out',
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
          e.currentTarget.style.background = 'var(--color-bg-secondary)';
        }
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--color-border-tertiary)';
          e.currentTarget.style.background = 'var(--color-bg-primary)';
        }
      }}
    >
      {/* Top line: dot + code + COMP badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-xs)',
          marginBottom: '4px',
          minWidth: 0,
        }}
      >
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {exercise.exercise_code || exercise.name}
        </span>
        {exercise.is_competition_lift && (
          <Badge variant="danger">COMP</Badge>
        )}
      </div>

      {/* Exercise name (only shown if distinct from code) */}
      {exercise.exercise_code && exercise.exercise_code !== exercise.name && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
            marginBottom: athletePR?.pr_value_kg != null ? '6px' : 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {exercise.name}
        </div>
      )}

      {/* PR line (only shown if athlete has PR) */}
      {athletePR?.pr_value_kg != null && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
            }}
          >
            {athletePR.pr_value_kg}
          </span>
          <span style={{ marginLeft: '3px' }}>kg PR</span>
        </div>
      )}
    </div>
  );
}
```

**Changes made:**
- Tailwind classes → tokens via inline style + CSS vars
- `font-semibold` → `fontWeight: 500` (design system: 500 max)
- `text-[11px]/text-[10px]/text-[9px]` → token-based sizes
- Hardcoded `bg-red-50 text-red-500` COMP → `<Badge variant="danger">`
- Bg color swatch → `<ColorDot />` primitive
- **Usability improvement:** only show exercise name subtitle if it
  differs from the exercise code (fixes "Snatch / Snatch" duplication)
- Hover states handled via inline style events (matching primitives pattern)

Run `npm run build`. Must pass.

---

## STEP 4: MIGRATE `ExerciseListRow`

Find `ExerciseListRow` (around line 89). Replace with:

```tsx
function ExerciseListRow({ exercise, isSelected, athletePR, onClick, rowIndex }: ExerciseListRowProps) {
  const unitLabel = UNIT_LABELS[exercise.default_unit] || exercise.default_unit;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px 120px',
        alignItems: 'center',
        gap: 'var(--space-md)',
        padding: '8px 16px',
        background: isSelected
          ? 'var(--color-info-bg)'
          : (rowIndex % 2 === 0 ? 'transparent' : 'var(--color-bg-secondary)'),
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
        if (!isSelected) {
          e.currentTarget.style.background = rowIndex % 2 === 0
            ? 'transparent'
            : 'var(--color-bg-secondary)';
        }
      }}
    >
      {/* Dot + code */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', minWidth: 0 }}>
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
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
          {exercise.exercise_code || '—'}
        </span>
      </div>

      {/* COMP badge */}
      <div>
        {exercise.is_competition_lift && <Badge variant="danger">COMP</Badge>}
      </div>

      {/* Name */}
      <div
        style={{
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {exercise.name}
      </div>

      {/* Unit */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {unitLabel}
      </div>

      {/* PR (athlete) */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-primary)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {athletePR?.pr_value_kg != null ? (
          <>
            <span style={{ fontWeight: 500 }}>{athletePR.pr_value_kg}</span>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                marginLeft: '3px',
              }}
            >
              kg
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>

      {/* Category is REMOVED from rows — redundant since rows are
          grouped under a category header. Category column becomes
          a spacer for alignment. */}
      <div />
    </div>
  );
}
```

**Changes made:**
- Removed the category pill from each row (redundant — rows are
  grouped under category headers already)
- Changed unit cell to mono with tertiary color
- PR cell: mono number + sans unit (`kg` in smaller text, standard per design system)
- PR empty state: `—` instead of blank
- Current-row: 2px left border in accent + info-bg background
- Row hover uses `bg-secondary` instead of a separate hover class
- Alternating row tint restored for readability
- All `text-[8px]/text-[9px]/text-[10px]` removed

Also update the `ListViewHeader` function to match the new columns.

Find `ListViewHeader` (around line 138). Replace with:

```tsx
function ListViewHeader() {
  const cell = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-caption)',
    fontWeight: 400,
    color: 'var(--color-text-secondary)',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px 120px',
        gap: 'var(--space-md)',
        padding: '10px 16px 8px',
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
      <div></div>
    </div>
  );
}
```

**Changes made:**
- `CODE` / `NAME` / `UNIT` / `CATEGORY` / `PR` → sentence case: `Code`, `Name`, `Unit`, `PR`
- Category column removed (matches row change)
- Header is sticky to the top of the scroll area
- Font size and color follow tokens

Run `npm run build`. Must pass.

---

## STEP 5: MIGRATE MAIN `ExerciseLibrary` TOOLBAR AND LAYOUT

This is the largest chunk. The main return block starts around line 578
with `return (<div className="flex flex-col h-full overflow-hidden bg-white">`.

Import the primitives at the top of the file:

```tsx
import {
  StandardPage, Button, Input, Badge, ColorDot, SectionHeader,
} from '../ui';
```

Replace the entire return block in the main component with:

```tsx
  // ── Render ────────────────────────────────────────────────────────

  return (
    <StandardPage>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          flexShrink: 0,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary)',
            }}
          />
          <Input
            type="text"
            placeholder="Search exercises…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '32px', paddingRight: searchQuery ? '28px' : '12px' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
              }}
              aria-label="Clear search"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* View toggle (grid / list) */}
        <div
          style={{
            display: 'flex',
            gap: '1px',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '2px',
          }}
        >
          <button
            onClick={() => setViewMode('grid')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              fontSize: 'var(--text-caption)',
              fontFamily: 'var(--font-sans)',
              background: viewMode === 'grid' ? 'var(--color-bg-primary)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: viewMode === 'grid' ? 500 : 400,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            <Grid3X3 size={12} /> Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              fontSize: 'var(--text-caption)',
              fontFamily: 'var(--font-sans)',
              background: viewMode === 'list' ? 'var(--color-bg-primary)' : 'transparent',
              color: viewMode === 'list' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: viewMode === 'list' ? 500 : 400,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            <List size={12} /> List
          </button>
        </div>

        <Button variant="secondary" size="sm" icon={<Layers size={12} />}
          onClick={() => setShowCategoryModal(true)}>
          Categories
        </Button>

        <Button variant="secondary" size="sm" icon={<Upload size={12} />}
          onClick={() => setShowBulkImport(true)}>
          Import
        </Button>

        <Button variant="primary" size="md" icon={<Plus size={14} />}
          onClick={() => { setEditingExercise(null); setShowCreateModal(true); }}>
          Add exercise
        </Button>
      </div>

      {/* Main content — list/detail */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Exercise list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {viewMode === 'list' && <ListViewHeader />}

          {visibleCategories.map(cat => {
            const catExercises = filteredExercises.filter(ex => (ex.category as unknown as string) === cat.name);
            if (catExercises.length === 0 && searchQuery.trim()) return null;
            const isCollapsed = collapsedCategories.has(cat.id);

            return (
              <div key={cat.id}>
                <CategorySectionHeader
                  category={cat}
                  count={catExercises.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleCollapse(cat.id)}
                />

                {!isCollapsed && (
                  viewMode === 'grid' ? (
                    <div style={{ padding: '0 var(--space-lg) var(--space-md)' }}>
                      {renderExercises(catExercises)}
                    </div>
                  ) : (
                    <div>{renderExercises(catExercises)}</div>
                  )
                )}
              </div>
            );
          })}

          {/* Unspecified / orphan exercises */}
          {(() => {
            const orphans = filteredExercises.filter(ex => !knownCategoryNames.has(ex.category as unknown as string));
            if (orphans.length === 0) return null;

            const orphanCat: Category = {
              id: '__unspecified__',
              name: 'Unspecified',
              color: 'var(--color-gray-400)',
              display_order: 9999,
              created_at: '',
            };
            const isCollapsed = collapsedCategories.has(orphanCat.id);

            return (
              <div>
                <CategorySectionHeader
                  category={orphanCat}
                  count={orphans.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleCollapse(orphanCat.id)}
                />
                {!isCollapsed && (
                  viewMode === 'grid'
                    ? <div style={{ padding: '0 var(--space-lg) var(--space-md)' }}>{renderExercises(orphans)}</div>
                    : <div>{renderExercises(orphans)}</div>
                )}
              </div>
            );
          })()}

          {/* Empty state */}
          {filteredExercises.length === 0 && (
            <div
              style={{
                padding: 'var(--space-2xl)',
                textAlign: 'center',
                fontSize: 'var(--text-body)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {searchQuery.trim()
                ? `No exercises match "${searchQuery}"`
                : 'No exercises yet. Click "Add exercise" to create one.'}
            </div>
          )}
        </div>

        {/* Detail panel (unchanged — migrated in 4b) */}
        {selectedExerciseId && (() => {
          const selectedExercise = exercises.find(e => e.id === selectedExerciseId);
          const selectedCategory = categories.find(c => c.name === (selectedExercise?.category as unknown as string)) || null;
          if (!selectedExercise) return null;
          return (
            <ExerciseDetailPanel
              exercise={selectedExercise}
              category={selectedCategory}
              athlete={selectedAthlete}
              allAthletes={athletes}
              allExercises={exercises}
              onClose={() => setSelectedExerciseId(null)}
              onEdit={(ex) => { setEditingExercise(ex); setShowCreateModal(true); }}
              onArchive={handleArchive}
              onSelectExercise={(id) => setSelectedExerciseId(id)}
            />
          );
        })()}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <ExerciseFormModal
          isOpen={showCreateModal}
          onClose={() => { setShowCreateModal(false); setEditingExercise(null); }}
          editingExercise={editingExercise}
          onSave={async (data) => {
            if (editingExercise) {
              await updateExercise(editingExercise.id, data);
            } else {
              await createExercise(data);
            }
            await fetchExercises();
            setShowCreateModal(false);
            setEditingExercise(null);
          }}
          allExercises={exercises}
        />
      )}

      {showBulkImport && (
        <ExerciseBulkImportModal
          isOpen={showBulkImport}
          onClose={() => setShowBulkImport(false)}
          onImported={async () => { await fetchExercises(); setShowBulkImport(false); }}
        />
      )}

      {showCategoryModal && (
        <CategoryManagerModal
          categories={visibleCategories}
          exercises={exercises}
          onClose={() => setShowCategoryModal(false)}
          onRename={handleCatRename}
          onRecolor={handleCatRecolor}
          onReorder={handleCatReorder}
          onAdd={handleCatAdd}
          onDelete={handleCatDelete}
        />
      )}
    </StandardPage>
  );
```

**Changes made:**
- Wrapped in `<StandardPage>` — adds Framing A (off-white bg, white work surface, max-width 1400px, 24px gap, hairline border, 8px radius)
- `<Input>` replaces raw `<input>` — built-in focus ring in accent
- `<Button>` primitives for all action buttons — consistent sizes and colors, primary uses accent, secondary uses hairline border
- View toggle kept as inline buttons (unique pattern, not worth a primitive yet) but styled with tokens
- Category headers extracted to new helper `<CategorySectionHeader>` (defined in next step)
- Empty state uses proper typography and colors

Run `npm run build`. Must pass.

---

## STEP 6: ADD `<CategorySectionHeader>` HELPER

Add a new helper component BEFORE the main `ExerciseLibrary` function
(so it's scoped to the file, not exported):

```tsx
// ── CategorySectionHeader ──────────────────────────────────────────

interface CategorySectionHeaderProps {
  category: Category;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
}

function CategorySectionHeader({ category, count, isCollapsed, onToggle }: CategorySectionHeaderProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: 'var(--space-md) var(--space-lg)',
        cursor: 'pointer',
        userSelect: 'none',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <ChevronRight
        size={12}
        style={{
          color: 'var(--color-text-tertiary)',
          transition: 'transform 100ms ease-out',
          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          flexShrink: 0,
        }}
      />
      <ColorDot color={category.color || 'var(--color-gray-400)'} size={8} />
      <span
        style={{
          fontSize: 'var(--text-label)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          letterSpacing: 'var(--tracking-section)',
        }}
      >
        {category.name}
      </span>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg-primary)',
          padding: '1px 6px',
          borderRadius: '999px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
      <span style={{ flex: 1, height: '0.5px', background: 'var(--color-border-tertiary)' }} />
    </div>
  );
}
```

**Changes made:**
- Uses `<ColorDot>` primitive instead of raw square color swatch (8px)
- Count pill uses mono font, tokens-based colors
- Chevron rotation uses transform transition
- Category name at `text-label` weight 500 — no more bold (700) look
- Background is `bg-secondary` to separate section headers from content

Run `npm run build`. Must pass.

---

## STEP 7: VERIFY AND POLISH

Visit `/library` in the browser. Verify:

1. ✅ Page now has a framed white work surface (Framing A applied)
2. ✅ Background outside the card is off-white (`--color-bg-page`)
3. ✅ Toolbar uses proper buttons (primary ink-blue, no shadows, no bright blue)
4. ✅ Search input has accent-colored focus ring
5. ✅ Category headers have proper color dots (circles, not squares)
6. ✅ Category header text is medium weight (500), not bold (700)
7. ✅ Grid cards: COMP badge uses semantic danger colors (muted red bg, dark red text)
8. ✅ Grid cards: exercise name only shown when distinct from code (no more "Snatch / Snatch")
9. ✅ Grid cards: PR shown as "170 kg PR" with mono number + sans "kg PR"
10. ✅ List view: column headers in sentence case, sticky to top
11. ✅ List view: no redundant category column on rows
12. ✅ List view: alternating row tints
13. ✅ List view: selected row has 2px accent left border + info-bg background
14. ✅ List view: all numbers in mono, right-aligned
15. ✅ Units (%, kg, other) appear in muted mono
16. ✅ No console errors

Known intentional limits of this migration:
- The detail panel still looks like the old one — migrated in Prompt 4b
- The Category Manager modal still uses old styles — migrated later
- Behavioral changes (duplicate detection, hiding empty categories,
  roster PR view) are saved for Prompt 4c

If you find any issue that affects the visual tokens (wrong color,
wrong font, wrong size), fix it in place. Do NOT introduce behavioral
changes beyond the surgical usability fix to ExerciseCard (hiding
duplicate exercise name).

---

## STEP 8: FINAL BUILD + COMMIT

```bash
npm run build
```

Must pass with no errors. Visually verify `/library` once more.

Then:
```bash
git add -A
git commit -m "refactor(exercise-library): migrate to design system

- Introduce <StandardPage> primitive (Framing A) in src/components/ui
- ExerciseLibrary now uses StandardPage wrapper: framed white work
  surface, off-white page background, 1400px max width, 24px gap
- ExerciseCard: migrate to tokens, use <ColorDot>, <Badge> primitives
- ExerciseListRow: tokens, mono numbers, sentence-case, remove
  redundant category column from rows
- ListViewHeader: sentence case, sticky, token-based
- Toolbar: <Button> primitives replace raw button elements
- Search: <Input> primitive with accent focus ring
- New <CategorySectionHeader> uses <ColorDot> instead of square swatch
- Small usability fix: hide exercise name in card when identical to
  exercise code (removes 'Snatch / Snatch' duplication)

No behavioral changes beyond the duplication fix. Detail panel,
category manager modal, and roster-PR aggregation are deferred
to prompts 4b and 4c."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ `<StandardPage>` primitive created and exported
3. ✅ `/library` visually uses Framing A (framed work surface)
4. ✅ All toolbar buttons use `<Button>` primitive
5. ✅ Search uses `<Input>`
6. ✅ COMP badges use `<Badge>` (muted red, not bright)
7. ✅ Category dots use `<ColorDot>` (circles, 8px)
8. ✅ No `text-[Npx]` arbitrary sizes remain in ExerciseLibrary.tsx
9. ✅ No `bg-blue-500/600`, `shadow-md`, or hardcoded Tailwind colors
10. ✅ Grid cards don't duplicate exercise name when code is same
11. ✅ List rows have alternating tint + selected highlight
12. ✅ Column headers in sentence case
13. ✅ No console errors
14. ✅ Committed and pushed

---

## NEXT STEPS

- **Prompt 4b** — Migrate `ExerciseDetailPanel.tsx` to use primitives.
  Apply the same visual treatment to the right-side detail panel.
- **Prompt 4c** — Apply the usability improvements identified in
  review: hide empty categories, flag duplicate exercises, hide empty
  PR section, differentiate Edit vs. Archive buttons, add roster PR
  aggregation view for coach-without-athlete mode.
