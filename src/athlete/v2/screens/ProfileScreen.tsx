/**
 * ProfileScreen — athlete identity, bodyweight history chart, PR table,
 * sign-out / switch profile.
 *
 * BW chart sources from training_log_sessions.bodyweight_kg (single
 * source of truth chosen in P3). PRs come from athlete_prs joined with
 * exercise names.
 */
import { useCallback, useEffect, useState } from 'react';
import { LogOut, User as UserIcon, Loader2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useAuth } from '../lib/AuthContext';
import {
  fetchBodyweightHistory,
  fetchAthletePRs,
  type BodyweightPoint,
  type AthletePRRow,
} from '../../../lib/trainingLogService';

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ProfileScreen() {
  const { athlete, signOut } = useAuth();
  const [bw, setBw] = useState<BodyweightPoint[]>([]);
  const [prs, setPrs] = useState<AthletePRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!athlete) return;
    setLoading(true);
    setError(null);
    try {
      const [bwData, prData] = await Promise.all([
        fetchBodyweightHistory(athlete.id),
        fetchAthletePRs(athlete.id),
      ]);
      setBw(bwData);
      setPrs(prData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [athlete]);

  useEffect(() => { void load(); }, [load]);

  if (!athlete) return null;

  const bwMin = bw.length > 0 ? Math.min(...bw.map(p => p.weightKg)) : 0;
  const bwMax = bw.length > 0 ? Math.max(...bw.map(p => p.weightKg)) : 0;
  const bwLatest = bw.length > 0 ? bw[bw.length - 1].weightKg : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {athlete.photo_url ? (
            <img src={athlete.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <UserIcon size={24} className="text-gray-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-white truncate">{athlete.name}</h1>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {athlete.weight_class && <span>{athlete.weight_class}</span>}
            {athlete.club && <span>· {athlete.club}</span>}
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white px-3 py-2 rounded-md border border-gray-800 hover:border-gray-600"
        >
          <LogOut size={12} />
          Switch
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 size={18} className="animate-spin mr-2" />
          <span className="text-sm">Loading profile…</span>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
          <div className="font-semibold">Failed to load</div>
          <div className="mt-1 break-all">{error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Bodyweight chart */}
          <section className="rounded-xl bg-gray-900 border border-gray-800 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                Bodyweight
              </h2>
              {bwLatest != null && (
                <span className="text-sm font-bold text-white">
                  {bwLatest.toFixed(1)} <span className="text-xs text-gray-500 font-normal">kg</span>
                </span>
              )}
            </div>
            {bw.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-6 text-center">
                No bodyweight entries yet. Log one on Today.
              </p>
            ) : (
              <>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={bw} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={shortDate}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        stroke="#374151"
                      />
                      <YAxis
                        domain={[Math.floor(bwMin - 1), Math.ceil(bwMax + 1)]}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        stroke="#374151"
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: 4,
                          fontSize: 11,
                        }}
                        labelStyle={{ color: '#9ca3af' }}
                        itemStyle={{ color: '#fff' }}
                        labelFormatter={(label) => shortDate(String(label))}
                        formatter={(value) => [`${Number(value).toFixed(1)} kg`, 'BW']}
                      />
                      <Line
                        type="monotone"
                        dataKey="weightKg"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 2.5, fill: '#3b82f6' }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-2">
                  <span>min {bwMin.toFixed(1)}</span>
                  <span>max {bwMax.toFixed(1)}</span>
                  <span>{bw.length} entries</span>
                </div>
              </>
            )}
          </section>

          {/* PR table */}
          <section className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800">
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                Personal records
              </h2>
            </div>
            {prs.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-6 px-3 text-center">
                No PRs recorded. Your coach can enter them on your profile.
              </p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {prs.map(pr => (
                  <li
                    key={pr.exerciseId}
                    className="flex items-baseline justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm text-gray-200 truncate">{pr.exerciseName}</span>
                    <div className="flex items-baseline gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-white">
                        {pr.prValueKg?.toFixed(1)}
                        <span className="text-xs text-gray-500 font-normal ml-1">kg</span>
                      </span>
                      {pr.prDate && (
                        <span className="text-[10px] text-gray-500">{shortDate(pr.prDate)}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
