import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Exercise, CategoryRow } from '../lib/database.types';
import { getOwnerId } from '../lib/ownerContext';
import { catalogueOrFilter, resolveLibraryScope } from '../lib/libraryScope';

export type Category = CategoryRow;

/**
 * Categories resolve across the visible library set, deduped by NAME: two
 * libraries may both define "Squat", but the list must show one "Squat"
 * section holding both club and personal exercises. The club definition wins
 * (colour, display order); personal-only names keep their own row.
 */
function dedupeCategories(rows: CategoryRow[], clubLibraryIds: Set<string>): CategoryRow[] {
  const byName = new Map<string, CategoryRow>();
  for (const row of rows) {
    const existing = byName.get(row.name);
    const rowIsClub = row.library_id != null && clubLibraryIds.has(row.library_id);
    const existingIsClub = existing?.library_id != null && clubLibraryIds.has(existing.library_id);
    if (!existing || (rowIsClub && !existingIsClub)) byName.set(row.name, row);
  }
  return [...byName.values()].sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
  );
}

interface ExerciseState {
  exercises: Exercise[];
  categories: Category[];
  exercisesLoading: boolean;
  categoriesLoading: boolean;
  /** Which coach's catalogue view is currently in the store. Null on first
   *  load. When a fetch is requested for a different owner the cache is
   *  bypassed and the store is repopulated — this is what enables the planner
   *  to hot-swap to the host coach's catalogue when working on a shared
   *  athlete. The loaded set is the owner's VISIBLE libraries (personal +
   *  accepted club catalogues), resolved via libraryScope. */
  exercisesOwnerId: string | null;
  categoriesOwnerId: string | null;
  // Setters (used by mutation hooks after writes)
  setExercises: (exercises: Exercise[]) => void;
  setCategories: (categories: Category[]) => void;
  /** Force the next fetch to hit the network — call after library membership
   *  or seeding changes the visible set without changing the owner. */
  invalidate: () => void;
  // Fetch actions. Pass an explicit ownerId to load another coach's
  // catalogue view (used in shared-athlete planning); omit to use the
  // active coach's.
  fetchExercises: (ownerId?: string) => Promise<void>;
  fetchExercisesByName: (ownerId?: string) => Promise<void>;
  fetchCategories: (ownerId?: string) => Promise<void>;
}

export const useExerciseStore = create<ExerciseState>((set, get) => ({
  exercises: [],
  categories: [],
  exercisesLoading: false,
  categoriesLoading: false,
  exercisesOwnerId: null,
  categoriesOwnerId: null,

  setExercises: (exercises) => set({ exercises }),
  setCategories: (categories) => set({ categories }),
  invalidate: () => set({ exercisesOwnerId: null, categoriesOwnerId: null }),

  fetchExercises: async (ownerId?: string) => {
    const target = ownerId ?? getOwnerId();
    const state = get();
    if (state.exercisesLoading) return;
    if (state.exercisesOwnerId === target && state.exercises.length > 0) return;
    set({ exercisesLoading: true });
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .or(await catalogueOrFilter(target))
        .eq('is_archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      set({ exercises: data || [], exercisesOwnerId: target });
    } finally {
      set({ exercisesLoading: false });
    }
  },

  fetchExercisesByName: async (ownerId?: string) => {
    const target = ownerId ?? getOwnerId();
    const state = get();
    if (state.exercisesLoading) return;
    if (state.exercisesOwnerId === target && state.exercises.length > 0) return;
    set({ exercisesLoading: true });
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .or(await catalogueOrFilter(target))
        .eq('is_archived', false)
        .order('name');
      if (error) throw error;
      set({ exercises: data || [], exercisesOwnerId: target });
    } finally {
      set({ exercisesLoading: false });
    }
  },

  fetchCategories: async (ownerId?: string) => {
    const target = ownerId ?? getOwnerId();
    const state = get();
    if (state.categoriesLoading) return;
    if (state.categoriesOwnerId === target && state.categories.length > 0) return;
    set({ categoriesLoading: true });
    try {
      const [scope, filter] = await Promise.all([
        resolveLibraryScope(target),
        catalogueOrFilter(target),
      ]);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .or(filter)
        .order('display_order', { ascending: true });
      if (error) throw error;
      const clubIds = new Set(scope.clubs.map(c => c.libraryId));
      set({
        categories: dedupeCategories((data || []) as CategoryRow[], clubIds),
        categoriesOwnerId: target,
      });
    } finally {
      set({ categoriesLoading: false });
    }
  },
}));
