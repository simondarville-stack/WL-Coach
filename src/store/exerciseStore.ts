import { create } from 'zustand';
import type { Exercise } from '../lib/database.types';
import type { Category } from '../hooks/useExercises';

interface ExerciseState {
  exercises: Exercise[];
  categories: Category[];
  setExercises: (exercises: Exercise[]) => void;
  setCategories: (categories: Category[]) => void;
}

export const useExerciseStore = create<ExerciseState>((set) => ({
  exercises: [],
  categories: [],
  setExercises: (exercises) => set({ exercises }),
  setCategories: (categories) => set({ categories }),
}));
