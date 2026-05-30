import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { TrainingGroup, GroupMemberWithAthlete } from '../lib/database.types';
import { useAthleteStore } from '../store/athleteStore';

export function useTrainingGroups() {
  const [groups, setGroups] = useState<TrainingGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<GroupMemberWithAthlete[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setGroups: storeSetGroups } = useAthleteStore();

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const coachId = getOwnerId();

      // Owned and collaborator queries run in parallel. The collaborator
      // table may not exist yet (migration not applied) — we degrade
      // gracefully to the owned set in that case.
      const [ownedRes, collabRes] = await Promise.all([
        supabase.from('training_groups').select('*').eq('owner_id', coachId).order('name'),
        supabase
          .from('training_group_collaborators')
          .select('group_id')
          .eq('coach_id', coachId)
          .not('accepted_at', 'is', null)
          .is('revoked_at', null),
      ]);
      if (ownedRes.error) throw ownedRes.error;
      const sharedIds = collabRes.error
        ? []
        : (collabRes.data ?? []).map(r => r.group_id as string);

      let sharedGroups: TrainingGroup[] = [];
      if (sharedIds.length > 0) {
        const sharedRes = await supabase
          .from('training_groups')
          .select('*')
          .in('id', sharedIds)
          .order('name');
        if (!sharedRes.error) sharedGroups = (sharedRes.data ?? []) as TrainingGroup[];
      }

      const seen = new Set<string>();
      const merged: TrainingGroup[] = [];
      for (const g of [...(ownedRes.data ?? []), ...sharedGroups]) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        merged.push(g);
      }
      setGroups(merged);
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
      setGroupMembers(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group members');
    }
  };

  const createGroup = async (name: string, description: string | null): Promise<TrainingGroup> => {
    try {
      const { data, error } = await supabase
        .from('training_groups')
        .insert([{ name, description, owner_id: getOwnerId() }])
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

  const updateGroup = async (id: string, name: string, description: string | null) => {
    try {
      const { error } = await supabase
        .from('training_groups')
        .update({ name, description })
        .eq('id', id);
      if (error) throw error;
      setGroups(prev => prev.map(g => g.id === id ? { ...g, name, description } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group');
      throw err;
    }
  };

  const deleteGroup = async (id: string) => {
    try {
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
