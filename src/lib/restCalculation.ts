export interface ScheduleEntry {
  weekday: number;     // 0=Mon..6=Sun
  time: string | null; // "15:30" or null
}

export interface RestInfo {
  slotIndex: number;
  weekday: number | null;
  time: string | null;
  hoursFromPrevious: number | null;
  recoveryLevel: 'full' | 'partial' | 'short' | 'same-day' | null;
}

/**
 * Convert weekday + time to comparable hours from Monday 00:00.
 * Monday 09:00 = 9, Tuesday 15:30 = 39.5, etc.
 */
function toWeekHour(weekday: number, time: string | null): number {
  const dayHours = weekday * 24;
  if (!time) return dayHours + 12; // default noon when no time
  const [h, m] = time.split(':').map(Number);
  return dayHours + h + (m || 0) / 60;
}

/**
 * Calculate rest hours between training sessions based on schedule.
 */
export function calculateRestInfo(
  activeSlots: number[],
  schedule: Record<number, ScheduleEntry> | null,
): RestInfo[] {
  if (!schedule || Object.keys(schedule).length === 0) {
    return activeSlots.map(s => ({
      slotIndex: s, weekday: null, time: null,
      hoursFromPrevious: null, recoveryLevel: null,
    }));
  }

  const assigned = activeSlots
    .filter(s => schedule[s] !== undefined)
    .map(s => ({
      slotIndex: s,
      weekday: schedule[s].weekday,
      time: schedule[s].time,
      weekHour: toWeekHour(schedule[s].weekday, schedule[s].time),
    }))
    .sort((a, b) => a.weekHour - b.weekHour);

  // Also include unassigned slots (no weekday) as pass-throughs
  const unassigned = activeSlots
    .filter(s => schedule[s] === undefined)
    .map(s => ({ slotIndex: s, weekday: null, time: null, hoursFromPrevious: null, recoveryLevel: null as RestInfo['recoveryLevel'] }));

  const result: RestInfo[] = assigned.map((slot, i) => {
    if (i === 0) {
      return { slotIndex: slot.slotIndex, weekday: slot.weekday, time: slot.time,
               hoursFromPrevious: null, recoveryLevel: null };
    }
    const prev = assigned[i - 1];
    const hours = Math.round((slot.weekHour - prev.weekHour) * 10) / 10;

    let recoveryLevel: RestInfo['recoveryLevel'];
    if (hours < 8)       recoveryLevel = 'same-day';
    else if (hours < 24) recoveryLevel = 'short';
    else if (hours < 48) recoveryLevel = 'partial';
    else                 recoveryLevel = 'full';

    return { slotIndex: slot.slotIndex, weekday: slot.weekday, time: slot.time,
             hoursFromPrevious: hours, recoveryLevel };
  });

  return [...result, ...unassigned];
}

export interface WeekdayCell {
  weekday: number;
  weekdayName: string;
  isRestDay: boolean;
  trainingSessions: { slotIndex: number; time: string | null }[];
  recoveryFromPrevTraining: number | null; // hours since last session ended
}

/**
 * Build 7 weekday cells for the calendar view. Returns empty array
 * when schedule is null/empty (abstract mode).
 */
export function buildWeekdayCells(
  activeSlots: number[],
  schedule: Record<number, ScheduleEntry> | null,
): WeekdayCell[] {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (!schedule || Object.keys(schedule).length === 0) return [];

  const slotsByWeekday = new Map<number, { slotIndex: number; time: string | null }[]>();
  activeSlots.forEach(s => {
    const entry = schedule[s];
    if (!entry) return;
    const arr = slotsByWeekday.get(entry.weekday) ?? [];
    arr.push({ slotIndex: s, time: entry.time });
    slotsByWeekday.set(entry.weekday, arr);
  });

  // Sort sessions within same day by time
  slotsByWeekday.forEach(sessions => {
    sessions.sort((a, b) => {
      const ta = a.time ? parseInt(a.time.replace(':', ''), 10) : 1200;
      const tb = b.time ? parseInt(b.time.replace(':', ''), 10) : 1200;
      return ta - tb;
    });
  });

  let lastTrainingWeekHour: number | null = null;

  return DAYS.map((name, wd) => {
    const sessions = slotsByWeekday.get(wd) ?? [];
    const isRest = sessions.length === 0;

    let recovery: number | null = null;
    if (!isRest && lastTrainingWeekHour !== null) {
      const firstSessionHour = toWeekHour(wd, sessions[0].time);
      recovery = Math.round((firstSessionHour - lastTrainingWeekHour) * 10) / 10;
    }
    if (!isRest) {
      const lastSession = sessions[sessions.length - 1];
      lastTrainingWeekHour = toWeekHour(wd, lastSession.time);
    }

    return {
      weekday: wd,
      weekdayName: name,
      isRestDay: isRest,
      trainingSessions: sessions,
      recoveryFromPrevTraining: recovery,
    };
  });
}
