import type { Category, DefaultUnit } from './database.types';

export const CATEGORIES: Category[] = [
  'Snatch',
  'Clean & Jerk',
  'Squat',
  'Pull',
  'Press',
  'Accessory',
];

export const DEFAULT_UNITS: { value: DefaultUnit; label: string }[] = [
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'absolute_kg', label: 'Absolute (kg)' },
  { value: 'rpe', label: 'RPE' },
  { value: 'free_text', label: 'Free Text (with reps/sets)' },
  { value: 'other', label: 'Other (Free Text)' },
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

export function getUnitSymbol(unit: string | null): string {
  switch (unit) {
    case 'percentage':
      return '%';
    case 'absolute_kg':
      return 'kg';
    case 'rpe':
      return 'RPE';
    case 'free_text':
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
    case 'other':
      return 'Other';
    default:
      return 'Unknown';
  }
}
