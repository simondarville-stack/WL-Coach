import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'emos_planner_clipboard_v1';
// One-time migration from the previous name ("canvas"). Read the old key
// the first time we mount; we'll persist back to the new key, so the old
// one becomes orphaned harmlessly.
const LEGACY_STORAGE_KEY = 'emos_planner_canvas_v1';

/** Per-set row payload captured at snapshot time. Mirrors planned_set_lines
 *  minus the IDs/timestamps — those get re-issued on re-insert. */
export interface ClipboardSetLine {
  sets: number;
  reps: number;
  reps_text: string | null;
  load_value: number;
  load_max: number | null;
  position: number;
}

export interface ClipboardComboMember {
  exercise_id: string;
  position: number;
}

/** A frozen planned_exercise row. The `display` fields are only for rendering
 *  the clipboard card — re-insert uses `snapshot` exclusively. */
export interface ClipboardExerciseSnapshot {
  exercise_id: string;
  unit: string;
  prescription_raw: string | null;
  notes: string | null;
  variation_note: string | null;
  summary_total_sets: number;
  summary_total_reps: number;
  summary_highest_load: number | null;
  summary_avg_load: number | null;
  is_combo: boolean;
  combo_notation: string | null;
  combo_color: string | null;
  metadata: Record<string, unknown> | null;
  set_lines: ClipboardSetLine[];
  combo_members: ClipboardComboMember[];
}

export interface ClipboardExerciseDisplay {
  label: string;
  color: string;
  sentinel: 'text' | 'video' | 'image' | 'gpp' | 'combo' | 'exercise';
  /** Optional secondary line (e.g. category, "Combo", row count). */
  caption: string | null;
}

export interface ClipboardExerciseItem {
  kind: 'exercise';
  id: string;
  added_at: number;
  display: ClipboardExerciseDisplay;
  snapshot: ClipboardExerciseSnapshot;
}

export interface ClipboardDayItem {
  kind: 'day';
  id: string;
  added_at: number;
  label: string;
  exercises: {
    display: ClipboardExerciseDisplay;
    snapshot: ClipboardExerciseSnapshot;
  }[];
}

/** A single training day inside a parked week — its label and (snapshot)
 *  exercises, plus the original day index so it can be re-applied to the
 *  matching day on paste. */
export interface ClipboardDay {
  dayIndex: number;
  label: string;
  exercises: {
    display: ClipboardExerciseDisplay;
    snapshot: ClipboardExerciseSnapshot;
  }[];
}

/** A whole week parked on the clipboard — one parent holding all its training
 *  days. The week (or any single day) can be dragged back out. */
export interface ClipboardWeekItem {
  kind: 'week';
  id: string;
  added_at: number;
  label: string;
  weekStart: string;
  days: ClipboardDay[];
}

export type ClipboardItem = ClipboardExerciseItem | ClipboardDayItem | ClipboardWeekItem;

function genId(): string {
  // Crypto.randomUUID() is available in all evergreen browsers. Falls back
  // to a Math.random ID for older runtimes — collision odds are fine for a
  // localStorage-backed scratch list.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readInitial(): ClipboardItem[] {
  if (typeof window === 'undefined') return [];
  try {
    // Prefer the new key; fall back to the old "canvas" key once so a
    // coach who'd parked items before the rename doesn't lose them.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that doesn't smell like a ClipboardItem — old payloads
    // from a different schema version would otherwise crash the renderer.
    return parsed.filter(
      (it: unknown): it is ClipboardItem =>
        !!it &&
        typeof it === 'object' &&
        'kind' in it &&
        ['exercise', 'day', 'week'].includes((it as { kind: unknown }).kind as string),
    );
  } catch {
    return [];
  }
}

export function useClipboardState() {
  const [items, setItems] = useState<ClipboardItem[]>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Quota exceeded or storage disabled — fail silently; clipboard
      // keeps working in-memory for the rest of the session.
    }
  }, [items]);

  const addExercise = useCallback(
    (display: ClipboardExerciseDisplay, snapshot: ClipboardExerciseSnapshot) => {
      setItems(prev => [
        { kind: 'exercise', id: genId(), added_at: Date.now(), display, snapshot },
        ...prev,
      ]);
    },
    [],
  );

  const addDay = useCallback(
    (
      label: string,
      exercises: { display: ClipboardExerciseDisplay; snapshot: ClipboardExerciseSnapshot }[],
    ) => {
      if (exercises.length === 0) return;
      setItems(prev => [
        { kind: 'day', id: genId(), added_at: Date.now(), label, exercises },
        ...prev,
      ]);
    },
    [],
  );

  const addWeek = useCallback(
    (label: string, weekStart: string, days: ClipboardDay[]) => {
      if (days.every(d => d.exercises.length === 0)) return;
      setItems(prev => [
        { kind: 'week', id: genId(), added_at: Date.now(), label, weekStart, days },
        ...prev,
      ]);
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const findById = useCallback(
    (id: string): ClipboardItem | null => items.find(it => it.id === id) ?? null,
    [items],
  );

  return { items, addExercise, addDay, addWeek, remove, clear, findById };
}
