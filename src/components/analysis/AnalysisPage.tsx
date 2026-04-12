import { useState } from 'react';
import { useAthleteStore } from '../../store/athleteStore';
import { AthleteCardPicker } from '../AthleteCardPicker';
import { PivotBuilder } from './PivotBuilder';
import { QuickAnalyses } from './QuickAnalyses';
import { LiftRatios } from './LiftRatios';
import { IntensityZones } from './IntensityZones';

type Period = '4w' | '8w' | '12w' | 'macro' | 'ytd' | 'custom';
type Tab = 'pivot' | 'quick' | 'ratios' | 'zones';

function getDateRange(period: Period, customStart: string, customEnd: string): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);

  if (period === 'custom') {
    return { start: customStart || end, end: customEnd || end };
  }
  if (period === 'ytd') {
    return { start: `${today.getFullYear()}-01-01`, end };
  }

  const weeks = period === '4w' ? 4 : period === '8w' ? 8 : 12;
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7);
  return { start: start.toISOString().slice(0, 10), end };
}

export function AnalysisPage() {
  const { selectedAthlete } = useAthleteStore();
  const [period, setPeriod] = useState<Period>('8w');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('pivot');

  const { start, end } = getDateRange(period, customStart, customEnd);

  const PERIODS: { id: Period; label: string }[] = [
    { id: '4w', label: '4 weeks' },
    { id: '8w', label: '8 weeks' },
    { id: '12w', label: '12 weeks' },
    { id: 'ytd', label: 'Year to date' },
    { id: 'custom', label: 'Custom range' },
  ];

  const TABS: { id: Tab; label: string }[] = [
    { id: 'pivot', label: 'Pivot builder' },
    { id: 'quick', label: 'Quick analyses' },
    { id: 'ratios', label: 'Lift ratios' },
    { id: 'zones', label: 'Intensity zones' },
  ];

  if (!selectedAthlete) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <AthleteCardPicker />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-4">
      {/* Period selector */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] uppercase text-gray-400 tracking-wider font-medium mr-1">Period</span>
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              period === p.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-xs"
            />
            <span className="text-gray-400 text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-xs"
            />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'pivot' && (
        <PivotBuilder athleteId={selectedAthlete.id} startDate={start} endDate={end} />
      )}
      {activeTab === 'quick' && (
        <QuickAnalyses athleteId={selectedAthlete.id} startDate={start} endDate={end} />
      )}
      {activeTab === 'ratios' && (
        <LiftRatios athleteId={selectedAthlete.id} startDate={start} endDate={end} />
      )}
      {activeTab === 'zones' && (
        <IntensityZones athleteId={selectedAthlete.id} startDate={start} endDate={end} />
      )}
    </div>
  );
}
