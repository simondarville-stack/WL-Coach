// The five seed presets (Phase 2). Each is a serialized query a coach opens and
// tweaks ("presets-first", UX-01). The weekly-stress-curve preset is
// deliberately held until the stress model is defined (REVIEW_PLAN D-07).

import type { BuilderState } from './builderState';

export interface Preset {
  id: string;
  name: string;
  description: string;
  patch: Partial<BuilderState>;
}

export const PRESETS: Preset[] = [
  {
    id: 'planned-vs-performed',
    name: 'Planned vs performed',
    description: 'Prescribed vs completed tonnage, week by week.',
    patch: { rows: ['week'], cols: [], metrics: [{ id: 'volume' }], compare: 'both', vizType: 'bar' },
  },
  {
    id: 'intensity-zones',
    name: 'Intensity-zone distribution',
    description: 'Reps performed in each %1RM band.',
    patch: { rows: ['intensityZone'], cols: [], metrics: [{ id: 'reps' }], compare: 'performed', vizType: 'bar' },
  },
  {
    id: 'lift-ratios',
    name: 'Lift ratios',
    description: 'Snatch ÷ C&J and pull share of total volume.',
    patch: { rows: [], cols: [], metrics: [{ id: 'snatchCleanRatio' }, { id: 'pullPctOfTotal' }], compare: 'performed', vizType: 'table' },
  },
  {
    id: 'competition-lift-trend',
    name: 'Competition-lift trend',
    description: 'Top kg reached per movement over time.',
    patch: { rows: ['week'], cols: ['movement'], metrics: [{ id: 'maxLoad' }], compare: 'performed', vizType: 'line' },
  },
  {
    id: 'category-distribution',
    name: 'Category distribution',
    description: 'Planned vs performed volume across your categories.',
    patch: { rows: ['category'], cols: [], metrics: [{ id: 'volume' }], compare: 'both', vizType: 'bar' },
  },
  {
    id: 'bodyweight-vs-performance',
    name: 'Bodyweight vs performance',
    description: 'Weekly bodyweight beside tonnage, reps and intensity — read off how output tracks a cut or bulk.',
    // A table keeps each metric on its own scale (bodyweight ~kg vs tonnage
    // ~tonnes); switch to a line chart for a single metric's trend.
    patch: {
      rows: ['week'],
      cols: [],
      metrics: [{ id: 'bodyweight' }, { id: 'volume' }, { id: 'reps' }, { id: 'avgPct1RM' }],
      compare: 'performed',
      vizType: 'table',
    },
  },
];
