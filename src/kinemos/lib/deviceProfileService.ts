/**
 * deviceProfileService — the lens table, and how a clip finds its lens.
 *
 * Design §6.1 has two lens tiers above "assume it away": look the phone up
 * (model tier) and measure it (profile tier). Both are this one table. A
 * coach who measures a clip's lens stores it under that phone's make and
 * model, and every later clip from the same phone finds it — so the lookup
 * table is not a shipped list of phones nobody measured, it is what the
 * coaches themselves measured. Which tier an analysis is on is then a fact
 * about where its profile came from, and the grade says so:
 *
 *   - **profile** — measured from THIS clip, or from this athlete's own
 *     footage on this phone.
 *   - **model** — measured from another clip that happened to share the
 *     phone model.
 *   - **none** — nothing stored; the convention tier, which is what every
 *     analysis was on before this existed.
 */
import { supabase } from '../../lib/supabase';
import type { KinemosDeviceProfile } from '../../lib/database.types';
import { distortionFor, noDistortion, type DistortionModel, type DistortionSource } from '../engine/distortion';
import type { LibrarySource } from './videoLibrary';

/**
 * The key a phone is stored under. Make and model as the container left
 * them, lower-cased and squeezed — "Apple" + "iPhone 14 Pro" becomes
 * `apple iphone 14 pro`. Null when the container kept nothing, which is
 * most log clips: they have been through Stream and arrive stripped.
 */
export function deviceKeyFor(make: string | null, model: string | null): string | null {
  const key = [make, model]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return key.length > 0 ? key : null;
}

export interface ProfileFor {
  model: DistortionModel;
  source: DistortionSource;
  /** The row it came from, when it came from one. */
  profile: KinemosDeviceProfile | null;
}

/**
 * The lens to analyse a clip through.
 *
 * `athleteId` decides the tier, not the arithmetic: a profile fitted on this
 * athlete's own footage is the profile tier, one inherited from another
 * athlete with the same phone is the model tier. The correction is identical;
 * the confidence is not, and the grade is where that difference belongs.
 */
export async function profileForClip(
  deviceMake: string | null,
  deviceModel: string | null,
  frameWidth: number,
  frameHeight: number,
  athleteId: string | null,
): Promise<ProfileFor> {
  const none: ProfileFor = { model: noDistortion(frameWidth, frameHeight), source: 'none', profile: null };
  const key = deviceKeyFor(deviceMake, deviceModel);
  if (!key) return none;
  const { data, error } = await supabase
    .from('kinemos_device_profiles')
    .select('*')
    .eq('device_key', key)
    .maybeSingle();
  if (error) throw error;
  const profile = data as KinemosDeviceProfile | null;
  if (!profile) return none;
  return {
    model: distortionFor(frameWidth, frameHeight, profile.k1),
    source: profile.athlete_id && profile.athlete_id === athleteId ? 'profile' : 'model',
    profile,
  };
}

export interface SaveProfileArgs {
  deviceMake: string | null;
  deviceModel: string | null;
  athleteId: string | null;
  ownerId: string | null;
  k1: number;
  method?: 'plumb-line' | 'manual';
  residualBeforePx?: number | null;
  residualAfterPx?: number | null;
  chains?: number | null;
  frames?: number | null;
  frameWidth: number;
  frameHeight: number;
  sourceKind?: LibrarySource | null;
  sourceId?: string | null;
}

/** Store a measured lens. One row per phone per environment; measuring again
 *  replaces it. Null when the clip names no phone — there is nothing to key
 *  the profile by, and a lens stored under "unknown" would be applied to
 *  every stripped clip in the library. */
export async function saveDeviceProfile(args: SaveProfileArgs): Promise<KinemosDeviceProfile | null> {
  const key = deviceKeyFor(args.deviceMake, args.deviceModel);
  if (!key) return null;
  const { data, error } = await supabase
    .from('kinemos_device_profiles')
    .upsert(
      {
        owner_id: args.ownerId,
        device_key: key,
        device_make: args.deviceMake,
        device_model: args.deviceModel,
        athlete_id: args.athleteId,
        k1: args.k1,
        method: args.method ?? 'plumb-line',
        residual_before_px: args.residualBeforePx ?? null,
        residual_after_px: args.residualAfterPx ?? null,
        chains: args.chains ?? null,
        frames: args.frames ?? null,
        frame_width: args.frameWidth,
        frame_height: args.frameHeight,
        source_kind: args.sourceKind ?? null,
        source_id: args.sourceId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,device_key' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as KinemosDeviceProfile;
}

/** Every lens this environment has measured, newest first. */
export async function listDeviceProfiles(): Promise<KinemosDeviceProfile[]> {
  const { data, error } = await supabase
    .from('kinemos_device_profiles')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as KinemosDeviceProfile[];
}

export async function deleteDeviceProfile(id: string): Promise<void> {
  const { error } = await supabase.from('kinemos_device_profiles').delete().eq('id', id);
  if (error) throw error;
}
