import { useState, useEffect, useRef } from 'react';
import { X, Settings as GearIcon, GripVertical, Trash2, Video, Image as ImageIcon, AlignLeft } from 'lucide-react';
import { useShiftHeld } from '../../hooks/useShiftHeld';
import { supabase } from '../../lib/supabase';
import type {
  WeekPlan, PlannedExercise, Exercise,
  AthletePR, GeneralSettings, DefaultUnit, ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { getSentinelType, getYouTubeThumbnail, getOrCreateSentinel, type SentinelType } from './plannerUtils';
import { PrescriptionGrid } from './PrescriptionGrid';
import { ExerciseSearch } from './ExerciseSearch';
import { ComboCreatorModal } from './ComboCreatorModal';
import { ExerciseFormModal } from '../ExerciseFormModal';

interface MacroTargetData {
  reps: number | null;
  max: number | null;
  maxReps: number | null;
  maxSets: number | null;
  avg: number | null;
}

interface DayEditorProps {
  weekPlan: WeekPlan;
  dayIndex: number;
  dayName: string;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  comboMembers: Record<string, ComboMemberEntry[]>;
  athletePRs: AthletePR[];
  settings: GeneralSettings | null;
  macroContext: MacroContext | null;
  allExercises: Exercise[];
  onClose: () => void;
  onNavigateToExercise: (exerciseId: string) => void;
  onRefresh: () => Promise<void>;
  addExerciseToDay: (weekPlanId: string, dayIndex: number, exerciseId: string, position: number, unit: DefaultUnit) => Promise<unknown>;
  createExercise: (exerciseData: Partial<Exercise>) => Promise<Exercise | null>;
  createComboExercise: (weekPlanId: string, dayIndex: number, position: number, data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string }) => Promise<void>;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<unknown>;
  saveNotes: (id: string, notes: string) => Promise<unknown>;
  deletePlannedExercise: (id: string) => Promise<unknown>;
  reorderExercises: (weekPlanId: string, orderedIds: string[]) => Promise<unknown>;
  moveExercise: (...args: unknown[]) => Promise<unknown>;
  normalizePositions: (...args: unknown[]) => Promise<unknown>;
}

const UNIT_BADGE: Record<string, string> = {
  absolute_kg: 'kg',
  percentage: '%',
  free_text_reps: 'text+reps',
  free_text: 'text',
};


function maxLabel(maxVal: number | null, rhi: number | null, shi: number | null): string {
  if (maxVal == null) return '';
  if (rhi != null && shi != null) return `${maxVal}/${rhi}/${shi}`;
  return `${maxVal}`;
}

export function DayEditor({
  weekPlan,
  dayIndex,
  dayName,
  exercises,
  comboMembers,
  settings,
  macroContext,
  allExercises,
  onClose,
  onNavigateToExercise,
  onRefresh,
  addExerciseToDay,
  createExercise,
  createComboExercise,
  savePrescription,
  saveNotes,
  deletePlannedExercise,
}: DayEditorProps) {
  const [macroTargets, setMacroTargets] = useState<Map<string, MacroTargetData>>(new Map());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const shiftHeld = useShiftHeld();
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [showNewExerciseModal, setShowNewExerciseModal] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!macroContext) return;
    void loadMacroTargets();
  }, [macroContext?.macroId]);

  async function loadMacroTargets() {
    if (!macroContext) return;
    try {
      const { data: mw } = await supabase
        .from('macro_weeks').select('id')
        .eq('macrocycle_id', macroContext.macroId).eq('week_number', macroContext.weekNumber).maybeSingle();
      if (!mw) return;
      const { data: trackedExs } = await supabase
        .from('macro_tracked_exercises').select('id, exercise_id').eq('macrocycle_id', macroContext.macroId);
      if (!trackedExs?.length) return;
      const { data: targets } = await supabase
        .from('macro_targets')
        .select('tracked_exercise_id, target_reps, target_max, target_reps_at_max, target_sets_at_max, target_avg')
        .eq('macro_week_id', mw.id).in('tracked_exercise_id', trackedExs.map(te => te.id));
      const map = new Map<string, MacroTargetData>();
      for (const tgt of targets || []) {
        const te = trackedExs.find(t => t.id === tgt.tracked_exercise_id);
        if (te) {
          map.set(te.exercise_id, {
            reps: tgt.target_reps, max: tgt.target_max,
            maxReps: tgt.target_reps_at_max, maxSets: tgt.target_sets_at_max, avg: tgt.target_avg,
          });
        }
      }
      setMacroTargets(map);
    } catch { /* ignore */ }
  }

  const sortedExercises = exercises.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const totalSets = exercises.reduce((s, ex) => s + (ex.summary_total_sets ?? 0), 0);
  const totalReps = exercises.reduce((s, ex) => s + (ex.summary_total_reps ?? 0), 0);
  const totalTonnage = exercises.reduce((s, ex) =>
    ex.unit === 'absolute_kg' ? s + (ex.summary_avg_load ?? 0) * (ex.summary_total_reps ?? 0) : s, 0
  );

  const loadIncrement = settings?.grid_load_increment ?? 5;

  async function handleAddExercise(exercise: Exercise) {
    setAdding(true);
    try {
      await addExerciseToDay(weekPlan.id, dayIndex, exercise.id, exercises.length + 1, exercise.default_unit);
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleComboCreate(data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) {
    await createComboExercise(weekPlan.id, dayIndex, exercises.length + 1, data);
    await onRefresh();
    setShowComboModal(false);
  }

  function handleGridSave(ex: PlannedExercise, raw: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingSaveRef.current = savePrescription(ex.id, {
      prescription: raw,
      unit: (ex.unit as DefaultUnit) || 'absolute_kg',
      isCombo: ex.is_combo,
    });
    saveTimerRef.current = setTimeout(() => { void onRefresh(); }, 800);
  }

  async function flushAndClose() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (pendingSaveRef.current) {
      try { await pendingSaveRef.current; } catch {}
      pendingSaveRef.current = null;
    }
    onClose();
  }

  async function handleDeleteExercise(id: string) {
    await deletePlannedExercise(id);
    await onRefresh();
  }

  async function handleSlashCommand(key: string) {
    if (key === '/combo') { setShowComboModal(true); return; }
    if (key === '/newexercise') { setShowNewExerciseModal(true); return; }
    const codeMap: Record<string, string> = { '/text': 'TEXT', '/video': 'VIDEO', '/image': 'IMAGE' };
    const code = codeMap[key];
    if (!code) return;
    setAdding(true);
    try {
      const sentinel = await getOrCreateSentinel(code);
      if (!sentinel) return;
      await addExerciseToDay(weekPlan.id, dayIndex, sentinel.id, exercises.length + 1, 'free_text');
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleNewExerciseSave(exerciseData: Partial<Exercise>) {
    const data = await createExercise(exerciseData);
    setShowNewExerciseModal(false);
    if (data) {
      await addExerciseToDay(weekPlan.id, dayIndex, data.id, exercises.length + 1, data.default_unit as DefaultUnit);
      await onRefresh();
    }
  }

  function handleNotesBlur(ex: PlannedExercise, value: string) {
    if (value !== (ex.notes ?? '')) {
      void saveNotes(ex.id, value);
    }
  }

  async function handleDragEnd(orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', orderedIds[i]);
    }
    await onRefresh();
  }

  function handleExerciseDragStart(id: string) { setDraggedId(id); }

  function handleExerciseDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  }

  async function handleExerciseDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    const ids = sortedExercises.map(e => e.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDraggedId(null); setDragOverId(null); return; }
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggedId);
    setDraggedId(null);
    setDragOverId(null);
    await handleDragEnd(reordered);
  }

  const itemHeaderStyle = (isDragging: boolean, isDragTarget: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    borderBottom: '1px solid var(--color-border-tertiary)',
    borderRadius: '4px 4px 0 0',
    background: shiftHeld
      ? 'rgba(240,149,149,0.06)'
      : isDragging ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
    cursor: shiftHeld ? 'pointer' : 'grab',
    opacity: isDragging ? 0.5 : 1,
  });

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg-secondary)' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--color-border-secondary)',
          background: 'var(--color-bg-primary)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>{dayName}</h2>
            {(totalSets > 0 || totalReps > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>S <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{totalSets}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{totalReps}</strong></span>
                {totalTonnage > 0 && (
                  <span style={{ color: 'var(--color-text-secondary)' }}>T <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{Math.round(totalTonnage).toLocaleString()}</strong></span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => void flushAndClose()}
            style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Exercise list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sortedExercises.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', fontStyle: 'italic', textAlign: 'center', padding: '32px 0', margin: 0 }}>No exercises yet — search below to add</p>
          )}

          {sortedExercises.map(ex => {
            const sentinel = getSentinelType(ex.exercise.exercise_code);
            const macroTgt = !ex.is_combo && !sentinel ? macroTargets.get(ex.exercise_id) : undefined;
            const isDraggingOver = dragOverId === ex.id;
            const isDragging = draggedId === ex.id;
            const members = ex.is_combo ? (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position) : null;
            const borderColor = sentinel === 'text'
              ? 'transparent'
              : sentinel ? 'var(--color-border-primary)'
              : ex.is_combo ? (ex.combo_color || members?.[0]?.exercise.color || '#94a3b8')
              : (ex.exercise.color || '#94a3b8');

            return (
              <div
                key={ex.id}
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: isDraggingOver ? '1px solid var(--color-accent-border)' : '1px solid var(--color-border-secondary)',
                  borderLeft: `3px solid ${borderColor}`,
                  boxShadow: isDraggingOver ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                  background: shiftHeld ? 'rgba(240,149,149,0.04)' : 'var(--color-bg-primary)',
                  opacity: isDragging ? 0.5 : 1,
                  transition: 'border-color 0.1s, opacity 0.1s',
                }}
                onDragOver={e => handleExerciseDragOver(e, ex.id)}
                onDrop={() => void handleExerciseDrop(ex.id)}
              >
                {/* Item header */}
                <div
                  draggable
                  onDragStart={() => handleExerciseDragStart(ex.id)}
                  onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                  onClick={() => { if (shiftHeld) void handleDeleteExercise(ex.id); }}
                  style={itemHeaderStyle(isDragging, isDraggingOver)}
                >
                  <GripVertical size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                  {sentinel === 'text' ? (
                    <>
                      <AlignLeft size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', flex: 1 }}>Free text</span>
                    </>
                  ) : sentinel === 'video' ? (
                    <>
                      <Video size={12} style={{ color: '#6366F1', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flex: 1 }}>Video</span>
                    </>
                  ) : sentinel === 'image' ? (
                    <>
                      <ImageIcon size={12} style={{ color: '#EC4899', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flex: 1 }}>Image</span>
                    </>
                  ) : ex.is_combo && members ? (
                    <>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                        {members.map(m => (
                          <div key={m.position} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: m.exercise.color || '#94a3b8' }} />
                        ))}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {ex.combo_notation || members.map(m => m.exercise.name).join(' + ')}
                      </span>
                      <span style={{ fontSize: 9, background: 'var(--color-accent-muted)', color: 'var(--color-accent)', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}>Combo</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ex.exercise.name}</span>
                      {ex.variation_note && (
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ex.variation_note}</span>
                      )}
                      {ex.unit && ex.unit !== 'absolute_kg' && (
                        <span style={{ fontSize: 9, background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}>
                          {UNIT_BADGE[ex.unit] ?? ex.unit}
                        </span>
                      )}
                    </>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                    {!sentinel && (ex.summary_total_sets != null && ex.summary_total_sets > 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--color-text-secondary)' }}>
                        <span>S <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{ex.summary_total_sets}</strong></span>
                        <span>R <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{ex.summary_total_reps}</strong></span>
                        {ex.summary_highest_load && <span>Hi <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{ex.summary_highest_load}</strong></span>}
                        {ex.summary_avg_load && <span>Avg <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{Math.round(ex.summary_avg_load)}</strong></span>}
                        {macroTgt && (
                          <span style={{ color: 'var(--color-text-tertiary)', borderLeft: '1px solid var(--color-border-secondary)', paddingLeft: 6, marginLeft: 2 }}>
                            Macro: R <span style={{ color: 'var(--color-text-secondary)' }}>{macroTgt.reps ?? '—'}</span>
                            {macroTgt.max && (
                              <> Max <span style={{ color: 'var(--color-danger-text)', fontWeight: 500 }}>{maxLabel(macroTgt.max, macroTgt.maxReps, macroTgt.maxSets)}</span></>
                            )}
                            {macroTgt.avg && (
                              <> Avg <span style={{ color: 'var(--color-text-secondary)' }}>{macroTgt.avg}</span></>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => onNavigateToExercise(ex.id)}
                      style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', display: 'flex', flexShrink: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
                      title="Detail"
                    >
                      <GearIcon size={12} />
                    </button>
                    <button
                      onClick={() => void handleDeleteExercise(ex.id)}
                      style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-border-primary)', display: 'flex', flexShrink: 0 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-danger-text)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-border-primary)'; }}
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Body */}
                {sentinel === 'text' ? (
                  <div style={{ padding: '8px 12px' }}>
                    <textarea
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => handleNotesBlur(ex, e.target.value)}
                      placeholder="Type your notes…"
                      rows={2}
                      className="planner-week-notes"
                      style={{
                        width: '100%', fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic',
                        border: 'none', background: 'transparent', resize: 'none', outline: 'none',
                        lineHeight: 1.375, minHeight: '2.5rem', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ) : sentinel === 'video' ? (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      type="url"
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => void saveNotes(ex.id, e.target.value)}
                      placeholder="Paste YouTube or video URL…"
                      style={{
                        width: '100%', fontSize: 11,
                        border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px', outline: 'none', background: 'var(--color-bg-primary)',
                        color: 'var(--color-text-primary)', boxSizing: 'border-box',
                      }}
                    />
                    {ex.notes && (() => {
                      const thumb = getYouTubeThumbnail(ex.notes);
                      return thumb
                        ? <img src={thumb} alt="Video thumbnail" style={{ borderRadius: 4, width: '100%', maxWidth: 200, objectFit: 'cover' }} />
                        : <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{ex.notes}</p>;
                    })()}
                  </div>
                ) : sentinel === 'image' ? (
                  <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      type="url"
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => void saveNotes(ex.id, e.target.value)}
                      placeholder="Paste image URL…"
                      style={{
                        width: '100%', fontSize: 11,
                        border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px', outline: 'none', background: 'var(--color-bg-primary)',
                        color: 'var(--color-text-primary)', boxSizing: 'border-box',
                      }}
                    />
                    {ex.notes && (
                      <img src={ex.notes} alt="" style={{ borderRadius: 4, width: '100%', maxWidth: 200, objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '8px 12px' }}>
                      <PrescriptionGrid
                        prescriptionRaw={ex.prescription_raw}
                        unit={ex.unit}
                        loadIncrement={loadIncrement}
                        isCombo={ex.is_combo}
                        comboPartCount={ex.is_combo ? ((comboMembers[ex.id] ?? []).length || 2) : undefined}
                        onSave={raw => handleGridSave(ex, raw)}
                      />
                    </div>
                    <div style={{ padding: '0 12px 8px' }}>
                      <textarea
                        defaultValue={ex.notes ?? ''}
                        onBlur={e => handleNotesBlur(ex, e.target.value)}
                        placeholder="Notes…"
                        rows={1}
                        className="planner-week-notes"
                        style={{
                          width: '100%', fontSize: 10, color: 'var(--color-text-secondary)', fontStyle: 'italic',
                          border: 'none', background: 'transparent', resize: 'none', outline: 'none',
                          lineHeight: 1.25, minHeight: '1rem', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Search input */}
        <div style={{ borderTop: '1px solid var(--color-border-secondary)', background: 'var(--color-bg-primary)', flexShrink: 0 }}>
          <ExerciseSearch
            exercises={allExercises}
            onAdd={handleAddExercise}
            onSlashCommand={key => void handleSlashCommand(key)}
            placeholder={adding ? '…' : 'Search or / for commands'}
          />
        </div>
      </div>

      {showComboModal && (
        <ComboCreatorModal
          allExercises={allExercises.filter(e => e.category !== '— System')}
          onClose={() => setShowComboModal(false)}
          onSave={handleComboCreate}
        />
      )}

      <ExerciseFormModal
        isOpen={showNewExerciseModal}
        onClose={() => setShowNewExerciseModal(false)}
        editingExercise={null}
        onSave={handleNewExerciseSave}
      />
    </>
  );
}
