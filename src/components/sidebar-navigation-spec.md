# Feature: Collapsible Sidebar Navigation

## Overview

Replace the current top-bar horizontal navigation with a vertical collapsible sidebar. The header is simplified to show only the page title and athlete selector.

---

## Layout Structure

```
┌──────────────────────────────────────────────────┐
│ [Page Title]                    [▾ Select Athlete]│  ← Slim header (44px)
├────────┬─────────────────────────────────────────┤
│        │                                         │
│  Side  │                                         │
│  bar   │           Content Area                  │
│        │                                         │
│ 200px  │           (full remaining width)        │
│  or    │                                         │
│ 48px   │                                         │
│        │                                         │
│        │                                         │
├────────┤                                         │
│[« Col.]│                                         │
└────────┴─────────────────────────────────────────┘
```

Root layout: `display: flex` with sidebar + main column. 
Main column: header bar + content area stacked vertically.

---

## Sidebar — Expanded State (200px)

### Section: PLANNING
| Icon          | Label            | Page key           |
|---------------|------------------|--------------------|
| BarChart3     | Dashboard        | `coach_dashboard`  |
| Calendar      | Weekly planner   | `planner`          |
| TrendingUp    | Macro cycles     | `macrocycles`      |
| CalendarDays  | Events           | `events`           |

### Section: ATHLETES
| Icon          | Label            | Page key           |
|---------------|------------------|--------------------|
| Users         | Roster           | `athletes`         |
| UsersRound    | Training groups  | `training_groups`  |
| Eye           | Programme        | `athlete_programme`|
| ClipboardList | Training log     | `athlete_log`      |

### Section: SYSTEM
| Icon          | Label            | Page key           |
|---------------|------------------|--------------------|
| BookOpen      | Exercise library | `library`          |
| Settings      | Settings         | `general_settings` |

### Section headers
- Uppercase, 11px, muted color (text-gray-400)
- 16px top padding to separate from previous section
- In collapsed mode: render as a thin horizontal divider line instead of text

### Bottom area (pinned to bottom)
- Collapse toggle button: `«` chevrons + "Collapse" label
- Separated from nav items by a top border

---

## Sidebar — Collapsed State (48px)

- Only icons visible, centered horizontally
- Section labels become thin divider lines (1px, gray-200)
- Collapse chevrons rotate 180° to point right (`»`), indicating "expand"
- Logo text hidden, only icon remains
- Tooltip on hover showing the page label (native `title` attribute — no custom tooltip needed)
- Active item still highlighted with blue background

---

## Header Bar

Simplified from the current 2-row header to a single slim bar:

```
[Page Title]                              [▾ Athlete Selector]
```

- Height: 44px
- Left: Current page name (text, 16px, font-medium)
- Right: Existing AthleteSelector component (unchanged)
- Bottom border: 1px gray-200
- No logo in header — logo lives in sidebar head
- No navigation elements in header

---

## Sidebar Head (top of sidebar)

```
[⚡ icon] WinWota 2.0
```

- Dumbbell icon (existing) + app name
- In collapsed state: icon only, centered
- Click navigates to Dashboard (same as current logo behavior)
- Bottom border separating from nav items

---

## Interactions

### Collapse/Expand
- Click collapse button → sidebar animates from 200px to 48px (or reverse)
- CSS transition: `width 150ms ease`
- Collapsed state persisted in `localStorage` key: `winwota_sidebar_collapsed`
- On page load: read localStorage, default to expanded

### Navigation
- Click any nav item → set current page (same state-driven routing as current)
- Active item: blue background tint (bg-blue-50), blue text, blue icon
- Hover: light gray background (bg-gray-100)
- All items are always visible (no dropdowns, no nested menus)
- Close any open dropdown menus from old nav (remove showPlanningMenu, showAthleteMenu state)

### Keyboard
- No special keyboard handling needed beyond standard tab navigation

---

## Active Item Highlighting

Current page determines which nav item gets the `active` class:

```typescript
const navItems = [
  { key: 'coach_dashboard', label: 'Dashboard', icon: BarChart3, section: 'planning' },
  { key: 'planner', label: 'Weekly planner', icon: Calendar, section: 'planning' },
  { key: 'macrocycles', label: 'Macro cycles', icon: TrendingUp, section: 'planning' },
  { key: 'events', label: 'Events', icon: CalendarDays, section: 'planning' },
  { key: 'athletes', label: 'Roster', icon: Users, section: 'athletes' },
  { key: 'training_groups', label: 'Training groups', icon: UsersRound, section: 'athletes' },
  { key: 'athlete_programme', label: 'Programme', icon: Eye, section: 'athletes' },
  { key: 'athlete_log', label: 'Training log', icon: ClipboardList, section: 'athletes' },
  { key: 'library', label: 'Exercise library', icon: BookOpen, section: 'system' },
  { key: 'general_settings', label: 'Settings', icon: SettingsIcon, section: 'system' },
];
```

Match `currentPage` against `key` to determine active state.

---

## Styling Details

### Sidebar container
- Background: `bg-gray-50` (subtle distinction from content)
- Right border: `border-r border-gray-200`
- Full height: `h-screen` (or flex-grow in the layout)
- Overflow: `overflow-y-auto` (for small screens with many items — unlikely now, but future-safe)
- `flex-shrink-0` to prevent content from squishing it

### Nav items
- Padding: `py-1.5 px-3` (compact — 6px vertical, 12px horizontal)
- Icon size: 16px
- Gap between icon and label: 8px
- Font: 13px, normal weight
- Color: `text-gray-600` default, `text-gray-900` on hover
- Active: `bg-blue-50 text-blue-700` with icon also blue
- Border-radius: 0 (flush with sidebar edges — no pill shapes)
- Transition: `background-color 100ms`

### Section headers
- Font: 11px, medium weight, uppercase, `tracking-wider`
- Color: `text-gray-400`
- Padding: `pt-4 pb-1 px-3`
- First section: `pt-2` (less top padding since sidebar head is above)

### Collapse button
- Pinned to bottom via `mt-auto` on the sidebar flex layout
- Top border: `border-t border-gray-200`
- Padding: `py-2.5 px-3`
- Color: `text-gray-400`, hover `text-gray-600`
- Chevrons: `ChevronsLeft` icon from lucide-react (rotated 180° when collapsed)

### Content area
- Background: current page background (unchanged — `bg-gradient-to-br from-slate-50 to-slate-100`)
- No max-width constraint from sidebar — pages manage their own max-width internally
- Full height scroll

---

## Implementation Plan

### New file
- `src/components/Sidebar.tsx` — the sidebar component

### Modified files
- `src/App.tsx` — replace header nav with sidebar layout

### Sidebar.tsx Component

Props:
```typescript
interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}
```

Internal state:
```typescript
const [collapsed, setCollapsed] = useState(() => {
  return localStorage.getItem('winwota_sidebar_collapsed') === 'true';
});
```

Persist on toggle:
```typescript
function toggleCollapsed() {
  const next = !collapsed;
  setCollapsed(next);
  localStorage.setItem('winwota_sidebar_collapsed', String(next));
}
```

### App.tsx Changes

**Remove:**
- `showPlanningMenu` / `showAthleteMenu` state
- All dropdown menu rendering
- The entire `<header>` block with horizontal nav buttons
- The `<nav>` element and all navigation buttons

**Replace with:**
```tsx
<div className="flex h-screen">
  <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
  <div className="flex-1 flex flex-col min-w-0">
    {/* Slim header */}
    <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white h-11 flex-shrink-0">
      <span className="font-medium text-gray-900">
        {getPageTitle(currentPage)}
      </span>
      <AthleteSelector
        athletes={athletes}
        selectedAthlete={selectedAthlete}
        onSelectAthlete={setSelectedAthlete}
      />
    </header>
    {/* Content */}
    <main className="flex-1 overflow-y-auto">
      {/* ... existing page rendering ... */}
    </main>
  </div>
</div>
```

Add helper:
```typescript
function getPageTitle(page: Page): string {
  const titles: Record<Page, string> = {
    coach_dashboard: 'Dashboard',
    planner: 'Weekly planner',
    macrocycles: 'Macro cycles',
    events: 'Events',
    athletes: 'Roster',
    training_groups: 'Training groups',
    athlete_programme: 'Programme',
    athlete_log: 'Training log',
    library: 'Exercise library',
    general_settings: 'Settings',
  };
  return titles[page];
}
```

### Content area adjustments
- Remove `max-w-7xl mx-auto` from pages that currently use it IF they should be full-width. Most pages can keep their internal max-width — the sidebar doesn't affect this.
- The main scrolling context moves from `<body>` to the `<main>` element. Pages that have sticky headers or fixed elements may need adjustment (check WeeklyPlanner and MacroCycles).

---

## What NOT to Do

- Do NOT add a router library — keep state-driven page switching
- Do NOT add animations beyond the width transition
- Do NOT add nested/collapsible sub-menus within sections
- Do NOT add a mobile hamburger menu (desktop-first app — address mobile later if needed)
- Do NOT add badges, notification dots, or counters to nav items
- Do NOT move the athlete selector into the sidebar — it stays in the header
- Do NOT add any new dependencies

---

## Edge Cases

- **First load, no localStorage**: Sidebar starts expanded
- **Very small window height**: `overflow-y-auto` on sidebar prevents clipping. Unlikely with only 10 items + 3 section headers.
- **Content area width**: Pages currently use `max-w-7xl` (~1280px). With a 200px sidebar on a 1440px screen, content area is 1240px — still comfortable. On 1280px screens, content is 1080px — still fine. On collapsed sidebar (48px), content gets an extra 152px.
