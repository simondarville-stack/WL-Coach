import { useState, useRef, useEffect } from 'react';
import { Layers, Type, Video, Image as ImageIcon, Plus, PlusCircle } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';

interface SlashCommand {
  key: string;
  label: string;
  icon: React.ElementType;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/combo',       label: 'Combo exercise',      icon: Layers },
  { key: '/text',        label: 'Free text note',       icon: Type },
  { key: '/video',       label: 'Video',                icon: Video },
  { key: '/image',       label: 'Image',                icon: ImageIcon },
  { key: '/newexercise', label: 'Create new exercise',  icon: PlusCircle },
];

interface ExerciseSearchProps {
  exercises: Exercise[];
  onAdd: (exercise: Exercise) => void;
  onSlashCommand?: (key: string) => void;
  placeholder?: string;
  disableSlashCommands?: boolean;
  dropUp?: boolean;
}

export function ExerciseSearch({
  exercises,
  onAdd,
  onSlashCommand,
  placeholder = 'Add exercise…',
  disableSlashCommands = false,
  dropUp = true,
}: ExerciseSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isSlash = !disableSlashCommands && query.startsWith('/');

  const filteredCommands = isSlash
    ? SLASH_COMMANDS.filter(c => c.key.startsWith(query.toLowerCase()))
    : [];

  const filteredExercises = !isSlash && query.trim().length > 0
    ? exercises
        .filter(ex => ex.category !== '— System')
        .filter(ex => {
          const q = query.toLowerCase();
          return (
            ex.name.toLowerCase().includes(q) ||
            (ex.exercise_code?.toLowerCase().includes(q) ?? false)
          );
        })
        .slice(0, 12)
    : [];

  const results: { type: 'exercise' | 'command'; exercise?: Exercise; command?: SlashCommand }[] =
    isSlash
      ? filteredCommands.map(c => ({ type: 'command', command: c }))
      : filteredExercises.map(e => ({ type: 'exercise', exercise: e }));

  const hasResults = results.length > 0;

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(index: number) {
    const item = results[index];
    if (!item) return;
    if (item.type === 'exercise' && item.exercise) {
      onAdd(item.exercise);
    } else if (item.type === 'command' && item.command) {
      onSlashCommand?.(item.command.key);
    }
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || !hasResults) {
      if (e.key === 'Escape') { setQuery(''); setOpen(false); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(selectedIndex);
    } else if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Plus size={11} style={{ position: 'absolute', left: 8, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setInputFocused(true); }}
          onBlur={() => setInputFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%',
            paddingLeft: 24, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
            fontSize: 11,
            border: 'none',
            borderTop: `0.5px solid ${inputFocused ? 'var(--color-border-secondary)' : 'transparent'}`,
            outline: 'none',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            transition: 'border-color 0.1s',
          }}
        />
      </div>

      {open && hasResults && (
        <div style={{
          position: 'absolute',
          ...(dropUp ? { bottom: '100%', marginBottom: 2 } : { top: '100%', marginTop: 2 }),
          left: 0, right: 0,
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 30,
          overflow: 'hidden',
          maxHeight: 240,
          overflowY: 'auto',
        }}>
          {results.map((item, i) => {
            const isSelected = i === selectedIndex;
            if (item.type === 'exercise' && item.exercise) {
              const ex = item.exercise;
              return (
                <button
                  key={ex.id}
                  onMouseDown={e => { e.preventDefault(); handleSelect(i); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', textAlign: 'left',
                    background: isSelected ? 'var(--color-accent-muted)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, backgroundColor: ex.color || '#94a3b8' }} />
                  <span style={{ fontSize: 12, color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ex.name}
                  </span>
                  {ex.exercise_code && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{ex.exercise_code}</span>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0, fontStyle: 'italic' }}>
                    {ex.category}
                  </span>
                </button>
              );
            }
            if (item.type === 'command' && item.command) {
              const cmd = item.command;
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.key}
                  onMouseDown={e => { e.preventDefault(); handleSelect(i); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', textAlign: 'left',
                    background: isSelected ? 'var(--color-accent-muted)' : 'transparent',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  <Icon size={12} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{cmd.key}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{cmd.label}</span>
                </button>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
