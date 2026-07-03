import { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui';
import { DateInput } from '../ui/DateInput';
import type { MacroTemplateRow } from '../../lib/macroTemplate';

interface CompetitionRow {
  name: string;
  date: string;
  is_primary: boolean;
}

type PhasePreset = 'none' | '8week' | '12week' | 'custom';

interface MacroCreateModalProps {
  loading: boolean;
  templates?: MacroTemplateRow[];
  onDeleteTemplate?: (id: string) => Promise<void>;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    startDate: string;
    endDate: string;
    competitions: CompetitionRow[];
    phasePreset: PhasePreset;
    /** When set, the cycle is created from this template. */
    template?: MacroTemplateRow;
    /** pct templates: per-exercise references chosen for this athlete. */
    templateReferences?: Record<string, number | null>;
  }) => Promise<void>;
}

/** End date that yields exactly `weekCount` Monday-based weeks from a start date. */
function endDateForWeeks(startDate: string, weekCount: number): string {
  const d = new Date(startDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7)); // back to Monday (weeks start Monday)
  monday.setDate(monday.getDate() + weekCount * 7 - 1);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function MacroCreateModal({ loading, templates = [], onDeleteTemplate, onClose, onCreate }: MacroCreateModalProps) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [phasePreset, setPhasePreset] = useState<PhasePreset>('none');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>('');
  const [templateRefs, setTemplateRefs] = useState<Record<string, string>>({});

  const template = templates.find(t => t.id === templateId);

  // Template drives the length: end date follows the start date automatically.
  useEffect(() => {
    if (template && startDate) setEndDate(endDateForWeeks(startDate, template.week_count));
  }, [template?.id, template?.week_count, startDate]);

  // Prefill per-exercise references from the template's stored ones (pct mode)
  useEffect(() => {
    if (!template || template.mode !== 'pct') { setTemplateRefs({}); return; }
    setTemplateRefs(Object.fromEntries(
      template.payload.exercises.map(ex => [ex.exercise_id, ex.reference_kg != null ? String(ex.reference_kg) : '']),
    ));
  }, [template?.id]);

  const addCompetition = () => {
    setCompetitions(prev => [...prev, { name: '', date: '', is_primary: false }]);
  };

  const removeCompetition = (i: number) => {
    setCompetitions(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateCompetition = (i: number, field: keyof CompetitionRow, value: string | boolean) => {
    setCompetitions(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        startDate,
        endDate,
        competitions: competitions.filter(c => c.name.trim() && c.date),
        phasePreset: template ? 'none' : phasePreset,
        template,
        templateReferences: template?.mode === 'pct'
          ? Object.fromEntries(Object.entries(templateRefs).map(([exId, v]) => {
              const n = parseFloat(v);
              return [exId, v.trim() !== '' && !isNaN(n) && n > 0 ? n : null];
            }))
          : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Failed to create macrocycle.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = name.trim() && startDate && endDate && startDate <= endDate;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border-tertiary)] flex-shrink-0">
          <h2 className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>Create Macrocycle</h2>
          <button onClick={onClose} className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-text-secondary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {templates.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Start from template</label>
              <div className="flex items-center gap-2">
                <select
                  value={templateId}
                  onChange={e => setTemplateId(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
                >
                  <option value="">Blank macrocycle</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.week_count}w · {t.mode === 'pct' ? 'general model (%)' : 'exact (kg)'}
                    </option>
                  ))}
                </select>
                {template && onDeleteTemplate && (
                  <button
                    onClick={() => { void onDeleteTemplate(template.id); setTemplateId(''); }}
                    className="text-[color:var(--color-text-tertiary)] hover:text-[color:var(--color-danger-text)]"
                    title="Delete this template"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {template && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {template.payload.exercises.length} exercises · {template.payload.phases.length} phases · week rhythm included. The end date follows the template's {template.week_count}-week length.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 2026 Olympic Prep"
              className="w-full px-3 py-2 text-sm border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-border)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Start date *</label>
              <DateInput value={startDate} onChange={setStartDate} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>End date *</label>
              {template ? (
                <p className="px-3 py-2 text-sm rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                  {endDate || '— pick a start date'}
                </p>
              ) : (
                <DateInput value={endDate} onChange={setEndDate} />
              )}
              {startDate && endDate && startDate > endDate && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger-text)' }}>End date must be after start date.</p>
              )}
            </div>
          </div>

          {template?.mode === 'pct' && template.payload.exercises.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                References for this athlete
              </label>
              <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                The template stores loads as % of these. Prefilled with the source cycle's references — adjust per exercise; leave empty to skip that exercise's loads.
              </p>
              <div className="space-y-1.5">
                {template.payload.exercises.map(ex => (
                  <div key={ex.exercise_id} className="flex items-center gap-2">
                    <span className="flex-1 text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{ex.exercise_name}</span>
                    <input
                      type="number"
                      step="2.5"
                      value={templateRefs[ex.exercise_id] ?? ''}
                      onChange={e => setTemplateRefs(prev => ({ ...prev, [ex.exercise_id]: e.target.value }))}
                      className="no-spin w-24 px-2 py-1 text-xs text-right border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-border)]"
                      placeholder="kg"
                    />
                    <span className="text-[10px] w-5" style={{ color: 'var(--color-text-tertiary)' }}>kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!template && (<div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>Phase preset</label>
            <div className="space-y-2">
              {([
                ['none', 'No phases'],
                ['8week', '8-week (Prep + Comp)'],
                ['12week', '12-week (Accum + Strength + Comp)'],
                ['custom', 'Custom (add phases manually later)'],
              ] as [PhasePreset, string][]).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="phasePreset"
                    value={val}
                    checked={phasePreset === val}
                    onChange={() => setPhasePreset(val)}
                    style={{ color: 'var(--color-accent)' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>)}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Competition dates</label>
              <button
                onClick={addCompetition}
                className="text-xs text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {competitions.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No competitions added yet.</p>
            )}

            {competitions.map((comp, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={comp.name}
                  onChange={e => updateCompetition(i, 'name', e.target.value)}
                  placeholder="Competition name"
                  className="flex-1 px-2 py-1.5 text-xs border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-border)]"
                />
                <div className="w-32">
                  <DateInput
                    value={comp.date}
                    onChange={v => updateCompetition(i, 'date', v)}
                    className="w-full px-2 py-1.5 text-xs border border-[color:var(--color-border-tertiary)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-border)]"
                  />
                </div>
                <label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={comp.is_primary}
                    onChange={e => updateCompetition(i, 'is_primary', e.target.checked)}
                    style={{ color: 'var(--color-accent)' }}
                  />
                  Primary
                </label>
                <button onClick={() => removeCompetition(i)} className="text-[color:var(--color-danger-text)] hover:text-red-700">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-xs rounded px-3 py-2" style={{ color: 'var(--color-danger-text)', backgroundColor: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)' }}>{error}</p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--color-border-tertiary)] flex-shrink-0">
          <Button
            variant="secondary"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting || loading}
            className="flex-1"
          >
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
