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
  // Setters (used by mutation hooks after writes)
  setExercises: (exercises: Exercise[]) => void;
  setCategories: (categories: Category[]) => void;
  // Fetch actions — fetched once per session, consumers call these
  fetchExercises: () => Promise<void>;
  fetchExercisesByName: () => Promise<void>;
  fetchCategories: () => Promise<void>;
}

export const useExerciseStore = create<ExerciseState>((set, get) => ({
  exercises: [],
  categories: [],
  exercisesLoading: false,
  categoriesLoading: false,

  setExercises: (exercises) => set({ exercises }),
  setCategories: (categories) => set({ categories }),

  fetchExercises: async () => {
    if (get().exercisesLoading) return;
    set({ exercisesLoading: true });
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .eq('owner_id', getOwnerId())
        .eq('is_archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      set({ exercises: data || [] });
    } finally {
      set({ exercisesLoading: false });
    }
  },

  fetchExercisesByName: async () => {
    if (get().exercisesLoading) return;
    set({ exercisesLoading: true });
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .eq('owner_id', getOwnerId())
        .eq('is_archived', false)
        .order('name');
      if (error) throw error;
      set({ exercises: data || [] });
    } finally {
      set({ exercisesLoading: false });
    }
  },

  fetchCategories: async () => {
    if (get().categoriesLoading) return;
    set({ categoriesLoading: true });
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('display_order', { ascending: true });
      if (error) throw error;
      set({ categories: data || [] });
    } finally {
      set({ categoriesLoading: false });
    }
  },
}));
