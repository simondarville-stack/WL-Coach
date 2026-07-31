// 4-step wizard for building a Soll–Ist analysis: Athlete → Model →
// Exercises → Create. The one genuinely sequential flow in the module (each
// step's options depend on the previous choice), which is what justifies a
// wizard over inline editing (CLAUDE.md).

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Input, Modal, Select, SegmentedControl } from '../../ui';
import type { Exercise } from '../../../lib/database.types';
import type { SollIstModel, SollIstRow } from '../../../lib/sollIst';
import { parseModelCsv } from '../../../lib/sollIstCsv';
import { formatDateToDDMMYYYY, toLocalISO } from '../../../lib/dateUtils';
import { modelOptions, resolveModelRef } from './sollIstState';

interface NamedEntity {
  id: string;
  name: string;
}

export interface WizardResult {
  athleteId: string | null;
  modelRef: string | null;
  rows: SollIstRow[];
  name: string;
}

interface SollIstWizardProps {
  isOpen: boolean;
  onClose: () => void;
  athletes: NamedEntity[];
  exercises: Exercise[];
  models: SollIstModel[];
  onCreate: (result: WizardResult) => void;
}

const STEPS = ['Athlete', 'Model', 'Exercises', 'Create'] as const;

export function SollIstWizard({ isOpen, onClose, athletes, exercises, models, onCreate }: SollIstWizardProps) {
  const [step, setStep] = useState(0);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [modelRef, setModelRef] = useState<string | null>(null);
  const [rows, setRows] = useState<SollIstRow[]>([]);
  const [name, setName] = useState('');
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = modelOptions(models);
  const sortedExercises = [...exercises].sort((a, b) => a.name.localeCompare(b.name));

  const reset = () => {
    setStep(0);
    setAthleteId(null);
    setModelRef(null);
    setRows([]);
    setName('');
    setCsvWarnings([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickModel = (ref: string | null) => {
    setModelRef(ref);
    setCsvWarnings([]);
    setRows(ref ? resolveModelRef(ref, models, exercises)?.rows ?? [] : []);
  };

  const importCsv = (file: File) => {
    void file.text().then((text) => {
      const { rows: parsed, warnings } = parseModelCsv(text, exercises);
      setModelRef(null);
      setRows(parsed);
      setCsvWarnings(warnings);
      if (parsed.length > 0) setStep(2);
    });
  };

  const updateRow = (i: number, patch: Partial<SollIstRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const defaultName = () => {
    const athlete = athletes.find((a) => a.id === athleteId);
    const date = formatDateToDDMMYYYY(toLocalISO(new Date()));
    return athlete ? `${athlete.name} — ${date}` : `Soll–Ist — ${date}`;
  };

  const finish = () => {
    onCreate({
      athleteId,
      modelRef,
      rows: rows.filter((r) => r.indexPct > 0),
      name: name.trim() || defaultName(),
    });
    reset();
  };

  const canNext = step === 1 || step === 2 ? rows.length > 0 : true;

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="xl"
      title="New Soll–Ist analysis"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ visibility: step === 0 ? 'hidden' : undefined }}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={!canNext}
            onClick={() => (step === STEPS.length - 1 ? finish() : setStep((s) => s + 1))}
          >
            {step === STEPS.length - 1 ? 'Create analysis' : 'Next'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-md)' }}>
        {STEPS.map((s, i) => (
          <span
            key={s}
            style={{
              fontSize: 'var(--text-caption)',
              padding: '3px 10px',
              borderRadius: 12,
              background: i === step ? 'var(--color-accent)' : i < step ? 'rgba(24, 95, 165, 0.12)' : 'var(--color-bg-secondary)',
              color: i === step ? 'var(--color-text-on-accent)' : i < step ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              fontWeight: i === step ? 600 : 400,
            }}
          >
            {i + 1} · {s}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Who is this analysis for? Without an athlete the sheet is a pure model table (reference = 100).
          </p>
          <div style={{ maxWidth: 320 }}>
            <Select value={athleteId ?? ''} onChange={(e) => setAthleteId(e.target.value || null)}>
              <option value="">— no athlete (index 100) —</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Pick the reference model. Textbook models ship with EMOS; individual and custom models are yours. Or import a
            CSV template (<code>exercise;ref;index;reps</code>, ref = SN/CJ or Kategorie 1/2).
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
            <div style={{ maxWidth: 360, flex: 1 }}>
              <Select value={modelRef ?? ''} onChange={(e) => pickModel(e.target.value || null)}>
                <option value="">Choose a model…</option>
                <optgroup label="Textbook">
                  {options.filter((o) => o.kind === 'textbook').map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
                {options.some((o) => o.kind !== 'textbook') && (
                  <optgroup label="Saved models">
                    {options.filter((o) => o.kind !== 'textbook').map((o) => (
                      <option key={o.ref} value={o.ref}>
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </div>
            <Button variant="ghost" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
              Import CSV…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.target.value = '';
              }}
            />
          </div>
          {rows.length > 0 && (
            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', margin: 0 }}>
              {rows.length} exercises loaded{rows.some((r) => r.exerciseId == null) ? ` — ${rows.filter((r) => r.exerciseId == null).length} not yet mapped to your catalogue (fix in the next step)` : ''}.
            </p>
          )}
          {csvWarnings.length > 0 && (
            <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
              {csvWarnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Adjust exercises, reference lift, index and reps. Rows marked ⚠ need a catalogue exercise.
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Exercise', 'Ref', 'Index %', 'Reps', ''].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '3px 6px',
                      fontSize: 'var(--text-caption)',
                      textAlign: i === 0 ? 'left' : 'center',
                      color: 'var(--color-text-tertiary)',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: '1px solid var(--color-border-secondary)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '2px 6px', minWidth: 220 }}>
                    <Select
                      value={r.exerciseId ?? ''}
                      onChange={(e) => {
                        const ex = exercises.find((x) => x.id === e.target.value);
                        updateRow(i, { exerciseId: ex?.id ?? null, label: ex?.name ?? r.label });
                      }}
                    >
                      <option value="">⚠ {r.label} (unmapped)</option>
                      {sortedExercises.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    <SegmentedControl
                      options={[
                        { id: 'snatch', label: 'SN' },
                        { id: 'clean_and_jerk', label: 'C&J' },
                      ]}
                      value={r.refSlot}
                      onChange={(refSlot) => updateRow(i, { refSlot })}
                      ariaLabel="Reference lift"
                    />
                  </td>
                  <td style={{ padding: '2px 6px', width: 90 }}>
                    <Input
                      type="number"
                      mono
                      step={0.5}
                      min={1}
                      value={r.indexPct}
                      onChange={(e) => updateRow(i, { indexPct: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td style={{ padding: '2px 6px', width: 70 }}>
                    <Input
                      type="number"
                      mono
                      step={1}
                      min={1}
                      max={10}
                      value={r.reps}
                      onChange={(e) => updateRow(i, { reps: Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                    />
                  </td>
                  <td style={{ padding: '2px 6px' }}>
                    <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setRows((rs) => [...rs, { exerciseId: null, label: 'New exercise', refSlot: 'clean_and_jerk', indexPct: 100, reps: 1 }])
              }
            >
              + Add exercise
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: 0 }}>
            {athleteId
              ? 'Current reference values will be suggested from the athlete’s PR table; goals default to +2,5 %. Both stay editable on the sheet.'
              : 'No athlete — the sheet opens as a pure index table (reference = 100).'}
          </p>
          <div style={{ maxWidth: 360 }}>
            <label style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Analysis name
            </label>
            <Input value={name} placeholder={defaultName()} onChange={(e) => setName(e.target.value)} />
          </div>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', margin: 0 }}>
            {rows.length} exercises · model: {modelRef ? resolveModelRef(modelRef, models, exercises)?.name ?? 'custom' : 'custom (CSV / blank)'}
          </p>
        </div>
      )}
    </Modal>
  );
}
