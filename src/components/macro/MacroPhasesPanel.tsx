import { useState, useEffect, useRef } from 'react';
import { X, Plus, Pencil, Trash2, ArrowLeft, AlertTriangle } from 'lucide-react';
import type { MacroPhase, MacroWeek, PhaseType, PhaseTypePreset } from '../../lib/database.types';
import { DEFAULT_PHASE_TYPE_PRESETS } from '../../lib/constants';
import { Button } from '../ui';

interface MacroPhasesPanelProps {
  macrocycleId: string;
  macroWeeks: MacroWeek[];
  phases: MacroPhase[];
  initialEditingPhase?: MacroPhase | null;
  phaseTypePresets?: PhaseTypePreset[];
  onSave: (phase: Omit<MacroPhase, 'id' | 'owner_id' | 'created_at' | 'updated_at'>, editingId?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

function hasOverlap(a: MacroPhase, phases: MacroPhase[]): boolean {
  return phases.some(b => b.id !== a.id && a.start_week_number <= b.end_week_number && a.end_week_number >= b.start_week_number);
}

function getOverlapWith(start: number, end: number, phases: MacroPhase[], excludeId?: string): MacroPhase | null {
  return phases.find(p => p.id !== excludeId && start <= p.end_week_number && end >= p.start_week_number) ?? null;
}

/** Week numbers not covered by any phase (optionally ignoring the one being edited). */
function freeWeekNumbers(weekNums: number[], phases: MacroPhase[], excludeId?: string): number[] {
  return weekNums.filter(n =>
    !phases.some(p => p.id !== excludeId && n >= p.start_week_number && n <= p.end_week_number),
  );
}

/** Collapse a sorted list of week numbers into compact ranges ("W7–W9, W14"). */
function formatWeekRanges(nums: number[]): string {
  if (nums.length === 0) return 'none';
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    ranges.push(start === prev ? `W${start}` : `W${start}–W${prev}`);
    start = prev = sorted[i];
  }
  ranges.push(start === prev ? `W${start}` : `W${start}–W${prev}`);
  return ranges.join(', ');
}

/** One-line "N free weeks (…)" summary, reused by both views. */
function FreeWeeksSummary({ weekNums, phases, excludeId }: { weekNums: number[]; phases: MacroPhase[]; excludeId?: string }) {
  const free = freeWeekNumbers(weekNums, phases, excludeId);
  return (
    <p className="mt-1" style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
      {free.length > 0
        ? `${free.length} free week${free.length === 1 ? '' : 's'}: ${formatWeekRanges(free)}`
        : 'All weeks are covered by a phase.'}
    </p>
  );
}

// ── Week coverage strip ────────────────────────────────────────────────────────

// Diagonal hatch so a FREE week never reads as a pale phase colour.
const FREE_CELL_BG = 'repeating-linear-gradient(45deg, var(--color-bg-tertiary) 0 3px, transparent 3px 6px)';

function CoverageStrip({
  totalWeeks,
  phases,
  highlightStart,
  highlightEnd,
  highlightColor,
  highlightId,
  startWeekNum = 1,
  onSelectRange,
}: {
  totalWeeks: number;
  phases: MacroPhase[];
  highlightStart?: number;
  highlightEnd?: number;
  highlightColor?: string;
  highlightId?: string;
  /** First real week_number (usually 1) so cells map to actual weeks. */
  startWeekNum?: number;
  /** When provided, the strip is interactive: click a cell to set the start,
   *  drag across cells to set the whole range (start..end). */
  onSelectRange?: (start: number, end: number) => void;
}) {
  // Hooks must run unconditionally (before the totalWeeks===0 early return).
  const anchorRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const stop = () => { setDragging(false); anchorRef.current = null; };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, [dragging]);

  if (totalWeeks === 0) return null;
  const interactive = !!onSelectRange;
  const showNums = totalWeeks <= 24;
  const swatch = (bg: string) => (
    <span style={{ width: 10, height: 10, borderRadius: 2, background: bg, display: 'inline-block', border: '0.5px solid var(--color-border-secondary)' }} />
  );
  const beginAt = (n: number) => { anchorRef.current = n; setDragging(true); onSelectRange?.(n, n); };
  const extendTo = (n: number) => {
    const a = anchorRef.current;
    if (!dragging || a == null) return;
    onSelectRange?.(Math.min(a, n), Math.max(a, n));
  };
  return (
    <div>
      <div className="flex w-full rounded overflow-hidden" style={{ height: showNums ? 16 : 14, touchAction: interactive ? 'none' : undefined }}>
        {Array.from({ length: totalWeeks }, (_, i) => startWeekNum + i).map(n => {
          const isHighlighted = highlightStart !== undefined && highlightEnd !== undefined && n >= highlightStart && n <= highlightEnd;
          const existing = phases.find(p => p.id !== highlightId && n >= p.start_week_number && n <= p.end_week_number);
          let background = FREE_CELL_BG;
          let textColor = 'var(--color-text-tertiary)';
          if (existing) { background = existing.color; textColor = '#fff'; }
          if (isHighlighted && existing) { background = '#ef4444'; textColor = '#fff'; }
          else if (isHighlighted && highlightColor) { background = highlightColor; textColor = '#fff'; }
          return (
            <div
              key={n}
              className="flex items-center justify-center"
              onPointerDown={interactive ? (e => {
                e.preventDefault();
                // Touch/pen implicitly capture the pointer to this cell on
                // pointerdown, which suppresses pointerenter on the other cells
                // mid-drag. Release it so the range-drag (driven by
                // onPointerEnter → extendTo) works on touch, not just mouse.
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                beginAt(n);
              }) : undefined}
              onPointerEnter={interactive ? (() => extendTo(n)) : undefined}
              style={{ flex: 1, background, borderRight: '1px solid var(--color-bg-primary)', fontSize: 8, fontWeight: 600, color: textColor, cursor: interactive ? 'pointer' : undefined, userSelect: 'none' }}
              title={existing ? existing.name : isHighlighted ? 'New phase' : `Wk ${n} · free${interactive ? ' · click/drag to select' : ''}`}
            >
              {showNums ? n : ''}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-1" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
        <span className="flex items-center gap-1">{swatch(FREE_CELL_BG)} free</span>
        <span className="flex items-center gap-1">{swatch('var(--color-text-tertiary)')} claimed</span>
        <span className="flex items-center gap-1">{swatch('#ef4444')} overlap</span>
        {interactive && <span className="ml-auto italic">click a week, drag to set range</span>}
      </div>
    </div>
  );
}

// ── Form view ──────────────────────────────────────────────────────────────────

interface FormViewProps {
  macrocycleId: string;
  macroWeeks: MacroWeek[];
  phases: MacroPhase[];
  editingPhase: MacroPhase | null;
  nextPosition: number;
  phaseTypePresets: PhaseTypePreset[];
  onSave: MacroPhasesPanelProps['onSave'];
  onDelete: MacroPhasesPanelProps['onDelete'];
  onBack: () => void;
}

function FormView({ macrocycleId, macroWeeks, phases, editingPhase, nextPosition, phaseTypePresets, onSave, onDelete, onBack }: FormViewProps) {
  const weekNums = macroWeeks.map(w => w.week_number);
  const minWeek = weekNums.length > 0 ? Math.min(...weekNums) : 1;
  const maxWeek = weekNums.length > 0 ? Math.max(...weekNums) : 1;

  const [name, setName] = useState(editingPhase?.name ?? '');
  const [phaseType, setPhaseType] = useState<PhaseType>(editingPhase?.phase_type ?? 'custom');
  const [startWeek, setStartWeek] = useState(editingPhase?.start_week_number ?? minWeek);
  const [endWeek, setEndWeek] = useState(editingPhase?.end_week_number ?? maxWeek);
  const [color, setColor] = useState(editingPhase?.color ?? '#E5E7EB');
  const [notes, setNotes] = useState(editingPhase?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);

  useEffect(() => { setOverlapError(null); }, [startWeek, endWeek]);

  const handleTypeChange = (val: PhaseType) => {
    setPhaseType(val);
    const preset = phaseTypePresets.find(p => p.value === val);
    if (preset) setColor(preset.color);
    if (!name || phaseTypePresets.some(p => p.label === name)) setName(preset?.label ?? val);
  };

  const handleStartChange = (v: number) => {
    setStartWeek(v);
    if (endWeek < v) setEndWeek(v);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const conflict = getOverlapWith(startWeek, endWeek, phases, editingPhase?.id);
    if (conflict) {
      setOverlapError(`Overlaps with "${conflict.name}" (Wk ${conflict.start_week_number}–${conflict.end_week_number})`);
      return;
    }
    setSaving(true);
    try {
      await onSave(
        { macrocycle_id: macrocycleId, name: name.trim(), phase_type: phaseType, start_week_number: startWeek, end_week_number: endWeek, color, notes, position: editingPhase?.position ?? nextPosition },
        editingPhase?.id
      );
      onBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingPhase) return;
    setDeleting(true);
    try {
      await onDelete(editingPhase.id);
      onBack();
    } finally {
      setDeleting(false);
    }
  };

  const weeks = Array.from({ length: maxWeek - minWeek + 1 }, (_, i) => minWeek + i);

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-4 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-primary)' }}>
        <button onClick={onBack} className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)] flex items-center gap-1 text-xs">
          <ArrowLeft size={14} /> Back
        </button>
        <span style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {editingPhase ? 'Edit phase' : 'Add phase'}
        </span>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            placeholder="e.g. Accumulation, Strength Block"
            autoFocus
          />
        </div>

        <div>
          <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Phase type</label>
          <input
            list="phase-type-suggestions"
            value={phaseType}
            onChange={e => handleTypeChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            placeholder="e.g. Preparatory, Strength, Competition…"
          />
          <datalist id="phase-type-suggestions">
            {phaseTypePresets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Start week</label>
            <select
              value={startWeek}
              onChange={e => handleStartChange(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            >
              {weeks.map(n => {
                const p = getOverlapWith(n, n, phases, editingPhase?.id);
                return <option key={n} value={n}>Week {n}{p ? ` — ${p.name}` : ' (free)'}</option>;
              })}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>End week</label>
            <select
              value={endWeek}
              onChange={e => setEndWeek(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            >
              {weeks.filter(n => n >= startWeek).map(n => {
                const p = getOverlapWith(n, n, phases, editingPhase?.id);
                return <option key={n} value={n}>Week {n}{p ? ` — ${p.name}` : ' (free)'}</option>;
              })}
            </select>
          </div>
        </div>

        {/* Coverage strip showing impact of current selection */}
        <div>
          <CoverageStrip
            totalWeeks={maxWeek - minWeek + 1}
            startWeekNum={minWeek}
            phases={phases}
            highlightStart={startWeek}
            highlightEnd={endWeek}
            highlightColor={color}
            highlightId={editingPhase?.id}
            onSelectRange={(s, e) => { setStartWeek(s); setEndWeek(e); }}
          />
          <FreeWeeksSummary weekNums={weekNums} phases={phases} excludeId={editingPhase?.id} />
        </div>

        {overlapError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded text-xs" style={{ color: 'var(--color-danger-text)', backgroundColor: 'var(--color-danger-bg)', border: '0.5px solid var(--color-danger-border)' }}>
            <AlertTriangle size={13} className="flex-shrink-0" />
            {overlapError}
          </div>
        )}

        <div>
          <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-10 h-10 rounded border border-[color:var(--color-border-tertiary)] cursor-pointer"
            />
            <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Phase ribbon color</span>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            value={notes}
            onChange={e => {
              setNotes(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)] resize-none overflow-hidden"
            placeholder="Optional notes…"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2 px-5 py-4 flex-shrink-0" style={{ borderTop: '0.5px solid var(--color-border-primary)' }}>
        {editingPhase && (
          <button
            onClick={handleDelete}
            disabled={deleting || saving}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-[color:var(--color-danger-text)] border border-[color:var(--color-danger-border)] rounded-lg hover:bg-[var(--color-danger-bg)] disabled:opacity-50"
          >
            <Trash2 size={13} />
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <Button
          variant="secondary"
          onClick={onBack}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1"
        >
          {saving ? 'Saving…' : editingPhase ? 'Update' : 'Add phase'}
        </Button>
      </div>
    </div>
  );
}

// ── List view ──────────────────────────────────────────────────────────────────

interface ListViewProps {
  phases: MacroPhase[];
  totalWeeks: number;
  onEdit: (phase: MacroPhase) => void;
  onAdd: () => void;
  onDelete: (id: string) => Promise<void>;
}

function ListView({ phases, totalWeeks, onEdit, onAdd, onDelete }: ListViewProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const sorted = [...phases].sort((a, b) => a.start_week_number - b.start_week_number);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try { await onDelete(id); } finally { setDeletingId(null); }
  };

  return (
    <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
      {/* Coverage strip for all phases */}
      <div className="px-5 pt-4 pb-3" style={{ borderBottom: '0.5px solid var(--color-border-primary)' }}>
        <CoverageStrip totalWeeks={totalWeeks} phases={phases} />
        <FreeWeeksSummary weekNums={Array.from({ length: totalWeeks }, (_, i) => i + 1)} phases={phases} />
      </div>

      {/* Phase list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-5 py-8 text-center" style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)' }}>
            No phases yet. Add one to divide this cycle into blocks.
          </p>
        ) : (
          sorted.map(phase => {
            const overlapping = hasOverlap(phase, phases);
            return (
              <div
                key={phase.id}
                className="flex items-center gap-3 px-5 py-3"
                style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
              >
                {/* Color swatch */}
                <div
                  className="flex-shrink-0 rounded"
                  style={{ width: 14, height: 14, backgroundColor: phase.color, border: '0.5px solid rgba(0,0,0,0.12)' }}
                />

                {/* Name + range */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-primary)' }} className="truncate">
                      {phase.name}
                    </span>
                    {overlapping && (
                      <span title="Overlaps with another phase" className="inline-flex">
                        <AlertTriangle size={12} className="flex-shrink-0 text-amber-500" aria-label="Overlaps with another phase" />
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                    Wk {phase.start_week_number}–{phase.end_week_number}
                    {overlapping && <span className="text-amber-500 ml-1">· overlap</span>}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onEdit(phase)}
                    className="p-1.5 rounded hover:bg-[var(--color-bg-secondary)] text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]"
                    title="Edit phase"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(phase.id)}
                    disabled={deletingId === phase.id}
                    className="p-1.5 rounded hover:bg-[var(--color-danger-bg)] text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-danger-text)] disabled:opacity-40"
                    title="Delete phase"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add button */}
      <div className="px-5 py-4 flex-shrink-0" style={{ borderTop: '0.5px solid var(--color-border-primary)' }}>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 w-full justify-center px-4 py-2 text-sm font-medium text-[color:var(--color-accent)] border border-[color:var(--color-accent-border)] rounded-lg hover:bg-[var(--color-accent-muted)]"
        >
          <Plus size={14} /> Add phase
        </button>
      </div>
    </div>
  );
}

// ── Panel root ─────────────────────────────────────────────────────────────────

export function MacroPhasesPanel({
  macrocycleId,
  macroWeeks,
  phases,
  initialEditingPhase,
  phaseTypePresets,
  onSave,
  onDelete,
  onClose,
}: MacroPhasesPanelProps) {
  const presets = phaseTypePresets && phaseTypePresets.length > 0 ? phaseTypePresets : DEFAULT_PHASE_TYPE_PRESETS;
  const [view, setView] = useState<'list' | 'form'>(initialEditingPhase ? 'form' : 'list');
  const [editingPhase, setEditingPhase] = useState<MacroPhase | null>(initialEditingPhase ?? null);

  const totalWeeks = macroWeeks.length;

  const openEdit = (phase: MacroPhase) => { setEditingPhase(phase); setView('form'); };
  const openAdd  = ()               => { setEditingPhase(null);   setView('form'); };
  const goBack   = ()               => { setEditingPhase(null);   setView('list'); };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div
        className="rounded-lg flex flex-col"
        style={{
          backgroundColor: 'var(--color-bg-primary)',
          border: '0.5px solid var(--color-border-primary)',
          width: 420,
          maxHeight: '90vh',
        }}
      >
        {/* Shared header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-primary)' }}>
          <span style={{ fontSize: 'var(--text-body)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Phases
          </span>
          <button onClick={onClose} className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]">
            <X size={18} />
          </button>
        </div>

        {/* View */}
        {view === 'list' ? (
          <ListView
            phases={phases}
            totalWeeks={totalWeeks}
            onEdit={openEdit}
            onAdd={openAdd}
            onDelete={onDelete}
          />
        ) : (
          <FormView
            macrocycleId={macrocycleId}
            macroWeeks={macroWeeks}
            phases={phases}
            editingPhase={editingPhase}
            nextPosition={phases.length + 1}
            phaseTypePresets={presets}
            onSave={onSave}
            onDelete={onDelete}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
}
