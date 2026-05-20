/**
 * sentinelUtils — pure helpers for sentinel exercise types.
 *
 * No Supabase, no React. Safe to import from athlete app or any
 * pure module. Extracted from plannerUtils.ts (UF-29 / E-17).
 */
import type { Exercise } from '../../lib/database.types';

// ---------------------------------------------------------------------------
// Exercise abbreviation used by PlannerControlPanel.
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

export type SentinelType = 'text' | 'video' | 'image' | 'gpp' | null;

export function getSentinelType(code: string | null): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  if (code === 'GPP') return 'gpp';
  return null;
}

export function getYouTubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

/** Heuristic: file extension suggests a directly-playable video file
 *  (Supabase upload) rather than a hosted video page (YouTube, Vimeo). */
export function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url);
}
