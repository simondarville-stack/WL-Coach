import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCoachDashboardV2 } from '../../hooks/useCoachDashboardV2';
import { formatDateToDDMMYYYY } from '../../lib/dateUtils';
import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { StatsBar } from './StatsBar';
import { AthleteGrid } from './AthleteGrid';
import { AttentionPanel } from './AttentionPanel';
import { EventsPanel } from './EventsPanel';
import { ActivityFeed } from './ActivityFeed';
import { ReadinessHeatmap } from './ReadinessHeatmap';
import { PlanningMatrix } from './PlanningMatrix';
import { PhaseOverview } from './PhaseOverview';
import { BodyweightPanel } from './BodyweightPanel';

interface Props {
  onNavigateToPlanner: (athlete: Athlete, weekStart: string) => void;
  onNavigateToGroupPlanner: (group: TrainingGroup, weekStart: string) => void;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardV2({ onNavigateToPlanner, onNavigateToGroupPlanner }: Props) {
  const {
    athletes,
    weekOverview,
    upcomingEvents,
    recentSessions,
    attentionItems,
    settings,
    loading,
    loadDashboard,
  } = useCoachDashboardV2();

  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    loadDashboard();
    intervalRef.current = setInterval(loadDashboard, 90_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadDashboard]);

  const rawEnabled = settings?.raw_enabled ?? false;

  if (loading && athletes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {getGreeting()}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{formatDateToDDMMYYYY(new Date().toISOString())}</p>
        </div>
        <button
          onClick={loadDashboard}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <StatsBar
        athletes={athletes}
        weekOverview={weekOverview}
        upcomingEvents={upcomingEvents}
        attentionItems={attentionItems}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <AthleteGrid
            athletes={athletes}
            rawEnabled={rawEnabled}
            onNavigateToPlanner={onNavigateToPlanner}
          />

          {rawEnabled && <ReadinessHeatmap athletes={athletes} />}
        </div>

        <div className="space-y-4">
          <AttentionPanel items={attentionItems} />
          <PlanningMatrix athletes={athletes} onNavigateToPlanner={onNavigateToPlanner} />
          <PhaseOverview athletes={athletes} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ActivityFeed sessions={recentSessions} />
        <EventsPanel events={upcomingEvents} />
        <BodyweightPanel athletes={athletes} />
      </div>
    </div>
  );
}
