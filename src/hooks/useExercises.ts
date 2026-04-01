import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Exercise } from '../lib/database.types';
import { useExerciseStore } from '../store/exerciseStore';

export interface Category {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export function useExercises() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setExercises: storeSetExercises, setCategories: storeSetCategories } = useExerciseStore();

  // --- Exercise operations ---

  const fetchExercises = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = data || [];
      setExercises(result);
      storeSetExercises(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    } finally {
      setLoading(false);
    }
  };

  const fetchExercisesByName = async () => {
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .order('name');
      if (error) throw error;
      const result = data || [];
      setExercises(result);
      storeSetExercises(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    }
  };

  const createExercise = async (exerciseData: Partial<Exercise>) => {
    try {
      const { error } = await supabase.from('exercises').insert([exerciseData]);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
      throw err;
    }
  };

  const bulkCreateExercises = async (rows: Partial<Exercise>[]): Promise<number> => {
    try {
      const { data, error } = await supabase.from('exercises').insert(rows).select();
      if (error) throw error;
      return data?.length ?? 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import exercises');
      throw err;
    }
  };

  const updateExercise = async (id: string, exerciseData: Partial<Exercise>) => {
    try {
      const { error } = await supabase.from('exercises').update(exerciseData).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
      throw err;
    }
  };

  const deleteExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('exercises').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
      throw err;
    }
  };

  // --- Category operations ---

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      const result = data || [];
      setCategories(result);
      storeSetCategories(result);
    } catch (err) {
    }
  };

  const fetchCategoriesWithError = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('display_order', { ascending: true });
      if (error) throw error;
      const result = data || [];
      setCategories(result);
      storeSetCategories(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const createCategory = async (name: string, displayOrder: number) => {
    try {
      const { error } = await supabase
        .from('categories')
        .insert([{ name, display_order: displayOrder }]);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
      throw err;
    }
  };

  const updateCategory = async (id: string, name: string) => {
    try {
      const { error } = await supabase
        .from('categories')
        .update({ name })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
      throw err;
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
      throw err;
    }
  };

  const swapCategoryOrder = async (
    catId: string, catNewOrder: number,
    swapId: string, swapNewOrder: number,
  ) => {
    try {
      const { error: e1 } = await supabase
        .from('categories')
        .update({ display_order: catNewOrder })
        .eq('id', catId);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from('categories')
        .update({ display_order: swapNewOrder })
        .eq('id', swapId);
      if (e2) throw e2;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder categories');
      throw err;
    }
  };

  return {
    exercises,
    setExercises,
    categories,
    setCategories,
    loading,
    error,
    setError,
    fetchExercises,
    fetchExercisesByName,
    createExercise,
    bulkCreateExercises,
    updateExercise,
    deleteExercise,
    fetchCategories,
    fetchCategoriesWithError,
    createCategory,
    updateCategory,
    deleteCategory,
    swapCategoryOrder,
  };
}
