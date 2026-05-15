// EMOS Coach Dashboard — v2.
//
// A denser, more pinboard-feeling dashboard inspired by the "Status Board"
// wireframe. Coach gets:
//   - A top-of-page summary (this week / next week / flagged).
//   - One row per athlete with phase, last training, RAW, compliance,
//     bodyweight delta, this/next-week plan state, and next event.
//   - Click any row to expand inline: RAW pillar breakdown, bodyweight
//     detail, attention flags, and a planned-vs-actual chart with a
//     metric switcher.
//   - Activity feed and Upcoming events below the board; clicking either
//     pulses + scrolls + expands the relevant athlete's row.
//
// This is intentionally a parallel view to the existing CoachDashboard
// (mounted at /dashboard). Both routes share the same Supabase data; the v2
// hook augments the v1 fetch with RAW pillars, bodyweight deltas, compliance
// trends, and per-athlete event mapping.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AthleteStatus } from '../../hooks/useCoachDashboard';
import { useCoachDashboardV2 } from '../../hooks/useCoachDashboardV2';
import type { Athlete, Event, TrainingGroup } from '../../lib/database.types';
import { EventOverviewModal } from '../EventOverviewModal';
import { StatusBoard, type GroupBy } from './StatusBoard';
import { ActivityFeedPanel } from './ActivityFeedPanel';
import { UpcomingEventsPanel } from './UpcomingEventsPanel';
import { SectionHeader } from './atoms';

interface CoachDashboardV2Props {
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
  onNavigateToGroupPlanner: (group: TrainingGroup, weekStart: string) => void;
}

const PIN_KEY = 'emos_v2_dashboard_pinned';
const GROUP_KEY = 'emos_v2_dashboard_groupby';

function loadPins(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function loadGroupBy(): GroupBy {
  const v = localStorage.getItem(GROUP_KEY);
  return v === 'group' ? 'group' : 'none';
}

export function CoachDashboardV2({ onNavigateToPlanner }: CoachDashboardV2Props) {
  const navigate = useNavigate();
  const {
    athleteStatuses, activityFeed, upcomingEvents,
    loading, getEnrichment, totalFlagged,
  } = useCoachDashboardV2();

  const [pinned, setPinned] = useState<string[]>(() => loadPins());
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  useEffect(() => {
    localStorage.setItem(PIN_KEY, JSON.stringify(pinned));
  }, [pinned]);
  useEffect(() => {
    localStorage.setItem(GROUP_KEY, groupBy);
  }, [groupBy]);

  useEffect(() => {
    if (!pulseId) return;
    const id = setTimeout(() => setPulseId(null), 1600);
    return () => clearTimeout(id);
  }, [pulseId]);

  const ordered = useMemo(() => {
    if (!pinned.length) return athleteStatuses;
    const idx = (id: string) => {
      const i = pinned.indexOf(id);
      return i === -1 ? 999 : i;
    };
    return [...athleteStatuses].sort((a, b) => idx(a.athlete.id) - idx(b.athlete.id));
  }, [athleteStatuses, pinned]);

  const togglePin = useCallback((id: string) => {
    setPinned(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, []);

  const jumpToAthlete = useCallback((status: AthleteStatus) => {
    setExpandedId(status.athlete.id);
    setPulseId(status.athlete.id);
    setTimeout(() => {
      const el = document.getElementById(`v2-row-${status.athlete.id}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 30);
  }, []);

  const openPlanner = useCallback((status: AthleteStatus) => {
    onNavigateToPlanner(status.athlete, status.currentWeekStart);
  }, [onNavigateToPlanner]);

  const openEvent = useCallback((event: Event) => {
    setSelectedEvent(event);
  }, []);

  // Top-of-page summary counts. Use the ordered list (post-slice/pin) so that
  // these match what the coach is actually seeing.
  const summary = useMemo(() => ({
    thisDone: ordered.filter(s => s.currentWeekPlanned).length,
    nextDone: ordered.filter(s => s.nextWeekPlanned).length,
    flagged: totalFlagged,
    total: ordered.length,
  }), [ordered, totalFlagged]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--color-bg-page)',
      color: 'var(--color-text-primary)',
      paddingBottom: 48,
    }}>
      {/* Top bar */}
      <div style={{
        padding: '18px 26px 14px',
        background: 'var(--color-bg-primary)',
        borderBottom: '1px solid var(--color-border-secondary)',
        display: 'flex', alignItems: 'center', gap: 18,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary)',
            letterSpacing: '-0.005em',
          }}>{greeting}, Coach</span>
          <span style={{
            fontSize: 11, color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono, ui-monospace), monospace',
          }}>{todayLabel}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => navigate('/dashboard')}
          title="Open the original dashboard"
          style={{
            padding: '4px 10px', fontSize: 11,
            fontFamily: 'var(--font-mono, ui-monospace), monospace',
            background: 'transparent', color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-secondary)', borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          v1 dashboard ↗
        </button>
        <SummaryStat
          label="This week"
          v={summary.thisDone} total={summary.total}
          tone={summary.total === 0 ? 'neutral'
            : summary.thisDone === summary.total ? 'ok'
            : summary.thisDone >= summary.total * 0.7 ? 'warn' : 'bad'}
        />
        <SummaryStat
          label="Next week"
          v={summary.nextDone} total={summary.total}
          tone={summary.total === 0 ? 'neutral'
            : summary.nextDone === summary.total ? 'ok'
            : summary.nextDone >= summary.total * 0.7 ? 'warn' : 'bad'}
        />
        <SummaryStat
          label="Flagged"
          v={summary.flagged} total={summary.total}
          tone={summary.flagged === 0 ? 'ok'
            : summary.flagged < Math.max(1, summary.total * 0.3) ? 'warn' : 'bad'}
        />
      </div>

      {/* Athletes board */}
      <div style={{ padding: '18px 26px 8px' }}>
        <SectionHeader right={
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center',
            fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 10,
            color: 'var(--color-text-tertiary)',
          }}>
            <GroupByToggle value={groupBy} onChange={setGroupBy} />
            <span>· {ordered.length} athletes · click row to expand · ★ to pin</span>
          </div>
        }>Athletes</SectionHeader>
        {loading && ordered.length === 0 ? (
          <div style={{
            padding: 32, textAlign: 'center', color: 'var(--color-text-tertiary)',
            fontSize: 12, background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-secondary)', borderRadius: 4,
          }}>
            Loading roster…
          </div>
        ) : (
          <StatusBoard
            statuses={ordered}
            getEnrichment={getEnrichment}
            pinned={pinned}
            onTogglePin={togglePin}
            groupBy={groupBy}
            expandedId={expandedId}
            onSetExpanded={setExpandedId}
            pulseId={pulseId}
            onOpenPlanner={openPlanner}
          />
        )}
      </div>

      {/* Activity + Upcoming */}
      <div style={{ padding: '14px 26px 26px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
        }}>
          <ActivityFeedPanel
            events={activityFeed}
            statuses={ordered}
            onJumpToAthlete={jumpToAthlete}
          />
          <UpcomingEventsPanel
            events={upcomingEvents}
            statuses={ordered}
            onOpenEvent={openEvent}
            onJumpToAthlete={jumpToAthlete}
          />
        </div>
      </div>

      {selectedEvent && (
        <EventOverviewModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

function SummaryStat({
  label, v, total, tone,
}: { label: string; v: number; total: number; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const text = tone === 'ok'   ? 'var(--color-success-text)'
    : tone === 'warn' ? 'var(--color-warning-text)'
    : tone === 'bad'  ? 'var(--color-danger-text)'
    : 'var(--color-text-primary)';
  const border = tone === 'ok'   ? 'var(--color-success-border)'
    : tone === 'warn' ? 'var(--color-warning-border)'
    : tone === 'bad'  ? 'var(--color-danger-border)'
    : 'var(--color-border-secondary)';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1,
      padding: '4px 10px', borderLeft: `3px solid ${border}`,
    }}>
      <span style={{
        fontSize: 9.5, color: 'var(--color-text-tertiary)',
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{label}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 4,
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
      }}>
        <span style={{
          fontSize: 17, fontWeight: 500, color: text, fontVariantNumeric: 'tabular-nums',
        }}>{v}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>/ {total}</span>
      </span>
    </div>
  );
}

function GroupByToggle({ value, onChange }: { value: GroupBy; onChange: (v: GroupBy) => void }) {
  const opts: { id: GroupBy; label: string }[] = [
    { id: 'none',  label: 'Athlete-first' },
    { id: 'group', label: 'Group-first' },
  ];
  return (
    <div style={{ display: 'inline-flex', gap: 2 }}>
      {opts.map(o => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: '2px 8px', fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace), monospace',
              background: selected ? 'var(--color-text-primary)' : 'transparent',
              color: selected ? 'var(--color-text-on-accent)' : 'var(--color-text-secondary)',
              border: `1px solid ${selected ? 'var(--color-text-primary)' : 'var(--color-border-secondary)'}`,
              borderRadius: 2, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
