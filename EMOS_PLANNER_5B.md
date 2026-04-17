# EMOS — PROMPT 5B: PLANNER WEEK OVERVIEW VISUAL MIGRATION

Second phase of the Weekly Planner migration. Migrates
`src/components/planner/PlannerWeekOverview.tsx` (756 lines) — the
overview page where coaches see a vertical stack of weeks they're
moving through.

**Scope is visual only:**
- Typography → tokens (sentence case, weight 500 max, mono for numbers)
- Colors → tokens (replace hardcoded blue/gray/amber/green with EMOS palette)
- Remove the `now` badge (the row's background tint already signals current)
- Use the `<StandardPage>` primitive for Framing A
- Apply `<Button>` primitive to navigation buttons

**Do NOT touch:**
- The macro phase timeline (ribbon at top) — this is addressed in 5c
  when we unify `<MacroPhaseBar>`
- Day card height or multi-session-per-day logic — that's 5d
- Slot-to-weekday mapping logic — that's 5d
- `WeeklyPlanner.tsx` parent wrapper

**Remove while you're here:**
- The `now` badge next to current week number (red pill) — row
  background already signals which week is current

Do not ask for confirmation. Build incrementally. Run `npm run build`
after each step. Commit once at the end with message:
`refactor(planner): migrate PlannerWeekOverview to design system`.

---

## CONTEXT

The `PlannerWeekOverview` is the default view when you enter `/planner`
with an athlete selected. It shows:

1. **Macro context bar** — pill with macro name, phase name, date range
2. **Navigation row** — Earlier / Today / Later
3. **Volume ribbon** — small bar chart showing tonnage per visible week
4. **Week rows** (stacked vertically) — each row has:
   - Meta column (W3, date range, done % progress bar)
   - Day blocks (Mon–Sun cells with exercise bands)
   - Stats column (Target | Planned metrics)

Each week row also has optional **section labels** between phases
(e.g. "Loading" heading before the first week of a loading phase).

---

## STEP 1: IMPORTS AND FRAMING

Edit `src/components/planner/PlannerWeekOverview.tsx`.

At the top of the file, add imports alongside the existing ones:

```tsx
import { StandardPage, Button, Badge } from '../ui';
```

Find the main return statement (around line 502):
```tsx
return (
  <div className="flex flex-col gap-3 py-4 px-2">
```

Wrap the main content in `<StandardPage>` (no `hasSidePanel` prop —
this overview has no side panel). The inner padding is handled inside
StandardPage, so reduce outer padding:

```tsx
return (
  <StandardPage>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
        padding: 'var(--space-lg)',
      }}
    >
```

Also handle the loading and empty states. Find these two early returns:

```tsx
return (
  <div className="flex items-center justify-center h-64 text-sm text-gray-400">
    Select an athlete or group to view the weekly overview.
  </div>
);
```
and
```tsx
return (
  <div className="flex items-center justify-center h-64 text-sm text-gray-400">
    Loading weeks...
  </div>
);
```

Replace both with StandardPage wrappers:

```tsx
return (
  <StandardPage>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '16rem',
        fontSize: 'var(--text-body)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      Select an athlete or group to view the weekly overview.
    </div>
  </StandardPage>
);
```

And:

```tsx
return (
  <StandardPage>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '16rem',
        fontSize: 'var(--text-body)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      Loading weeks…
    </div>
  </StandardPage>
);
```

At the bottom of the main return, the closing `</div>` that wraps the
whole component needs an additional closing for StandardPage. Make sure
the file ends with:

```tsx
      {/* Hint */}
      <div ... >Click any week to open the planner</div>
    </div>
  </StandardPage>
);
}
```

Run `npm run build`.

---

## STEP 2: MIGRATE MACRO CONTEXT BAR

Find the "Macro context bar" block (around line 505). Replace:

```tsx
{currentMacro && (
  <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
    <span className="px-2.5 py-0.5 text-[10px] font-medium rounded-full border"
      style={{
        color: currentPhaseInfo?.phase.color || '#7F77DD',
        borderColor: currentPhaseInfo?.phase.color || '#7F77DD',
        backgroundColor: (currentPhaseInfo?.phase.color || '#7F77DD') + '15',
      }}
    >
      {currentMacro.macroName}
    </span>
    {currentPhaseInfo && (
      <span className="text-[11px] text-gray-500">
        {currentPhaseInfo.phase.phaseName}
      </span>
    )}
    <span className="ml-auto text-[10px] text-gray-400">
      {formatDateShort(currentMacro.startDate)} – {formatDateShort(currentMacro.endDate)}
    </span>
  </div>
)}
```

With token-based version. Keep the phase color for the pill — that's
entity coloring (phase identity) and is legitimate. But derive bg/border
from token alphas rather than hex concatenation, and use proper
typography:

```tsx
{currentMacro && (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm)',
      paddingBottom: 'var(--space-md)',
      borderBottom: '0.5px solid var(--color-border-tertiary)',
    }}
  >
    <span
      style={{
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: 'var(--text-caption)',
        fontWeight: 500,
        border: `0.5px solid ${currentPhaseInfo?.phase.color || 'var(--color-purple-400)'}`,
        color: currentPhaseInfo?.phase.color || 'var(--color-purple-600)',
        background: `color-mix(in srgb, ${currentPhaseInfo?.phase.color || 'var(--color-purple-400)'} 10%, transparent)`,
      }}
    >
      {currentMacro.macroName}
    </span>
    {currentPhaseInfo && (
      <span
        style={{
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {currentPhaseInfo.phase.phaseName}
      </span>
    )}
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {formatDateShort(currentMacro.startDate)} – {formatDateShort(currentMacro.endDate)}
    </span>
  </div>
)}
```

**Note:** `color-mix` is in CSS but may not work in all browsers.
Fallback: compute an rgba manually. For simplicity, if color-mix feels
risky, replace `background:` with:
```tsx
background: `${currentPhaseInfo?.phase.color || '#7F77DD'}15`,
```
This preserves the existing behavior (hex + alpha suffix). The test
here is just whether browsers support color-mix. Use the simpler hex
suffix approach and move on.

---

## STEP 3: MIGRATE NAVIGATION ROW

Find the "Navigation" block:

```tsx
<div className="flex items-center justify-between">
  <button
    onClick={() => setCenterDate(addWeeks(centerDate, -1))}
    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
  >
    <ChevronLeft size={14} /> Earlier
  </button>
  <button
    onClick={handleTodayClick}
    className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
  >
    <CalendarDays size={13} /> Today
  </button>
  <button
    onClick={() => setCenterDate(addWeeks(centerDate, 1))}
    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg"
  >
    Later <ChevronRight size={14} />
  </button>
</div>
```

Replace with Button primitives:

```tsx
<div
  style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }}
>
  <Button
    variant="ghost"
    size="sm"
    icon={<ChevronLeft size={14} />}
    onClick={() => setCenterDate(addWeeks(centerDate, -1))}
  >
    Earlier
  </Button>
  <Button
    variant="secondary"
    size="sm"
    icon={<CalendarDays size={13} />}
    onClick={handleTodayClick}
  >
    Today
  </Button>
  <Button
    variant="ghost"
    size="sm"
    icon={<ChevronRight size={14} />}
    iconPosition="right"
    onClick={() => setCenterDate(addWeeks(centerDate, 1))}
  >
    Later
  </Button>
</div>
```

Run `npm run build`.

---

## STEP 4: MIGRATE VOLUME RIBBON

Find the "Volume ribbon" block (simple tonnage bar chart at top):

```tsx
<div className="flex gap-0.5 items-end h-7 px-[72px]">
  {weeks.map(w => {
    const h = maxTonnage > 0 ? (w.totalTonnage / maxTonnage) * 100 : 0;
    const phaseInfo = getPhaseForWeek(w.weekStart);
    const color = phaseInfo?.phase.color || '#888';
    const isCurrent = w.weekStart === today;
    return (
      <div
        key={w.weekStart}
        className="flex-1 rounded-t-sm transition-all"
        style={{
          height: `${Math.max(h, 2)}%`,
          backgroundColor: color + (isCurrent ? '50' : '25'),
          border: isCurrent ? `1px solid ${color}80` : 'none',
        }}
      />
    );
  })}
</div>
```

The ribbon is fine conceptually. Keep the phase colors (entity
coloring) but update the container styling to use tokens:

```tsx
<div
  style={{
    display: 'flex',
    gap: '2px',
    alignItems: 'flex-end',
    height: '28px',
    paddingLeft: '76px',
    paddingRight: '170px',
  }}
>
  {weeks.map(w => {
    const h = maxTonnage > 0 ? (w.totalTonnage / maxTonnage) * 100 : 0;
    const phaseInfo = getPhaseForWeek(w.weekStart);
    const color = phaseInfo?.phase.color || 'var(--color-gray-400)';
    const isCurrent = w.weekStart === today;
    return (
      <div
        key={w.weekStart}
        style={{
          flex: 1,
          height: `${Math.max(h, 2)}%`,
          background: color + (isCurrent ? '50' : '25'),
          border: isCurrent ? `0.5px solid ${color}80` : 'none',
          borderRadius: '2px 2px 0 0',
          transition: 'all 100ms ease-out',
        }}
      />
    );
  })}
</div>
```

Note: I've changed padding from `px-[72px]` symmetric to asymmetric
left-76px / right-170px. This matches the meta column (76px) and stats
column (170px) widths below so the ribbon segments align with the
week's day blocks column. Previously it was centered but not aligned —
small visual improvement while we're here.

---

## STEP 5: MIGRATE WEEK ROWS

This is the largest block. Find the "Week rows" section starting with:

```tsx
<div className="flex flex-col">
  {weeks.map((week, idx) => {
```

This contains many hardcoded color values. We'll migrate it piece by
piece, keeping the structure intact.

### 5.1 Section label (phase headers between week groups)

Find:
```tsx
{sectionLabel && (
  <div className="flex items-center gap-2 py-2 mt-2">
    <span className="text-[10px] text-gray-400 font-medium">{sectionLabel}</span>
    <span className="flex-1 h-px bg-gray-200" />
  </div>
)}
```

Replace with:
```tsx
{sectionLabel && (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-sm)',
      padding: 'var(--space-sm) 0',
      marginTop: 'var(--space-sm)',
    }}
  >
    <span
      style={{
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-secondary)',
        fontWeight: 500,
      }}
    >
      {sectionLabel}
    </span>
    <span
      style={{
        flex: 1,
        height: '0.5px',
        background: 'var(--color-border-tertiary)',
      }}
    />
  </div>
)}
```

### 5.2 Week row container

Find:
```tsx
<div
  onClick={() => onSelectWeek(week.weekStart)}
  className={`flex flex-col py-3 px-3 -mx-3 rounded-xl cursor-pointer transition-colors ${
    isCurrent
      ? 'bg-blue-100 border-2 border-blue-400 shadow-sm'
      : 'hover:bg-gray-50 border border-transparent'
  }`}
>
```

Replace with:
```tsx
<div
  onClick={() => onSelectWeek(week.weekStart)}
  style={{
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-md)',
    margin: '0 calc(-1 * var(--space-md))',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    transition: 'background 100ms ease-out, border-color 100ms ease-out',
    background: isCurrent ? 'var(--color-info-bg)' : 'transparent',
    border: isCurrent
      ? '0.5px solid var(--color-accent)'
      : '0.5px solid transparent',
    boxShadow: 'none',
  }}
  onMouseEnter={e => {
    if (!isCurrent) e.currentTarget.style.background = 'var(--color-bg-secondary)';
  }}
  onMouseLeave={e => {
    if (!isCurrent) e.currentTarget.style.background = 'transparent';
  }}
>
```

**Key changes:**
- Current week: `bg-blue-100 border-2 border-blue-400 shadow-sm` → `info-bg` + 0.5px accent border, no shadow
- Non-current hover: `bg-gray-50` → `bg-secondary`
- 2px border thickness → 0.5px hairline (matches design system)
- Rounded-xl → radius-lg (8px)

### 5.3 Meta column (week number + dates + compliance)

Find:
```tsx
<div className="w-[76px] flex-shrink-0 flex flex-col justify-center">
  <div className="flex items-center gap-1">
    <span className="text-sm font-semibold text-gray-900">
      {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
    </span>
    {isCurrent && (
      <span className="text-[7px] font-medium bg-red-100 text-red-600 px-1 py-px rounded">
        now
      </span>
    )}
  </div>
  <div className="text-[10px] text-gray-400 mt-0.5">
    {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
  </div>
  {week.compliance !== null && (
    <div className="mt-1.5">
      <div className="h-[3px] bg-gray-100 rounded-full overflow-hidden w-full">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.round(week.compliance * 100)}%`,
            backgroundColor: week.compliance >= 0.9 ? '#639922'
              : week.compliance >= 0.5 ? '#378ADD'
              : '#BA7517',
          }}
        />
      </div>
      <span className="text-[9px] text-gray-400 mt-0.5">
        Done: {Math.round(week.compliance * 100)}%{isCurrent && week.compliance < 1 ? ' (prog.)' : ''}
      </span>
    </div>
  )}
</div>
```

Replace with (notice: the `now` badge is removed):
```tsx
<div
  style={{
    width: '76px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  }}
>
  <span
    style={{
      fontSize: 'var(--text-body)',
      fontWeight: 500,
      color: 'var(--color-text-primary)',
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {weekNum || formatDateShort(week.weekStart).split(' ')[1]}
  </span>
  <div
    style={{
      fontSize: 'var(--text-caption)',
      color: 'var(--color-text-tertiary)',
      marginTop: '2px',
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {formatDateShort(week.weekStart)}–{formatDateShort(endDate).split(' ')[1]}
  </div>
  {week.compliance !== null && (
    <div style={{ marginTop: '6px' }}>
      <div
        style={{
          height: '3px',
          background: 'var(--color-bg-tertiary)',
          borderRadius: '999px',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: '999px',
            width: `${Math.round(week.compliance * 100)}%`,
            background: week.compliance >= 0.9
              ? 'var(--color-success-border)'
              : week.compliance >= 0.5
              ? 'var(--color-accent)'
              : 'var(--color-warning-border)',
          }}
        />
      </div>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          marginTop: '2px',
          display: 'block',
        }}
      >
        Done: {Math.round(week.compliance * 100)}%{isCurrent && week.compliance < 1 ? ' (prog.)' : ''}
      </span>
    </div>
  )}
</div>
```

**Changes:**
- `now` badge removed entirely (row background signals current)
- Week number now in mono (consistent with design system)
- Compliance bar colors: hardcoded hex → token references (success/accent/warning)
- Date range in mono for tabular digits

### 5.4 Day blocks

Find the day blocks section:
```tsx
<div className="flex-1 flex gap-1 items-stretch" style={{ minHeight: 90 }}>
  {week.days.map((day) => {
    ...
    return (
      <div
        key={di}
        className={`flex-1 rounded-md flex flex-col px-1 pt-1 pb-1.5 min-w-0 ${
          day.isRest
            ? isCurrent ? 'bg-blue-50 opacity-40' : 'bg-gray-50 opacity-30'
            : isEmpty
            ? 'border border-dashed border-gray-200'
            : faded
            ? isCurrent
              ? 'border border-dashed border-blue-300 bg-white/70'
              : 'border border-dashed border-gray-300 bg-gray-50/40'
            : isCurrent
            ? 'border border-blue-300 bg-white shadow-sm'
            : 'border border-gray-200 bg-white'
        }`}
      >
```

This is the most complex style logic in the file (5-state cell based
on isRest / isEmpty / faded / isCurrent). Replace with an inline
function that returns a token-based style object:

```tsx
<div
  style={{
    flex: 1,
    display: 'flex',
    gap: '4px',
    alignItems: 'stretch',
    minHeight: '90px',
  }}
>
  {week.days.map((day) => {
    const di = day.dayIndex;
    const dayIsFuture = isFuture || (isCurrent && di >= new Date().getDay() - 1);
    const hasData = day.exercises.length > 0;
    const faded = dayIsFuture && !isPast;

    const cellStyle: React.CSSProperties = day.isRest
      ? {
          background: 'var(--color-bg-secondary)',
          opacity: 0.35,
          border: 'none',
        }
      : isEmpty
      ? {
          background: 'transparent',
          border: '0.5px dashed var(--color-border-tertiary)',
        }
      : faded
      ? {
          background: isCurrent
            ? 'rgba(255, 255, 255, 0.7)'
            : 'var(--color-bg-secondary)',
          border: `0.5px dashed ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-secondary)'}`,
          opacity: 0.6,
        }
      : {
          background: 'var(--color-bg-primary)',
          border: `0.5px solid ${isCurrent ? 'var(--color-accent-border)' : 'var(--color-border-tertiary)'}`,
        };

    return (
      <div
        key={di}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 4px 6px',
          minWidth: 0,
          borderRadius: 'var(--radius-md)',
          ...cellStyle,
        }}
      >
        {/* Day label */}
        <div
          style={{
            fontSize: 'var(--text-caption)',
            fontWeight: 500,
            color: 'var(--color-text-tertiary)',
            textAlign: 'center',
            marginBottom: '4px',
            letterSpacing: '0.02em',
          }}
        >
          {DAY_LABELS[di]}
        </div>

        {/* Exercise bands — colored stripe + name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
          {day.exercises.slice(0, 6).map((ex, ei) => (
            <div
              key={ei}
              style={{
                borderRadius: 'var(--radius-sm)',
                padding: '1px 4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                minWidth: 0,
                background: ex.color + (faded ? '15' : '22'),
                borderLeft: `2px solid ${ex.color}${faded ? '55' : 'cc'}`,
              }}
            >
              <span
                style={{
                  fontSize: 'var(--text-caption)',
                  lineHeight: 1.3,
                  fontWeight: 500,
                  color: faded ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ex.name}
              </span>
            </div>
          ))}
          {day.exercises.length > 6 && (
            <span
              style={{
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                paddingLeft: '4px',
              }}
            >
              +{day.exercises.length - 6}
            </span>
          )}
        </div>

        {/* Metric strip */}
        {hasData && (
          <MetricStrip
            metrics={day.dayMetrics}
            visibleMetrics={visibleMetrics}
            size="sm"
            showLabels={false}
            separator="·"
            className={`text-caption leading-tight justify-center mt-1 ${faded ? 'opacity-40' : ''}`}
          />
        )}
      </div>
    );
  })}
</div>
```

**Changes:**
- 5-state cell logic extracted to a `cellStyle` object (readable)
- Borders: 1px → 0.5px hairline (design system)
- Shadows removed (no shadows in EMOS)
- Hardcoded `blue-50/blue-300/gray-200/gray-300` → token references
- Exercise bands keep their entity coloring (legitimate — that's the
  exercise's identity color)
- MetricStrip className kept since it's the existing primitive

### 5.5 Stats column (Target | Planned)

Find:
```tsx
<div className="w-[170px] flex-shrink-0 flex flex-col justify-center pl-3 border-l border-gray-200">
  {/* Column headers */}
  <div className="flex items-center gap-1 mb-1">
    <div className="w-10 text-[8px] text-gray-400" />
    <div className="flex-1 text-[8px] text-gray-400 text-right">Target</div>
    <div className="flex-1 text-[8px] text-gray-500 font-medium text-right">Planned</div>
  </div>
  {METRICS.filter(m => (visibleSummaryMetrics as string[]).includes(m.key)).map(m => {
    ...
    return (
      <div key={m.key} className="flex items-center gap-1 py-px">
        <div className="w-10 text-[9px] text-gray-500 font-medium">{m.label}</div>
        <div className="flex-1 text-[10px] text-gray-400 text-right tabular-nums">
          {formatMetricValue(m.key, targetVal)}
        </div>
        <div className="flex-1 text-[10px] font-semibold text-gray-700 text-right tabular-nums">
          {formatMetricValue(m.key, actualVal)}
        </div>
      </div>
    );
  })}
</div>
```

Replace with:
```tsx
<div
  style={{
    width: '170px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingLeft: 'var(--space-md)',
    borderLeft: '0.5px solid var(--color-border-tertiary)',
  }}
>
  {/* Column headers */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginBottom: '4px',
    }}
  >
    <div style={{ width: '40px' }} />
    <div
      style={{
        flex: 1,
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-tertiary)',
        textAlign: 'right',
      }}
    >
      Target
    </div>
    <div
      style={{
        flex: 1,
        fontSize: 'var(--text-caption)',
        color: 'var(--color-text-secondary)',
        fontWeight: 500,
        textAlign: 'right',
      }}
    >
      Planned
    </div>
  </div>
  {METRICS.filter(m => (visibleSummaryMetrics as string[]).includes(m.key)).map(m => {
    const actualVal = week.weekMetrics[m.key] as number | null;
    const targetVal = week.macroTargets
      ? m.key === 'reps' ? week.macroTargets.reps
        : m.key === 'tonnage' ? week.macroTargets.tonnage
        : m.key === 'avg' ? week.macroTargets.avg
        : null
      : null;
    return (
      <div
        key={m.key}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '1px 0',
        }}
      >
        <div
          style={{
            width: '40px',
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
            fontWeight: 500,
          }}
        >
          {m.label}
        </div>
        <div
          style={{
            flex: 1,
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatMetricValue(m.key, targetVal)}
        </div>
        <div
          style={{
            flex: 1,
            fontSize: 'var(--text-caption)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatMetricValue(m.key, actualVal)}
        </div>
      </div>
    );
  })}
</div>
```

**Changes:**
- All text sizes to token-based 11px caption
- Font weights to 500 max
- Border-left to hairline 0.5px
- Numbers consistently in mono

Run `npm run build`.

---

## STEP 6: MIGRATE HINT FOOTER

Find:
```tsx
<div className="text-[9px] text-gray-400 text-center pt-2">
  Click any week to open the planner
</div>
```

Replace with:
```tsx
<div
  style={{
    fontSize: 'var(--text-caption)',
    color: 'var(--color-text-tertiary)',
    textAlign: 'center',
    paddingTop: 'var(--space-sm)',
  }}
>
  Click any week to open the planner
</div>
```

---

## STEP 7: VERIFY

Navigate to `/planner` with an athlete selected (the overview view).
Verify:

1. ✅ Page is wrapped in Framing A (framed white surface, off-white bg,
   48px horizontal air to sidebar)
2. ✅ Macro context pill at top uses phase color with subtle border and
   tint background
3. ✅ Navigation buttons use Button primitive (Earlier / Today / Later)
4. ✅ Volume ribbon aligns with the day-blocks column of week rows
5. ✅ Current week row: subtle `info-bg` tint + 0.5px accent border
   (no more bright blue-100 + 2px blue-400)
6. ✅ Hover on non-current weeks: subtle gray tint
7. ✅ **No `now` badge** on current week (removed)
8. ✅ Week number ("W3") in mono
9. ✅ Date ranges in mono
10. ✅ Compliance bar colors use token semantics (success/accent/warning)
11. ✅ Day cells: hairline borders only, no shadows, no thick blue borders
12. ✅ Day labels (Mon/Tue/...) in caption size, tertiary color
13. ✅ Exercise bands keep their entity colors (correct)
14. ✅ Stats column: Target / Planned header in caption, data in mono
15. ✅ "Click any week to open the planner" hint in caption tertiary
16. ✅ No console errors
17. ✅ Clicking any week still navigates to the weekly planner detail view
18. ✅ Earlier/Today/Later still change the visible week range

---

## STEP 8: COMMIT

```bash
npm run build
```

Must pass.

```bash
git add -A
git commit -m "refactor(planner): migrate PlannerWeekOverview to design system

- Wrap in <StandardPage> for Framing A (white work surface, 48px
  horizontal air, off-white page background)
- Replace Tailwind classes with CSS tokens throughout
- Typography: mono for all numbers (week labels, dates, metrics),
  sentence case, weight 500 max
- Current week: bg-blue-100 + 2px border + shadow → info-bg + 0.5px
  accent border, no shadow
- Compliance bar colors use token semantics
- Remove 'now' badge next to current week (row background already
  signals current state)
- Navigation buttons use <Button> primitive
- Day cell state logic (rest / empty / faded / current) extracted
  to readable cellStyle object using token references

Visual only. No behavioral changes. Macro phase timeline ribbon
will be unified with the weekly-planner's bar in a separate prompt
(5c) when we extract a shared <MacroPhaseBar> component."
```

Push to remote.

---

## VERIFICATION CHECKLIST

1. ✅ `npm run build` passes
2. ✅ Framing A applied via <StandardPage>
3. ✅ Macro context pill uses phase color with token-based alpha
4. ✅ Earlier / Today / Later use <Button variant>
5. ✅ Current week uses info-bg + accent border, no shadow
6. ✅ `now` badge removed
7. ✅ Week numbers and dates in mono
8. ✅ Compliance bar uses token colors
9. ✅ Day cells use hairline borders
10. ✅ Stats column right-aligned, mono values
11. ✅ No console errors
12. ✅ Committed and pushed

---

## NEXT STEP

Phase 5c: Extract a shared `<MacroPhaseBar>` component into
`src/components/planning/MacroPhaseBar.tsx`. It will render per-week
granularity with phase color as background and week-type encoded via
saturation/variation. Used in both the weekly planner (replacing the
existing inline bar) and the overview (replacing the volume ribbon,
which currently serves a slightly different purpose — we'll decide
at that time whether the volume ribbon stays or gets rolled into the
MacroPhaseBar).
