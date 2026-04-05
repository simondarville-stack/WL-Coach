import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOwnerId } from '../lib/ownerContext';
import type { Event, Athlete, EventAttempts, EventVideo } from '../lib/database.types';

export interface EventWithAthletes extends Event {
  athletes: Athlete[];
}

export function useEvents() {
  const [events, setEvents] = useState<EventWithAthletes[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const { data: eventsData } = await supabase
        .from('events')
        .select('*')
        .eq('owner_id', getOwnerId())
        .order('event_date', { ascending: true });

      if (!eventsData) return;

      const eventsWithAthletes: EventWithAthletes[] = [];

      for (const event of eventsData) {
        const { data: eventAthletes } = await supabase
          .from('event_athletes')
          .select('athlete_id')
          .eq('event_id', event.id);

        const athleteIds = eventAthletes?.map(ea => ea.athlete_id) || [];

        const { data: athletesData } = await supabase
          .from('athletes')
          .select('*')
          .in('id', athleteIds.length > 0 ? athleteIds : ['']);

        eventsWithAthletes.push({ ...event, athletes: athletesData || [] });
      }

      setEvents(eventsWithAthletes);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const fetchUpcomingEvents = async (days: number): Promise<EventWithAthletes[]> => {
    const today = new Date().toISOString().split('T')[0];
    const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', getOwnerId())
      .gte('event_date', today)
      .lte('event_date', future)
      .order('event_date', { ascending: true });

    if (!eventsData) return [];
    return Promise.all(
      eventsData.map(async (event) => {
        const { data: eventAthletes } = await supabase
          .from('event_athletes').select('athlete_id').eq('event_id', event.id);
        const athleteIds = eventAthletes?.map(ea => ea.athlete_id) || [];
        const { data: athletesData } = await supabase
          .from('athletes').select('*').in('id', athleteIds.length > 0 ? athleteIds : ['']);
        return { ...event, athletes: athletesData || [] };
      })
    );
  };

  const fetchEventsByMonth = async (year: number, month: number): Promise<EventWithAthletes[]> => {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', getOwnerId())
      .gte('event_date', start)
      .lte('event_date', end)
      .order('event_date', { ascending: true });

    if (!eventsData) return [];
    return Promise.all(
      eventsData.map(async (event) => {
        const { data: eventAthletes } = await supabase
          .from('event_athletes').select('athlete_id').eq('event_id', event.id);
        const athleteIds = eventAthletes?.map(ea => ea.athlete_id) || [];
        const { data: athletesData } = await supabase
          .from('athletes').select('*').in('id', athleteIds.length > 0 ? athleteIds : ['']);
        return { ...event, athletes: athletesData || [] };
      })
    );
  };

  const fetchEventsByDateRange = async (start: string, end: string): Promise<EventWithAthletes[]> => {
    const { data: eventsData } = await supabase
      .from('events')
      .select('*')
      .eq('owner_id', getOwnerId())
      .gte('event_date', start)
      .lte('event_date', end)
      .order('event_date', { ascending: true });

    if (!eventsData) return [];
    return Promise.all(
      eventsData.map(async (event) => {
        const { data: eventAthletes } = await supabase
          .from('event_athletes').select('athlete_id').eq('event_id', event.id);
        const athleteIds = eventAthletes?.map(ea => ea.athlete_id) || [];
        const { data: athletesData } = await supabase
          .from('athletes').select('*').in('id', athleteIds.length > 0 ? athleteIds : ['']);
        return { ...event, athletes: athletesData || [] };
      })
    );
  };

  const createEvent = async (
    eventData: {
      name: string; event_date: string; description: string | null;
      event_type: string; location: string | null; end_date: string | null;
      color: string | null; notes: string | null; is_all_day: boolean;
      start_time: string | null; end_time: string | null; external_url: string | null;
    },
    athleteIds: string[],
  ) => {
    try {
      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert({ ...eventData, owner_id: getOwnerId() })
        .select()
        .single();
      if (insertError) throw insertError;

      if (athleteIds.length > 0 && newEvent) {
        const { error: athletesError } = await supabase
          .from('event_athletes')
          .insert(athleteIds.map(athlete_id => ({ event_id: newEvent.id, athlete_id })));
        if (athletesError) throw athletesError;
      }
    } catch (error) {
      throw error;
    }
  };

  const updateEvent = async (
    id: string,
    eventData: {
      name: string; event_date: string; description: string | null;
      event_type: string; location: string | null; end_date: string | null;
      color: string | null; notes: string | null; is_all_day: boolean;
      start_time: string | null; end_time: string | null; external_url: string | null;
    },
    athleteIds: string[],
  ) => {
    try {
      const { error: updateError } = await supabase
        .from('events')
        .update({ ...eventData, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (updateError) throw updateError;

      await supabase.from('event_athletes').delete().eq('event_id', id);

      if (athleteIds.length > 0) {
        const { error: insertError } = await supabase
          .from('event_athletes')
          .insert(athleteIds.map(athlete_id => ({ event_id: id, athlete_id })));
        if (insertError) throw insertError;
      }
    } catch (error) {
      throw error;
    }
  };

  const deleteEvent = async (id: string) => {
    try {
      const { data: existing } = await supabase.from('events').select('owner_id').eq('id', id).single();
      if (existing?.owner_id !== getOwnerId()) throw new Error('Access denied: resource belongs to another environment');
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      throw error;
    }
  };

  interface AthleteWithAttempts extends Athlete {
    attempts: EventAttempts | null;
    videos: EventVideo[];
  }

  const fetchEventOverview = async (eventId: string): Promise<AthleteWithAttempts[]> => {
    const { data: eventAthletes } = await supabase
      .from('event_athletes')
      .select('athlete_id')
      .eq('event_id', eventId);

    if (!eventAthletes || eventAthletes.length === 0) return [];

    const athleteIds = eventAthletes.map(ea => ea.athlete_id);
    const { data: athletesData } = await supabase
      .from('athletes')
      .select('*')
      .in('id', athleteIds)
      .order('name');

    if (!athletesData) return [];

    return Promise.all(
      athletesData.map(async (athlete) => {
        const { data: attempts } = await supabase
          .from('event_attempts')
          .select('*')
          .eq('event_id', eventId)
          .eq('athlete_id', athlete.id)
          .maybeSingle();

        const { data: videos } = await supabase
          .from('event_videos')
          .select('*')
          .eq('event_id', eventId)
          .eq('athlete_id', athlete.id);

        return { ...athlete, attempts: attempts || null, videos: videos || [] };
      })
    );
  };

  const fetchEventAttempts = async (
    eventId: string,
    athleteId: string,
  ): Promise<{ attempts: EventAttempts | null; videos: EventVideo[] }> => {
    const { data: attemptsData } = await supabase
      .from('event_attempts')
      .select('*')
      .eq('event_id', eventId)
      .eq('athlete_id', athleteId)
      .maybeSingle();

    const { data: videosData } = await supabase
      .from('event_videos')
      .select('*')
      .eq('event_id', eventId)
      .eq('athlete_id', athleteId)
      .order('lift_type')
      .order('attempt_number');

    return { attempts: attemptsData || null, videos: videosData || [] };
  };

  const upsertEventAttempts = async (
    eventId: string,
    athleteId: string,
    attempts: EventAttempts,
  ): Promise<void> => {
    if (attempts.id && attempts.id !== '') {
      const { error } = await supabase
        .from('event_attempts')
        .update({
          planned_snatch_1: attempts.planned_snatch_1,
          planned_snatch_2: attempts.planned_snatch_2,
          planned_snatch_3: attempts.planned_snatch_3,
          planned_cj_1: attempts.planned_cj_1,
          planned_cj_2: attempts.planned_cj_2,
          planned_cj_3: attempts.planned_cj_3,
          actual_snatch_1: attempts.actual_snatch_1,
          actual_snatch_2: attempts.actual_snatch_2,
          actual_snatch_3: attempts.actual_snatch_3,
          actual_cj_1: attempts.actual_cj_1,
          actual_cj_2: attempts.actual_cj_2,
          actual_cj_3: attempts.actual_cj_3,
          competition_notes: attempts.competition_notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', attempts.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('event_attempts').insert({
        event_id: eventId,
        athlete_id: athleteId,
        planned_snatch_1: attempts.planned_snatch_1,
        planned_snatch_2: attempts.planned_snatch_2,
        planned_snatch_3: attempts.planned_snatch_3,
        planned_cj_1: attempts.planned_cj_1,
        planned_cj_2: attempts.planned_cj_2,
        planned_cj_3: attempts.planned_cj_3,
        actual_snatch_1: attempts.actual_snatch_1,
        actual_snatch_2: attempts.actual_snatch_2,
        actual_snatch_3: attempts.actual_snatch_3,
        actual_cj_1: attempts.actual_cj_1,
        actual_cj_2: attempts.actual_cj_2,
        actual_cj_3: attempts.actual_cj_3,
        competition_notes: attempts.competition_notes,
      });
      if (error) throw error;
    }
  };

  const addEventVideo = async (
    eventId: string,
    athleteId: string,
    videoData: { lift_type: 'snatch' | 'clean_jerk'; attempt_number: number; video_url: string; description: string },
  ): Promise<void> => {
    const { error } = await supabase.from('event_videos').insert({
      event_id: eventId,
      athlete_id: athleteId,
      lift_type: videoData.lift_type,
      attempt_number: videoData.attempt_number,
      video_url: videoData.video_url,
      description: videoData.description || null,
    });
    if (error) throw error;
  };

  const uploadAndAddEventVideo = async (
    eventId: string,
    athleteId: string,
    file: File,
    videoData: { lift_type: 'snatch' | 'clean_jerk'; attempt_number: number; description: string },
  ): Promise<void> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${eventId}/${athleteId}/${videoData.lift_type}_${videoData.attempt_number}_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('event-videos')
      .upload(fileName, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from('event-videos')
      .getPublicUrl(fileName);

    await addEventVideo(eventId, athleteId, {
      ...videoData,
      video_url: publicUrlData.publicUrl,
    });
  };

  const deleteEventVideo = async (videoId: string, videoUrl: string): Promise<void> => {
    if (videoUrl.includes('event-videos')) {
      const urlParts = videoUrl.split('/event-videos/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1].split('?')[0];
        await supabase.storage.from('event-videos').remove([filePath]);
      }
    }
    const { error } = await supabase.from('event_videos').delete().eq('id', videoId);
    if (error) throw error;
  };

  return {
    events,
    loading,
    fetchEvents,
    fetchUpcomingEvents,
    fetchEventsByMonth,
    fetchEventsByDateRange,
    createEvent,
    updateEvent,
    deleteEvent,
    fetchEventOverview,
    fetchEventAttempts,
    upsertEventAttempts,
    addEventVideo,
    uploadAndAddEventVideo,
    deleteEventVideo,
  };
}
