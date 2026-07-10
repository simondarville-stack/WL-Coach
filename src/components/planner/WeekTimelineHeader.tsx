// WeekTimelineHeader — the unified week-navigation header of the Weekly
// Planner. Merges the former WeekNavRibbon (Prev/Next + week meta) with the
// macro timeline into one band: the timeline IS the navigation. Shows the
// whole current macro plus dimmed context weeks; when no macro covers the
// selected week (gap weeks, groups without an athlete-level macro) it falls
// back to a continuous window centered on the selected week.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Table2 } from 'lucide-react';
import { MacroTimeline, MacroReviewTable } from '../planning';
import type { MacroContext } from './WeeklyPlanner';
import type { WeekTypeConfig } from '../../lib/database.types';
import { getWeekTypeColor } from '../../lib/weekUtils';
import { formatDateRange } from '../../lib/dateUtils';

const TABLE_TOGGLE_KEY = 'emos.planner.macroTable';

interface WeekTimelineHeaderProps {
  selectedDate: string;
  macroContext: MacroContext | null;
  weekTypes: WeekTypeConfig[];
  athleteId: string | null;
  groupId: string | null;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSelectWeek: (weekStart: string) => void;
}

const navButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, alignSelf: 'stretch',
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
};

export function WeekTimelineHeader({
  selectedDate,
  macroContext,
  weekTypes,
  athleteId,
  groupId,
  onPrevWeek,
  onNextWeek,
  onSelectWeek,
}: WeekTimelineHeaderProps) {
  const weekTypeColor = macroContext ? getWeekTypeColor(macroContext.weekType, weekTypes) : null;

  const [showTable, setShowTable] = useState(
    () => localStorage.getItem(TABLE_TOGGLE_KEY) === '1'
  );
  const toggleTable = () => {
    setShowTable(prev => {
      localStorage.setItem(TABLE_TOGGLE_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  return (
    <div style={{
      padding: '10px 12px 6px',
      background: 'var(--color-bg-secondary)',
      borderBottom: '0.5px solid var(--color-border-tertiary)',
    }}>
      {/* Nav + timeline band */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
        <button
          onClick={onPrevWeek}
          style={navButton}
          title="Previous week"
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronLeft size={15} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {macroContext ? (
            <MacroTimeline
              mode="macro"
              cycleId={macroContext.macroId}
              athleteId={athleteId}
              groupId={groupId}
              selectedWeekStart={selectedDate}
              onSelectWeek={onSelectWeek}
            />
          ) : (
            <MacroTimeline
              mode="continuous"
              centerWeekStart={selectedDate}
              athleteId={athleteId}
              groupId={groupId}
              selectedWeekStart={selectedDate}
              onSelectWeek={onSelectWeek}
            />
          )}
        </div>

        <button
          onClick={onNextWeek}
          style={navButton}
          title="Next week"
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Selected-week meta line */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        marginTop: 6, minWidth: 0, position: 'relative',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--text-label)', fontWeight: 600,
          color: 'var(--color-text-primary)', whiteSpace: 'nowrap',
        }}>
          {formatDateRange(selectedDate, 7)}
        </span>
        {macroContext && weekTypeColor && (
          <span style={{
            padding: '1px 7px', borderRadius: 'var(--radius-sm)',
            background: weekTypeColor + '1A', color: weekTypeColor,
            fontSize: 'var(--text-caption)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
          }}>
            {macroContext.weekTypeText || macroContext.weekType}
          </span>
        )}
        {macroContext && (
          <span style={{
            fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {macroContext.macroName}
            {macroContext.totalWeeks > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', marginLeft: 6 }}>
                W{macroContext.weekNumber}/{macroContext.totalWeeks}
              </span>
            )}
          </span>
        )}
        {macroContext && (
          <button
            onClick={toggleTable}
            title={showTable ? 'Hide macro table' : 'Show macro table — planned work vs. macro targets per lift'}
            style={{
              position: 'absolute', right: 0,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 6px',
              background: showTable ? 'var(--color-accent-muted)' : 'transparent',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--radius-sm)',
              color: showTable ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              fontSize: 'var(--text-caption)',
              cursor: 'pointer',
            }}
          >
            <Table2 size={12} />
            Table
          </button>
        )}
      </div>

      {/* Macro week note — the macro-level intent for this week, kept in
          view while the week is written. Coach-only (athletes never see
          macro notes; the week brief is the athlete-facing channel). */}
      {macroContext && macroContext.weekNotes.trim() !== '' && (
        <div
          title={macroContext.weekNotes}
          style={{
            marginTop: 4, textAlign: 'center',
            fontSize: 'var(--text-caption)', fontStyle: 'italic',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          ✎ {macroContext.weekNotes}
        </div>
      )}

      {/* Macro review table (toggleable) */}
      {showTable && macroContext && (
        <div style={{
          marginTop: 8, paddingTop: 6,
          borderTop: '0.5px solid var(--color-border-tertiary)',
        }}>
          <MacroReviewTable
            cycleId={macroContext.macroId}
            athleteId={athleteId}
            groupId={groupId}
            selectedWeekStart={selectedDate}
            onSelectWeek={onSelectWeek}
          />
        </div>
      )}
    </div>
  );
}
