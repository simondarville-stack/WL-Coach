import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { TrainingGroup, GroupMemberWithAthlete } from '../lib/database.types';
import { useAthleteStore } from '../store/athleteStore';
import { fetchAccessibleGroups, type AccessRole } from '../lib/accessScope';

export function useTrainingGroups() {
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [groupAccess, setGroupAccess] = useState<Record<string, AccessRole>>({});
  const [groupMembers, setGroupMembers] = useState<GroupMemberWithAthlete[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setGroups: storeSetGroups } = useAthleteStore();

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const { groups: merged, accessById } = await fetchAccessibleGroups(getOwnerId());
      setGroups(merged);
      setGroupAccess(accessById);
      storeSetGroups(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMembers = async (groupId: string) => {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select(`*, athlete:athlete_id(*)`)
        .eq('group_id', groupId)
        .is('left_at', null)
        .order('joined_at');
      if (error) throw error;
      setGroupMembers((data ?? []) as unknown as GroupMemberWithAthlete[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group members');
    }
  };

  const createGroup = async (name: string, description: string | null, accessCode: string | null = null): Promise<TrainingGroup> => {
    try {
      const { data, error } = await supabase
        .from('training_groups')
        .insert([{ name, description, access_code: accessCode, owner_id: getOwnerId() }])
        .select()
        .single();
      if (error) throw error;
      setGroups(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
      throw err;
    }
  };

  const updateGroup = async (id: string, name: string, description: string | null, accessCode: string | null = null) => {
    try {
      const { error } = await supabase
        .from('training_groups')
        .update({ name, description, access_code: accessCode })
        .eq('id', id);
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === id ? { ...g, name, description, access_code: accessCode } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group');
      throw err;
    }
  };

  const deleteGroup = async (id: string) => {
    try {
      // Deleting cascades group_members — host coach only. A co-coach
      // leaves via the share dialog instead of deleting the host's group.
      const { data: existing } = await supabase.from('training_groups').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Only the host coach can delete this group');
      const { error } = await supabase.from('training_groups').delete().eq('id', id);
      if (error) throw error;
      setGroups(prev => prev.filter(g => g.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
      throw err;
    }
  };

  const addMember = async (groupId: string, athleteId: string) => {
    try {
      const { error } = await supabase
        .from('group_members')
        .insert([{ group_id: groupId, athlete_id: athleteId }]);
      if (error) throw error;
      await fetchGroupMembers(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
      throw err;
    }
  };

  const removeMember = async (memberId: string, groupId: string) => {
    try {
      const { error } = await supabase
        .from('group_members')
        .update({ left_at: new Date().toISOString() })
        .eq('id', memberId);
      if (error) throw error;
      await fetchGroupMembers(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
      throw err;
    }
  };

  return {
    groups,
    groupAccess,
    setGroups,
    groupMembers,
    loading,
    error,
    setError,
    fetchGroups,
    fetchGroupMembers,
    createGroup,
    updateGroup,
    deleteGroup,
    addMember,
    removeMember,
  };
}
