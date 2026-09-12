/**
 * ShareTargetModal — host-side UI to invite another coach to co-coach or view
 * an athlete or a training group.
 *
 * One component for both, because they were the same screen twice: 619 lines
 * across ShareAthleteModal and ShareGroupModal that differed only in which
 * collaborator hook they called, which FK the row carried (`athlete_id` vs
 * `group_id` — every other column is identical), and four strings of copy.
 * Four separate blocks of duplicated markup had already drifted apart in
 * wording by 0.108.2.
 *
 * What genuinely differs lives in COPY below, keyed by kind. The group variant
 * says more, and has to: sharing a group also grants access to its member
 * athletes (the group→athlete cascade in accessScope), and a co_coach can add
 * their own athletes to the group. The host should understand that blast
 * radius before inviting, so that callout is not boilerplate to be unified
 * away.
 */
import { useEffect, useState } from 'react';
import { UserPlus, Check, Clock, Slash } from 'lucide-react';
import type { CoachProfile, CollaboratorRole } from '../lib/database.types';
import { useCoachProfiles } from '../hooks/useCoachProfiles';
import { useAthleteCollaborators } from '../hooks/useAthleteCollaborators';
import { useTrainingGroupCollaborators } from '../hooks/useTrainingGroupCollaborators';
import { useCoachStore } from '../store/coachStore';
import { useAthleteStore } from '../store/athleteStore';
import { AdaptiveDialog } from './ui/AdaptiveDialog';
import { describeError } from '../lib/errorMessage';

export type ShareTargetKind = 'athlete' | 'group';

export interface ShareTarget {
  kind: ShareTargetKind;
  id: string;
  name: string;
  /** The host coach — only they can invite or revoke. */
  ownerId: string;
}

/**
 * The columns both collaborator tables share. Structural rather than a union,
 * so neither the row component nor the list logic has to know which table a
 * row came from.
 */
interface Collaborator {
  id: string;
  coach_id: string;
  role: CollaboratorRole;
  accepted_at: string | null;
  revoked_at: string | null;
}

const COPY: Record<ShareTargetKind, {
  subtitle: string;
  /** Extra warning above the invite controls. Group only. */
  cascade: string | null;
  inboxLabel: string;
  inbox: (name: string) => React.ReactNode;
}> = {
  athlete: {
    subtitle: 'Invite other coaches to co-coach or view this athlete.',
    cascade: null,
    inboxLabel: 'Inbox is shared',
    inbox: name => (
      <>
        <strong>Inbox is shared.</strong> Every message between you and {name} — general
        thread and session comments — is visible to the invited coach. New replies show
        the sender's name on each bubble so the athlete can see who wrote what.
      </>
    ),
  },
  group: {
    subtitle:
      'Co-coaches can edit the group programme and add their own athletes; viewers get read-only supervision.',
    cascade:
      'Sharing this group also grants access to its member athletes. A co-coach can add ' +
      'their own athletes into the group, which then become shared with you too.',
    inboxLabel: 'Inboxes are shared',
    inbox: () => (
      <>
        <strong>Athlete inboxes are shared.</strong> If a member athlete is also shared with
        this coach, their general thread and session comments are visible to both coaches.
        New replies show the sender's name so each athlete can see which coach wrote what.
      </>
    ),
  },
};

export function ShareTargetModal({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? null);
  const refreshAthletes = useAthleteStore(s => s.fetchAthletes);
  const { fetchCoaches } = useCoachProfiles();

  // Both hooks run every render — hooks cannot be called conditionally — and
  // the kind picks which one this modal actually drives. Neither fetches
  // anything until one of its functions is called.
  const athleteCollaborators = useAthleteCollaborators();
  const groupCollaborators = useTrainingGroupCollaborators();
  const api = target.kind === 'athlete' ? athleteCollaborators : groupCollaborators;

  const [coaches, setCoaches] = useState<CoachProfile[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [role, setRole] = useState<CollaboratorRole>('co_coach');
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[target.kind];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [allCoaches, existing] = await Promise.all([
          fetchCoaches(),
          api.listCollaboratorsFor(target.id),
        ]);
        if (cancelled) return;
        setCoaches(allCoaches);
        setCollaborators(existing);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      }
    })();
    return () => { cancelled = true; };
    // `api` and `fetchCoaches` are rebuilt every render by their hooks, so
    // depending on them would refetch forever. The target is what this load
    // actually keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, target.kind]);

  const isHost = activeCoachId === target.ownerId;

  // Coaches eligible to be invited: not the host, not already in an active
  // (non-revoked) relationship. Revoked rows still show in the list so the host
  // can re-invite by clicking through the picker.
  const activeCollaboratorIds = new Set(
    collaborators.filter(c => c.revoked_at == null).map(c => c.coach_id),
  );
  const inviteCandidates = coaches.filter(
    c => c.id !== target.ownerId && !activeCollaboratorIds.has(c.id),
  );

  const coachName = (id: string) => coaches.find(c => c.id === id)?.name ?? '(unknown coach)';

  const submitInvite = async (coachId: string) => {
    if (!activeCoachId) return;
    setBusy(true);
    setError(null);
    try {
      // The one shape difference between the two tables: which FK the invite
      // carries. Everything past this point is identical.
      const row = await (target.kind === 'athlete'
        ? athleteCollaborators.inviteCoach({ athleteId: target.id, coachId, inviterId: activeCoachId, role })
        : groupCollaborators.inviteCoach({ groupId: target.id, coachId, inviterId: activeCoachId, role }));
      // Optimistic local update — replace any existing row for this pair.
      setCollaborators(prev => [row, ...prev.filter(c => c.coach_id !== coachId)]);
      setPickerOpen(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitRevoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.revokeAccess(id);
      setCollaborators(prev =>
        prev.map(c => (c.id === id ? { ...c, revoked_at: new Date().toISOString() } : c)),
      );
      await refreshAthletes(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdaptiveDialog onClose={onClose} panel="bare" ariaLabel={`Share ${target.name}`}>
      <div className="bg-white rounded-xl shadow-xl w-[480px] max-w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Share {target.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {isHost ? copy.subtitle : 'Only the host coach can manage sharing.'}
          </p>
        </div>

        <div className="px-4 py-3 flex-1 overflow-y-auto space-y-3">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {copy.cascade && (
            <div className="text-[11px] text-[color:var(--color-accent)] bg-[var(--color-accent-subtle)] border border-[color:var(--color-accent-border)] rounded px-2.5 py-1.5">
              {copy.cascade}
            </div>
          )}

          <section>
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              People with access
            </h3>
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 flex items-center gap-2 text-xs text-gray-700 border-b border-gray-200">
                <Initials name={coachName(target.ownerId)} tone="accent" />
                <span className="font-medium">{coachName(target.ownerId)}</span>
                <span className="text-[10px] text-gray-500 ml-auto">Host</span>
              </div>
              {collaborators.length === 0 ? (
                <div className="px-3 py-2.5 text-xs text-gray-500 italic">No other coaches yet.</div>
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

          {isHost && (
            <section>
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Invite a coach
              </h3>
              <div className="flex items-start gap-2 mb-2 p-2 bg-[var(--color-accent-subtle)] border border-[color:var(--color-accent-border)] rounded text-[11px] text-[color:var(--color-accent)]">
                <input
                  type="checkbox"
                  checked
                  readOnly
                  className="mt-0.5 flex-shrink-0 accent-blue-600"
                  aria-label={copy.inboxLabel}
                />
                <span>{copy.inbox(target.name)}</span>
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
                          ? 'bg-[var(--color-accent-muted)] text-[color:var(--color-accent)] border-[color:var(--color-accent-border)]'
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
                      className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-accent-subtle)] border-b border-gray-100 last:border-b-0 flex items-center justify-between disabled:opacity-50"
                    >
                      <span>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {c.email && <span className="text-gray-500 ml-1.5">{c.email}</span>}
                      </span>
                      <span className="text-[10px] text-[color:var(--color-accent)]">Invite</span>
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
    </AdaptiveDialog>
  );
}

/** Up to two initials in a circle — the host row and every collaborator row. */
function Initials({ name, tone = 'plain' }: { name: string; tone?: 'plain' | 'accent' }) {
  const letters = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span
      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
        tone === 'accent'
          ? 'bg-[var(--color-accent-muted)] text-[color:var(--color-accent)]'
          : 'bg-gray-100 text-gray-600'
      }`}
    >
      {letters}
    </span>
  );
}

function CollaboratorRow({
  collaborator,
  coachName,
  canManage,
  onRevoke,
  busy,
}: {
  collaborator: Collaborator;
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
      <Initials name={coachName} />
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
