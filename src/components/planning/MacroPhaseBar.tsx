import { getISOWeek } from '../../lib/dateUtils';

// ───────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────

/**
 * One cell in the bar. Each cell represents a single week.
 *
 * A cell can belong to a macro (phase + type + label populated) or be
 * a "gap" cell for weeks that fall outside any macro (phase = null,
 * neutral color, no label/type). Gap cells are used in the overview
 * to render the space between macros — in the detail view, all cells
 * should belong to the current macro.
 */
export interface MacroPhaseBarCell {
  /** The week's week_start as YYYY-MM-DD (Monday). */
  weekStart: string;
  /** Phase display name. Null = gap cell. */
  phase: string | null;
  /** Phase color (hex or CSS). Gap cells use a neutral token. */
  color: string;
  /** Week-type abbreviation shown under the week label. Empty = none. */
  typeAbbr: string;
  /** Full week-type name used in the tooltip. Empty = none. */
  typeName: string;
  /** Macro ID the cell belongs to, null for gap cells. */
  macroId: string | null;
  /** Macro display name for the tooltip. Null for gap cells. */
  macroName: string | null;
  /** Label shown inside the cell, e.g. "W3". Empty for gap cells. */
  label: string;
}

export interface MacroPhaseBarEvent {
  id: string;
  kind: 'point' | 'range';
  /** For point events: the week's weekStart + day 0-6 */
  weekStart?: string;
  day?: number;
  /** For range events: start/end weekStart + start/end day 0-6 */
  startWeekStart?: string;
  startDay?: number;
  endWeekStart?: string;
  endDay?: number;
  /** Display name shown in the tooltip */
  title: string;
}

export interface MacroPhaseBarProps {
  /** One cell per week, in chronological order */
  cells: MacroPhaseBarCell[];
  /** Optional events to mark with top-right dots + tooltip lines */
  events?: MacroPhaseBarEvent[];
  /** weekStart of the currently selected week. Null if none. */
  selectedWeekStart?: string | null;
  /**
   * Exact YYYY-MM-DD date for the playhead. When provided, the playhead
   * is positioned at the day within the cell rather than the cell center.
   * Falls back to the center of selectedWeekStart when omitted.
   */
  playheadDate?: string | null;
  /** Called when a cell is clicked */
  onCellClick?: (cell: MacroPhaseBarCell) => void;
  /** Optional className for the outer wrapper */
  className?: string;
  /** Optional inline style overrides */
  style?: React.CSSProperties;
}

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  startIdx: number;
  weekCount: number;
}

/**
 * Group consecutive cells that share (macroId, phase). A new group
 * starts when either changes. Gap cells (phase = null) form their own
 * groups with empty phase names — they carry no label.
 */
function computePhaseGroups(cells: MacroPhaseBarCell[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  let current: PhaseGroup | null = null;
  let currentMacroId: string | null = null;
  cells.forEach((c, i) => {
    const phaseKey = c.phase ?? '';
    if (!current || current.phase !== phaseKey || currentMacroId !== c.macroId) {
      current = { phase: phaseKey, startIdx: i, weekCount: 1 };
      groups.push(current);
      currentMacroId = c.macroId;
    } else {
      current.weekCount++;
    }
  });
  return groups;
}

function eventsForCell(
  cell: MacroPhaseBarCell,
  events: MacroPhaseBarEvent[]
): MacroPhaseBarEvent[] {
  return events.filter(ev => {
    if (ev.kind === 'point') return ev.weekStart === cell.weekStart;
    if (!ev.startWeekStart || !ev.endWeekStart) return false;
    return cell.weekStart >= ev.startWeekStart && cell.weekStart <= ev.endWeekStart;
  });
}

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

export function MacroPhaseBar({
  cells,
  events = [],
  selectedWeekStart = null,
  playheadDate = null,
  onCellClick,
  className,
  style,
}: MacroPhaseBarProps) {
  const total = cells.length;
  if (total === 0) return null;

  const groups = computePhaseGroups(cells);

  const buildTooltip = (
    c: MacroPhaseBarCell,
    cellEvents: MacroPhaseBarEvent[]
  ): string => {
    const lines: string[] = [];
    if (c.label) lines.push(c.label);

    const metaParts: string[] = [];
    if (c.macroName) metaParts.push(c.macroName);
    if (c.phase) metaParts.push(c.phase);
    if (c.typeName) metaParts.push(c.typeName);
    if (metaParts.length) lines.push(metaParts.join(' · '));

    const weekStart = new Date(c.weekStart + 'T00:00:00');
    const weekEnd = addDays(weekStart, 6);
    const cw = getISOWeek(weekStart);
    lines.push(`Week ${cw} · ${formatDateEU(weekStart)} — ${formatDateEU(weekEnd)}`);

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
      {/* Phase label strip */}
      <div style={{ display: 'flex', position: 'relative', height: '16px' }}>
        {groups.map((g, i) => {
          const leftPct = (g.startIdx / total) * 100;
          const widthPct = (g.weekCount / total) * 100;
          return (
            <div
              key={`ph-${i}`}
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
              {g.phase}
            </div>
          );
        })}
      </div>

      {/* Bar */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            position: 'relative',
            height: '36px',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {cells.map(c => {
            const cellEvents = eventsForCell(c, events);
            const tooltip = buildTooltip(c, cellEvents);
            const isSelected =
              selectedWeekStart != null && c.weekStart === selectedWeekStart;
            const isGap = c.phase === null;

            return (
              <div
                key={c.weekStart}
                title={tooltip}
                onClick={() => onCellClick?.(c)}
                style={{
                  flex: 1,
                  position: 'relative',
                  background: c.color,
                  opacity: isSelected ? 1 : 0.7,
                  cursor: onCellClick ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1px',
                  transition:
                    'filter 100ms ease-out, opacity 100ms ease-out',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.filter = 'brightness(1.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.filter = 'none';
                }}
              >
                {!isGap && c.label && (
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
                    {c.label}
                  </span>
                )}
                {!isGap && c.typeAbbr && (
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
                    {c.typeAbbr}
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

        {/* Dividers */}
        {cells.slice(1).map((c, idx) => {
          const i = idx + 1;
          const prev = cells[i - 1];
          const isMacroChange = c.macroId !== prev.macroId;
          const isPhaseChange = (c.phase ?? '') !== (prev.phase ?? '');
          const raised = isMacroChange || isPhaseChange;
          const leftCalc = `calc(${(i / total) * 100}% - 0.25px)`;

          if (raised) {
            return (
              <div
                key={`d-${i}`}
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
              key={`d-${i}`}
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

        {/* Playhead */}
        {selectedWeekStart &&
          (() => {
            const selIdx = cells.findIndex(c => c.weekStart === selectedWeekStart);
            if (selIdx < 0) return null;
            let dayFraction = 0.5;
            if (playheadDate) {
              const cellDate = new Date(cells[selIdx].weekStart + 'T00:00:00');
              const today = new Date(playheadDate + 'T00:00:00');
              const diffDays = Math.round((today.getTime() - cellDate.getTime()) / 86400000);
              const clampedDiff = Math.max(0, Math.min(6, diffDays));
              dayFraction = (clampedDiff + 0.5) / 7;
            }
            const leftPct = (selIdx + dayFraction) * (100 / total);
            return (
              <div
                style={{
                  position: 'absolute',
                  top: '-4px',
                  bottom: '-4px',
                  left: `calc(${leftPct}% - 1px)`,
                  width: '2px',
                  background: 'var(--color-text-primary)',
                  borderRadius: '1px',
                  pointerEvents: 'none',
                  zIndex: 6,
                }}
              />
            );
          })()}
      </div>
    </div>
  );
}
