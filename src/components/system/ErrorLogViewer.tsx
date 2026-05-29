/**
 * ErrorLogViewer — coach-facing view of captured client errors.
 *
 * Pulls the 100 most recent rows from error_logs, lets the user filter
 * by source + actor role + resolved state, expand a row to inspect
 * the stack trace and breadcrumb trail, and mark a row resolved with
 * an optional note.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ErrorLogEntry, ErrorBreadcrumb } from '../../lib/database.types';

const SOURCE_LABELS: Record<ErrorLogEntry['source'], string> = {
  react: 'React',
  window: 'Window',
  promise: 'Promise',
  manual: 'Manual',
  supabase: 'Supabase',
};

const SOURCE_COLORS: Record<ErrorLogEntry['source'], string> = {
  react: 'bg-purple-100 text-purple-800',
  window: 'bg-red-100 text-red-800',
  promise: 'bg-amber-100 text-amber-800',
  manual: 'bg-gray-200 text-gray-800',
  supabase: 'bg-emerald-100 text-emerald-800',
};

interface Filters {
  sources: Set<ErrorLogEntry['source']>;
  role: 'all' | 'coach' | 'athlete' | 'unknown';
  unresolvedOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  sources: new Set<ErrorLogEntry['source']>(['react', 'window', 'promise', 'manual', 'supabase']),
  role: 'all',
  unresolvedOnly: true,
};

export function ErrorLogViewer() {
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyResolve, setBusyResolve] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setEntries((data ?? []) as ErrorLogEntry[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (!filters.sources.has(e.source)) return false;
      if (filters.role !== 'all' && (e.actor_role ?? 'unknown') !== filters.role) return false;
      if (filters.unresolvedOnly && e.resolved_at) return false;
      return true;
    });
  }, [entries, filters]);

  const toggleSource = (s: ErrorLogEntry['source']) => {
    setFilters((f) => {
      const next = new Set(f.sources);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...f, sources: next };
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolve = async (id: string) => {
    setBusyResolve(id);
    const note = window.prompt('Resolution note (optional)') ?? null;
    const { error } = await supabase
      .from('error_logs')
      .update({ resolved_at: new Date().toISOString(), resolved_note: note })
      .eq('id', id);
    setBusyResolve(null);
    if (error) {
      window.alert(`Failed to mark resolved: ${error.message}`);
      return;
    }
    void load();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Error log</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            Captured client errors from coach and athlete sessions. Newest 100 shown.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          data-track="error-log:refresh"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-600 mr-1">Source</span>
          {(Object.keys(SOURCE_LABELS) as ErrorLogEntry['source'][]).map((s) => {
            const on = filters.sources.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  on
                    ? `${SOURCE_COLORS[s]} border-transparent`
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
                data-track={`error-log:filter-source-${s}`}
              >
                {SOURCE_LABELS[s]}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-600 mr-1">Role</span>
          {(['all', 'coach', 'athlete', 'unknown'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilters((f) => ({ ...f, role: r }))}
              className={`px-2 py-0.5 text-xs rounded border transition-colors capitalize ${
                filters.role === r
                  ? 'bg-blue-100 text-blue-800 border-transparent'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 ml-auto">
          <input
            type="checkbox"
            checked={filters.unresolvedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, unresolvedOnly: e.target.checked }))}
          />
          Unresolved only
        </label>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-3 text-sm mb-4">
          Failed to load: {loadError}
        </div>
      )}

      {!entries && !loadError && (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      )}

      {entries && filtered.length === 0 && (
        <div className="text-sm text-gray-500 py-8 text-center border border-dashed border-gray-300 rounded">
          No errors match the current filters.
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            expanded={expanded.has(e.id)}
            onToggle={() => toggleExpanded(e.id)}
            onResolve={() => void resolve(e.id)}
            resolving={busyResolve === e.id}
          />
        ))}
      </div>
    </div>
  );
}

interface EntryRowProps {
  entry: ErrorLogEntry;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  resolving: boolean;
}

function EntryRow({ entry, expanded, onToggle, onResolve, resolving }: EntryRowProps) {
  const when = useMemo(() => formatRelativeTime(entry.created_at), [entry.created_at]);
  return (
    <div className={`border rounded-lg overflow-hidden ${entry.resolved_at ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-start gap-3 text-left hover:bg-gray-50"
      >
        <span className="mt-0.5 text-gray-400 flex-shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide flex-shrink-0 ${SOURCE_COLORS[entry.source]}`}>
          {SOURCE_LABELS[entry.source]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {entry.name ?? 'Error'}: {entry.message}
            </span>
            {entry.error_code && (
              <span className="text-[10px] text-gray-500 font-mono flex-shrink-0">[{entry.error_code}]</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{when}</span>
            {entry.url && <span className="font-mono">{entry.url}</span>}
            {entry.actor_label && (
              <span>
                {entry.actor_role ?? 'unknown'} · {entry.actor_label}
              </span>
            )}
            {!entry.actor_label && entry.actor_role && <span>{entry.actor_role}</span>}
            {entry.resolved_at && <span className="text-emerald-700">resolved</span>}
          </div>
        </div>
        {!entry.resolved_at && (
          <span
            role="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onResolve();
            }}
            className={`px-2 py-1 text-xs rounded border border-gray-300 inline-flex items-center gap-1 flex-shrink-0 ${
              resolving ? 'opacity-50 pointer-events-none' : 'hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700'
            }`}
            data-track="error-log:resolve"
          >
            <Check size={12} />
            Resolve
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-3 py-3 bg-gray-50 space-y-3 text-sm">
          {entry.user_agent && (
            <KV label="User agent" value={entry.user_agent} mono />
          )}
          {entry.app_version && <KV label="App version" value={entry.app_version} mono />}
          {entry.resolved_note && <KV label="Resolution note" value={entry.resolved_note} />}

          <section>
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Breadcrumbs</h4>
            <Breadcrumbs crumbs={entry.breadcrumbs ?? []} />
          </section>

          {entry.stack && (
            <section>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Stack</h4>
              <pre className="text-[11px] font-mono bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap break-words text-gray-800 max-h-80 overflow-auto">
                {entry.stack}
              </pre>
            </section>
          )}

          {entry.context && Object.keys(entry.context).length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Context</h4>
              <pre className="text-[11px] font-mono bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap break-words text-gray-800 max-h-60 overflow-auto">
                {JSON.stringify(entry.context, null, 2)}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs font-semibold text-gray-600 w-24 flex-shrink-0">{label}</span>
      <span className={`text-xs text-gray-800 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: ErrorBreadcrumb[] }) {
  if (!crumbs || crumbs.length === 0) {
    return <p className="text-xs text-gray-500 italic">No breadcrumbs captured.</p>;
  }
  return (
    <ol className="space-y-0.5">
      {crumbs.map((c, i) => (
        <li
          key={`${c.ts}-${i}`}
          className="text-xs font-mono text-gray-800 flex gap-2 items-baseline bg-white border border-gray-200 rounded px-2 py-1"
        >
          <span className="text-gray-400 flex-shrink-0">{formatTime(c.ts)}</span>
          <span className="text-blue-700 uppercase text-[10px] tracking-wide flex-shrink-0">{c.category}</span>
          <span className="text-gray-800 break-all">{c.message}</span>
          {c.data && Object.keys(c.data).length > 0 && (
            <span className="text-gray-500 truncate">{JSON.stringify(c.data)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default ErrorLogViewer;
