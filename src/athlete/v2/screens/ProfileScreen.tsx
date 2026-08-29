/**
 * ProfileScreen — athlete identity, bodyweight history chart, PR table,
 * sign-out / switch profile.
 *
 * BW chart sources from training_log_sessions.bodyweight_kg (single
 * source of truth chosen in P3). PRs come from athlete_prs joined with
 * exercise names.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut, Trophy, User as UserIcon, Loader2 } from 'lucide-react';
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
import { formatDateShort } from '../../../lib/dateUtils';

function shortDate(iso: string): string {
  return formatDateShort(iso);
}

export function ProfileScreen() {
  const navigate = useNavigate();
  const { athlete, signOut, locked } = useAuth();
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
        <div className="w-14 h-14 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center flex-shrink-0 overflow-hidden">
          {athlete.photo_url ? (
            <img src={athlete.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <UserIcon size={24} className="text-[color:var(--color-text-secondary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-white truncate">{athlete.name}</h1>
          <div className="flex items-center gap-2 text-xs text-[color:var(--color-text-secondary)]">
            {athlete.weight_class && <span>{athlete.weight_class}</span>}
            {athlete.club && <span>· {athlete.club}</span>}
          </div>
        </div>
        {/* A locked session (reached via a personal link) hides the Switch
            path so the viewer can't browse into other athletes' data. */}
        {!locked && (
          <button
            onClick={signOut}
            className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-[color:var(--color-text-secondary)] hover:text-white px-3 py-2 rounded-md border border-[color:var(--color-border-tertiary)] hover:border-[color:var(--color-border-primary)]"
          >
            <LogOut size={12} />
            Switch
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-[color:var(--color-text-secondary)]">
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
          <section className="rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] p-3">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-[11px] uppercase tracking-wide font-semibold text-[color:var(--color-text-secondary)]">
                Bodyweight
              </h2>
              {bwLatest != null && (
                <span className="text-sm font-bold text-white">
                  {bwLatest.toFixed(1)} <span className="text-xs text-[color:var(--color-text-secondary)] font-normal">kg</span>
                </span>
              )}
            </div>
            {bw.length === 0 ? (
              <p className="text-xs text-[color:var(--color-text-secondary)] italic py-6 text-center">
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
                <div className="flex justify-between text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)] mt-1 px-2">
                  <span>min {bwMin.toFixed(1)}</span>
                  <span>max {bwMax.toFixed(1)}</span>
                  <span>{bw.length} entries</span>
                </div>
              </>
            )}
          </section>

          {/* Personal records — link to the dedicated PRs screen.
              Shows a small preview of count + best lift so the row is
              meaningful at a glance without taking the full table inline. */}
          <button
            type="button"
            onClick={() => navigate('/athlete/prs')}
            className="w-full rounded-xl bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] hover:border-[color:var(--color-border-secondary)] hover:bg-gray-900/80 transition-colors text-left flex items-center gap-3 px-3 py-3"
          >
            <div className="w-9 h-9 rounded-full bg-blue-950 border border-blue-900 flex items-center justify-center flex-shrink-0">
              <Trophy size={16} className="text-[color:var(--color-accent)]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">Personal records</div>
              <div className="text-[11px] text-[color:var(--color-text-secondary)] mt-0.5">
                {prs.length === 0
                  ? 'No PRs yet — tap to log one'
                  : `${prs.length} exercise${prs.length === 1 ? '' : 's'} with a PR`}
              </div>
            </div>
            <ChevronRight size={16} className="text-[color:var(--color-text-secondary)] flex-shrink-0" />
          </button>
        </>
      )}
    </div>
  );
}
