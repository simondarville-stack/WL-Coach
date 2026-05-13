// Template editor. Edits the program template in place — every change
// is auto-saved (debounced for text fields, immediate for structural
// changes). Prescriptions use the same PrescriptionGrid + stacked
// notation as the planner so templates stay visually consistent with
// the rest of EMOS. Combo composition (which exercises are in the
// combo) stays read-only in v1, but combo prescriptions are editable.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import {
  fetchTemplateFull,
  updateTemplate,
  insertTemplateDay,
  updateTemplateDay,
  deleteTemplateDay,
  insertTemplateExercise,
  updateTemplateExercise,
  deleteTemplateExercise,
} from '../../lib/templateService';
import { useExercises } from '../../hooks/useExercises';
import { useSettings } from '../../hooks/useSettings';
import { ExerciseSearch } from '../planner/ExerciseSearch';
import { PrescriptionGrid } from '../planner/PrescriptionGrid';
import type {
  Exercise,
  ProgramTemplateDayWithExercises,
  ProgramTemplateExerciseWithExercise,
  ProgramTemplateFull,
} from '../../lib/database.types';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 350;

export function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { exercises: allExercises, fetchExercisesByName } = useExercises();
  const { settings, fetchSettings } = useSettings();

  const loadIncrement = settings?.grid_load_increment ?? 5;
  const defaultPrescriptionLoad = settings?.default_prescription_load ?? 50;

  const [template, setTemplate] = useState<ProgramTemplateFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const headerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dayDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const exDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  useEffect(() => { fetchExercisesByName(); fetchSettings(); }, []);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const t = await fetchTemplateFull(templateId);
        if (cancelled) return;
        if (!t) {
          setError('Template not found');
          setLoading(false);
          return;
        }
        setTemplate(t);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load template');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  const flash = (s: SaveStatus) => {
    setStatus(s);
    if (s === 'saved') setTimeout(() => setStatus(cur => (cur === 'saved' ? 'idle' : cur)), 1200);
  };

  const wrapSave = async (fn: () => Promise<unknown>) => {
    setStatus('saving');
    try {
      await fn();
      flash('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('error');
    }
  };

  // ── Header: debounced save on name/description ────────────────────
  const setHeaderField = (field: 'name' | 'description', value: string) => {
    setTemplate(t => t ? { ...t, [field]: value } : t);
    if (!template) return;
    if (headerDebounceRef.current) clearTimeout(headerDebounceRef.current);
    headerDebounceRef.current = setTimeout(() => {
      void wrapSave(() => updateTemplate(template.id, { [field]: value || null }));
    }, DEBOUNCE_MS);
  };

  // ── Days ──────────────────────────────────────────────────────────
  const handleAddDay = async () => {
    if (!template) return;
    const nextIndex = template.days.length > 0
      ? Math.max(...template.days.map(d => d.day_index)) + 1
      : 1;
    await wrapSave(async () => {
      const day = await insertTemplateDay(template.id, nextIndex, `Day ${nextIndex}`);
      const fullDay: ProgramTemplateDayWithExercises = { ...day, exercises: [] };
      setTemplate(t => t ? { ...t, days: [...t.days, fullDay] } : t);
    });
  };

  const handleDeleteDay = async (dayId: string) => {
    if (!template) return;
    if (!window.confirm('Delete this template day? All its exercises will be removed.')) return;
    await wrapSave(async () => {
      await deleteTemplateDay(dayId);
      setTemplate(t => t ? { ...t, days: t.days.filter(d => d.id !== dayId) } : t);
    });
  };

  const setDayLabel = (dayId: string, label: string) => {
    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => d.id === dayId ? { ...d, label } : d),
    } : t);
    const existing = dayDebounceRef.current[dayId];
    if (existing) clearTimeout(existing);
    dayDebounceRef.current[dayId] = setTimeout(() => {
      void wrapSave(() => updateTemplateDay(dayId, { label }));
    }, DEBOUNCE_MS);
  };

  // ── Exercises within a day ────────────────────────────────────────
  const handleAddExercise = async (dayId: string, exercise: Exercise) => {
    if (!template) return;
    const day = template.days.find(d => d.id === dayId);
    if (!day) return;
    const position = day.exercises.length;
    await wrapSave(async () => {
      const inserted = await insertTemplateExercise(dayId, {
        exercise_id: exercise.id,
        position,
        unit: exercise.default_unit,
        prescription_raw: null,
        notes: null,
        variation_note: null,
        is_combo: false,
        combo_notation: null,
        combo_color: null,
      });
      const enriched: ProgramTemplateExerciseWithExercise = {
        ...inserted,
        exercise,
        combo_members: [],
      };
      setTemplate(t => t ? {
        ...t,
        days: t.days.map(d => d.id === dayId
          ? { ...d, exercises: [...d.exercises, enriched] }
          : d),
      } : t);
    });
  };

  const handleDeleteExercise = async (dayId: string, exerciseRowId: string) => {
    await wrapSave(async () => {
      await deleteTemplateExercise(exerciseRowId);
      setTemplate(t => t ? {
        ...t,
        days: t.days.map(d => d.id === dayId
          ? { ...d, exercises: d.exercises.filter(ex => ex.id !== exerciseRowId) }
          : d),
      } : t);
    });
  };

  const setExerciseField = (
    dayId: string,
    exerciseRowId: string,
    patch: Partial<Pick<ProgramTemplateExerciseWithExercise, 'prescription_raw' | 'notes' | 'variation_note'>>,
  ) => {
    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => d.id === dayId
        ? {
            ...d,
            exercises: d.exercises.map(ex => ex.id === exerciseRowId ? { ...ex, ...patch } : ex),
          }
        : d),
    } : t);
    const existing = exDebounceRef.current[exerciseRowId];
    if (existing) clearTimeout(existing);
    exDebounceRef.current[exerciseRowId] = setTimeout(() => {
      void wrapSave(() => updateTemplateExercise(exerciseRowId, patch));
    }, DEBOUNCE_MS);
  };

  // PrescriptionGrid manages its own debouncing internally and calls
  // onSave with the formatted raw string — save it without our debounce.
  const saveExercisePrescription = (
    dayId: string,
    exerciseRowId: string,
    raw: string,
  ) => {
    const normalised = raw.trim() === '' ? null : raw;
    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => d.id === dayId
        ? {
            ...d,
            exercises: d.exercises.map(ex => ex.id === exerciseRowId ? { ...ex, prescription_raw: normalised } : ex),
          }
        : d),
    } : t);
    void wrapSave(() => updateTemplateExercise(exerciseRowId, { prescription_raw: normalised }));
  };

  if (loading) {
    return <PageShell><Centered>Loading template…</Centered></PageShell>;
  }
  if (error || !template) {
    return (
      <PageShell>
        <Centered>
          {error ?? 'Template not available'}
          <div style={{ marginTop: 12 }}>
            <button onClick={() => navigate('/templates')} style={linkStyle}>← Back to templates</button>
          </div>
        </Centered>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => navigate('/templates')} style={linkStyle}>
          <ArrowLeft size={12} style={{ marginRight: 4 }} />
          All templates
        </button>
        <SaveIndicator status={status} />
      </div>

      <div style={{
        background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)', padding: 16, marginBottom: 12,
      }}>
        <input
          type="text"
          value={template.name}
          onChange={e => setHeaderField('name', e.target.value)}
          placeholder="Template name"
          autoFocus={template.name === 'Untitled template'}
          style={{
            width: '100%', fontSize: 16, fontWeight: 500,
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--color-text-primary)', padding: '4px 0',
            borderBottom: '0.5px solid transparent',
          }}
          onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderBottomColor = 'var(--color-border-tertiary)'; }}
          onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderBottomColor = 'transparent'; }}
        />
        <textarea
          value={template.description ?? ''}
          onChange={e => setHeaderField('description', e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          style={{
            width: '100%', fontSize: 12, marginTop: 8,
            background: 'transparent', border: '0.5px solid var(--color-border-tertiary)',
            outline: 'none', borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-secondary)', padding: '6px 8px',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {template.days.map(day => (
          <DayBlock
            key={day.id}
            day={day}
            allExercises={allExercises}
            loadIncrement={loadIncrement}
            defaultLoad={defaultPrescriptionLoad}
            onLabelChange={label => setDayLabel(day.id, label)}
            onDelete={() => void handleDeleteDay(day.id)}
            onAddExercise={ex => void handleAddExercise(day.id, ex)}
            onDeleteExercise={exId => void handleDeleteExercise(day.id, exId)}
            onExerciseField={(exId, patch) => setExerciseField(day.id, exId, patch)}
            onExercisePrescription={(exId, raw) => saveExercisePrescription(day.id, exId, raw)}
          />
        ))}
      </div>

      <button
        onClick={() => void handleAddDay()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginTop: 12, fontSize: 12, padding: '8px 12px',
          background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)',
          border: '0.5px dashed var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', width: '100%', justifyContent: 'center',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-primary)'; }}
      >
        <Plus size={12} /> Add day
      </button>
    </PageShell>
  );
}

interface DayBlockProps {
  day: ProgramTemplateDayWithExercises;
  allExercises: Exercise[];
  loadIncrement: number;
  defaultLoad: number;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
  onAddExercise: (ex: Exercise) => void;
  onDeleteExercise: (exId: string) => void;
  onExerciseField: (exId: string, patch: Partial<Pick<ProgramTemplateExerciseWithExercise, 'prescription_raw' | 'notes' | 'variation_note'>>) => void;
  onExercisePrescription: (exId: string, raw: string) => void;
}

function DayBlock({
  day, allExercises, loadIncrement, defaultLoad,
  onLabelChange, onDelete, onAddExercise, onDeleteExercise,
  onExerciseField, onExercisePrescription,
}: DayBlockProps) {
  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      border: '0.5px solid var(--color-border-secondary)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'var(--color-bg-secondary)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-tertiary)', minWidth: 16,
        }}>
          {day.day_index}
        </span>
        <input
          type="text"
          value={day.label}
          onChange={e => onLabelChange(e.target.value)}
          placeholder={`Day ${day.day_index}`}
          style={{
            flex: 1, fontSize: 13, fontWeight: 500,
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--color-text-primary)',
          }}
        />
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}
        </span>
        <button
          onClick={onDelete}
          title="Delete day"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)', borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-danger-bg)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {day.exercises.length === 0 ? (
          <div style={{ padding: '12px 12px 0', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No exercises yet — add one below.
          </div>
        ) : (
          day.exercises.map(ex => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              loadIncrement={loadIncrement}
              defaultLoad={defaultLoad}
              onDelete={() => onDeleteExercise(ex.id)}
              onFieldChange={patch => onExerciseField(ex.id, patch)}
              onPrescriptionSave={raw => onExercisePrescription(ex.id, raw)}
            />
          ))
        )}
        <div style={{ padding: 4 }}>
          <ExerciseSearch
            exercises={allExercises}
            onAdd={onAddExercise}
            placeholder="+ Add exercise…"
            disableSlashCommands
            dropUp={false}
          />
        </div>
      </div>
    </div>
  );
}

interface ExerciseRowProps {
  exercise: ProgramTemplateExerciseWithExercise;
  loadIncrement: number;
  defaultLoad: number;
  onDelete: () => void;
  onFieldChange: (patch: Partial<Pick<ProgramTemplateExerciseWithExercise, 'prescription_raw' | 'notes' | 'variation_note'>>) => void;
  onPrescriptionSave: (raw: string) => void;
}

function ExerciseRow({
  exercise, loadIncrement, defaultLoad, onDelete, onFieldChange, onPrescriptionSave,
}: ExerciseRowProps) {
  const comboPartCount = exercise.is_combo ? (exercise.combo_members?.length ?? 2) : undefined;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '8px 12px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        borderLeft: `3px solid ${exercise.combo_color || exercise.exercise.color || '#94a3b8'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {exercise.exercise.name}
        </span>
        {exercise.is_combo && (
          <span style={{ fontSize: 'var(--text-caption)', padding: '1px 6px', background: 'var(--color-accent-muted)', color: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', fontWeight: 500 }}>
            Combo
          </span>
        )}
        {exercise.exercise.exercise_code && (
          <span style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
            {exercise.exercise.exercise_code}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={onDelete}
          title="Remove exercise"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-tertiary)', borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-danger-bg)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>

      <PrescriptionGrid
        prescriptionRaw={exercise.prescription_raw}
        unit={exercise.unit}
        loadIncrement={loadIncrement}
        defaultLoad={defaultLoad}
        isCombo={exercise.is_combo}
        comboPartCount={comboPartCount}
        onSave={onPrescriptionSave}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={exercise.variation_note ?? ''}
          onChange={e => onFieldChange({ variation_note: e.target.value || null })}
          placeholder="Variation note"
          style={{ ...inputStyle, maxWidth: 220 }}
        />
        <input
          type="text"
          value={exercise.notes ?? ''}
          onChange={e => onFieldChange({ notes: e.target.value || null })}
          placeholder="Notes"
          style={inputStyle}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return <span />;
  const palette = status === 'error'
    ? { fg: 'var(--color-danger-text)', label: 'Error saving' }
    : status === 'saving'
    ? { fg: 'var(--color-text-tertiary)', label: 'Saving…' }
    : { fg: 'var(--color-text-secondary)', label: 'Saved' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: palette.fg }}>
      <Save size={10} />
      {palette.label}
    </span>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-secondary)', padding: 16 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
      {children}
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  fontSize: 11, padding: '4px 8px',
  background: 'transparent', border: 'none',
  color: 'var(--color-text-secondary)', cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
};

const inputStyle: React.CSSProperties = {
  flex: 1, fontSize: 11,
  padding: '4px 6px', background: 'var(--color-bg-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 'var(--radius-sm)', outline: 'none',
  color: 'var(--color-text-primary)',
};
