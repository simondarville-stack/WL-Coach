import { useState } from 'react';
import { supabase } from '../lib/supabase';
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
      console.error('Error loading events:', error);
    } finally {
      setLoading(false);
    }
  };

  const createEvent = async (
    eventData: { name: string; event_date: string; description: string },
    athleteIds: string[],
  ) => {
    try {
      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert(eventData)
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
      console.error('Error creating event:', error);
      throw error;
    }
  };

  const updateEvent = async (
    id: string,
    eventData: { name: string; event_date: string; description: string },
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
      console.error('Error updating event:', error);
      throw error;
    }
  };

  const deleteEvent = async (id: string) => {
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting event:', error);
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
