// Starter presets — a coach opens one and tweaks it, rather than facing a blank
// builder ("presets-first", UX-01). Phase 2 formalises the five chart presets;
// these table presets exist from Phase 1 so the front door is never empty.

import type { BuilderState } from './builderState';

export interface Preset {
  id: string;
  name: string;
  description: string;
  patch: Partial<BuilderState>;
}

export const PRESETS: Preset[] = [
  {
    id: 'weekly-tonnage',
    name: 'Weekly tonnage — plan vs done',
    description: 'Prescribed and performed volume per week, side by side.',
    patch: { rows: ['week'], cols: [], metrics: ['volume'], compare: 'both', vizType: 'table' },
  },
  {
    id: 'volume-by-category',
    name: 'Volume by category',
    description: 'Performed tonnage and sets across your exercise categories.',
    patch: { rows: ['category'], cols: [], metrics: ['volume', 'sets'], compare: 'performed', vizType: 'table' },
  },
  {
    id: 'intensity-zones',
    name: 'Intensity-zone distribution',
    description: 'Reps performed in each %1RM band.',
    patch: { rows: ['intensityZone'], cols: [], metrics: ['reps'], compare: 'performed', vizType: 'table' },
  },
  {
    id: 'adherence-by-week',
    name: 'Adherence by week',
    description: 'How much of each week’s prescribed volume was completed.',
    patch: { rows: ['week'], cols: [], metrics: ['volume'], compare: 'adherence', vizType: 'table' },
  },
  {
    id: 'loads-by-movement',
    name: 'Top loads by movement',
    description: 'Heaviest kg reached per competition-lift slot.',
    patch: { rows: ['movement'], cols: [], metrics: ['maxLoad'], compare: 'performed', vizType: 'table' },
  },
];
