import type { MacroPhaseBarCell } from '../components/planning/MacroPhaseBar';
import type {
  MacroCycle,
  MacroPhase,
  MacroWeek,
  WeekTypeConfig,
} from './database.types';

export interface MacroPhaseBarSource {
  macros: MacroCycle[];
  phases: MacroPhase[];
  weeks: MacroWeek[];
  weekTypeConfigs: WeekTypeConfig[];
}

/** Neutral gap color for weeks without a macro. */
const GAP_COLOR = 'var(--color-border-secondary)';

function findPhaseForWeek(phases: MacroPhase[], macroId: string, weekNumber: number): MacroPhase | null {
  return phases.find(p =>
    p.macrocycle_id === macroId &&
    weekNumber >= p.start_week_number &&
    weekNumber <= p.end_week_number
  ) ?? null;
}

function resolveWeekType(
  abbr: string | null | undefined,
  configs: WeekTypeConfig[]
): { abbr: string; name: string } {
  if (!abbr) return { abbr: '', name: '' };
  const wt = configs.find(c => c.abbreviation === abbr)
         ?? configs.find(c => c.name.toLowerCase() === abbr.toLowerCase());
  return {
    abbr: wt?.abbreviation ?? abbr,
    name: wt?.name ?? abbr,
  };
}

/**
 * Given a contiguous range of week_start dates (Mondays), return one
 * MacroPhaseBarCell per week. Weeks that fall inside a macro get the
 * macro's phase color + label "W{n}". Weeks outside any macro get a
 * gap cell (null phase, neutral color, empty label).
 */
export function buildCellsForWeekRange(
  weekStarts: string[],
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const { macros, phases, weeks, weekTypeConfigs } = source;

  return weekStarts.map(ws => {
    const weekRow = weeks.find(w => w.week_start === ws);
    const macro = weekRow
      ? macros.find(m => m.id === weekRow.macrocycle_id)
      : null;

    if (!weekRow || !macro) {
      return {
        weekStart: ws,
        phase: null,
        color: GAP_COLOR,
        typeAbbr: '',
        typeName: '',
        macroId: null,
        macroName: null,
        label: '',
      };
    }

    const phase = findPhaseForWeek(phases, macro.id, weekRow.week_number);
    const type = resolveWeekType(weekRow.week_type, weekTypeConfigs);

    return {
      weekStart: ws,
      phase: phase?.name ?? null,
      color: phase?.color ?? GAP_COLOR,
      typeAbbr: type.abbr,
      typeName: type.name,
      macroId: macro.id,
      macroName: macro.name,
      label: `W${weekRow.week_number}`,
    };
  });
}

/**
 * Build cells for a single macro from its first to last week.
 * Used by the weekly planner detail view which locks to one macro.
 */
export function buildCellsForSingleMacro(
  macro: MacroCycle,
  source: MacroPhaseBarSource
): MacroPhaseBarCell[] {
  const macroWeeks = source.weeks
    .filter(w => w.macrocycle_id === macro.id)
    .sort((a, b) => a.week_number - b.week_number);

  if (macroWeeks.length === 0) return [];

  const weekStarts = macroWeeks.map(w => w.week_start);
  return buildCellsForWeekRange(weekStarts, source);
}
