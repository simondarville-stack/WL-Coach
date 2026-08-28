/**
 * AthleteDayScreen — coach mobile drill-in: one athlete's full programme for
 * one training slot, rendered with the same read-only SessionPreview the
 * athlete app uses (planned prescription beside anything already logged).
 *
 * This is the "watch a session happen" screen, so it refreshes on a short
 * cadence while visible — a coach on the gym floor sees sets tick in, notes
 * appear and clips arrive without pulling to refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  fetchAthleteDay,
  fetchWeekOverview,
  defaultSlotLabel,
  markLogVideoReviewed,
  type AthleteDayData,
  type WeekOverview,
} from '../../lib/trainingLogService';
import type { TrainingLogVideo } from '../../lib/database.types';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import { SessionPreview } from '../../athlete/v2/components/SessionPreview';
import { FieldMessageSheet } from '../components/FieldMessageSheet';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function AthleteDayScreen() {
  const navigate = useNavigate();
  const { athleteId, dayIndex: dayIndexParam } = useParams<{ athleteId: string; dayIndex: string }>();
  const [params] = useSearchParams();
  const weekStart = params.get('w') ?? getMondayOfWeekISO(new Date());
  const dayIndex = Number(dayIndexParam);

  const [athleteName, setAthleteName] = useState<string>('');
  const [athleteOwnerId, setAthleteOwnerId] = useState<string | null>(null);
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [dayData, setDayData] = useState<AthleteDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!athleteId || Number.isNaN(dayIndex)) return;
    try {
      const [{ data: athleteRow }, ov] = await Promise.all([
        supabase.from('athletes').select('name, owner_id').eq('id', athleteId).maybeSingle(),
        fetchWeekOverview(athleteId, weekStart),
      ]);
      const dd = await fetchAthleteDay(athleteId, weekStart, dayIndex, ov.weekPlanId);
      if (!aliveRef.current) return;
      const a = athleteRow as { name: string; owner_id: string } | null;
      setAthleteName(a?.name ?? '');
      setAthleteOwnerId(a?.owner_id ?? null);
      setOverview(ov);
      setDayData(dd);
      setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [athleteId, weekStart, dayIndex]);

  useEffect(() => { void load(); }, [load]);

  // Live refresh. 30 s rather than the 60 s the rest of the app uses: this is
  // the one screen a coach watches while the set is actually being lifted.
  // Skipped while hidden so a backgrounded phone isn't polling, with an
  // immediate catch-up refresh when it comes back.
  useEffect(() => {
    const refreshIfVisible = () => { if (!document.hidden) void load(); };
    const id = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  /** Stamp a clip reviewed on first play, clearing its highlight locally so
   *  it doesn't stay ringed until the next poll. Best-effort. */
  const handleVideoOpened = useCallback((video: TrainingLogVideo) => {
    if (video.coach_reviewed_at !== null) return;
    const reviewedAt = new Date().toISOString();
    setDayData(prev => {
      if (!prev?.log) return prev;
      return {
        ...prev,
        log: {
          ...prev.log,
          exercises: prev.log.exercises.map(le => ({
            ...le,
            videos: le.videos.map(v =>
              v.id === video.id ? { ...v, coach_reviewed_at: reviewedAt } : v,
            ),
          })),
        },
      };
    });
    markLogVideoReviewed(video.id).catch(() => undefined);
  }, []);

  const dayOverview = overview?.days.find(d => d.dayIndex === dayIndex) ?? null;
  const weekday = dayOverview?.weekday ?? null;
  // Unassigned slots have no calendar date; today is the honest fallback
  // (rendering weekStart would read as "scheduled Monday").
  const date =
    dayData?.log?.date
    ?? (weekday != null ? addDaysToISO(weekStart, weekday) : toLocalISO(new Date()));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-gray-400 hover:text-white"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-base font-bold truncate flex-1">{athleteName || 'Athlete'}</h1>
          {athleteId && (
            <button
              onClick={() => setMessageOpen(true)}
              className="p-2 -mr-2 text-gray-400 hover:text-white"
              aria-label={`Message ${athleteName || 'athlete'}`}
              title="Message athlete"
            >
              <MessageSquare size={17} />
            </button>
          )}
        </div>

        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !dayData ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-600" />
          </div>
        ) : (
          <SessionPreview
            slotLabel={dayOverview?.label ?? defaultSlotLabel(dayIndex)}
            weekdayLabel={weekday != null ? WEEKDAY_LONG[weekday] : null}
            date={date}
            planned={dayData.planned}
            log={dayData.log}
            onStart={() => {}}
            isBonus={dayOverview?.isBonus ?? false}
            readOnly
            showLogged
            viewerRole="coach"
            onVideoOpened={handleVideoOpened}
          />
        )}
      </div>

      {messageOpen && athleteId && (
        <FieldMessageSheet
          athleteId={athleteId}
          athleteName={athleteName || 'Athlete'}
          // Unit context: the coach is looking at this exact training
          // unit, so the sheet defaults to its thread (toggle back to
          // General remains one tap away).
          unit={athleteOwnerId ? {
            weekStart,
            dayIndex,
            label: dayOverview?.label ?? defaultSlotLabel(dayIndex),
            date,
            ownerId: athleteOwnerId,
          } : null}
          onClose={() => setMessageOpen(false)}
        />
      )}
    </div>
  );
}
