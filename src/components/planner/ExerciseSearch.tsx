import { useState, useRef, useEffect } from 'react';
import { Layers, Type, Video, Image as ImageIcon, Plus, PlusCircle } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';

interface SlashCommand {
  key: string;
  label: string;
  icon: React.ElementType;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/combo', label: 'Combo exercise', icon: Layers },
  { key: '/text', label: 'Free text note', icon: Type },
  { key: '/video', label: 'Video', icon: Video },
  { key: '/image', label: 'Image', icon: ImageIcon },
  { key: '/newexercise', label: 'Create new exercise', icon: PlusCircle },
];

interface ExerciseSearchProps {
  exercises: Exercise[];
  onAdd: (exercise: Exercise) => void;
  onSlashCommand?: (key: string) => void;
  placeholder?: string;
  disableSlashCommands?: boolean;
}

export function ExerciseSearch({
  exercises,
  onAdd,
  onSlashCommand,
  placeholder = 'Add exercise…',
  disableSlashCommands = false,
}: ExerciseSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <Plus size={11} className="absolute left-2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-6 pr-2 py-1 text-[11px] border-0 border-t border-transparent hover:border-gray-100 focus:border-gray-200 focus:outline-none bg-transparent placeholder:text-gray-300 transition-colors"
        />
      </div>

      {open && hasResults && (
        <div className="absolute bottom-full left-0 right-0 mb-0.5 bg-white border border-gray-200 rounded-lg shadow-lg z-30 overflow-hidden max-h-60 overflow-y-auto">
          {results.map((item, i) => {
            if (item.type === 'exercise' && item.exercise) {
              const ex = item.exercise;
              return (
                <button
                  key={ex.id}
                  onMouseDown={e => { e.preventDefault(); handleSelect(i); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    i === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ex.color || '#94a3b8' }}
                  />
                  <span className="text-xs text-gray-800 flex-1 truncate">{ex.name}</span>
                  {ex.exercise_code && (
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{ex.exercise_code}</span>
                  )}
                  <span className="text-[10px] text-gray-400 flex-shrink-0 italic">{ex.category}</span>
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
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    i === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <Icon size={12} className="text-gray-500 flex-shrink-0" />
                  <span className="text-xs font-mono text-blue-700">{cmd.key}</span>
                  <span className="text-xs text-gray-600">{cmd.label}</span>
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
