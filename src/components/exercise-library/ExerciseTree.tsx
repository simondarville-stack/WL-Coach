/**
 * ExerciseTree — THE catalogue view (the list/grid views were retired once
 * the tree settled as the way exercises are structured).
 *
 * Renders the whole library as ONE tree: Category → root exercises → child
 * variations, using react-arborist for the drag mechanics (reparent, keyboard,
 * virtualization). Dropping an exercise ONTO another makes it that exercise's
 * child; dropping it onto a Category makes it a top-level exercise of that
 * category. Cycle-forming drops (onto your own descendant) are rejected via the
 * shared exerciseHierarchy guard, so the tree can never corrupt itself.
 *
 * Rows carry the catalogue facts the retired list view used to show: unit,
 * the selected athlete's PR, duplicate-name warning, and the shared-catalogue
 * chip. Read-only rows (viewer role on a club catalogue) show a lock and
 * don't drag.
 *
 * The tree is a pure catalogue view; persistence is delegated to `onMoveExercise`
 * (an optimistic store write in ExerciseLibrary). Dropping also records the
 * dragged position as display_order across the target sibling group.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps, type TreeApi, type DragPreviewProps } from 'react-arborist';
import {
  ChevronRight, GripVertical, Layers, Lock, Plus, AlertTriangle, ChevronsDownUp, ChevronsUpDown,
  Pencil, Archive, GitBranchPlus, ArrowRightLeft, GitMerge, RotateCcw,
} from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { useCoachStore } from '../../store/coachStore';
import { buildParentIndex, wouldCreateCycle } from '../../lib/exerciseHierarchy';
import { heatIntensity, describeUsage, type UsageRollup } from '../../lib/exerciseUsage';
import { ColorDot, Badge } from '../ui';
import { LibraryChip } from './LibraryChip';

// ── Persisted expand/collapse state ─────────────────────────────────
// The tree reopens the way the coach left it (per coach, per browser —
// a per-viewer convenience, deliberately not synced). Unknown ids fall
// back to openByDefault, so new categories/exercises start expanded.

const OPEN_STATE_KEY = 'emos_exercise_tree_open';

function loadOpenState(coachId: string): Record<string, boolean> | undefined {
  try {
    const raw = localStorage.getItem(`${OPEN_STATE_KEY}:${coachId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function saveOpenState(coachId: string, state: Record<string, boolean>): void {
  try {
    localStorage.setItem(`${OPEN_STATE_KEY}:${coachId}`, JSON.stringify(state));
  } catch {
    // Storage full/blocked — the tree still works, it just won't remember.
  }
}

// Display labels for any unit a row might carry — includes legacy values
// (rpe, other) so existing exercises tagged with them still render.
const UNIT_LABELS: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  rpe: 'RPE',
  free_text: 'text',
  free_text_reps: 'reps',
  other: 'other',
};

interface ExTreeNode {
  id: string;                 // 'cat:<id>' for categories, exercise.id for exercises
  kind: 'category' | 'exercise';
  name: string;
  color: string | null;
  code: string | null;
  categoryName?: string;      // category nodes: the name to assign on drop-in
  /** The "Unspecified" bucket — a rendering device, not a real category row:
   *  it can't be reordered and owns no display_order. */
  isSynthetic?: boolean;
  isCompetition?: boolean;
  unit: string | null;
  prValue: number | null;     // selected athlete's PR, when one is selected
  isDuplicate: boolean;
  isArchived: boolean;
  libraryLabel: string | null;
  childCount: number;
  /** Every node beneath this one, all levels — drives the drag preview so a
   *  coach can see the whole family is coming along. */
  descendantCount: number;
  children: ExTreeNode[];
}

/** Row context-menu actions, wired by ExerciseLibrary. All optional as a
 *  group: without them, right-click falls through to the browser menu. */
export interface TreeContextActions {
  onEdit: (exerciseId: string) => void;
  onArchive: (exerciseId: string) => void;
  /** Bring an archived exercise back into the catalogue. */
  onRestore: (exerciseId: string) => void;
  /** Create a new exercise pre-parented to this one (its variation). */
  onAddVariation: (parentExerciseId: string) => void;
  /** Editable club catalogues this exercise could move into (empty for club
   *  rows or when the coach edits no club) — one menu item per target. */
  moveTargetsFor: (exerciseId: string) => Array<{ id: string; name: string }>;
  onMoveToLibrary: (exerciseId: string, libraryId: string, libraryName: string) => void;
  /** True when the exercise duplicates a club-catalogue one. */
  hasDuplicate: (exerciseId: string) => boolean;
  onReviewDuplicate: () => void;
}

interface ExerciseTreeProps {
  exercises: Exercise[];
  categories: Category[];
  selectedExerciseId: string | null;
  onSelectExercise: (id: string | null) => void;
  /** Persist a move: parentId=null promotes to a category root (category set);
   *  orderedSiblingIds is the target group's exercise ids in the new order. */
  onMoveExercise: (
    exerciseId: string,
    parentId: string | null,
    category: string | undefined,
    orderedSiblingIds: string[],
  ) => void;
  /** Optional live search — filters exercises by name/code, keeping ancestors. */
  searchTerm?: string;
  /** False for exercises in read-only catalogues (viewer role): the row shows
   *  a lock and cannot be dragged. Omitted = everything editable. */
  canEditExercise?: (id: string) => boolean;
  /** Club catalogue ids the coach can see. A club exercise must stay parented
   *  within its own catalogue (a shared tree must never hang off someone's
   *  personal exercise); personal exercises may parent anywhere visible. */
  clubLibraryIds?: Set<string>;
  /** Selected athlete's PRs — shown right-aligned on rows when present. */
  athletePRMap?: Map<string, { pr_value_kg: number | null; pr_date: string | null }>;
  /** Lower-cased names occurring more than once in the visible set. */
  duplicateNames?: Set<string>;
  /** Catalogue chip label for shared rows (club name); null = own personal. */
  libraryBadge?: (ex: Exercise) => string | null;
  /** "+" affordance on category rows — create an exercise preselecting it. */
  onCreateInCategory?: (categoryName: string) => void;
  /** Right-click menu actions on exercise rows. */
  contextActions?: TreeContextActions;
  /** Usage rollup for a row — omitted when the usage column is off. */
  usageFor?: (exerciseId: string) => UsageRollup | null;
  /** Largest family planned-count in view, for scaling the heat. */
  usageMax?: number;
  /** Window the counts cover, for the tooltip. */
  usageWeeks?: number;
  /** False for categories in read-only catalogues — they don't drag. */
  canEditCategory?: (categoryId: string) => boolean;
  /** Persist a category reorder (real category ids, in the new order).
   *  Omitted = categories stay fixed buckets. */
  onReorderCategories?: (orderedCategoryIds: string[]) => void;
}

function isProtectedCategory(name: string): boolean {
  return name.toLowerCase().includes('system') || name === 'Unspecified';
}

const ORDER_LAST = Number.MAX_SAFE_INTEGER;
// Manual display_order first (nulls last), then name/code — matches how the
// coach dragged siblings within a parent/category.
const byOrder = (a: Exercise, b: Exercise) =>
  (a.display_order ?? ORDER_LAST) - (b.display_order ?? ORDER_LAST) ||
  (a.exercise_code || a.name).localeCompare(b.exercise_code || b.name);

export function ExerciseTree({
  exercises, categories, selectedExerciseId, onSelectExercise, onMoveExercise, searchTerm,
  canEditExercise, clubLibraryIds, athletePRMap, duplicateNames, libraryBadge, onCreateInCategory,
  contextActions, canEditCategory, onReorderCategories,
  usageFor, usageMax = 0, usageWeeks = 12,
}: ExerciseTreeProps) {
  const parentIndex = useMemo(() => buildParentIndex(exercises), [exercises]);
  const treeRef = useRef<TreeApi<ExTreeNode> | null>(null);
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? '00000000-0000-0000-0000-000000000001');
  // Read once per coach: initialOpenState only matters at mount.
  const initialOpenState = useMemo(() => loadOpenState(activeCoachId), [activeCoachId]);
  const persistOpenState = () => {
    // openState reflects the committed toggle by the time callbacks fire;
    // defer a tick anyway so openAll/closeAll batches are fully applied.
    setTimeout(() => {
      const state = treeRef.current?.openState;
      if (state) saveOpenState(activeCoachId, state);
    }, 0);
  };

  // Context menu state: which exercise, at which viewport position.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // mousedown (not click) so the menu closes before any underlying row
    // handler runs; menu items use onMouseDown themselves to win the race.
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  const libraryById = useMemo(
    () => new Map(exercises.map(e => [e.id, e.library_id] as const)),
    [exercises],
  );

  // Club exercises must keep their parent inside the same catalogue.
  const crossLibraryParent = (dragId: string, parentExerciseId: string): boolean => {
    const dragLib = libraryById.get(dragId);
    if (!dragLib || !clubLibraryIds?.has(dragLib)) return false;
    return libraryById.get(parentExerciseId) !== dragLib;
  };

  const data = useMemo<ExTreeNode[]>(() => {
    const exIds = new Set(exercises.map(e => e.id));
    const childrenByParent = new Map<string, Exercise[]>();
    for (const e of exercises) {
      const p = e.parent_exercise_id;
      if (p && exIds.has(p)) {
        const arr = childrenByParent.get(p) ?? [];
        arr.push(e);
        childrenByParent.set(p, arr);
      }
    }
    const buildEx = (ex: Exercise): ExTreeNode => {
      const kids = (childrenByParent.get(ex.id) ?? []).slice().sort(byOrder);
      const children = kids.map(buildEx);
      return {
        id: ex.id, kind: 'exercise', name: ex.name, color: ex.color, code: ex.exercise_code,
        isCompetition: ex.is_competition_lift,
        unit: UNIT_LABELS[ex.default_unit as string] ?? (ex.default_unit as string) ?? null,
        prValue: athletePRMap?.get(ex.id)?.pr_value_kg ?? null,
        isDuplicate: duplicateNames?.has(ex.name.toLowerCase()) ?? false,
        isArchived: ex.is_archived,
        libraryLabel: libraryBadge?.(ex) ?? null,
        childCount: kids.length,
        descendantCount: children.reduce((n, c) => n + 1 + c.descendantCount, 0),
        children,
      };
    };

    // Display roots: no parent, or a parent that isn't loaded (archived/other) —
    // so a re-parented-to-a-gone-parent exercise never vanishes. System
    // sentinels (TEXT/GPP/VIDEO/IMAGE) are excluded from the tree.
    const knownNames = new Set(categories.map(c => c.name));
    const roots = exercises.filter(
      e => (!e.parent_exercise_id || !exIds.has(e.parent_exercise_id)) && e.category !== '— System',
    );
    const rootsByCat = new Map<string, Exercise[]>();
    const unspecified: Exercise[] = [];
    for (const e of roots) {
      const cat = e.category;
      if (cat && knownNames.has(cat) && !isProtectedCategory(cat)) {
        const arr = rootsByCat.get(cat) ?? [];
        arr.push(e);
        rootsByCat.set(cat, arr);
      } else {
        unspecified.push(e);
      }
    }

    const catNode = (
      id: string, name: string, color: string | null, rs: Exercise[], isSynthetic = false,
    ): ExTreeNode => {
      const children = rs.slice().sort(byOrder).map(buildEx);
      return {
        id: `cat:${id}`, kind: 'category', name, color, code: null, categoryName: name, isSynthetic,
        unit: null, prValue: null, isDuplicate: false, isArchived: false, libraryLabel: null,
        childCount: rs.length,
        descendantCount: children.reduce((n, c) => n + 1 + c.descendantCount, 0),
        children,
      };
    };

    const visibleCategories = categories
      .filter(c => !isProtectedCategory(c.name))
      .sort((a, b) => a.display_order - b.display_order);

    return [
      ...visibleCategories.map(c => catNode(c.id, c.name, c.color, rootsByCat.get(c.name) ?? [])),
      ...(unspecified.length
        ? [catNode('__unspecified__', 'Unspecified', 'var(--color-gray-400)', unspecified, true)]
        : []),
    ];
  }, [exercises, categories, athletePRMap, duplicateNames, libraryBadge]);

  // react-arborist virtualizes, so it needs explicit pixel dimensions. The
  // catalogue's layout is content-height driven (no definite parent height), so
  // a CSS height:100% would collapse to 0 — derive the height from the viewport
  // (container top → bottom) instead, and give the container that explicit px
  // height so it doesn't collapse.
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = el.clientWidth || el.parentElement?.clientWidth || 600;
      const height = Math.max(240, Math.floor(window.innerHeight - rect.top - 12));
      setDims({ width, height });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, []);

  /**
   * Usage cell. Planned count carries the heat (that is the coach's own
   * vocabulary); a row that is never planned but IS logged shows the logged
   * count in parentheses instead — athletes do it off-plan, so it must not
   * read as dead. Nothing at all in the window shows a dash: the pruning
   * candidate.
   */
  function UsageCell({ planned, logged, title }: { planned: number; logged: number; title: string }) {
    const intensity = heatIntensity(planned, usageMax);
    const base: React.CSSProperties = {
      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)',
      fontVariantNumeric: 'tabular-nums', textAlign: 'right',
      width: 42, flexShrink: 0, borderRadius: 'var(--radius-sm)',
      padding: '0 4px',
    };
    if (planned > 0) {
      return (
        <span
          title={title}
          style={{
            ...base,
            color: 'var(--color-text-primary)',
            // color-mix keeps this on the brand token instead of a hardcoded
            // rgba; unsupported browsers simply get no tint.
            background: `color-mix(in srgb, var(--color-accent) ${Math.round((0.06 + intensity * 0.36) * 100)}%, transparent)`,
          }}
        >
          {planned}
        </span>
      );
    }
    if (logged > 0) {
      return (
        <span title={title} style={{ ...base, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          ({logged})
        </span>
      );
    }
    return (
      <span title={title} style={{ ...base, color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
        –
      </span>
    );
  }

  function Node({ node, style, dragHandle }: NodeRendererProps<ExTreeNode>) {
    const d = node.data;
    const isCat = d.kind === 'category';
    const selected = !isCat && d.id === selectedExerciseId;
    const catDraggable = isCat && !d.isSynthetic && !!onReorderCategories
      && (canEditCategory ? canEditCategory(d.id.slice(4)) : true);
    return (
      <div
        ref={dragHandle}
        className="group"
        style={{
          ...style,
          display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10,
          background: selected ? 'var(--color-bg-secondary)' : 'transparent',
          borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
          cursor: isCat ? (catDraggable ? 'grab' : 'default') : d.isArchived ? 'default' : 'grab',
          userSelect: 'none',
          // Archived rows stay in place, dimmed — so "where did it go?" has a
          // visible answer and Restore is one right-click away.
          opacity: d.isArchived ? 0.45 : 1,
          fontSize: 'var(--text-label)',
        }}
        onClick={() => {
          if (isCat) { node.toggle(); return; }
          onSelectExercise(d.id === selectedExerciseId ? null : d.id);
        }}
        onContextMenu={contextActions && !isCat ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ id: d.id, x: e.clientX, y: e.clientY });
        } : undefined}
      >
        {d.childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); node.toggle(); }}
            style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
            aria-label={node.isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronRight size={12} style={{ transform: node.isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 100ms ease-out' }} />
          </button>
        ) : (
          <span style={{ width: 12, display: 'inline-block', flexShrink: 0 }} />
        )}

        {isCat ? (
          <>
            <Layers size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <ColorDot color={d.color || 'var(--color-gray-400)'} size={8} />
            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{d.name}</span>
            <span style={countBadge}>{d.childCount}</span>
            {catDraggable && (
              <GripVertical
                size={11}
                className="opacity-0 group-hover:opacity-100"
                style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transition: 'opacity 100ms ease-out' }}
              />
            )}
            {onCreateInCategory && d.categoryName !== 'Unspecified' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateInCategory(d.categoryName!); }}
                title={`Add an exercise to ${d.name}`}
                className="opacity-0 group-hover:opacity-100"
                style={{
                  background: 'none', border: 'none', padding: '0 2px', display: 'flex',
                  cursor: 'pointer', color: 'var(--color-accent)', transition: 'opacity 100ms ease-out',
                }}
              >
                <Plus size={12} />
              </button>
            )}
            {usageFor && (() => {
              // A category's usage is the sum over its root exercises' family
              // totals — those already include their variations, so nothing
              // is double-counted. Answers "is this whole section still alive?"
              let planned = 0;
              let logged = 0;
              for (const child of d.children) {
                const u = usageFor(child.id);
                if (u) { planned += u.family.planned; logged += u.family.logged; }
              }
              return (
                <>
                  <span style={{ flex: 1 }} />
                  <UsageCell
                    planned={planned}
                    logged={logged}
                    title={
                      planned === 0 && logged === 0
                        ? `Nothing in ${d.name} was planned or logged in the last ${usageWeeks} weeks.`
                        : `${d.name}: planned ${planned}×, logged ${logged}× in the last ${usageWeeks} weeks.`
                    }
                  />
                </>
              );
            })()}
          </>
        ) : (
          <>
            <ColorDot color={d.color || 'var(--color-gray-400)'} size={6} />
            {d.code && (
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                {d.code}
              </span>
            )}
            <span style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name}
            </span>
            {d.isCompetition && <Badge variant="danger">COMP</Badge>}
            {d.isArchived && (
              <span
                title="Archived — hidden from planning until restored"
                style={{
                  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                  border: '0.5px solid var(--color-border-tertiary)', borderRadius: 999,
                  padding: '0 5px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                archived
              </span>
            )}
            {d.libraryLabel && <LibraryChip label={d.libraryLabel} />}
            {d.isDuplicate && (
              <span title="Duplicate exercise name" style={{ display: 'inline-flex', flexShrink: 0 }}>
                <AlertTriangle size={11} style={{ color: 'var(--color-warning-text)' }} aria-label="Duplicate exercise name" />
              </span>
            )}
            {d.childCount > 0 && <span style={countBadge} title={`${d.childCount} variation(s)`}>{d.childCount}</span>}
            <span style={{ flex: 1 }} />
            {usageFor && (() => {
              const u = usageFor(d.id);
              return (
                <UsageCell
                  planned={u?.family.planned ?? 0}
                  logged={u?.family.logged ?? 0}
                  title={describeUsage(u ?? { own: { planned: 0, logged: 0 }, family: { planned: 0, logged: 0 } }, usageWeeks)}
                />
              );
            })()}
            {d.prValue != null && (
              <span
                title="Selected athlete's PR"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)',
                  color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                }}
              >
                {d.prValue}<span style={{ color: 'var(--color-text-tertiary)' }}> kg</span>
              </span>
            )}
            {d.unit && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', flexShrink: 0, width: 34, textAlign: 'right' }}>
                {d.unit}
              </span>
            )}
            {d.isArchived ? (
              <span title="Archived" style={{ display: 'flex', flexShrink: 0 }}>
                <Archive size={10} style={{ color: 'var(--color-text-tertiary)' }} />
              </span>
            ) : canEditExercise && !canEditExercise(d.id) ? (
              <span title="Read-only — shared catalogue" style={{ display: 'flex', flexShrink: 0 }}>
                <Lock size={10} style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }} />
              </span>
            ) : (
              <GripVertical size={11} style={{ color: 'var(--color-text-tertiary)', opacity: 0.5, flexShrink: 0 }} />
            )}
          </>
        )}
      </div>
    );
  }

  /** Drag preview: a pill following the cursor that names what is moving and,
   *  for a parent, how many variations travel with it — the subtree moves as
   *  one family (edges are child→parent), which a single-row ghost hides. */
  function DragPreview({ offset, mouse, id, isDragging }: DragPreviewProps) {
    if (!isDragging || !offset || !mouse || !id) return null;
    const node = treeRef.current?.get(id);
    if (!node) return null;
    const d = node.data;
    const isCat = d.kind === 'category';
    const carried = isCat ? d.childCount : d.descendantCount;
    return (
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200 }}>
        <div
          style={{
            position: 'absolute', left: 0, top: 0,
            transform: `translate(${mouse.x + 14}px, ${mouse.y + 10}px)`,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--color-bg-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
            padding: '3px 9px', fontSize: 'var(--text-caption)',
            color: 'var(--color-text-primary)', whiteSpace: 'nowrap', maxWidth: 280,
          }}
        >
          {isCat
            ? <Layers size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            : <ColorDot color={d.color || 'var(--color-gray-400)'} size={6} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
          {carried > 0 && (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              +{carried} {isCat
                ? (carried === 1 ? 'exercise' : 'exercises')
                : (carried === 1 ? 'variation' : 'variations')}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Tree controls */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
          padding: '3px 10px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => { treeRef.current?.openAll(); persistOpenState(); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}
        >
          <ChevronsUpDown size={11} /> Expand all
        </button>
        <button
          type="button"
          onClick={() => { treeRef.current?.closeAll(); persistOpenState(); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}
        >
          <ChevronsDownUp size={11} /> Collapse all
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minWidth: 0, width: '100%', height: dims.height || undefined }}>
        {dims.width > 0 && dims.height > 0 && (
          <Tree<ExTreeNode>
            ref={treeRef}
            data={data}
            idAccessor="id"
            childrenAccessor="children"
            width={dims.width}
            height={dims.height}
            rowHeight={30}
            indent={16}
            openByDefault
            initialOpenState={initialOpenState}
            onToggle={() => persistOpenState()}
            searchTerm={searchTerm}
            searchMatch={(node, term) => {
              if (node.data.kind !== 'exercise') return false; // categories kept as ancestors
              const q = term.toLowerCase();
              return node.data.name.toLowerCase().includes(q) || (node.data.code?.toLowerCase().includes(q) ?? false);
            }}
            disableMultiSelection
            // Exercises drag to reparent; real categories drag to reorder.
            // Rows in read-only catalogues (viewer role) and archived rows
            // don't drag at all.
            disableDrag={(d) => {
              if (d.kind === 'category') {
                return d.isSynthetic || !onReorderCategories
                  || (canEditCategory ? !canEditCategory(d.id.slice(4)) : false);
              }
              return d.isArchived || (canEditExercise ? !canEditExercise(d.id) : false);
            }}
            // NB: for a top-level drop react-arborist passes the tree ROOT as
            // parentNode (never null), so the root case must be checked
            // explicitly — categories may land there, exercises may not.
            disableDrop={({ parentNode, dragNodes }) => {
              const drag = dragNodes[0];
              if (!parentNode || !drag) return true;
              if (drag.data.kind === 'category') return !parentNode.isRoot;
              if (parentNode.isRoot) return true;       // exercises live under a category
              if (parentNode.data.kind === 'category') return false;
              return wouldCreateCycle(drag.id, parentNode.id, parentIndex)
                || crossLibraryParent(drag.id, parentNode.id);
            }}
            onMove={({ dragIds, parentNode, index }) => {
              const dragId = dragIds[0];
              if (!dragId || !parentNode) return;

              // Category reorder: rewrite display_order across the real
              // categories in their new top-level order (the synthetic
              // "Unspecified" bucket is not a row and never participates).
              const dragged = treeRef.current?.get(dragId);
              if (dragged?.data.kind === 'category') {
                if (!onReorderCategories || !parentNode.isRoot) return;
                const ids = data
                  .filter(n => !n.isSynthetic)
                  .map(n => n.id)
                  .filter(id => id !== dragId);
                const at = Math.max(0, Math.min(index ?? ids.length, ids.length));
                ids.splice(at, 0, dragId);
                onReorderCategories(ids.map(id => id.slice(4)));
                return;
              }

              const p = parentNode.data;
              let newParentId: string | null;
              let category: string | undefined;
              if (parentNode.isRoot) {
                return; // exercises must live under a category
              } else if (p.kind === 'category') {
                newParentId = null;
                category = p.categoryName;
              } else if (
                !wouldCreateCycle(dragId, parentNode.id, parentIndex)
                && !crossLibraryParent(dragId, parentNode.id)
              ) {
                newParentId = parentNode.id;
                category = undefined;
              } else {
                return; // cycle or cross-catalogue parent — reject
              }
              // The target group's ordered exercise ids after the move, so the
              // dropped position persists as display_order for the whole group.
              const siblings = (p.children ?? []).map(c => c.id).filter(id => id !== dragId);
              const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
              siblings.splice(at, 0, dragId);
              onMoveExercise(dragId, newParentId, category, siblings);
            }}
            renderDragPreview={DragPreview}
          >
            {Node}
          </Tree>
        )}
      </div>

      {/* Row context menu */}
      {menu && contextActions && (() => {
        const canEdit = canEditExercise ? canEditExercise(menu.id) : true;
        const targets = contextActions.moveTargetsFor(menu.id);
        const hasDup = contextActions.hasDuplicate(menu.id);
        const menuId = menu.id;
        const isArchivedRow = treeRef.current?.get(menuId)?.data.isArchived ?? false;
        const itemStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '5px 10px', fontSize: 'var(--text-label)', fontFamily: 'var(--font-sans)',
          color: 'var(--color-text-primary)', background: 'none', border: 'none',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
        };
        const hover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
          e.currentTarget.style.background = on ? 'var(--color-bg-secondary)' : 'none';
        };
        const MenuItem = ({ icon, label, onAct, danger }: {
          icon: React.ReactNode; label: string; onAct: () => void; danger?: boolean;
        }) => (
          <button
            type="button"
            style={{ ...itemStyle, color: danger ? 'var(--color-danger-text, #b91c1c)' : itemStyle.color }}
            onMouseEnter={e => hover(e, true)}
            onMouseLeave={e => hover(e, false)}
            onClick={() => { setMenu(null); onAct(); }}
          >
            {icon}
            {label}
          </button>
        );
        const divider = <div style={{ height: 0.5, background: 'var(--color-border-tertiary)', margin: '3px 6px' }} />;
        return (
          <div
            style={{
              position: 'fixed',
              left: Math.min(menu.x, window.innerWidth - 230),
              top: Math.min(menu.y, window.innerHeight - 240),
              zIndex: 300, minWidth: 200,
              background: 'var(--color-bg-primary)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
              padding: 4,
            }}
            onMouseDown={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
            {!canEdit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                <Lock size={10} /> Read-only — shared catalogue
              </div>
            )}
            {canEdit && (
              <MenuItem icon={<Pencil size={12} />} label="Edit…" onAct={() => contextActions.onEdit(menuId)} />
            )}
            {/* An archived row is out of circulation: restore it before
                hanging variations off it or promoting it to a club. */}
            {isArchivedRow ? (
              canEdit && (
                <MenuItem icon={<RotateCcw size={12} />} label="Restore" onAct={() => contextActions.onRestore(menuId)} />
              )
            ) : (
              <>
                <MenuItem
                  icon={<GitBranchPlus size={12} />}
                  label="Add variation…"
                  onAct={() => contextActions.onAddVariation(menuId)}
                />
                {(targets.length > 0 || hasDup) && divider}
                {targets.map(t => (
                  <MenuItem
                    key={t.id}
                    icon={<ArrowRightLeft size={12} />}
                    label={`Move to "${t.name}"…`}
                    onAct={() => contextActions.onMoveToLibrary(menuId, t.id, t.name)}
                  />
                ))}
                {hasDup && (
                  <MenuItem
                    icon={<GitMerge size={12} />}
                    label="Review duplicate…"
                    onAct={() => contextActions.onReviewDuplicate()}
                  />
                )}
                {canEdit && (
                  <>
                    {divider}
                    <MenuItem icon={<Archive size={12} />} label="Archive" danger onAct={() => contextActions.onArchive(menuId)} />
                  </>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

const countBadge: React.CSSProperties = {
  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
  fontFamily: 'var(--font-mono)', background: 'var(--color-bg-secondary)',
  padding: '0 6px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
};
