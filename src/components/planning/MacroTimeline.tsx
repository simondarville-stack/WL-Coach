import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { useSettings } from '../../hooks/useSettings';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO, formatDateShort } from '../../lib/dateUtils';
import {
  buildCellsForSingleMacro,
  buildCellsForContinuousRange,
  fetchMacroPhaseBarEvents,
  resolveScopeAthleteIds,
} from '../../lib/macroPhaseBarData';
import { MacroPhaseBar } from './MacroPhaseBar';
import type {
  MacroPhaseBarCell,
  MacroPhaseBarEvent,
} from './MacroPhaseBar';
import type {
  MacroCycle,
  MacroPhase,
  MacroWeek,
} from '../../lib/database.types';

const CONTINUOUS_WEEKS_BACK = 5;
const CONTINUOUS_WEEKS_FORWARD = 6;
const SHIFT_WEEKS = 4;

// ───────────────────────────────────────────────────────────────
// Props
// ───────────────────────────────────────────────────────────────

type CommonProps = {
  athleteId: string | null;
  groupId: string | null;
  className?: string;
  style?: React.CSSProperties;
};

type ContinuousProps = CommonProps & {
  mode: 'continuous';
};

type BoundedProps = CommonProps & {
  mode: 'bounded';
  cycleId: string;
  selectedWeekStart?: string | null;
  onPhaseClick?: (cell: MacroPhaseBarCell) => void;
};

export type MacroTimelineProps = ContinuousProps | BoundedProps;

// ───────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────

export function MacroTimeline(props: MacroTimelineProps) {
  const navigate = useNavigate();
  const { settings, fetchSettingsSilent } = useSettings();

  useEffect(() => {
    void fetchSettingsSilent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [centerWeekStart, setCenterWeekStart] = useState(() =>
    getMondayOfWeekISO(new Date())
  );

  const [allMacros, setAllMacros] = useState<MacroCycle[]>([]);
  const [allPhases, setAllPhases] = useState<MacroPhase[]>([]);
  const [allMacroWeeks, setAllMacroWeeks] = useState<MacroWeek[]>([]);
  const [events, setEvents] = useState<MacroPhaseBarEvent[]>([]);

  const todayMonday = getMondayOfWeekISO(new Date());

  // ── Load macros + phases + macro_weeks ──
  // All three datasets are committed atomically in one render. Sequential
  // setState calls with awaits between them break React batching and produce
  // intermediate renders where (e.g.) macros are present but macro_weeks is
  // still empty — the cell builder then paints every week as a gap, which is
  // why the bar sometimes flashes uncolored.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const ownerId = getOwnerId();
        if (!ownerId) return;

        let macrosQuery = supabase
          .from('macrocycles')
          .select('*')
          .eq('owner_id', ownerId);

        if (props.mode === 'bounded') {
          macrosQuery = macrosQuery.eq('id', props.cycleId);
        } else {
          if (props.athleteId) {
            macrosQuery = macrosQuery.or(`athlete_id.eq.${props.athleteId},group_id.not.is.null`);
          } else if (props.groupId) {
            macrosQuery = macrosQuery.eq('group_id', props.groupId);
          }
        }

        const { data: macros, error: macrosErr } = await macrosQuery;
        if (macrosErr) throw macrosErr;
        let macrosFiltered = (macros as MacroCycle[]) ?? [];

        if (props.mode === 'continuous' && props.athleteId) {
          const groupMacros = macrosFiltered.filter(m => m.group_id);
          if (groupMacros.length > 0) {
            const groupIds = [...new Set(groupMacros.map(m => m.group_id!))];
            const { data: memberships, error: memErr } = await supabase
              .from('group_members')
              .select('group_id, athlete_id')
              .in('group_id', groupIds)
              .eq('athlete_id', props.athleteId)
              .is('left_at', null);
            if (memErr) throw memErr;
            const memberOfGroups = new Set((memberships || []).map((m: { group_id: string }) => m.group_id));
            macrosFiltered = macrosFiltered.filter(
              m => !m.group_id || memberOfGroups.has(m.group_id)
            );
          }
        }

        const macroIds = macrosFiltered.map(m => m.id);

        if (macroIds.length === 0) {
          if (cancelled) return;
          setAllMacros(macrosFiltered);
          setAllPhases([]);
          setAllMacroWeeks([]);
          return;
        }

        // Fetch phases and macro_weeks in parallel — they're independent.
        const [phasesRes, weeksRes] = await Promise.all([
          supabase
            .from('macro_phases')
            .select('*')
            .in('macrocycle_id', macroIds)
            .order('position'),
          supabase
            .from('macro_weeks')
            .select('*')
            .in('macrocycle_id', macroIds)
            .order('week_number'),
        ]);
        if (phasesRes.error) throw phasesRes.error;
        if (weeksRes.error) throw weeksRes.error;

        if (cancelled) return;

        // Commit all three atomically. React 18 batches synchronous setState
        // calls, so the next render sees a consistent macros/phases/weeks
        // snapshot rather than a half-loaded one.
        setAllMacros(macrosFiltered);
        setAllPhases((phasesRes.data as MacroPhase[]) ?? []);
        setAllMacroWeeks((weeksRes.data as MacroWeek[]) ?? []);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroTimeline: load failed', err);
        setAllMacros([]);
        setAllPhases([]);
        setAllMacroWeeks([]);
      }
    })();

    return () => { cancelled = true; };
  }, [
    props.mode,
    props.mode === 'bounded' ? props.cycleId : null,
    props.athleteId,
    props.groupId,
  ]);

  // ── Build cells ──
  const cells = useMemo(() => {
    if (allMacros.length === 0 && props.mode === 'bounded') return [];

    // In continuous mode, multiple macros may share the same week_start date
    // (e.g. overlapping macros or duplicates). Deduplicate by week_start,
    // preferring: (1) macros with phases, (2) individual over group macros.
    const macroIdsWithPhases = new Set(allPhases.map(p => p.macrocycle_id));
    const individualMacroIds = new Set(allMacros.filter(m => !m.group_id).map(m => m.id));
    const score = (macroId: string) =>
      (macroIdsWithPhases.has(macroId) ? 2 : 0) +
      (individualMacroIds.has(macroId) ? 1 : 0);

    const deduplicatedWeeks = props.mode === 'continuous'
      ? Object.values(
          allMacroWeeks.reduce<Record<string, typeof allMacroWeeks[number]>>(
            (acc, w) => {
              const existing = acc[w.week_start];
              if (!existing || score(w.macrocycle_id) > score(existing.macrocycle_id)) {
                acc[w.week_start] = w;
              }
              return acc;
            },
            {}
          )
        )
      : allMacroWeeks;

    const source = {
      macros: allMacros,
      phases: allPhases,
      weeks: deduplicatedWeeks,
      weekTypeConfigs: settings?.week_types ?? [],
    };

    if (props.mode === 'bounded') {
      const macro = allMacros.find(m => m.id === props.cycleId);
      if (!macro) return [];
      return buildCellsForSingleMacro(macro, source);
    }

    return buildCellsForContinuousRange(
      centerWeekStart,
      CONTINUOUS_WEEKS_BACK,
      CONTINUOUS_WEEKS_FORWARD,
      source
    );
  }, [
    props.mode,
    props.mode === 'bounded' ? props.cycleId : null,
    allMacros,
    allPhases,
    allMacroWeeks,
    settings?.week_types,
    centerWeekStart,
  ]);

  // ── Load events for the visible range ──
  useEffect(() => {
    if (cells.length === 0) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const athleteIds = await resolveScopeAthleteIds(
          props.athleteId,
          props.groupId
        );
        if (cancelled) return;
        if (athleteIds.length === 0) {
          setEvents([]);
          return;
        }
        const rangeStart = cells[0].weekStart;
        const lastCell = cells[cells.length - 1];
        const rangeEnd = addDaysToISO(lastCell.weekStart, 6);
        const fetched = await fetchMacroPhaseBarEvents(
          athleteIds,
          rangeStart,
          rangeEnd
        );
        if (cancelled) return;
        setEvents(fetched);
      } catch (err) {
        if (cancelled) return;
        console.error('MacroTimeline: events load failed', err);
        setEvents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cells, props.athleteId, props.groupId]);

  // ── Resolve playhead + selected week ──
  const playheadDate = todayMonday;
  const selectedWeekStart =
    props.mode === 'bounded'
      ? props.selectedWeekStart ?? todayMonday
      : todayMonday;

  // ── Click handlers ──
  const handleCellClick = (cell: MacroPhaseBarCell) => {
    navigate(`/planner/${cell.weekStart}`);
  };

  const handlePhaseClick = (cell: MacroPhaseBarCell) => {
    if (cell.macroId === null) return;
    if (props.mode === 'bounded' && props.onPhaseClick) {
      props.onPhaseClick(cell);
      return;
    }
    navigate(`/macrocycles/${cell.macroId}`);
  };

  const showNav = props.mode === 'continuous';

  return (
    <div className={props.className} style={props.style}>
      {showNav && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <button
            type="button"
            onClick={() =>
              setCenterWeekStart(addDaysToISO(centerWeekStart, -SHIFT_WEEKS * 7))
            }
            style={navBtnStyle}
          >
            ← Earlier
          </button>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {cells.length > 0
              ? `${formatDateShort(cells[0].weekStart)} → ${formatDateShort(addDaysToISO(cells[cells.length - 1].weekStart, 6))}`
              : ''}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setCenterWeekStart(todayMonday)}
              style={navBtnStyle}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() =>
                setCenterWeekStart(addDaysToISO(centerWeekStart, SHIFT_WEEKS * 7))
              }
              style={navBtnStyle}
            >
              Later →
            </button>
          </div>
        </div>
      )}

      <MacroPhaseBar
        cells={cells}
        events={events}
        selectedWeekStart={selectedWeekStart}
        playheadDate={playheadDate}
        showMonthRow
        showWeekDates
        onCellClick={handleCellClick}
        onPhaseClick={handlePhaseClick}
      />
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-md, 6px)',
  padding: '4px 10px',
  fontSize: '11px',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};
