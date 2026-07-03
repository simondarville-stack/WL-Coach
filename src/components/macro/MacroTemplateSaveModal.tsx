/**
 * MacroTemplateSaveModal — save the current cycle as a reusable template.
 *
 * "General model (%)" (default) stores every load as % of each exercise's
 * reference so the template re-anchors to any athlete or future level;
 * "Exact copy (kg)" stores kilograms as they stand. Reps/Σreps/notes stay
 * absolute in both.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui';
import type { MacroPhase, MacroTarget, MacroTrackedExerciseWithExercise, MacroWeek } from '../../lib/database.types';
import { buildTemplatePayload, type MacroTemplateMode, type MacroTemplatePayload } from '../../lib/macroTemplate';

interface MacroTemplateSaveModalProps {
  cycleName: string;
  macroWeeks: MacroWeek[];
  phases: MacroPhase[];
  trackedExercises: MacroTrackedExerciseWithExercise[];
  targets: MacroTarget[];
  onSave: (name: string, mode: MacroTemplateMode, weekCount: number, payload: MacroTemplatePayload) => Promise<void>;
  onClose: () => void;
}

export function MacroTemplateSaveModal({
  cycleName,
  macroWeeks,
  phases,
  trackedExercises,
  targets,
  onSave,
  onClose,
}: MacroTemplateSaveModalProps) {
  const [name, setName] = useState(`${cycleName} — template`);
  const [mode, setMode] = useState<MacroTemplateMode>('pct');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(
    () => buildTemplatePayload(mode, macroWeeks, phases, trackedExercises, targets),
    [mode, macroWeeks, phases, trackedExercises, targets],
  );
  const cellCount = payload.exercises.reduce((s, ex) => s + ex.targets.length, 0);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), mode, macroWeeks.length, payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="rounded-lg max-w-md w-full" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--color-border-tertiary)]">
          <h2 className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>Save as template</h2>
          <button onClick={onClose} className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>Save as</label>
            <label className="flex items-start gap-2 text-sm cursor-pointer mb-2">
              <input type="radio" name="tplMode" checked={mode === 'pct'} onChange={() => setMode('pct')} className="mt-0.5" />
              <span>
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>General model (%)</span>
                <span className="block text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  Loads stored as % of each exercise's reference — re-anchors to another athlete or a future, higher level. You pick the references when applying.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" name="tplMode" checked={mode === 'kg'} onChange={() => setMode('kg')} className="mt-0.5" />
              <span>
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>Exact copy (kg)</span>
                <span className="block text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  Loads land unchanged — same athlete, same level.
                </span>
              </span>
            </label>
          </div>

          <div className="text-xs rounded px-3 py-2" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}>
            Captures: {macroWeeks.length} weeks (types, labels, Σreps) · {payload.phases.length} phases · {payload.exercises.length} exercises · {cellCount} target cells
            {mode === 'pct' && payload.exercises.some(ex => ex.reference_kg == null && ex.targets.some(t => t.max != null)) && (
              <span className="block mt-1 text-amber-600">
                Some exercises have no reference and no loads to derive one — their loads won't be stored.
              </span>
            )}
          </div>

          {error && (
            <p className="text-xs rounded px-3 py-2" style={{ color: 'var(--color-danger-text)', backgroundColor: 'var(--color-danger-bg)' }}>{error}</p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--color-border-tertiary)]">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!name.trim() || saving} className="flex-1">
            {saving ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </div>
    </div>
  );
}
