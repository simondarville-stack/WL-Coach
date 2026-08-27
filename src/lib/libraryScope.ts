/**
 * libraryScope — the single source of truth for which exercise catalogues
 * (exercise_libraries) a coach can SEE and which they can EDIT.
 *
 * Sits beside ownerContext.ts: owner resolution says whose *namespace* a
 * write lands in; library scope says which *catalogues* the exercise picker,
 * library screen and analysis read from. A coach's visible set is their own
 * personal library plus every club library they have accepted membership of;
 * their editable set is the personal library plus clubs where role='editor'
 * (viewers have "locked onto" the tree read-only).
 *
 * Every catalogue read (exercises / categories) must resolve its filter
 * through here rather than filtering on owner_id directly — club exercises
 * keep the owner_id of whoever created them, so owner filters go stale the
 * moment a catalogue is shared.
 */
import { supabase } from './supabase';
import type { LibraryRole } from './database.types';

export interface ClubMembership {
  libraryId: string;
  name: string;
  role: LibraryRole;
}

export interface CoachLibraryScope {
  coachId: string;
  /** False when the library tables are unreachable (e.g. migration gap) —
   *  callers fall back to the legacy owner_id filter. */
  available: boolean;
  personalLibraryId: string | null;
  clubs: ClubMembership[];
  /** Personal + accepted clubs — what this coach's catalogue reads span. */
  visibleLibraryIds: string[];
  /** Personal + clubs where the coach is an editor. */
  editableLibraryIds: string[];
}

const cache = new Map<string, Promise<CoachLibraryScope>>();

/** Drop cached scopes — call after any membership/library mutation. */
export function invalidateLibraryScope(coachId?: string): void {
  if (coachId) cache.delete(coachId);
  else cache.clear();
}

export function resolveLibraryScope(coachId: string): Promise<CoachLibraryScope> {
  let p = cache.get(coachId);
  if (!p) {
    p = fetchScope(coachId).catch(() => {
      cache.delete(coachId); // don't cache failures
      return unavailableScope(coachId);
    });
    cache.set(coachId, p);
  }
  return p;
}

function unavailableScope(coachId: string): CoachLibraryScope {
  return {
    coachId,
    available: false,
    personalLibraryId: null,
    clubs: [],
    visibleLibraryIds: [],
    editableLibraryIds: [],
  };
}

async function fetchScope(coachId: string): Promise<CoachLibraryScope> {
  const [personalRes, memberRes] = await Promise.all([
    supabase
      .from('exercise_libraries')
      .select('id')
      .eq('kind', 'personal')
      .eq('owner_coach_id', coachId)
      .maybeSingle(),
    supabase
      .from('exercise_library_members')
      .select('library_id, role, library:library_id(id, name, kind)')
      .eq('coach_id', coachId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null),
  ]);
  if (personalRes.error || memberRes.error) return unavailableScope(coachId);

  const personalLibraryId = personalRes.data?.id ?? null;
  const clubs: ClubMembership[] = [];
  type MemberRow = { library_id: string; role: LibraryRole; library: { id: string; name: string; kind: string } | null };
  for (const m of (memberRes.data ?? []) as unknown as MemberRow[]) {
    if (m.library?.kind === 'club') {
      clubs.push({ libraryId: m.library_id, name: m.library.name, role: m.role });
    }
  }

  const visible = [...(personalLibraryId ? [personalLibraryId] : []), ...clubs.map(c => c.libraryId)];
  const editable = [
    ...(personalLibraryId ? [personalLibraryId] : []),
    ...clubs.filter(c => c.role === 'editor').map(c => c.libraryId),
  ];
  return {
    coachId,
    available: true,
    personalLibraryId,
    clubs,
    visibleLibraryIds: visible,
    editableLibraryIds: editable,
  };
}

/**
 * PostgREST `.or()` expression selecting the catalogue rows visible to the
 * given coach(es): rows in any of their visible libraries, plus (defensively)
 * rows still missing a library_id that they own. Falls back to a plain
 * owner filter when library resolution is unavailable.
 *
 * Usage: `supabase.from('exercises').select(...).or(await catalogueOrFilter(ownerId))`
 */
export async function catalogueOrFilter(coachIds: string | string[]): Promise<string> {
  const ids = [...new Set(Array.isArray(coachIds) ? coachIds : [coachIds])];
  const ownerList = ids.join(',');
  const scopes = await Promise.all(ids.map(resolveLibraryScope));
  if (scopes.some(s => !s.available)) return `owner_id.in.(${ownerList})`;
  const libs = [...new Set(scopes.flatMap(s => s.visibleLibraryIds))];
  if (libs.length === 0) return `owner_id.in.(${ownerList})`;
  return `library_id.in.(${libs.join(',')}),and(owner_id.in.(${ownerList}),library_id.is.null)`;
}

/** Can this coach edit a catalogue row (exercise or category)?
 *  Editable = in one of their editable libraries; legacy rows without a
 *  library fall back to owner match. Club rows are read-only for viewers. */
export function canEditCatalogueRow(
  scope: CoachLibraryScope,
  row: { library_id: string | null; owner_id: string },
): boolean {
  if (!scope.available || row.library_id == null) return row.owner_id === scope.coachId;
  return scope.editableLibraryIds.includes(row.library_id);
}

/** Display label for the catalogue a row lives in: null for the coach's own
 *  personal library (no badge — badges must carry signal), the club name for
 *  club rows, "Shared" for another coach's personal library (host-context
 *  views on shared athletes). */
export function libraryLabelFor(
  scope: CoachLibraryScope,
  row: { library_id: string | null; owner_id: string },
): string | null {
  if (row.library_id == null || row.library_id === scope.personalLibraryId) return null;
  const club = scope.clubs.find(c => c.libraryId === row.library_id);
  if (club) return club.name;
  return row.owner_id === scope.coachId ? null : 'Shared';
}
