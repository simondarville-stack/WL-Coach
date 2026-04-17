import { getISOWeek } from '../../lib/dateUtils';

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

export interface MacroWeekEntry {
  /** 1-indexed week number within the macro */
  n: number;
  /** Phase display name, e.g. "Loading", "Build" */
  phase: string;
  /** Phase color (hex or CSS color string) */
  color: string;
  /** Week type display name, e.g. "High", "Testing", "Deload" */
  type: string;
}

export interface MacroPhaseBarEvent {
  id: string;
  kind: 'point' | 'range';
  /** For point events: the macro week number (1-indexed) and day 0-6 */
  week?: number;
  day?: number;
  /** For range events: start/end macro week + day */
  startWeek?: number;
  startDay?: number;
  endWeek?: number;
  endDay?: number;
  /** Display name shown in the tooltip */
  title: string;
}

export interface MacroPhaseBarProps {
  /** One entry per week of the macro, in order */
  weeks: MacroWeekEntry[];
  /** Optional events to mark with top-right dots + tooltip lines */
  events?: MacroPhaseBarEvent[];
  /** The macro's start date (Monday of week 1) as YYYY-MM-DD. Optional — tooltip skips date line when absent. */
  macroStartDate?: string | null;
  /** Currently selected (or viewed) week — 1-indexed. Null if none. */
  selectedWeek?: number | null;
  /** Callback fired when a week cell is clicked */
  onWeekClick?: (weekNum: number) => void;
  /**
   * Coach-defined week-type abbreviation map. Example:
   *   { High: 'H', Medium: 'M', Deload: 'D', Testing: 'Ts', Taper: 'Tp' }
   * If not provided, sensible defaults are used.
   */
  weekTypeAbbreviations?: Record<string, string>;
  /** Optional className for the outer wrapper */
  className?: string;
  /** Optional style overrides for the outer wrapper */
  style?: React.CSSProperties;
}

// ───────────────────────────────────────────────────────────────
// Defaults
// ───────────────────────────────────────────────────────────────

const DEFAULT_WEEK_TYPE_ABBR: Record<string, string> = {
  High: 'H',
  Medium: 'M',
  Low: 'L',
  Deload: 'D',
  Taper: 'Tp',
  Testing: 'Ts',
  Competition: 'C',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function formatDateEU(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

interface PhaseGroup {
  phase: string;
  color: string;
  startIdx: number;   // 0-indexed position of first week in this phase
  weekCount: number;
}

function computePhaseGroups(weeks: MacroWeekEntry[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  let current: PhaseGroup | null = null;
  weeks.forEach((w, i) => {
    if (!current || current.phase !== w.phase) {
      current = { phase: w.phase, color: w.color, startIdx: i, weekCount: 1 };
      groups.push(current);
    } else {
      current.weekCount++;
    }
  });
  return groups;
}

function eventsForWeek(
  weekNum: number,
  events: MacroPhaseBarEvent[]
): MacroPhaseBarEvent[] {
  return events.filter(ev => {
    if (ev.kind === 'point') return ev.week === weekNum;
    return weekNum >= (ev.startWeek ?? 0) && weekNum <= (ev.endWeek ?? 0);
  });
}

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

export function MacroPhaseBar({
  weeks,
  events = [],
  macroStartDate,
  selectedWeek = null,
  onWeekClick,
  weekTypeAbbreviations,
  className,
  style,
}: MacroPhaseBarProps) {
  const totalWeeks = weeks.length;
  if (totalWeeks === 0) return null;

  const abbr = weekTypeAbbreviations ?? DEFAULT_WEEK_TYPE_ABBR;
  const groups = computePhaseGroups(weeks);

  const buildTooltip = (w: MacroWeekEntry, cellEvents: MacroPhaseBarEvent[]): string => {
    const lines = [`W${w.n}`, `${w.phase} · ${w.type}`];
    if (macroStartDate) {
      const startDate = new Date(macroStartDate + 'T00:00:00');
      const weekStart = addDays(startDate, (w.n - 1) * 7);
      const weekEnd = addDays(weekStart, 6);
      const cw = getISOWeek(weekStart);
      lines.push(`Week ${cw} · ${formatDateEU(weekStart)} — ${formatDateEU(weekEnd)}`);
    }
    cellEvents.forEach(ev => lines.push(`• ${ev.title}`));
    return lines.join('\n');
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        paddingTop: '4px',
        paddingBottom: '4px',
        ...style,
      }}
    >
      {/* ── Phase label strip ── */}
      <div
        style={{
          display: 'flex',
          position: 'relative',
          height: '16px',
        }}
      >
        {groups.map((g, i) => {
          const leftPct = (g.startIdx / totalWeeks) * 100;
          const widthPct = (g.weekCount / totalWeeks) * 100;
          return (
            <div
              key={`${g.phase}-${i}`}
              style={{
                position: 'absolute',
                top: 0,
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                fontSize: 'var(--text-caption)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                paddingLeft: '6px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {g.weekCount >= 2 ? g.phase : ''}
            </div>
          );
        })}
      </div>

      {/* ── Bar ── */}
      <div style={{ position: 'relative' }}>
        {/* Cells */}
        <div
          style={{
            display: 'flex',
            position: 'relative',
            height: '36px',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {weeks.map(w => {
            const cellEvents = eventsForWeek(w.n, events);
            const tooltip = buildTooltip(w, cellEvents);
            const isSelected = selectedWeek != null && w.n === selectedWeek;

            return (
              <div
                key={w.n}
                title={tooltip}
                onClick={() => onWeekClick?.(w.n)}
                style={{
                  flex: 1,
                  position: 'relative',
                  background: w.color,
                  opacity: isSelected ? 1 : 0.7,
                  cursor: onWeekClick ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1px',
                  transition: 'filter 100ms ease-out, opacity 100ms ease-out',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
              >
                <span
                  style={{
                    fontSize: 'var(--text-caption)',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1,
                    color: 'rgba(255, 255, 255, 0.95)',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  {w.n}
                </span>
                {abbr[w.type] && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: 1,
                      color: 'rgba(255, 255, 255, 0.75)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {abbr[w.type]}
                  </span>
                )}
                {cellEvents.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '3px',
                      right: '3px',
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 1)',
                      boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.2)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Dividers: regular week boundaries inside the bar, phase changes extending up */}
        {weeks.slice(1).map((w, idx) => {
          const i = idx + 1;
          const isPhaseChange = w.phase !== weeks[i - 1].phase;
          const leftCalc = `calc(${(i / totalWeeks) * 100}% - 0.25px)`;

          if (isPhaseChange) {
            return (
              <div
                key={`phase-div-${i}`}
                style={{
                  position: 'absolute',
                  top: '-20px',
                  height: 'calc(36px + 20px)',
                  left: leftCalc,
                  width: '0.5px',
                  background: 'var(--color-border-secondary)',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}
              />
            );
          }
          return (
            <div
              key={`week-div-${i}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: leftCalc,
                width: '0.5px',
                background: 'rgba(255, 255, 255, 0.3)',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            />
          );
        })}

        {/* Playhead — extends 4px above and below the bar */}
        {selectedWeek != null && (
          <div
            style={{
              position: 'absolute',
              top: '-4px',
              bottom: '-4px',
              left: `calc(${((selectedWeek - 1) + 0.5) * (100 / totalWeeks)}% - 1px)`,
              width: '2px',
              background: 'var(--color-text-primary)',
              borderRadius: '1px',
              pointerEvents: 'none',
              zIndex: 6,
            }}
          />
        )}
      </div>
    </div>
  );
}
