import { useCoachStore } from '../store/coachStore';

/**
 * Get the active coach's owner_id.
 * Returns the default coach ID if none is selected.
 * Every Supabase query to a root table must use this.
 */
export function getOwnerId(): string {
  const coach = useCoachStore.getState().activeCoach;
  return coach?.id ?? '00000000-0000-0000-0000-000000000001';
}
