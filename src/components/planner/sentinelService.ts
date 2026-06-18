/**
 * sentinelService — DB interactions for sentinel exercise types.
 *
 * Impure module: calls Supabase. Extracted from plannerUtils.ts (UF-29 / E-17).
 * Pure sentinel utilities live in sentinelUtils.ts.
 */
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';

/**
 * Look up or create a sentinel exercise (TEXT / VIDEO / IMAGE / GPP) for an owner.
 * Always includes owner_id on insert so the exercise is owned by the coach.
 *
 * `ownerId` defaults to the coach store's active owner (getOwnerId). The athlete
 * app must pass its coach's id explicitly (athlete.owner_id), because the coach
 * store is empty there and would otherwise fall back to the default owner and
 * create a mis-owned sentinel the coach never sees.
 */
export async function getOrCreateSentinel(
  code: string,
  ownerIdOverride?: string,
): Promise<{ id: string; default_unit: string } | null> {
  const ownerId = ownerIdOverride ?? getOwnerId();
  const { data: existing } = await supabase
    .from('exercises')
    .select('id, default_unit')
    .eq('exercise_code', code)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (existing) return existing;

  const sentinelDefs: Record<string, { name: string; color: string }> = {
    TEXT:  { name: 'Free Text / Notes', color: '#9CA3AF' },
    VIDEO: { name: 'Video',             color: '#6366F1' },
    IMAGE: { name: 'Image',             color: '#EC4899' },
    GPP:   { name: 'General Physical Preparation', color: '#10B981' },
  };
  const def = sentinelDefs[code];
  if (!def) return null;

  const { data: created } = await supabase
    .from('exercises')
    .insert({
      name: def.name,
      category: '— System',
      default_unit: 'other',
      color: def.color,
      exercise_code: code,
      counts_towards_totals: false,
      is_competition_lift: false,
      owner_id: ownerId,
    })
    .select('id, default_unit')
    .single();
  return created ?? null;
}
