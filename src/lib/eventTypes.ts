/**
 * Canonical calendar-event type → colour / label maps.
 *
 * Kept in a tiny neutral module (no React, no canvas) so both the data layer
 * (macroTimelineData) and presentational code can import them without pulling
 * in the annual-wheel canvas renderer. `annualWheelRenderer` re-exports these
 * for back-compat, so this file is the single source of truth.
 *
 * These are data-driven / semantic colours — do NOT tokenise or neutralise.
 */
export const CAL_EVENT_COLORS: Record<string, string> = {
  competition:   '#E24B4A',
  training_camp: '#2563eb',
  seminar:       '#7c3aed',
  testing_day:   '#d97706',
  team_meeting:  '#059669',
  other:         '#6b7280',
};

export const CAL_EVENT_LABELS: Record<string, string> = {
  competition:   'Competition',
  training_camp: 'Training Camp',
  seminar:       'Seminar',
  testing_day:   'Testing Day',
  team_meeting:  'Team Meeting',
  other:         'Event',
};
