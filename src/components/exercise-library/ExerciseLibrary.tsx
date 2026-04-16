import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Grid3X3, List, Upload,
  ChevronRight, Layers, Trash2, Check, X as XIcon, GripVertical,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useExercises } from '../../hooks/useExercises';
import { useAthleteStore } from '../../store/athleteStore';
import { useAthletes } from '../../hooks/useAthletes';
import { ExerciseFormModal } from '../ExerciseFormModal';
import { ExerciseBulkImportModal } from '../ExerciseBulkImportModal';
import { ExerciseDetailPanel } from './ExerciseDetailPanel';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { StandardPage, Button, Input, Badge, ColorDot } from '../ui';

// ── Color presets ─────────────────────────────────────────────────

const PRESET_COLORS = [
  '#E24B4A', '#7F77DD', '#D85A30', '#1D9E75',
  '#EF9F27', '#D4537E', '#3B82F6', '#10B981',
  '#F59E0B', '#8B5CF6', '#EC4899', '#888780',
];

function isSystemCategory(cat: Category): boolean {
  return cat.name.toLowerCase().includes('system');
}

function isProtectedCategory(cat: Category): boolean {
  return isSystemCategory(cat) || cat.name === 'Unspecified';
}

// ── ExerciseCard ───────────────────────────────────────────────────

interface ExerciseCardProps {
  exercise: Exercise;
  isSelected: boolean;
  athletePR: { pr_value_kg: number | null; pr_date: string | null } | null;
  onClick: () => void;
}

function ExerciseCard({ exercise, isSelected, athletePR, onClick }: ExerciseCardProps) {
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
      {/* Top line: dot + code + COMP badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-xs)',
          marginBottom: '4px',
          minWidth: 0,
        }}
      >
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {exercise.exercise_code || exercise.name}
        </span>
        {exercise.is_competition_lift && (
          <Badge variant="danger">COMP</Badge>
        )}
      </div>

      {/* Exercise name (only shown if distinct from code) */}
      {exercise.exercise_code && exercise.exercise_code !== exercise.name && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-secondary)',
            marginBottom: athletePR?.pr_value_kg != null ? '6px' : 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {exercise.name}
        </div>
      )}

      {/* PR line (only shown if athlete has PR) */}
      {athletePR?.pr_value_kg != null && (
        <div
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--color-text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
            }}
          >
            {athletePR.pr_value_kg}
          </span>
          <span style={{ marginLeft: '3px' }}>kg PR</span>
        </div>
      )}
    </div>
  );
}

// ── ExerciseListRow ────────────────────────────────────────────────

const UNIT_LABELS: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  rpe: 'RPE',
  free_text: 'text',
  free_text_reps: 'reps',
  other: 'other',
};

interface ExerciseListRowProps {
  exercise: Exercise;
  isSelected: boolean;
  athletePR: { pr_value_kg: number | null } | null;
  onClick: () => void;
  rowIndex: number;
}

function ExerciseListRow({ exercise, isSelected, athletePR, onClick, rowIndex }: ExerciseListRowProps) {
  const unitLabel = UNIT_LABELS[exercise.default_unit as string] ?? exercise.default_unit ?? 'kg';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px 120px',
        alignItems: 'center',
        gap: 'var(--space-md)',
        padding: '8px 16px',
        background: isSelected ? 'var(--color-info-bg)' : 'transparent',
        borderLeft: isSelected
          ? '2px solid var(--color-accent)'
          : '2px solid transparent',
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
      {/* Dot + code */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', minWidth: 0 }}>
        <ColorDot color={exercise.color || 'var(--color-gray-400)'} size={6} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {exercise.exercise_code || '—'}
        </span>
      </div>

      {/* COMP badge */}
      <div>
        {exercise.is_competition_lift && <Badge variant="danger">COMP</Badge>}
      </div>

      {/* Name */}
      <div
        style={{
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {exercise.name}
      </div>

      {/* Unit */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {unitLabel}
      </div>

      {/* PR (athlete) */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-label)',
          color: 'var(--color-text-primary)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {athletePR?.pr_value_kg != null ? (
          <>
            <span style={{ fontWeight: 500 }}>{athletePR.pr_value_kg}</span>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-caption)',
                color: 'var(--color-text-tertiary)',
                marginLeft: '3px',
              }}
            >
              kg
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>

      {/* Spacer — category column removed (redundant under category headers) */}
      <div />
    </div>
  );
}

// ── ListViewHeader ─────────────────────────────────────────────────

function ListViewHeader() {
  const cell: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-caption)',
    fontWeight: 400,
    color: 'var(--color-text-secondary)',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 56px 1fr 60px 80px 120px',
        gap: 'var(--space-md)',
        padding: '10px 16px 8px',
        borderBottom: '0.5px solid var(--color-border-secondary)',
        position: 'sticky',
        top: 0,
        background: 'var(--color-bg-primary)',
        zIndex: 2,
      }}
    >
      <div style={cell}>Code</div>
      <div style={cell}></div>
      <div style={cell}>Name</div>
      <div style={cell}>Unit</div>
      <div style={{ ...cell, textAlign: 'right' }}>PR</div>
      <div />
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

function CategorySectionHeader({ category, count, isCollapsed, onToggle }: CategorySectionHeaderProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: 'var(--space-md) var(--space-lg)',
        cursor: 'pointer',
        userSelect: 'none',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <ChevronRight
        size={12}
        style={{
          color: 'var(--color-text-tertiary)',
          transition: 'transform 100ms ease-out',
          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          flexShrink: 0,
        }}
      />
      <ColorDot color={category.color || 'var(--color-gray-400)'} size={8} />
      <span
        style={{
          fontSize: 'var(--text-label)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          letterSpacing: 'var(--tracking-section)',
        }}
      >
        {category.name}
      </span>
      <span
        style={{
          fontSize: 'var(--text-caption)',
          color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg-primary)',
          padding: '1px 6px',
          borderRadius: '999px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
      <span style={{ flex: 1, height: '0.5px', background: 'var(--color-border-tertiary)' }} />
    </div>
  );
}

// ── CategoryManagerModal ──────────────────────────────────────────

interface CategoryManagerModalProps {
  categories: Category[];
  exerciseCounts: Map<string, number>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: string) => Promise<void>;
  onReorder: (fromIdx: number, toIdx: number) => Promise<void>;
  onAdd: (name: string, color: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

interface ColorPickerPos {
  id: string;
  top: number;
  left: number;
}

function CategoryManagerModal({
  categories, exerciseCounts,
  onRename, onRecolor, onReorder, onAdd, onDelete, onClose,
}: CategoryManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [colorPickerPos, setColorPickerPos] = useState<ColorPickerPos | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const visible = categories.filter(c => !isProtectedCategory(c));
  const sorted = [...visible].sort((a, b) => a.display_order - b.display_order);

  const pickerCat = colorPickerPos
    ? sorted.find(c => c.id === colorPickerPos.id)
    : null;

  function openColorPicker(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (colorPickerPos?.id === id) {
      setColorPickerPos(null);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setColorPickerPos({ id, top: rect.bottom + 4, left: rect.left });
    }
  }

  function openNewColorPicker(e: React.MouseEvent) {
    e.stopPropagation();
    if (colorPickerPos?.id === '__new') {
      setColorPickerPos(null);
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setColorPickerPos({ id: '__new', top: rect.top - 148, left: rect.left });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={() => setColorPickerPos(null)}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">Manage categories</span>
            <span className="text-[10px] text-gray-400 ml-1">Drag to reorder</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <XIcon size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-2">
          {sorted.map((cat, idx) => {
            const count = exerciseCounts.get(cat.id) ?? 0;
            const isEditing = editingId === cat.id;
            const isConfirming = confirmDeleteId === cat.id;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;

            return (
              <div
                key={cat.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragEnter={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={async () => {
                  if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                    await onReorder(dragIdx, dragOverIdx);
                  }
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                className={`flex items-center gap-2.5 px-2 py-2 rounded-lg group transition-colors ${
                  isDragOver ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                } ${dragIdx === idx ? 'opacity-40' : ''}`}
              >
                {/* Drag handle */}
                <GripVertical size={13} className="text-gray-300 cursor-grab flex-shrink-0" />

                {/* Color swatch */}
                <button
                  onClick={(e) => openColorPicker(e, cat.id)}
                  className="w-5 h-5 rounded border border-black/10 flex-shrink-0 hover:scale-110 transition-transform"
                  style={{ backgroundColor: cat.color ?? '#888780' }}
                  title="Change color"
                />

                {/* Name */}
                {isEditing ? (
                  <input
                    autoFocus
                    className="flex-1 text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onRename(cat.id, editName); setEditingId(null); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => { if (editName.trim()) onRename(cat.id, editName); setEditingId(null); }}
                  />
                ) : (
                  <span
                    className="flex-1 text-sm text-gray-700 cursor-text hover:text-gray-900"
                    onClick={() => { setEditName(cat.name); setEditingId(cat.id); }}
                  >
                    {cat.name}
                  </span>
                )}

                <span className="text-[10px] text-gray-400 w-6 text-right">{count}</span>

                {/* Delete */}
                {isConfirming ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-orange-600 whitespace-nowrap">
                      {count > 0 ? `Move ${count} to Unspecified?` : 'Delete?'}
                    </span>
                    <button
                      onClick={async () => {
                        try { await onDelete(cat.id); } catch {}
                        setConfirmDeleteId(null);
                      }}
                      className="text-[10px] text-red-500 font-medium hover:text-red-700 px-1"
                    >Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-1">No</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(cat.id)}
                    title="Delete category"
                    className="p-0.5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add new category */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={openNewColorPicker}
            className="w-5 h-5 rounded border border-black/10 hover:scale-110 transition-transform flex-shrink-0"
            style={{ backgroundColor: newColor }}
            title="Pick color"
          />
          <input
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="New category name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) { onAdd(newName.trim(), newColor); setNewName(''); }
            }}
          />
          <button
            onClick={() => { if (newName.trim()) { onAdd(newName.trim(), newColor); setNewName(''); } }}
            disabled={!newName.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            <Check size={13} /> Add
          </button>
        </div>
      </div>

      {/* Color picker — fixed position to avoid overflow clipping */}
      {colorPickerPos && (
        <>
          <div className="fixed inset-0 z-[199]" onClick={() => setColorPickerPos(null)} />
          <div
            className="fixed bg-white border border-gray-200 rounded-lg p-2 shadow-xl flex flex-wrap gap-1 w-[132px] z-[200]"
            style={{ top: colorPickerPos.top, left: colorPickerPos.left }}
            onClick={e => e.stopPropagation()}
          >
            {PRESET_COLORS.map(c => {
              const currentColor = colorPickerPos.id === '__new' ? newColor : (pickerCat?.color ?? '#888780');
              const isActive = currentColor === c;
              return (
                <button
                  key={c}
                  onClick={async () => {
                    if (colorPickerPos.id === '__new') {
                      setNewColor(c);
                      setColorPickerPos(null);
                    } else {
                      const id = colorPickerPos.id;
                      setColorPickerPos(null);
                      await onRecolor(id, c);
                    }
                  }}
                  className={`w-6 h-6 rounded border-2 transition-transform hover:scale-110 ${isActive ? 'border-gray-700' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── ExerciseLibrary ────────────────────────────────────────────────

export function ExerciseLibrary() {
  const { selectedAthlete } = useAthleteStore();
  const { athletes, fetchAllAthletes } = useAthletes();

  const {
    exercises, categories,
    fetchExercises, fetchCategories,
    createExercise, updateExercise,
    createCategory, updateCategory, deleteCategory,
    bulkReorderCategories,
  } = useExercises();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  const [athletePRMap, setAthletePRMap] = useState<Map<string, { pr_value_kg: number | null; pr_date: string | null }>>(new Map());

  useEffect(() => { fetchExercises(); fetchCategories(); fetchAllAthletes(); }, []);
  useEffect(() => { loadPRs(); }, [selectedAthlete?.id]);

  const loadPRs = useCallback(async () => {
    if (!selectedAthlete) { setAthletePRMap(new Map()); return; }
    const { data } = await supabase
      .from('athlete_prs')
      .select('exercise_id, pr_value_kg, pr_date')
      .eq('athlete_id', selectedAthlete.id);
    const map = new Map<string, { pr_value_kg: number | null; pr_date: string | null }>();
    for (const r of (data || []) as any[]) map.set(r.exercise_id, r);
    setAthletePRMap(map);
  }, [selectedAthlete?.id]);

  // ── Derived ─────────────────────────────────────────────────────

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

  const exerciseCategoryCount = new Map<string, number>();
  for (const cat of categories) {
    exerciseCategoryCount.set(cat.id, exercises.filter(ex => (ex.category as unknown as string) === cat.name).length);
  }

  const selectedExercise = exercises.find(e => e.id === selectedExerciseId) ?? null;
  const selectedCategory = selectedExercise
    ? categories.find(c => c.name === (selectedExercise.category as unknown as string)) ?? null
    : null;
  const relatedExercises = selectedExercise
    ? exercises.filter(e => (e.category as unknown as string) === (selectedExercise.category as unknown as string) && e.id !== selectedExercise.id).slice(0, 10)
    : [];

  // ── Handlers ────────────────────────────────────────────────────

  const toggleCollapse = (catId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  const handleSave = async (exerciseData: Partial<Exercise>) => {
    if (editingExercise) {
      await updateExercise(editingExercise.id, exerciseData);
      setEditingExercise(null);
    } else {
      await createExercise(exerciseData);
    }
    await fetchExercises();
    setShowCreateModal(false);
  };

  const handleArchive = async (exerciseId: string) => {
    await updateExercise(exerciseId, { is_archived: true } as any);
    await fetchExercises();
    if (selectedExerciseId === exerciseId) setSelectedExerciseId(null);
  };

  const handleCatRename = async (id: string, name: string) => {
    await updateCategory(id, name);
    await fetchCategories();
  };

  const handleCatRecolor = async (id: string, color: string) => {
    const cat = categories.find(c => c.id === id);
    if (cat) await updateCategory(id, cat.name, color);
    await fetchCategories();
  };

  const handleCatReorder = async (fromIdx: number, toIdx: number) => {
    const sorted = [...visibleCategories];
    const [moved] = sorted.splice(fromIdx, 1);
    sorted.splice(toIdx, 0, moved);
    await bulkReorderCategories(sorted.map(c => c.id));
    await fetchCategories();
  };

  const handleCatAdd = async (name: string, color: string) => {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.display_order), -1);
    await createCategory(name, maxOrder + 1, color);
    await fetchCategories();
  };

  const handleCatDelete = async (id: string) => {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;

    const { data: allAffected } = await supabase
      .from('exercises')
      .select('id')
      .eq('category', cat.name as any);

    if (allAffected && allAffected.length > 0) {
      let unspecCat = categories.find(c => c.name === 'Unspecified');
      if (!unspecCat) {
        const maxOrder = categories.reduce((m, c) => Math.max(m, c.display_order), -1);
        const { data: created } = await supabase
          .from('categories')
          .insert([{ name: 'Unspecified', display_order: maxOrder + 1, color: '#888780' }])
          .select()
          .single();
        if (created) unspecCat = created as any;
      }

      await supabase
        .from('exercises')
        .update({ category: 'Unspecified' } as any)
        .in('id', allAffected.map((e: any) => e.id));
    }

    await supabase.from('categories').delete().eq('id', id);
    await fetchExercises();
    await fetchCategories();
  };

  // ── Render helpers ───────────────────────────────────────────────

  function renderExercises(exList: Exercise[]) {
    if (viewMode === 'grid') {
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 'var(--space-sm)',
            padding: 'var(--space-md) var(--space-lg)',
          }}
        >
          {exList.map(ex => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              isSelected={selectedExerciseId === ex.id}
              athletePR={athletePRMap.get(ex.id) ?? null}
              onClick={() => setSelectedExerciseId(ex.id === selectedExerciseId ? null : ex.id)}
            />
          ))}
        </div>
      );
    }
    return (
      <div>
        {exList.map((ex, idx) => (
          <ExerciseListRow
            key={ex.id}
            exercise={ex}
            isSelected={selectedExerciseId === ex.id}
            athletePR={athletePRMap.get(ex.id) ?? null}
            onClick={() => setSelectedExerciseId(ex.id === selectedExerciseId ? null : ex.id)}
            rowIndex={idx}
          />
        ))}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <StandardPage>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          padding: 'var(--space-md) var(--space-lg)',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          flexShrink: 0,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-tertiary)',
              pointerEvents: 'none',
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
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--color-text-tertiary)',
                display: 'flex',
              }}
              aria-label="Clear search"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* View toggle (grid / list) */}
        <div
          style={{
            display: 'flex',
            gap: '1px',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '2px',
          }}
        >
          <button
            onClick={() => setViewMode('grid')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              fontSize: 'var(--text-caption)',
              fontFamily: 'var(--font-sans)',
              background: viewMode === 'grid' ? 'var(--color-bg-primary)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: viewMode === 'grid' ? 500 : 400,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            <Grid3X3 size={12} /> Grid
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              fontSize: 'var(--text-caption)',
              fontFamily: 'var(--font-sans)',
              background: viewMode === 'list' ? 'var(--color-bg-primary)' : 'transparent',
              color: viewMode === 'list' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: viewMode === 'list' ? 500 : 400,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 100ms ease-out',
            }}
          >
            <List size={12} /> List
          </button>
        </div>

        <Button variant="secondary" size="sm" icon={<Layers size={12} />}
          onClick={() => setShowCategoryModal(true)}>
          Categories
        </Button>

        <Button variant="secondary" size="sm" icon={<Upload size={12} />}
          onClick={() => setShowBulkImport(true)}>
          Import
        </Button>

        <Button variant="primary" size="md" icon={<Plus size={14} />}
          onClick={() => { setEditingExercise(null); setShowCreateModal(true); }}>
          Add exercise
        </Button>
      </div>

      {/* Main content — list/detail */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Exercise list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {viewMode === 'list' && <ListViewHeader />}

          {visibleCategories.map(cat => {
            const catExercises = filteredExercises.filter(ex => (ex.category as unknown as string) === cat.name);
            if (catExercises.length === 0 && searchQuery.trim()) return null;
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

          {/* Unspecified / orphan exercises */}
          {unspecifiedExercises.length > 0 && (() => {
            const orphanCat: Category = {
              id: '__unspecified__',
              name: 'Unspecified',
              color: 'var(--color-gray-400)',
              display_order: 9999,
              created_at: '',
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

          {/* Empty state */}
          {filteredExercises.length === 0 && (
            <div
              style={{
                padding: 'var(--space-2xl)',
                textAlign: 'center',
                fontSize: 'var(--text-body)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {searchQuery.trim()
                ? `No exercises match "${searchQuery}"`
                : 'No exercises yet. Click "Add exercise" to create one.'}
            </div>
          )}
        </div>

      </div>

      {/* Detail panel — fixed right-edge sidebar */}
      {selectedExercise && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end"
          onKeyDown={e => { if (e.key === 'Escape') setSelectedExerciseId(null); }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            onClick={() => setSelectedExerciseId(null)}
          />
          <div
            className="animate-sidebar-in relative z-10 h-full flex flex-col"
            style={{
              width: 440,
              background: 'var(--color-bg-primary)',
              borderLeft: '0.5px solid var(--color-border-tertiary)',
              boxShadow: '-8px 0 32px rgba(0,0,0,0.10)',
              overflow: 'hidden',
            }}
          >
            <ExerciseDetailPanel
              exercise={selectedExercise}
              category={selectedCategory}
              athlete={selectedAthlete}
              allAthletes={athletes}
              onClose={() => setSelectedExerciseId(null)}
              onEdit={ex => { setEditingExercise(ex); setShowCreateModal(true); }}
              onArchive={handleArchive}
              onSelectExercise={setSelectedExerciseId}
              relatedExercises={relatedExercises}
              allExercises={exercises}
            />
          </div>
        </div>
      )}

      {/* Modals */}
      {showCategoryModal && (
        <CategoryManagerModal
          categories={categories}
          exerciseCounts={exerciseCategoryCount}
          onRename={handleCatRename}
          onRecolor={handleCatRecolor}
          onReorder={handleCatReorder}
          onAdd={handleCatAdd}
          onDelete={handleCatDelete}
          onClose={() => setShowCategoryModal(false)}
        />
      )}

      <ExerciseFormModal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setEditingExercise(null); }}
        editingExercise={editingExercise}
        onSave={handleSave}
        allExercises={exercises}
      />

      {showBulkImport && (
        <ExerciseBulkImportModal
          onClose={() => setShowBulkImport(false)}
          onComplete={async () => { await fetchExercises(); setShowBulkImport(false); }}
        />
      )}
    </StandardPage>
  );
}
