/**
 * shareService — handing an analysed rep to an athlete.
 *
 * A share is three writes that belong together: the picture (a snapshot JPEG
 * into R2, the same object a saved snapshot is), the coach's words (an
 * ordinary message in the athlete's general coach thread, so it reaches every
 * surface that thread already has and counts as unread the way a message
 * does), and the card (`kinemos_shares`) with the numbers frozen as they
 * stood. The thread surfaces draw the card beside the message, interleaved by
 * time the way session clips are.
 *
 * Design §9: sharing rides existing EMOS channels; no new messaging
 * infrastructure. Components never touch Supabase directly (CLAUDE.md core
 * principle 2).
 */
import { supabase } from '../../lib/supabase';
import type { KinemosShare, KinemosShareSummary } from '../../lib/database.types';
import { sendGeneralMessage } from '../../lib/trainingLogService';
import { emitInboxChanged } from '../../lib/inboxEvents';
import { uploadSnapshot } from './kinemosStorage';

export interface CreateShareArgs {
  analysisId: string;
  athleteId: string;
  /** The athlete's owner environment — the thread is scoped by it. */
  ownerId: string;
  senderCoachId: string | null;
  /** The coach's words. Empty means the card goes with a one-line default. */
  note: string;
  /** The picture: the frame with the bar path drawn, as `composeSnapshot`
   *  makes it. */
  image: Blob;
  summary: KinemosShareSummary;
}

/** The message text when the coach wrote nothing: what was shared, in a
 *  line an athlete can read without the card. */
export function defaultShareMessage(summary: KinemosShareSummary): string {
  const what = [summary.exerciseName ?? 'Lift', summary.loadKg !== null ? `${formatKg(summary.loadKg)} kg` : null]
    .filter(Boolean)
    .join(' ');
  const numbers = [
    summary.vmaxMs !== null ? `Vmax ${summary.vmaxMs.toFixed(2).replace('.', ',')} m/s` : null,
    summary.peakHeightCm !== null ? `height ${Math.round(summary.peakHeightCm)} cm` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `Shared a lift analysis: ${what}${numbers ? ` — ${numbers}` : ''}`;
}

function formatKg(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace('.', ',');
}

/**
 * Share one rep with its athlete. The picture is uploaded first (the one
 * step that can fail for reasons outside the database), then the message,
 * then the card that points at both.
 */
export async function createShare(args: CreateShareArgs): Promise<KinemosShare> {
  const assetKey = await uploadSnapshot(args.image);
  const text = args.note.trim() || defaultShareMessage(args.summary);
  const message = await sendGeneralMessage({
    athleteId: args.athleteId,
    ownerId: args.ownerId,
    message: text,
    senderType: 'coach',
    senderCoachId: args.senderCoachId,
  });
  const { data, error } = await supabase
    .from('kinemos_shares')
    .insert({
      owner_id: args.ownerId,
      analysis_id: args.analysisId,
      channel: 'athlete',
      athlete_id: args.athleteId,
      sender_coach_id: args.senderCoachId,
      message_id: message.id,
      asset_key: assetKey,
      summary: args.summary,
    })
    .select()
    .single();
  if (error) throw error;
  emitInboxChanged();
  return data as KinemosShare;
}

/**
 * The environment an athlete's thread lives in. A message sent from the
 * coach's side must be stamped with the ATHLETE's host environment, or the
 * athlete app never finds it — the same rule the coach inbox follows when it
 * creates a session. Falls back to the coach's own environment.
 */
export async function fetchAthleteOwnerId(athleteId: string, fallback: string): Promise<string> {
  const { data, error } = await supabase.from('athletes').select('owner_id').eq('id', athleteId).maybeSingle();
  if (error) throw error;
  const ownerId = (data as { owner_id: string | null } | null)?.owner_id;
  return ownerId ?? fallback;
}

/** Every share of one rep, newest first — what the viewer lists under SHARE. */
export async function listSharesForAnalysis(analysisId: string): Promise<KinemosShare[]> {
  const { data, error } = await supabase
    .from('kinemos_shares')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as KinemosShare[];
}

/** Everything shared with one athlete, oldest first — the cards in their
 *  coach thread. */
export async function fetchSharesForAthlete(athleteId: string): Promise<KinemosShare[]> {
  const { data, error } = await supabase
    .from('kinemos_shares')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('channel', 'athlete')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as KinemosShare[];
}

/** The athlete opened the card. One-way, like message read state. */
export async function markShareOpened(shareId: string): Promise<void> {
  const { error } = await supabase
    .from('kinemos_shares')
    .update({ athlete_read_at: new Date().toISOString() })
    .eq('id', shareId)
    .is('athlete_read_at', null);
  if (error) throw error;
}

export async function deleteShare(shareId: string): Promise<void> {
  const { error } = await supabase.from('kinemos_shares').delete().eq('id', shareId);
  if (error) throw error;
}
