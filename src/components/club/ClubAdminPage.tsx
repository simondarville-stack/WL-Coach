/**
 * ClubAdminPage (/club) — the club layer's admin surface.
 *
 * A club is an organisation of coaches. This page is where club-level
 * configuration lives: members (admin/coach roles, invites) and the club's
 * shared exercise catalogues, managed as one dense member × catalogue role
 * matrix — built for a head coach or org admin running many coaches.
 *
 * Access rules: club admins edit everything here; club coaches see a
 * read-only view. Joining a club auto-provisions catalogue access
 * (admin → editor, coach → viewer); the matrix overrides per cell.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Plus, Send, Pencil, Check, X, LogOut, ArrowRightLeft, Link2, Unlink, GitMerge,
} from 'lucide-react';
import { AdoptLibraryWizard } from '../exercise-library/AdoptLibraryWizard';
import { supabase } from '../../lib/supabase';
import { useCoachStore } from '../../store/coachStore';
import { useExerciseStore } from '../../store/exerciseStore';
import { useCoachProfiles } from '../../hooks/useCoachProfiles';
import { useClubs, type ClubMemberWithCoach } from '../../hooks/useClubs';
import { useExerciseLibraries } from '../../hooks/useExerciseLibraries';
import { resolveLibraryScope, invalidateLibraryScope } from '../../lib/libraryScope';
import { Button, confirmDialog } from '../ui';
import type {
  Club, ClubMember, ClubRole, CoachProfile, ExerciseLibrary, LibraryRole,
} from '../../lib/database.types';

type AccessRow = {
  id: string; library_id: string; coach_id: string;
  role: LibraryRole; accepted_at: string | null; revoked_at: string | null;
};

const cellSelect: React.CSSProperties = {
  fontSize: 'var(--text-caption)', padding: '2px 4px',
  border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
};

const th: React.CSSProperties = {
  fontSize: 'var(--text-caption)', fontWeight: 500, color: 'var(--color-text-secondary)',
  textAlign: 'left', padding: '6px 10px', borderBottom: '0.5px solid var(--color-border-secondary)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  fontSize: 'var(--text-label)', color: 'var(--color-text-primary)',
  padding: '5px 10px', borderBottom: '0.5px solid var(--color-border-tertiary)',
  whiteSpace: 'nowrap',
};

export function ClubAdminPage() {
  const activeCoachId = useCoachStore(s => s.activeCoach?.id ?? '00000000-0000-0000-0000-000000000001');
  const invalidateExerciseCache = useExerciseStore(s => s.invalidate);
  const clubs = useClubs();
  const libs = useExerciseLibraries();
  const { fetchCoaches } = useCoachProfiles();

  const [myClubs, setMyClubs] = useState<Array<{ club: Club; membership: ClubMember }> | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [members, setMembers] = useState<ClubMemberWithCoach[]>([]);
  const [catalogues, setCatalogues] = useState<ExerciseLibrary[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [exerciseCounts, setExerciseCounts] = useState<Record<string, number>>({});
  const [attachable, setAttachable] = useState<ExerciseLibrary[]>([]);
  const [coaches, setCoaches] = useState<CoachProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newClubName, setNewClubName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<ExerciseLibrary | null>(null);
  const [inviteCoachId, setInviteCoachId] = useState('');
  const [inviteRole, setInviteRole] = useState<ClubRole>('coach');
  const [newCatalogueName, setNewCatalogueName] = useState('');
  const [attachId, setAttachId] = useState('');

  const selected = myClubs?.find(c => c.club.id === selectedClubId) ?? null;
  const isAdmin = selected?.membership.role === 'admin';

  const loadClubs = useCallback(async () => {
    setError(null);
    try {
      const [list, allCoaches] = await Promise.all([
        clubs.listMyClubs(activeCoachId),
        fetchCoaches(),
      ]);
      setMyClubs(list);
      setCoaches(allCoaches);
      setSelectedClubId(prev =>
        prev && list.some(c => c.club.id === prev) ? prev : list[0]?.club.id ?? null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load clubs. Check your connection and try again.');
    }
  }, [activeCoachId]);

  const loadClubDetail = useCallback(async () => {
    if (!selectedClubId) {
      setMembers([]); setCatalogues([]); setAccess([]); setAttachable([]);
      return;
    }
    setError(null);
    try {
      const [memberList, catalogueList, attachableList] = await Promise.all([
        clubs.listMembers(selectedClubId),
        clubs.listClubLibraries(selectedClubId),
        clubs.listAttachableLibraries(activeCoachId),
      ]);
      const [accessRows, counts] = await Promise.all([
        clubs.listCatalogueAccess(catalogueList.map(c => c.id)),
        Promise.all(catalogueList.map(async c => {
          const { count } = await supabase
            .from('exercises')
            .select('id', { count: 'exact', head: true })
            .eq('library_id', c.id)
            .eq('is_archived', false);
          return [c.id, count ?? 0] as const;
        })),
      ]);
      setMembers(memberList);
      setCatalogues(catalogueList);
      setAccess(accessRows as AccessRow[]);
      setExerciseCounts(Object.fromEntries(counts));
      setAttachable(attachableList);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load club. Check your connection and try again.');
    }
  }, [selectedClubId, activeCoachId]);

  useEffect(() => { void loadClubs(); }, [loadClubs]);
  useEffect(() => { void loadClubDetail(); }, [loadClubDetail]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      invalidateExerciseCache();
      await Promise.all([loadClubs(), loadClubDetail()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t go through. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const activeMembers = useMemo(
    () => members.filter(m => m.revoked_at == null),
    [members],
  );
  const memberCoachIds = useMemo(() => new Set(activeMembers.map(m => m.coach_id)), [activeMembers]);
  const invitableCoaches = coaches.filter(c => !memberCoachIds.has(c.id));

  const cellFor = (coachId: string, libraryId: string): AccessRow | null =>
    access.find(a => a.coach_id === coachId && a.library_id === libraryId && a.revoked_at == null) ?? null;

  const handleSeed = async (catalogue: ExerciseLibrary) => {
    try {
      const scope = await resolveLibraryScope(activeCoachId);
      if (!scope.personalLibraryId) { setError('No personal library found'); return; }
      const counts = await libs.countSeedable(scope.personalLibraryId);
      if (counts.exercises === 0 && counts.categories === 0) {
        setError('Your personal library is empty — nothing to move');
        return;
      }
      const ok = await confirmDialog({
        title: `Move ${counts.exercises} exercises and ${counts.categories} categories into "${catalogue.name}"?`,
        message: 'They leave your personal library. Exercise ids are preserved, so all planned and logged history follows them.',
        confirmLabel: 'Move catalogue',
      });
      if (!ok) return;
      const personalId = scope.personalLibraryId;
      void run(async () => {
        await libs.seedFromLibrary(personalId, catalogue.id);
        invalidateLibraryScope();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t prepare seeding. Nothing was changed.');
    }
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Building2 size={18} style={{ color: 'var(--color-accent)' }} />
        <h1 style={{ fontSize: 'var(--text-title, 18px)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Club</h1>
        {myClubs && myClubs.length > 1 && (
          <select
            value={selectedClubId ?? ''}
            onChange={e => setSelectedClubId(e.target.value || null)}
            style={{ ...cellSelect, padding: '3px 8px' }}
          >
            {myClubs.map(c => (
              <option key={c.club.id} value={c.club.id}>{c.club.name}</option>
            ))}
          </select>
        )}
      </div>
      <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
        Organisation-level configuration: which coaches belong to the club, and who can edit or view
        each shared exercise catalogue. Admins manage; coaches see a read-only view.
      </p>

      {error && (
        <div style={{
          fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)',
          background: 'var(--color-danger-bg, #fef2f2)', border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {myClubs === null && !error && (
        <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>Loading…</div>
      )}

      {/* ── Selected club ── */}
      {selected && (
        <div style={{ border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)', marginBottom: 20, overflow: 'hidden' }}>
          {/* Club header */}
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: 'var(--color-bg-secondary)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}
          >
            {editingName !== null ? (
              <>
                <input
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  autoFocus
                  style={{ ...cellSelect, fontSize: 'var(--text-label)', padding: '3px 8px', minWidth: 200 }}
                />
                <button
                  onClick={() => {
                    const name = editingName.trim();
                    setEditingName(null);
                    if (name && name !== selected.club.name) void run(() => clubs.renameClub(selected.club.id, name));
                  }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}
                >
                  <Check size={14} style={{ color: 'var(--color-success-text, #047857)' }} />
                </button>
                <button onClick={() => setEditingName(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}>
                  <X size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {selected.club.name}
                </span>
                {isAdmin && (
                  <button onClick={() => setEditingName(selected.club.name)} title="Rename club" style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }}>
                    <Pencil size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                  </button>
                )}
              </>
            )}
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              · you are {selected.membership.role}
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `Leave "${selected.club.name}"?`,
                  message: 'Your catalogue access stays until an admin revokes it.',
                  confirmLabel: 'Leave club',
                  tone: 'danger',
                });
                if (ok) void run(() => clubs.revokeMembership(selected.membership.id));
              }}
              disabled={busy}
              className="inline-flex items-center gap-1"
              style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', border: 'none', background: 'none', cursor: 'pointer' }}
            >
              <LogOut size={11} /> Leave
            </button>
          </div>

          {/* Catalogue toolbar */}
          <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Catalogues
            </span>
            {catalogues.length === 0 && (
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                none yet — create one, or attach an existing shared catalogue
              </span>
            )}
            <span style={{ flex: 1 }} />
            {isAdmin && (
              <>
                {attachable.length > 0 && (
                  <>
                    <select value={attachId} onChange={e => setAttachId(e.target.value)} style={cellSelect}>
                      <option value="">Attach existing…</option>
                      {attachable.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <Button
                      variant="secondary" size="sm" icon={<Link2 size={11} />}
                      disabled={busy || !attachId}
                      onClick={() => { const id = attachId; setAttachId(''); void run(() => clubs.attachLibrary(id, selected.club.id, activeCoachId)); }}
                    >
                      Attach
                    </Button>
                  </>
                )}
                <input
                  value={newCatalogueName}
                  onChange={e => setNewCatalogueName(e.target.value)}
                  placeholder="New catalogue name"
                  style={{ ...cellSelect, padding: '3px 8px', width: 160 }}
                />
                <Button
                  variant="secondary" size="sm" icon={<Plus size={11} />}
                  disabled={busy || !newCatalogueName.trim()}
                  onClick={() => {
                    const name = newCatalogueName.trim();
                    setNewCatalogueName('');
                    void run(async () => { await clubs.createClubCatalogue(selected.club.id, name, activeCoachId); });
                  }}
                >
                  New catalogue
                </Button>
              </>
            )}
          </div>

          {/* Member × catalogue matrix */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Coach</th>
                  <th style={th}>Club role</th>
                  {catalogues.map(cat => {
                    const myCatalogueRole = cellFor(activeCoachId, cat.id)?.role ?? null;
                    const iAmEditor = myCatalogueRole === 'editor';
                    return (
                      <th key={cat.id} style={th}>
                        <span>{cat.name}</span>
                        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 5, fontFamily: 'var(--font-mono)' }}>
                          {exerciseCounts[cat.id] ?? 0}
                        </span>
                        {myCatalogueRole && (
                          <button
                            onClick={() => setAdoptTarget(cat)}
                            disabled={busy}
                            title="Adopt my library — match my personal exercises against this catalogue and fold them in"
                            style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 4, verticalAlign: 'middle' }}
                          >
                            <GitMerge size={11} style={{ color: 'var(--color-accent)' }} />
                          </button>
                        )}
                        {iAmEditor && (
                          <button
                            onClick={() => void handleSeed(cat)}
                            disabled={busy}
                            title="Move your personal exercises into this catalogue (ids preserved)"
                            style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 4, verticalAlign: 'middle' }}
                          >
                            <ArrowRightLeft size={11} style={{ color: 'var(--color-accent)' }} />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={async () => {
                              const ok = await confirmDialog({
                                title: `Detach "${cat.name}" from the club?`,
                                message: 'Existing access stays; the catalogue just stops being club-managed.',
                                confirmLabel: 'Detach catalogue',
                                tone: 'danger',
                              });
                              if (ok) void run(() => clubs.detachLibrary(cat.id));
                            }}
                            disabled={busy}
                            title="Detach from club"
                            style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 2, verticalAlign: 'middle' }}
                          >
                            <Unlink size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                          </button>
                        )}
                      </th>
                    );
                  })}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {activeMembers.map(m => {
                  const pending = m.accepted_at == null;
                  const isSelf = m.coach_id === activeCoachId;
                  return (
                    <tr key={m.id}>
                      <td style={td}>
                        {m.coach?.name ?? 'Unknown coach'}
                        {pending && (
                          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', marginLeft: 6 }}>
                            invited, pending
                          </span>
                        )}
                      </td>
                      <td style={td}>
                        {isAdmin && !isSelf ? (
                          <select
                            value={m.role}
                            disabled={busy}
                            onChange={e => void run(() => clubs.updateMemberRole(m.id, e.target.value as ClubRole))}
                            style={cellSelect}
                          >
                            <option value="admin">Admin</option>
                            <option value="coach">Coach</option>
                          </select>
                        ) : (
                          <span style={{ color: 'var(--color-text-secondary)' }}>{m.role === 'admin' ? 'Admin' : 'Coach'}</span>
                        )}
                      </td>
                      {catalogues.map(cat => {
                        const cell = cellFor(m.coach_id, cat.id);
                        return (
                          <td key={cat.id} style={td}>
                            {isAdmin && !pending ? (
                              <select
                                value={cell?.role ?? 'none'}
                                disabled={busy}
                                onChange={e => void run(() => clubs.setCatalogueRole({
                                  libraryId: cat.id,
                                  coachId: m.coach_id,
                                  role: e.target.value as LibraryRole | 'none',
                                  actorId: activeCoachId,
                                }))}
                                style={cellSelect}
                              >
                                <option value="editor">Editor</option>
                                <option value="viewer">Viewer</option>
                                <option value="none">—</option>
                              </select>
                            ) : (
                              <span style={{ color: 'var(--color-text-secondary)' }}>
                                {pending ? '· on accept' : cell ? (cell.role === 'editor' ? 'Editor' : 'Viewer') : '—'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ ...td, textAlign: 'right' }}>
                        {isAdmin && !isSelf && (
                          <button
                            onClick={async () => {
                              const ok = await confirmDialog({
                                title: `Remove ${m.coach?.name ?? 'this coach'} from "${selected.club.name}"?`,
                                message: 'Their catalogue access stays until revoked in the matrix.',
                                confirmLabel: 'Remove coach',
                                tone: 'danger',
                              });
                              if (ok) void run(() => clubs.revokeMembership(m.id));
                            }}
                            disabled={busy}
                            style={{ fontSize: 'var(--text-caption)', color: 'var(--color-danger-text, #b91c1c)', border: 'none', background: 'none', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Invite row */}
          {isAdmin && invitableCoaches.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderTop: '0.5px dashed var(--color-border-tertiary)' }}>
              <select value={inviteCoachId} onChange={e => setInviteCoachId(e.target.value)} style={{ ...cellSelect, flex: 1, maxWidth: 260, padding: '3px 8px' }}>
                <option value="">Invite a coach…</option>
                {invitableCoaches.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as ClubRole)} style={{ ...cellSelect, padding: '3px 8px' }}>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
              <Button
                variant="secondary" size="sm" icon={<Send size={11} />}
                disabled={busy || !inviteCoachId}
                onClick={() => {
                  const target = inviteCoachId;
                  setInviteCoachId('');
                  void run(() => clubs.inviteCoach({ clubId: selected.club.id, coachId: target, inviterId: activeCoachId, role: inviteRole }));
                }}
              >
                Invite
              </Button>
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                On accepting, coaches get {`viewer`} access to every club catalogue (admins get editor); adjust per cell above.
              </span>
            </div>
          )}
        </div>
      )}

      {myClubs !== null && myClubs.length === 0 && (
        <div
          style={{
            fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
            border: '1px dashed var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
            padding: '18px 14px', textAlign: 'center', marginBottom: 16,
          }}
        >
          You are not in a club yet. Create one below and invite your coaches — or wait for an
          invitation (they appear under Invitations).
        </div>
      )}

      {/* Create club */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newClubName}
          onChange={e => setNewClubName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newClubName.trim()) {
              const name = newClubName.trim();
              setNewClubName('');
              void run(async () => { await clubs.createClub(name, activeCoachId); });
            }
          }}
          placeholder="New club name (e.g. BVK)"
          style={{ ...cellSelect, flex: 1, maxWidth: 320, fontSize: 'var(--text-label)', padding: '6px 10px' }}
        />
        <Button
          variant="primary" size="sm" icon={<Plus size={12} />}
          disabled={busy || !newClubName.trim()}
          onClick={() => {
            const name = newClubName.trim();
            setNewClubName('');
            void run(async () => { await clubs.createClub(name, activeCoachId); });
          }}
        >
          Create club
        </Button>
      </div>

      {adoptTarget && (
        <AdoptLibraryWizard
          targetLibrary={{ id: adoptTarget.id, name: adoptTarget.name }}
          isEditor={cellFor(activeCoachId, adoptTarget.id)?.role === 'editor'}
          onClose={() => setAdoptTarget(null)}
          onComplete={() => {
            invalidateExerciseCache();
            void loadClubDetail();
          }}
        />
      )}
    </div>
  );
}

export default ClubAdminPage;
