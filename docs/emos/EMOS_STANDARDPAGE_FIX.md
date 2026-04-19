# EMOS — PROMPT 4B.1: FIX STANDARDPAGE LEFT PADDING WHEN PANEL OPEN

Small fix: when a side panel is open, the Exercise Library currently
loses its left padding AND its left border, causing the list to
compress against the sidebar. The intent was only for the right side
to dissolve into the docked panel; the left should keep its air.

Do not ask for confirmation. Commit once with message:
`fix(ui): StandardPage keeps left padding when side panel open`.

---

## THE FIX

Edit `src/components/ui/StandardPage.tsx`.

Currently the outer wrapper uses:
```tsx
padding: hasSidePanel
  ? 'var(--space-xl) 0'
  : 'var(--space-xl) 48px',
```

Change to asymmetric padding when `hasSidePanel` is true:
```tsx
padding: hasSidePanel
  ? 'var(--space-xl) 0 var(--space-xl) 48px'
  : 'var(--space-xl) 48px',
```

This preserves the 48px left padding (so the list keeps its air from
the sidebar) while dropping the right padding to zero (so the docked
side panel sits flush against the viewport edge).

Also update the work surface border rule inside `<StandardPage>`.
Currently:
```tsx
border: hasSidePanel
  ? 'none'
  : '0.5px solid var(--color-border-tertiary)',
borderRadius: hasSidePanel
  ? 0
  : 'var(--radius-lg)',
```

Change to only drop the right border and right radius:
```tsx
border: hasSidePanel
  ? '0.5px solid var(--color-border-tertiary)'
  : '0.5px solid var(--color-border-tertiary)',
borderRight: hasSidePanel
  ? 'none'
  : undefined,
borderRadius: hasSidePanel
  ? 'var(--radius-lg) 0 0 var(--radius-lg)'
  : 'var(--radius-lg)',
```

This means:
- When panel is closed → full card with border all around, radius on all corners
- When panel is open → card with left/top/bottom border, radius on left corners only; right side is open and flows visually into the panel

---

## COMPLETE UPDATED FILE

For clarity, here's what `StandardPage.tsx` should look like after
the fix:

```tsx
import type { ReactNode } from 'react';

interface StandardPageProps {
  children: ReactNode;
  hasSidePanel?: boolean;
}

/**
 * Framing A — standard content page.
 *
 * Default (no panel):
 * - Off-white page background
 * - White work surface card with hairline border on all sides and 8px radius
 * - Symmetric 48px horizontal padding, 24px vertical padding
 *
 * When hasSidePanel=true:
 * - Work surface keeps left/top/bottom border and left radius
 * - Right side goes flush to viewport edge (no right border, no right radius)
 * - Left padding preserved (48px) so the list stays anchored to the sidebar
 * - Side panel docks flush to the right edge of the viewport
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
            ? 'var(--space-xl) 0 var(--space-xl) 48px'
            : 'var(--space-xl) 48px',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRight: hasSidePanel ? 'none' : undefined,
            borderRadius: hasSidePanel
              ? 'var(--radius-lg) 0 0 var(--radius-lg)'
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

---

## VERIFY

```bash
npm run build
```

Must pass.

Visit `/library`:

1. **No exercise selected** — framed card as before, full border, 48px air on both sides
2. **Click an exercise** — panel slides in; the list keeps its 48px left padding AND its left border. The right side of the list visually flows into the panel (no right border, no right radius).
3. **Close panel** — back to full framed card

---

## COMMIT

```bash
git add -A
git commit -m "fix(ui): StandardPage keeps left padding when side panel open

When hasSidePanel=true, the previous implementation removed all
horizontal padding, causing the list to compress against the sidebar.
Left padding (48px) now preserved; only right padding is zeroed so
the docked panel sits flush against the viewport edge. Work surface
also keeps its left/top/bottom border and left radius — only the
right side opens up to flow visually into the panel."
```

Push to remote.
