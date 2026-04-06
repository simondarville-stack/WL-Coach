import { useState } from 'react';
import { BarChart2, TrendingUp, CheckSquare, Activity, Layers, Star, Calendar, Scale } from 'lucide-react';
import { PlannedVsPerformed } from './PlannedVsPerformed';
import { CompetitionLiftTrends } from './presets/CompetitionLiftTrends';
import { VolumeDistribution } from './presets/VolumeDistribution';
import { ReadinessVsPerformance } from './presets/ReadinessVsPerformance';
import { SquatToLiftTransfer } from './presets/SquatToLiftTransfer';
import { PRTimeline } from './presets/PRTimeline';
import { TrainingPatterns } from './presets/TrainingPatterns';
import { BodyweightTrend } from './presets/BodyweightTrend';

interface Props {
  athleteId: string;
  startDate: string;
  endDate: string;
}

type PresetId =
  | 'competition-lift-trends'
  | 'volume-distribution'
  | 'planned-vs-performed'
  | 'readiness-vs-performance'
  | 'squat-to-lift'
  | 'pr-timeline'
  | 'training-patterns'
  | 'bodyweight-trend';

interface Preset {
  id: PresetId;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const PRESETS: Preset[] = [
  {
    id: 'competition-lift-trends',
    title: 'Competition lift trends',
    description: 'Snatch and C&J max load progression over time with macro phase bands',
    icon: TrendingUp,
  },
  {
    id: 'volume-distribution',
    title: 'Volume distribution',
    description: 'Weekly tonnage split by exercise category as a stacked bar chart',
    icon: BarChart2,
  },
  {
    id: 'planned-vs-performed',
    title: 'Planned vs performed',
    description: 'Grouped bars with compliance line and detailed weekly breakdown table',
    icon: CheckSquare,
  },
  {
    id: 'readiness-vs-performance',
    title: 'Readiness vs performance',
    description: 'Scatter plot correlating RAW readiness with session output',
    icon: Activity,
  },
  {
    id: 'squat-to-lift',
    title: 'Squat-to-lift transfer',
    description: 'Dual-axis comparison of squat vs competition lift max loads',
    icon: Layers,
  },
  {
    id: 'pr-timeline',
    title: 'PR timeline',
    description: 'Horizontal timeline of personal records coloured by exercise category',
    icon: Star,
  },
  {
    id: 'training-patterns',
    title: 'Training patterns',
    description: 'Volume and session count by day of the week',
    icon: Calendar,
  },
  {
    id: 'bodyweight-trend',
    title: 'Bodyweight trend',
    description: 'Bodyweight with 7-day moving average and weight class reference lines',
    icon: Scale,
  },
];

export function QuickAnalyses({ athleteId, startDate, endDate }: Props) {
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);

  if (activePreset) {
    return (
      <div>
        <button
          onClick={() => setActivePreset(null)}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors"
        >
          ← Back to presets
        </button>
        {activePreset === 'competition-lift-trends' && (
          <CompetitionLiftTrends athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'volume-distribution' && (
          <VolumeDistribution athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'planned-vs-performed' && (
          <PlannedVsPerformed athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'readiness-vs-performance' && (
          <ReadinessVsPerformance athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'squat-to-lift' && (
          <SquatToLiftTransfer athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'pr-timeline' && (
          <PRTimeline athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'training-patterns' && (
          <TrainingPatterns athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
        {activePreset === 'bodyweight-trend' && (
          <BodyweightTrend athleteId={athleteId} startDate={startDate} endDate={endDate} />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {PRESETS.map(preset => {
        const Icon = preset.icon;
        return (
          <button
            key={preset.id}
            onClick={() => setActivePreset(preset.id)}
            className="bg-white border border-gray-200 rounded-lg p-3 text-left hover:border-blue-300 hover:shadow-sm transition-all duration-150"
          >
            <Icon size={18} className="text-blue-500 mb-2" />
            <div className="text-[13px] font-medium text-gray-800 mb-1">{preset.title}</div>
            <div className="text-[11px] text-gray-500 leading-snug">{preset.description}</div>
          </button>
        );
      })}
    </div>
  );
}
