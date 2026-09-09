/**
 * weightClass — which of the BVDG tables' three tiers an athlete is in.
 *
 * The reference bands (`referenceBands.ts`) are stated for the lower, the
 * middle and the upper weight classes. EMOS knows an athlete's sex, their
 * bodyweight and, when the coach wrote one, their weight class as free
 * text ("89", "-89", "+110"). This maps those to a tier through the IWF
 * classes in force from June 2025:
 *
 *   men    60 · 65 · 71 · 79 · 88 · 94 · 110 · +110
 *   women  48 · 53 · 58 · 63 · 69 · 77 · 86 · +86
 *
 * Three lower, three middle, two upper — the split the material implies
 * without stating; a federation that groups them differently changes this
 * table, not the bands. COACH-CONFIG candidate.
 *
 * Engine purity: numbers and strings in, a tier out.
 */
import type { Sex, WeightClass } from './referenceBands';

export const IWF_CLASSES_KG: Record<Sex, readonly number[]> = {
  men: [60, 65, 71, 79, 88, 94, 110],
  women: [48, 53, 58, 63, 69, 77, 86],
};

/** The tier of a bodyweight, kg, for a sex. Null without a usable number. */
export function tierForBodyweight(sex: Sex, kg: number | null | undefined): WeightClass | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg) || kg <= 0) return null;
  const limits = IWF_CLASSES_KG[sex];
  let index = limits.findIndex(limit => kg <= limit);
  if (index < 0) index = limits.length; // the super-heavy class
  return index <= 2 ? 'lower' : index <= 5 ? 'middle' : 'upper';
}

/**
 * The tier from an athlete's row: the declared weight class first (its
 * number is the class limit; a leading "+" is the super-heavy class), the
 * bodyweight second. Null when neither says anything or the sex is unknown.
 */
export function tierForAthlete(athlete: {
  sex: string | null | undefined;
  weightClass?: string | null;
  bodyweightKg?: number | null;
}): WeightClass | null {
  const sex = sexOf(athlete.sex);
  if (!sex) return null;
  const declared = athlete.weightClass?.trim() ?? '';
  if (declared) {
    const plus = declared.startsWith('+');
    const n = Number(declared.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return tierForBodyweight(sex, plus ? n + 0.5 : n);
  }
  return tierForBodyweight(sex, athlete.bodyweightKg ?? null);
}

/** 'men' / 'women' from whatever the row holds: m/f, male/female, the Danish
 *  and German words. Null for anything else. */
export function sexOf(value: string | null | undefined): Sex | null {
  const v = (value ?? '').trim().toLowerCase();
  if (['men', 'man', 'male', 'm', 'mand', 'mænd', 'männer', 'männlich', 'herrer'].includes(v)) return 'men';
  if (['women', 'woman', 'female', 'f', 'w', 'kvinde', 'kvinder', 'frauen', 'weiblich', 'damer'].includes(v)) return 'women';
  return null;
}
