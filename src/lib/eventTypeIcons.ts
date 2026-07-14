/**
 * Per event-type glyph, shared by the macro table's Events column and the
 * timeline strip so every event kind (competition, camp, seminar, testing day,
 * team meeting, other) reads with the same symbol everywhere.
 *
 * Event types are a fixed enum (see `EventType` in database.types); a new type
 * is a new entry here. Colours live in `eventTypes.ts` (CAL_EVENT_COLORS).
 * // COACH-CONFIG candidate if event types ever become coach-defined.
 */
import { Trophy, Tent, GraduationCap, Gauge, Users, CalendarDays } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const EVENT_TYPE_ICONS: Record<string, LucideIcon> = {
  competition:   Trophy,
  training_camp: Tent,
  seminar:       GraduationCap,
  testing_day:   Gauge,
  team_meeting:  Users,
  other:         CalendarDays,
};

/** Icon for an event type (falls back to a neutral calendar glyph). */
export function getEventTypeIcon(eventType: string | null | undefined): LucideIcon {
  return (eventType && EVENT_TYPE_ICONS[eventType]) || CalendarDays;
}
