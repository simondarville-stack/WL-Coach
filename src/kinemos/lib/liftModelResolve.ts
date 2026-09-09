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
  const words = n.trim().split(' ').filter(Boolean);
  // Whole phrases; whole words; and words that BEGIN with a stem, since
  // Danish compounds them — "trækdødløft" is a snatch deadlift, "stødhiv"
  // a clean pull — while "ausstoßen" must not read as "stoßen".
  const phrase = (...p: string[]) => p.some(w => n.includes(` ${w} `));
  const exact = (...p: string[]) => words.some(w => p.includes(w));
  const stem = (...p: string[]) => words.some(w => p.some(s => w.startsWith(s)));

  // The archive's "power pull" family before anything else: "power pull"
  // is its power snatch, "power pull stød" its power clean, and "strict"
  // makes either the muscle variant.
  if (phrase('power pull')) {
    const family = exact('stød') ? 'clean' : 'snatch';
    return exact('strict') ? `muscle-${family}` : family;
  }

  const snatch = exact('snatch') || stem('reiß', 'reiss', 'træk', 'traek', 'råtræk') || words.some(w => w.endsWith('træk'));
  const clean = exact('clean') || stem('umsetz', 'vend', 'stødvend', 'frivend', 'stødhiv', 'styrkevend');
  const jerk = exact('jerk') || stem('ausstoß', 'ausstoss', 'opadstød', 'knickstød') || phrase('push press', 'push pres') || exact('pushpress', 'pushpres');
  const deadlift = exact('deadlift', 'dl') || stem('styrketræk', 'kreuzheb', 'dødløft', 'dodloft') || words.some(w => w.endsWith('dødløft'));
  const pull = exact('pull', 'zug') || words.some(w => w.endsWith('hiv'));
  const muscle = exact('muscle', 'strict', 'rå') || stem('råtræk');
  const balance = words.some(w => w.includes('balance'));
  const press = exact('press', 'pres', 'stem', 'drücken');

  // The compound: "clean & jerk", "clean and jerk", "Stoßen", "stød" on its
  // own (Danish: stød = clean & jerk; stødvend = clean; opadstød = jerk;
  // stødhiv = clean pull; stød dødløft = clean deadlift).
  if ((clean && jerk) || exact('stoßen', 'stossen') || (exact('stød') && !deadlift && !pull)) {
    return 'clean-and-jerk';
  }

  if (jerk) {
    if (phrase('push press', 'push pres') || exact('pushpress', 'pushpres')) return 'push-press';
    return 'jerk';
  }

  const family = exact('stød') ? 'clean' : clean && !snatch ? 'clean' : snatch ? 'snatch' : clean ? 'clean' : null;
  if (!family) return press ? 'press' : null;

  if (balance) return 'snatch-balance';
  if (deadlift) return `${family}-deadlift`;
  if (pull) return `${family}-pull`;
  const position = positionFromName(n);
  if (position) return `${family}-hang-${position}-knee`;
  if (muscle) return `muscle-${family}`;
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
