// Upcoming events panel — bucketed by horizon (next 2 weeks / 2-4 / 4-8).
// Athlete chips below each event jump back into the StatusBoard.

import type { UpcomingEvent, AthleteStatus } from '../../hooks/useCoachDashboard';
import type { Event } from '../../lib/database.types';
import { Avatar } from './atoms';

const BUCKETS = [
  { id: '2w', label: 'Next 2 weeks',     min: 0,  max: 14 },
  { id: '4w', label: 'In 2–4 weeks',     min: 14, max: 28 },
  { id: '8w', label: 'Later · 4–8 weeks', min: 28, max: 60 },
];

interface Props {
  events: UpcomingEvent[];
  statuses: AthleteStatus[];
  onOpenEvent: (event: Event) => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
}

export function UpcomingEventsPanel({ events, statuses, onOpenEvent, onJumpToAthlete }: Props) {
  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border-secondary)',
      borderRadius: 4,
      display: 'flex', flexDirection: 'column', minHeight: 360,
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border-tertiary)',
        display: 'flex', alignItems: 'baseline', gap: 10,
      }}>
        <span style={{
          fontSize: 11, color: 'var(--color-text-tertiary)',
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>Upcoming</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {events.length} on the calendar · next 8 weeks
        </span>
        <span style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 460 }}>
        {events.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center', color: 'var(--color-text-tertiary)',
            fontSize: 12,
          }}>
            Nothing scheduled in the next 8 weeks.
          </div>
        )}
        {BUCKETS.map(bk => {
          const items = events.filter(e => e.daysUntil >= bk.min && e.daysUntil < bk.max);
          if (!items.length) return null;
          return (
            <div key={bk.id}>
              <div style={{
                padding: '6px 14px 5px',
                background: 'var(--color-bg-secondary)',
                borderBottom: '1px solid var(--color-border-tertiary)',
                display: 'flex', alignItems: 'baseline', gap: 8,
              }}>
                <span style={{
                  fontSize: 10, color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono, ui-monospace), monospace',
                  textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500,
                }}>{bk.label}</span>
                <span style={{
                  fontFamily: 'var(--font-mono, ui-monospace), monospace',
                  fontSize: 10, color: 'var(--color-text-tertiary)',
                }}>{items.length}</span>
              </div>
              {items.map(ev => (
                <UpcomingRow
                  key={ev.eventData.id}
                  ev={ev}
                  statuses={statuses}
                  onOpenEvent={onOpenEvent}
                  onJumpToAthlete={onJumpToAthlete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingRow({
  ev, statuses, onOpenEvent, onJumpToAthlete,
}: {
  ev: UpcomingEvent;
  statuses: AthleteStatus[];
  onOpenEvent: (event: Event) => void;
  onJumpToAthlete: (status: AthleteStatus) => void;
}) {
  const isComp = ev.eventData.event_type === 'competition';
  const c = isComp
    ? { bg: '#FFF0EA', text: '#7C3A0E', border: '#E8A57F', tag: 'comp' }
    : { bg: '#E6F1FB', text: '#0C447C', border: '#85B7EB', tag: 'camp' };

  // Athletes involved — UpcomingEvent.athleteName is a comma-joined string from
  // the hook. We resolve it to AthleteStatus rows when possible to make the
  // chips clickable; "All Athletes" or unknown names fall through to a static
  // chip.
  const names = (ev.athleteName || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const resolved = names.map(name => {
    const status = statuses.find(s => s.athlete.name === name);
    return { name, status };
  });

  const dateLabel = new Date(ev.eventData.event_date)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: '1px solid var(--color-border-tertiary)',
      borderLeft: `3px solid ${c.border}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <button
          onClick={() => onOpenEvent(ev.eventData)}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13,
            color: 'var(--color-text-primary)', fontWeight: 500,
            textAlign: 'left',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)'; }}
        >
          {ev.note}
        </button>
        <span style={{
          padding: '1px 6px', borderRadius: 2,
          background: c.bg, color: c.text, border: `1px solid ${c.border}`,
          fontSize: 9, fontFamily: 'var(--font-mono, ui-monospace), monospace',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>{c.tag}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
          fontSize: 11, color: 'var(--color-text-secondary)',
        }}>{dateLabel}</span>
        <span style={{
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
          fontSize: 11, color: c.text, fontWeight: 500,
        }}>{ev.daysUntil}d / {ev.weeksUntil}w</span>
      </div>

      {ev.eventData.location && (
        <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
          {ev.eventData.location}
        </span>
      )}

      {resolved.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {resolved.map(({ name, status }) => {
            const isClickable = !!status;
            const display = name.split(' ').slice(0, 2).map((p, i) => i === 1 ? p[0] : p).join(' ');
            return (
              <button
                key={name}
                onClick={() => { if (status) onJumpToAthlete(status); }}
                disabled={!isClickable}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 7px 2px 3px',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-secondary)',
                  borderRadius: 11, cursor: isClickable ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  if (!isClickable) return;
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-muted)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent-border)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border-secondary)';
                }}
              >
                <Avatar name={name} size={18} />
                <span style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>{display}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
