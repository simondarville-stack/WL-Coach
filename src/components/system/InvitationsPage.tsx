/**
 * InvitationsPage — pending coach-sharing invites for the active coach.
 *
 * Lists every athlete_collaborators row where coach_id = me, accepted_at
 * is null, and revoked_at is null. Accept brings the athlete into the
 * coach's list immediately; decline writes revoked_at so the host
 * sees the invite was turned down.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, Inbox } from 'lucide-react';
import { useAthleteCollaborators, type InviteWithContext } from '../../hooks/useAthleteCollaborators';
import { useCoachStore } from '../../store/coachStore';
import { useAthleteStore } from '../../store/athleteStore';

export function InvitationsPage() {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const refreshAthletes = useAthleteStore(s => s.fetchAthletes);
  const { listPendingInvites, acceptInvite, declineInvite } = useAthleteCollaborators();

  const [invites, setInvites] = useState<InviteWithContext[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCoachId) return;
    setError(null);
    try {
      const data = await listPendingInvites(activeCoachId);
      setInvites(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invitations');
    }
  }, [activeCoachId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (id: string) => {
    setBusy(id);
    try {
      await acceptInvite(id);
      await refreshAthletes(true);
      setInvites(prev => (prev ? prev.filter(i => i.id !== id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept');
    } finally {
      setBusy(null);
    }
  };

  const decline = async (id: string) => {
    setBusy(id);
    try {
      await declineInvite(id);
      setInvites(prev => (prev ? prev.filter(i => i.id !== id) : prev));
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
            Pending requests from other coaches to share their athletes with you.
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
            key={inv.id}
            className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">
                <strong>{inv.inviter?.name ?? 'A coach'}</strong> invited you to{' '}
                {inv.role === 'co_coach' ? 'co-coach' : 'view'}{' '}
                <strong>{inv.athlete?.name ?? 'an athlete'}</strong>.
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Invited {formatRelativeTime(inv.invited_at)}
                {inv.notes && (
                  <span className="ml-2 italic">· "{inv.notes}"</span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                onClick={() => void decline(inv.id)}
                disabled={busy === inv.id}
                className="px-2.5 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <X size={12} />
                Decline
              </button>
              <button
                onClick={() => void accept(inv.id)}
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
