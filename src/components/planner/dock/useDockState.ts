import { useState, useEffect } from 'react';

export type DockTab = 'exercises' | 'templates';
export type ExerciseSortKey = 'name' | 'category' | 'code';

const TAB_KEY = 'emos_dock_tab';
const COLLAPSED_KEY = 'emos_dock_collapsed';
const SORT_KEY = 'emos_dock_exercise_sort';

function readTab(): DockTab {
  const v = typeof window !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
  return v === 'templates' ? 'templates' : 'exercises';
}

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(COLLAPSED_KEY) === 'true';
}

function readSort(): ExerciseSortKey {
  const v = typeof window !== 'undefined' ? localStorage.getItem(SORT_KEY) : null;
  return v === 'category' || v === 'code' ? v : 'name';
}

export function useDockState() {
  const [tab, setTab] = useState<DockTab>(readTab);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [query, setQuery] = useState('');
  const [exerciseSort, setExerciseSort] = useState<ExerciseSortKey>(readSort);
  // Transient — coaches typically want all categories visible on each session.
  const [exerciseCategoryFilter, setExerciseCategoryFilter] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem(TAB_KEY, tab); }, [tab]);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); }, [collapsed]);
  useEffect(() => { localStorage.setItem(SORT_KEY, exerciseSort); }, [exerciseSort]);

  return {
    tab, setTab,
    collapsed, setCollapsed,
    query, setQuery,
    exerciseSort, setExerciseSort,
    exerciseCategoryFilter, setExerciseCategoryFilter,
  };
}

