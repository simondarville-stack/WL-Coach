/**
 * exerciseAliases — alias memory for catalogue exercises.
 *
 * An alias is an alternative name an exercise is known by (the BVDG
 * Trainingsmittelkatalog's German name, a Danish gym name, a CSV template's
 * spelling …). Aliases are written when a coach repoints an unmapped
 * Soll–Ist row to a catalogue exercise, and read wherever source labels are
 * resolved against the catalogue (preset resolution, CSV import), so the
 * same label maps automatically next time.
 */
import { supabase } from './supabase';
import type { Exercise } from './database.types';

const norm = (s: string) => s.trim().toLowerCase();

/** True when the label already resolves to this exercise (name or alias). */
export function isKnownAs(exercise: Exercise, label: string): boolean {
  const n = norm(label);
  if (!n) return true; // nothing worth remembering
  if (norm(exercise.name) === n) return true;
  return (exercise.aliases ?? []).some((a) => norm(a) === n);
}

/**
 * Remember `label` as an alias of the exercise. No-op when the label is
 * empty or already known. Returns the updated aliases array (unchanged on
 * no-op) — callers patch their local store copy with it.
 */
export async function addExerciseAlias(exercise: Exercise, label: string): Promise<string[]> {
  const alias = label.trim();
  if (!alias || isKnownAs(exercise, alias)) return exercise.aliases ?? [];
  const aliases = [...(exercise.aliases ?? []), alias];
  const { error } = await supabase
    .from('exercises')
    .update({ aliases } as never)
    .eq('id', exercise.id);
  if (error) throw error;
  return aliases;
}
