import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import { useSettings } from '../../hooks/useSettings';
import { getMondayOfWeekISO } from '../../lib/weekUtils';
import { addDaysToISO } from '../../lib/dateUtils';
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
  const { settings } = useSettings();

  const [centerWeekStart, setCenterWeekStart] = useState(() =>
    getMondayOfWeekISO(new Date())
  );

  const [allMacros, setAllMacros] = useState<MacroCycle[]>([]);
  const [allPhases, setAllPhases] = useState<MacroPhase[]>([]);
  const [allMacroWeeks, setAllMacroWeeks] = useState<MacroWeek[]>([]);
  const [events, setEvents] = useState<MacroPhaseBarEvent[]>([]);

  const todayMonday = getMondayOfWeekISO(new Date());

  // ── Load macros + phases + macro_weeks ──
  useEffect(() => {
    void (async () => {
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
          macrosQuery = macrosQuery.or(`athlete_id.eq.${props.athleteId},group_id.is.not.null`);
        } else if (props.groupId) {
          macrosQuery = macrosQuery.eq('group_id', props.groupId);
        }
      }

      const { data: macros } = await macrosQuery;
      let macrosFiltered = (macros as MacroCycle[]) ?? [];

      if (props.mode === 'continuous' && props.athleteId) {
        const groupMacros = macrosFiltered.filter(m => m.group_id);
        if (groupMacros.length > 0) {
          const groupIds = [...new Set(groupMacros.map(m => m.group_id!))];
          const { data: memberships } = await supabase
            .from('group_members')
            .select('group_id, athlete_id')
            .in('group_id', groupIds)
            .eq('athlete_id', props.athleteId)
            .is('left_at', null);
          const memberOfGroups = new Set((memberships || []).map((m: { group_id: string }) => m.group_id));
          macrosFiltered = macrosFiltered.filter(
            m => !m.group_id || memberOfGroups.has(m.group_id)
          );
        }
      }

      setAllMacros(macrosFiltered);

      const macroIds = macrosFiltered.map(m => m.id);
      if (macroIds.length === 0) {
        setAllPhases([]);
        setAllMacroWeeks([]);
        return;
      }

      const { data: phases } = await supabase
        .from('macro_phases')
        .select('*')
        .in('macrocycle_id', macroIds)
        .order('position');
      setAllPhases((phases as MacroPhase[]) ?? []);

      const { data: macroWeeks } = await supabase
        .from('macro_weeks')
        .select('*')
        .in('macrocycle_id', macroIds)
        .order('week_number');
      setAllMacroWeeks((macroWeeks as MacroWeek[]) ?? []);
    })();
  }, [
    props.mode,
    props.mode === 'bounded' ? props.cycleId : null,
    props.athleteId,
    props.groupId,
  ]);

  // ── Build cells ──
  const cells = useMemo(() => {
    if (allMacros.length === 0 && props.mode === 'bounded') return [];

    const source = {
      macros: allMacros,
      phases: allPhases,
      weeks: allMacroWeeks,
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
    void (async () => {
      const athleteIds = await resolveScopeAthleteIds(
        props.athleteId,
        props.groupId
      );
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
      setEvents(fetched);
    })();
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
              ? `${cells[0].weekStart} → ${addDaysToISO(cells[cells.length - 1].weekStart, 6)}`
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
