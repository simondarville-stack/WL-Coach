/**
 * ShareAthleteModal — host-side UI to invite another coach to co-coach
 * or view-only access an athlete. Lists every coach in coach_profiles
 * except the active one and those who already have an active row, with
 * a role picker per invite. Shows current collaborators so the host can
 * revoke at any time.
 */
import { useEffect, useState } from 'react';
import { X, UserPlus, Check, Clock, Slash } from 'lucide-react';
import type { Athlete, CoachProfile, AthleteCollaborator, CollaboratorRole } from '../lib/database.types';
import { useCoachProfiles } from '../hooks/useCoachProfiles';
import { useAthleteCollaborators } from '../hooks/useAthleteCollaborators';
import { useCoachStore } from '../store/coachStore';
import { useAthleteStore } from '../store/athleteStore';

interface Props {
  athlete: Athlete;
  onClose: () => void;
}

export function ShareAthleteModal({ athlete, onClose }: Props) {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const refreshAthletes = useAthleteStore(s => s.fetchAthletes);
  const { fetchCoaches } = useCoachProfiles();
  const { listCollaboratorsFor, inviteCoach, revokeAccess } = useAthleteCollaborators();

  const [coaches, setCoaches] = useState<CoachProfile[]>([]);
  const [collaborators, setCollaborators] = useState<AthleteCollaborator[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [role, setRole] = useState<CollaboratorRole>('co_coach');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [allCoaches, existing] = await Promise.all([
          fetchCoaches(),
          listCollaboratorsFor(athlete.id),
        ]);
        if (cancelled) return;
        setCoaches(allCoaches);
        setCollaborators(existing);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load coaches');
      }
    })();
    return () => { cancelled = true; };
  }, [athlete.id]);

  const hostId = athlete.owner_id;
  const isHost = activeCoachId === hostId;

  // Coaches eligible to be invited: not the host, not already in an
  // active (non-revoked) relationship. We still show revoked rows in
  // the list so the host can re-invite by clicking through the picker.
  const activeCollaboratorIds = new Set(
    collaborators.filter(c => c.revoked_at == null).map(c => c.coach_id),
  );
  const inviteCandidates = coaches.filter(
    c => c.id !== hostId && !activeCollaboratorIds.has(c.id),
  );

  const coachName = (id: string) => coaches.find(c => c.id === id)?.name ?? '(unknown coach)';

  const submitInvite = async (coachId: string) => {
    if (!activeCoachId) return;
    setBusy(true);
    setError(null);
    try {
      const row = await inviteCoach({
        athleteId: athlete.id,
        coachId,
        inviterId: activeCoachId,
        role,
      });
      // Optimistic local update — replace any existing row for this pair.
      setCollaborators(prev => [row, ...prev.filter(c => c.coach_id !== coachId)]);
      setPickerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invite');
    } finally {
      setBusy(false);
    }
  };

  const submitRevoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await revokeAccess(id);
      setCollaborators(prev =>
        prev.map(c => (c.id === id ? { ...c, revoked_at: new Date().toISOString() } : c)),
      );
      await refreshAthletes(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke access');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Share {athlete.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isHost
                ? 'Invite other coaches to co-coach or view this athlete.'
                : 'Only the host coach can manage sharing.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex-1 overflow-y-auto space-y-3">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {/* Current collaborators */}
          <section>
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              People with access
            </h3>
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 flex items-center gap-2 text-xs text-gray-700 border-b border-gray-200">
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-medium">
                  {coachName(hostId).split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="font-medium">{coachName(hostId)}</span>
                <span className="text-[10px] text-gray-500 ml-auto">Host</span>
              </div>
              {collaborators.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-gray-500 italic">
                  No other coaches yet.
                </div>
              ) : (
                collaborators.map(c => (
                  <CollaboratorRow
                    key={c.id}
                    collaborator={c}
                    coachName={coachName(c.coach_id)}
                    canManage={isHost && c.revoked_at == null}
                    onRevoke={() => submitRevoke(c.id)}
                    busy={busy}
                  />
                ))
              )}
            </div>
          </section>

          {/* Invite */}
          {isHost && (
            <section>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Invite a coach
              </h3>
              <div className="flex items-start gap-2 mb-2 p-2 bg-blue-50 border border-blue-200 rounded text-[11px] text-blue-900">
                <input
                  type="checkbox"
                  checked
                  readOnly
                  className="mt-0.5 flex-shrink-0 accent-blue-600"
                  aria-label="Inbox is shared"
                />
                <span>
                  <strong>Inbox is shared.</strong> Every message between you and{' '}
                  {athlete.name} — general thread and session comments — is visible to
                  the invited coach. New replies show the sender's name on each bubble
                  so the athlete can see who wrote what.
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs text-gray-600">Role:</label>
                <div className="flex gap-1">
                  {(['co_coach', 'viewer'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setRole(r)}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        role === r
                          ? 'bg-blue-100 text-blue-800 border-blue-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {r === 'co_coach' ? 'Co-coach (write)' : 'Viewer (read-only)'}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setPickerOpen(o => !o)}
                disabled={busy || inviteCandidates.length === 0}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <UserPlus size={12} />
                {inviteCandidates.length === 0
                  ? 'No coaches available to invite'
                  : pickerOpen
                  ? 'Hide coach list'
                  : 'Choose a coach to invite'}
              </button>
              {pickerOpen && (
                <div className="mt-2 border border-gray-200 rounded max-h-44 overflow-y-auto">
                  {inviteCandidates.map(c => (
                    <button
                      key={c.id}
                      disabled={busy}
                      onClick={() => submitInvite(c.id)}
                      className="w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 border-b border-gray-100 last:border-b-0 flex items-center justify-between disabled:opacity-50"
                    >
                      <span>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {c.email && <span className="text-gray-500 ml-1.5">{c.email}</span>}
                      </span>
                      <span className="text-[10px] text-blue-600">Invite</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-gray-200 text-right">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CollaboratorRow({
  collaborator,
  coachName,
  canManage,
  onRevoke,
  busy,
}: {
  collaborator: AthleteCollaborator;
  coachName: string;
  canManage: boolean;
  onRevoke: () => void;
  busy: boolean;
}) {
  const status = collaborator.revoked_at
    ? 'revoked'
    : collaborator.accepted_at
    ? 'accepted'
    : 'pending';

  return (
    <div className="px-3 py-2 flex items-center gap-2 text-xs text-gray-700 border-b border-gray-200 last:border-b-0">
      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-medium">
        {coachName.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
      </span>
      <span className="font-medium">{coachName}</span>
      <span className="text-[10px] text-gray-500">
        {collaborator.role === 'co_coach' ? 'co-coach' : 'viewer'}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {status === 'pending' && (
          <span className="text-[10px] text-amber-700 inline-flex items-center gap-1">
            <Clock size={10} /> pending
          </span>
        )}
        {status === 'accepted' && (
          <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1">
            <Check size={10} /> accepted
          </span>
        )}
        {status === 'revoked' && (
          <span className="text-[10px] text-gray-500 inline-flex items-center gap-1">
            <Slash size={10} /> revoked
          </span>
        )}
        {canManage && (
          <button
            onClick={onRevoke}
            disabled={busy}
            className="text-[10px] text-red-600 hover:underline disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </span>
    </div>
  );
}
