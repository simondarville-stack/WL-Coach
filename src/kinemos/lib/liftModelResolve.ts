/**
 * liftModelResolve — which lift model a clip's exercise means.
 *
 * Declared, not guessed; guessed only as a proposal (P9 plan §4). The ladder,
 * in the order EMOS already resolves an exercise elsewhere (the Soll-Ist
 * presets: slot → name → alias → substring):
 *
 *   1. the exercise's own `kinemos_lift_model`;
 *   2. an ancestor's, refined by this exercise's name where it says "hang",
 *      "blocks" or "knee" — "Snatch from blocks" under "Snatch" is a snatch
 *      from below the knee;
 *   3. the `lift_slot` — the six the planner knows;
 *   4. the name, in English, German and the Danish the 2009 archive uses;
 *   5. nothing — the caller decides what to assume, and says so.
 *
 * How the answer was reached travels with it, so a chip can read "Jerk ·
 * from the name" rather than presenting a guess as a declaration.
 *
 * Pure: exercise rows in, an id out. No Supabase here.
 */
import { isKnownLiftModel } from '../engine/liftModels';

export interface ExerciseForModel {
  id: string;
  name: string;
  parent_exercise_id: string | null;
  lift_slot: string | null;
  kinemos_lift_model: string | null;
}

export type LiftModelHow = 'declared' | 'inherited' | 'slot' | 'name';

export interface ResolvedLiftModel {
  id: string;
  how: LiftModelHow;
}

const SLOT_MODEL: Record<string, string> = {
  snatch: 'snatch',
  clean_and_jerk: 'clean-and-jerk',
  snatch_pull: 'snatch-pull',
  clean_pull: 'clean-pull',
  front_squat: 'unspecified',
  back_squat: 'unspecified',
};

/**
 * Resolve one exercise. `byId` must contain the exercise's ancestors for the
 * inheritance rung to work; a missing ancestor simply ends the walk.
 */
export function resolveLiftModel(
  exercise: ExerciseForModel,
  byId: ReadonlyMap<string, ExerciseForModel>,
): ResolvedLiftModel | null {
  if (exercise.kinemos_lift_model && isKnownLiftModel(exercise.kinemos_lift_model)) {
    return { id: exercise.kinemos_lift_model, how: 'declared' };
  }
  // Up the tree, guarding a cycle a repaired hierarchy might still hold.
  const seen = new Set<string>([exercise.id]);
  let parentId = exercise.parent_exercise_id;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.kinemos_lift_model && isKnownLiftModel(parent.kinemos_lift_model)) {
      return { id: refineByName(parent.kinemos_lift_model, exercise.name), how: 'inherited' };
    }
    parentId = parent.parent_exercise_id;
  }
  if (exercise.lift_slot && SLOT_MODEL[exercise.lift_slot]) {
    return { id: refineByName(SLOT_MODEL[exercise.lift_slot], exercise.name), how: 'slot' };
  }
  const fromName = modelFromName(exercise.name);
  return fromName ? { id: fromName, how: 'name' } : null;
}

/**
 * A model from an exercise name alone. English, German (the BVDG's terms)
 * and Danish (the archive's). Null when the name says nothing a bar could
 * act on — a squat, a row, a press with no dip.
 */
export function modelFromName(name: string): string | null {
  const n = ` ${name.toLowerCase().replace(/[&+/,.()-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // Whole words and whole phrases only: "ausstoßen" is not "stoßen".
  const has = (...words: string[]) => words.some(w => n.includes(` ${w} `));

  // The archive's "power pull" family before anything else: "power pull"
  // is its power snatch, "power pull stød" its power clean, and "strict"
  // makes either the muscle variant.
  if (has('power pull')) {
    const family = has('stød') ? 'clean' : 'snatch';
    return has('strict') ? `muscle-${family}` : `power-${family}`;
  }

  // The compound: "clean & jerk", "clean and jerk", "Stoßen", "stød" on its
  // own (Danish: stød = clean & jerk; stødvend = clean; opadstød = jerk;
  // stødhiv = clean pull).
  if ((has('clean') && has('jerk')) || has('stoßen', 'stossen', 'stød')) {
    return 'clean-and-jerk';
  }

  // Family.
  const snatch = has('snatch', 'reißen', 'reissen', 'træk', 'trækhiv', 'råtræk', 'balancetræk', 'styrketræk');
  const clean = has('clean', 'umsetzen', 'vend', 'stødvend', 'frivend', 'stødhiv', 'reißumsetzen');
  const jerk = has('jerk', 'ausstoßen', 'ausstossen', 'opadstød', 'knickstød', 'push press', 'push pres', 'stem');
  const press = has('press', 'pres', 'drücken', 'stem');

  if (jerk) {
    if (has('push press', 'push pres', 'stem')) return 'push-press';
    if (has('power', 'push jerk', 'knickstød', 'knick')) return 'power-jerk';
    return 'jerk';
  }

  const muscle = has('muscle', 'strict', 'rå', 'råtræk');
  const power = has('power', 'fri', 'frivend');
  const pull = has('pull', 'hiv', 'zug', 'trækhiv', 'stødhiv');
  const deadlift = has('deadlift', 'styrketræk', 'kreuzheben', 'dl');
  const balance = has('balance', 'balancetræk');

  if (balance && snatch) return 'snatch-balance';

  const family = clean && !snatch ? 'clean' : snatch ? 'snatch' : clean ? 'clean' : null;
  if (!family) return press ? 'press' : null;

  if (deadlift) return `${family}-deadlift`;
  if (pull) return `${family}-pull`;
  const position = positionFromName(n);
  if (position) return `${family}-hang-${position}-knee`;
  if (muscle) return `muscle-${family}`;
  if (power) return `power-${family}`;
  return family;
}

/** "below" or "above" when the name says where the lift starts from. */
function positionFromName(n: string): 'below' | 'above' | null {
  const has = (...words: string[]) => words.some(w => n.includes(w));
  const fromPosition = has('hang', 'hæng', 'block', 'blok', 'knee', 'knæ', 'overgang', 'knie', 'oberhalb', 'unterhalb');
  if (!fromPosition) return null;
  if (has('above', 'high', 'høj', 'over', 'oberhalb', 'hip', 'thigh', 'lår')) return 'above';
  if (has('below', 'low', 'lav', 'deep', 'dyb', 'unterhalb', 'shin', 'floor')) return 'below';
  // A plain "hang" is above the knee; plain "blocks" sit below it.
  return has('block', 'blok') ? 'below' : 'above';
}

/**
 * A child named "… from blocks" under a parent declared as a snatch is a
 * snatch from below the knee: the parent gives the family, the name the
 * position or the variant.
 */
function refineByName(parentModel: string, childName: string): string {
  const family = parentModel.startsWith('snatch') ? 'snatch' : parentModel.startsWith('clean') && parentModel !== 'clean-and-jerk' ? 'clean' : null;
  if (!family) return parentModel;
  const n = ` ${childName.toLowerCase()} `;
  const position = positionFromName(n);
  if (position) return `${family}-hang-${position}-knee`;
  if (/\b(pull|hiv|zug)\b/.test(n) && !/power pull/.test(n)) return `${family}-pull`;
  if (/\b(deadlift|styrketræk|kreuzheben)\b/.test(n)) return `${family}-deadlift`;
  if (/\b(muscle|strict|rå)\b/.test(n)) return `muscle-${family}`;
  if (/\b(power|fri)\b/.test(n)) return `power-${family}`;
  return parentModel;
}

/** How a resolution was reached, for a chip. */
export function describeHow(how: LiftModelHow | null): string {
  switch (how) {
    case 'declared':
      return 'set on the exercise';
    case 'inherited':
      return 'from the parent exercise';
    case 'slot':
      return 'from the lift slot';
    case 'name':
      return 'from the name';
    default:
      return 'assumed';
  }
}
