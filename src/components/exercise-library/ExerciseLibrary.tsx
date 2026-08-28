import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useExercises } from '../../hooks/useExercises';
import { useAthleteStore } from '../../store/athleteStore';
import { useExerciseStore } from '../../store/exerciseStore';
import { useCoachStore } from '../../store/coachStore';
import { useAthletes } from '../../hooks/useAthletes';
import {
  resolveLibraryScope, invalidateLibraryScope, canEditCatalogueRow, libraryLabelFor,
  catalogueOrFilter, type CoachLibraryScope,
} from '../../lib/libraryScope';
import { CatalogueSharingModal } from './CatalogueSharingModal';
import { DuplicatesPanel, type DuplicatePair } from './DuplicatesPanel';
import { matchExercise } from '../../lib/exerciseMatching';
import { useExerciseUsage } from '../../hooks/useExerciseUsage';
import { rollUpUsage, type UsageRollup } from '../../lib/exerciseUsage';
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
    exercises, categories, setExercises, setCategories,
    fetchExercises, fetchCategories,
    createExercise, updateExercise, restoreExercise, bulkReorderExercises,
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
  // Parent preselected by the tree's "Add variation" context-menu entry.
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showSharing, setShowSharing] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [athletePRMap, setAthletePRMap] = useState<Map<string, { pr_value_kg: number | null; pr_date: string | null }>>(new Map());
  // Archived rows are kept out of the main store (everything downstream
  // assumes it holds only active exercises) and merged in for display only.
  const [archivedExercises, setArchivedExercises] = useState<Exercise[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  // Usage window (weeks) or null = column off. Remembered per coach, like the
  // tree's expand state — a per-viewer preference, not shared data.
  const [usageWeeks, setUsageWeeks] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(`emos_exercise_usage_weeks:${activeCoachId}`);
      return raw ? (Number(raw) || null) : null;
    } catch { return null; }
  });
  const changeUsageWeeks = useCallback((weeks: number | null) => {
    setUsageWeeks(weeks);
    try {
      const key = `emos_exercise_usage_weeks:${activeCoachId}`;
      if (weeks == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(weeks));
    } catch { /* storage blocked — the choice just won't persist */ }
  }, [activeCoachId]);
  const { usage, usageLoading } = useExerciseUsage(usageWeeks);

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

  // Archived rows in the coach's visible catalogues. Loaded regardless of the
  // toggle so the toolbar can show the count (they are few by nature).
  const loadArchived = useCallback(async () => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .or(await catalogueOrFilter(activeCoachId))
      .eq('is_archived', true)
      .neq('category', '— System')
      .order('name');
    setArchivedExercises((data ?? []) as Exercise[]);
  }, [activeCoachId]);
  useEffect(() => { void loadArchived(); }, [loadArchived]);

  /** Own + family usage per exercise, and the scale/prune numbers the
   *  toolbar and heat shading need. Computed over the visible catalogue. */
  const usageRollup = useMemo(
    () => (usageWeeks == null ? new Map<string, UsageRollup>() : rollUpUsage(exercises, usage)),
    [usageWeeks, exercises, usage],
  );
  const usageMax = useMemo(() => {
    let max = 0;
    for (const r of usageRollup.values()) max = Math.max(max, r.family.planned);
    return max;
  }, [usageRollup]);
  const unusedCount = useMemo(() => {
    if (usageWeeks == null) return 0;
    let n = 0;
    for (const ex of exercises) {
      if (ex.category === '— System') continue;
      const r = usageRollup.get(ex.id);
      if (!r || (r.family.planned === 0 && r.family.logged === 0)) n++;
    }
    return n;
  }, [usageWeeks, exercises, usageRollup]);

  /** Active rows, plus archived ones when the coach asks to see them. */
  const visibleExercises = useMemo(() => {
    if (!showArchived || archivedExercises.length === 0) return exercises;
    const seen = new Set(exercises.map(e => e.id));
    return [...exercises, ...archivedExercises.filter(a => !seen.has(a.id))];
  }, [exercises, archivedExercises, showArchived]);

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
  const canEditCategoryById = useCallback((categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return false;
    return scope ? canEditCatalogueRow(scope, cat) : true;
  }, [categories, scope]);
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

  // Phase-4 hygiene: personal exercises that duplicate a club-catalogue one
  // (shared matching rule — code / name / alias). Detected over the already
  // loaded visible set, so this costs no extra queries.
  // Latest duplicate pairs for the context menu's hasDuplicate check —
  // a ref because the pairs memo is derived further down.
  const duplicatePairsRef = useRef<DuplicatePair[]>([]);

  // Right-click actions for the tree rows. Wired here so the tree stays a
  // pure catalogue view and every mutation goes through the guarded hooks.
  const treeContextActions = useMemo(() => ({
    onEdit: (id: string) => {
      const ex = visibleExercises.find(e => e.id === id);
      if (!ex) return;
      setEditingExercise(ex);
      setCreateInCategory(null);
      setCreateParentId(null);
      setShowCreateModal(true);
    },
    onArchive: (id: string) => { void handleArchive(id); },
    onRestore: (id: string) => { void handleRestore(id); },
    onAddVariation: (parentId: string) => {
      const parent = exercises.find(e => e.id === parentId);
      setEditingExercise(null);
      setCreateInCategory(parent?.category ?? null);
      setCreateParentId(parentId);
      setShowCreateModal(true);
    },
    moveTargetsFor: (id: string) => {
      // Promote is personal → club only, and only where the coach edits
      // the target catalogue. Club rows move via the club admin surfaces.
      if (!scope?.available || !scope.personalLibraryId) return [];
      const ex = exercises.find(e => e.id === id);
      if (!ex || ex.library_id !== scope.personalLibraryId) return [];
      return scope.clubs
        .filter(c => c.role === 'editor')
        .map(c => ({ id: c.libraryId, name: c.name }));
    },
    onMoveToLibrary: (exerciseId: string, libraryId: string, libraryName: string) => {
      const ex = exercises.find(e => e.id === exerciseId);
      if (!ex) return;
      if (!window.confirm(
        `Move "${ex.name}" into the "${libraryName}" catalogue?\n\n` +
        'The exercise keeps its id (all history follows it) and becomes visible to every member of the catalogue.',
      )) return;
      void (async () => {
        await updateExercise(exerciseId, { library_id: libraryId } as Partial<Exercise>);
        setExercises(exercises.map(e => (e.id === exerciseId ? { ...e, library_id: libraryId } as Exercise : e)));
        await fetchExercises();
      })();
    },
    hasDuplicate: (id: string) => duplicatePairsRef.current.some(p => p.personal.id === id),
    onReviewDuplicate: () => setShowDuplicates(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [exercises, visibleExercises, scope]);

  const duplicatePairs = useMemo<DuplicatePair[]>(() => {
    if (!scope?.available || !scope.personalLibraryId || scope.clubs.length === 0) return [];
    const clubNameById = new Map(scope.clubs.map(c => [c.libraryId, c.name]));
    const clubRows = exercises.filter(e => e.library_id != null && clubNameById.has(e.library_id));
    if (clubRows.length === 0) return [];
    const personalRows = exercises.filter(
      e => e.library_id === scope.personalLibraryId && e.category !== '— System',
    );
    const pairs: DuplicatePair[] = [];
    for (const personal of personalRows) {
      const { match, matchBy } = matchExercise(personal, clubRows);
      if (match && matchBy) {
        pairs.push({ personal, club: match, matchBy, clubLabel: clubNameById.get(match.library_id!) ?? 'Club' });
      }
    }
    return pairs;
  }, [exercises, scope]);
  duplicatePairsRef.current = duplicatePairs;

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

  // Lookups span archived rows too, so selecting one (or right-clicking it)
  // works while "show archived" is on.
  const selectedExercise = visibleExercises.find(e => e.id === selectedExerciseId) ?? null;
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
    setCreateParentId(null);
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
    // Drop the row from the store directly: fetchExercises() short-circuits
    // on a warm cache, so without this the archived row lingers in the tree.
    setExercises(exercises.filter(e => e.id !== exerciseId));
    if (selectedExerciseId === exerciseId) setSelectedExerciseId(null);
    await loadArchived();
  };

  const handleRestore = async (exerciseId: string) => {
    await restoreExercise(exerciseId);
    setArchivedExercises(prev => prev.filter(e => e.id !== exerciseId));
    invalidateExerciseCache();
    await Promise.all([fetchExercises(), loadArchived()]);
  };

  /** Category reorder dragged in the tree — optimistic, revert on failure.
   *  Writes are scoped to editable libraries inside bulkReorderCategories. */
  const handleReorderCategoriesFromTree = async (orderedIds: string[]) => {
    const snapshot = categories;
    const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const));
    setCategories(
      categories
        .map(c => (orderMap.has(c.id) ? { ...c, display_order: orderMap.get(c.id)! } : c))
        .sort((a, b) => a.display_order - b.display_order),
    );
    try {
      await bulkReorderCategories(orderedIds);
    } catch {
      setCategories(snapshot);
    }
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
        exercises={visibleExercises}
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
          setCreateParentId(null);
          setShowCreateModal(true);
        }}
        onMoveExercise={handleMoveExercise}
        hasSidePanel={selectedExerciseId !== null}
        onOpenSharing={() => setShowSharing(true)}
        libraryBadge={ex => (scope ? libraryLabelFor(scope, ex) : null)}
        canEditExercise={id => {
          const ex = visibleExercises.find(e => e.id === id);
          return ex ? canEdit(ex) : true;
        }}
        clubLibraryIds={clubLibraryIds}
        duplicatesCount={duplicatePairs.length}
        onOpenDuplicates={() => setShowDuplicates(true)}
        contextActions={treeContextActions}
        showArchived={showArchived}
        onToggleArchived={setShowArchived}
        archivedCount={archivedExercises.length}
        canEditCategory={canEditCategoryById}
        onReorderCategories={handleReorderCategoriesFromTree}
        usageWeeks={usageWeeks}
        onUsageWeeksChange={changeUsageWeeks}
        usageFor={id => usageRollup.get(id) ?? null}
        usageMax={usageMax}
        usageLoading={usageLoading}
        unusedCount={unusedCount}
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
        onClose={() => { setShowCreateModal(false); setEditingExercise(null); setCreateInCategory(null); setCreateParentId(null); }}
        editingExercise={editingExercise}
        onSave={handleSave}
        allExercises={exercises}
        initialCategory={createInCategory}
        initialParentId={createParentId}
        libraryOptions={libraryOptions}
        defaultLibraryId={scope?.personalLibraryId ?? null}
      />

      {showSharing && (
        <CatalogueSharingModal
          onClose={() => setShowSharing(false)}
          onChanged={handleSharingChanged}
        />
      )}

      {showDuplicates && scope?.personalLibraryId && (
        <DuplicatesPanel
          pairs={duplicatePairs}
          personalLibraryId={scope.personalLibraryId}
          onClose={() => setShowDuplicates(false)}
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
