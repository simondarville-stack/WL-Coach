/**
 * sollIstPresets — built-in textbook reference models for the Soll–Ist
 * analysis. Values are transcription seeds from the BVDG/IAT
 * Trainingsmittelkatalog für den LLA im Gewichtheben (Kategorie 1 = % of
 * snatch, Kategorie 2 = % of clean & jerk); every number is editable in the
 * wizard before an analysis is created, so a transcription correction never
 * needs a code change — the coach just adjusts and saves a custom model.
 *
 * Preset rows carry catalogue-*matching* hints instead of exercise ids: at
 * load time each row is resolved against the coach's exercise catalogue
 * (lift_slot first, then name matching — English, Danish and German aliases).
 * Unresolved rows surface in the wizard for manual mapping.
 */
import type { Exercise } from './database.types';
import type { RefSlot, SollIstRow } from './sollIst';

export interface SollIstPresetRow {
  /** Canonical English display name (used when no catalogue match exists). */
  label: string;
  /** Preferred resolution: the catalogue exercise holding this lift_slot. */
  liftSlot?: NonNullable<Exercise['lift_slot']>;
  /** Fallback resolution: lowercase name candidates, tried exact → includes. */
  match: string[];
  refSlot: RefSlot;
  indexPct: number;
  reps: number;
}

export interface SollIstPreset {
  key: string;
  name: string;
  description: string;
  rows: SollIstPresetRow[];
}

const row = (
  label: string,
  refSlot: RefSlot,
  indexPct: number,
  reps: number,
  match: string[],
  liftSlot?: SollIstPresetRow['liftSlot'],
): SollIstPresetRow => ({ label, refSlot, indexPct, reps, match, liftSlot });

/* Name aliases per movement (English / Danish / German). */
const M = {
  powerSnatch: ['power snatch', 'styrketræk', 'kraftreißen'],
  powerClean: ['power clean', 'frivend'],
  snatchPull: ['snatch pull', 'trækhiv', 'zug breit'],
  cleanPull: ['clean pull', 'stødhiv', 'zug eng'],
  snatchDeadlift: ['snatch-grip deadlift', 'snatch grip deadlift', 'snatch deadlift', 'dødløft m. trækfatning', 'lastheben breit'],
  cleanDeadlift: ['clean-grip deadlift', 'clean grip deadlift', 'clean deadlift', 'dødløft m. stødfatning', 'lastheben eng'],
  snatchBalance: ['snatch balance', 'trækbalance', 'reißkniebeuge'],
  frontSquat: ['front squat', 'benbøj foran'],
  backSquat: ['back squat', 'benbøj bagpå'],
  pushPress: ['push press', 'push-pres', 'schwungdrücken'],
};

export const SOLLIST_PRESETS: SollIstPreset[] = [
  {
    key: 'bvdg_senior',
    name: 'BVDG — Senior',
    description: 'Trainingsmittelkatalog, Senioren (HT) column',
    rows: [
      row('Power snatch', 'snatch', 80, 1, M.powerSnatch),
      row('Power clean', 'clean_and_jerk', 80, 1, M.powerClean),
      row('Snatch pull', 'snatch', 108, 1, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'clean_and_jerk', 105, 1, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'snatch', 130, 1, M.snatchDeadlift),
      row('Clean-grip deadlift', 'clean_and_jerk', 125, 1, M.cleanDeadlift),
      row('Snatch balance', 'snatch', 110, 1, M.snatchBalance),
      row('Front squat', 'clean_and_jerk', 105, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'clean_and_jerk', 120, 3, M.backSquat, 'back_squat'),
      row('Push press', 'clean_and_jerk', 65, 1, M.pushPress),
    ],
  },
  {
    key: 'bvdg_u23',
    name: 'BVDG — U23',
    description: 'Trainingsmittelkatalog, U23 (HT) column',
    rows: [
      row('Power snatch', 'snatch', 80, 1, M.powerSnatch),
      row('Power clean', 'clean_and_jerk', 80, 1, M.powerClean),
      row('Snatch pull', 'snatch', 108, 1, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'clean_and_jerk', 105, 1, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'snatch', 125, 1, M.snatchDeadlift),
      row('Clean-grip deadlift', 'clean_and_jerk', 125, 1, M.cleanDeadlift),
      row('Snatch balance', 'snatch', 110, 1, M.snatchBalance),
      row('Front squat', 'clean_and_jerk', 105, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'clean_and_jerk', 120, 3, M.backSquat, 'back_squat'),
      row('Push press', 'clean_and_jerk', 65, 1, M.pushPress),
    ],
  },
  {
    key: 'bvdg_junior',
    name: 'BVDG — Junior',
    description: 'Trainingsmittelkatalog, Junioren (LT) column',
    rows: [
      row('Power snatch', 'snatch', 65, 2, M.powerSnatch),
      row('Power clean', 'clean_and_jerk', 75, 2, M.powerClean),
      row('Snatch pull', 'snatch', 103, 3, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'clean_and_jerk', 100, 3, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'snatch', 113, 3, M.snatchDeadlift),
      row('Clean-grip deadlift', 'clean_and_jerk', 118, 3, M.cleanDeadlift),
      row('Snatch balance', 'snatch', 105, 1, M.snatchBalance),
      row('Front squat', 'clean_and_jerk', 103, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'clean_and_jerk', 117, 3, M.backSquat, 'back_squat'),
      row('Push press', 'clean_and_jerk', 65, 1, M.pushPress),
    ],
  },
];

export const PRESET_ID_PREFIX = 'preset:';

export const presetId = (key: string): string => PRESET_ID_PREFIX + key;
export const isPresetId = (id: string): boolean => id.startsWith(PRESET_ID_PREFIX);
export const presetKeyFromId = (id: string): string | null =>
  isPresetId(id) ? id.slice(PRESET_ID_PREFIX.length) : null;

/** Resolve one preset row against the coach's catalogue.
 *  Order: lift_slot → exact name → name startsWith → name includes. */
export function resolvePresetRow(spec: SollIstPresetRow, exercises: Exercise[]): SollIstRow {
  let ex: Exercise | undefined;
  if (spec.liftSlot) ex = exercises.find((e) => e.lift_slot === spec.liftSlot);
  if (!ex) {
    const lower = exercises.map((e) => ({ e, n: e.name.toLowerCase() }));
    for (const candidate of spec.match) {
      ex = lower.find((x) => x.n === candidate)?.e;
      if (ex) break;
    }
    if (!ex) {
      for (const candidate of spec.match) {
        ex = lower.find((x) => x.n.startsWith(candidate))?.e ?? lower.find((x) => x.n.includes(candidate))?.e;
        if (ex) break;
      }
    }
  }
  return {
    exerciseId: ex?.id ?? null,
    label: ex?.name ?? spec.label,
    refSlot: spec.refSlot,
    indexPct: spec.indexPct,
    reps: spec.reps,
  };
}

export function resolvePreset(preset: SollIstPreset, exercises: Exercise[]): SollIstRow[] {
  return preset.rows.map((r) => resolvePresetRow(r, exercises));
}
