/**
 * A design bench for the KinEMOS trend view.
 *
 * A trend needs a season of analysed reps, which no test environment has and
 * no fresh coaching account has either. This page renders the view against a
 * synthetic season — one athlete, five months of snatches with a few cleans,
 * mixed grades, a couple of reps from before the cache existed — so the chart
 * can be looked at, resized, hovered and switched between its modes before it
 * ships. The refresh is simulated: it "finds" numbers for the stale reps.
 *
 * Run `npm run dev` and open `/verify/trends-preview.html`. Query string:
 *   ?athlete=none   — the no-athlete state
 *   ?empty=1        — an athlete with nothing analysed
 *   ?few=1          — a single rep, to check the degenerate axes
 */
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { TrendsView } from '../src/kinemos/components/TrendsView';
import type { KinemosLiftRecord } from '../src/kinemos/lib/analysisAdapter';
import '../src/index.css';

const params = new URLSearchParams(location.search);

/** Deterministic pseudo-random, so the bench looks the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function season(): KinemosLiftRecord[] {
  const rand = rng(7);
  const out: KinemosLiftRecord[] = [];
  const start = Date.UTC(2026, 3, 6); // 06/04/2026, a Monday
  let id = 0;
  const grades = ['A', 'A', 'B', 'B', 'B', 'C', null] as const;

  for (let week = 0; week < 21; week++) {
    // One or two snatch sessions a week, most weeks.
    const sessions = rand() < 0.15 ? 0 : rand() < 0.5 ? 1 : 2;
    for (let s = 0; s < sessions; s++) {
      const day = new Date(start + (week * 7 + (s === 0 ? 1 : 4)) * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      const load = 70 + Math.round(week * 0.9 + rand() * 12);
      const reps = 1 + Math.floor(rand() * 3);
      for (let r = 1; r <= reps; r++) {
        id += 1;
        const grade = grades[Math.floor(rand() * grades.length)];
        // Velocity falls with load and drifts up over the block; noise on top.
        const peak = 2.45 - load * 0.0085 + week * 0.006 + (rand() - 0.5) * 0.08;
        const stale = week < 3 && rand() < 0.6;
        out.push({
          analysisId: `sn-${id}`,
          clipKey: `direct:sn-${id}`,
          sourceKind: 'direct',
          sourceId: `sn-${id}`,
          repIndex: r,
          label: null,
          athleteId: 'ath',
          athleteName: 'Anna Berg',
          exerciseName: 'Snatch',
          date,
          loadKg: load,
          massKg: load,
          massSource: 'logged',
          grade,
          gradeErrorMs: grade === 'A' ? 0.02 : grade === 'B' ? 0.045 : grade === 'C' ? 0.08 : null,
          phaseSetId: 'default',
          schema: stale ? 0 : 1,
          analysedAt: `${date}T18:00:00Z`,
          values: stale
            ? { peakVelocity: null, secondPull: null, transitionLoss: null, peakPower: null }
            : {
                peakVelocity: round(peak),
                firstPull: round(peak * 0.62 + (rand() - 0.5) * 0.05),
                secondPull: round(peak),
                transitionLoss: round(0.05 + rand() * 0.15),
                turnover: round(0.4 + rand() * 0.3),
                peakHeight: round(92 + rand() * 8, 1),
                loopWidth: round(4 + rand() * 6, 1),
                peakPower: Math.round(load * 9.81 * peak * 1.4),
                duration: round(1.3 + rand() * 0.4),
              },
        });
      }
    }
    // The odd clean.
    if (week % 4 === 2) {
      id += 1;
      const day = new Date(start + (week * 7 + 3) * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      const load = 95 + week;
      out.push({
        analysisId: `cl-${id}`,
        clipKey: `direct:cl-${id}`,
        sourceKind: 'direct',
        sourceId: `cl-${id}`,
        repIndex: 1,
        label: null,
        athleteId: 'ath',
        athleteName: 'Anna Berg',
        exerciseName: 'Clean',
        date,
        loadKg: load,
        massKg: load,
        massSource: 'logged',
        grade: 'B',
        gradeErrorMs: 0.05,
        phaseSetId: 'default',
        schema: 1,
        analysedAt: `${date}T18:00:00Z`,
        values: {
          peakVelocity: round(1.55 + (rand() - 0.5) * 0.1),
          secondPull: round(1.5),
          transitionLoss: round(0.1),
          peakPower: Math.round(load * 9.81 * 1.5 * 1.4),
        },
      });
    }
  }
  return out;
}

function round(v: number, d = 2): number {
  return Number(v.toFixed(d));
}

function Bench() {
  const records = useMemo(() => {
    if (params.get('empty')) return [];
    const all = season();
    return params.get('few') ? all.slice(0, 1) : all;
  }, []);

  // A live copy the simulated refresh can mutate, so "recompute" visibly
  // changes the chart.
  const store = useMemo(() => ({ records }), [records]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TrendsView
        athleteId={params.get('athlete') === 'none' ? null : 'ath'}
        athleteName="Anna Berg"
        exerciseName="Snatch"
        currentAnalysisId={records[records.length - 3]?.analysisId ?? null}
        onClose={() => console.log('close')}
        onOpen={r => console.log('open', r.analysisId)}
        load={async () => store.records}
        refresh={async (stale, options) => {
          const ids = new Set(stale.map(r => r.analysisId));
          let done = 0;
          for (let i = 0; i < stale.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 120));
            done += 1;
            options?.onProgress?.(done, stale.length);
          }
          const [skippedId, ...refreshedIds] = [...ids];
          const refreshedSet = new Set(refreshedIds);
          store.records = store.records.map(r =>
            refreshedSet.has(r.analysisId)
              ? {
                  ...r,
                  schema: 1,
                  values: {
                    ...r.values,
                    peakVelocity: round(2.45 - (r.loadKg ?? 80) * 0.0085),
                    secondPull: round(2.4 - (r.loadKg ?? 80) * 0.0085),
                  },
                }
              : r,
          );
          return { refreshed: refreshedIds, skipped: [{ analysisId: skippedId, reason: 'not calibrated' }] };
        }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
