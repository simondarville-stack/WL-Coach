import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Exercise, CategoryRow } from '../lib/database.types';
import { useExerciseStore } from '../store/exerciseStore';
import { getOwnerId, getContextOwnerId } from '../lib/ownerContext';
import { catalogueOrFilter, resolveLibraryScope, canEditCatalogueRow } from '../lib/libraryScope';
import { describeError } from '../lib/errorMessage';

/**
 * Write guard for catalogue rows: throws unless the active coach may edit
 * the given exercises/categories row. Personal rows require ownership;
 * club rows require an 'editor' membership — viewers have a read-only lock
 * on the shared tree, which this enforces on every mutation path.
 */
async function assertCatalogueRowEditable(
  table: 'exercises' | 'categories',
  id: string,
): Promise<{ library_id: string | null; owner_id: string }> {
  const { data: existing, error } = await supabase
    .from(table)
    .select('owner_id, library_id')
    .eq('id', id)
    .single();
  if (error || !existing) throw new Error('Not found');
  const scope = await resolveLibraryScope(getOwnerId());
  if (!canEditCatalogueRow(scope, existing)) {
    throw new Error('Access denied: this catalogue is read-only for you');
  }
  return existing;
}

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
        .or(await catalogueOrFilter(getOwnerId()))
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
      // Mid-planning exercise creation should land in the host's library
      // when the active coach is co-coaching a shared athlete (the
      // programme references this exercise, and the programme lives in
      // the host's context). Defaults to the active coach for everything
      // else (managing your own library directly).
      const { data, error } = await supabase
        .from('exercises')
        .insert([{ ...exerciseData, owner_id: getContextOwnerId() }])
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
      await assertCatalogueRowEditable('exercises', id);
      // Moving a row INTO a library (promote to club / back to personal) is
      // itself gated: the target must also be editable by the active coach.
      if (exerciseData.library_id !== undefined && exerciseData.library_id !== null) {
        const scope = await resolveLibraryScope(getOwnerId());
        if (scope.available && !scope.editableLibraryIds.includes(exerciseData.library_id)) {
          throw new Error('Access denied: you cannot move exercises into that catalogue');
        }
      }
      const { error } = await supabase.from('exercises').update(exerciseData).eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save exercise');
      throw err;
    }
  };

  const deleteExercise = async (id: string): Promise<{ archived: boolean }> => {
    try {
      await assertCatalogueRowEditable('exercises', id);
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

  /**
   * Archive many exercises at once (the prune flow). Rows the coach may not
   * edit — a viewer's club-catalogue rows — are skipped rather than failing
   * the batch, and reported back so the UI can say so. Archiving is
   * reversible; nothing is deleted.
   */
  const bulkArchiveExercises = async (
    ids: string[],
  ): Promise<{ archived: number; skipped: number }> => {
    if (ids.length === 0) return { archived: 0, skipped: 0 };
    try {
      const { data: rows, error: readError } = await supabase
        .from('exercises')
        .select('id, owner_id, library_id')
        .in('id', ids);
      if (readError) throw readError;
      const scope = await resolveLibraryScope(getOwnerId());
      const allowed = ((rows ?? []) as Array<{ id: string; owner_id: string; library_id: string | null }>)
        .filter(r => canEditCatalogueRow(scope, r))
        .map(r => r.id);
      if (allowed.length > 0) {
        const { error } = await supabase
          .from('exercises')
          .update({ is_archived: true })
          .in('id', allowed);
        if (error) throw error;
      }
      return { archived: allowed.length, skipped: ids.length - allowed.length };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive exercises');
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

  // Persist manual sibling order (catalogue tree): writes display_order = index
  // for each id, scoped to libraries the coach can edit (rows in read-only
  // club catalogues are silently untouched). Mirrors bulkReorderCategories.
  const bulkReorderExercises = async (orderedIds: string[]) => {
    try {
      const scope = await resolveLibraryScope(getOwnerId());
      const results = await Promise.all(
        orderedIds.map((id, i) => {
          const q = supabase.from('exercises').update({ display_order: i }).eq('id', id);
          return scope.available
            ? q.in('library_id', scope.editableLibraryIds)
            : q.eq('owner_id', scope.coachId);
        }),
      );
      const firstError = results.find(r => r.error)?.error;
      if (firstError) throw firstError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder exercises');
      throw err;
    }
  };

  // --- Category CRUD ---

  const createCategory = async (name: string, displayOrder: number, color?: string, libraryId?: string | null) => {
    try {
      // library_id omitted → the DB trigger defaults it to the coach's
      // personal library. Editors pass a club library id explicitly.
      const row: Record<string, unknown> = { name, display_order: displayOrder, color: color ?? '#888780', owner_id: getOwnerId() };
      if (libraryId) row.library_id = libraryId;
      const { error } = await supabase.from('categories').insert([row]);
      if (error) throw error;
    } catch (err) {
      // describeError, not `instanceof Error`: a postgrest error is a plain
      // object, so that check was always false and threw the real reason away.
      setError(describeError(err));
      throw err;
    }
  };

  const updateCategory = async (id: string, name: string, color?: string) => {
    try {
      await assertCatalogueRowEditable('categories', id);
      const patch: Record<string, string> = { name };
      if (color !== undefined) patch.color = color;
      const { error } = await supabase
        .from('categories')
        .update(patch)
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      setError(describeError(err));
      throw err;
    }
  };

  const deleteCategory = async (id: string) => {
    try {
      const { data: catRow, error: catErr } = await supabase
        .from('categories').select('name, library_id, owner_id').eq('id', id).single();
      if (catErr || !catRow) throw catErr ?? new Error('Category not found');
      const scope = await resolveLibraryScope(getOwnerId());
      if (!canEditCatalogueRow(scope, catRow)) {
        throw new Error('Access denied: this catalogue is read-only for you');
      }
      // Reassign exercises of this category IN THE SAME LIBRARY to
      // "Unspecified" (legacy rows without a library fall back to owner scope).
      const exQuery = supabase.from('exercises').select('id').eq('category', catRow.name);
      const { data: affected } = catRow.library_id
        ? await exQuery.eq('library_id', catRow.library_id)
        : await exQuery.eq('owner_id', catRow.owner_id);
      if (affected && affected.length > 0) {
        // Ensure "Unspecified" exists in that library
        const unspecQuery = supabase.from('categories').select('id').eq('name', 'Unspecified');
        const { data: existingUnspec } = catRow.library_id
          ? await unspecQuery.eq('library_id', catRow.library_id).maybeSingle()
          : await unspecQuery.eq('owner_id', catRow.owner_id).maybeSingle();
        if (!existingUnspec) {
          const orderQuery = supabase.from('categories').select('display_order');
          const { data: allCats } = catRow.library_id
            ? await orderQuery.eq('library_id', catRow.library_id)
            : await orderQuery.eq('owner_id', catRow.owner_id);
          const maxOrder = (allCats ?? []).reduce((m: number, c: { display_order: number }) => Math.max(m, c.display_order), -1);
          await supabase
            .from('categories')
            .insert([{
              name: 'Unspecified', display_order: maxOrder + 1, color: '#888780',
              owner_id: getOwnerId(),
              ...(catRow.library_id ? { library_id: catRow.library_id } : {}),
            }]);
        }
        await supabase
          .from('exercises')
          .update({ category: 'Unspecified' })
          .in('id', affected.map((e: { id: string }) => e.id));
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
      const scope = await resolveLibraryScope(getOwnerId());
      const results = await Promise.all(
        orderedIds.map((id, i) => {
          const q = supabase.from('categories').update({ display_order: i }).eq('id', id);
          return scope.available
            ? q.in('library_id', scope.editableLibraryIds)
            : q.eq('owner_id', scope.coachId);
        }),
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
    bulkArchiveExercises,
    restoreExercise,
    bulkReorderExercises,
    fetchCategories,
    fetchCategoriesWithError,
    createCategory,
    updateCategory,
    deleteCategory,
    swapCategoryOrder,
    bulkReorderCategories,
  };
}
