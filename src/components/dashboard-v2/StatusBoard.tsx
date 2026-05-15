// Status Board — the main athlete roster for the v2 dashboard.
// Dense one-row-per-athlete with severity tint on the left edge, all the
// at-a-glance metrics inline, and click-to-expand inline.

import { useMemo } from 'react';
import type { AthleteStatus } from '../../hooks/useCoachDashboard';
import type { AthleteEnrichment } from '../../hooks/useCoachDashboardV2';
import {
  Avatar, PhasePill, WeekPill, RawChip, ComplianceSpark, BwDelta, EventTag,
  FlagDot, rowAlertTone, lastTrainLabel,
} from './atoms';
import { AthleteExpansion } from './AthleteExpansion';

const GRID = '28px 24px minmax(170px, 1.5fr) 1.4fr 80px 90px 1.2fr 100px 90px 90px 130px 18px';

export type GroupBy = 'none' | 'group';

interface Props {
  statuses: AthleteStatus[];
  getEnrichment: (athleteId: string) => AthleteEnrichment;
  pinned: string[];
  onTogglePin: (id: string) => void;
  groupBy: GroupBy;
  expandedId: string | null;
  onSetExpanded: (id: string | null) => void;
  pulseId: string | null;
  onOpenPlanner: (status: AthleteStatus) => void;
}

interface Section {
  key: string;
  label: string | null;
  statuses: AthleteStatus[];
}

function bucketByGroup(statuses: AthleteStatus[], groupBy: GroupBy): Section[] {
  if (groupBy === 'none') return [{ key: 'all', label: null, statuses }];
  const byGroup: Record<string, AthleteStatus[]> = {};
  statuses.forEach(s => {
    // Athletes don't carry a group on the row — leave a single bucket for now;
    // the group hook fills this out when wired through.
    const g = 'All athletes';
    (byGroup[g] ||= []).push(s);
  });
  return Object.entries(byGroup).map(([k, list]) => ({ key: k, label: k, statuses: list }));
}

export function StatusBoard({
  statuses, getEnrichment, pinned, onTogglePin, groupBy,
  expandedId, onSetExpanded, pulseId, onOpenPlanner,
}: Props) {
  const sections = useMemo(() => bucketByGroup(statuses, groupBy), [statuses, groupBy]);

  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      border: '1px solid var(--color-border-secondary)',
      borderRadius: 4, overflow: 'hidden',
    }}>
      <HeaderRow />
      {sections.map(section => (
        <div key={section.key}>
          {section.label && (
            <SectionLabel
              label={section.label}
              statuses={section.statuses}
            />
          )}
          {section.statuses.map(s => (
            <Row
              key={s.athlete.id}
              status={s}
              enrichment={getEnrichment(s.athlete.id)}
              expanded={expandedId === s.athlete.id}
              pulse={pulseId === s.athlete.id}
              pinned={pinned.includes(s.athlete.id)}
              onTogglePin={() => onTogglePin(s.athlete.id)}
              onSetExpanded={() => onSetExpanded(expandedId === s.athlete.id ? null : s.athlete.id)}
              onOpenPlanner={onOpenPlanner}
            />
          ))}
          {section.statuses.length === 0 && (
            <div style={{ padding: 18, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              No active athletes.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: GRID, gap: 0,
      padding: '10px 14px',
      background: 'var(--color-bg-secondary)',
      borderBottom: '1px solid var(--color-border-secondary)',
      fontSize: 10, fontFamily: 'var(--font-mono, ui-monospace), monospace',
      color: 'var(--color-text-tertiary)',
      textTransform: 'uppercase', letterSpacing: '0.1em',
    }}>
      <span />
      <span />
      <span>Athlete</span>
      <span>Phase / week</span>
      <span>Last</span>
      <span>RAW</span>
      <span>Compliance</span>
      <span>Bodyweight</span>
      <span>This wk</span>
      <span>Next wk</span>
      <span>Next event</span>
      <span />
    </div>
  );
}

function SectionLabel({ label, statuses }: { label: string; statuses: AthleteStatus[] }) {
  const planned = statuses.filter(s => s.currentWeekPlanned).length;
  const nextPlanned = statuses.filter(s => s.nextWeekPlanned).length;
  return (
    <div style={{
      padding: '8px 14px 6px',
      background: 'var(--color-bg-primary)',
      borderBottom: '1px solid var(--color-border-tertiary)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{
        fontSize: 10, fontFamily: 'var(--font-mono, ui-monospace), monospace',
        color: 'var(--color-text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600,
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        fontSize: 10, color: 'var(--color-text-tertiary)',
      }}>{statuses.length} athletes</span>
      <span style={{ flex: 1, height: 1, background: 'var(--color-border-tertiary)' }} />
      <span style={{
        fontFamily: 'var(--font-mono, ui-monospace), monospace',
        fontSize: 10, color: 'var(--color-text-tertiary)',
      }}>
        planned {planned}/{statuses.length} · next {nextPlanned}/{statuses.length}
      </span>
    </div>
  );
}

interface RowProps {
  status: AthleteStatus;
  enrichment: AthleteEnrichment;
  expanded: boolean;
  pulse: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onSetExpanded: () => void;
  onOpenPlanner: (status: AthleteStatus) => void;
}

function Row({
  status, enrichment, expanded, pulse, pinned,
  onTogglePin, onSetExpanded, onOpenPlanner,
}: RowProps) {
  const a = status.athlete;
  const tone = rowAlertTone(enrichment.flags);
  const tint = tone === 'danger' ? 'rgba(226,75,74,0.06)'
    : tone === 'warn'   ? 'rgba(239,159,39,0.07)'
    : 'transparent';
  const borderL = tone === 'danger' ? 'var(--color-danger-border)'
    : tone === 'warn'   ? 'var(--color-warning-border)'
    : 'transparent';

  const lastDays = status.lastTrainingDate
    ? Math.floor((Date.now() - status.lastTrainingDate.getTime()) / 86_400_000)
    : null;

  const nextEvent = enrichment.athleteEvents[0];

  return (
    <div id={`v2-row-${a.id}`}>
      <div
        onClick={onSetExpanded}
        style={{
          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 0,
          padding: '9px 14px',
          background: pulse ? 'rgba(24,95,165,0.10)'
            : expanded ? 'var(--color-bg-secondary)'
            : tint,
          borderBottom: '1px solid var(--color-border-tertiary)',
          borderLeft: `3px solid ${pulse ? 'var(--color-accent)' : borderL}`,
          cursor: 'pointer',
          minHeight: 44,
          transition: 'background 0.4s ease, border-left-color 0.4s ease',
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          title={pinned ? 'Unpin' : 'Pin to top'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: pinned ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            fontSize: 12, padding: 0, marginLeft: -3,
          }}
        >{pinned ? '★' : '☆'}</button>
        <span style={{
          color: 'var(--color-text-tertiary)', fontSize: 11, lineHeight: 1,
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
        }}>⋮⋮</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Avatar name={a.name} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{
              fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{a.name}</span>
            <span style={{
              fontSize: 10, color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono, ui-monospace), monospace',
            }}>
              {a.weight_class || '—'}
              {a.club ? ` · ${a.club}` : ''}
            </span>
          </div>
          <FlagDot flags={enrichment.flags} />
        </div>
        <div>
          <PhasePill
            name={enrichment.phaseName}
            color={enrichment.phaseColor}
            week={status.currentMacroWeek?.week_number ?? null}
            total={status.totalMacroWeeks}
          />
        </div>
        <span style={{
          fontSize: 11,
          color: lastDays !== null && lastDays > 4 ? 'var(--color-danger-text)' : 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
        }}>{lastTrainLabel(lastDays)}</span>
        <div>
          <RawChip pillars={enrichment.rawPillars} avg={status.rawAverage} size="sm" />
        </div>
        <ComplianceSpark values={enrichment.compTrend} />
        <BwDelta bw={enrichment.bw} />
        <div>
          <WeekPill
            state={status.currentWeekPlanned ? 'planned' : 'missing'}
            compact
          />
        </div>
        <div>
          <WeekPill
            state={status.nextWeekPlanned ? 'planned' : 'missing'}
            compact
          />
        </div>
        <div>
          {nextEvent ? (
            <EventTag
              name={nextEvent.note}
              kind={(nextEvent.eventData.event_type === 'competition' ? 'comp' : 'camp')}
              daysOut={nextEvent.daysUntil}
              compact
            />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>—</span>
          )}
        </div>
        <span style={{
          color: 'var(--color-text-tertiary)', fontSize: 11, textAlign: 'right',
        }}>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <AthleteExpansion
          status={status}
          enrichment={enrichment}
          onOpenPlanner={onOpenPlanner}
        />
      )}
    </div>
  );
}
