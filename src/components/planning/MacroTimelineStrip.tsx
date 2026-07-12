// MacroTimelineStrip — pure presentational strip for the macro timeline.
// Lanes top→bottom: markers (competition flags / event dots + camp spans),
// months, phase labels, load-silhouette bar, week numbers, week types.
// All data arrives pre-built as TimelineWeek/TimelineMarker records
// (src/lib/macroTimelineData.ts); this component only draws.

import { getISOWeek } from '../../lib/dateUtils';
import type { TimelineWeek, TimelineMarker } from '../../lib/macroTimelineData';

export type TimelineMetric = 'reps' | 'tonnage';

export interface MacroTimelineStripProps {
  /** One entry per week, chronological. */
  weeks: TimelineWeek[];
  markers?: TimelineMarker[];
  /** Preferred metric for the load silhouette + actual marker (coach
   *  setting). Falls back to the other metric when no week in view carries
   *  this one. Default 'reps'. */
  metric?: TimelineMetric;
  /** Compliance threshold as a fraction (performed / week-planned); below it
   *  the compliance dot renders in the warning colour. Default 0.9. */
  complianceThreshold?: number;
  /** weekStart (Monday) of the selected week; gets the accent ring. */
  selectedWeekStart?: string | null;
  /** Today's exact date; the playhead is drawn at its day within the week. */
  todayDate?: string | null;
  onWeekClick?: (week: TimelineWeek) => void;
  /** Fired with the first week of the clicked phase group. */
  onPhaseClick?: (week: TimelineWeek) => void;
  showMonths?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// ── Layout constants ─────────────────────────────────────────────────────────

const BAR_HEIGHT = 38;
const MIN_FILL = 0.3;   // fraction of bar height for the lowest-load week
const NO_TARGET_FILL = 0.1; // sliver for macro weeks without a load target

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function formatDateEU(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatDateEUFromISO(iso: string): string {
  return formatDateEU(new Date(iso + 'T00:00:00'));
}

/** Monday-first day index (Mon=0 … Sun=6) of a YYYY-MM-DD date. */
function dayIndex(iso: string): number {
  return (new Date(iso + 'T00:00:00').getDay() + 6) % 7;
}

function isHex6(color: string | null): color is string {
  return !!color && /^#[0-9a-fA-F]{6}$/.test(color);
}

/** Phase tint for the cell background band; keeps the phase readable even
 *  where the load fill is low. */
function tintOf(color: string | null): string {
  if (isHex6(color)) return color + '2E';
  return 'var(--color-bg-secondary)';
}

function fillOf(color: string | null): string {
  return isHex6(color) ? color : 'var(--color-text-tertiary)';
}

interface Group { key: string; label: string; startIdx: number; weekCount: number; first: TimelineWeek }

function computePhaseGroups(weeks: TimelineWeek[]): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const key = `${w.macroId ?? ''}|${w.phaseName ?? ''}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.weekCount++;
    } else {
      groups.push({ key, label: w.phaseName ?? '', startIdx: i, weekCount: 1, first: w });
    }
  }
  return groups;
}

function computeMonthGroups(weeks: TimelineWeek[]): Group[] {
  const groups: Group[] = [];
  const years = new Set(weeks.map(w => w.weekStart.slice(0, 4)));
  const showYears = years.size > 1;
  let currentKey = '';
  let currentYear = '';
  weeks.forEach((w, i) => {
    const d = new Date(w.weekStart + 'T00:00:00');
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== currentKey) {
      const yr = String(d.getFullYear()).slice(2);
      const label = MONTHS[d.getMonth()] + (showYears && yr !== currentYear ? ` '${yr}` : '');
      groups.push({ key, label, startIdx: i, weekCount: 1, first: w });
      currentKey = key;
      currentYear = yr;
    } else {
      groups[groups.length - 1].weekCount++;
    }
  });
  return groups;
}

function formatTonnage(kg: number): string {
  return (kg / 1000).toFixed(1).replace('.', ',') + ' t';
}

function markersForWeek(week: TimelineWeek, markers: TimelineMarker[]): TimelineMarker[] {
  const weekEndIso = isoPlus(week.weekStart, 6);
  return markers.filter(m => {
    const end = m.endDate ?? m.date;
    return m.date <= weekEndIso && end >= week.weekStart;
  });
}

function buildTooltip(
  w: TimelineWeek,
  weekMarkers: TimelineMarker[],
  metric: TimelineMetric | null
): string {
  const lines: string[] = [];

  const head: string[] = [];
  if (w.weekNumber != null) head.push(`W${w.weekNumber}`);
  if (w.phaseName) head.push(w.phaseName);
  if (w.typeWarning && w.rawWeekType) head.push(`⚠ Unknown week type: "${w.rawWeekType}"`);
  else if (w.typeName) head.push(w.typeName);
  if (head.length) lines.push(head.join(' · '));
  if (w.macroName) lines.push(w.macroName);

  const start = new Date(w.weekStart + 'T00:00:00');
  lines.push(`Week ${getISOWeek(start)} · ${formatDateEU(start)} — ${formatDateEU(addDays(start, 6))}`);

  const targets: string[] = [];
  if (w.repsTarget != null) targets.push(`K ${w.repsTarget}`);
  if (w.tonnageTarget != null) targets.push(formatTonnage(w.tonnageTarget));
  if (targets.length) lines.push(`Target: ${targets.join(' · ')}`);

  // Week-programmed (micro-level plan) — expressed against the macro-level
  // target of the metric that drives the silhouette.
  if (w.programmedReps != null || w.programmedTonnage != null) {
    const programmed: string[] = [];
    if (w.programmedReps != null && w.programmedReps > 0) programmed.push(`K ${w.programmedReps}`);
    if (w.programmedTonnage != null && w.programmedTonnage > 0) programmed.push(formatTonnage(w.programmedTonnage));
    if (programmed.length) {
      let vsTarget = '';
      const programmedV = metric === 'tonnage' ? w.programmedTonnage : w.programmedReps;
      const targetV = metric === 'tonnage' ? w.tonnageTarget : w.repsTarget;
      if (metric && programmedV != null && targetV != null && targetV > 0) {
        vsTarget = ` (${Math.round((programmedV / targetV) * 100)} %)`;
      }
      lines.push(`Planned: ${programmed.join(' · ')}${vsTarget}`);
    }
  }

  // Performed (logged) — expressed against the week plan.
  if (w.performedReps != null || w.performedTonnage != null) {
    const performed: string[] = [];
    if (w.performedReps != null && w.performedReps > 0) performed.push(`K ${w.performedReps}`);
    if (w.performedTonnage != null && w.performedTonnage > 0) performed.push(formatTonnage(w.performedTonnage));
    if (performed.length) {
      let vsPlanned = '';
      const performedV = metric === 'tonnage' ? w.performedTonnage : w.performedReps;
      const plannedV = metric === 'tonnage' ? w.programmedTonnage : w.programmedReps;
      if (metric && performedV != null && plannedV != null && plannedV > 0) {
        vsPlanned = ` (${Math.round((performedV / plannedV) * 100)} % of plan)`;
      }
      lines.push(`Done: ${performed.join(' · ')}${vsPlanned}`);
    }
  }

  if (w.notes.trim()) lines.push(`✎ ${w.notes.trim()}`);
  weekMarkers.forEach(m => {
    lines.push(`${m.kind === 'competition' ? '⚑' : '•'} ${m.title} (${formatDateEUFromISO(m.date)})`);
  });
  return lines.join('\n');
}

// ── Component ────────────────────────────────────────────────────────────────

export function MacroTimelineStrip({
  weeks,
  markers = [],
  metric: preferredMetric = 'reps',
  complianceThreshold = 0.9,
  selectedWeekStart = null,
  todayDate = null,
  onWeekClick,
  onPhaseClick,
  showMonths = true,
  className,
  style,
}: MacroTimelineStripProps) {
  const total = weeks.length;
  if (total === 0) return null;

  const phaseGroups = computePhaseGroups(weeks);
  const monthGroups = showMonths ? computeMonthGroups(weeks) : [];
  const cellPct = 100 / total;

  // ── Load silhouette normalisation ──
  // The coach's preferred metric (settings) drives the silhouette; fall back
  // to the other metric when no week in view carries the preferred one
  // (neither as target nor as logged actual). Weeks without a value get a
  // baseline sliver so the phase band stays visible; when NO week has any
  // target the fill is full-height (classic solid bar).
  const hasMetric = (m: TimelineMetric) =>
    weeks.some(w => (m === 'reps' ? w.repsTarget ?? w.programmedReps : w.tonnageTarget ?? w.programmedTonnage) != null);
  const otherMetric: TimelineMetric = preferredMetric === 'reps' ? 'tonnage' : 'reps';
  const metric: TimelineMetric | null = hasMetric(preferredMetric)
    ? preferredMetric
    : hasMetric(otherMetric) ? otherMetric : null;

  const targetOf = (w: TimelineWeek): number | null =>
    metric === 'reps' ? w.repsTarget : metric === 'tonnage' ? w.tonnageTarget : null;
  const programmedOf = (w: TimelineWeek): number | null => {
    const v = metric === 'reps' ? w.programmedReps : metric === 'tonnage' ? w.programmedTonnage : null;
    return v != null && v > 0 ? v : null;
  };
  const performedOf = (w: TimelineWeek): number | null => {
    const v = metric === 'reps' ? w.performedReps : metric === 'tonnage' ? w.performedTonnage : null;
    return v != null && v > 0 ? v : null;
  };

  // Macro target and week-programmed share one scale, so the tick reads
  // directly against the fill's top edge: above = programmed over the macro
  // target, below = under.
  const maxValue = metric
    ? Math.max(...weeks.map(w => Math.max(targetOf(w) ?? 0, programmedOf(w) ?? 0, performedOf(w) ?? 0)), 1)
    : 1;
  const scaled = (v: number): number => MIN_FILL + (1 - MIN_FILL) * (v / maxValue);
  const anyTarget = metric != null && weeks.some(w => targetOf(w) != null);
  const fillFraction = (w: TimelineWeek): number => {
    if (w.macroId === null) return 0;
    if (!anyTarget) return 1;
    const v = targetOf(w);
    if (v == null) return NO_TARGET_FILL;
    return scaled(v);
  };
  const programmedFraction = (w: TimelineWeek): number | null => {
    const v = programmedOf(w);
    // Without any target in view the fill is a full solid bar on an
    // arbitrary scale — a programmed tick would be meaningless there.
    if (v == null || !anyTarget) return null;
    return Math.min(scaled(v), 1);
  };
  const performedFraction = (w: TimelineWeek): number | null => {
    const v = performedOf(w);
    if (v == null || !anyTarget) return null;
    return Math.min(scaled(v), 1);
  };
  /** true = compliant, false = under threshold, null = not comparable. */
  const complianceOf = (w: TimelineWeek): boolean | null => {
    const done = performedOf(w);
    const planned = programmedOf(w);
    if (done == null || planned == null || planned <= 0) return null;
    return done / planned >= complianceThreshold;
  };

  // ── Marker positioning ──
  const idxByWeekStart = new Map(weeks.map((w, i) => [w.weekStart, i]));
  const rangeStart = weeks[0].weekStart;
  const rangeEnd = isoPlus(weeks[total - 1].weekStart, 6);
  const positionOf = (dateIso: string): number | null => {
    const monday = weeks.find(w => dateIso >= w.weekStart && dateIso <= isoPlus(w.weekStart, 6));
    if (!monday) return null;
    const idx = idxByWeekStart.get(monday.weekStart)!;
    return (idx + (dayIndex(dateIso) + 0.5) / 7) * cellPct;
  };
  /** Like positionOf, but clamps dates outside the window to its edges —
   *  used for range spans that only partially overlap the visible weeks. */
  const clampedPositionOf = (dateIso: string): number | null => {
    if (dateIso < rangeStart) return 0;
    if (dateIso > rangeEnd) return 100;
    return positionOf(dateIso);
  };

  // ── Playhead ──
  const playheadPct = todayDate ? positionOf(todayDate) : null;

  const hasMarkers = markers.length > 0;
  const hasTypes = weeks.some(w => w.typeAbbr !== '');

  return (
    <div className={className} style={{ position: 'relative', ...style }}>

      {/* Markers lane */}
      {hasMarkers && (
        <div style={{ position: 'relative', height: 17, marginBottom: 1 }}>
          {markers.map(m => {
            const startPct = m.endDate ? clampedPositionOf(m.date) : positionOf(m.date);
            if (startPct == null) return null;
            const endPct = m.endDate ? clampedPositionOf(m.endDate) : null;
            const tip = `${m.title} · ${formatDateEUFromISO(m.date)}${m.endDate ? ` — ${formatDateEUFromISO(m.endDate)}` : ''}`;
            const color = m.color || (m.kind === 'competition' ? 'var(--color-danger-text, #C2410C)' : 'var(--color-text-tertiary)');

            if (m.kind === 'competition') {
              // Near the right edge, the label flips to the left of the pole
              // so it never overflows the strip.
              const flip = startPct > 82;
              return (
                <div
                  key={m.id}
                  title={tip}
                  style={{
                    position: 'absolute', bottom: 0,
                    ...(flip
                      ? { right: `${100 - startPct}%`, flexDirection: 'row-reverse' as const, transform: 'translateX(5px)' }
                      : { left: `${startPct}%`, transform: 'translateX(-4px)' }),
                    display: 'flex', alignItems: 'flex-end', gap: 3,
                    maxWidth: `${Math.max(cellPct * 3, 12)}%`,
                    pointerEvents: 'auto', zIndex: 2,
                  }}
                >
                  {/* Pennant flag: pole + triangle */}
                  <svg width="9" height="16" viewBox="0 0 9 16" style={{ flexShrink: 0, display: 'block', transform: flip ? 'scaleX(-1)' : undefined }}>
                    <line x1="1" y1="0.5" x2="1" y2="16" stroke={color} strokeWidth="1.6" />
                    <path
                      d="M2 1 L9 3.75 L2 6.5 Z"
                      fill={m.primary ? color : 'var(--color-bg-primary)'}
                      stroke={color}
                      strokeWidth="1.2"
                    />
                  </svg>
                  <span style={{
                    fontSize: 9, lineHeight: '11px', fontWeight: m.primary ? 700 : 500,
                    color, fontFamily: 'var(--font-sans)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    userSelect: 'none',
                  }}>
                    {m.title}
                  </span>
                </div>
              );
            }

            // Non-competition events: dot, or thin span for multi-day ranges.
            if (endPct != null && endPct > startPct) {
              return (
                <div
                  key={m.id}
                  title={tip}
                  style={{
                    position: 'absolute', bottom: 3, left: `${startPct}%`,
                    width: `${endPct - startPct}%`, height: 3,
                    borderRadius: 2, background: color, opacity: 0.75,
                  }}
                />
              );
            }
            return (
              <div
                key={m.id}
                title={tip}
                style={{
                  position: 'absolute', bottom: 2, left: `calc(${startPct}% - 2.5px)`,
                  width: 5, height: 5, borderRadius: '50%', background: color,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Months lane */}
      {showMonths && (
        <div style={{ position: 'relative', height: 13, marginBottom: 1 }}>
          {monthGroups.map(g => (
            <div
              key={g.key + g.startIdx}
              style={{
                position: 'absolute', top: 0,
                left: `${g.startIdx * cellPct}%`, width: `${g.weekCount * cellPct}%`,
                fontSize: 9, lineHeight: '13px',
                color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)',
                letterSpacing: '0.03em', whiteSpace: 'nowrap',
                overflow: 'hidden', paddingLeft: 4,
                borderLeft: '0.5px solid var(--color-border-tertiary)',
                pointerEvents: 'none', userSelect: 'none',
              }}
            >
              {g.label}
            </div>
          ))}
        </div>
      )}

      {/* Phase labels lane */}
      <div style={{ position: 'relative', height: 15 }}>
        {phaseGroups.map(g => {
          const clickable = !!onPhaseClick && g.first.macroId !== null && g.first.phaseName !== null;
          return (
            <div
              key={g.key + g.startIdx}
              onClick={clickable ? e => { e.stopPropagation(); onPhaseClick!(g.first); } : undefined}
              title={clickable ? `${g.first.macroName} · ${g.label}` : undefined}
              style={{
                position: 'absolute', top: 0,
                left: `${g.startIdx * cellPct}%`, width: `${g.weekCount * cellPct}%`,
                fontSize: 'var(--text-caption)', lineHeight: '15px', fontWeight: 500,
                color: g.first.phaseColor ?? 'var(--color-text-secondary)',
                fontFamily: 'var(--font-sans)', letterSpacing: '0.02em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                paddingLeft: 4,
                cursor: clickable ? 'pointer' : 'default',
                pointerEvents: clickable ? 'auto' : 'none',
                userSelect: 'none',
                opacity: g.first.isContext ? 0.45 : 1,
              }}
              onMouseEnter={clickable ? e => { e.currentTarget.style.textDecoration = 'underline'; } : undefined}
              onMouseLeave={clickable ? e => { e.currentTarget.style.textDecoration = 'none'; } : undefined}
            >
              {g.label}
            </div>
          );
        })}
      </div>

      {/* Silhouette bar */}
      <div style={{ position: 'relative' }}>
        <div style={{
          display: 'flex', position: 'relative',
          height: BAR_HEIGHT, borderRadius: 3, overflow: 'hidden',
        }}>
          {weeks.map(w => {
            const weekMarkers = markersForWeek(w, markers);
            const isSelected = selectedWeekStart != null && w.weekStart === selectedWeekStart;
            const frac = fillFraction(w);
            const programmedFrac = programmedFraction(w);
            const performedFrac = performedFraction(w);
            const compliant = complianceOf(w);
            const isGap = w.macroId === null;
            return (
              <div
                key={w.weekStart}
                title={buildTooltip(w, weekMarkers, metric)}
                onClick={onWeekClick ? () => onWeekClick(w) : undefined}
                style={{
                  flex: 1, position: 'relative', minWidth: 0,
                  background: isGap ? 'var(--color-bg-tertiary)' : tintOf(w.phaseColor),
                  cursor: onWeekClick ? 'pointer' : 'default',
                  opacity: w.isContext ? 0.4 : 1,
                  boxShadow: isSelected
                    ? 'inset 0 0 0 1.5px var(--color-accent)'
                    : 'inset -0.5px 0 0 0 var(--color-bg-primary)',
                  zIndex: isSelected ? 2 : 1,
                  transition: 'filter 100ms ease-out',
                }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
              >
                {/* Load fill */}
                {frac > 0 && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    height: `${frac * 100}%`,
                    background: w.typeWarning ? 'var(--color-warning-border)' : fillOf(w.phaseColor),
                    pointerEvents: 'none',
                  }} />
                )}
                {/* Performed (logged) bar — inner bar against the same scale,
                    so done reads directly against target fill and plan tick. */}
                {performedFrac != null && (
                  <div style={{
                    position: 'absolute', right: '10%', width: '36%', bottom: 0,
                    height: `${performedFrac * 100}%`,
                    background: 'var(--color-text-primary)',
                    opacity: 0.5,
                    borderRadius: '1px 1px 0 0',
                    pointerEvents: 'none', zIndex: 1,
                  }} />
                )}
                {/* Compliance dot: performed vs week-planned ≥/< threshold */}
                {compliant != null && (
                  <span style={{
                    position: 'absolute', top: 3, left: 3,
                    width: 5, height: 5, borderRadius: '50%',
                    background: compliant ? 'var(--color-success-border)' : 'var(--color-warning-border)',
                    boxShadow: '0 0 0 1px var(--color-bg-primary)',
                    pointerEvents: 'none', zIndex: 2,
                  }} />
                )}
                {/* Week-programmed tick — reads against the fill's top edge:
                    above = programmed over the macro target, below = under. */}
                {programmedFrac != null && (
                  <div style={{
                    position: 'absolute', left: '18%', right: '18%',
                    bottom: `calc(${programmedFrac * 100}% - 1px)`,
                    height: 2, borderRadius: 1,
                    background: 'var(--color-text-primary)',
                    boxShadow: '0 0 0 0.5px var(--color-bg-primary)',
                    pointerEvents: 'none', zIndex: 2,
                  }} />
                )}
                {/* Notes dot */}
                {w.notes.trim() !== '' && (
                  <span style={{
                    position: 'absolute', top: 3, right: 3,
                    width: 4, height: 4, borderRadius: '50%',
                    background: 'var(--color-text-secondary)',
                    boxShadow: '0 0 0 1px var(--color-bg-primary)',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Phase / macro boundary dividers (raised through the label lane) */}
        {weeks.slice(1).map((w, idx) => {
          const i = idx + 1;
          const prev = weeks[i - 1];
          const boundary = w.macroId !== prev.macroId || (w.phaseName ?? '') !== (prev.phaseName ?? '');
          if (!boundary) return null;
          return (
            <div
              key={`div-${w.weekStart}`}
              style={{
                position: 'absolute', top: -15, height: BAR_HEIGHT + 15,
                left: `calc(${i * cellPct}% - 0.25px)`, width: 0.5,
                background: 'var(--color-border-secondary)',
                pointerEvents: 'none', zIndex: 3,
              }}
            />
          );
        })}

        {/* Playhead (today) */}
        {playheadPct != null && (
          <div style={{
            position: 'absolute', top: -3, bottom: -3,
            left: `calc(${playheadPct}% - 1px)`, width: 2,
            background: 'var(--color-text-primary)', borderRadius: 1,
            pointerEvents: 'none', zIndex: 5,
          }} />
        )}
      </div>

      {/* Week number lane */}
      <div style={{ display: 'flex', marginTop: 2 }}>
        {weeks.map(w => {
          const isSelected = selectedWeekStart != null && w.weekStart === selectedWeekStart;
          return (
            <div
              key={`n-${w.weekStart}`}
              style={{
                flex: 1, minWidth: 0, textAlign: 'center',
                fontSize: 9, lineHeight: '11px',
                fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                fontWeight: isSelected ? 700 : 400,
                color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                opacity: w.isContext ? 0.5 : 1,
                whiteSpace: 'nowrap', overflow: 'hidden',
                pointerEvents: 'none', userSelect: 'none',
              }}
            >
              {w.weekNumber != null ? w.weekNumber : ''}
            </div>
          );
        })}
      </div>

      {/* Week type lane */}
      {hasTypes && (
        <div style={{ display: 'flex' }}>
          {weeks.map(w => (
            <div
              key={`t-${w.weekStart}`}
              style={{
                flex: 1, minWidth: 0, textAlign: 'center',
                fontSize: 8, lineHeight: '10px',
                fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
                fontWeight: w.typeWarning ? 700 : 500,
                color: w.typeWarning
                  ? 'var(--color-warning-text)'
                  : (w.typeColor ?? 'var(--color-text-tertiary)'),
                opacity: w.isContext ? 0.5 : 1,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap', overflow: 'hidden',
                pointerEvents: 'none', userSelect: 'none',
              }}
            >
              {w.typeWarning ? '?' : w.typeAbbr}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** ISO date + n days (local, no TZ drift for date-only strings). */
function isoPlus(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
