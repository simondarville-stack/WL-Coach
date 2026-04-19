import { useState, useEffect, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Minus, Trash2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { Athlete, BodyweightEntry } from '../lib/database.types';
import { useBodyweight } from '../hooks/useBodyweight';
import { formatDateToDDMMYYYY, formatDateShort } from '../lib/dateUtils';

type TimeRange = '30d' | '90d' | '6m' | '1y' | 'All';

interface BodyweightPopupProps {
  athlete: Athlete;
  maDays: number;
  onClose: () => void;
}

function rollingAverage(entries: BodyweightEntry[], windowDays: number): { date: string; ma: number }[] {
  return entries.map((_, i) => {
    const window = entries.slice(Math.max(0, i - windowDays + 1), i + 1);
    const avg = window.reduce((s, e) => s + Number(e.weight_kg), 0) / window.length;
    return { date: entries[i].date, ma: Math.round(avg * 10) / 10 };
  });
}

function filterByRange(entries: BodyweightEntry[], range: TimeRange): BodyweightEntry[] {
  if (range === 'All') return entries;
  const now = new Date();
  const days = range === '30d' ? 30 : range === '90d' ? 90 : range === '6m' ? 182 : 365;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return entries.filter(e => new Date(e.date) >= cutoff);
}

export function BodyweightPopup({ athlete, maDays, onClose }: BodyweightPopupProps) {
  const { entries: allEntries, loading, fetchEntries, upsert, update, remove } = useBodyweight(athlete.id);
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newWeight, setNewWeight] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const filtered = useMemo(() => filterByRange(allEntries, timeRange), [allEntries, timeRange]);

  const maData = useMemo(() => rollingAverage(filtered, maDays), [filtered, maDays]);

  const chartData = useMemo(() =>
    filtered.map((e, i) => ({
      date: e.date,
      weight: Number(e.weight_kg),
      ma: maData[i]?.ma ?? null,
    })),
    [filtered, maData]
  );

  // Trend: compare current MA to MA from maDays ago
  const currentMA = useMemo(() => {
    const last = allEntries.slice(-maDays);
    if (!last.length) return null;
    return Math.round(last.reduce((s, e) => s + Number(e.weight_kg), 0) / last.length * 10) / 10;
  }, [allEntries, maDays]);

  const prevMA = useMemo(() => {
    const prev = allEntries.slice(-maDays * 2, -maDays);
    if (!prev.length) return null;
    return Math.round(prev.reduce((s, e) => s + Number(e.weight_kg), 0) / prev.length * 10) / 10;
  }, [allEntries, maDays]);

  const trend = currentMA !== null && prevMA !== null
    ? currentMA - prevMA
    : null;

  const TrendIcon = trend === null ? Minus
    : trend > 0.3 ? TrendingUp
    : trend < -0.3 ? TrendingDown
    : Minus;

  const trendColor = trend === null ? 'text-gray-400'
    : trend > 0.3 ? 'text-red-500'
    : trend < -0.3 ? 'text-green-500'
    : 'text-gray-400';

  const yMin = filtered.length ? Math.floor(Math.min(...filtered.map(e => Number(e.weight_kg))) - 2) : 0;
  const yMax = filtered.length ? Math.ceil(Math.max(...filtered.map(e => Number(e.weight_kg))) + 2) : 100;

  async function handleAddEntry() {
    const val = parseFloat(newWeight);
    if (!newDate || isNaN(val)) return;
    await upsert(newDate, val);
    setNewWeight('');
  }

  async function handleEditSave(entry: BodyweightEntry) {
    const val = parseFloat(editValue);
    if (isNaN(val)) { setEditingId(null); return; }
    await update(entry.id, val);
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await remove(id);
    setDeleteConfirmId(null);
  }

  const sortedDesc = [...allEntries].reverse();

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
      <div className="rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Bodyweight — {athlete.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">{maDays}-day avg:</span>
              {currentMA !== null ? (
                <>
                  <span className="font-medium text-gray-900">{currentMA.toFixed(1)} kg</span>
                  <TrendIcon size={14} className={trendColor} />
                  {trend !== null && (
                    <span className={`text-xs ${trendColor}`}>
                      {trend > 0 ? '+' : ''}{trend.toFixed(1)} kg
                    </span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">No data</span>
              )}
            </div>
            {athlete.weight_class && (
              <div>
                <span className="text-gray-500">Weight class:</span>{' '}
                <span className="font-medium text-gray-900">{athlete.weight_class}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Entries:</span>{' '}
              <span className="font-medium text-gray-900">{allEntries.length}</span>
            </div>
          </div>

          {/* Time range selector */}
          <div className="flex gap-1">
            {(['30d', '90d', '6m', '1y', 'All'] as TimeRange[]).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  timeRange === r
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Chart */}
          {loading ? (
            <div className="h-48 flex items-center justify-center"><div className="animate-spin rounded-full border-2 border-gray-200 border-t-blue-500 w-5 h-5" /></div>
          ) : filtered.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">No data for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[yMin, yMax]}
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={(v) => `${v}`}
                  width={35}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${Number(value).toFixed(1)} kg`,
                    name === 'weight' ? 'Daily' : `${maDays}-day MA`,
                  ]}
                  labelFormatter={(label) => formatDateToDDMMYYYY(label)}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend formatter={(value) => value === 'weight' ? 'Daily' : `${maDays}-day MA`} wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: '#3b82f6' }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="ma"
                  stroke="#f97316"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          {/* Add entry row */}
          <div className="flex items-center gap-2 py-2 border-t border-gray-100">
            <span className="text-xs font-medium text-gray-500 w-16">Add entry</span>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <input
              type="number"
              step={0.1}
              value={newWeight}
              onChange={e => setNewWeight(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddEntry(); }}
              placeholder="kg"
              className="w-20 px-2 py-1 text-xs border border-gray-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={handleAddEntry}
              disabled={!newWeight}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {/* Entries table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="text-left py-1.5 font-medium">Date</th>
                <th className="text-right py-1.5 font-medium">Weight (kg)</th>
                <th className="text-right py-1.5 font-medium">Δ</th>
                <th className="py-1.5 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {sortedDesc.map((entry, i) => {
                const prevEntry = sortedDesc[i + 1];
                const delta = prevEntry ? Number(entry.weight_kg) - Number(prevEntry.weight_kg) : null;
                const deltaColor = delta === null ? ''
                  : delta > 0.1 ? 'text-red-500'
                  : delta < -0.1 ? 'text-green-500'
                  : 'text-gray-400';

                return (
                  <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 text-gray-700">{formatDateToDDMMYYYY(entry.date)}</td>
                    <td className="py-1.5 text-right">
                      {editingId === entry.id ? (
                        <input
                          type="number"
                          step={0.1}
                          value={editValue}
                          autoFocus
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => handleEditSave(entry)}
                          onKeyDown={e => { if (e.key === 'Enter') handleEditSave(entry); if (e.key === 'Escape') setEditingId(null); }}
                          className="w-20 px-1 py-0.5 border border-blue-400 rounded text-center text-xs focus:outline-none"
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:text-blue-600 font-medium"
                          onClick={() => { setEditingId(entry.id); setEditValue(String(entry.weight_kg)); }}
                        >
                          {Number(entry.weight_kg).toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className={`py-1.5 text-right ${deltaColor}`}>
                      {delta !== null ? (delta > 0 ? '+' : '') + delta.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      {deleteConfirmId === entry.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleDelete(entry.id)} className="text-red-600 hover:text-red-700 text-[10px] font-medium">Yes</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="text-gray-400 hover:text-gray-600 text-[10px]">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(entry.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedDesc.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-400 italic">No entries yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
