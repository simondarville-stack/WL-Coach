import type { EventWithAthletes } from '../hooks/useEvents';

function icalDate(isoDate: string, time?: string | null): string {
  const d = isoDate.replace(/-/g, '');
  if (time) {
    const t = time.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
    return `${d}T${t}`;
  }
  return d;
}

function escapeIcal(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function uid(): string {
  return `${Date.now()}-events@emos`;
}

export function exportEventToICal(event: EventWithAthletes): void {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const startDate = event.event_date;
  const endDate = event.end_date ?? event.event_date;

  let dtStart: string;
  let dtEnd: string;

  if (event.is_all_day || (!event.start_time && !event.end_time)) {
    // All-day: use DATE value type
    dtStart = `DTSTART;VALUE=DATE:${icalDate(startDate)}`;
    // iCal all-day end is exclusive — add one day
    const end = new Date(endDate + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    const exclusiveEnd = end.toISOString().slice(0, 10);
    dtEnd = `DTEND;VALUE=DATE:${icalDate(exclusiveEnd)}`;
  } else {
    dtStart = `DTSTART:${icalDate(startDate, event.start_time)}`;
    dtEnd = `DTEND:${icalDate(endDate, event.end_time ?? event.start_time)}`;
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EMOS//Competition Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTAMP:${now}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeIcal(event.name)}`,
  ];

  if (event.location) lines.push(`LOCATION:${escapeIcal(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcal(event.description)}`);
  if (event.external_url) lines.push(`URL:${event.external_url}`);
  if (event.notes) lines.push(`COMMENT:${escapeIcal(event.notes)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.name.replace(/[^a-z0-9]/gi, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportAllEventsToICal(events: EventWithAthletes[]): void {
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EMOS//Competition Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const startDate = event.event_date;
    const endDate = event.end_date ?? event.event_date;
    let dtStart: string;
    let dtEnd: string;

    if (event.is_all_day || (!event.start_time && !event.end_time)) {
      dtStart = `DTSTART;VALUE=DATE:${icalDate(startDate)}`;
      const end = new Date(endDate + 'T00:00:00');
      end.setDate(end.getDate() + 1);
      dtEnd = `DTEND;VALUE=DATE:${icalDate(end.toISOString().slice(0, 10))}`;
    } else {
      dtStart = `DTSTART:${icalDate(startDate, event.start_time)}`;
      dtEnd = `DTEND:${icalDate(endDate, event.end_time ?? event.start_time)}`;
    }

    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@emos`,
      `DTSTAMP:${now}`,
      dtStart,
      dtEnd,
      `SUMMARY:${escapeIcal(event.name)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeIcal(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcal(event.description)}`);
    if (event.external_url) lines.push(`URL:${event.external_url}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'competition_calendar.ics';
  a.click();
  URL.revokeObjectURL(url);
}
