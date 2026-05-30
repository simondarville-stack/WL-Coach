/**
 * Hooks for managing athlete coach-to-coach sharing.
 *
 * - listCollaboratorsFor(athleteId) — returns every coach who has been
 *   given access to one athlete (host UI for the Share dialog).
 * - listPendingInvites() — invites for the active coach that have not
 *   been accepted or revoked. Drives the Invitations page badge.
 * - listActiveAccessFor(coachId) — accepted-and-not-revoked rows;
 *   used by the athlete store fetch (kept here for completeness).
 * - inviteCoach / acceptInvite / declineInvite / revokeAccess —
 *   mutations.
 */
import { supabase } from '../lib/supabase';
import type {
  AthleteCollaborator,
  CollaboratorRole,
  CoachProfile,
  Athlete,
} from '../lib/database.types';

export interface InviteWithContext extends AthleteCollaborator {
  athlete: Pick<Athlete, 'id' | 'name'> | null;
  inviter: Pick<CoachProfile, 'id' | 'name'> | null;
}

export function useAthleteCollaborators() {
  const listCollaboratorsFor = async (athleteId: string): Promise<AthleteCollaborator[]> => {
    const { data, error } = await supabase
      .from('athlete_collaborators')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as AthleteCollaborator[];
  };

  const listPendingInvites = async (coachId: string): Promise<InviteWithContext[]> => {
    const { data, error } = await supabase
      .from('athlete_collaborators')
      .select('*, athlete:athlete_id(id, name), inviter:invited_by(id, name)')
      .eq('coach_id', coachId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    // Supabase's foreign-key embedding types are unreliable for two-hop
    // selects from a join table; the runtime shape matches InviteWithContext
    // but the inferred type is a SelectQueryError chain. Cast via unknown.
    return (data ?? []) as unknown as InviteWithContext[];
  };

  const inviteCoach = async (params: {
    athleteId: string;
    coachId: string;
    inviterId: string;
    role: CollaboratorRole;
    notes?: string | null;
  }): Promise<AthleteCollaborator> => {
    // Upsert pattern: if a row already exists (perhaps revoked from a
    // previous session), clear revoked_at and refresh invited_at so the
    // invitee gets a fresh notification.
    const { data, error } = await supabase
      .from('athlete_collaborators')
      .upsert(
        {
          athlete_id: params.athleteId,
          coach_id: params.coachId,
          role: params.role,
          invited_by: params.inviterId,
          invited_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          notes: params.notes ?? null,
        },
        { onConflict: 'athlete_id,coach_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data as AthleteCollaborator;
  };

  const acceptInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('athlete_collaborators')
      .update({ accepted_at: new Date().toISOString(), revoked_at: null })
      .eq('id', id);
    if (error) throw error;
  };

  /** From the invitee's side — never accepted, just stamp revoked_at. */
  const declineInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('athlete_collaborators')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  };

  /** From the host's side — pulls access back from a coach. */
  const revokeAccess = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('athlete_collaborators')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  };

  return {
    listCollaboratorsFor,
    listPendingInvites,
    inviteCoach,
    acceptInvite,
    declineInvite,
    revokeAccess,
  };
}
