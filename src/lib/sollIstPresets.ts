/**
 * sollIstPresets — built-in textbook reference models for the Soll–Ist
 * analysis. Values are transcription seeds from the BVDG/IAT
 * Trainingsmittelkatalog für den LLA im Gewichtheben (Kategorie 1 = % of
 * snatch, Kategorie 2 = % of clean & jerk); every number is editable in the
 * wizard before an analysis is created, so a transcription correction never
 * needs a code change — the coach just adjusts and saves a custom model.
 *
 * Preset refs and rows carry catalogue-*matching* hints instead of exercise
 * ids: at load time each is resolved against the coach's exercise catalogue
 * (lift_slot first, then name matching — English, Danish and German aliases).
 * Unresolved rows surface in the wizard for manual mapping. References are
 * generic (any exercise, or none) — these presets just happen to use the
 * classic snatch / clean & jerk pair.
 */
import type { Exercise } from './database.types';
import type { SollIstRef, SollIstRow } from './sollIst';

interface MatchSpec {
  /** Preferred resolution: the catalogue exercise holding this lift_slot. */
  liftSlot?: NonNullable<Exercise['lift_slot']>;
  /** Fallback resolution: lowercase name candidates, tried exact → includes. */
  match: string[];
}

export interface SollIstPresetRef extends MatchSpec {
  key: string;
  label: string;
}

export interface SollIstPresetRow extends MatchSpec {
  /** Canonical English display name (used when no catalogue match exists). */
  label: string;
  refKey: string;
  indexPct: number;
  reps: number;
}

export interface SollIstPreset {
  key: string;
  name: string;
  description: string;
  refs: SollIstPresetRef[];
  rows: SollIstPresetRow[];
}

const row = (
  label: string,
  refKey: string,
  indexPct: number,
  reps: number,
  match: string[],
  liftSlot?: MatchSpec['liftSlot'],
): SollIstPresetRow => ({ label, refKey, indexPct, reps, match, liftSlot });

/* Name aliases per movement (English / Danish / German). */
const M = {
  snatch: ['snatch', 'træk'],
  cleanJerk: ['clean & jerk', 'clean and jerk', 'stød'],
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

/** The classic Kategorie 1 / 2 reference pair used by all BVDG presets. */
const BVDG_REFS: SollIstPresetRef[] = [
  { key: 'sn', label: 'Snatch', liftSlot: 'snatch', match: M.snatch },
  { key: 'cj', label: 'Clean & Jerk', liftSlot: 'clean_and_jerk', match: M.cleanJerk },
];

export const SOLLIST_PRESETS: SollIstPreset[] = [
  {
    key: 'bvdg_senior',
    name: 'BVDG — Senior',
    description: 'Trainingsmittelkatalog, Senioren (HT) column',
    refs: BVDG_REFS,
    rows: [
      row('Power snatch', 'sn', 80, 1, M.powerSnatch),
      row('Power clean', 'cj', 80, 1, M.powerClean),
      row('Snatch pull', 'sn', 108, 1, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'cj', 105, 1, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'sn', 130, 1, M.snatchDeadlift),
      row('Clean-grip deadlift', 'cj', 125, 1, M.cleanDeadlift),
      row('Snatch balance', 'sn', 110, 1, M.snatchBalance),
      row('Front squat', 'cj', 105, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'cj', 120, 3, M.backSquat, 'back_squat'),
      row('Push press', 'cj', 65, 1, M.pushPress),
    ],
  },
  {
    key: 'bvdg_u23',
    name: 'BVDG — U23',
    description: 'Trainingsmittelkatalog, U23 (HT) column',
    refs: BVDG_REFS,
    rows: [
      row('Power snatch', 'sn', 80, 1, M.powerSnatch),
      row('Power clean', 'cj', 80, 1, M.powerClean),
      row('Snatch pull', 'sn', 108, 1, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'cj', 105, 1, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'sn', 125, 1, M.snatchDeadlift),
      row('Clean-grip deadlift', 'cj', 125, 1, M.cleanDeadlift),
      row('Snatch balance', 'sn', 110, 1, M.snatchBalance),
      row('Front squat', 'cj', 105, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'cj', 120, 3, M.backSquat, 'back_squat'),
      row('Push press', 'cj', 65, 1, M.pushPress),
    ],
  },
  {
    key: 'bvdg_junior',
    name: 'BVDG — Junior',
    description: 'Trainingsmittelkatalog, Junioren (LT) column',
    refs: BVDG_REFS,
    rows: [
      row('Power snatch', 'sn', 65, 2, M.powerSnatch),
      row('Power clean', 'cj', 75, 2, M.powerClean),
      row('Snatch pull', 'sn', 103, 3, M.snatchPull, 'snatch_pull'),
      row('Clean pull', 'cj', 100, 3, M.cleanPull, 'clean_pull'),
      row('Snatch-grip deadlift', 'sn', 113, 3, M.snatchDeadlift),
      row('Clean-grip deadlift', 'cj', 118, 3, M.cleanDeadlift),
      row('Snatch balance', 'sn', 105, 1, M.snatchBalance),
      row('Front squat', 'cj', 103, 3, M.frontSquat, 'front_squat'),
      row('Back squat', 'cj', 117, 3, M.backSquat, 'back_squat'),
      row('Push press', 'cj', 65, 1, M.pushPress),
    ],
  },
];

export const PRESET_ID_PREFIX = 'preset:';

export const presetId = (key: string): string => PRESET_ID_PREFIX + key;
export const isPresetId = (id: string): boolean => id.startsWith(PRESET_ID_PREFIX);
export const presetKeyFromId = (id: string): string | null =>
  isPresetId(id) ? id.slice(PRESET_ID_PREFIX.length) : null;

/** Resolve a match spec against the coach's catalogue.
 *  Order: lift_slot → exact name → name startsWith → name includes. */
export function matchCatalogueExercise(spec: MatchSpec, exercises: Exercise[]): Exercise | null {
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
  return ex ?? null;
}

export function resolvePreset(
  preset: SollIstPreset,
  exercises: Exercise[],
): { refs: SollIstRef[]; rows: SollIstRow[] } {
  const refs = preset.refs.map((r) => {
    const ex = matchCatalogueExercise(r, exercises);
    return { key: r.key, label: ex?.name ?? r.label, exerciseId: ex?.id ?? null };
  });
  const rows = preset.rows.map((spec) => {
    const ex = matchCatalogueExercise(spec, exercises);
    return {
      exerciseId: ex?.id ?? null,
      label: ex?.name ?? spec.label,
      refKey: spec.refKey,
      indexPct: spec.indexPct,
      reps: spec.reps,
    };
  });
  return { refs, rows };
}
