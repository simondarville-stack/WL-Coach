/**
 * ExerciseListPanel
 *
 * Toolbar + the exercise TREE. The list and grid views were retired
 * (28/08/2026) once the tree settled as THE way exercises are structured —
 * category → root exercise → variations, drag-to-reparent. The facts those
 * views carried (unit, athlete PR, duplicate flag, catalogue chip) live on
 * the tree rows now.
 *
 * Stateless with respect to exercises/categories — all data and handlers
 * are passed as props. Filters are applied structurally: matching exercises
 * keep their ancestors so a filtered child never floats without context.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search, Plus, Upload, Layers, X as XIcon, AlertTriangle, SlidersHorizontal, Share2, Archive,
} from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { StandardPage, Button, Input } from '../ui';
import { DEFAULT_UNITS } from '../../lib/constants';
import { buildParentIndex } from '../../lib/exerciseHierarchy';
import { ExerciseTree, type TreeContextActions } from './ExerciseTree';

// ── Constants ──────────────────────────────────────────────────────

// Filter options exposed to coaches mirror the canonical create-form
// list so the library shows the same vocabulary the planner uses.
const UNIT_OPTIONS = DEFAULT_UNITS;

const LIFT_SLOT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '__none__', label: 'No slot' },
  { value: 'snatch', label: 'Snatch' },
  { value: 'clean_and_jerk', label: 'Clean & Jerk' },
  { value: 'front_squat', label: 'Front squat' },
  { value: 'back_squat', label: 'Back squat' },
  { value: 'snatch_pull', label: 'Snatch pull' },
  { value: 'clean_pull', label: 'Clean pull' },
];

// ── Filter types ────────────────────────────────────────────────────

interface ExerciseFilters {
  units: string[];
  liftSlots: string[];            // '__none__' represents null lift_slot
  isCompetitionLift: boolean | null;
  countsTowardsTotals: boolean | null;
  trackPr: boolean | null;
}

const EMPTY_FILTERS: ExerciseFilters = {
  units: [],
  liftSlots: [],
  isCompetitionLift: null,
  countsTowardsTotals: null,
  trackPr: null,
};

function countActiveFilters(f: ExerciseFilters): number {
  return (
    (f.units.length > 0 ? 1 : 0) +
    (f.liftSlots.length > 0 ? 1 : 0) +
    (f.isCompetitionLift !== null ? 1 : 0) +
    (f.countsTowardsTotals !== null ? 1 : 0) +
    (f.trackPr !== null ? 1 : 0)
  );
}

function applyFilters(exercises: Exercise[], filters: ExerciseFilters): Exercise[] {
  let list = exercises;
  if (filters.units.length > 0) {
    list = list.filter(ex => filters.units.includes(ex.default_unit as string));
  }
  if (filters.liftSlots.length > 0) {
    list = list.filter(ex => {
      const slot = (ex.lift_slot as string | null) ?? '__none__';
      return filters.liftSlots.includes(slot);
    });
  }
  if (filters.isCompetitionLift !== null) {
    list = list.filter(ex => ex.is_competition_lift === filters.isCompetitionLift);
  }
  if (filters.countsTowardsTotals !== null) {
    list = list.filter(ex => ex.counts_towards_totals === filters.countsTowardsTotals);
  }
  if (filters.trackPr !== null) {
    list = list.filter(ex => ex.track_pr === filters.trackPr);
  }
  return list;
}

// ── FilterPanel ─────────────────────────────────────────────────────

function toggleItem<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

interface FilterPanelProps {
  filters: ExerciseFilters;
  onChange: (next: ExerciseFilters) => void;
  onClear: () => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

function FilterPanel({ filters, onChange, onClear, onClose, anchorRef }: FilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorRef]);

  const sectionLabel: React.CSSProperties = {
    fontSize: 'var(--text-caption)',
    fontWeight: 600,
    color: 'var(--color-text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  };

  const chipBase: React.CSSProperties = {
    fontSize: 'var(--text-caption)',
    fontFamily: 'var(--font-sans)',
    padding: '3px 8px',
    borderRadius: '999px',
    cursor: 'pointer',
    border: '0.5px solid var(--color-border-secondary)',
    transition: 'all 80ms ease-out',
    userSelect: 'none',
  };

  function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...chipBase,
          background: active ? 'var(--color-text-primary)' : 'var(--color-bg-primary)',
          color: active ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
          borderColor: active ? 'var(--color-text-primary)' : 'var(--color-border-secondary)',
        }}
      >
        {label}
      </button>
    );
  }

  function BoolRow({ label, value, onChange: onBoolChange }: {
    label: string;
    value: boolean | null;
    onChange: (v: boolean | null) => void;
  }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)' }}>{label}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Chip label="Yes" active={value === true}  onClick={() => onBoolChange(value === true  ? null : true)}  />
          <Chip label="No"  active={value === false} onClick={() => onBoolChange(value === false ? null : false)} />
        </div>
      </div>
    );
  }

  const hasAny = countActiveFilters(filters) > 0;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        zIndex: 100,
        width: 280,
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        padding: 'var(--space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-label)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Filter exercises
        </span>
        {hasAny && (
          <button
            type="button"
            onClick={onClear}
            style={{
              fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Unit */}
      <div>
        <div style={sectionLabel}>Unit</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {UNIT_OPTIONS.map(opt => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={filters.units.includes(opt.value)}
              onClick={() => onChange({ ...filters, units: toggleItem(filters.units, opt.value) })}
            />
          ))}
        </div>
      </div>

      {/* Lift slot */}
      <div>
        <div style={sectionLabel}>Lift slot</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {LIFT_SLOT_OPTIONS.map(opt => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={filters.liftSlots.includes(opt.value)}
              onClick={() => onChange({ ...filters, liftSlots: toggleItem(filters.liftSlots, opt.value) })}
            />
          ))}
        </div>
      </div>

      {/* Boolean toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <BoolRow
          label="Competition lift"
          value={filters.isCompetitionLift}
          onChange={v => onChange({ ...filters, isCompetitionLift: v })}
        />
        <BoolRow
          label="Counts to totals"
          value={filters.countsTowardsTotals}
          onChange={v => onChange({ ...filters, countsTowardsTotals: v })}
        />
        <BoolRow
          label="Track PR"
          value={filters.trackPr}
          onChange={v => onChange({ ...filters, trackPr: v })}
        />
      </div>
    </div>
  );
}

// ── ExerciseListPanel ──────────────────────────────────────────────

interface ExerciseListPanelProps {
  exercises: Exercise[];
  categories: Category[];
  athletePRMap: Map<string, { pr_value_kg: number | null; pr_date: string | null }>;
  duplicateNames: Set<string>;
  selectedExerciseId: string | null;
  onSelectExercise: (id: string | null) => void;
  onOpenCategoryModal: () => void;
  onOpenBulkImport: () => void;
  /** `category` preselects it in the create form — used by the tree's
   *  per-category "+" so a fresh, empty category is fillable. */
  onCreateExercise: (category?: string) => void;
  onMoveExercise: (
    exerciseId: string,
    parentId: string | null,
    category: string | undefined,
    orderedSiblingIds: string[],
  ) => void;
  hasSidePanel: boolean;
  /** Opens the catalogue-sharing dialog (club libraries, invites, seeding). */
  onOpenSharing: () => void;
  /** Catalogue label for a row (club name / "Shared"); null = own personal
   *  library, no chip. */
  libraryBadge?: (ex: Exercise) => string | null;
  /** False for rows in read-only catalogues (viewer role) — gates tree drag. */
  canEditExercise?: (id: string) => boolean;
  /** Club catalogue ids visible to the coach — the tree uses this to keep
   *  club exercises parented within their own catalogue. */
  clubLibraryIds?: Set<string>;
  /** Personal exercises that duplicate club-catalogue ones (Phase 4 hygiene).
   *  When > 0 the toolbar shows the Duplicates entry point. */
  duplicatesCount?: number;
  onOpenDuplicates?: () => void;
  /** Right-click menu actions on tree rows. */
  contextActions?: TreeContextActions;
  /** Archived rows are rendered dimmed in place when on. */
  showArchived?: boolean;
  onToggleArchived?: (next: boolean) => void;
  archivedCount?: number;
  /** False for categories in read-only catalogues — they don't drag. */
  canEditCategory?: (categoryId: string) => boolean;
  /** Persist a category reorder from the tree. */
  onReorderCategories?: (orderedCategoryIds: string[]) => void;
}

export function ExerciseListPanel({
  exercises,
  categories,
  athletePRMap,
  duplicateNames,
  selectedExerciseId,
  onSelectExercise,
  onOpenCategoryModal,
  onOpenBulkImport,
  onCreateExercise,
  onMoveExercise,
  hasSidePanel,
  onOpenSharing,
  libraryBadge,
  canEditExercise,
  clubLibraryIds,
  duplicatesCount = 0,
  onOpenDuplicates,
  contextActions,
  showArchived = false,
  onToggleArchived,
  archivedCount = 0,
  canEditCategory,
  onReorderCategories,
}: ExerciseListPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExerciseFilters>(EMPTY_FILTERS);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const filterButtonRef = useRef<HTMLDivElement>(null);

  const activeFilterCount = countActiveFilters(filters);

  // Structural filtering: keep every match plus all its ancestors, so a
  // filtered variation never renders without the lift it belongs to.
  const treeExercises = useMemo(() => {
    if (activeFilterCount === 0) return exercises;
    const matched = applyFilters(exercises, filters);
    const parentIndex = buildParentIndex(exercises);
    const keep = new Set<string>();
    for (const ex of matched) {
      let cur: string | null | undefined = ex.id;
      let guard = 0;
      while (cur && !keep.has(cur) && guard++ < 32) {
        keep.add(cur);
        cur = parentIndex.get(cur);
      }
    }
    return exercises.filter(e => keep.has(e.id));
  }, [exercises, filters, activeFilterCount]);

  return (
    <StandardPage hasSidePanel={hasSidePanel}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={14}
            style={{
              position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary)', pointerEvents: 'none',
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
                position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                color: 'var(--color-text-tertiary)', display: 'flex',
              }}
              aria-label="Clear search"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* Filter button */}
        <div ref={filterButtonRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowFilterPanel(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 10px',
              fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
              background: activeFilterCount > 0 ? 'var(--color-text-primary)' : 'var(--color-bg-secondary)',
              color: activeFilterCount > 0 ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
              border: '0.5px solid',
              borderColor: activeFilterCount > 0 ? 'var(--color-text-primary)' : 'var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            <SlidersHorizontal size={12} />
            Filter
            {activeFilterCount > 0 && (
              <span
                style={{
                  background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  fontSize: '10px', fontWeight: 600, fontFamily: 'var(--font-mono)',
                  borderRadius: '999px', padding: '0 5px', lineHeight: '16px',
                  minWidth: 16, textAlign: 'center',
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
          {showFilterPanel && (
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              onClear={() => setFilters(EMPTY_FILTERS)}
              onClose={() => setShowFilterPanel(false)}
              anchorRef={filterButtonRef}
            />
          )}
        </div>

        {/* Duplicates vs club catalogues (Phase 4 hygiene) */}
        {duplicatesCount > 0 && onOpenDuplicates && (
          <button
            type="button"
            onClick={onOpenDuplicates}
            title="Personal exercises that duplicate a club-catalogue exercise — review and merge them onto the shared ids"
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
              fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
              background: 'var(--color-warning-bg, #fffbeb)', color: 'var(--color-warning-text, #92400e)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}
          >
            <AlertTriangle size={12} />
            {duplicatesCount} duplicate{duplicatesCount === 1 ? '' : 's'}
          </button>
        )}

        {/* Archived rows — shown dimmed in place, so a coach can find and
            restore what was archived (incl. rows a duplicate-merge archived). */}
        {onToggleArchived && (archivedCount > 0 || showArchived) && (
          <button
            type="button"
            onClick={() => onToggleArchived(!showArchived)}
            title={showArchived ? 'Hide archived exercises' : 'Show archived exercises in place, dimmed'}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px',
              fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
              background: showArchived ? 'var(--color-text-primary)' : 'var(--color-bg-secondary)',
              color: showArchived ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
              border: '0.5px solid',
              borderColor: showArchived ? 'var(--color-text-primary)' : 'var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}
          >
            <Archive size={12} />
            {archivedCount > 0 ? `${archivedCount} archived` : 'Archived'}
          </button>
        )}

        <Button variant="secondary" size="sm" icon={<Share2 size={12} />} onClick={onOpenSharing}>
          Sharing
        </Button>
        <Button variant="secondary" size="sm" icon={<Layers size={12} />} onClick={onOpenCategoryModal}>
          Categories
        </Button>
        <Button variant="secondary" size="sm" icon={<Upload size={12} />} onClick={onOpenBulkImport}>
          Import
        </Button>
        <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={() => onCreateExercise()}>
          Add exercise
        </Button>
      </div>

      {activeFilterCount > 0 && (
        <div
          style={{
            padding: '3px var(--space-lg)', fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)', borderBottom: '0.5px solid var(--color-border-tertiary)',
            flexShrink: 0,
          }}
        >
          Filtered — showing matches (with their parents) only.
        </div>
      )}

      {/* The tree */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ExerciseTree
          exercises={treeExercises}
          categories={categories}
          selectedExerciseId={selectedExerciseId}
          onSelectExercise={onSelectExercise}
          onMoveExercise={onMoveExercise}
          searchTerm={searchQuery.trim() || undefined}
          canEditExercise={canEditExercise}
          clubLibraryIds={clubLibraryIds}
          athletePRMap={athletePRMap}
          duplicateNames={duplicateNames}
          libraryBadge={libraryBadge}
          onCreateInCategory={name => onCreateExercise(name)}
          contextActions={contextActions}
          canEditCategory={canEditCategory}
          onReorderCategories={onReorderCategories}
        />
      </div>
    </StandardPage>
  );
}
