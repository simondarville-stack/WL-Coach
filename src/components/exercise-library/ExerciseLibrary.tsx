import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useExercises } from '../../hooks/useExercises';
import { useAthleteStore } from '../../store/athleteStore';
import { useAthletes } from '../../hooks/useAthletes';
import { ExerciseFormModal } from '../ExerciseFormModal';
import { ExerciseBulkImportModal } from '../ExerciseBulkImportModal';
import { ExerciseDetailPanel } from './ExerciseDetailPanel';
import { ExerciseListPanel } from './ExerciseListPanel';
import { ExerciseCategoryNav } from './ExerciseCategoryNav';
import type { Exercise } from '../../lib/database.types';

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
    for (const r of (data ?? []) as Array<{ exercise_id: string; pr_value_kg: number | null; pr_date: string | null }>) {
      map.set(r.exercise_id, r);
    }
    setAthletePRMap(map);
  }, [selectedAthlete?.id]);

  // Duplicate name detection (case-insensitive)
  const nameCounts = new Map<string, number>();
  for (const ex of exercises) {
    const key = ex.name.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const duplicateNames = new Set([...nameCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  const selectedExercise = exercises.find(e => e.id === selectedExerciseId) ?? null;
  const selectedCategory = selectedExercise
    ? categories.find(c => c.name === (selectedExercise.category as unknown as string)) ?? null
    : null;
  const relatedExercises = selectedExercise
    ? exercises.filter(e => (e.category as unknown as string) === (selectedExercise.category as unknown as string) && e.id !== selectedExercise.id).slice(0, 10)
    : [];

  // ── Handlers ────────────────────────────────────────────────────

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
    await updateExercise(exerciseId, { is_archived: true } as Partial<Exercise>);
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
    const visibleCategories = [...categories]
      .filter(c => !c.name.toLowerCase().includes('system') && c.name !== 'Unspecified')
      .sort((a, b) => a.display_order - b.display_order);
    const [moved] = visibleCategories.splice(fromIdx, 1);
    visibleCategories.splice(toIdx, 0, moved);
    await bulkReorderCategories(visibleCategories.map(c => c.id));
    await fetchCategories();
  };

  const handleCatAdd = async (name: string, color: string) => {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.display_order), -1);
    await createCategory(name, maxOrder + 1, color);
    await fetchCategories();
  };

  const handleCatDelete = async (id: string) => {
    // deleteCategory in useExercises now owns the reassign-then-delete sequence
    await deleteCategory(id);
    await fetchExercises();
    await fetchCategories();
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <>
      <ExerciseListPanel
        exercises={exercises}
        categories={categories}
        athletePRMap={athletePRMap}
        duplicateNames={duplicateNames}
        selectedExerciseId={selectedExerciseId}
        onSelectExercise={setSelectedExerciseId}
        onOpenCategoryModal={() => setShowCategoryModal(true)}
        onOpenBulkImport={() => setShowBulkImport(true)}
        onCreateExercise={() => { setEditingExercise(null); setShowCreateModal(true); }}
        hasSidePanel={selectedExerciseId !== null}
      />

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
              borderLeft: '0.5px solid var(--color-border-primary)',
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
        <ExerciseCategoryNav
          categories={categories}
          exercises={exercises}
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
    </>
  );
}
