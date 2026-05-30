import { useCoachStore } from '../store/coachStore';
import { useAthleteStore } from '../store/athleteStore';
import type { Athlete, TrainingGroup } from './database.types';

/**
 * Get the active coach's owner_id.
 * Returns the default coach ID if none is selected.
 * Every Supabase query to a root table must use this.
 */
export function getOwnerId(): string {
  const coach = useCoachStore.getState().activeCoach;
  return coach?.id ?? '00000000-0000-0000-0000-000000000001';
}

/**
 * Owner-id for the currently selected athlete-or-group context.
 *
 * For unshared athletes/groups this equals the active coach's id (the
 * host is the active coach). For shared athletes/groups it returns the
 * host coach's id — so reads and writes operate on the host's rows
 * regardless of which coach is editing. Programmes, exercises,
 * categories and training-log children all live under the host.
 *
 * Falls back to getOwnerId() when nothing is selected.
 */
export function getContextOwnerId(): string {
  const state = useAthleteStore.getState();
  if (state.selectedAthlete) return state.selectedAthlete.owner_id;
  if (state.selectedGroup) return state.selectedGroup.owner_id;
  return getOwnerId();
}

/**
 * Owner-id for an explicit athlete or group, without touching the store.
 * Use this in write paths where the target is already known so we don't
 * race the store. Falls back to getOwnerId() when both args are nullish.
 */
export function ownerIdForTarget(athlete: Athlete | null, group: TrainingGroup | null): string {
  if (athlete) return athlete.owner_id;
  if (group) return group.owner_id;
  return getOwnerId();
}
