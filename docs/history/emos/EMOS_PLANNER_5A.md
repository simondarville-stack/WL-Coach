# EMOS — PROMPT 5A: PLANNER CONTROL PANEL MIGRATION

First phase of the Weekly Planner migration. This prompt migrates
`src/components/planner/PlannerControlPanel.tsx` (666 lines) to use
the design system.

Scope is **visual only**:
- Typography → tokens (sentence case, no bold above 500, mono for numbers)
- Colors → tokens (no hardcoded blues, grays, ambers)
- Badges → `<Badge>` primitive
- Buttons → `<Button>` primitive where appropriate
- Remove "now" indicator conceptual (no such indicator exists in this
  file, but noting scope)

Do NOT touch:
- `WeeklyPlanner.tsx` wrapper (framing decision deferred)
- `DayCard.tsx`, `WeekOverview.tsx`, `PlannerWeekOverview.tsx` (later phases)
- Any other planner component

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each major step. Commit once at the end with message:
`refactor(planner): migrate PlannerControlPanel to design system`.

**IMPORTANT:** No behavioral changes. No feature additions. The control
panel does exactly what it does today, but with EMOS visual language.

---

## CONTEXT

The `PlannerControlPanel` is the top banner of the single-week planner
view. It has 6 logical rows, top-to-bottom:

1. **Row 1 — Athlete/Group card + Week navigation + Tool buttons**
2. **Row 2 — Metrics strip** (S · R · Max · Avg · T · K · Stress)
   followed by Categories toggle and Macro breadcrumb with week-type badge
3. **Row 3 — Categories strip** (collapsible; breakdown by exercise category)
4. **Row 4 — Schedule indicator** (day slots with times, avg rest hours)
5. **Row 5 — Macro phase + week timeline bar** (colored segments, one per macro week)
6. **Row 6 — Week notes textarea** ("Week brief — tell the athlete…")

Below the main component, there's also an **Athlete profile dialog**
(modal overlay that opens when you double-click the athlete card) that
needs to be migrated too.

Each row has its own styling concerns. Migrate row-by-row.

---

## STEP 1: ADD IMPORTS + REPLACE HELPER FUNCTIONS

At the top of `PlannerControlPanel.tsx`, find the existing imports
block. After the lucide-react imports, add:

```tsx
import { Button, Badge, Input, Modal, ColorDot } from '../ui';
```

Remove the two helper functions `weekTypeBadgeStyle` and
`complianceColor` that currently map values to Tailwind class strings.
Replace them with token-based equivalents:

```tsx
// Maps macro week type to a Badge variant.
// "Competition" is the only red-coded state; all others are colored
// by entity hue (via inline style) rather than semantic meaning.
function weekTypeBadgeColor(weekType: string): { bg: string; text: string } {
  switch (weekType) {
    case 'High':        return { bg: 'var(--color-amber-50)', text: 'var(--color-amber-800)' };
    case 'Medium':      return { bg: 'var(--color-blue-50)',  text: 'var(--color-blue-800)' };
    case 'Low':         return { bg: 'var(--color-green-50)', text: 'var(--color-green-800)' };
    case 'Deload':      return { bg: 'var(--color-teal-50)',  text: 'var(--color-teal-800)' };
    case 'Competition': return { bg: 'var(--color-red-50)',   text: 'var(--color-red-800)' };
    case 'Taper':       return { bg: 'var(--color-amber-50)', text: 'var(--color-amber-800)' };
    case 'Testing':     return { bg: 'var(--color-purple-50)', text: 'var(--color-purple-800)' };
    default:            return { bg: 'var(--color-bg-secondary)', text: 'var(--color-text-secondary)' };
  }
}

// Compliance color (for the percentage after the reps count)
function complianceColorToken(pct: number): string {
  if (pct >= 90) return 'var(--color-success-text)';
  if (pct >= 70) return 'var(--color-warning-text)';
  return 'var(--color-danger-text)';
}
```

Update the call sites below to use these (there are two: `weekTypeBadgeStyle` -> `weekTypeBadgeColor`, `complianceColor` -> `complianceColorToken`). We'll wire them in during Step 3.

Run `npm run build`. If it fails at this step, it's because the old
functions are still being called somewhere — search for remaining
references and update them in Step 3 when we get there.

---

## STEP 2: MIGRATE OUTER WRAPPER

Find the outer return statement (around line 214):

```tsx
return (
  <div className="bg-white border-b border-gray-200 flex-shrink-0">
```

Replace with token-based styling:

```tsx
return (
  <div
    style={{
      background: 'var(--color-bg-primary)',
      borderBottom: '0.5px solid var(--color-border-tertiary)',
      flexShrink: 0,
    }}
  >
```

---

## STEP 3: MIGRATE ROW 1 — ATHLETE + NAVIGATION + TOOLS

This is the busiest row. Replace the entire block from
`{/* ── ROW 1: Athlete + Week nav + Tools ── */}` down to the closing
`</div>` that ends the row (around line 343).

```tsx
{/* ── ROW 1: Athlete + Week nav + Tools ─────────────────────────────── */}
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-md)',
    padding: 'var(--space-md) var(--space-lg)',
    borderBottom: '0.5px solid var(--color-border-tertiary)',
  }}
>

  {/* LEFT: avatar + name */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-md)',
      flexShrink: 0,
      minWidth: 0,
      width: 200,
      cursor: selectedAthlete ? 'pointer' : 'default',
    }}
    onDoubleClick={() => selectedAthlete && setShowAthleteProfile(true)}
    title={selectedAthlete ? 'Double-click to view athlete profile' : undefined}
  >
    {selectedGroup ? (
      <>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'var(--color-accent-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Users size={18} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontSize: 'var(--text-section)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedGroup.name}
          </p>
        </div>
      </>
    ) : selectedAthlete ? (
      <>
        {selectedAthlete.photo_url ? (
          <img
            src={selectedAthlete.photo_url}
            alt={selectedAthlete.name}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
              border: '0.5px solid var(--color-border-tertiary)',
            }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'var(--color-accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-label)',
              fontWeight: 500,
              color: 'var(--color-accent)',
              flexShrink: 0,
            }}
          >
            {athleteInitials}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontSize: 'var(--text-section)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedAthlete.name}
          </p>
          {subLabel && (
            <p
              style={{
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                lineHeight: 1.2,
                marginTop: '2px',
                margin: '2px 0 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subLabel}
            </p>
          )}
        </div>
      </>
    ) : null}
  </div>

  {/* CENTER: week navigation */}
  <div
    style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-sm)',
    }}
  >
    <Button
      variant="ghost"
      size="sm"
      icon={<ChevronLeft size={14} />}
      onClick={onPrevWeek}
    >
      Prev
    </Button>

    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '0 var(--space-md)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-section)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          lineHeight: 1.2,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
        }}
      >
        {formatDateRange(selectedDate, 7)}
      </span>
      {macroContext && (
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            lineHeight: 1,
            marginTop: '2px',
          }}
        >
          Week {macroContext.weekNumber}{macroContext.totalWeeks > 0 ? ` of ${macroContext.totalWeeks}` : ''}
        </span>
      )}
    </div>

    <Button
      variant="ghost"
      size="sm"
      icon={<ChevronRight size={14} />}
      iconPosition="right"
      onClick={onNextWeek}
    >
      Next
    </Button>
  </div>

  {/* RIGHT: tool buttons */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      flexShrink: 0,
    }}
  >
    <IconButton title="Day settings" onClick={onDayConfig}>
      <Settings2 size={16} />
    </IconButton>

    {canCopyPaste && (
      <>
        <IconButton
          title="Copy week"
          onClick={() => { onCopy(); setCopyFlash(true); setTimeout(() => setCopyFlash(false), 1200); }}
          highlight={copyFlash ? 'success' : undefined}
        >
          <Copy size={16} />
        </IconButton>
        <IconButton
          title="Paste week"
          onClick={onPaste}
          disabled={!copiedWeekStart}
        >
          <ClipboardPaste size={16} />
        </IconButton>
      </>
    )}

    <IconButton title="Print week" onClick={onPrint}>
      <Printer size={16} />
    </IconButton>

    <IconButton
      title="Load distribution chart"
      onClick={onToggleLoadDistribution}
      highlight={showLoadDistribution ? 'info' : undefined}
    >
      <BarChart2 size={16} />
    </IconButton>

    {onResolvePercentages && selectedAthlete && athletePRs.length > 0 && (
      <Button
        variant="ghost"
        size="sm"
        onClick={onResolvePercentages}
        title="Convert percentage prescriptions to kg using athlete PRs"
      >
        → kg
      </Button>
    )}
  </div>
</div>
```

Add a helper `IconButton` component just above the return statement
(inside the `PlannerControlPanel` function body, or as a module-level
helper — your choice). This encapsulates the repeated icon-only button
styling:

```tsx
// Module-level helper — place near top of file, after the helper
// functions from Step 1.
interface IconButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  highlight?: 'success' | 'info';
}

function IconButton({ children, onClick, title, disabled, highlight }: IconButtonProps) {
  const [hovered, setHovered] = useState(false);

  const bg = highlight === 'success'
    ? 'var(--color-success-bg)'
    : highlight === 'info'
    ? 'var(--color-info-bg)'
    : hovered && !disabled
    ? 'var(--color-bg-secondary)'
    : 'transparent';

  const color = highlight === 'success'
    ? 'var(--color-success-text)'
    : highlight === 'info'
    ? 'var(--color-info-text)'
    : disabled
    ? 'var(--color-text-tertiary)'
    : hovered
    ? 'var(--color-text-primary)'
    : 'var(--color-text-secondary)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 'var(--space-sm)',
        border: 'none',
        background: bg,
        color,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 100ms ease-out',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}
```

This `IconButton` is a local convenience — don't add it to the main
primitives library yet (we'll promote it later once we see it used
in more places).

Also add `useState` import if not already imported — it's already in
the file.

Run `npm run build`. Fix any errors.

---

## STEP 4: MIGRATE ROW 2 — METRICS STRIP

Replace the entire Row 2 block (metrics, categories toggle, macro
breadcrumb). The current implementation has a lot of repeated inline
spans for metric label + value + separator. We'll clean it up with a
small local helper.

Find the block starting with `{/* ── ROW 2: Metrics strip ── */}`
and replace it with:

```tsx
{/* ── ROW 2: Metrics strip ───────────────────────────────────────────── */}
<div
  style={{
    padding: 'var(--space-sm) var(--space-lg)',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-xs)',
    fontSize: 'var(--text-label)',
  }}
>
  {visibleMetrics.includes('sets') && (
    <MetricItem label="S" value={metrics.sets} />
  )}

  {visibleMetrics.includes('reps') && (
    <>
      {visibleMetrics.includes('sets') && <MetricSeparator />}
      <MetricItem
        label="R"
        value={
          <>
            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.reps}</span>
            {macroWeekTarget != null && (
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '4px' }}>/ {macroWeekTarget}</span>
            )}
            {repsProgress !== null && (
              <span
                style={{
                  marginLeft: '6px',
                  fontWeight: 500,
                  color: complianceColorToken(repsProgress),
                }}
              >
                ({repsProgress}%)
              </span>
            )}
          </>
        }
      />
    </>
  )}

  {visibleMetrics.includes('max') && metrics.max > 0 && (
    <>
      <MetricSeparator />
      <MetricItem label="Max" value={metrics.max} />
    </>
  )}

  {visibleMetrics.includes('avg') && metrics.avg > 0 && (
    <>
      <MetricSeparator />
      <MetricItem label="Avg" value={metrics.avg} />
    </>
  )}

  {visibleMetrics.includes('tonnage') && metrics.tonnage > 0 && (
    <>
      <MetricSeparator />
      <MetricItem
        label="T"
        value={
          <>
            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{metrics.tonnage.toLocaleString()}</span>
            <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '4px' }}>kg</span>
          </>
        }
      />
    </>
  )}

  {visibleMetrics.includes('k') && metrics.k != null && (
    <>
      <MetricSeparator />
      <MetricItem label="K" value={`${(metrics.k * 100).toFixed(0)}%`} />
    </>
  )}

  {showStress && totalStress > 0 && (
    <>
      <MetricSeparator />
      <MetricItem label="Stress" value={totalStress} />
    </>
  )}

  {categories.length > 0 && (
    <>
      <MetricSeparator />
      <button
        onClick={() => setShowCategories(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'transparent',
          border: 'none',
          padding: '2px 4px',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-tertiary)',
          transition: 'color 100ms ease-out',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
      >
        {showCategories ? <ChevronDown size={12} /> : <ChevronRightSmall size={12} />}
        <span>Categories</span>
      </button>
    </>
  )}

  {macroContext && (
    <>
      <MetricSeparator />
      <button
        onClick={() => navigate('/macrocycles')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'transparent',
          border: 'none',
          padding: '2px 4px',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-tertiary)',
          transition: 'color 100ms ease-out',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {macroContext.macroName}
        </span>
        {(() => {
          const { bg, text } = weekTypeBadgeColor(macroContext.weekType);
          return (
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: '999px',
                fontSize: 'var(--text-caption)',
                fontWeight: 500,
                background: bg,
                color: text,
                whiteSpace: 'nowrap',
              }}
            >
              {macroContext.weekTypeText || macroContext.weekType}
            </span>
          );
        })()}
      </button>
    </>
  )}
</div>
```

Add the `MetricItem` and `MetricSeparator` helpers near the top of the
file (above the `PlannerControlPanel` function):

```tsx
// Module-level helpers for the metrics strip
interface MetricItemProps {
  label: string;
  value: React.ReactNode;
}

function MetricItem({ label, value }: MetricItemProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px' }}>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </span>
  );
}

function MetricSeparator() {
  return (
    <span
      style={{
        color: 'var(--color-border-tertiary)',
        margin: '0 var(--space-sm)',
        userSelect: 'none',
      }}
    >
      ·
    </span>
  );
}
```

**Changes this makes:**
- Metric labels (S, R, Max, etc.) are now consistent 11px caption in tertiary color — no more uppercase, no more letter-spacing tricks
- Numbers are now mono consistently (they were sans before)
- Separator bullets use token border color instead of hardcoded gray
- Macro breadcrumb badge uses token-based colors via `weekTypeBadgeColor`
- Compliance percentage uses semantic colors (success/warning/danger tokens)
- Replaces ~60 lines of inline spans with structured helpers

Run `npm run build`. Visit `/planner` and verify Row 2 renders correctly.

---

## STEP 5: MIGRATE ROW 3 — CATEGORIES STRIP

Find the Categories strip block (collapsible, shows when `showCategories`
is true). Replace with:

```tsx
{/* ── Categories strip (collapsible) ───────────────────────────────── */}
{showCategories && categories.length > 0 && (
  <div
    style={{
      padding: 'var(--space-sm) var(--space-lg) var(--space-md)',
      display: 'flex',
      flexWrap: 'wrap',
      columnGap: 'var(--space-xl)',
      rowGap: '4px',
      borderTop: '0.5px solid var(--color-border-tertiary)',
    }}
  >
    {categories.map(cat => (
      <div
        key={cat.category}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          fontSize: 'var(--text-label)',
        }}
      >
        <span
          style={{
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '120px',
          }}
        >
          {cat.category}
        </span>
        <CategoryMetric label="S" value={cat.sets} />
        <CategoryMetric label="R" value={cat.reps} />
        {cat.tonnage > 0 && <CategoryMetric label="T" value={cat.tonnage.toLocaleString()} />}
      </div>
    ))}
  </div>
)}
```

Add a `CategoryMetric` helper near the other helpers:

```tsx
function CategoryMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-caption)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </span>
  );
}
```

Run `npm run build`.

---

## STEP 6: MIGRATE ROW 4 — SCHEDULE INDICATOR

Find the schedule indicator block (IIFE checking `daySchedule`). The
structure stays the same; just replace the styling.

Replace the outer wrapper:
```tsx
<div className="px-4 py-1.5 border-t border-gray-100 flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
```

With:
```tsx
<div
  style={{
    padding: '6px var(--space-lg)',
    borderTop: '0.5px solid var(--color-border-tertiary)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    fontSize: 'var(--text-caption)',
    color: 'var(--color-text-tertiary)',
  }}
>
```

Replace the weekday slot `<span>`:
```tsx
<span key={s} className="text-gray-600 font-medium">
  {WEEKDAY_SHORT[e.weekday]}{e.time ? ` ${e.time}` : ''}
</span>
```

With:
```tsx
<span
  key={s}
  style={{
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
  }}
>
  {WEEKDAY_SHORT[e.weekday]}{e.time ? ` ${e.time}` : ''}
</span>
```

Replace the separator dot:
```tsx
<span key={`dot-${i}`} className="text-gray-200">·</span>
```

With:
```tsx
<span
  key={`dot-${i}`}
  style={{ color: 'var(--color-border-tertiary)', userSelect: 'none' }}
>
  ·
</span>
```

Replace the "avg rest" label:
```tsx
<span className="ml-auto text-gray-400">{avgRestHours}h avg rest</span>
```

With:
```tsx
<span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
  <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
    {avgRestHours}h
  </span>
  <span style={{ marginLeft: '4px' }}>avg rest</span>
</span>
```

Run `npm run build`.

---

## STEP 7: MIGRATE ROW 5 — MACRO PHASE TIMELINE

Find the macro phase + week timeline block (the colored horizontal bar
with week numbers). The visual design is already good — each week is a
colored segment with a number. The main cleanup is to remove hardcoded
colors and use tokens where possible.

Update the outer wrapper:
```tsx
<div
  className="flex cursor-pointer overflow-hidden"
  style={{ height: 32 }}
  onClick={() => navigate('/macrocycles')}
  title="Open macro cycles"
>
```

Replace with:
```tsx
<div
  onClick={() => navigate('/macrocycles')}
  title="Open macro cycles"
  style={{
    display: 'flex',
    cursor: 'pointer',
    overflow: 'hidden',
    height: '28px',
    borderTop: '0.5px solid var(--color-border-tertiary)',
  }}
>
```

The week segments themselves keep their inline color styles (the
phase colors come from user data). But clean up the typography and
remove the `drop-shadow` hack:

Find the phase label span:
```tsx
<span
  className="absolute left-1 top-0.5 text-[9px] font-semibold text-white/90 leading-none truncate pointer-events-none z-10"
  style={{ whiteSpace: 'nowrap' }}
>
  {phase!.name}
</span>
```

Replace with:
```tsx
<span
  style={{
    position: 'absolute',
    left: '4px',
    top: '3px',
    fontSize: 'var(--text-caption)',
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
    zIndex: 10,
    maxWidth: 'calc(100% - 8px)',
  }}
>
  {phase!.name}
</span>
```

Find the week number span:
```tsx
<span
  className={`text-[11px] leading-none z-10 relative select-none ${
    isCurrentWeek ? 'font-bold text-white drop-shadow' : 'font-semibold text-white/85'
  }`}
>
  {weekNum}
</span>
```

Replace with:
```tsx
<span
  style={{
    fontSize: 'var(--text-caption)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    zIndex: 10,
    position: 'relative',
    userSelect: 'none',
    fontWeight: 500,
    color: isCurrentWeek ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.85)',
  }}
>
  {weekNum}
</span>
```

Find the current-week bottom accent bar:
```tsx
<div className="absolute bottom-0 left-0 right-0 h-1 bg-white/60" />
```

Replace with:
```tsx
<div
  style={{
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '2px',
    background: 'rgba(255, 255, 255, 0.75)',
  }}
/>
```

The current-week overlay stays as-is (its `rgba(255,255,255,0.28)` is
deliberate and not a token concern).

Run `npm run build`.

---

## STEP 8: MIGRATE ROW 6 — WEEK NOTES TEXTAREA

Find the week notes block (the textarea with "Week brief..." placeholder):

```tsx
<div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40">
  <textarea
    value={localDesc}
    ...
    className="w-full text-sm text-gray-700 placeholder-gray-300 bg-transparent border-0 focus:outline-none leading-relaxed resize-none overflow-hidden"
    style={{ minHeight: '1.5rem' }}
  />
</div>
```

Replace with:
```tsx
<div
  style={{
    padding: '10px var(--space-lg)',
    borderTop: '0.5px solid var(--color-border-tertiary)',
    background: 'var(--color-bg-secondary)',
  }}
>
  <textarea
    value={localDesc}
    onChange={e => {
      setLocalDesc(e.target.value);
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
    }}
    onBlur={e => { void onSaveWeekDescription(e.target.value); }}
    placeholder="Week brief — tell the athlete what to expect this week…"
    rows={1}
    style={{
      width: '100%',
      fontSize: 'var(--text-body)',
      color: 'var(--color-text-primary)',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflow: 'hidden',
      lineHeight: 1.55,
      minHeight: '1.5rem',
      fontFamily: 'var(--font-sans)',
    }}
  />
</div>
```

The placeholder color needs to come from the tokens. Add a class to
allow styling, or use a placeholder style rule. For consistency with
other inputs, this already inherits the token placeholder color via
`emos-input` — but since this is a minimal textarea without that
class, add an inline rule:

Add this CSS rule to `src/styles/tokens.css` at the bottom (append;
don't remove existing rules):

```css
/* Planner week notes textarea placeholder */
.planner-week-notes::placeholder {
  color: var(--color-text-tertiary);
}
```

And add `className="planner-week-notes"` to the textarea.

Run `npm run build`.

---

## STEP 9: MIGRATE THE ATHLETE PROFILE DIALOG

The dialog is a custom modal. Replace the entire
`{showAthleteProfile && ...}` block with a `<Modal>` primitive.

Replace this block:
```tsx
{showAthleteProfile && selectedAthlete && (
  <div
    className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in"
    onClick={() => setShowAthleteProfile(false)}
  >
    <div
      className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm animate-dialog-in"
      onClick={e => e.stopPropagation()}
    >
    ...
    </div>
  </div>
)}
```

With:
```tsx
{showAthleteProfile && selectedAthlete && (
  <Modal
    isOpen={true}
    onClose={() => setShowAthleteProfile(false)}
    size="sm"
    title={
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        {selectedAthlete.photo_url ? (
          <img
            src={selectedAthlete.photo_url}
            alt={selectedAthlete.name}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '0.5px solid var(--color-border-tertiary)',
            }}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'var(--color-accent-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <UserIcon size={18} style={{ color: 'var(--color-accent)' }} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 'var(--text-section)', fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
            {selectedAthlete.name}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0 var(--space-md)',
              marginTop: '4px',
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {athleteAge !== null && <span>{athleteAge} y/o</span>}
            {selectedAthlete.weight_class && <span>−{selectedAthlete.weight_class} kg</span>}
            {selectedAthlete.bodyweight && <span>{selectedAthlete.bodyweight} kg</span>}
            {selectedAthlete.club && (
              <span style={{ fontFamily: 'var(--font-sans)' }}>{selectedAthlete.club}</span>
            )}
          </div>
        </div>
      </div>
    }
    footer={
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { setShowAthleteProfile(false); navigate('/athletes'); }}
      >
        Open full profile →
      </Button>
    }
  >
    {/* Competition PRs */}
    {competitionPRs.length > 0 && (
      <div style={{ marginBottom: 'var(--space-lg)' }}>
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            fontWeight: 500,
            marginBottom: 'var(--space-sm)',
          }}
        >
          Competition lifts
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          {competitionPRs.map(pr => (
            <div
              key={pr.exerciseName}
              style={{
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-sm) var(--space-md)',
                border: '0.5px solid var(--color-border-tertiary)',
                minWidth: '80px',
              }}
            >
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                {pr.exerciseName}
              </div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 500,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: '2px',
                }}
              >
                {pr.value}
                <span
                  style={{
                    fontSize: 'var(--text-label)',
                    fontWeight: 400,
                    color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-sans)',
                    marginLeft: '3px',
                  }}
                >
                  kg
                </span>
              </div>
            </div>
          ))}
          {competitionPRs.length >= 2 && (
            <div
              style={{
                background: 'var(--color-info-bg)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-sm) var(--space-md)',
                border: '0.5px solid var(--color-info-border)',
                minWidth: '80px',
              }}
            >
              <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-info-text)' }}>
                Total
              </div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 500,
                  color: 'var(--color-info-text)',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  marginTop: '2px',
                }}
              >
                {competitionPRs.reduce((s, p) => s + p.value, 0)}
                <span
                  style={{
                    fontSize: 'var(--text-label)',
                    fontWeight: 400,
                    opacity: 0.7,
                    fontFamily: 'var(--font-sans)',
                    marginLeft: '3px',
                  }}
                >
                  kg
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Notes */}
    {selectedAthlete.notes && (
      <div>
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            fontWeight: 500,
            marginBottom: '6px',
          }}
        >
          Notes
        </div>
        <p
          style={{
            fontSize: 'var(--text-body)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.55,
            whiteSpace: 'pre-line',
            margin: 0,
          }}
        >
          {selectedAthlete.notes}
        </p>
      </div>
    )}
  </Modal>
)}
```

Run `npm run build`.

---

## STEP 10: VERIFY

Navigate to `/planner` with an athlete selected, pick a week, and verify:

1. ✅ Athlete avatar is a clean circle with accent-muted background
2. ✅ Athlete name is medium weight (500), not bold (700)
3. ✅ Prev / Next buttons use `<Button variant="ghost">`
4. ✅ Date range "13-19/04/2026" is in mono
5. ✅ "Week 3 of 4" subtext is tertiary caption
6. ✅ Icon buttons (settings, copy, paste, print, chart) use `IconButton`
   helper, subtle hover
7. ✅ Metrics row: S/R/Max/Avg/T/K labels are small (11px), tertiary color,
   no uppercase
8. ✅ Numbers are in mono
9. ✅ Compliance percentage uses token success/warning/danger colors
10. ✅ Categories toggle button is subtle, not highlighted
11. ✅ Macro breadcrumb shows `Smolov Base Mesocycle` with a pill badge
    for the week type; badge uses token colors
12. ✅ Phase/week timeline bar: white labels readable, week numbers mono,
    current week has white bottom accent
13. ✅ Week brief textarea: no visible border, token colors
14. ✅ Double-click athlete avatar → profile modal opens using `<Modal>`
15. ✅ Modal shows competition PRs in tinted cards with mono values
16. ✅ No console errors
17. ✅ Everything else in the page works (day cards, exercise editing,
    nothing broken at the boundary between migrated control panel and
    un-migrated day content below)

---

## STEP 11: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(planner): migrate PlannerControlPanel to design system

- Replace Tailwind classes with CSS tokens throughout
- Typography: sentence case, weight 500 max, mono for numbers
- Add local IconButton, MetricItem, MetricSeparator, CategoryMetric
  helpers to remove repetition
- weekTypeBadgeStyle and complianceColor now return token values
  instead of Tailwind class strings
- Athlete profile dialog migrates to <Modal> primitive
- Metric strip, categories strip, schedule indicator, macro phase
  timeline, and week notes textarea all use token-based styling

Visual only. No behavioral changes. Day cards and week overview
remain unchanged; the mismatch at the boundary is intentional —
they migrate in later phases."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ Control panel renders with sentence case, medium weight, no bold
3. ✅ Mono used consistently for all numbers
4. ✅ Macro week-type badge uses token colors (not hardcoded Tailwind)
5. ✅ Compliance percentage uses semantic success/warning/danger
6. ✅ Icon buttons behave correctly (hover, disabled, flash states)
7. ✅ Modal opens on double-click athlete avatar
8. ✅ No console errors
9. ✅ Day cards below the panel still work (not touched)
10. ✅ Committed and pushed

---

## NEXT STEP

Phase 2: Migrate `PlannerWeekOverview` (the list view of weeks
showing W1, W2, W3...). This is the second-most-visible planner
surface.
