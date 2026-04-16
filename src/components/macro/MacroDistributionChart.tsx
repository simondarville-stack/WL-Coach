import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler,
  Tooltip as ChartTooltip,
} from 'chart.js';
import type { MacroWeek, MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise } from '../../lib/database.types';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, ChartTooltip,
);

interface MacroDistributionChartProps {
  macroWeeks: MacroWeek[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  phases: MacroPhase[];
  visibleExercises?: Set<string>;
}

type DistView = 'stacked' | 'pct' | 'grouped' | 'stream' | 'perweek';

// Derive a stable color for a category from its exercises
function getCategoryColor(exercises: MacroTrackedExerciseWithExercise[], category: string): string {
  const first = exercises.find(e => e.exercise.category === category);
  return first?.exercise.color ?? '#888780';
}

interface CategoryData {
  id: string;     // category name as key
  name: string;
  color: string;
  exercises: string[];  // exercise names in this category
}

export function MacroDistributionChart({
  macroWeeks,
  trackedExercises,
  targets,
  phases,
  visibleExercises,
}: MacroDistributionChartProps) {
  const [view, setView] = useState<DistView>('stacked');
  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const mainRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  const mainChartRef = useRef<any>(null);
  const donutChartRef = useRef<any>(null);

  // Build category data from tracked exercises
  const categories = useMemo<CategoryData[]>(() => {
    const catMap = new Map<string, CategoryData>();
    const displayed = visibleExercises
      ? trackedExercises.filter(te => visibleExercises.has(te.id))
      : trackedExercises;

    displayed.forEach(te => {
      const cat = te.exercise.category || 'Uncategorized';
      if (!catMap.has(cat)) {
        catMap.set(cat, {
          id: cat,
          name: cat,
          color: getCategoryColor(trackedExercises, cat),
          exercises: [],
        });
      }
      catMap.get(cat)!.exercises.push(
        te.exercise.exercise_code || te.exercise.name,
      );
    });
    return Array.from(catMap.values());
  }, [trackedExercises, visibleExercises]);

  // Build reps per category per week
  const weekCatData = useMemo(() => {
    const displayed = visibleExercises
      ? trackedExercises.filter(te => visibleExercises.has(te.id))
      : trackedExercises;

    return macroWeeks.map(week => {
      const catReps: Record<string, number> = {};
      categories.forEach(c => { catReps[c.id] = 0; });

      displayed.forEach(te => {
        const target = targets.find(
          t => t.macro_week_id === week.id && t.tracked_exercise_id === te.id,
        );
        const reps = target?.target_reps ?? 0;
        const cat = te.exercise.category || 'Uncategorized';
        catReps[cat] = (catReps[cat] || 0) + reps;
      });

      return { week, catReps };
    });
  }, [macroWeeks, trackedExercises, targets, categories, visibleExercises]);

  const visibleCats = categories.filter(c => !hiddenCats.has(c.id));
  const labels = macroWeeks.map(w => 'W' + w.week_number);

  // Summary metrics
  const totalReps = weekCatData.reduce((s, wd) =>
    s + visibleCats.reduce((cs, c) => cs + wd.catReps[c.id], 0), 0);
  const avgReps = macroWeeks.length > 0 ? Math.round(totalReps / macroWeeks.length) : 0;
  const peakWeekData = weekCatData.reduce((best, wd) => {
    const t = visibleCats.reduce((s, c) => s + wd.catReps[c.id], 0);
    return t > best.total ? { week: wd.week, total: t } : best;
  }, { week: macroWeeks[0], total: 0 });
  const catTotals = visibleCats.map(c => ({
    cat: c,
    total: weekCatData.reduce((s, wd) => s + wd.catReps[c.id], 0),
  })).sort((a, b) => b.total - a.total);
  const dominantCat = catTotals[0];
  const dominantPct = totalReps > 0 ? Math.round((dominantCat?.total ?? 0) / totalReps * 100) : 0;

  // Toggle category visibility
  const toggleCat = (catId: string) => {
    setHiddenCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // Phase for a week
  const getPhase = (weekNum: number) => {
    return phases.find(p => weekNum >= p.start_week_number && weekNum <= p.end_week_number);
  };

  // Render main chart
  useEffect(() => {
    if (view === 'perweek' || !mainRef.current) return;
    if (mainChartRef.current) mainChartRef.current.destroy();

    const ctx = mainRef.current;

    if (view === 'stacked') {
      const datasets = visibleCats.map(c => ({
        label: c.name,
        data: weekCatData.map(wd => wd.catReps[c.id]),
        backgroundColor: c.color + 'CC',
        borderColor: c.color,
        borderWidth: 0.5,
        borderRadius: 1,
      }));
      mainChartRef.current = new ChartJS(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
            y: { stacked: true, title: { display: true, text: 'Reps', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 } } },
          },
        },
      });
    } else if (view === 'pct') {
      const weekTotals = weekCatData.map(wd => visibleCats.reduce((s, c) => s + wd.catReps[c.id], 0));
      const datasets = visibleCats.map(c => ({
        label: c.name,
        data: weekCatData.map((wd, i) => weekTotals[i] > 0 ? Math.round(wd.catReps[c.id] / weekTotals[i] * 1000) / 10 : 0),
        backgroundColor: c.color + 'CC',
        borderColor: c.color,
        borderWidth: 0.5,
        borderRadius: 1,
      }));
      mainChartRef.current = new ChartJS(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: (c: any) => c.dataset.label + ': ' + c.raw + '%' } } },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
            y: { stacked: true, max: 100, title: { display: true, text: '%', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 }, callback: (v: number) => v + '%' } },
          },
        },
      });
    } else if (view === 'grouped') {
      const datasets = visibleCats.map(c => ({
        label: c.name,
        data: weekCatData.map(wd => wd.catReps[c.id]),
        backgroundColor: c.color + '99',
        borderColor: c.color,
        borderWidth: 1,
        borderRadius: 2,
      }));
      mainChartRef.current = new ChartJS(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 } } },
            y: { title: { display: true, text: 'Reps', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 } } },
          },
        },
      });
    } else if (view === 'stream') {
      const datasets = visibleCats.map(c => ({
        label: c.name,
        data: weekCatData.map(wd => wd.catReps[c.id]),
        backgroundColor: c.color + '40',
        borderColor: c.color,
        borderWidth: 1.5,
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointBackgroundColor: c.color,
      }));
      mainChartRef.current = new ChartJS(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 } } },
            y: { stacked: true, title: { display: true, text: 'Reps', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 9 } } },
          },
        },
      });
    }

    return () => { if (mainChartRef.current) mainChartRef.current.destroy(); };
  }, [view, weekCatData, visibleCats, labels]);

  // Render per-week donut
  useEffect(() => {
    if (view !== 'perweek' || !donutRef.current) return;
    if (donutChartRef.current) donutChartRef.current.destroy();

    const wd = weekCatData.find(d => d.week.week_number === selectedWeek) ?? weekCatData[0];
    if (!wd) return;
    const vals = visibleCats.map(c => wd.catReps[c.id]);

    donutChartRef.current = new ChartJS(donutRef.current, {
      type: 'doughnut',
      data: {
        labels: visibleCats.map(c => c.name),
        datasets: [{
          data: vals,
          backgroundColor: visibleCats.map(c => c.color + 'CC'),
          borderColor: visibleCats.map(c => c.color),
          borderWidth: 1,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c: any) => {
                const total = vals.reduce((a: number, b: number) => a + b, 0);
                return c.label + ': ' + c.raw + ' (' + Math.round(c.raw / total * 100) + '%)';
              },
            },
          },
        },
      },
    });

    return () => { if (donutChartRef.current) donutChartRef.current.destroy(); };
  }, [view, selectedWeek, weekCatData, visibleCats]);

  if (macroWeeks.length === 0 || trackedExercises.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400">
        No data to display. Add tracked exercises and targets to see distribution.
      </div>
    );
  }

  // Per-week detail
  const selectedWd = weekCatData.find(d => d.week.week_number === selectedWeek) ?? weekCatData[0];
  const selectedTotal = selectedWd ? visibleCats.reduce((s, c) => s + selectedWd.catReps[c.id], 0) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Summary metrics */}
      <div className="flex gap-3">
        <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
          <div className="text-[10px] text-gray-400">Total reps</div>
          <div className="text-lg font-medium font-mono text-gray-900">{totalReps}</div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
          <div className="text-[10px] text-gray-400">Avg / week</div>
          <div className="text-lg font-medium font-mono text-gray-900">{avgReps}</div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
          <div className="text-[10px] text-gray-400">Peak week</div>
          <div className="text-lg font-medium font-mono text-gray-900">
            W{peakWeekData.week?.week_number ?? '-'} ({peakWeekData.total})
          </div>
        </div>
        <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
          <div className="text-[10px] text-gray-400">Dominant category</div>
          <div className="text-sm font-medium text-gray-900 truncate">
            {dominantCat?.cat.name ?? '-'} {dominantPct}%
          </div>
        </div>
      </div>

      {/* View pills + legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {([
            { key: 'stacked', label: 'Stacked' },
            { key: 'pct', label: '100%' },
            { key: 'grouped', label: 'Grouped' },
            { key: 'stream', label: 'Stream' },
            { key: 'perweek', label: 'Per-week' },
          ] as { key: DistView; label: string }[]).map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1 text-[10px] rounded-md transition-colors ${
                view === v.key
                  ? 'bg-white text-gray-900 font-medium shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 ml-auto">
          {categories.map(c => {
            const visible = !hiddenCats.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                className={`flex items-center gap-1 text-[10px] transition-opacity ${
                  visible ? '' : 'opacity-30 line-through'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phase bar */}
      {phases.length > 0 && (
        <div className="flex h-5 rounded-md overflow-hidden border border-gray-200">
          {phases
            .sort((a, b) => a.position - b.position)
            .map(p => {
              const span = p.end_week_number - p.start_week_number + 1;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-center text-[8px] font-medium"
                  style={{
                    flex: span,
                    backgroundColor: p.color,
                    color: '#1f2937',
                  }}
                >
                  {p.name} (W{p.start_week_number}–{p.end_week_number})
                </div>
              );
            })}
        </div>
      )}

      {/* Main chart */}
      {view !== 'perweek' && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="relative w-full" style={{ height: 280 }}>
            <canvas ref={mainRef} />
          </div>
        </div>
      )}

      {/* Per-week donut view */}
      {view === 'perweek' && (
        <div className="border border-gray-200 rounded-lg overflow-hidden p-4">
          <div className="flex items-center gap-3 mb-4">
            <select
              value={selectedWeek}
              onChange={e => setSelectedWeek(Number(e.target.value))}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1.5"
            >
              {macroWeeks.map(w => (
                <option key={w.id} value={w.week_number}>
                  W{w.week_number} — {w.week_type_text || w.week_type || 'untyped'}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-400">
              {selectedTotal} total reps
            </span>
          </div>

          <div className="flex gap-6 items-center">
            <div className="relative" style={{ width: 180, height: 180 }}>
              <canvas ref={donutRef} />
            </div>

            <div className="flex-1 space-y-2">
              {visibleCats.map(c => {
                const reps = selectedWd?.catReps[c.id] ?? 0;
                const pct = selectedTotal > 0 ? Math.round(reps / selectedTotal * 100) : 0;
                return (
                  <div key={c.id} className="flex items-center gap-2 text-[11px]">
                    <span className="w-[100px] text-gray-500 truncate">{c.name}</span>
                    <div className="flex-1 h-3.5 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: pct + '%', backgroundColor: c.color + 'CC' }}
                      />
                    </div>
                    <span className="w-[60px] text-right font-mono text-[10px] text-gray-900">
                      {reps} <span className="text-gray-400">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
