// Template editor. Edits the program template in place — every change
// is auto-saved (debounced for text fields, immediate for structural
// changes). Prescriptions use the same PrescriptionGrid + stacked
// notation as the planner so templates stay visually consistent with
// the rest of EMOS. Combo composition (which exercises are in the
// combo) stays read-only in v1, but combo prescriptions are editable.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GripVertical, Plus, Trash2, Save } from 'lucide-react';
import {
  fetchTemplateFull,
  updateTemplate,
  insertTemplateDay,
  updateTemplateDay,
  deleteTemplateDay,
  insertTemplateExercise,
  updateTemplateExercise,
  deleteTemplateExercise,
  reorderTemplateDays,
  reorderTemplateExercises,
  moveTemplateExercise,
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

// Drag payload prefixes used by the editor's drag/drop. Distinct from
// the planner's DOCK:/DAY: prefixes so neither surface accidentally
// reacts to the other's drag events.
const DRAG_TDAY = 'TDAY:';
const DRAG_TEX = 'TEX:';

type DropIndicator =
  | { kind: 'day'; targetId: string; position: 'before' | 'after' }
  | { kind: 'exercise'; targetId: string; position: 'before' | 'after' }
  | { kind: 'day-body'; targetId: string }
  | null;

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

  const [draggingDayId, setDraggingDayId] = useState<string | null>(null);
  const [draggingExId, setDraggingExId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);

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
      const day = await insertTemplateDay(template.id, nextIndex, `Training unit ${nextIndex}`);
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
  // unitOverride is set when the grid auto-detects a unit switch ("80%"
  // or letters in a load cell); persist it alongside the prescription.
  const saveExercisePrescription = (
    dayId: string,
    exerciseRowId: string,
    raw: string,
    unitOverride?: string,
  ) => {
    const normalised = raw.trim() === '' ? null : raw;
    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => d.id === dayId
        ? {
            ...d,
            exercises: d.exercises.map(ex => ex.id === exerciseRowId
              ? { ...ex, prescription_raw: normalised, ...(unitOverride ? { unit: unitOverride } : {}) }
              : ex),
          }
        : d),
    } : t);
    const patch = unitOverride
      ? { prescription_raw: normalised, unit: unitOverride }
      : { prescription_raw: normalised };
    void wrapSave(() => updateTemplateExercise(exerciseRowId, patch));
  };

  // ── Drag/drop ─────────────────────────────────────────────────────
  // Mirror the planner's behaviour: dragging reorders things in place.
  // Days reorder via the day header; exercises reorder within a day by
  // dropping on another exercise row; exercises move across days by
  // dropping on another day's header or body.

  const clearDragState = () => {
    setDraggingDayId(null);
    setDraggingExId(null);
    setDropIndicator(null);
  };

  const reorderDays = async (draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (!template || draggedId === targetId) return;
    const ids = template.days.map(d => d.id);
    const fromIdx = ids.indexOf(draggedId);
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (position === 'after') toIdx += 1;
    ids.splice(toIdx, 0, draggedId);
    const newDays = ids.map((id, i) => {
      const d = template.days.find(day => day.id === id)!;
      return { ...d, day_index: i + 1 };
    });
    setTemplate(t => t ? { ...t, days: newDays } : t);
    await wrapSave(() => reorderTemplateDays(ids));
  };

  const reorderExercisesInDay = async (dayId: string, draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (!template || draggedId === targetId) return;
    const day = template.days.find(d => d.id === dayId);
    if (!day) return;
    const ids = day.exercises.map(ex => ex.id);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx < 0) return;
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (position === 'after') toIdx += 1;
    ids.splice(toIdx, 0, draggedId);
    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => d.id === dayId ? {
        ...d,
        exercises: ids.map((id, i) => {
          const ex = d.exercises.find(e => e.id === id)!;
          return { ...ex, position: i };
        }),
      } : d),
    } : t);
    await wrapSave(() => reorderTemplateExercises(ids));
  };

  const moveExerciseToDay = async (
    exerciseId: string,
    fromDayId: string,
    toDayId: string,
    position: number,
  ) => {
    if (!template || fromDayId === toDayId) return;
    const sourceDay = template.days.find(d => d.id === fromDayId);
    const targetDay = template.days.find(d => d.id === toDayId);
    const exercise = sourceDay?.exercises.find(ex => ex.id === exerciseId);
    if (!exercise || !targetDay) return;

    const destIds = targetDay.exercises.map(ex => ex.id);
    const clampedPos = Math.max(0, Math.min(position, destIds.length));
    destIds.splice(clampedPos, 0, exerciseId);

    setTemplate(t => t ? {
      ...t,
      days: t.days.map(d => {
        if (d.id === fromDayId) {
          return { ...d, exercises: d.exercises.filter(ex => ex.id !== exerciseId) };
        }
        if (d.id === toDayId) {
          const movedEx = { ...exercise, template_day_id: toDayId };
          const exMap = new Map<string, ProgramTemplateExerciseWithExercise>();
          d.exercises.forEach(ex => exMap.set(ex.id, ex));
          exMap.set(exerciseId, movedEx);
          return {
            ...d,
            exercises: destIds.map((id, i) => ({ ...(exMap.get(id) as ProgramTemplateExerciseWithExercise), position: i })),
          };
        }
        return d;
      }),
    } : t);

    await wrapSave(async () => {
      await moveTemplateExercise(exerciseId, toDayId, clampedPos);
      await reorderTemplateExercises(destIds);
    });
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
            draggingDayId={draggingDayId}
            draggingExId={draggingExId}
            dropIndicator={dropIndicator}
            onLabelChange={label => setDayLabel(day.id, label)}
            onDelete={() => void handleDeleteDay(day.id)}
            onAddExercise={ex => void handleAddExercise(day.id, ex)}
            onDeleteExercise={exId => void handleDeleteExercise(day.id, exId)}
            onExerciseField={(exId, patch) => setExerciseField(day.id, exId, patch)}
            onExercisePrescription={(exId, raw, unitOverride) => saveExercisePrescription(day.id, exId, raw, unitOverride)}
            onDayDragStart={setDraggingDayId}
            onExerciseDragStart={setDraggingExId}
            onDragEnd={clearDragState}
            onSetDropIndicator={setDropIndicator}
            onCommitDayDrop={(draggedId, targetId, position) => {
              setDropIndicator(null);
              setDraggingDayId(null);
              void reorderDays(draggedId, targetId, position);
            }}
            onCommitExerciseDrop={(draggedId, fromDayId, targetExId, position) => {
              setDropIndicator(null);
              setDraggingExId(null);
              if (fromDayId === day.id) {
                void reorderExercisesInDay(day.id, draggedId, targetExId, position);
              } else {
                const targetDay = template.days.find(d => d.id === day.id);
                const idx = targetDay?.exercises.findIndex(ex => ex.id === targetExId) ?? 0;
                void moveExerciseToDay(draggedId, fromDayId, day.id, position === 'before' ? idx : idx + 1);
              }
            }}
            onCommitMoveToDay={(draggedId, fromDayId) => {
              setDropIndicator(null);
              setDraggingExId(null);
              if (fromDayId === day.id) return;
              void moveExerciseToDay(draggedId, fromDayId, day.id, day.exercises.length);
            }}
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
  draggingDayId: string | null;
  draggingExId: string | null;
  dropIndicator: DropIndicator;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
  onAddExercise: (ex: Exercise) => void;
  onDeleteExercise: (exId: string) => void;
  onExerciseField: (exId: string, patch: Partial<Pick<ProgramTemplateExerciseWithExercise, 'prescription_raw' | 'notes' | 'variation_note'>>) => void;
  onExercisePrescription: (exId: string, raw: string, unitOverride?: string) => void;
  onDayDragStart: (dayId: string) => void;
  onExerciseDragStart: (exId: string) => void;
  onDragEnd: () => void;
  onSetDropIndicator: (indicator: DropIndicator) => void;
  onCommitDayDrop: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onCommitExerciseDrop: (draggedId: string, fromDayId: string, targetExId: string, position: 'before' | 'after') => void;
  onCommitMoveToDay: (draggedId: string, fromDayId: string) => void;
}

function DayBlock({
  day, allExercises, loadIncrement, defaultLoad,
  draggingDayId, draggingExId, dropIndicator,
  onLabelChange, onDelete, onAddExercise, onDeleteExercise,
  onExerciseField, onExercisePrescription,
  onDayDragStart, onExerciseDragStart, onDragEnd, onSetDropIndicator,
  onCommitDayDrop, onCommitExerciseDrop, onCommitMoveToDay,
}: DayBlockProps) {
  const isDragSource = draggingDayId === day.id;
  const dayIndicatorBefore = dropIndicator?.kind === 'day' && dropIndicator.targetId === day.id && dropIndicator.position === 'before';
  const dayIndicatorAfter = dropIndicator?.kind === 'day' && dropIndicator.targetId === day.id && dropIndicator.position === 'after';
  const bodyHighlighted = dropIndicator?.kind === 'day-body' && dropIndicator.targetId === day.id;

  return (
    <div
      style={{
        position: 'relative',
        background: bodyHighlighted ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
        border: bodyHighlighted ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        opacity: isDragSource ? 0.5 : 1,
        boxShadow: dayIndicatorBefore
          ? 'inset 0 2px 0 0 var(--color-accent)'
          : dayIndicatorAfter
          ? 'inset 0 -2px 0 0 var(--color-accent)'
          : 'none',
        transition: 'background 0.1s, border-color 0.1s, opacity 0.1s',
      }}
      onDragOver={e => {
        const types = e.dataTransfer.types;
        // Only respond when we're carrying our own payloads.
        if (!types.includes('text/plain')) return;
        const payload = e.dataTransfer.getData('text/plain');
        if (!payload && draggingExId == null && draggingDayId == null) return;
        e.preventDefault();
      }}
    >
      <div
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', `${DRAG_TDAY}${day.id}`);
          e.dataTransfer.effectAllowed = 'move';
          onDayDragStart(day.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={e => {
          // Day header is the target for day reordering. If an exercise
          // is being dragged across days, also highlight to indicate the
          // exercise will be appended to this day.
          e.preventDefault();
          e.stopPropagation();
          if (draggingDayId) {
            if (draggingDayId === day.id) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            onSetDropIndicator({ kind: 'day', targetId: day.id, position: pos });
          } else if (draggingExId) {
            onSetDropIndicator({ kind: 'day-body', targetId: day.id });
          }
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            // Don't clear here — letting the next dragover refine the
            // indicator avoids flicker.
          }
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const data = e.dataTransfer.getData('text/plain');
          if (data.startsWith(DRAG_TDAY)) {
            const draggedDayId = data.slice(DRAG_TDAY.length);
            if (draggedDayId === day.id) {
              onSetDropIndicator(null);
              onDragEnd();
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            onCommitDayDrop(draggedDayId, day.id, pos);
          } else if (data.startsWith(DRAG_TEX)) {
            const rest = data.slice(DRAG_TEX.length);
            const [fromDayId, exId] = rest.split(':');
            if (fromDayId && exId) onCommitMoveToDay(exId, fromDayId);
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: 'var(--color-bg-secondary)',
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          cursor: 'grab',
        }}
      >
        <GripVertical size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
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
          onMouseDown={e => e.stopPropagation()}
          placeholder={`Training unit ${day.day_index}`}
          draggable={false}
          style={{
            flex: 1, fontSize: 13, fontWeight: 500,
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--color-text-primary)', cursor: 'text',
          }}
        />
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
          {day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}
        </span>
        <button
          onClick={onDelete}
          onMouseDown={e => e.stopPropagation()}
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

      <div
        style={{ display: 'flex', flexDirection: 'column' }}
        onDragOver={e => {
          // Body-level drag-over fallback: when an exercise from another
          // day is dragged onto the body (not a specific row), highlight
          // the whole day as the drop target.
          if (draggingExId) {
            e.preventDefault();
            onSetDropIndicator({ kind: 'day-body', targetId: day.id });
          }
        }}
        onDrop={e => {
          const data = e.dataTransfer.getData('text/plain');
          if (data.startsWith(DRAG_TEX)) {
            e.preventDefault();
            e.stopPropagation();
            const [fromDayId, exId] = data.slice(DRAG_TEX.length).split(':');
            if (fromDayId && exId) onCommitMoveToDay(exId, fromDayId);
          }
        }}
      >
        {day.exercises.length === 0 ? (
          <div style={{ padding: '12px 12px 0', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No exercises yet — add one below.
          </div>
        ) : (
          day.exercises.map(ex => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              dayId={day.id}
              loadIncrement={loadIncrement}
              defaultLoad={defaultLoad}
              isDragSource={draggingExId === ex.id}
              dropIndicator={dropIndicator}
              onDelete={() => onDeleteExercise(ex.id)}
              onFieldChange={patch => onExerciseField(ex.id, patch)}
              onPrescriptionSave={(raw, unitOverride) => onExercisePrescription(ex.id, raw, unitOverride)}
              onDragStart={() => onExerciseDragStart(ex.id)}
              onDragEnd={onDragEnd}
              onSetDropIndicator={onSetDropIndicator}
              onCommitDrop={onCommitExerciseDrop}
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
  dayId: string;
  loadIncrement: number;
  defaultLoad: number;
  isDragSource: boolean;
  dropIndicator: DropIndicator;
  onDelete: () => void;
  onFieldChange: (patch: Partial<Pick<ProgramTemplateExerciseWithExercise, 'prescription_raw' | 'notes' | 'variation_note'>>) => void;
  onPrescriptionSave: (raw: string, unitOverride?: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSetDropIndicator: (indicator: DropIndicator) => void;
  onCommitDrop: (draggedId: string, fromDayId: string, targetExId: string, position: 'before' | 'after') => void;
}

function ExerciseRow({
  exercise, dayId, loadIncrement, defaultLoad,
  isDragSource, dropIndicator,
  onDelete, onFieldChange, onPrescriptionSave,
  onDragStart, onDragEnd, onSetDropIndicator, onCommitDrop,
}: ExerciseRowProps) {
  const comboPartCount = exercise.is_combo ? (exercise.combo_members?.length ?? 2) : undefined;
  const indicatorBefore = dropIndicator?.kind === 'exercise' && dropIndicator.targetId === exercise.id && dropIndicator.position === 'before';
  const indicatorAfter = dropIndicator?.kind === 'exercise' && dropIndicator.targetId === exercise.id && dropIndicator.position === 'after';

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', `${DRAG_TEX}${dayId}:${exercise.id}`);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        // Browsers restrict dataTransfer.getData() during dragover, so
        // we accept any drag and let the drop handler filter by prefix.
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        onSetDropIndicator({ kind: 'exercise', targetId: exercise.id, position: pos });
      }}
      onDrop={e => {
        e.preventDefault();
        e.stopPropagation();
        const data = e.dataTransfer.getData('text/plain');
        if (!data.startsWith(DRAG_TEX)) {
          onSetDropIndicator(null);
          onDragEnd();
          return;
        }
        const [fromDayId, exId] = data.slice(DRAG_TEX.length).split(':');
        if (!fromDayId || !exId || exId === exercise.id) {
          onSetDropIndicator(null);
          onDragEnd();
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        onCommitDrop(exId, fromDayId, exercise.id, pos);
      }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '8px 12px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        borderLeft: `3px solid ${exercise.combo_color || exercise.exercise.color || '#94a3b8'}`,
        opacity: isDragSource ? 0.5 : 1,
        boxShadow: indicatorBefore
          ? 'inset 0 2px 0 0 var(--color-accent)'
          : indicatorAfter
          ? 'inset 0 -2px 0 0 var(--color-accent)'
          : 'none',
        transition: 'opacity 0.1s, box-shadow 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <GripVertical size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, cursor: 'grab' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', flexShrink: 0 }}>
          {exercise.exercise.name}
        </span>
        {exercise.is_combo && (
          <span style={{ fontSize: 'var(--text-caption)', padding: '1px 6px', background: 'var(--color-accent-muted)', color: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>
            Combo
          </span>
        )}
        {exercise.exercise.exercise_code && (
          <span style={{ fontSize: 'var(--text-caption)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
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
            color: 'var(--color-text-tertiary)', borderRadius: 'var(--radius-sm)', flexShrink: 0,
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

      {/* Folded note: notes is the single field; legacy variation_note
          pre-fills until the note is edited (then it is cleared). */}
      <input
        type="text"
        value={exercise.notes ?? exercise.variation_note ?? ''}
        onChange={e => onFieldChange({ notes: e.target.value || null, variation_note: null })}
        placeholder="Note"
        style={inputStyle}
      />
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
