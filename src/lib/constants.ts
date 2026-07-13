import type { DefaultUnit, PhaseTypePreset, RhythmPreset } from './database.types';

export const DEFAULT_PHASE_TYPE_PRESETS: PhaseTypePreset[] = [
  { value: 'preparatory', label: 'Preparatory', color: '#DBEAFE' },
  { value: 'strength',    label: 'Strength',    color: '#FEE2E2' },
  { value: 'competition', label: 'Competition', color: '#FEF3C7' },
  { value: 'transition',  label: 'Transition',  color: '#F3F4F6' },
];

/**
 * Default fill-guide rhythm presets (general_settings.rhythm_presets = NULL).
 * The weektype preset's `mult` keys match the default week types (h/m/g from
 * the week_types column default); coach-added types fall back to 100/100 in
 * the engine, so custom week-type sets never break a preset.
 */
export const DEFAULT_RHYTHM_PRESETS: RhythmPreset[] = [
  {
    id: 'weektype-wave', name: 'Week-type wave', mode: 'weektype',
    mult: {
      h: { load: 100, reps: 100 },
      m: { load: 95,  reps: 100 },
      g: { load: 88,  reps: 105 },
    },
  },
  {
    id: 'step-3-1', name: '3:1 step build', mode: 'pattern',
    pattern: [
      { load: 94,  reps: 105 },
      { load: 98,  reps: 100 },
      { load: 102, reps: 92 },
      { load: 86,  reps: 70 },
    ],
    stampTypes: ['m', 'h', 'h', 'g'],
  },
  {
    id: 'undulating', name: 'Undulating', mode: 'pattern',
    pattern: [
      { load: 100, reps: 95 },
      { load: 88,  reps: 118 },
      { load: 106, reps: 82 },
      { load: 92,  reps: 108 },
    ],
    stampTypes: null,
  },
  {
    id: 'flat', name: 'Flat (trend only)', mode: 'pattern',
    pattern: [{ load: 100, reps: 100 }],
    stampTypes: null,
  },
];

export const DEFAULT_UNITS: { value: DefaultUnit; label: string }[] = [
  { value: 'absolute_kg', label: 'kg' },
  { value: 'percentage', label: '%' },
  { value: 'free_text_reps', label: 'Free text with reps × sets' },
  { value: 'free_text', label: 'Free text' },
];

export const DAYS_OF_WEEK = [
  { index: 1, name: 'Monday' },
  { index: 2, name: 'Tuesday' },
  { index: 3, name: 'Wednesday' },
  { index: 4, name: 'Thursday' },
  { index: 5, name: 'Friday' },
  { index: 6, name: 'Saturday' },
  { index: 7, name: 'Sunday' },
];

export const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Default label for a training unit when the coach hasn't named it.
 * Numbered by position in the week's display order ("Unit 1", "Unit 2", …)
 * rather than by weekday — a unit isn't tied to a calendar day until the
 * coach explicitly assigns one. Falls back to the raw index if the day
 * isn't in the display order (e.g. a transient gap index).
 */
export function defaultUnitLabel(dayIndex: number, displayOrder: number[]): string {
  const pos = displayOrder.indexOf(dayIndex);
  return `Unit ${pos >= 0 ? pos + 1 : dayIndex}`;
}

export function getUnitSymbol(unit: string | null): string {
  switch (unit) {
    case 'percentage':
      return '%';
    case 'absolute_kg':
      return 'kg';
    case 'rpe':
      return 'RPE';
    case 'free_text':
    case 'free_text_reps':
      return 'text';
    case 'other':
      return '';
    default:
      return '';
  }
}

export function getUnitLabel(unit: string | null): string {
  switch (unit) {
    case 'percentage':
      return 'Percentage';
    case 'absolute_kg':
      return 'Kilograms';
    case 'rpe':
      return 'RPE';
    case 'free_text':
      return 'Free Text';
    case 'free_text_reps':
      return 'Free Text + reps';
    case 'other':
      return 'Other';
    default:
      return 'Unknown';
  }
}
