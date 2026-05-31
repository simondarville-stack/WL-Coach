import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Exercise, CategoryRow } from '../lib/database.types';
import { getOwnerId } from '../lib/ownerContext';

export type Category = CategoryRow;

interface ExerciseState {
  exercises: Exercise[];
  categories: Category[];
  exercisesLoading: boolean;
  categoriesLoading: boolean;
  /** Which coach's library is currently in the store. Null on first load.
   *  When a fetch is requested for a different owner the cache is bypassed
   *  and the store is repopulated — this is what enables the planner to
   *  hot-swap to the host coach's library when working on a shared athlete. */
  exercisesOwnerId: string | null;
  categoriesOwnerId: string | null;
  // Setters (used by mutation hooks after writes)
  setExercises: (exercises: Exercise[]) => void;
  setCategories: (categories: Category[]) => void;
  // Fetch actions. Pass an explicit ownerId to load another coach's
  // library (used in shared-athlete planning); omit to use the active
  // coach's library.
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
        .eq('owner_id', target)
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
        .eq('owner_id', target)
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
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('owner_id', target)
        .order('display_order', { ascending: true });
      if (error) throw error;
      set({ categories: data || [], categoriesOwnerId: target });
    } finally {
      set({ categoriesLoading: false });
    }
  },
}));
