/**
 * Hooks for the club layer — organisations of coaches that own shared
 * exercise catalogues (and, later, more club-level configuration).
 *
 * Membership lifecycle mirrors athlete_collaborators / exercise_library_members
 * (invite / accept / decline / revoke on a join table) so the product keeps
 * one sharing idiom.
 *
 * Catalogue provisioning: club membership DRIVES catalogue access.
 *  - When a coach accepts a club invite, they get accepted memberships on all
 *    of the club's catalogues (admin → editor, coach → viewer).
 *  - When a catalogue is attached to (or created in) a club, every accepted
 *    club member is provisioned the same way.
 *  - Provisioning never overwrites an existing membership row — a custom role
 *    granted in the member × catalogue matrix survives.
 */
import { supabase } from '../lib/supabase';
import { invalidateLibraryScope } from '../lib/libraryScope';
import type {
  Club,
  ClubMember,
  ClubRole,
  CoachProfile,
  ExerciseLibrary,
  LibraryRole,
} from '../lib/database.types';

export interface ClubMemberWithCoach extends ClubMember {
  coach: Pick<CoachProfile, 'id' | 'name'> | null;
}

export interface ClubInviteWithContext extends ClubMember {
  club: Pick<Club, 'id' | 'name'> | null;
  inviter: Pick<CoachProfile, 'id' | 'name'> | null;
}

/** admin runs the shared tree; coach locks on read-only by default. */
export function defaultLibraryRoleFor(clubRole: ClubRole): LibraryRole {
  return clubRole === 'admin' ? 'editor' : 'viewer';
}

export function useClubs() {
  // ── Clubs & membership ────────────────────────────────────────────

  const listMyClubs = async (
    coachId: string,
  ): Promise<Array<{ club: Club; membership: ClubMember }>> => {
    const { data, error } = await supabase
      .from('club_members')
      .select('*, club:club_id(*)')
      .eq('coach_id', coachId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null);
    if (error) throw error;
    type Row = ClubMember & { club: Club | null };
    return ((data ?? []) as unknown as Row[])
      .filter(r => r.club != null)
      .map(r => ({ club: r.club as Club, membership: r }));
  };

  /** Create a club; the creator becomes an accepted admin. */
  const createClub = async (name: string, coachId: string): Promise<Club> => {
    const { data: club, error } = await supabase
      .from('clubs')
      .insert([{ name: name.trim(), created_by: coachId }])
      .select()
      .single();
    if (error) throw error;
    const { error: memberError } = await supabase.from('club_members').insert([{
      club_id: (club as Club).id,
      coach_id: coachId,
      role: 'admin',
      invited_by: coachId,
      accepted_at: new Date().toISOString(),
    }]);
    if (memberError) throw memberError;
    return club as Club;
  };

  const renameClub = async (clubId: string, name: string): Promise<void> => {
    const { error } = await supabase
      .from('clubs')
      .update({ name: name.trim() })
      .eq('id', clubId);
    if (error) throw error;
  };

  const listMembers = async (clubId: string): Promise<ClubMemberWithCoach[]> => {
    const { data, error } = await supabase
      .from('club_members')
      .select('*, coach:coach_id(id, name)')
      .eq('club_id', clubId)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ClubMemberWithCoach[];
  };

  const inviteCoach = async (params: {
    clubId: string;
    coachId: string;
    inviterId: string;
    role: ClubRole;
  }): Promise<void> => {
    const { error } = await supabase
      .from('club_members')
      .upsert(
        {
          club_id: params.clubId,
          coach_id: params.coachId,
          role: params.role,
          invited_by: params.inviterId,
          invited_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
        },
        { onConflict: 'club_id,coach_id' },
      );
    if (error) throw error;
  };

  const updateMemberRole = async (memberId: string, role: ClubRole): Promise<void> => {
    const { error } = await supabase
      .from('club_members')
      .update({ role })
      .eq('id', memberId);
    if (error) throw error;
  };

  /** Admin removes a member — or a member leaves (their own row). Catalogue
   *  memberships are left untouched: removing a coach from the club does not
   *  silently pull the shared tree from under their existing programmes.
   *  Catalogue access is revoked explicitly in the matrix if wanted. */
  const revokeMembership = async (memberId: string): Promise<void> => {
    const { error } = await supabase
      .from('club_members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', memberId);
    if (error) throw error;
  };

  const listPendingInvites = async (coachId: string): Promise<ClubInviteWithContext[]> => {
    const { data, error } = await supabase
      .from('club_members')
      .select('*, club:club_id(id, name), inviter:invited_by(id, name)')
      .eq('coach_id', coachId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ClubInviteWithContext[];
  };

  /** Accept a club invite, then provision access to the club's catalogues. */
  const acceptInvite = async (id: string): Promise<void> => {
    const { data: member, error } = await supabase
      .from('club_members')
      .update({ accepted_at: new Date().toISOString(), revoked_at: null })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const m = member as ClubMember;
    await provisionCoach(m.club_id, m.coach_id, m.role, m.invited_by);
    invalidateLibraryScope();
  };

  const declineInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('club_members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  };

  // ── Club catalogues ───────────────────────────────────────────────

  const listClubLibraries = async (clubId: string): Promise<ExerciseLibrary[]> => {
    const { data, error } = await supabase
      .from('exercise_libraries')
      .select('*')
      .eq('club_id', clubId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []) as ExerciseLibrary[];
  };

  /** Standalone club-kind catalogues the coach can attach (they are an
   *  accepted editor and the catalogue has no club yet). */
  const listAttachableLibraries = async (coachId: string): Promise<ExerciseLibrary[]> => {
    const { data, error } = await supabase
      .from('exercise_library_members')
      .select('role, library:library_id(*)')
      .eq('coach_id', coachId)
      .eq('role', 'editor')
      .not('accepted_at', 'is', null)
      .is('revoked_at', null);
    if (error) throw error;
    type Row = { role: LibraryRole; library: ExerciseLibrary | null };
    return ((data ?? []) as unknown as Row[])
      .map(r => r.library)
      .filter((l): l is ExerciseLibrary => l != null && l.kind === 'club' && l.club_id == null);
  };

  /** Attach an existing catalogue to the club and provision all members. */
  const attachLibrary = async (libraryId: string, clubId: string, actorId: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_libraries')
      .update({ club_id: clubId })
      .eq('id', libraryId);
    if (error) throw error;
    await provisionLibrary(libraryId, clubId, actorId);
    invalidateLibraryScope();
  };

  /** Detach a catalogue from the club. Existing catalogue memberships stay —
   *  detaching changes who MANAGES the catalogue, not who can see it. */
  const detachLibrary = async (libraryId: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_libraries')
      .update({ club_id: null })
      .eq('id', libraryId);
    if (error) throw error;
  };

  /** Create a catalogue inside the club and provision all members. */
  const createClubCatalogue = async (clubId: string, name: string, actorId: string): Promise<ExerciseLibrary> => {
    const { data: lib, error } = await supabase
      .from('exercise_libraries')
      .insert([{ name: name.trim(), kind: 'club', club_id: clubId }])
      .select()
      .single();
    if (error) throw error;
    await provisionLibrary((lib as ExerciseLibrary).id, clubId, actorId);
    invalidateLibraryScope();
    return lib as ExerciseLibrary;
  };

  // ── Member × catalogue access matrix ──────────────────────────────

  /** All membership rows across the club's catalogues, for the matrix. */
  const listCatalogueAccess = async (libraryIds: string[]) => {
    if (libraryIds.length === 0) return [];
    const { data, error } = await supabase
      .from('exercise_library_members')
      .select('id, library_id, coach_id, role, accepted_at, revoked_at')
      .in('library_id', libraryIds);
    if (error) throw error;
    return (data ?? []) as Array<{
      id: string; library_id: string; coach_id: string;
      role: LibraryRole; accepted_at: string | null; revoked_at: string | null;
    }>;
  };

  /** Set one matrix cell: editor / viewer / none. Grants are auto-accepted —
   *  the coach consented to catalogue provisioning by accepting the club
   *  invite; per-catalogue re-confirmation would be pure friction. */
  const setCatalogueRole = async (params: {
    libraryId: string;
    coachId: string;
    role: LibraryRole | 'none';
    actorId: string;
  }): Promise<void> => {
    if (params.role === 'none') {
      const { error } = await supabase
        .from('exercise_library_members')
        .update({ revoked_at: new Date().toISOString() })
        .eq('library_id', params.libraryId)
        .eq('coach_id', params.coachId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('exercise_library_members')
        .upsert(
          {
            library_id: params.libraryId,
            coach_id: params.coachId,
            role: params.role,
            invited_by: params.actorId,
            accepted_at: new Date().toISOString(),
            revoked_at: null,
          },
          { onConflict: 'library_id,coach_id' },
        );
      if (error) throw error;
    }
    invalidateLibraryScope();
  };

  // ── Provisioning internals ────────────────────────────────────────

  /** Give one coach access to every catalogue of a club (skip existing rows). */
  const provisionCoach = async (
    clubId: string,
    coachId: string,
    clubRole: ClubRole,
    actorId: string,
  ): Promise<void> => {
    const libraries = await listClubLibraries(clubId);
    if (libraries.length === 0) return;
    const existing = await listCatalogueAccess(libraries.map(l => l.id));
    const has = new Set(existing.filter(m => m.coach_id === coachId).map(m => m.library_id));
    const missing = libraries.filter(l => !has.has(l.id));
    if (missing.length === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('exercise_library_members').insert(
      missing.map(l => ({
        library_id: l.id,
        coach_id: coachId,
        role: defaultLibraryRoleFor(clubRole),
        invited_by: actorId,
        accepted_at: now,
      })),
    );
    if (error) throw error;
  };

  /** Give every accepted club member access to one catalogue (skip existing). */
  const provisionLibrary = async (
    libraryId: string,
    clubId: string,
    actorId: string,
  ): Promise<void> => {
    const members = await listMembers(clubId);
    const active = members.filter(m => m.accepted_at != null && m.revoked_at == null);
    if (active.length === 0) return;
    const existing = await listCatalogueAccess([libraryId]);
    const has = new Set(existing.map(m => m.coach_id));
    const missing = active.filter(m => !has.has(m.coach_id));
    if (missing.length === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('exercise_library_members').insert(
      missing.map(m => ({
        library_id: libraryId,
        coach_id: m.coach_id,
        role: defaultLibraryRoleFor(m.role),
        invited_by: actorId,
        accepted_at: now,
      })),
    );
    if (error) throw error;
  };

  return {
    listMyClubs,
    createClub,
    renameClub,
    listMembers,
    inviteCoach,
    updateMemberRole,
    revokeMembership,
    listPendingInvites,
    acceptInvite,
    declineInvite,
    listClubLibraries,
    listAttachableLibraries,
    attachLibrary,
    detachLibrary,
    createClubCatalogue,
    listCatalogueAccess,
    setCatalogueRole,
  };
}
