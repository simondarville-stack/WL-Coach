import { useState, useEffect, useCallback, useRef } from 'react';
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
      className={`border rounded-lg p-2.5 cursor-pointer transition-colors ${
        isSelected
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: exercise.color }} />
        <span className="font-mono text-[11px] font-medium text-gray-900 truncate flex-1">
          {exercise.exercise_code || exercise.name}
        </span>
        {exercise.is_competition_lift && (
          <span className="text-[7px] font-medium bg-red-50 text-red-500 px-1 rounded ml-auto flex-shrink-0">COMP</span>
        )}
      </div>
      <div className="text-[10px] text-gray-500 mb-1.5 truncate">{exercise.name}</div>
      {athletePR?.pr_value_kg != null && (
        <div className="text-[9px] text-gray-400">
          <span className="font-mono font-semibold text-gray-700">{athletePR.pr_value_kg}</span> kg PR
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
  const catName = exercise.category as unknown as string;
  const unitLabel = UNIT_LABELS[exercise.default_unit as string] ?? exercise.default_unit ?? 'kg';
  const isEven = rowIndex % 2 === 0;
  const bg = isSelected
    ? 'bg-blue-50 border-l-2 border-l-blue-400'
    : isEven ? 'bg-white' : 'bg-gray-50/70';

  return (
    <div
      onClick={onClick}
      className={`flex items-center px-2 py-1.5 cursor-pointer transition-colors hover:bg-blue-50/40 ${bg}`}
    >
      {/* Color dot */}
      <span className="w-6 flex-shrink-0 flex justify-center">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: exercise.color }} />
      </span>
      {/* Code */}
      <span className="w-12 flex-shrink-0 font-mono text-[11px] font-medium text-gray-600 truncate">
        {exercise.exercise_code ?? ''}
      </span>
      {/* Name */}
      <span className="flex-1 min-w-0 text-[12px] text-gray-800 font-medium truncate pr-3">
        {exercise.name}
      </span>
      {/* Unit */}
      <span className="w-10 flex-shrink-0 text-[10px] text-gray-400 text-center">
        {unitLabel}
      </span>
      {/* Category */}
      <span className="w-[90px] flex-shrink-0 text-[10px] text-gray-500 truncate pr-1">
        {catName || '—'}
      </span>
      {/* COMP badge */}
      <span className="w-10 flex-shrink-0 flex justify-center">
        {exercise.is_competition_lift && (
          <span className="text-[7px] font-medium bg-red-50 text-red-500 px-1 py-px rounded border border-red-100">COMP</span>
        )}
      </span>
      {/* PR */}
      <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] font-semibold text-blue-600">
        {athletePR?.pr_value_kg != null ? `${athletePR.pr_value_kg} kg` : ''}
      </span>
    </div>
  );
}

// ── ListViewHeader ─────────────────────────────────────────────────

function ListViewHeader() {
  return (
    <div className="flex items-center px-2 py-1.5 bg-gray-100 border-b border-gray-200 sticky top-0 z-10">
      <span className="w-6 flex-shrink-0" />
      <span className="w-12 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide">Code</span>
      <span className="flex-1 min-w-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide pr-3">Name</span>
      <span className="w-10 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-center">Unit</span>
      <span className="w-[90px] flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide">Category</span>
      <span className="w-10 flex-shrink-0" />
      <span className="w-16 flex-shrink-0 text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">PR</span>
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
    createExercise, updateExercise, deleteExercise,
    createCategory, updateCategory, deleteCategory,
    swapCategoryOrder, bulkReorderCategories,
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

    // Move ALL exercises (including archived) that reference this category.
    // Must query DB directly — in-memory exercises list excludes archived rows.
    const { data: allAffected } = await supabase
      .from('exercises')
      .select('id')
      .eq('category', cat.name as any);

    if (allAffected && allAffected.length > 0) {
      // Ensure an Unspecified category exists (FK requires a valid category name)
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1.5 pb-4">
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
    <div className="flex flex-col h-full overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search exercises…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <XIcon size={12} />
            </button>
          )}
        </div>

        <div className="flex gap-px bg-gray-100 rounded-md p-0.5">
          <button onClick={() => setViewMode('grid')}
            className={`px-2.5 py-1 text-[10px] rounded flex items-center gap-1 ${viewMode === 'grid' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}>
            <Grid3X3 size={11} /> Grid
          </button>
          <button onClick={() => setViewMode('list')}
            className={`px-2.5 py-1 text-[10px] rounded flex items-center gap-1 ${viewMode === 'list' ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}>
            <List size={11} /> List
          </button>
        </div>

        <button
          onClick={() => setShowCategoryModal(true)}
          className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
        >
          <Layers size={12} /> Categories
        </button>

        <button onClick={() => setShowBulkImport(true)}
          className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1">
          <Upload size={12} /> Import
        </button>

        <button
          onClick={() => { setEditingExercise(null); setShowCreateModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus size={14} /> Add exercise
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Exercise list */}
        <div className="flex-1 overflow-y-auto">
          {/* List view column header */}
          {viewMode === 'list' && <ListViewHeader />}

          {/* Named category sections */}
          {visibleCategories.map(cat => {
            const catExercises = filteredExercises.filter(ex => (ex.category as unknown as string) === cat.name);
            if (catExercises.length === 0 && searchQuery.trim()) return null;
            const isCollapsed = collapsedCategories.has(cat.id);

            return (
              <div key={cat.id} className={viewMode === 'list' ? '' : 'px-4'}>
                <div
                  className={`flex items-center gap-2 py-2 cursor-pointer select-none group ${
                    viewMode === 'list' ? 'px-3 border-b border-gray-100 bg-gray-50/80' : 'py-2.5'
                  }`}
                  onClick={() => toggleCollapse(cat.id)}
                >
                  <ChevronRight size={12}
                    className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: cat.color ?? '#888780' }} />
                  <span className="text-xs font-semibold text-gray-800">{cat.name}</span>
                  <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 rounded-full">
                    {catExercises.length}
                  </span>
                  {viewMode !== 'list' && <span className="flex-1 h-px bg-gray-100" />}
                </div>
                {!isCollapsed && renderExercises(catExercises)}
              </div>
            );
          })}

          {/* Unspecified bucket — always shown if there are unspecified exercises */}
          {unspecifiedExercises.length > 0 && (
            <div className={viewMode === 'list' ? '' : 'px-4'}>
              <div
                className={`flex items-center gap-2 cursor-pointer select-none ${
                  viewMode === 'list' ? 'px-3 py-2 border-b border-gray-100 bg-gray-50/80' : 'py-2.5'
                }`}
                onClick={() => toggleCollapse('__unspecified')}
              >
                <ChevronRight size={12}
                  className={`text-gray-400 transition-transform ${collapsedCategories.has('__unspecified') ? '' : 'rotate-90'}`} />
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-gray-300" />
                <span className="text-xs font-semibold text-gray-500">Unspecified</span>
                <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 rounded-full">
                  {unspecifiedExercises.length}
                </span>
                {viewMode !== 'list' && <span className="flex-1 h-px bg-gray-100" />}
              </div>
              {!collapsedCategories.has('__unspecified') && renderExercises(unspecifiedExercises)}
            </div>
          )}

          {filteredExercises.length === 0 && (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">
              {searchQuery ? `No exercises match "${searchQuery}"` : 'No exercises yet.'}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedExercise && (
          <div className="w-[440px] flex-shrink-0 border-l border-gray-200 overflow-y-auto bg-white">
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
        )}
      </div>

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
    </div>
  );
}
