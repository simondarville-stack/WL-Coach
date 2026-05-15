import { useMemo } from 'react';
import type { Exercise } from '../../../lib/database.types';
import type { ExerciseSortKey } from './useDockState';

interface DockExerciseListProps {
  exercises: Exercise[];
  query: string;
  sort: ExerciseSortKey;
  setSort: (s: ExerciseSortKey) => void;
  categoryFilter: string | null;
  setCategoryFilter: (c: string | null) => void;
}

// Search ranking matches ExerciseSearch.tsx so coaches see the same
// order whether they search from a day card or from the dock.
function rankSearch(exercises: Exercise[], q: string): Exercise[] {
  const scored = exercises
    .map(ex => {
      const code = ex.exercise_code?.toLowerCase() ?? '';
      const name = ex.name.toLowerCase();
      let score = Infinity;
      if (code && code === q) score = 0;
      else if (code && code.startsWith(q)) score = 1;
      else if (name.startsWith(q)) score = 2;
      else if (code && code.includes(q)) score = 3;
      else if (name.includes(q)) score = 4;
      return { ex, score };
    })
    .filter(s => s.score !== Infinity);
  scored.sort((a, b) => a.score - b.score || a.ex.name.localeCompare(b.ex.name));
  return scored.map(s => s.ex);
}

function applySort(list: Exercise[], sort: ExerciseSortKey): Exercise[] {
  const sorted = list.slice();
  switch (sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'category':
      sorted.sort((a, b) =>
        a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
      );
      break;
    case 'code':
      sorted.sort((a, b) => {
        const ac = a.exercise_code ?? '';
        const bc = b.exercise_code ?? '';
        // Numeric-aware compare so code "9" sorts before "10".
        const cmp = ac.localeCompare(bc, undefined, { numeric: true, sensitivity: 'base' });
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
      break;
  }
  return sorted;
}

export function DockExerciseList({
  exercises,
  query,
  sort,
  setSort,
  categoryFilter,
  setCategoryFilter,
}: DockExerciseListProps) {
  const visible = useMemo(
    () => exercises.filter(ex => ex.category !== '— System' && !ex.is_archived),
    [exercises],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    visible.forEach(ex => { if (ex.category) set.add(ex.category); });
    return Array.from(set).sort();
  }, [visible]);

  const filtered = useMemo(() => {
    const byCategory = categoryFilter
      ? visible.filter(ex => ex.category === categoryFilter)
      : visible;
    const q = query.trim().toLowerCase();
    if (q) return rankSearch(byCategory, q);
    return applySort(byCategory, sort);
  }, [visible, query, sort, categoryFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FilterRow
        sort={sort}
        setSort={setSort}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        categories={categories}
        visibleCount={filtered.length}
        totalCount={visible.length}
        querying={query.trim().length > 0}
      />
      {filtered.length === 0 ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
            fontStyle: 'italic',
            textAlign: 'center',
            padding: '24px 0',
          }}
        >
          {query.trim() || categoryFilter
            ? 'No exercises match the current filters'
            : 'No exercises available'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 6,
          }}
        >
          {filtered.map(ex => (
            <ExerciseTile key={ex.id} exercise={ex} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FilterRowProps {
  sort: ExerciseSortKey;
  setSort: (s: ExerciseSortKey) => void;
  categoryFilter: string | null;
  setCategoryFilter: (c: string | null) => void;
  categories: string[];
  visibleCount: number;
  totalCount: number;
  querying: boolean;
}

function FilterRow({
  sort, setSort, categoryFilter, setCategoryFilter,
  categories, visibleCount, totalCount, querying,
}: FilterRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        paddingBottom: 4,
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}
    >
      <LabeledSelect
        label="Sort"
        value={sort}
        disabled={querying}
        title={querying ? 'Sort is overridden by search ranking while a query is active' : undefined}
        onChange={v => setSort(v as ExerciseSortKey)}
        options={[
          { value: 'name', label: 'Name' },
          { value: 'category', label: 'Category' },
          { value: 'code', label: 'Code' },
        ]}
      />
      <LabeledSelect
        label="Category"
        value={categoryFilter ?? ''}
        onChange={v => setCategoryFilter(v === '' ? null : v)}
        options={[
          { value: '', label: 'All' },
          ...categories.map(c => ({ value: c, label: c })),
        ]}
      />
      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
        {visibleCount === totalCount ? `${totalCount} exercises` : `${visibleCount} of ${totalCount}`}
      </span>
    </div>
  );
}

interface LabeledSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  title?: string;
}

function LabeledSelect({ label, value, onChange, options, disabled, title }: LabeledSelectProps) {
  return (
    <label
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: 11,
          color: 'var(--color-text-primary)',
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px 4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function ExerciseTile({ exercise }: { exercise: Exercise }) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', `DOCK:exercise:${exercise.id}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={exercise.name + (exercise.exercise_code ? ` (${exercise.exercise_code})` : '')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px 4px 4px',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-secondary)',
        borderLeft: `3px solid ${exercise.color || '#94a3b8'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'background var(--transition-fast), border-color var(--transition-fast)',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-secondary)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-primary)'; }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 1 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.2,
          }}
        >
          {exercise.name}
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {exercise.exercise_code && (
            <span style={{ fontFamily: 'var(--font-mono)' }}>{exercise.exercise_code}</span>
          )}
          <span style={{ fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {exercise.category}
          </span>
        </div>
      </div>
    </div>
  );
}
