// MacroTimeline — data container for the macro timeline strip.
//
// Two modes:
// - 'macro':      the whole anchor macro W1→Wn plus `contextWeeks` dimmed
//                 weeks on each side (neighbouring macros / gaps stay
//                 visible and clickable). Used by the Weekly Planner header
//                 and the Macro Cycles page.
// - 'continuous': a fixed window around `centerWeekStart`, crossing macro
//                 boundaries freely. Used by the planner week overview and
//                 as the planner-header fallback when no macro covers the
//                 selected week. Controlled — the parent owns the center.
//
// Clicking a week navigates to that week in the planner (overridable via
// onSelectWeek); clicking a phase label opens the macro page (overridable
// via onPhaseClick).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../hooks/useSettings';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, toLocalISO } from '../../lib/dateUtils';
import {
  buildTimelineWeeks,
  continuousRangeWeekStarts,
  fetchTimelineMarkers,
  fetchTimelineSource,
  fetchWeeklyPerformed,
  fetchWeeklyProgrammed,
  macroRangeWeekStarts,
  resolveScopeAthleteIds,
  type TimelineMarker,
  type TimelineWeek,
  type WeeklyPerformed,
  type WeeklyProgrammed,
} from '../../lib/macroTimelineData';
import { MacroTimelineStrip } from './MacroTimelineStrip';
import type { MacroCycle, MacroPhase, MacroWeek } from '../../lib/database.types';

const CONTINUOUS_WEEKS_BACK = 5;
const CONTINUOUS_WEEKS_FORWARD = 6;
const DEFAULT_CONTEXT_WEEKS = 3;

type CommonProps = {
  athleteId: string | null;
  groupId: string | null;
  /** weekStart of the week highlighted with the accent ring. */
  selectedWeekStart?: string | null;
  /** Overrides the default navigate(`/planner/${weekStart}`). */
  onSelectWeek?: (weekStart: string) => void;
  /** Overrides the default navigate(`/macrocycles/${macroId}`). */
  onPhaseClick?: (week: TimelineWeek) => void;
  showMonths?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

type MacroModeProps = CommonProps & {
  mode: 'macro';
  cycleId: string;
  /** Dimmed weeks shown on each side of the macro (0 = macro only). */
  contextWeeks?: number;
};

type ContinuousModeProps = CommonProps & {
  mode: 'continuous';
  /** Monday the window centers on; defaults to the current week. */
  centerWeekStart?: string;
};

export type MacroTimelineProps = MacroModeProps | ContinuousModeProps;

export function MacroTimeline(props: MacroTimelineProps) {
  const navigate = useNavigate();
  const { settings, fetchSettingsSilent } = useSettings();

  useEffect(() => {
    void fetchSettingsSilent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [macros, setMacros] = useState<MacroCycle[]>([]);
  const [phases, setPhases] = useState<MacroPhase[]>([]);
  const [macroWeeks, setMacroWeeks] = useState<MacroWeek[]>([]);
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [programmed, setProgrammed] = useState<Map<string, WeeklyProgrammed>>(() => new Map());
  const [performed, setPerformed] = useState<Map<string, WeeklyPerformed>>(() => new Map());

  const todayMonday = getMondayOfWeekISO(new Date());
  const todayIso = toLocalISO(new Date());
  const cycleId = props.mode === 'macro' ? props.cycleId : null;

  // ── Load macros + phases + macro_weeks (committed atomically so the
  //    strip never renders a half-loaded snapshot) ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const source = await fetchTimelineSource(
          props.athleteId,
          props.groupId,
          cycleId ?? undefined
        );
        if (cancelled) return;
        setMacros(source.macros);
        setPhases(source.phases);
        setMacroWeeks(source.weeks);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroTimeline: load failed', err);
        setMacros([]);
        setPhases([]);
        setMacroWeeks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [props.athleteId, props.groupId, cycleId]);

  // ── Build week cells ──
  const centerWeekStart =
    props.mode === 'continuous'
      ? (props.centerWeekStart ?? todayMonday)
      : null;

  const weeks: TimelineWeek[] = useMemo(() => {
    const source = {
      macros,
      phases,
      weeks: macroWeeks,
      weekTypeConfigs: settings?.week_types ?? [],
    };

    if (props.mode === 'macro') {
      const weekStarts = macroRangeWeekStarts(
        props.cycleId,
        macroWeeks,
        props.contextWeeks ?? DEFAULT_CONTEXT_WEEKS
      );
      return buildTimelineWeeks(weekStarts, source, props.cycleId);
    }

    const weekStarts = continuousRangeWeekStarts(
      centerWeekStart ?? todayMonday,
      CONTINUOUS_WEEKS_BACK,
      CONTINUOUS_WEEKS_FORWARD
    );
    return buildTimelineWeeks(weekStarts, source);
  }, [
    props.mode,
    cycleId,
    props.mode === 'macro' ? props.contextWeeks : null,
    centerWeekStart,
    macros,
    phases,
    macroWeeks,
    settings?.week_types,
    todayMonday,
  ]);

  // ── Load markers (competitions + events) and week-programmed volume for
  //    the visible range ──
  useEffect(() => {
    if (weeks.length === 0) {
      setMarkers([]);
      setProgrammed(new Map());
      setPerformed(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const athleteIds = await resolveScopeAthleteIds(props.athleteId, props.groupId);
        if (cancelled) return;
        const macroIds = [...new Set(weeks.map(w => w.macroId).filter((id): id is string => id !== null))];
        const rangeStart = weeks[0].weekStart;
        const lastWeekStart = weeks[weeks.length - 1].weekStart;
        const rangeEnd = addDaysToISO(lastWeekStart, 6);
        const [fetchedMarkers, fetchedProgrammed, fetchedPerformed] = await Promise.all([
          fetchTimelineMarkers(athleteIds, macroIds, rangeStart, rangeEnd),
          fetchWeeklyProgrammed(props.athleteId, props.groupId, rangeStart, lastWeekStart),
          fetchWeeklyPerformed(athleteIds, rangeStart, lastWeekStart),
        ]);
        if (cancelled) return;
        setMarkers(fetchedMarkers);
        setProgrammed(fetchedProgrammed);
        setPerformed(fetchedPerformed);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroTimeline: markers/volume load failed', err);
        setMarkers([]);
        setProgrammed(new Map());
        setPerformed(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [weeks, props.athleteId, props.groupId]);

  // ── Merge week-programmed + performed volume into the built weeks ──
  const weeksWithProgrammed: TimelineWeek[] = useMemo(() => {
    if (programmed.size === 0 && performed.size === 0) return weeks;
    return weeks.map(w => {
      const p = programmed.get(w.weekStart);
      const d = performed.get(w.weekStart);
      if (!p && !d) return w;
      return {
        ...w,
        programmedReps: p != null && p.reps > 0 ? p.reps : null,
        programmedTonnage: p != null && p.tonnage > 0 ? p.tonnage : null,
        performedReps: d != null && d.reps > 0 ? d.reps : null,
        performedTonnage: d != null && d.tonnage > 0 ? d.tonnage : null,
      };
    });
  }, [weeks, programmed, performed]);

  // ── Handlers ──
  const handleWeekClick = (week: TimelineWeek) => {
    if (props.onSelectWeek) props.onSelectWeek(week.weekStart);
    else navigate(`/planner/${week.weekStart}`);
  };

  const handlePhaseClick = (week: TimelineWeek) => {
    if (week.macroId === null) return;
    if (props.onPhaseClick) props.onPhaseClick(week);
    else navigate(`/macrocycles/${week.macroId}`);
  };

  if (weeks.length === 0) return null;

  return (
    <MacroTimelineStrip
      weeks={weeksWithProgrammed}
      markers={markers}
      metric={settings?.timeline_metric ?? 'reps'}
      complianceThreshold={(settings?.compliance_warning_threshold ?? 90) / 100}
      selectedWeekStart={props.selectedWeekStart ?? todayMonday}
      todayDate={todayIso}
      onWeekClick={handleWeekClick}
      onPhaseClick={handlePhaseClick}
      weekClickHint={props.onSelectWeek
        ? 'Click: select this week'
        : 'Click: open this week in the weekly planner'}
      showMonths={props.showMonths ?? true}
      className={props.className}
      style={props.style}
    />
  );
}
