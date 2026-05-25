import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'emos_planner_canvas_v1';

/** Per-set row payload captured at snapshot time. Mirrors planned_set_lines
 *  minus the IDs/timestamps — those get re-issued on re-insert. */
export interface CanvasSetLine {
  sets: number;
  reps: number;
  reps_text: string | null;
  load_value: number;
  load_max: number | null;
  position: number;
}

export interface CanvasComboMember {
  exercise_id: string;
  position: number;
}

/** A frozen planned_exercise row. The `display` fields are only for rendering
 *  the canvas card — re-insert uses `snapshot` exclusively. */
export interface CanvasExerciseSnapshot {
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
  set_lines: CanvasSetLine[];
  combo_members: CanvasComboMember[];
}

export interface CanvasExerciseDisplay {
  label: string;
  color: string;
  sentinel: 'text' | 'video' | 'image' | 'gpp' | 'combo' | 'exercise';
  /** Optional secondary line (e.g. category, "Combo", row count). */
  caption: string | null;
}

export interface CanvasExerciseItem {
  kind: 'exercise';
  id: string;
  added_at: number;
  display: CanvasExerciseDisplay;
  snapshot: CanvasExerciseSnapshot;
}

export interface CanvasDayItem {
  kind: 'day';
  id: string;
  added_at: number;
  label: string;
  exercises: {
    display: CanvasExerciseDisplay;
    snapshot: CanvasExerciseSnapshot;
  }[];
}

export type CanvasItem = CanvasExerciseItem | CanvasDayItem;

function genId(): string {
  // Crypto.randomUUID() is available in all evergreen browsers. Falls back
  // to a Math.random ID for older runtimes — collision odds are fine for a
  // localStorage-backed scratch list.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readInitial(): CanvasItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that doesn't smell like a CanvasItem — old payloads
    // from a different schema version would otherwise crash the renderer.
    return parsed.filter(
      (it: unknown): it is CanvasItem =>
        !!it &&
        typeof it === 'object' &&
        'kind' in it &&
        ((it as { kind: unknown }).kind === 'exercise' || (it as { kind: unknown }).kind === 'day'),
    );
  } catch {
    return [];
  }
}

export function useCanvasState() {
  const [items, setItems] = useState<CanvasItem[]>(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Quota exceeded or storage disabled — fail silently; canvas keeps
      // working in-memory for the rest of the session.
    }
  }, [items]);

  const addExercise = useCallback(
    (display: CanvasExerciseDisplay, snapshot: CanvasExerciseSnapshot) => {
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
      exercises: { display: CanvasExerciseDisplay; snapshot: CanvasExerciseSnapshot }[],
    ) => {
      if (exercises.length === 0) return;
      setItems(prev => [
        { kind: 'day', id: genId(), added_at: Date.now(), label, exercises },
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
    (id: string): CanvasItem | null => items.find(it => it.id === id) ?? null,
    [items],
  );

  return { items, addExercise, addDay, remove, clear, findById };
}
