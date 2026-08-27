import { lazy, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useExercises } from '../../hooks/useExercises';
import { useAthleteStore } from '../../store/athleteStore';
import { useExerciseStore } from '../../store/exerciseStore';
import { useCoachStore } from '../../store/coachStore';
import { useAthletes } from '../../hooks/useAthletes';
import {
  resolveLibraryScope, invalidateLibraryScope, canEditCatalogueRow, libraryLabelFor,
  type CoachLibraryScope,
} from '../../lib/libraryScope';
import { CatalogueSharingModal } from './CatalogueSharingModal';
import { ExerciseFormModal } from '../ExerciseFormModal';
// Lazy: the bulk-import modal drags the whole xlsx codec with it — loaded
// only when the coach actually opens Import.
const ExerciseBulkImportModal = lazy(() =>
  import('../ExerciseBulkImportModal').then(m => ({ default: m.ExerciseBulkImportModal })),
);
import { ExerciseDetailPanel } from './ExerciseDetailPanel';
import { ExerciseListPanel } from './ExerciseListPanel';
import { ExerciseCategoryNav } from './ExerciseCategoryNav';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';
import type { Exercise } from '../../lib/database.types';

export function ExerciseLibrary() {
  const { selectedAthlete } = useAthleteStore();
  const { athletes, fetchAllAthletes } = useAthletes();
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? '00000000-0000-0000-0000-000000000001');
  const invalidateExerciseCache = useExerciseStore(s => s.invalidate);

  const {
    exercises, categories, setExercises,
    fetchExercises, fetchCategories,
    createExercise, updateExercise, bulkReorderExercises,
    createCategory, updateCategory, deleteCategory,
    bulkReorderCategories,
  } = useExercises();

  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  // Category preselected when the coach starts the create form from a
  // specific section (e.g. "Add an exercise here" on an empty category).
  const [createInCategory, setCreateInCategory] = useState<string | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showSharing, setShowSharing] = useState(false);
  const [athletePRMap, setAthletePRMap] = useState<Map<string, { pr_value_kg: number | null; pr_date: string | null }>>(new Map());

  // Which catalogues the active coach can see/edit — drives the read-only
  // gating (viewer role on a shared club catalogue) and the library badges.
  const [scope, setScope] = useState<CoachLibraryScope | null>(null);
  useEffect(() => {
    let alive = true;
    resolveLibraryScope(activeCoachId).then(s => { if (alive) setScope(s); });
    return () => { alive = false; };
  }, [activeCoachId, showSharing]);

  useEffect(() => { fetchExercises(); fetchCategories(); fetchAllAthletes(); }, []);
  useEffect(() => { loadPRs(); }, [selectedAthlete?.id]);

  // Optimistic default while the scope resolves: everything editable (the
  // write guards in useExercises are authoritative anyway).
  const canEdit = useCallback(
    (ex: Exercise) => (scope ? canEditCatalogueRow(scope, ex) : true),
    [scope],
  );
  const clubLibraryIds = useMemo(
    () => new Set((scope?.clubs ?? []).map(c => c.libraryId)),
    [scope],
  );
  const libraryOptions = useMemo(() => {
    if (!scope?.available || !scope.personalLibraryId) return undefined;
    return [
      { id: scope.personalLibraryId, label: 'Personal', isClub: false },
      ...scope.clubs
        .filter(c => c.role === 'editor')
        .map(c => ({ id: c.libraryId, label: c.name, isClub: true })),
    ];
  }, [scope]);

  const handleSharingChanged = useCallback(() => {
    invalidateLibraryScope();
    invalidateExerciseCache();
    void fetchExercises();
    void fetchCategories();
    resolveLibraryScope(activeCoachId).then(setScope);
  }, [activeCoachId]);

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
      const id = editingExercise.id;
      await updateExercise(id, exerciseData);
      // Optimistic store merge — fetchExercises() short-circuits on a warm
      // cache, so the edit (incl. a new parent link) must be applied directly.
      setExercises(exercises.map(e => (e.id === id ? { ...e, ...exerciseData } as Exercise : e)));
      setEditingExercise(null);
    } else {
      const created = await createExercise(exerciseData);
      if (created) setExercises([created, ...exercises.filter(e => e.id !== created.id)]);
    }
    await fetchExercises();
    setShowCreateModal(false);
  };

  // Drag-to-move from the tree view: parentId=null promotes to a category root
  // (category is also set); orderedSiblingIds records the dropped position as
  // display_order across the target group. Optimistic, with revert on failure.
  const handleMoveExercise = async (
    exerciseId: string,
    parentId: string | null,
    category: string | undefined,
    orderedSiblingIds: string[],
  ) => {
    const snapshot = exercises;
    const orderMap = new Map(orderedSiblingIds.map((id, i) => [id, i] as const));
    setExercises(exercises.map(e => {
      if (e.id === exerciseId) {
        return {
          ...e,
          parent_exercise_id: parentId,
          ...(category !== undefined ? { category } : {}),
          display_order: orderMap.get(e.id) ?? e.display_order,
        } as Exercise;
      }
      if (orderMap.has(e.id)) return { ...e, display_order: orderMap.get(e.id)! };
      return e;
    }));
    try {
      const patch: Partial<Exercise> = { parent_exercise_id: parentId };
      if (category !== undefined) patch.category = category;
      await updateExercise(exerciseId, patch);
      await bulkReorderExercises(orderedSiblingIds);
    } catch {
      setExercises(snapshot); // revert on failure (error already surfaced by the hook)
    }
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
        onCreateExercise={(category) => {
          setEditingExercise(null);
          setCreateInCategory(category ?? null);
          setShowCreateModal(true);
        }}
        onMoveExercise={handleMoveExercise}
        hasSidePanel={selectedExerciseId !== null}
        onOpenSharing={() => setShowSharing(true)}
        libraryBadge={ex => (scope ? libraryLabelFor(scope, ex) : null)}
        canEditExercise={id => {
          const ex = exercises.find(e => e.id === id);
          return ex ? canEdit(ex) : true;
        }}
        clubLibraryIds={clubLibraryIds}
      />

      {/* Detail panel — fixed right-edge sidebar */}
      {selectedExercise && (
        <AdaptiveDialog
          mode="sidebar"
          panel="bare"
          onClose={() => setSelectedExerciseId(null)}
          ariaLabel={`Exercise · ${selectedExercise.name}`}
        >
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
              onEdit={ex => { setEditingExercise(ex); setCreateInCategory(null); setShowCreateModal(true); }}
              onArchive={handleArchive}
              onSelectExercise={setSelectedExerciseId}
              relatedExercises={relatedExercises}
              allExercises={exercises}
              readOnly={!canEdit(selectedExercise)}
              libraryLabel={scope ? libraryLabelFor(scope, selectedExercise) : null}
            />
          </div>
        </AdaptiveDialog>
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
        onClose={() => { setShowCreateModal(false); setEditingExercise(null); setCreateInCategory(null); }}
        editingExercise={editingExercise}
        onSave={handleSave}
        allExercises={exercises}
        initialCategory={createInCategory}
        libraryOptions={libraryOptions}
        defaultLibraryId={scope?.personalLibraryId ?? null}
      />

      {showSharing && (
        <CatalogueSharingModal
          onClose={() => setShowSharing(false)}
          onChanged={handleSharingChanged}
        />
      )}

      {showBulkImport && (
        <Suspense fallback={null}>
          <ExerciseBulkImportModal
            onClose={() => setShowBulkImport(false)}
            onComplete={async () => {
              await Promise.all([fetchExercises(), fetchCategories()]);
              setShowBulkImport(false);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
