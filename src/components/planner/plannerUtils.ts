/**
 * Shared pure utility functions for the planner components.
 * DB interactions (getOrCreateSentinel) use getOwnerId() for owner scoping.
 */
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import type { Exercise } from '../../lib/database.types';

// ---------------------------------------------------------------------------
// Exercise abbreviation — consolidates PlannerControlPanel and PrintWeekCompact
// DOM-012/013: check exercise_code first, then category map, then initials.
// ---------------------------------------------------------------------------

const CATEGORY_ABBREVIATIONS: Record<string, string> = {
  'Snatch': 'Sn',
  'Clean': 'Cl',
  'Jerk': 'Jk',
  'Clean & Jerk': 'C&J',
  'Squat': 'Sq',
  'Back Squat': 'BSq',
  'Front Squat': 'FSq',
  'Overhead Squat': 'OSq',
  'Pull': 'Pull',
  'Snatch Pull': 'SnP',
  'Clean Pull': 'ClP',
  'Press': 'Pr',
  'Push Press': 'PP',
  'Jerk from rack': 'JkR',
  'Accessories': 'Acc',
  'General': 'Gen',
  'Strength': 'Str',
  'Conditioning': 'Cond',
  'Technique': 'Tech',
};

/**
 * Return a short abbreviation for an exercise suitable for compact UI.
 * Priority: exercise_code → category abbreviation map → name initials.
 */
export function abbreviateExercise(exercise: Pick<Exercise, 'name' | 'exercise_code' | 'category'>): string {
  if (exercise.exercise_code) return exercise.exercise_code;
  const catAbbr = CATEGORY_ABBREVIATIONS[exercise.category];
  if (catAbbr) return catAbbr;
  const words = exercise.name.trim().split(/\s+/);
  if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return exercise.name.slice(0, 3).toUpperCase();
}

export type SentinelType = 'text' | 'video' | 'image' | null;

export function getSentinelType(code: string | null): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}

export function getYouTubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

/**
 * Look up or create a sentinel exercise (TEXT / VIDEO / IMAGE) for the current owner.
 * Always includes owner_id on insert so the exercise is owned by the current coach.
 */
export async function getOrCreateSentinel(
  code: string,
): Promise<{ id: string; default_unit: string } | null> {
  const ownerId = getOwnerId();
  const { data: existing } = await supabase
    .from('exercises')
    .select('id, default_unit')
    .eq('exercise_code', code)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (existing) return existing;

  const sentinelDefs: Record<string, { name: string; color: string }> = {
    TEXT:  { name: 'Free Text / Notes', color: '#9CA3AF' },
    VIDEO: { name: 'Video',             color: '#6366F1' },
    IMAGE: { name: 'Image',             color: '#EC4899' },
  };
  const def = sentinelDefs[code];
  if (!def) return null;

  const { data: created } = await supabase
    .from('exercises')
    .insert({
      name: def.name,
      category: '— System',
      default_unit: 'other',
      color: def.color,
      exercise_code: code,
      use_stacked_notation: false,
      counts_towards_totals: false,
      is_competition_lift: false,
      owner_id: ownerId,
    })
    .select('id, default_unit')
    .single();
  return created ?? null;
}
