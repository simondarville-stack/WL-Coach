import { useState, useRef, useEffect } from 'react';
import { Layers, Type, Video, Image as ImageIcon, Plus, PlusCircle, Dumbbell } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import { rankExercises } from '../../lib/exerciseRanker';

interface SlashCommand {
  key: string;
  label: string;
  icon: React.ElementType;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/combo',       label: 'Combo exercise',           icon: Layers },
  { key: '/gpp',         label: 'GPP / circuit section',    icon: Dumbbell },
  { key: '/text',        label: 'Free text note',           icon: Type },
  { key: '/video',       label: 'Video',                    icon: Video },
  { key: '/image',       label: 'Image',                    icon: ImageIcon },
  { key: '/newexercise', label: 'Create new exercise',      icon: PlusCircle },
];

interface ExerciseSearchProps {
  exercises: Exercise[];
  onAdd: (exercise: Exercise) => void;
  onSlashCommand?: (key: string) => void;
  placeholder?: string;
  disableSlashCommands?: boolean;
  dropUp?: boolean;
  /** When provided, enables the inline combo builder: pressing "+" on the
   *  highlighted match stages it as a combo member and awaits the next;
   *  Enter commits (2+ staged → combo via this callback, exactly 1 → a plain
   *  onAdd). Omit to keep single-add behaviour (template editor, swap picker). */
  onAddCombo?: (exercises: Exercise[]) => void | Promise<void>;
  /** Focus the input on mount (used where the search is revealed on demand). */
  autoFocus?: boolean;
}

export function ExerciseSearch({
  exercises,
  onAdd,
  onSlashCommand,
  placeholder = 'Add exercise…',
  disableSlashCommands = false,
  dropUp = true,
  onAddCombo,
  autoFocus = false,
}: ExerciseSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  /** Combo members staged inline via "+" before Enter commits them. */
  const [staged, setStaged] = useState<Exercise[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const comboMode = !!onAddCombo;

  const isSlash = !disableSlashCommands && query.startsWith('/');

  const filteredCommands = isSlash
    ? SLASH_COMMANDS.filter(c => c.key.startsWith(query.toLowerCase()))
    : [];

  // Rank: exact code > code prefix > name prefix > code contains > name contains
  // (shared with the combo builder and athlete add sheet via exerciseRanker).
  const filteredExercises = !isSlash && query.trim().length > 0
    ? rankExercises(exercises.filter(ex => ex.category !== '— System'), query, 12)
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
        setStaged([]);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Commit an accumulated member list: exactly one → single add, 2+ → combo. */
  function commitStaged(list: Exercise[]) {
    if (list.length === 0) return;
    if (list.length === 1) onAdd(list[0]);
    else void onAddCombo?.(list);
    setStaged([]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleSelect(index: number) {
    const item = results[index];
    if (!item) return;
    if (item.type === 'exercise' && item.exercise) {
      // Mid-build: clicking a match stages the next member instead of
      // committing, so a combo can be built entirely by mouse.
      if (comboMode && staged.length > 0) {
        const ex = item.exercise;
        setStaged(s => [...s, ex]);
        setQuery('');
        setOpen(true);
        inputRef.current?.focus();
        return;
      }
      onAdd(item.exercise);
    } else if (item.type === 'command' && item.command) {
      onSlashCommand?.(item.command.key);
    }
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // The staged-combo branches must run BEFORE the "no results" guard below:
    // right after "+" clears the query there are no results, yet Enter must
    // still commit and Backspace must still pop a chip.
    const current = !isSlash && results[selectedIndex]?.type === 'exercise'
      ? results[selectedIndex].exercise ?? null
      : null;

    if (comboMode && e.key === '+' && !isSlash) {
      // "+" chains a member; never let the character land in the input.
      e.preventDefault();
      if (current) { setStaged(s => [...s, current]); setQuery(''); setOpen(true); }
      return;
    }
    if (comboMode && e.key === 'Enter' && staged.length > 0) {
      e.preventDefault();
      commitStaged(current ? [...staged, current] : staged);
      return;
    }
    if (comboMode && e.key === 'Backspace' && query === '' && staged.length > 0) {
      e.preventDefault();
      setStaged(s => s.slice(0, -1));
      return;
    }
    if (e.key === 'Escape' && (staged.length > 0 || query)) {
      e.preventDefault();
      setStaged([]);
      setQuery('');
      setOpen(false);
      return;
    }

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
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
        borderTop: `0.5px solid ${inputFocused ? 'var(--color-border-secondary)' : 'transparent'}`,
        transition: 'border-color 0.1s',
      }}>
        {staged.length === 0 && (
          <Plus size={11} style={{ position: 'absolute', left: 8, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
        )}
        {staged.map((ex, i) => (
          <span
            key={`${ex.id}-${i}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
              background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)',
              borderRadius: 'var(--radius-sm)', padding: '2px 6px', marginLeft: i === 0 ? 6 : 0,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: ex.color || '#94a3b8', flexShrink: 0 }} />
            <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.name}</span>
            <button
              onMouseDown={e => { e.preventDefault(); setStaged(s => s.filter((_, idx) => idx !== i)); inputRef.current?.focus(); }}
              tabIndex={-1}
              title="Remove member"
              style={{ border: 'none', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13 }}
            >×</button>
          </span>
        ))}
        {staged.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', userSelect: 'none' }}>+</span>
        )}
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setInputFocused(true); }}
          onBlur={() => setInputFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={staged.length > 0 ? 'add next member… (Enter to create combo)' : placeholder}
          style={{
            flex: 1, minWidth: 90,
            paddingLeft: staged.length > 0 ? 6 : 24, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
            fontSize: 11,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>

      {open && hasResults && (
        <div style={{
          position: 'absolute',
          ...(dropUp ? { bottom: '100%', marginBottom: 2 } : { top: '100%', marginTop: 2 }),
          left: 0, right: 0,
          background: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-primary)',
          borderRadius: 'var(--radius-md)',
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
