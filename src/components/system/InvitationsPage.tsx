/**
 * InvitationsPage — pending coach-sharing invites for the active coach,
 * covering both athlete shares and training-group shares.
 *
 * Each invite (athlete_collaborators / training_group_collaborators row
 * where coach_id = me, not accepted, not revoked) shows who invited you,
 * the role, and the target. Accept brings the athlete or group (and its
 * member athletes, via the cascade) into your lists immediately; decline
 * stamps revoked_at so the host sees it was turned down.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, Inbox, User, Users } from 'lucide-react';
import { useAthleteCollaborators } from '../../hooks/useAthleteCollaborators';
import { useTrainingGroupCollaborators } from '../../hooks/useTrainingGroupCollaborators';
import { useCoachStore } from '../../store/coachStore';
import { useAthleteStore } from '../../store/athleteStore';

type UnifiedInvite = {
  id: string;
  kind: 'athlete' | 'group';
  role: 'co_coach' | 'viewer';
  inviterName: string;
  targetName: string;
  invitedAt: string;
  notes: string | null;
};

export function InvitationsPage() {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const refreshAthletes = useAthleteStore(s => s.fetchAthletes);
  const athleteCollab = useAthleteCollaborators();
  const groupCollab = useTrainingGroupCollaborators();

  const [invites, setInvites] = useState<UnifiedInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCoachId) return;
    setError(null);
    try {
      const [athleteInvites, groupInvites] = await Promise.all([
        athleteCollab.listPendingInvites(activeCoachId),
        groupCollab.listPendingInvites(activeCoachId),
      ]);
      const merged: UnifiedInvite[] = [
        ...athleteInvites.map(i => ({
          id: i.id,
          kind: 'athlete' as const,
          role: i.role,
          inviterName: i.inviter?.name ?? 'A coach',
          targetName: i.athlete?.name ?? 'an athlete',
          invitedAt: i.invited_at,
          notes: i.notes,
        })),
        ...groupInvites.map(i => ({
          id: i.id,
          kind: 'group' as const,
          role: i.role,
          inviterName: i.inviter?.name ?? 'A coach',
          targetName: i.group?.name ?? 'a group',
          invitedAt: i.invited_at,
          notes: i.notes,
        })),
      ].sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
      setInvites(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invitations');
    }
  }, [activeCoachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (inv: UnifiedInvite) => {
    setBusy(inv.id);
    try {
      if (inv.kind === 'athlete') await athleteCollab.acceptInvite(inv.id);
      else await groupCollab.acceptInvite(inv.id);
      // Both kinds can change the accessible-athlete set (a group brings
      // its members via the cascade), so refresh the athlete store.
      await refreshAthletes(true);
      setInvites(prev => (prev ? prev.filter(i => i.id !== inv.id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept');
    } finally {
      setBusy(null);
    }
  };

  const decline = async (inv: UnifiedInvite) => {
    setBusy(inv.id);
    try {
      if (inv.kind === 'athlete') await athleteCollab.declineInvite(inv.id);
      else await groupCollab.declineInvite(inv.id);
      setInvites(prev => (prev ? prev.filter(i => i.id !== inv.id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to decline');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invitations</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            Pending requests from other coaches to share their athletes and groups with you.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm mb-4">
          {error}
        </div>
      )}

      {invites === null && !error && (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      )}

      {invites && invites.length === 0 && (
        <div className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-300 rounded flex flex-col items-center gap-2">
          <Inbox size={28} className="text-gray-300" />
          No pending invitations.
        </div>
      )}

      <div className="space-y-2">
        {(invites ?? []).map(inv => (
          <div
            key={`${inv.kind}-${inv.id}`}
            className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
              {inv.kind === 'group' ? <Users size={14} /> : <User size={14} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">
                <strong>{inv.inviterName}</strong> invited you to{' '}
                {inv.role === 'co_coach' ? 'co-coach' : 'view'}{' '}
                {inv.kind === 'group' ? 'the group ' : ''}
                <strong>{inv.targetName}</strong>.
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Invited {formatRelativeTime(inv.invitedAt)}
                {inv.notes && <span className="ml-2 italic">· "{inv.notes}"</span>}
              </div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                onClick={() => void decline(inv)}
                disabled={busy === inv.id}
                className="px-2.5 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <X size={12} />
                Decline
              </button>
              <button
                onClick={() => void accept(inv)}
                disabled={busy === inv.id}
                className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Check size={12} />
                Accept
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleString();
}

export default InvitationsPage;
