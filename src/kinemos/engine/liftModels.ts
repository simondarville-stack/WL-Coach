/**
 * liftModels — what kind of lift a rep is, as data.
 *
 * KinEMOS analysed every clip as a snatch from the floor until P9, and the
 * exercise on the clip was a label nothing read. A lift model is the three
 * layers that change at different speeds (P9 plan §3): the MOTION SHAPE the
 * engine has to know about (a closed set of four, `phases.ts`), the PHASE
 * SET a coach divides it into (data, one default per family, editable by the
 * coach-config pass), and — through `requires` on the metric catalogue —
 * which measures the lift can have at all.
 *
 * The registry below is the built-in default. It is deliberately a flat list
 * keyed by id, with the id as what an analysis stores: a reader always knows
 * which model segmented a rep, the same reason `phase_set_id` exists. Adding
 * a coach-defined model is a row here, not a code path, and CLAUDE.md's first
 * principle is why: a hardcoded `enum Lift { SNATCH, CLEAN }` with rules
 * welded to each is the red flag it names.
 *
 * Engine purity: types and data only.
 */
import {
  DEADLIFT_PHASES,
  DIP_DRIVE_PHASES,
  DEFAULT_PHASE_END_RULE,
  PULL_CATCH_ABOVE_KNEE_PHASES,
  PULL_CATCH_BELOW_KNEE_PHASES,
  PULL_CATCH_FLOOR_PHASES,
  PULL_END_RULE,
  PULL_PHASES,
  type BoundaryRuleId,
  type MotionShape,
  type PhaseDefinition,
  type PhaseThresholds,
} from './phases';

export type { MotionShape } from './phases';

export type LiftFamily = 'snatch' | 'clean' | 'jerk' | 'none';

export interface LiftModel {
  id: string;
  family: LiftFamily;
  label: string;
  /** For a chip or a rep pill. */
  shortLabel: string;
  shape: MotionShape;
  /** Null for a shape with no phases (`free`, `compound`). */
  phaseSet: readonly PhaseDefinition[] | null;
  /** What an analysis records as its `phase_set_id`. Distinct from the model
   *  id: several models share one set (a snatch and a power snatch), and a
   *  reader comparing two analyses cares which SET named their phases. */
  phaseSetId: string;
  endRule: BoundaryRuleId | null;
  /** Per-model overrides of the detector's thresholds. */
  thresholds?: Partial<PhaseThresholds>;
  /** A compound model's parts, in order — the models its reps are stored
   *  under once the clip has been cut. */
  parts?: readonly string[];
  /** One line for the tooltip: what this model expects the bar to do. */
  note: string;
}

/** The pre-P9 phase set id, still on every analysis stored before it. Those
 *  rows were segmented under the five-phase snatch/clean model. */
export const LEGACY_PHASE_SET_ID = 'default';

export const PHASE_SET_IDS = {
  floor: 'pull-catch-floor',
  belowKnee: 'pull-catch-below-knee',
  aboveKnee: 'pull-catch-above-knee',
  pull: 'pull',
  deadlift: 'deadlift',
  dipDrive: 'dip-drive',
  none: 'none',
} as const;

const floor = (family: LiftFamily, id: string, label: string, shortLabel: string, note: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'pull-catch',
  phaseSet: PULL_CATCH_FLOOR_PHASES, phaseSetId: PHASE_SET_IDS.floor, endRule: DEFAULT_PHASE_END_RULE, note,
});
const belowKnee = (family: LiftFamily, id: string, label: string, shortLabel: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'pull-catch',
  phaseSet: PULL_CATCH_BELOW_KNEE_PHASES, phaseSetId: PHASE_SET_IDS.belowKnee, endRule: DEFAULT_PHASE_END_RULE,
  note: 'From a hang or blocks below the knee: no first pull; the knee passage and the second pull remain.',
});
const aboveKnee = (family: LiftFamily, id: string, label: string, shortLabel: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'pull-catch',
  phaseSet: PULL_CATCH_ABOVE_KNEE_PHASES, phaseSetId: PHASE_SET_IDS.aboveKnee, endRule: DEFAULT_PHASE_END_RULE,
  note: 'From above the knee: only the second pull is left of the acceleration.',
});
const pull = (family: LiftFamily, id: string, label: string, shortLabel: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'pull',
  phaseSet: PULL_PHASES, phaseSetId: PHASE_SET_IDS.pull, endRule: PULL_END_RULE,
  note: 'The acceleration only; the rep ends at the apex and nothing is read after it.',
});
const deadlift = (family: LiftFamily, id: string, label: string, shortLabel: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'pull',
  phaseSet: DEADLIFT_PHASES, phaseSetId: PHASE_SET_IDS.deadlift, endRule: PULL_END_RULE,
  note: 'One phase, lift-off to apex.',
});
const dipDrive = (family: LiftFamily, id: string, label: string, shortLabel: string, note: string): LiftModel => ({
  id, family, label, shortLabel, shape: 'dip-drive',
  phaseSet: DIP_DRIVE_PHASES, phaseSetId: PHASE_SET_IDS.dipDrive, endRule: DEFAULT_PHASE_END_RULE, note,
  // The bar falls 2–6 cm into the fix, not 20 into a squat: a drop under
  // is believed from −0,05 m/s (2009 bench: −0,14 on the jerk from the
  // side, rejected at the pull's −0,15).
  thresholds: { dropUnderMs: 0.05 },
});

/**
 * The built-in models. Order is the order a picker lists them: by family,
 * the full lift first.
 */
export const LIFT_MODELS: readonly LiftModel[] = [
  // ── Snatch ────────────────────────────────────────────────────────────────
  floor('snatch', 'snatch', 'Snatch', 'Sn', 'From the floor: first pull, knee passage, second pull, turnover, catch, recovery.'),
  floor('snatch', 'power-snatch', 'Power snatch', 'PSn', 'A snatch caught high: the same phases, a shallower catch.'),
  floor('snatch', 'muscle-snatch', 'Muscle snatch', 'MSn', 'No drop under: the bar keeps rising into the lockout.'),
  belowKnee('snatch', 'snatch-hang-below-knee', 'Snatch from below the knee', 'Sn↓K'),
  aboveKnee('snatch', 'snatch-hang-above-knee', 'Snatch from above the knee', 'Sn↑K'),
  pull('snatch', 'snatch-pull', 'Snatch pull', 'SnP'),
  deadlift('snatch', 'snatch-deadlift', 'Snatch deadlift', 'SnDL'),
  dipDrive('snatch', 'snatch-balance', 'Snatch balance', 'SnB', 'From the back: a dip, a drive, and the bar caught overhead — a dip-and-drive, not a pull.'),
  // ── Clean ─────────────────────────────────────────────────────────────────
  floor('clean', 'clean', 'Clean', 'Cl', 'From the floor: first pull, knee passage, second pull, turnover, catch, recovery.'),
  floor('clean', 'power-clean', 'Power clean', 'PCl', 'A clean caught high: the same phases, a shallower catch.'),
  floor('clean', 'muscle-clean', 'Muscle clean', 'MCl', 'No drop under: the bar is pulled to the shoulders standing.'),
  belowKnee('clean', 'clean-hang-below-knee', 'Clean from below the knee', 'Cl↓K'),
  aboveKnee('clean', 'clean-hang-above-knee', 'Clean from above the knee', 'Cl↑K'),
  pull('clean', 'clean-pull', 'Clean pull', 'ClP'),
  deadlift('clean', 'clean-deadlift', 'Clean deadlift', 'ClDL'),
  // ── Jerk ──────────────────────────────────────────────────────────────────
  dipDrive('jerk', 'jerk', 'Jerk', 'Jk', 'From the rack: dip, braking, drive, turnover into the split, catch, recovery.'),
  dipDrive('jerk', 'power-jerk', 'Power jerk', 'PJk', 'Dip, drive and a catch in a quarter squat rather than a split.'),
  dipDrive('jerk', 'push-press', 'Push press', 'PP', 'Dip, drive and a press-out: the catch reads a drop of about zero.'),
  {
    id: 'press',
    family: 'jerk',
    label: 'Press',
    shortLabel: 'Pr',
    shape: 'free',
    phaseSet: null,
    phaseSetId: PHASE_SET_IDS.none,
    endRule: null,
    note: 'No dip and no drive: a strict press has no phases the bar can tell apart. Universal metrics only.',
  },
  // ── Compound ──────────────────────────────────────────────────────────────
  {
    id: 'clean-and-jerk',
    family: 'clean',
    label: 'Clean & jerk',
    shortLabel: 'C&J',
    shape: 'compound',
    phaseSet: null,
    phaseSetId: PHASE_SET_IDS.none,
    endRule: null,
    parts: ['clean', 'jerk'],
    note: 'Cut on every rest: a rise from a low rest is the clean, a dip from a high rest is the jerk. Two reps, two models.',
  },
  // ── The lift nobody named ─────────────────────────────────────────────────
  {
    id: 'unspecified',
    family: 'none',
    label: 'Unspecified lift',
    shortLabel: '—',
    shape: 'free',
    phaseSet: null,
    phaseSetId: PHASE_SET_IDS.none,
    endRule: null,
    note: 'No phases. Duration, peak and mean velocity, time to peak velocity and power, displacement, path.',
  },
];

const BY_ID = new Map(LIFT_MODELS.map(m => [m.id, m]));

export const UNSPECIFIED_MODEL: LiftModel = BY_ID.get('unspecified')!;

/**
 * The model behind an id. An unknown id — a coach-defined model this build
 * does not know, a typo in a stored row — reads as unspecified rather than
 * throwing, since a rep with no phases is still a rep.
 */
export function liftModelById(id: string | null | undefined): LiftModel {
  return (id && BY_ID.get(id)) || UNSPECIFIED_MODEL;
}

/** Whether an id names a built-in model. */
export function isKnownLiftModel(id: string | null | undefined): boolean {
  return !!id && BY_ID.has(id);
}

/**
 * The model a stored analysis was segmented under. A row from before P9
 * carries no model and the legacy phase-set id: it was analysed as a snatch
 * from the floor, and reads as one.
 */
export function liftModelOfStored(liftModelId: string | null | undefined, phaseSetId: string | null | undefined): LiftModel {
  if (liftModelId && BY_ID.has(liftModelId)) return BY_ID.get(liftModelId)!;
  if (!liftModelId && (!phaseSetId || phaseSetId === LEGACY_PHASE_SET_ID)) return BY_ID.get('snatch')!;
  return UNSPECIFIED_MODEL;
}

/**
 * The part of a compound a cut rep is stored under, from what the bar did
 * first. A compound with no part for that motion — and a plain model, which
 * has no parts — is stored under itself.
 */
export function partForKind(model: LiftModel, kind: 'pull' | 'dip-drive'): LiftModel {
  if (!model.parts) return model;
  const wanted: MotionShape = kind === 'dip-drive' ? 'dip-drive' : 'pull-catch';
  for (const id of model.parts) {
    const part = BY_ID.get(id);
    if (part && part.shape === wanted) return part;
  }
  return model;
}

/** The models a picker offers, grouped by family in registry order. */
export function liftModelsByFamily(): Array<{ family: LiftFamily; label: string; models: LiftModel[] }> {
  const labels: Record<LiftFamily, string> = { snatch: 'Snatch', clean: 'Clean', jerk: 'Jerk', none: 'Other' };
  const groups: Array<{ family: LiftFamily; label: string; models: LiftModel[] }> = [];
  for (const model of LIFT_MODELS) {
    let group = groups.find(g => g.family === model.family);
    if (!group) {
      group = { family: model.family, label: labels[model.family], models: [] };
      groups.push(group);
    }
    group.models.push(model);
  }
  return groups;
}

/** Whether two models can be laid on top of each other without the
 *  comparison meaning nothing: the same motion shape. */
export function shapesComparable(a: LiftModel, b: LiftModel): boolean {
  return a.shape === b.shape;
}
