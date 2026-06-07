// UI catalogue of grouping dimensions for the Analysis builder. The engine
// owns the `Dimension` type; this only maps each to a coach-facing label and a
// section so the chip pickers can group them. ('state' is not here — it is the
// global Compare control, not a grouping dimension.)

import type { Dimension } from '../../../lib/analysis';

export interface DimOption {
  id: Dimension;
  label: string;
  section: 'Subject' | 'Exercise' | 'Time' | 'Macro';
  hint?: string;
}

export const DIMENSIONS: DimOption[] = [
  { id: 'athlete', label: 'Athlete', section: 'Subject' },
  { id: 'group', label: 'Group', section: 'Subject' },
  { id: 'exercise', label: 'Exercise', section: 'Exercise' },
  { id: 'category', label: 'Category', section: 'Exercise' },
  { id: 'movement', label: 'Movement', section: 'Exercise', hint: 'Snatch / C&J / squat / pull slot' },
  { id: 'intensityZone', label: 'Intensity zone', section: 'Exercise', hint: 'Banded by %1RM' },
  { id: 'week', label: 'Week', section: 'Time' },
  { id: 'dayOfWeek', label: 'Weekday', section: 'Time', hint: 'Only when a day has a scheduled weekday' },
  { id: 'day', label: 'Day slot', section: 'Time' },
  { id: 'relativeWeek', label: 'Macro week', section: 'Macro', hint: 'Week index within the macrocycle' },
  { id: 'weekType', label: 'Week type', section: 'Macro' },
  { id: 'macro', label: 'Macrocycle', section: 'Macro' },
  { id: 'meso', label: 'Phase', section: 'Macro' },
];

export const DIM_LABEL: Record<string, string> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, d.label]),
);

export function dimLabel(id: string): string {
  if (id.startsWith('custom:')) return id.slice('custom:'.length);
  return DIM_LABEL[id] ?? id;
}
