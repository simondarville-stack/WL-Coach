// WeekNavRibbon — the primary week navigation. A full-width ribbon (its own
// band, distinct from the week summary) so flipping weeks reads as a top-level
// action. Shows the current week's date range plus macro / week-type context.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekTypeConfig } from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { getWeekTypeColor } from '../../lib/weekUtils';
import { formatDateRange } from '../../lib/dateUtils';

interface WeekNavRibbonProps {
  selectedDate: string;
  macroContext: MacroContext | null;
  weekTypes: WeekTypeConfig[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

const navButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  height: 30, padding: '0 12px',
  background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--text-label)', fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

export function WeekNavRibbon({ selectedDate, macroContext, weekTypes, onPrevWeek, onNextWeek }: WeekNavRibbonProps) {
  const weekTypeColor = macroContext ? getWeekTypeColor(macroContext.weekType, weekTypes) : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '8px 12px', marginBottom: 16,
      background: 'var(--color-bg-secondary)',
      border: '0.5px solid var(--color-border-tertiary)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <button onClick={onPrevWeek} style={navButton} title="Previous week">
        <ChevronLeft size={15} /> Prev
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, justifyContent: 'center' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--text-section)', fontWeight: 600, color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
        }}>
          {formatDateRange(selectedDate, 7)}
        </span>
        {macroContext && weekTypeColor && (
          <span style={{
            padding: '2px 8px', borderRadius: 'var(--radius-sm)',
            background: weekTypeColor + '1A', color: weekTypeColor,
            fontSize: 'var(--text-caption)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
          }}>
            {macroContext.weekTypeText || macroContext.weekType}
          </span>
        )}
        {macroContext && (
          <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {macroContext.macroName}
            {macroContext.totalWeeks > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', marginLeft: 6 }}>
                W{macroContext.weekNumber}/{macroContext.totalWeeks}
              </span>
            )}
          </span>
        )}
      </div>

      <button onClick={onNextWeek} style={navButton} title="Next week">
        Next <ChevronRight size={15} />
      </button>
    </div>
  );
}
