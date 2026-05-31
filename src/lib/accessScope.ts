/**
 * accessScope — the single source of truth for "which athletes and groups
 * can the active coach see and act on", accounting for coach-to-coach
 * sharing.
 *
 * A coach's accessible athletes are the union of:
 *   1. Athletes they own (athletes.owner_id = coachId).
 *   2. Athletes shared directly via athlete_collaborators (accepted,
 *      not revoked).
 *   3. Athletes who are members of any group the coach can access —
 *      the group→athlete cascade. Sharing a group grants access to its
 *      members so two coaches can build one group programme and each
 *      bring their own athletes into it.
 *
 * Each athlete gets an effective access role (owned > co_coach > viewer)
 * resolved as the best role across all paths. Group ownership / co-coach
 * grants co_coach on the group's non-owned members; a viewer-shared group
 * grants viewer (head-coach supervision).
 *
 * Every coach-facing list query (dashboard, planner, selectors, macro)
 * MUST resolve its scope through here rather than filtering on owner_id
 * directly — otherwise shared athletes silently vanish from that screen.
 *
 * All queries degrade gracefully: if the collaborator tables don't exist
 * yet (migration unapplied) the shared paths contribute nothing and the
 * coach just sees their owned set, exactly as before sharing existed.
 */
import { supabase } from './supabase';
import type { Athlete, TrainingGroup, CollaboratorRole } from './database.types';

/** How the active coach can access an athlete or group. */
export type AccessRole = 'owned' | CollaboratorRole;

const ROLE_RANK: Record<AccessRole, number> = { owned: 3, co_coach: 2, viewer: 1 };

/** Keep whichever role grants more, so multiple access paths don't downgrade. */
function bestRole(a: AccessRole | undefined, b: AccessRole): AccessRole {
  if (!a) return b;
  return ROLE_RANK[b] > ROLE_RANK[a] ? b : a;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

/** Resolve group_id → access role for every group the coach can act on. */
export async function resolveGroupAccess(coachId: string): Promise<Map<string, AccessRole>> {
  const access = new Map<string, AccessRole>();

  const [ownedRes, collabRes] = await Promise.all([
    supabase.from('training_groups').select('id').eq('owner_id', coachId),
    supabase
      .from('training_group_collaborators')
      .select('group_id, role')
      .eq('coach_id', coachId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null),
  ]);

  for (const g of ownedRes.data ?? []) access.set(g.id as string, 'owned');
  if (!collabRes.error) {
    for (const c of collabRes.data ?? []) {
      access.set(c.group_id as string, bestRole(access.get(c.group_id as string), c.role as CollaboratorRole));
    }
  }
  return access;
}

export async function getAccessibleGroupIds(coachId: string): Promise<string[]> {
  return Array.from((await resolveGroupAccess(coachId)).keys());
}

export interface AccessibleGroups {
  groups: TrainingGroup[];
  accessById: Record<string, AccessRole>;
}

export async function fetchAccessibleGroups(coachId: string): Promise<AccessibleGroups> {
  const access = await resolveGroupAccess(coachId);
  const ids = Array.from(access.keys());
  if (ids.length === 0) return { groups: [], accessById: {} };

  const { data, error } = await supabase
    .from('training_groups')
    .select('*')
    .in('id', ids)
    .order('name');
  if (error) throw error;

  return {
    groups: (data ?? []) as TrainingGroup[],
    accessById: Object.fromEntries(access),
  };
}

// ─── Athletes ────────────────────────────────────────────────────────────────

/**
 * Resolve athlete_id → effective access role across all paths (ownership,
 * direct share, group-member cascade). Id-only queries; call
 * fetchAccessibleAthletes when you need the full rows.
 */
export async function resolveAthleteAccess(coachId: string): Promise<Map<string, AccessRole>> {
  const access = new Map<string, AccessRole>();

  const groupAccess = await resolveGroupAccess(coachId);
  const groupIds = Array.from(groupAccess.keys());

  const [ownedRes, directRes, membersRes] = await Promise.all([
    supabase.from('athletes').select('id').eq('owner_id', coachId),
    supabase
      .from('athlete_collaborators')
      .select('athlete_id, role')
      .eq('coach_id', coachId)
      .not('accepted_at', 'is', null)
      .is('revoked_at', null),
    groupIds.length > 0
      ? supabase
          .from('group_members')
          .select('athlete_id, group_id')
          .in('group_id', groupIds)
          .is('left_at', null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const a of ownedRes.data ?? []) access.set(a.id as string, 'owned');

  if (!directRes.error) {
    for (const c of directRes.data ?? []) {
      const id = c.athlete_id as string;
      access.set(id, bestRole(access.get(id), c.role as CollaboratorRole));
    }
  }

  if (!('error' in membersRes) || !membersRes.error) {
    for (const m of membersRes.data ?? []) {
      const athleteId = m.athlete_id as string;
      const groupRole = groupAccess.get(m.group_id as string);
      if (!groupRole) continue;
      // Owning/co-coaching a group grants co_coach on its members; a
      // viewer-shared group grants viewer. Owning the athlete itself
      // (already set above) still wins via bestRole.
      const cascaded: AccessRole = groupRole === 'viewer' ? 'viewer' : 'co_coach';
      access.set(athleteId, bestRole(access.get(athleteId), cascaded));
    }
  }

  return access;
}

export async function getAccessibleAthleteIds(coachId: string): Promise<string[]> {
  return Array.from((await resolveAthleteAccess(coachId)).keys());
}

export interface AccessibleAthletes {
  athletes: Athlete[];
  accessById: Record<string, AccessRole>;
  /** athlete id → host coach display name, only for non-owned athletes. */
  hostNameById: Record<string, string>;
}

export async function fetchAccessibleAthletes(
  coachId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<AccessibleAthletes> {
  const access = await resolveAthleteAccess(coachId);
  const ids = Array.from(access.keys());
  if (ids.length === 0) return { athletes: [], accessById: {}, hostNameById: {} };

  let query = supabase.from('athletes').select('*').in('id', ids);
  if (opts.activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query
    .order('is_active', { ascending: false })
    .order('name');
  if (error) throw error;
  const athletes = (data ?? []) as Athlete[];

  // Host display names for the "Shared by X" chip — only the athletes
  // this coach doesn't own.
  const hostIds = Array.from(
    new Set(athletes.filter(a => a.owner_id !== coachId).map(a => a.owner_id)),
  );
  let hostNameById: Record<string, string> = {};
  if (hostIds.length > 0) {
    const hostsRes = await supabase.from('coach_profiles').select('id, name').in('id', hostIds);
    if (!hostsRes.error && hostsRes.data) {
      const byOwner = new Map(hostsRes.data.map(r => [r.id as string, r.name as string]));
      hostNameById = Object.fromEntries(
        athletes
          .filter(a => a.owner_id !== coachId)
          .map(a => [a.id, byOwner.get(a.owner_id) ?? 'another coach']),
      );
    }
  }

  return { athletes, accessById: Object.fromEntries(access), hostNameById };
}
