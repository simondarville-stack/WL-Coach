/**
 * ExerciseListPanel
 *
 * Renders the search toolbar, view-mode toggle, and the category-grouped
 * exercise list. Stateless with respect to exercises/categories — all data
 * and handlers are passed as props.
 */
import { useState } from 'react';
import {
  Search, Plus, Grid3X3, List, Upload,
  ChevronRight, Layers, X as XIcon, AlertTriangle,
} from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { StandardPage, Button, Input, Badge, ColorDot } from '../ui';

// ── Constants ──────────────────────────────────────────────────────

const UNIT_LABELS: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  rpe: 'RPE',
  free_text: 'text',
  free_text_reps: 'reps',
  other: 'other',
};

// ── ExerciseCard ───────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise;
  isSelected: boolean;
  athletePR: { pr_value_kg: number | null; pr_date: string | null } | null;
  onClick: () => void;
  isDuplicate?: boolean;
}

export function ExerciseCard({ exercise, isSelected, athletePR, onClick, isDuplicate }: ExerciseCardProps) {
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
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-xs)',
          marginBottom: '4px', minWidth: 0,
        }}
      >
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', fontWeight: 500,
            color: 'var(--color-text-primary)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}
        >
          {exercise.exercise_code || exercise.name}
        </span>
        {exercise.is_competition_lift && <Badge variant="danger">COMP</Badge>}
        {isDuplicate && (
          <AlertTriangle
            size={11}
            style={{ color: 'var(--color-warning-text)', flexShrink: 0 }}
            title="Duplicate exercise name"
          />
        )}
      </div>

      {exercise.exercise_code && exercise.exercise_code !== exercise.name && (
        <div
          style={{
            fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)',
            marginBottom: athletePR?.pr_value_kg != null ? '6px' : 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {exercise.name}
        </div>
      )}

      {athletePR?.pr_value_kg != null && (
        <div
          style={{
            fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {athletePR.pr_value_kg}
          </span>
          <span style={{ marginLeft: '3px' }}>kg PR</span>
        </div>
      )}
    </div>
  );
}

// ── ExerciseListRow ────────────────────────────────────────────────

interface ExerciseListRowProps {
  exercise: Exercise;
  isSelected: boolean;
  athletePR: { pr_value_kg: number | null } | null;
  onClick: () => void;
  isDuplicate?: boolean;
}

export function ExerciseListRow({ exercise, isSelected, athletePR, onClick, isDuplicate }: ExerciseListRowProps) {
  const unitLabel = UNIT_LABELS[exercise.default_unit as string] ?? exercise.default_unit ?? 'kg';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px',
        alignItems: 'center',
        gap: 'var(--space-md)',
        padding: '8px var(--space-lg)',
        background: isSelected ? 'var(--color-info-bg)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', minWidth: 0 }}>
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)',
            color: 'var(--color-text-primary)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {exercise.exercise_code || ''}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {exercise.is_competition_lift && <Badge variant="danger">COMP</Badge>}
        {isDuplicate && !exercise.is_competition_lift && (
          <AlertTriangle size={11} style={{ color: 'var(--color-warning-text)' }} title="Duplicate exercise name" />
        )}
      </div>

      <div style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {exercise.name}
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
        {unitLabel}
      </div>

      <div
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)',
          color: 'var(--color-text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        }}
      >
        {athletePR?.pr_value_kg != null ? (
          <>
            <span style={{ fontWeight: 500 }}>{athletePR.pr_value_kg}</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: '3px' }}>
              kg
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>
    </div>
  );
}

// ── ListViewHeader ─────────────────────────────────────────────────

export function ListViewHeader() {
  const cell: React.CSSProperties = {
    fontFamily: 'var(--font-sans)', fontSize: 'var(--text-caption)', fontWeight: 400,
    color: 'var(--color-text-secondary)', letterSpacing: '0', textTransform: 'none',
  };

  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '60px 56px 1fr 60px 80px', gap: 'var(--space-md)',
        padding: 'var(--space-sm) var(--space-lg)', borderBottom: '0.5px solid var(--color-border-secondary)',
        position: 'sticky', top: 0, background: 'var(--color-bg-primary)', zIndex: 2,
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

// ── CategorySectionHeader ──────────────────────────────────────────

interface CategorySectionHeaderProps {
  category: Category;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
}

export function CategorySectionHeader({ category, count, isCollapsed, onToggle }: CategorySectionHeaderProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
        padding: 'var(--space-md) var(--space-lg)', cursor: 'pointer', userSelect: 'none',
        borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-bg-secondary)',
      }}
    >
      <ChevronRight
        size={12}
        style={{
          color: 'var(--color-text-tertiary)', transition: 'transform 100ms ease-out',
          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', flexShrink: 0,
        }}
      />
      <ColorDot color={category.color || 'var(--color-gray-400)'} size={8} />
      <span
        style={{
          fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)',
          letterSpacing: 'var(--tracking-section)',
        }}
      >
        {category.name}
      </span>
      <span
        style={{
          fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)', background: 'var(--color-bg-primary)',
          padding: '1px 6px', borderRadius: '999px', fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
      <span style={{ flex: 1, height: '0.5px', background: 'var(--color-border-tertiary)' }} />
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
  onCreateExercise: () => void;
  hasSidePanel: boolean;
}

function isProtectedCategory(cat: Category): boolean {
  return cat.name.toLowerCase().includes('system') || cat.name === 'Unspecified';
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
  hasSidePanel,
}: ExerciseListPanelProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [showEmptyCategories, setShowEmptyCategories] = useState(false);

  const visibleCategories = categories
    .filter(c => !isProtectedCategory(c))
    .sort((a, b) => a.display_order - b.display_order);

  const knownCategoryNames = new Set(categories.map(c => c.name));

  const filteredExercises = searchQuery.trim()
    ? exercises.filter(ex => {
        const q = searchQuery.toLowerCase();
        return ex.name.toLowerCase().includes(q) || (ex.exercise_code?.toLowerCase() ?? '').includes(q);
      })
    : exercises;

  const unspecifiedExercises = filteredExercises.filter(ex => {
    const cat = ex.category as unknown as string | null;
    return !cat || cat === 'Unspecified' || !knownCategoryNames.has(cat);
  });

  const emptyCategoryCount = visibleCategories.filter(
    cat => exercises.filter(ex => (ex.category as unknown as string) === cat.name).length === 0
  ).length;

  const toggleCollapse = (catId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  function renderExercises(exList: Exercise[]) {
    if (viewMode === 'grid') {
      return (
        <div
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-sm)', padding: 'var(--space-md) var(--space-lg)',
          }}
        >
          {exList.map(ex => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              isSelected={selectedExerciseId === ex.id}
              athletePR={athletePRMap.get(ex.id) ?? null}
              onClick={() => onSelectExercise(ex.id === selectedExerciseId ? null : ex.id)}
              isDuplicate={duplicateNames.has(ex.name.toLowerCase())}
            />
          ))}
        </div>
      );
    }
    return (
      <div>
        {exList.map(ex => (
          <ExerciseListRow
            key={ex.id}
            exercise={ex}
            isSelected={selectedExerciseId === ex.id}
            athletePR={athletePRMap.get(ex.id) ?? null}
            onClick={() => onSelectExercise(ex.id === selectedExerciseId ? null : ex.id)}
            isDuplicate={duplicateNames.has(ex.name.toLowerCase())}
          />
        ))}
      </div>
    );
  }

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

        {/* View toggle */}
        <div
          style={{
            display: 'flex', gap: '1px', background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)', padding: '2px',
          }}
        >
          {(['grid', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px',
                fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
                background: viewMode === mode ? 'var(--color-bg-primary)' : 'transparent',
                color: viewMode === mode ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontWeight: viewMode === mode ? 500 : 400,
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                transition: 'all 100ms ease-out',
              }}
            >
              {mode === 'grid' ? <Grid3X3 size={12} /> : <List size={12} />}
              {mode === 'grid' ? 'Grid' : 'List'}
            </button>
          ))}
        </div>

        <Button variant="secondary" size="sm" icon={<Layers size={12} />} onClick={onOpenCategoryModal}>
          Categories
        </Button>
        <Button variant="secondary" size="sm" icon={<Upload size={12} />} onClick={onOpenBulkImport}>
          Import
        </Button>
        <Button variant="primary" size="md" icon={<Plus size={14} />} onClick={onCreateExercise}>
          Add exercise
        </Button>
      </div>

      {/* List */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {viewMode === 'list' && <ListViewHeader />}

          {visibleCategories.map(cat => {
            const catExercises = filteredExercises.filter(ex => (ex.category as unknown as string) === cat.name);
            if (catExercises.length === 0 && (searchQuery.trim() || !showEmptyCategories)) return null;
            const isCollapsed = collapsedCategories.has(cat.id);
            return (
              <div key={cat.id}>
                <CategorySectionHeader
                  category={cat}
                  count={catExercises.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleCollapse(cat.id)}
                />
                {!isCollapsed && renderExercises(catExercises)}
              </div>
            );
          })}

          {unspecifiedExercises.length > 0 && (() => {
            const orphanCat: Category = {
              id: '__unspecified__', name: 'Unspecified',
              color: 'var(--color-gray-400)', display_order: 9999, created_at: '',
            };
            const isCollapsed = collapsedCategories.has(orphanCat.id);
            return (
              <div>
                <CategorySectionHeader
                  category={orphanCat}
                  count={unspecifiedExercises.length}
                  isCollapsed={isCollapsed}
                  onToggle={() => toggleCollapse(orphanCat.id)}
                />
                {!isCollapsed && renderExercises(unspecifiedExercises)}
              </div>
            );
          })()}

          {!searchQuery.trim() && emptyCategoryCount > 0 && (
            <button
              onClick={() => setShowEmptyCategories(v => !v)}
              style={{
                display: 'block', width: '100%', padding: 'var(--space-sm) var(--space-lg)',
                fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                transition: 'color 100ms ease-out',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
            >
              {showEmptyCategories
                ? `Hide ${emptyCategoryCount} empty ${emptyCategoryCount === 1 ? 'category' : 'categories'}`
                : `${emptyCategoryCount} empty ${emptyCategoryCount === 1 ? 'category' : 'categories'} hidden · Show`}
            </button>
          )}

          {filteredExercises.length === 0 && (
            <div
              style={{
                padding: 'var(--space-2xl)', textAlign: 'center',
                fontSize: 'var(--text-body)', color: 'var(--color-text-tertiary)',
              }}
            >
              {searchQuery.trim()
                ? `No exercises match "${searchQuery}"`
                : 'No exercises yet. Click "Add exercise" to create one.'}
            </div>
          )}
        </div>
      </div>
    </StandardPage>
  );
}
