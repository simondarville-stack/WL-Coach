/**
 * Hooks for managing shared exercise catalogues (club libraries) and their
 * memberships. Mirrors useAthleteCollaborators so the product keeps one
 * sharing idiom: invite / accept / decline / revoke on a join table.
 *
 * Seeding: moving rows between libraries is a library_id update that KEEPS
 * the exercise ids, so every planned exercise, log row, PR and macro target
 * keeps pointing at the same rows — that id preservation is the entire point
 * of the shared catalogue (cross-coach analysis needs one id per lift).
 */
import { supabase } from '../lib/supabase';
import { invalidateLibraryScope } from '../lib/libraryScope';
import type {
  CoachProfile,
  ExerciseLibrary,
  ExerciseLibraryMember,
  LibraryRole,
} from '../lib/database.types';

export interface LibraryMemberWithCoach extends ExerciseLibraryMember {
  coach: Pick<CoachProfile, 'id' | 'name'> | null;
}

export interface LibraryInviteWithContext extends ExerciseLibraryMember {
  library: Pick<ExerciseLibrary, 'id' | 'name'> | null;
  inviter: Pick<CoachProfile, 'id' | 'name'> | null;
}

/* ---- Phase-3 adoption (adopt_exercise_library RPC) ---- */

export type AdoptAction = 'merge' | 'move' | 'keep';

export interface AdoptMappingEntry {
  source_id: string;
  action: AdoptAction;
  target_id?: string | null; // required for 'merge'
}

/** Slim exercise shape the adopt wizard matches on. */
export interface AdoptExercise {
  id: string;
  name: string;
  exercise_code: string | null;
  category: string;
  aliases: string[] | null;
}

/** Report returned by adopt_exercise_library — identical shape for the
 *  dry run and the real run. */
export interface AdoptReport {
  dry_run: boolean;
  merged: number;
  moved: number;
  kept: number;
  categories_created: number;
  references_repointed: number;
  references: Record<string, number>;
  conflicts_kept: Record<string, number>;
  parent_links_repointed: number;
  pr_references_repointed: number;
  parent_links_cleared: number;
}

export function useExerciseLibraries() {
  /** Club libraries the coach belongs to (accepted, not revoked), with role. */
  const listMyClubs = async (
    coachId: string,
  ): Promise<Array<{ library: ExerciseLibrary; membership: ExerciseLibraryMember }>> => {
    const { data, error } = await supabase
      .from('exercise_library_members')
      .select('*, library:library_id(*)')
      .eq('coach_id', coachId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null);
    if (error) throw error;
    type Row = ExerciseLibraryMember & { library: ExerciseLibrary | null };
    return ((data ?? []) as unknown as Row[])
      .filter(r => r.library?.kind === 'club')
      .map(r => ({ library: r.library as ExerciseLibrary, membership: r }));
  };

  /** Create a club catalogue; the creator becomes an accepted editor. */
  const createClubLibrary = async (name: string, coachId: string): Promise<ExerciseLibrary> => {
    const { data: lib, error } = await supabase
      .from('exercise_libraries')
      .insert([{ name: name.trim(), kind: 'club' }])
      .select()
      .single();
    if (error) throw error;
    const { error: memberError } = await supabase.from('exercise_library_members').insert([{
      library_id: (lib as ExerciseLibrary).id,
      coach_id: coachId,
      role: 'editor',
      invited_by: coachId,
      accepted_at: new Date().toISOString(),
    }]);
    if (memberError) throw memberError;
    invalidateLibraryScope();
    return lib as ExerciseLibrary;
  };

  const renameLibrary = async (libraryId: string, name: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_libraries')
      .update({ name: name.trim() })
      .eq('id', libraryId);
    if (error) throw error;
    invalidateLibraryScope();
  };

  /** Everyone with a membership row on this library (incl. pending/revoked). */
  const listMembers = async (libraryId: string): Promise<LibraryMemberWithCoach[]> => {
    const { data, error } = await supabase
      .from('exercise_library_members')
      .select('*, coach:coach_id(id, name)')
      .eq('library_id', libraryId)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as LibraryMemberWithCoach[];
  };

  const inviteCoach = async (params: {
    libraryId: string;
    coachId: string;
    inviterId: string;
    role: LibraryRole;
  }): Promise<void> => {
    // Upsert pattern (same as athlete sharing): a previously revoked row is
    // re-armed with a fresh invited_at instead of duplicated.
    const { error } = await supabase
      .from('exercise_library_members')
      .upsert(
        {
          library_id: params.libraryId,
          coach_id: params.coachId,
          role: params.role,
          invited_by: params.inviterId,
          invited_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
        },
        { onConflict: 'library_id,coach_id' },
      );
    if (error) throw error;
  };

  const updateMemberRole = async (memberId: string, role: LibraryRole): Promise<void> => {
    const { error } = await supabase
      .from('exercise_library_members')
      .update({ role })
      .eq('id', memberId);
    if (error) throw error;
    invalidateLibraryScope();
  };

  /** Pending catalogue invites for the active coach (Invitations page). */
  const listPendingInvites = async (coachId: string): Promise<LibraryInviteWithContext[]> => {
    const { data, error } = await supabase
      .from('exercise_library_members')
      .select('*, library:library_id(id, name), inviter:invited_by(id, name)')
      .eq('coach_id', coachId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('invited_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as LibraryInviteWithContext[];
  };

  const acceptInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_library_members')
      .update({ accepted_at: new Date().toISOString(), revoked_at: null })
      .eq('id', id);
    if (error) throw error;
    invalidateLibraryScope();
  };

  const declineInvite = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_library_members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    invalidateLibraryScope();
  };

  /** Revoke a member's access (editor action) — or leave, when it's your own row. */
  const revokeAccess = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('exercise_library_members')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    invalidateLibraryScope();
  };

  /** How many exercises/categories a seed from this library would move. */
  const countSeedable = async (fromLibraryId: string): Promise<{ exercises: number; categories: number }> => {
    const [ex, cat] = await Promise.all([
      supabase
        .from('exercises')
        .select('id', { count: 'exact', head: true })
        .eq('library_id', fromLibraryId)
        .neq('category', '— System'),
      supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('library_id', fromLibraryId)
        .neq('name', 'Unspecified')
        .not('name', 'ilike', '%system%'),
    ]);
    if (ex.error) throw ex.error;
    if (cat.error) throw cat.error;
    return { exercises: ex.count ?? 0, categories: cat.count ?? 0 };
  };

  /**
   * Seed a club catalogue by MOVING the coach's personal exercises and
   * categories into it (ids preserved — zero FK rewrites). System sentinels
   * (TEXT/VIDEO/IMAGE/GPP) and the per-coach "Unspecified" bucket stay
   * personal: they are per-coach infrastructure, not club vocabulary.
   */
  const seedFromLibrary = async (fromLibraryId: string, toLibraryId: string): Promise<void> => {
    const { error: exError } = await supabase
      .from('exercises')
      .update({ library_id: toLibraryId })
      .eq('library_id', fromLibraryId)
      .neq('category', '— System');
    if (exError) throw exError;
    const { error: catError } = await supabase
      .from('categories')
      .update({ library_id: toLibraryId })
      .eq('library_id', fromLibraryId)
      .neq('name', 'Unspecified')
      .not('name', 'ilike', '%system%');
    if (catError) throw catError;
    invalidateLibraryScope();
  };

  /** Active non-system exercises of the source (personal) and target (club)
   *  libraries — the adopt wizard's matching inputs. */
  const fetchAdoptCandidates = async (
    personalLibraryId: string,
    targetLibraryId: string,
  ): Promise<{ source: AdoptExercise[]; target: AdoptExercise[] }> => {
    const fetchFor = async (libraryId: string): Promise<AdoptExercise[]> => {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, exercise_code, category, aliases')
        .eq('library_id', libraryId)
        .eq('is_archived', false)
        .neq('category', '— System')
        .order('category')
        .order('name');
      if (error) throw error;
      return (data ?? []) as AdoptExercise[];
    };
    const [source, target] = await Promise.all([fetchFor(personalLibraryId), fetchFor(targetLibraryId)]);
    return { source, target };
  };

  /** Run the adoption (or its dry run). One transaction server-side; the
   *  report is identical either way, so the wizard previews exactly what
   *  the confirm will do. */
  const adoptLibrary = async (params: {
    fromLibraryId: string;
    toLibraryId: string;
    mapping: AdoptMappingEntry[];
    dryRun: boolean;
  }): Promise<AdoptReport> => {
    const { data, error } = await supabase.rpc('adopt_exercise_library', {
      p_from: params.fromLibraryId,
      p_to: params.toLibraryId,
      p_mapping: params.mapping,
      p_dry_run: params.dryRun,
    });
    if (error) throw error;
    if (!params.dryRun) invalidateLibraryScope();
    return data as unknown as AdoptReport;
  };

  return {
    listMyClubs,
    createClubLibrary,
    renameLibrary,
    listMembers,
    inviteCoach,
    updateMemberRole,
    listPendingInvites,
    acceptInvite,
    declineInvite,
    revokeAccess,
    countSeedable,
    seedFromLibrary,
    fetchAdoptCandidates,
    adoptLibrary,
  };
}
