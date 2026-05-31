/**
 * Hooks for managing training-group coach-to-coach sharing. Mirror of
 * useAthleteCollaborators, scoped to training_group_collaborators.
 *
 * Sharing a group also grants the invitee access to its member athletes
 * via the group→athlete cascade in accessScope — so accepting a group
 * invite is how a head coach gets read access to a whole squad, or how
 * two coaches co-own a group programme and each bring their athletes in.
 */
import { supabase } from '../lib/supabase';
import type {
  TrainingGroupCollaborator,
  CollaboratorRole,
  CoachProfile,
  TrainingGroup,
} from '../lib/database.types';

export interface GroupInviteWithContext extends TrainingGroupCollaborator {
  group: Pick<TrainingGroup, 'id' | 'name'> | null;
  inviter: Pick<CoachProfile, 'id' | 'name'> | null;
}

export function useTrainingGroupCollaborators() {
  const listCollaboratorsFor = async (groupId: string): Promise<TrainingGroupCollaborator[]> => {
    const { data, error } = await supabase
      .from('training_group_collaborators')
      .select('*')
      .eq('group_id', groupId)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as TrainingGroupCollaborator[];
  };

  const listPendingInvites = async (coachId: string): Promise<GroupInviteWithContext[]> => {
    const { data, error } = await supabase
      .from('training_group_collaborators')
      .select('*, group:group_id(id, name), inviter:invited_by(id, name)')
      .eq('coach_id', coachId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as GroupInviteWithContext[];
  };

  const inviteCoach = async (params: {
    groupId: string;
    coachId: string;
    inviterId: string;
    role: CollaboratorRole;
    notes?: string | null;
  }): Promise<TrainingGroupCollaborator> => {
    const { data, error } = await supabase
      .from('training_group_collaborators')
      .upsert(
        {
          group_id: params.groupId,
          coach_id: params.coachId,
          role: params.role,
          invited_by: params.inviterId,
          invited_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          notes: params.notes ?? null,
        },
        { onConflict: 'group_id,coach_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data as TrainingGroupCollaborator;
  };

  const acceptInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('training_group_collaborators')
      .update({ accepted_at: new Date().toISOString(), revoked_at: null })
      .eq('id', id);
    if (error) throw error;
  };

  const declineInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('training_group_collaborators')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  };

  const revokeAccess = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('training_group_collaborators')
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
