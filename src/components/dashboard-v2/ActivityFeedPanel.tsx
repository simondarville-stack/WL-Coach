// Activity feed panel — recent events from the EMOS data layer, presented
// with mono eyebrows and click-to-jump. Clicking an athlete-bearing item
// pulses + scrolls the matching row in the StatusBoard above.

import type { ActivityEvent, AthleteStatus } from '../../hooks/useCoachDashboard';

type Tone = 'success' | 'accent' | 'danger' | 'warning' | 'neutral';

const TYPE_META: Record<ActivityEvent['type'], { label: string; icon: string; tone: Tone }> = {
  training_logged:    { label: 'Training logged',  icon: '●', tone: 'success' },
  session_skipped:    { label: 'Session skipped',  icon: '✕', tone: 'danger'  },
  macrocycle_created: { label: 'Macrocycle',       icon: '⌬', tone: 'accent'  },
};

function toneColor(t: Tone): string {
  if (t === 'success') return 'var(--color-success-border)';
  if (t === 'danger')  return 'var(--color-danger-border)';
  if (t === 'warning') return 'var(--color-warning-border)';
  if (t === 'accent')  return 'var(--color-accent)';
  return 'var(--color-text-tertiary)';
}

function relTimeFromDate(d: Date): string {
  const mins = (Date.now() - d.getTime()) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / (60 * 24));
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

interface Props {
  events: ActivityEvent[];
  statuses: AthleteStatus[];
  onJumpToAthlete: (status: AthleteStatus) => void;
}

export function ActivityFeedPanel({ events, statuses, onJumpToAthlete }: Props) {
  const byName: Record<string, AthleteStatus> = {};
  statuses.forEach(s => { byName[s.athlete.name] = s; });

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
        }}>Activity</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
        <span style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 460 }}>
        {events.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center', color: 'var(--color-text-tertiary)',
            fontSize: 12,
          }}>
            No recent activity.
          </div>
        )}
        {events.map((ev, i) => {
          const meta = TYPE_META[ev.type];
          const status = byName[ev.athleteName] || null;
          const tone = toneColor(meta.tone);
          const clickable = !!status;
          return (
            <button
              key={`${ev.type}-${ev.timestamp.toISOString()}-${i}`}
              onClick={() => { if (status) onJumpToAthlete(status); }}
              disabled={!clickable}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px 1fr 90px',
                gap: 10, alignItems: 'flex-start',
                padding: '9px 14px',
                width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none',
                borderBottom: i === events.length - 1
                  ? 'none' : '1px solid var(--color-border-tertiary)',
                cursor: clickable ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                if (clickable) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <span style={{
                color: tone, fontSize: 11, lineHeight: '18px',
                width: 18, textAlign: 'center',
              }}>{meta.icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9.5, color: tone,
                    fontFamily: 'var(--font-mono, ui-monospace), monospace',
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}>{meta.label}</span>
                  <span style={{
                    fontSize: 12.5, color: 'var(--color-text-primary)', fontWeight: 500,
                  }}>{ev.athleteName}</span>
                </div>
                <span style={{
                  fontSize: 12, color: 'var(--color-text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{ev.details}</span>
                {ev.rawScore !== undefined && ev.rawScore !== null && (
                  <span style={{
                    fontSize: 10.5, color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono, ui-monospace), monospace',
                  }}>RAW {ev.rawScore}/12</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{
                  fontSize: 10.5, color: 'var(--color-text-tertiary)',
                  fontFamily: 'var(--font-mono, ui-monospace), monospace',
                }}>{relTimeFromDate(ev.timestamp)}</span>
                {clickable && (
                  <span style={{
                    fontSize: 10, color: 'var(--color-accent)',
                    fontFamily: 'var(--font-mono, ui-monospace), monospace',
                  }}>open athlete →</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
