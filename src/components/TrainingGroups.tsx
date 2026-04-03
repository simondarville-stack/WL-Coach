import { useState, useEffect } from 'react';
import type { TrainingGroup } from '../lib/database.types';
import { Users, Plus, CreditCard as Edit2, Trash2, X, UserPlus, UserMinus } from 'lucide-react';
import { useTrainingGroups } from '../hooks/useTrainingGroups';
import { useAthletes } from '../hooks/useAthletes';

export function TrainingGroups() {
  const {
    groups, groupMembers, loading, error, setError,
    fetchGroups, fetchGroupMembers,
    createGroup, updateGroup, deleteGroup,
    addMember, removeMember,
  } = useTrainingGroups();

  const { athletes: allAthletes, fetchActiveAthletes } = useAthletes();

  const [selectedGroup, setSelectedGroup] = useState<TrainingGroup | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  useEffect(() => {
    fetchGroups();
    fetchActiveAthletes();
  }, []);

  useEffect(() => {
    if (selectedGroup) {
      fetchGroupMembers(selectedGroup.id);
    }
  }, [selectedGroup]);

  const handleCreateGroup = async () => {
    if (!formName.trim()) return;
    try {
      const newGroup = await createGroup(formName.trim(), formDescription.trim() || null);
      setSelectedGroup(newGroup);
      setShowCreateModal(false);
      setFormName('');
      setFormDescription('');
    } catch {
      // error already set in hook
    }
  };

  const handleUpdateGroup = async () => {
    if (!selectedGroup || !formName.trim()) return;
    try {
      await updateGroup(selectedGroup.id, formName.trim(), formDescription.trim() || null);
      setSelectedGroup({ ...selectedGroup, name: formName.trim(), description: formDescription.trim() || null });
      setShowEditModal(false);
      setFormName('');
      setFormDescription('');
    } catch {
      // error already set in hook
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('Delete this training group? This will also delete all associated group plans.')) return;
    try {
      await deleteGroup(groupId);
      if (selectedGroup?.id === groupId) setSelectedGroup(null);
    } catch {
      // error already set in hook
    }
  };

  const handleAddMember = async (athleteId: string) => {
    if (!selectedGroup) return;
    try {
      await addMember(selectedGroup.id, athleteId);
      setShowAddMemberModal(false);
    } catch {
      // error already set in hook
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('Remove this athlete from the group? Their historical data will be preserved.')) return;
    if (!selectedGroup) return;
    try {
      await removeMember(memberId, selectedGroup.id);
    } catch {
      // error already set in hook
    }
  };

  const openEditModal = () => {
    if (!selectedGroup) return;
    setFormName(selectedGroup.name);
    setFormDescription(selectedGroup.description || '');
    setShowEditModal(true);
  };

  const availableAthletes = allAthletes.filter(
    athlete => !groupMembers.some(member => member.athlete_id === athlete.id)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-medium text-gray-900">Training Groups</h1>
          <button
            onClick={() => { setFormName(''); setFormDescription(''); setShowCreateModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus size={20} />
            Create Group
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-4">Groups</h2>
            {loading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                Loading...
              </div>
            ) : groups.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                <Users className="mx-auto mb-2" size={32} />
                <p>No groups yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedGroup?.id === group.id
                        ? 'bg-blue-50 border-blue-300'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                    onClick={() => setSelectedGroup(group)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">{group.name}</h3>
                        {group.description && (
                          <p className="text-xs text-gray-600 truncate mt-1">{group.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedGroup(group); openEditModal(); }}
                          className="p-1.5 hover:bg-white rounded transition-colors"
                          title="Edit group"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }}
                          className="p-1.5 text-red-600 hover:bg-white rounded transition-colors"
                          title="Delete group"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
            {!selectedGroup ? (
              <div className="text-center py-12 text-gray-500">
                <Users size={48} className="mx-auto mb-4 text-gray-400" />
                <p>Select a group to view members</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-medium text-gray-900">{selectedGroup.name}</h2>
                    {selectedGroup.description && (
                      <p className="text-sm text-gray-600 mt-1">{selectedGroup.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAddMemberModal(true)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                  >
                    <UserPlus size={18} />
                    Add Member
                  </button>
                </div>

                {groupMembers.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No members in this group yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupMembers.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          {member.athlete.photo_url ? (
                            <img src={member.athlete.photo_url} alt={member.athlete.name} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                              <Users size={20} className="text-gray-600" />
                            </div>
                          )}
                          <div>
                            <h3 className="font-medium text-gray-900">{member.athlete.name}</h3>
                            <p className="text-xs text-gray-600">
                              Joined {new Date(member.joined_at).toLocaleDateString('en-GB')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Remove from group"
                        >
                          <UserMinus size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {showCreateModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full p-6 animate-dialog-in">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-medium text-gray-900">Create Training Group</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g., National Team Squad, Beginners Group"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Group purpose or notes..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateGroup}
                    disabled={!formName.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create Group
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showEditModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full p-6 animate-dialog-in">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-medium text-gray-900">Edit Training Group</h2>
                <button onClick={() => setShowEditModal(false)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateGroup}
                    disabled={!formName.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAddMemberModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full p-6 animate-dialog-in">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-medium text-gray-900">Add Member</h2>
                <button onClick={() => setShowAddMemberModal(false)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                  <X size={20} />
                </button>
              </div>
              {availableAthletes.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>All active athletes are already in this group</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {availableAthletes.map((athlete) => (
                    <div
                      key={athlete.id}
                      onClick={() => handleAddMember(athlete.id)}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 cursor-pointer transition-colors"
                    >
                      {athlete.photo_url ? (
                        <img src={athlete.photo_url} alt={athlete.name} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                          <Users size={20} className="text-gray-600" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-medium text-gray-900">{athlete.name}</h3>
                        {athlete.club && <p className="text-xs text-gray-600">{athlete.club}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end pt-4">
                <button onClick={() => setShowAddMemberModal(false)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
