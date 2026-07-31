/**
 * sollIstPresets — built-in textbook reference models for the Soll–Ist
 * analysis. Values are transcription seeds from the BVDG/IAT
 * Trainingsmittelkatalog für den LLA im Gewichtheben (Kategorie 1 = % of
 * snatch, Kategorie 2 = % of clean & jerk); every number is editable on the
 * sheet / in the wizard, so a transcription correction never needs a code
 * change — the coach adjusts and saves their own model.
 *
 * Preset refs and rows carry catalogue-*matching* hints instead of exercise
 * ids: at load time each is resolved against the coach's exercise catalogue
 * (lift_slot first, then exact name, then coach-taught aliases
 * (exercises.aliases), then loose name matching). The built-in `match`
 * lists cover the German catalogue names plus the Danish BVK companion
 * sheet (Nr. 1–26 map 1:1); anything else unresolved surfaces as ⚠ and is
 * repointed on the sheet — which teaches the alias for next time.
 * References are generic (any exercise, or none) — these presets just use
 * the classic snatch / clean & jerk pair.
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

/* The full Trainingsmittelkatalog movement list (Nr. 1–26). Aliases are the
 * German catalogue names + the Danish companion-sheet names (same Nr.).
 * Nr. 1 (Reißen) and Nr. 3 (Stoßen) are the references themselves. */
const MOVES = {
  snatchStraps:   { label: 'Snatch with straps',            ref: 'sn', match: ['snatch with straps', 'reißen mit bänder', 'træk med stropper'] },                       // 2
  clean:          { label: 'Clean',                          ref: 'cj', match: ['clean', 'umsetzen', 'stødvend'] },                                                      // 4
  jerkRack:       { label: 'Jerk from rack',                 ref: 'cj', match: ['jerk from rack', 'ausstoßen', 'opadstød fra stativ el. bukke', 'opadstød fra stativ'] }, // 5
  snatchBlocks:   { label: 'Snatch from blocks/hang',        ref: 'sn', match: ['snatch from blocks', 'snatch from hang', 'reißen erhöht', 'træk fra hæng (eller bukke)', 'træk fra hæng'] }, // 6
  snatchNoFeet:   { label: 'Snatch without foot movement',   ref: 'sn', match: ['standreißen', 'råtræk'] },                                                              // 7
  snatchTrans:    { label: 'Snatch transition',              ref: 'sn', match: ['umgruppieren breit', 'træk-overgang', 'trækovergang', 'træk overgang'] },               // 8
  cleanBlocks:    { label: 'Clean from blocks/hang',         ref: 'cj', match: ['clean from blocks', 'clean from hang', 'umsetzen erhöht', 'stødvend fra hæng'] },       // 9
  powerClean:     { label: 'Power clean',                    ref: 'cj', match: ['power clean', 'standumsetzen', 'frivend'] },                                            // 10
  cleanTrans:     { label: 'Clean transition',               ref: 'cj', match: ['umgruppieren eng', 'stødvend overgang'] },                                              // 11
  powerJerk:      { label: 'Power jerk',                     ref: 'cj', match: ['power jerk', 'standstoßen', 'knickstød'] },                                             // 12
  snatchPull:     { label: 'Snatch pull',                    ref: 'sn', match: ['snatch pull', 'zug breit', 'trækhiv'], liftSlot: 'snatch_pull' as const },              // 13
  cleanPull:      { label: 'Clean pull',                     ref: 'cj', match: ['clean pull', 'zug eng', 'stødhiv'], liftSlot: 'clean_pull' as const },                  // 14
  snatchDeadlift: { label: 'Snatch-grip deadlift',           ref: 'sn', match: ['snatch-grip deadlift', 'snatch grip deadlift', 'snatch deadlift', 'lastheben breit', 'dødløft m. trækfatning'] }, // 15
  cleanDeadlift:  { label: 'Clean-grip deadlift',            ref: 'cj', match: ['clean-grip deadlift', 'clean grip deadlift', 'clean deadlift', 'lastheben eng', 'dødløft m. stødfatning'] },      // 16
  jerkSquat:      { label: 'Jerk-drive squat',               ref: 'cj', match: ['anstoßkniebeuge', 'jerk drive squat', 'jerk dip squat'] },                              // 17
  snatchBalance:  { label: 'Snatch balance',                 ref: 'sn', match: ['snatch balance', 'reißkniebeuge', 'trækbalance'] },                                     // 18
  frontSquat:     { label: 'Front squat',                    ref: 'cj', match: ['front squat', 'kniebeuge vorn', 'benbøj foran'], liftSlot: 'front_squat' as const },    // 19
  backSquat:      { label: 'Back squat',                     ref: 'cj', match: ['back squat', 'kniebeuge hinten', 'benbøj bagpå'], liftSlot: 'back_squat' as const },    // 20
  halfSquat:      { label: 'Half squat',                     ref: 'cj', match: ['half squat', 'halbkniebeuge'] },                                                        // 21
  powerSnPull:    { label: 'Power snatch pull (from hang)',  ref: 'sn', match: ['powerzug breit', 'kraft trækhiv fra hæng (eksplosivitet)', 'kraft trækhiv fra hæng', 'kraft trækhiv'] },          // 22
  powerSnatch:    { label: 'Power snatch',                   ref: 'sn', match: ['power snatch', 'kraftreißen', 'styrketræk'] },                                          // 23
  powerCjPull:    { label: 'Power clean pull (from hang)',   ref: 'cj', match: ['powerzug eng', 'kraft stødhiv fra hæng (eksplosivitet)', 'kraft stødhiv fra hæng', 'kraft stødhiv'] },            // 24
  press:          { label: 'Strict press',                   ref: 'cj', match: ['strict press', 'military press', 'kraftdrücken', 'stem'] },                             // 25
  pushPress:      { label: 'Push press',                     ref: 'cj', match: ['push press', 'schwungdrücken', 'push-pres', 'push pres'] },                             // 26
} satisfies Record<string, { label: string; ref: 'sn' | 'cj'; match: string[]; liftSlot?: NonNullable<Exercise['lift_slot']> }>;

type MoveKey = keyof typeof MOVES;

/** Build a preset row from a movement + column value. */
const row = (move: MoveKey, indexPct: number, reps = 1): SollIstPresetRow => ({
  label: MOVES[move].label,
  refKey: MOVES[move].ref,
  indexPct,
  reps,
  match: MOVES[move].match,
  liftSlot: 'liftSlot' in MOVES[move] ? (MOVES[move] as { liftSlot?: SollIstPresetRow['liftSlot'] }).liftSlot : undefined,
});

/** The classic Kategorie 1 / 2 reference pair used by all BVDG presets. */
const BVDG_REFS: SollIstPresetRef[] = [
  { key: 'sn', label: 'Snatch', liftSlot: 'snatch', match: ['snatch', 'reißen', 'træk'] },
  { key: 'cj', label: 'Clean & Jerk', liftSlot: 'clean_and_jerk', match: ['clean & jerk', 'clean and jerk', 'stoßen', 'stød', 'stødvend & opadstød'] },
];

export const SOLLIST_PRESETS: SollIstPreset[] = [
  {
    key: 'bvdg_senior',
    name: 'BVDG — Senior',
    description: 'Trainingsmittelkatalog, Senioren (HT) column — transcription seeds, edit freely',
    refs: BVDG_REFS,
    rows: [
      row('snatchStraps', 102),
      row('clean', 102),
      row('jerkRack', 104),
      row('snatchBlocks', 102),
      row('snatchNoFeet', 90),
      row('snatchTrans', 80),
      row('cleanBlocks', 102),
      row('powerClean', 85),
      row('cleanTrans', 80),
      row('powerJerk', 104),
      row('snatchPull', 108),
      row('cleanPull', 105),
      row('snatchDeadlift', 130),
      row('cleanDeadlift', 125),
      row('jerkSquat', 140),
      row('snatchBalance', 110),
      row('frontSquat', 105, 3),
      row('backSquat', 120, 3),
      row('powerSnPull', 90),
      row('powerSnatch', 80),
      row('powerCjPull', 80),
      row('press', 60),
      row('pushPress', 65),
    ],
  },
  {
    key: 'bvdg_u23',
    name: 'BVDG — U23',
    description: 'Trainingsmittelkatalog, U23 (HT) column — transcription seeds, edit freely',
    refs: BVDG_REFS,
    rows: [
      row('snatchStraps', 102),
      row('clean', 102),
      row('jerkRack', 104),
      row('snatchBlocks', 102),
      row('snatchNoFeet', 90),
      row('snatchTrans', 80),
      row('cleanBlocks', 102),
      row('powerClean', 85),
      row('cleanTrans', 80),
      row('powerJerk', 104),
      row('snatchPull', 108),
      row('cleanPull', 105),
      row('snatchDeadlift', 125),
      row('cleanDeadlift', 125),
      row('jerkSquat', 130),
      row('snatchBalance', 110),
      row('frontSquat', 105, 3),
      row('backSquat', 120, 3),
      row('powerSnPull', 90),
      row('powerSnatch', 80),
      row('powerCjPull', 80),
      row('press', 60),
      row('pushPress', 65),
    ],
  },
  {
    key: 'bvdg_junior',
    name: 'BVDG — Junior',
    description: 'Trainingsmittelkatalog, Junioren (LT) column — transcription seeds, edit freely',
    refs: BVDG_REFS,
    rows: [
      row('snatchStraps', 102),
      row('clean', 97, 2),
      row('jerkRack', 102),
      row('snatchBlocks', 97, 2),
      row('snatchNoFeet', 90),
      row('snatchTrans', 75),
      row('cleanBlocks', 97, 2),
      row('powerClean', 85),
      row('cleanTrans', 75),
      row('powerJerk', 102),
      row('snatchPull', 103, 3),
      row('cleanPull', 100, 3),
      row('snatchDeadlift', 113, 3),
      row('cleanDeadlift', 118, 3),
      row('jerkSquat', 120),
      row('snatchBalance', 105),
      row('frontSquat', 103, 3),
      row('backSquat', 117, 3),
      row('powerSnPull', 85),
      row('powerSnatch', 65, 2),
      row('powerCjPull', 75),
      row('press', 50, 3),
      row('pushPress', 65),
    ],
  },
];

export const PRESET_ID_PREFIX = 'preset:';

export const presetId = (key: string): string => PRESET_ID_PREFIX + key;
export const isPresetId = (id: string): boolean => id.startsWith(PRESET_ID_PREFIX);
export const presetKeyFromId = (id: string): string | null =>
  isPresetId(id) ? id.slice(PRESET_ID_PREFIX.length) : null;

/** Resolve a match spec against the coach's catalogue.
 *  Order: lift_slot → exact name → coach-taught alias (exercises.aliases)
 *  → name startsWith → name includes. */
export function matchCatalogueExercise(spec: MatchSpec, exercises: Exercise[]): Exercise | null {
  let ex: Exercise | undefined;
  if (spec.liftSlot) ex = exercises.find((e) => e.lift_slot === spec.liftSlot);
  if (!ex) {
    const lower = exercises.map((e) => ({ e, n: e.name.toLowerCase(), aliases: (e.aliases ?? []).map((a) => a.toLowerCase()) }));
    for (const candidate of spec.match) {
      ex = lower.find((x) => x.n === candidate)?.e;
      if (ex) break;
    }
    if (!ex) {
      for (const candidate of spec.match) {
        ex = lower.find((x) => x.aliases.includes(candidate))?.e;
        if (ex) break;
      }
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
  // First claim wins: loose matching must never map two rows onto the same
  // catalogue exercise (their Ist would collide) — the later row stays
  // unmapped for the coach to repoint.
  const claimed = new Set<string>();
  const rows = preset.rows.map((spec) => {
    let ex = matchCatalogueExercise(spec, exercises);
    if (ex && claimed.has(ex.id)) ex = null;
    if (ex) claimed.add(ex.id);
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
