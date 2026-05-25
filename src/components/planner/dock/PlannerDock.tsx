import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Search, X } from 'lucide-react';
import { useDockState, type DockTab, DOCK_MIN_HEIGHT } from './useDockState';
import { DockExerciseList } from './DockExerciseList';
import { DockTemplateList } from './DockTemplateList';
import { CanvasPanel } from './CanvasPanel';
import type { CanvasItem } from './useCanvasState';
import type { Exercise } from '../../../lib/database.types';

interface TabDef {
  key: DockTab;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'exercises', label: 'Exercises' },
  { key: 'templates', label: 'Templates' },
  { key: 'canvas', label: 'Canvas' },
];

const HEADER_HEIGHT = 32;
// Leave at least this much viewport visible above the dock so coaches
// can still see the day cards while resizing.
const VIEWPORT_BUFFER = 120;

interface PlannerDockProps {
  exercises: Exercise[];
  onOpenImport: (templateId: string) => void;
  /** Snapshots parked on the canvas. */
  canvasItems: CanvasItem[];
  /** Remove a single canvas snapshot by id. */
  onCanvasRemove: (id: string) => void;
  /** Empty the canvas. */
  onCanvasClear: () => void;
  /** Forwarded to CanvasPanel — receives raw dataTransfer text/plain when a
   *  planner item is dropped onto the canvas. The parent resolves it (single
   *  exercise vs. day) and snapshots accordingly. */
  onCanvasPlannerDrop: (data: string) => Promise<void> | void;
}

export function PlannerDock({
  exercises,
  onOpenImport,
  canvasItems,
  onCanvasRemove,
  onCanvasClear,
  onCanvasPlannerDrop,
}: PlannerDockProps) {
  const {
    tab, setTab,
    collapsed, setCollapsed,
    query, setQuery,
    exerciseSort, setExerciseSort,
    exerciseCategoryFilter, setExerciseCategoryFilter,
    height, setHeight,
  } = useDockState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [resizing, setResizing] = useState(false);

  // Expose the dock's current height as a CSS var so WeeklyPlanner can
  // pad its content area enough to scroll clear of the fixed dock.
  useEffect(() => {
    const h = collapsed ? HEADER_HEIGHT : height;
    document.documentElement.style.setProperty('--emos-dock-height', `${h}px`);
    return () => {
      document.documentElement.style.removeProperty('--emos-dock-height');
    };
  }, [collapsed, height]);

  const toggleCollapsed = () => setCollapsed(c => !c);

  // "d" hotkey toggles the dock open/closed. Single-key shortcut, so we
  // skip when any modifier is held (Cmd/Ctrl-D should still bookmark the
  // page) and when the user is typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'd' && e.key !== 'D') return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
      setCollapsed(c => !c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCollapsed]);

  const handleSearchFocus = () => {
    if (collapsed) setCollapsed(false);
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    const maxHeight = Math.max(DOCK_MIN_HEIGHT, window.innerHeight - VIEWPORT_BUFFER);
    const proposed = window.innerHeight - e.clientY;
    setHeight(Math.max(DOCK_MIN_HEIGHT, Math.min(maxHeight, proposed)));
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    setResizing(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const placeholder = tab === 'exercises'
    ? 'Search exercises…'
    : tab === 'templates'
    ? 'Search templates…'
    : '';
  const showSearch = tab !== 'canvas';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--emos-sidebar-width, 0)',
        right: 0,
        zIndex: 30,
        background: 'var(--color-bg-primary)',
        borderTop: '0.5px solid var(--color-border-primary)',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        height: collapsed ? HEADER_HEIGHT : height,
        // Disable the height transition while dragging the resize handle —
        // otherwise the dock lags the cursor.
        transition: resizing
          ? 'left 0.15s ease-in-out'
          : 'height 0.15s ease-out, left 0.15s ease-in-out',
      }}
    >
      {!collapsed && (
        <div
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          title="Drag to resize"
          style={{
            position: 'absolute',
            top: -3,
            left: 0,
            right: 0,
            height: 6,
            cursor: 'row-resize',
            zIndex: 2,
            // Hairline visual hint that thickens while dragging.
            background: resizing
              ? 'var(--color-accent-border)'
              : 'transparent',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={e => {
            if (!resizing) {
              (e.currentTarget as HTMLDivElement).style.background = 'var(--color-border-secondary)';
            }
          }}
          onMouseLeave={e => {
            if (!resizing) {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 12px',
          borderBottom: collapsed ? 'none' : '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
          height: HEADER_HEIGHT,
        }}
      >
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand dock (D)' : 'Collapse dock (D)'}
          style={{
            fontSize: 'var(--text-caption)',
            fontWeight: 500,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            background: 'transparent',
            border: 'none',
            padding: '2px 4px',
            margin: 0,
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            transition: 'color var(--transition-fast)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
        >
          Dock
        </button>
        <div style={{ display: 'flex', gap: 2 }}>
          {TABS.map(t => {
            const active = t.key === tab;
            const badge = t.key === 'canvas' && canvasItems.length > 0 ? canvasItems.length : null;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  if (collapsed) setCollapsed(false);
                }}
                onDragEnter={() => {
                  // Auto-switch to a tab when the user drags over its
                  // label. Lets coaches park items on the canvas without
                  // first clicking the tab.
                  if (tab !== t.key) setTab(t.key);
                  if (collapsed) setCollapsed(false);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: active ? 'var(--color-bg-primary)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  boxShadow: active ? 'inset 0 0 0 0.5px var(--color-border-secondary)' : 'none',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                }}
              >
                {t.label}
                {badge != null && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 16,
                      height: 14,
                      padding: '0 4px',
                      fontSize: 9,
                      fontWeight: 500,
                      background: 'var(--color-accent-muted)',
                      color: 'var(--color-accent)',
                      borderRadius: 7,
                      lineHeight: 1,
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {showSearch ? (
          <div style={{ position: 'relative', flex: 1, maxWidth: 320, display: 'flex', alignItems: 'center' }}>
            <Search
              size={11}
              style={{ position: 'absolute', left: 8, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={handleSearchFocus}
              placeholder={placeholder}
              style={{
                width: '100%',
                paddingLeft: 24,
                paddingRight: query ? 22 : 8,
                paddingTop: 3,
                paddingBottom: 3,
                fontSize: 11,
                color: 'var(--color-text-primary)',
                background: 'var(--color-bg-primary)',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--radius-sm)',
                outline: 'none',
                transition: 'border-color var(--transition-fast)',
              }}
              onFocusCapture={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-accent-border)'; }}
              onBlurCapture={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-border-secondary)'; }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                title="Clear search"
                style={{
                  position: 'absolute',
                  right: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, maxWidth: 320 }} />
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand dock (D)' : 'Collapse dock (D)'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {tab === 'exercises' ? (
            <DockExerciseList
              exercises={exercises}
              query={query}
              sort={exerciseSort}
              setSort={setExerciseSort}
              categoryFilter={exerciseCategoryFilter}
              setCategoryFilter={setExerciseCategoryFilter}
            />
          ) : tab === 'templates' ? (
            <DockTemplateList query={query} onOpenImport={onOpenImport} />
          ) : (
            <CanvasPanel
              items={canvasItems}
              onRemove={onCanvasRemove}
              onClear={onCanvasClear}
              onPlannerDrop={onCanvasPlannerDrop}
            />
          )}
        </div>
      )}
    </div>
  );
}

