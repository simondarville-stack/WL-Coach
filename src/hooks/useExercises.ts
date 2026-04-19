import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Exercise, CategoryRow } from '../lib/database.types';
import { useExerciseStore } from '../store/exerciseStore';
import { getOwnerId } from '../lib/ownerContext';

// Re-export CategoryRow as Category for backward compatibility
export type Category = CategoryRow;

export function useExercises() {
  const {
    exercises,
    categories,
    exercisesLoading,
    categoriesLoading,
    setExercises: storeSetExercises,
    setCategories: storeSetCategories,
    fetchExercises: storeFetchExercises,
    fetchExercisesByName: storeFetchExercisesByName,
    fetchCategories: storeFetchCategories,
  } = useExerciseStore();

  // Local state only for CRUD mutation feedback (not list state)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delegate list fetches to the store (single source of truth)
  const fetchExercises = () => storeFetchExercises();
  const fetchExercisesByName = () => storeFetchExercisesByName();
  const fetchCategories = () => storeFetchCategories();

  // fetchAllExercisesIncludingArchived still uses local pattern since it's admin-only
  const fetchAllExercisesIncludingArchived = async () => {
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('created_at', { ascending: false });
      if (error) throw error;
      storeSetExercises(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercises');
    }
  };

  // fetchCategoriesWithError is used by Settings which needs loading/error feedback
  const fetchCategoriesWithError = async () => {
    try {
      setLoading(true);
      setError(null);
      await storeFetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  // --- Exercise CRUD ---

  const createExercise = async (exerciseData: Partial<Exercise>): Promise<Exercise | null> => {
    try {
      const { data, error } = await supabase
        .from('exercises')
        .insert([{ ...exerciseData, owner_id: getOwnerId() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
      throw err;
    }
  };

  const bulkCreateExercises = async (rows: Partial<Exercise>[]): Promise<number> => {
    try {
      const ownerId = getOwnerId();
      const { data, error } = await supabase.from('exercises').insert(rows.map(r => ({ ...r, owner_id: ownerId }))).select();
      if (error) throw error;
      return data?.length ?? 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import exercises');
      throw err;
    }
  };

  const updateExercise = async (id: string, exerciseData: Partial<Exercise>) => {
    try {
      const { data: existing } = await supabase.from('exercises').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
      const { error } = await supabase.from('exercises').update(exerciseData).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
      throw err;
    }
  };

  const deleteExercise = async (id: string): Promise<{ archived: boolean }> => {
    try {
      const { error } = await supabase.from('exercises').delete().eq('id', id);

      if (error?.code === '23503') {
        // FK violation — exercise is in use, archive instead
        await supabase.from('exercises').update({ is_archived: true }).eq('id', id);
        return { archived: true };
      }

      if (error) throw error;
      return { archived: false };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
      throw err;
    }
  };

  const restoreExercise = async (id: string) => {
    try {
      const { error } = await supabase.from('exercises').update({ is_archived: false }).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore exercise');
      throw err;
    }
  };

  // --- Category CRUD ---

  const createCategory = async (name: string, displayOrder: number, color?: string) => {
    try {
      const { error } = await supabase
        .from('categories')
        .insert([{ name, display_order: displayOrder, color: color ?? '#888780' }]);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
      throw err;
    }
  };

  const updateCategory = async (id: string, name: string, color?: string) => {
    try {
      const patch: Record<string, string> = { name };
      if (color !== undefined) patch.color = color;
      const { error } = await supabase
        .from('categories')
        .update(patch)
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
      throw err;
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      // Reassign any exercises in this category to "Unspecified" before deleting
      const { data: catRow } = await supabase.from('categories').select('name').eq('id', id).single();
      if (catRow) {
        const ownerId = getOwnerId();
        const { data: affected } = await supabase
          .from('exercises')
          .select('id')
          .eq('category', catRow.name)
          .eq('owner_id', ownerId);
        if (affected && affected.length > 0) {
          // Ensure "Unspecified" category exists
          const { data: existingUnspec } = await supabase
            .from('categories')
            .select('id')
            .eq('name', 'Unspecified')
            .maybeSingle();
          if (!existingUnspec) {
            const { data: allCats } = await supabase.from('categories').select('display_order');
            const maxOrder = (allCats ?? []).reduce((m: number, c: { display_order: number }) => Math.max(m, c.display_order), -1);
            await supabase
              .from('categories')
              .insert([{ name: 'Unspecified', display_order: maxOrder + 1, color: '#888780' }]);
          }
          await supabase
            .from('exercises')
            .update({ category: 'Unspecified' })
            .in('id', affected.map((e: { id: string }) => e.id))
            .eq('owner_id', ownerId);
        }
      }
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
      throw err;
    }
  };

  const bulkReorderCategories = async (orderedIds: string[]) => {
    try {
      const results = await Promise.all(
        orderedIds.map((id, i) => supabase.from('categories').update({ display_order: i }).eq('id', id))
      );
      const firstError = results.find(r => r.error)?.error;
      if (firstError) throw firstError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder categories');
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
    setExercises: storeSetExercises,
    categories,
    setCategories: storeSetCategories,
    loading: loading || exercisesLoading || categoriesLoading,
    error,
    setError,
    fetchExercises,
    fetchExercisesByName,
    fetchAllExercisesIncludingArchived,
    createExercise,
    bulkCreateExercises,
    updateExercise,
    deleteExercise,
    restoreExercise,
    fetchCategories,
    fetchCategoriesWithError,
    createCategory,
    updateCategory,
    deleteCategory,
    swapCategoryOrder,
    bulkReorderCategories,
  };
}
