/**
 * CatalogueSharingModal — manage shared exercise catalogues (club libraries).
 *
 * The "lock onto another coach's tree" flow lives here:
 *   1. The head coach creates a club catalogue and seeds it from their
 *      personal library (id-preserving move — zero history rewrites).
 *   2. They invite the other coaches: editors shape the tree, viewers get a
 *      read-only lock on it.
 *   3. Invitees accept on the Invitations page; from then on every member
 *      plans against the same exercise ids, so cross-coach analysis works.
 */
import { useCallback, useEffect, useState } from 'react';
import { X, Plus, BookOpen, Send, ShieldCheck, Eye, LogOut, ArrowRightLeft, RefreshCw } from 'lucide-react';
import { useCoachStore } from '../../store/coachStore';
import { useCoachProfiles } from '../../hooks/useCoachProfiles';
import { useExerciseLibraries, type LibraryMemberWithCoach } from '../../hooks/useExerciseLibraries';
import { resolveLibraryScope, invalidateLibraryScope, type CoachLibraryScope } from '../../lib/libraryScope';
import { Button } from '../ui';
import type { CoachProfile, ExerciseLibrary, ExerciseLibraryMember, LibraryRole } from '../../lib/database.types';

interface CatalogueSharingModalProps {
  onClose: () => void;
  /** Called after any change that alters the visible catalogue set, so the
   *  library screen refetches. */
  onChanged: () => void;
}

type ClubEntry = { library: ExerciseLibrary; membership: ExerciseLibraryMember };

export function CatalogueSharingModal({ onClose, onChanged }: CatalogueSharingModalProps) {
  const activeCoach = useCoachStore(s => s.activeCoach);
  const coachId = activeCoach?.id ?? '00000000-0000-0000-0000-000000000001';

  const libs = useExerciseLibraries();
  const { fetchCoaches } = useCoachProfiles();

  const [clubs, setClubs] = useState<ClubEntry[] | null>(null);
  const [scope, setScope] = useState<CoachLibraryScope | null>(null);
  const [coaches, setCoaches] = useState<CoachProfile[]>([]);
  const [membersByLibrary, setMembersByLibrary] = useState<Record<string, LibraryMemberWithCoach[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form
  const [newName, setNewName] = useState('');
  // Invite form state per library
  const [inviteCoachId, setInviteCoachId] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState<Record<string, LibraryRole>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      invalidateLibraryScope(coachId);
      const [myClubs, myScope, allCoaches] = await Promise.all([
        libs.listMyClubs(coachId),
        resolveLibraryScope(coachId),
        fetchCoaches(),
      ]);
      setClubs(myClubs);
      setScope(myScope);
      setCoaches(allCoaches);
      const memberLists = await Promise.all(myClubs.map(c => libs.listMembers(c.library.id)));
      const map: Record<string, LibraryMemberWithCoach[]> = {};
      myClubs.forEach((c, i) => { map[c.library.id] = memberLists[i]; });
      setMembersByLibrary(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalogues');
    }
  }, [coachId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      await libs.createClubLibrary(name, coachId);
      setNewName('');
    });
  };

  const handleSeed = async (club: ClubEntry) => {
    const personalId = scope?.personalLibraryId;
    if (!personalId) { setError('No personal library found'); return; }
    try {
      const counts = await libs.countSeedable(personalId);
      if (counts.exercises === 0 && counts.categories === 0) {
        setError('Your personal library is empty — nothing to move');
        return;
      }
      const ok = window.confirm(
        `Move ${counts.exercises} exercises and ${counts.categories} categories from your personal library into "${club.library.name}"?\n\n` +
        'Exercise ids are preserved, so all planned and logged history follows them. ' +
        'Every member of the catalogue will see (and editors can change) these exercises.',
      );
      if (!ok) return;
      void run(() => libs.seedFromLibrary(personalId, club.library.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to prepare seeding');
    }
  };

  const handleInvite = (club: ClubEntry) => {
    const target = inviteCoachId[club.library.id];
    if (!target) return;
    void run(async () => {
      await libs.inviteCoach({
        libraryId: club.library.id,
        coachId: target,
        inviterId: coachId,
        role: inviteRole[club.library.id] ?? 'viewer',
      });
      setInviteCoachId(prev => ({ ...prev, [club.library.id]: '' }));
    });
  };

  const roleLabel = (role: LibraryRole) => (role === 'editor' ? 'Editor' : 'Viewer');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 px-5 py-3 flex items-center justify-between"
          style={{ background: 'var(--color-bg-primary)', borderBottom: '0.5px solid var(--color-border-secondary)', zIndex: 1 }}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Catalogue sharing
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => void load()} className="p-1.5 rounded hover:bg-gray-100" title="Refresh">
              <RefreshCw size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" title="Close">
              <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', margin: 0 }}>
            A club catalogue is a shared exercise tree. Editors shape it; viewers lock onto it read-only.
            All members plan against the same exercise ids, so their athletes' data is comparable in Analysis.
            Exercises outside a club catalogue stay personal and private to you.
          </p>

          {error && (
            <div style={{
              fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)',
              background: 'var(--color-danger-bg, #fef2f2)', border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)', padding: '8px 10px',
            }}>
              {error}
            </div>
          )}

          {clubs === null && !error && (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>Loading…</div>
          )}

          {/* Club catalogues */}
          {(clubs ?? []).map(club => {
            const isEditor = club.membership.role === 'editor';
            const members = membersByLibrary[club.library.id] ?? [];
            const activeMembers = members.filter(m => m.revoked_at == null);
            const memberCoachIds = new Set(activeMembers.map(m => m.coach_id));
            const invitableCoaches = coaches.filter(c => !memberCoachIds.has(c.id));
            return (
              <div
                key={club.library.id}
                style={{ border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2"
                  style={{ background: 'var(--color-bg-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}
                >
                  {isEditor ? <ShieldCheck size={13} style={{ color: 'var(--color-accent)' }} /> : <Eye size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
                  <span style={{ fontSize: 'var(--text-label)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {club.library.name}
                  </span>
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                    · you are {roleLabel(club.membership.role).toLowerCase()}
                    {!isEditor && ' (read-only)'}
                  </span>
                  {club.library.club_id && (
                    <span
                      title="This catalogue belongs to a club — membership is managed on the Club page"
                      style={{
                        fontSize: 'var(--text-caption)', color: 'var(--color-accent)',
                        background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-tertiary)',
                        padding: '0 6px', borderRadius: 999, whiteSpace: 'nowrap',
                      }}
                    >
                      club-managed
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  {isEditor && (
                    <button
                      onClick={() => void handleSeed(club)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white"
                      style={{ fontSize: 'var(--text-caption)', color: 'var(--color-accent)', border: 'none', background: 'none', cursor: 'pointer' }}
                      title="Move your personal exercises into this catalogue (ids preserved)"
                    >
                      <ArrowRightLeft size={11} /> Seed from my library
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (window.confirm(`Leave "${club.library.name}"? Your own athletes' plans keep referencing its exercises, but you will no longer see the catalogue.`)) {
                        void run(() => libs.revokeAccess(club.membership.id));
                      }
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white"
                    style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', border: 'none', background: 'none', cursor: 'pointer' }}
                  >
                    <LogOut size={11} /> Leave
                  </button>
                </div>

                {/* Members */}
                <div className="px-3 py-2 space-y-1">
                  {activeMembers.map(m => (
                    <div key={m.id} className="flex items-center gap-2" style={{ fontSize: 'var(--text-label)' }}>
                      <span style={{ color: 'var(--color-text-primary)' }}>{m.coach?.name ?? 'Unknown coach'}</span>
                      {m.accepted_at == null && (
                        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>invited, pending</span>
                      )}
                      <span style={{ flex: 1 }} />
                      {isEditor && m.coach_id !== coachId ? (
                        <>
                          <select
                            value={m.role}
                            onChange={e => void run(() => libs.updateMemberRole(m.id, e.target.value as LibraryRole))}
                            disabled={busy}
                            style={{
                              fontSize: 'var(--text-caption)', padding: '1px 4px',
                              border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                              background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)',
                            }}
                          >
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          <button
                            onClick={() => {
                              if (window.confirm(`Remove ${m.coach?.name ?? 'this coach'} from "${club.library.name}"?`)) {
                                void run(() => libs.revokeAccess(m.id));
                              }
                            }}
                            disabled={busy}
                            style={{ fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)', border: 'none', background: 'none', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>{roleLabel(m.role)}</span>
                      )}
                    </div>
                  ))}

                  {/* Invite */}
                  {isEditor && invitableCoaches.length > 0 && (
                    <div className="flex items-center gap-2 pt-1.5" style={{ borderTop: '0.5px dashed var(--color-border-tertiary)' }}>
                      <select
                        value={inviteCoachId[club.library.id] ?? ''}
                        onChange={e => setInviteCoachId(prev => ({ ...prev, [club.library.id]: e.target.value }))}
                        style={{
                          flex: 1, fontSize: 'var(--text-caption)', padding: '3px 6px',
                          border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                        }}
                      >
                        <option value="">Invite a coach…</option>
                        {invitableCoaches.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <select
                        value={inviteRole[club.library.id] ?? 'viewer'}
                        onChange={e => setInviteRole(prev => ({ ...prev, [club.library.id]: e.target.value as LibraryRole }))}
                        style={{
                          fontSize: 'var(--text-caption)', padding: '3px 6px',
                          border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                        }}
                      >
                        <option value="viewer">Viewer (read-only)</option>
                        <option value="editor">Editor</option>
                      </select>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Send size={11} />}
                        disabled={busy || !inviteCoachId[club.library.id]}
                        onClick={() => handleInvite(club)}
                      >
                        Invite
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {clubs !== null && clubs.length === 0 && (
            <div
              style={{
                fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                border: '1px dashed var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
                padding: '14px 12px', textAlign: 'center',
              }}
            >
              No shared catalogue yet. Create one below, seed it from your library, then invite the other coaches.
            </div>
          )}

          {/* Create */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="New club catalogue name (e.g. BVK)"
              style={{
                flex: 1, fontSize: 'var(--text-label)', padding: '6px 10px',
                border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
              }}
            />
            <Button variant="primary" size="sm" icon={<Plus size={12} />} disabled={busy || !newName.trim()} onClick={handleCreate}>
              Create catalogue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
