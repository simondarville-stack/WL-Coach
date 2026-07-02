// EMOS Coach Dashboard — v2.
//
// Lives alongside the v1 dashboard at /dashboard. Two main views:
//   - Athletes: dense status board with RAW, compliance, bodyweight, plan
//     state, next event. Click any row to expand inline (RAW pillars,
//     bodyweight detail, flags, planned-vs-actual chart). Optionally
//     section the board by training group.
//   - Groups: one row per training group with the group's own weekly plan
//     state; expand to see members.
//
// Below the board: Activity feed and Upcoming events panels. Clicking an
// activity item or an athlete chip in an event jumps back into the
// athlete board (pulse + scroll + expand).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UsersRound, Sliders } from 'lucide-react';
import type { AthleteStatus, GroupStatus } from '../../hooks/useCoachDashboard';
import { useCoachDashboardV2 } from '../../hooks/useCoachDashboardV2';
import type { Athlete, Event, TrainingGroup } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { EventOverviewModal } from '../EventOverviewModal';
import { StatusBoard } from './StatusBoard';
import { GroupBoard } from './GroupBoard';
import { ActivityFeedPanel } from './ActivityFeedPanel';
import { UpcomingEventsPanel } from './UpcomingEventsPanel';
import { AthleteInfoDialog } from './AthleteInfoDialog';

type BoardView = 'athletes' | 'groups';

interface CoachDashboardV2Props {
  onNavigateToPlanner: (athlete: Athlete, weekStart: string, mode?: 'plan' | 'log', dayIndex?: number | null) => void;
  onNavigateToGroupPlanner: (group: TrainingGroup, weekStart: string) => void;
  onNavigateToMacro: (athlete: Athlete, macrocycleId: string) => void;
  onNavigateToPRs: (athlete: Athlete, exerciseId: string, repCount: number) => void;
}

const ATHLETE_PIN_KEY = 'emos_v2_dashboard_pinned';
const GROUP_PIN_KEY = 'emos_v2_dashboard_group_pinned';
const VIEW_KEY = 'emos_v2_dashboard_view';
const SECTION_KEY = 'emos_v2_dashboard_section_by_group';

function loadStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function loadView(): BoardView {
  return localStorage.getItem(VIEW_KEY) === 'groups' ? 'groups' : 'athletes';
}

function loadSectionByGroup(): boolean {
  return localStorage.getItem(SECTION_KEY) === '1';
}

export function CoachDashboardV2({
  onNavigateToPlanner, onNavigateToGroupPlanner, onNavigateToMacro, onNavigateToPRs,
}: CoachDashboardV2Props) {
  const navigate = useNavigate();
  const {
    athleteStatuses, activityFeed, upcomingEvents, groupStatuses,
    loading, getEnrichment, getAthleteGroups, totalFlagged,
  } = useCoachDashboardV2();

  const [view, setView] = useState<BoardView>(() => loadView());
  const [sectionByGroup, setSectionByGroup] = useState<boolean>(() => loadSectionByGroup());

  const [athletePins, setAthletePins] = useState<string[]>(() => loadStringList(ATHLETE_PIN_KEY));
  const [groupPins, setGroupPins] = useState<string[]>(() => loadStringList(GROUP_PIN_KEY));

  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [infoAthlete, setInfoAthlete] = useState<AthleteStatus | null>(null);

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { localStorage.setItem(SECTION_KEY, sectionByGroup ? '1' : '0'); }, [sectionByGroup]);
  useEffect(() => { localStorage.setItem(ATHLETE_PIN_KEY, JSON.stringify(athletePins)); }, [athletePins]);
  useEffect(() => { localStorage.setItem(GROUP_PIN_KEY, JSON.stringify(groupPins)); }, [groupPins]);

  useEffect(() => {
    if (!pulseId) return;
    const id = setTimeout(() => setPulseId(null), 1600);
    return () => clearTimeout(id);
  }, [pulseId]);

  const orderedAthletes = useMemo(() => {
    if (!athletePins.length) return athleteStatuses;
    const idx = (id: string) => {
      const i = athletePins.indexOf(id);
      return i === -1 ? 999 : i;
    };
    return [...athleteStatuses].sort((a, b) => idx(a.athlete.id) - idx(b.athlete.id));
  }, [athleteStatuses, athletePins]);

  const toggleAthletePin = useCallback((id: string) => {
    setAthletePins(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, []);
  const toggleGroupPin = useCallback((id: string) => {
    setGroupPins(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, []);

  const jumpToAthlete = useCallback((status: AthleteStatus) => {
    setView('athletes');
    setExpandedAthleteId(status.athlete.id);
    setPulseId(status.athlete.id);
    setTimeout(() => {
      const el = document.getElementById(`v2-row-${status.athlete.id}`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  }, []);

  const openPlannerForAthlete = useCallback((status: AthleteStatus, weekStart?: string) => {
    onNavigateToPlanner(status.athlete, weekStart ?? status.currentWeekStart);
  }, [onNavigateToPlanner]);

  const openLogForAthlete = useCallback((status: AthleteStatus, weekStart: string, dayIndex?: number | null) => {
    onNavigateToPlanner(status.athlete, weekStart, 'log', dayIndex);
  }, [onNavigateToPlanner]);

  const openPRForAthlete = useCallback((status: AthleteStatus, exerciseId: string, repCount: number) => {
    onNavigateToPRs(status.athlete, exerciseId, repCount);
  }, [onNavigateToPRs]);

  const openPlannerForGroup = useCallback((gs: GroupStatus, weekStart?: string) => {
    onNavigateToGroupPlanner(gs.group, weekStart ?? gs.currentWeekStart);
  }, [onNavigateToGroupPlanner]);

  const openMacroForAthlete = useCallback((status: AthleteStatus) => {
    if (!status.currentMacrocycle) return;
    onNavigateToMacro(status.athlete, status.currentMacrocycle.id);
  }, [onNavigateToMacro]);

  // EventTag clicks pass an event id (the row-level summary may only have
  // the id at hand, depending on caller). We resolve to a full Event row
  // before opening the existing EventOverviewModal.
  const openEventById = useCallback(async (eventId: string) => {
    // Try to hit it from already-loaded upcomingEvents first.
    const fromList = upcomingEvents.find(e => e.eventData.id === eventId)?.eventData;
    if (fromList) { setSelectedEvent(fromList); return; }
    const { data } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (data) setSelectedEvent(data as Event);
  }, [upcomingEvents]);

  const summary = useMemo(() => ({
    thisDone: orderedAthletes.filter(s => s.currentWeekPlanned).length,
    nextDone: orderedAthletes.filter(s => s.nextWeekPlanned).length,
    flagged: totalFlagged,
    total: orderedAthletes.length,
    groups: groupStatuses.length,
  }), [orderedAthletes, totalFlagged, groupStatuses.length]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-medium text-gray-900">{greeting}, Coach</h1>
          <p className="text-sm text-gray-500 mt-0.5">{todayLabel}</p>
        </div>
        <button
          onClick={() => navigate('/settings#dashboard-flags')}
          title="Configure which attention flags surface on the dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600"
        >
          <Sliders size={13} />
          Configure flags
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickStat label="This week" value={summary.thisDone} total={summary.total}
          tone={summary.total === 0 ? 'neutral'
            : summary.thisDone === summary.total ? 'ok'
            : summary.thisDone >= summary.total * 0.7 ? 'warn' : 'bad'} />
        <QuickStat label="Next week" value={summary.nextDone} total={summary.total}
          tone={summary.total === 0 ? 'neutral'
            : summary.nextDone === summary.total ? 'ok'
            : summary.nextDone >= summary.total * 0.7 ? 'warn' : 'bad'} />
        <QuickStat label="Flagged" value={summary.flagged} total={summary.total}
          tone={summary.flagged === 0 ? 'ok'
            : summary.flagged < Math.max(1, summary.total * 0.3) ? 'warn' : 'bad'} />
        <QuickStat label="Training groups" value={summary.groups} />
      </div>

      {/* Board section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <ViewTabs value={view} onChange={setView} groupsCount={groupStatuses.length} />
          <div className="flex items-center gap-3">
            {view === 'athletes' && groupStatuses.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sectionByGroup}
                  onChange={(e) => setSectionByGroup(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Section by group
              </label>
            )}
            <span className="text-xs text-gray-400 tabular-nums">
              {view === 'athletes'
                ? `${orderedAthletes.length} ${orderedAthletes.length === 1 ? 'athlete' : 'athletes'}`
                : `${groupStatuses.length} ${groupStatuses.length === 1 ? 'group' : 'groups'}`}
            </span>
          </div>
        </div>

        {loading && orderedAthletes.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Loading…
          </div>
        ) : view === 'athletes' ? (
          <StatusBoard
            statuses={orderedAthletes}
            getEnrichment={getEnrichment}
            getAthleteGroups={getAthleteGroups}
            groupStatuses={groupStatuses}
            pinned={athletePins}
            onTogglePin={toggleAthletePin}
            groupBy={sectionByGroup ? 'group' : 'none'}
            expandedId={expandedAthleteId}
            onSetExpanded={setExpandedAthleteId}
            pulseId={pulseId}
            onOpenPlanner={openPlannerForAthlete}
            onOpenMacro={openMacroForAthlete}
            onOpenEvent={openEventById}
            onOpenAthleteInfo={setInfoAthlete}
          />
        ) : (
          <GroupBoard
            groupStatuses={groupStatuses}
            statuses={orderedAthletes}
            getEnrichment={getEnrichment}
            expandedId={expandedGroupId}
            onSetExpanded={setExpandedGroupId}
            pinned={groupPins}
            onTogglePin={toggleGroupPin}
            onJumpToAthlete={jumpToAthlete}
            onOpenGroupPlanner={openPlannerForGroup}
            onOpenEvent={openEventById}
            onOpenAthleteInfo={setInfoAthlete}
          />
        )}
      </div>

      {/* Activity + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityFeedPanel
          events={activityFeed}
          statuses={orderedAthletes}
          onJumpToAthlete={jumpToAthlete}
          onOpenLog={openLogForAthlete}
          onOpenPR={openPRForAthlete}
        />
        <UpcomingEventsPanel
          events={upcomingEvents}
          statuses={orderedAthletes}
          onOpenEvent={setSelectedEvent}
          onJumpToAthlete={jumpToAthlete}
        />
      </div>

      {selectedEvent && (
        <EventOverviewModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {infoAthlete && (
        <AthleteInfoDialog
          status={infoAthlete}
          enrichment={getEnrichment(infoAthlete.athlete.id)}
          onClose={() => setInfoAthlete(null)}
          onOpenPlanner={(s) => { setInfoAthlete(null); openPlannerForAthlete(s); }}
          onOpenMacro={(s) => { setInfoAthlete(null); openMacroForAthlete(s); }}
          onOpenAthletesPage={() => { setInfoAthlete(null); navigate('/athletes'); }}
        />
      )}
    </div>
  );
}

function ViewTabs({
  value, onChange, groupsCount,
}: { value: BoardView; onChange: (v: BoardView) => void; groupsCount: number }) {
  const tabs: { id: BoardView; label: string; icon: typeof Users; count: number | null }[] = [
    { id: 'athletes', label: 'Athletes', icon: Users,       count: null },
    { id: 'groups',   label: 'Groups',   icon: UsersRound,  count: groupsCount },
  ];
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {tabs.map(t => {
        const selected = value === t.id;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              selected
                ? 'bg-white text-gray-900 shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            <span>{t.label}</span>
            {t.count !== null && (
              <span className={`text-[11px] tabular-nums ${selected ? 'text-gray-500' : 'text-gray-400'}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function QuickStat({
  label, value, total, tone,
}: { label: string; value: number; total?: number; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const text = tone === 'ok'   ? 'text-green-600'
    : tone === 'warn' ? 'text-amber-600'
    : tone === 'bad'  ? 'text-red-600'
    : 'text-gray-900';
  return (
    <div className="bg-white rounded-lg border border-gray-200 py-2.5 px-4">
      <div className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className={`text-xl font-medium tabular-nums ${text}`}>{value}</span>
        {total !== undefined && (
          <span className="text-sm text-gray-400 tabular-nums">/ {total}</span>
        )}
      </div>
    </div>
  );
}
