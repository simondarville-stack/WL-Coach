import { useState, useEffect } from 'react';
import { X, Plus, Pencil, Trash2, ArrowLeft, AlertTriangle } from 'lucide-react';
import type { MacroPhase, MacroWeek, PhaseType } from '../../lib/database.types';

interface MacroPhasesPanelProps {
  macrocycleId: string;
  macroWeeks: MacroWeek[];
  phases: MacroPhase[];
  initialEditingPhase?: MacroPhase | null;
  onSave: (phase: Omit<MacroPhase, 'id' | 'created_at' | 'updated_at'>, editingId?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

const PHASE_PRESETS: { value: PhaseType; label: string; color: string }[] = [
  { value: 'preparatory', label: 'Preparatory', color: '#DBEAFE' },
  { value: 'strength',    label: 'Strength',    color: '#FEE2E2' },
  { value: 'competition', label: 'Competition', color: '#FEF3C7' },
  { value: 'transition',  label: 'Transition',  color: '#F3F4F6' },
  { value: 'custom',      label: 'Custom',      color: '#E5E7EB' },
];

function hasOverlap(a: MacroPhase, phases: MacroPhase[]): boolean {
  return phases.some(b => b.id !== a.id && a.start_week_number <= b.end_week_number && a.end_week_number >= b.start_week_number);
}

function getOverlapWith(start: number, end: number, phases: MacroPhase[], excludeId?: string): MacroPhase | null {
  return phases.find(p => p.id !== excludeId && start <= p.end_week_number && end >= p.start_week_number) ?? null;
}

// ── Week coverage strip ────────────────────────────────────────────────────────

function CoverageStrip({
  totalWeeks,
  phases,
  highlightStart,
  highlightEnd,
  highlightColor,
  highlightId,
}: {
  totalWeeks: number;
  phases: MacroPhase[];
  highlightStart?: number;
  highlightEnd?: number;
  highlightColor?: string;
  highlightId?: string;
}) {
  if (totalWeeks === 0) return null;
  return (
    <div>
      <div className="flex w-full rounded overflow-hidden" style={{ height: 14 }}>
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(n => {
          const isHighlighted = highlightStart !== undefined && highlightEnd !== undefined && n >= highlightStart && n <= highlightEnd;
          const existing = phases.find(p => p.id !== highlightId && n >= p.start_week_number && n <= p.end_week_number);
          let bg = 'var(--color-bg-secondary)';
          if (existing) bg = existing.color;
          if (isHighlighted && existing) bg = '#ef4444';
          else if (isHighlighted && highlightColor) bg = highlightColor;
          return (
            <div
              key={n}
              style={{ flex: 1, backgroundColor: bg, borderRight: '1px solid var(--color-bg-primary)' }}
              title={existing ? existing.name : isHighlighted ? 'New phase' : `Wk ${n}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-0.5">
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Wk 1</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Wk {totalWeeks}</span>
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
  onSave: MacroPhasesPanelProps['onSave'];
  onDelete: MacroPhasesPanelProps['onDelete'];
  onBack: () => void;
}

function FormView({ macrocycleId, macroWeeks, phases, editingPhase, nextPosition, onSave, onDelete, onBack }: FormViewProps) {
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
    const preset = PHASE_PRESETS.find(p => p.value === val);
    if (preset) setColor(preset.color);
    if (!name || PHASE_PRESETS.some(p => p.label === name)) setName(preset?.label ?? '');
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
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 flex items-center gap-1 text-xs">
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
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g. Preparatory, Strength, Competition…"
          />
          <datalist id="phase-type-suggestions">
            {PHASE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Start week</label>
            <select
              value={startWeek}
              onChange={e => handleStartChange(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {weeks.map(n => <option key={n} value={n}>Week {n}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>End week</label>
            <select
              value={endWeek}
              onChange={e => setEndWeek(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {weeks.filter(n => n >= startWeek).map(n => <option key={n} value={n}>Week {n}</option>)}
            </select>
          </div>
        </div>

        {/* Coverage strip showing impact of current selection */}
        <CoverageStrip
          totalWeeks={maxWeek - minWeek + 1}
          phases={phases}
          highlightStart={startWeek}
          highlightEnd={endWeek}
          highlightColor={color}
          highlightId={editingPhase?.id}
        />

        {overlapError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded text-xs text-red-700 bg-red-50" style={{ border: '0.5px solid #fca5a5' }}>
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
              className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
            />
            <span className="text-sm text-gray-400">Phase ribbon color</span>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 'var(--text-label)', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={13} />
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
        <button
          onClick={onBack}
          className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editingPhase ? 'Update' : 'Add phase'}
        </button>
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
                      <AlertTriangle size={12} className="flex-shrink-0 text-amber-500" title="Overlaps with another phase" />
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
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    title="Edit phase"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(phase.id)}
                    disabled={deletingId === phase.id}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 disabled:opacity-40"
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
          className="flex items-center gap-1.5 w-full justify-center px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
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
  onSave,
  onDelete,
  onClose,
}: MacroPhasesPanelProps) {
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
            onSave={onSave}
            onDelete={onDelete}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
}
