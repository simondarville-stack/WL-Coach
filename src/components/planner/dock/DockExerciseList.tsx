import { useMemo } from 'react';
import type { Exercise } from '../../../lib/database.types';

interface DockExerciseListProps {
  exercises: Exercise[];
  query: string;
}

// Same ranking as ExerciseSearch.tsx: exact code > code prefix > name
// prefix > code contains > name contains. Keeps results predictable
// across the two surfaces.
function rankAndFilter(exercises: Exercise[], query: string): Exercise[] {
  const visible = exercises.filter(ex => ex.category !== '— System' && !ex.is_archived);
  const q = query.trim().toLowerCase();
  if (!q) {
    return visible.slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  const scored = visible
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

export function DockExerciseList({ exercises, query }: DockExerciseListProps) {
  const filtered = useMemo(() => rankAndFilter(exercises, query), [exercises, query]);

  if (filtered.length === 0) {
    return (
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-tertiary)',
          fontStyle: 'italic',
          textAlign: 'center',
          padding: '32px 0',
        }}
      >
        {query.trim() ? `No exercises match "${query.trim()}"` : 'No exercises available'}
      </div>
    );
  }

  return (
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
