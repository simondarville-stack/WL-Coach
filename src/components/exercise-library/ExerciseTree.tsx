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
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist';
import { ChevronRight, GripVertical, Layers, Lock, Plus, AlertTriangle, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { buildParentIndex, wouldCreateCycle } from '../../lib/exerciseHierarchy';
import { ColorDot, Badge } from '../ui';
import { LibraryChip } from './LibraryChip';

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
  isCompetition?: boolean;
  unit: string | null;
  prValue: number | null;     // selected athlete's PR, when one is selected
  isDuplicate: boolean;
  libraryLabel: string | null;
  childCount: number;
  children: ExTreeNode[];
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
}: ExerciseTreeProps) {
  const parentIndex = useMemo(() => buildParentIndex(exercises), [exercises]);
  const treeRef = useRef<TreeApi<ExTreeNode> | null>(null);
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
      return {
        id: ex.id, kind: 'exercise', name: ex.name, color: ex.color, code: ex.exercise_code,
        isCompetition: ex.is_competition_lift,
        unit: UNIT_LABELS[ex.default_unit as string] ?? (ex.default_unit as string) ?? null,
        prValue: athletePRMap?.get(ex.id)?.pr_value_kg ?? null,
        isDuplicate: duplicateNames?.has(ex.name.toLowerCase()) ?? false,
        libraryLabel: libraryBadge?.(ex) ?? null,
        childCount: kids.length,
        children: kids.map(buildEx),
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

    const catNode = (id: string, name: string, color: string | null, rs: Exercise[]): ExTreeNode => ({
      id: `cat:${id}`, kind: 'category', name, color, code: null, categoryName: name,
      unit: null, prValue: null, isDuplicate: false, libraryLabel: null,
      childCount: rs.length, children: rs.slice().sort(byOrder).map(buildEx),
    });

    const visibleCategories = categories
      .filter(c => !isProtectedCategory(c.name))
      .sort((a, b) => a.display_order - b.display_order);

    return [
      ...visibleCategories.map(c => catNode(c.id, c.name, c.color, rootsByCat.get(c.name) ?? [])),
      ...(unspecified.length
        ? [catNode('__unspecified__', 'Unspecified', 'var(--color-gray-400)', unspecified)]
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

  function Node({ node, style, dragHandle }: NodeRendererProps<ExTreeNode>) {
    const d = node.data;
    const isCat = d.kind === 'category';
    const selected = !isCat && d.id === selectedExerciseId;
    return (
      <div
        ref={dragHandle}
        className="group"
        style={{
          ...style,
          display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10,
          background: selected ? 'var(--color-bg-secondary)' : 'transparent',
          borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
          cursor: isCat ? 'default' : 'grab', userSelect: 'none',
          fontSize: 'var(--text-label)',
        }}
        onClick={() => {
          if (isCat) { node.toggle(); return; }
          onSelectExercise(d.id === selectedExerciseId ? null : d.id);
        }}
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
            {d.libraryLabel && <LibraryChip label={d.libraryLabel} />}
            {d.isDuplicate && (
              <span title="Duplicate exercise name" style={{ display: 'inline-flex', flexShrink: 0 }}>
                <AlertTriangle size={11} style={{ color: 'var(--color-warning-text)' }} aria-label="Duplicate exercise name" />
              </span>
            )}
            {d.childCount > 0 && <span style={countBadge} title={`${d.childCount} variation(s)`}>{d.childCount}</span>}
            <span style={{ flex: 1 }} />
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
            {canEditExercise && !canEditExercise(d.id) ? (
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
          onClick={() => treeRef.current?.openAll()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}
        >
          <ChevronsUpDown size={11} /> Expand all
        </button>
        <button
          type="button"
          onClick={() => treeRef.current?.closeAll()}
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
            searchTerm={searchTerm}
            searchMatch={(node, term) => {
              if (node.data.kind !== 'exercise') return false; // categories kept as ancestors
              const q = term.toLowerCase();
              return node.data.name.toLowerCase().includes(q) || (node.data.code?.toLowerCase().includes(q) ?? false);
            }}
            disableMultiSelection
            // Only exercises drag; categories are fixed top-level buckets.
            // Rows in read-only catalogues (viewer role) don't drag either.
            disableDrag={(d) => d.kind === 'category' || (canEditExercise ? !canEditExercise(d.id) : false)}
            // Reject: dropping at the very top (exercises must live under a
            // category), dropping onto your own descendant (cycle), and
            // parenting a club exercise outside its own catalogue.
            disableDrop={({ parentNode, dragNodes }) => {
              if (!parentNode) return true;
              if (parentNode.data.kind === 'category') return false;
              const dragId = dragNodes[0]?.id;
              if (!dragId) return false;
              return wouldCreateCycle(dragId, parentNode.id, parentIndex)
                || crossLibraryParent(dragId, parentNode.id);
            }}
            onMove={({ dragIds, parentNode, index }) => {
              const dragId = dragIds[0];
              if (!dragId || !parentNode) return;
              const p = parentNode.data;
              let newParentId: string | null;
              let category: string | undefined;
              if (p.kind === 'category') {
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
          >
            {Node}
          </Tree>
        )}
      </div>
    </div>
  );
}

const countBadge: React.CSSProperties = {
  fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
  fontFamily: 'var(--font-mono)', background: 'var(--color-bg-secondary)',
  padding: '0 6px', borderRadius: 999, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
};
