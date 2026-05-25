import { useRef, useState } from 'react';
import { GripVertical, Video, Image as ImageIcon, ChevronRight, BookmarkPlus, Dumbbell } from 'lucide-react';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { useExercises } from '../../hooks/useExercises';
import { supabase } from '../../lib/supabase';
import type { PlannedExercise, Exercise, DefaultUnit, ComboMemberEntry, GppSection } from '../../lib/database.types';
import { getSentinelType, getYouTubeThumbnail } from './sentinelUtils';
import { getOrCreateSentinel } from './sentinelService';
import { ExerciseSearch } from './ExerciseSearch';
import { ComboCreatorModal } from './ComboCreatorModal';
import { ExerciseFormModal } from '../ExerciseFormModal';
import { RestBadge } from './RestBadge';
import { PrescriptionGrid } from './PrescriptionGrid';
import { GppBlockEditor } from './GppBlockEditor';
import type { RestInfo } from '../../lib/restCalculation';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { MetricStrip } from '../ui/MetricStrip';
import { StackedNotation } from './StackedNotation';

interface DayCardProps {
  dayIndex: number;
  dayName: string;
  weekPlanId: string;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  comboMembers: Record<string, ComboMemberEntry[]>;
  allExercises: Exercise[];
  restInfo?: RestInfo | null;
  visibleMetrics?: MetricKey[];
  competitionTotal?: number | null;
  onNavigateToDay: () => void;
  onNavigateToExercise: (exerciseId: string) => void;
  addExerciseToDay: (
    weekPlanId: string,
    dayIndex: number,
    exerciseId: string,
    position: number,
    unit: DefaultUnit,
  ) => Promise<unknown>;
  createComboExercise: (
    weekPlanId: string,
    dayIndex: number,
    position: number,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  onDeleteExercise: (plannedExId: string) => Promise<void>;
  onExerciseDrop: (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  onDayDrop: (sourceDay: number, destDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  onDockExerciseDrop?: (exerciseId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDrop?: (templateId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDayDrop?: (templateDayId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onSaveAsTemplate?: (dayIndex: number) => void;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<unknown>;
  /** Persist a GPP block payload on a planned_exercise row. */
  saveGppSection?: (plannedExId: string, section: GppSection) => Promise<void>;
  loadIncrement: number;
  defaultPrescriptionLoad: number;
  /** True when the current view is an individual plan linked to a group plan.
   *  G/I source badges are only meaningful in that case. */
  isLinkedToGroupPlan?: boolean;
}

export function DayCard({
  dayIndex,
  dayName,
  weekPlanId,
  exercises,
  comboMembers,
  allExercises,
  restInfo,
  visibleMetrics = DEFAULT_VISIBLE_METRICS,
  competitionTotal = null,
  onNavigateToDay,
  onNavigateToExercise,
  addExerciseToDay,
  createComboExercise,
  onRefresh,
  onDeleteExercise,
  onExerciseDrop,
  onDayDrop,
  onDockExerciseDrop,
  onDockTemplateDrop,
  onDockTemplateDayDrop,
  onSaveAsTemplate,
  savePrescription,
  saveGppSection,
  loadIncrement,
  defaultPrescriptionLoad,
  isLinkedToGroupPlan = false,
}: DayCardProps) {
  const { createExercise } = useExercises();
  const [isDragOver, setIsDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [showNewExerciseModal, setShowNewExerciseModal] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [hoveredExId, setHoveredExId] = useState<string | null>(null);
  const [draggingExId, setDraggingExId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: 'before' | 'after' } | null>(null);
  /** When non-null, opens the GPP editor for that planned_exercise. */
  const [editingGpp, setEditingGpp] = useState<PlannedExercise | null>(null);
  const deleteHeld = useDeleteHeld();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleGridSave(ex: PlannedExercise, raw: string, unitOverride?: string) {
    void savePrescription(ex.id, {
      prescription: raw,
      unit: ((unitOverride ?? ex.unit) as DefaultUnit) || 'absolute_kg',
      isCombo: ex.is_combo,
    });
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { void onRefresh(); }, 800);
  }

  const dayMetrics = computeMetrics(exercises.map(ex => ({ ...ex, counts_towards_totals: ex.exercise.counts_towards_totals })), competitionTotal);
  const isEmpty = exercises.length === 0;

  async function handleAddExercise(exercise: Exercise) {
    setAdding(true);
    try {
      await addExerciseToDay(weekPlanId, dayIndex, exercise.id, exercises.length + 1, exercise.default_unit);
    } finally {
      setAdding(false);
    }
    onRefresh();
  }

  async function handleSlashCommand(key: string) {
    if (key === '/combo') { setShowComboModal(true); return; }
    if (key === '/newexercise') { setShowNewExerciseModal(true); return; }
    const codeMap: Record<string, string> = {
      '/text': 'TEXT',
      '/video': 'VIDEO',
      '/image': 'IMAGE',
      '/gpp': 'GPP',
    };
    const code = codeMap[key];
    if (!code) return;
    setAdding(true);
    try {
      const sentinel = await getOrCreateSentinel(code);
      if (!sentinel) return;
      await addExerciseToDay(weekPlanId, dayIndex, sentinel.id, exercises.length + 1, 'free_text');
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleNewExerciseSave(exerciseData: Partial<Exercise>) {
    const data = await createExercise(exerciseData);
    setShowNewExerciseModal(false);
    if (data) {
      await addExerciseToDay(weekPlanId, dayIndex, data.id, exercises.length + 1, data.default_unit as DefaultUnit);
      await onRefresh();
    }
  }

  async function handleComboCreate(data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) {
    await createComboExercise(weekPlanId, dayIndex, exercises.length + 1, data);
    await onRefresh();
    setShowComboModal(false);
  }

  async function handleReorder(draggedId: string, targetId: string, pos: 'before' | 'after') {
    const ids = exercises.map(e => e.id);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx < 0) return;
    ids.splice(fromIdx, 1);
    const toIdx = pos === 'before' ? ids.indexOf(targetId) : ids.indexOf(targetId) + 1;
    ids.splice(toIdx, 0, draggedId);
    await Promise.all(ids.map((id, i) =>
      supabase.from('planned_exercises').update({ position: i + 1 }).eq('id', id)
    ));
    await onRefresh();
  }

  function handleCardDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleCardDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }

  async function handleCardDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    const isCopy = e.ctrlKey || e.metaKey;
    const isReplace = e.shiftKey;
    if (data.startsWith('DOCK:exercise:')) {
      const exerciseId = data.slice('DOCK:exercise:'.length);
      if (!exerciseId || !onDockExerciseDrop) return;
      await onDockExerciseDrop(exerciseId, dayIndex, isReplace);
    } else if (data.startsWith('DOCK:template-day:')) {
      const templateDayId = data.slice('DOCK:template-day:'.length);
      if (!templateDayId || !onDockTemplateDayDrop) return;
      await onDockTemplateDayDrop(templateDayId, dayIndex, isReplace);
    } else if (data.startsWith('DOCK:template:')) {
      const templateId = data.slice('DOCK:template:'.length);
      if (!templateId || !onDockTemplateDrop) return;
      await onDockTemplateDrop(templateId, dayIndex, isReplace);
    } else if (data.startsWith('DAY:')) {
      const sourceDay = parseInt(data.slice(4), 10);
      if (isNaN(sourceDay) || sourceDay === dayIndex) return;
      await onDayDrop(sourceDay, dayIndex, isCopy, isReplace);
    } else {
      const parts = data.split(':');
      if (parts.length < 3) return;
      const fromDay = parseInt(parts[0], 10);
      const dragType = parts[1];
      const itemId = parts[2];
      if (isNaN(fromDay) || fromDay === dayIndex || !itemId) return;
      if (dragType === 'exercise') {
        await onExerciseDrop(fromDay, itemId, dayIndex, isCopy, isReplace);
      }
    }
  }

  return (
    <>
      <div
        style={{
          background: isDragOver ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: isDragOver ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border-secondary)',
          display: 'flex', flexDirection: 'column',
          minHeight: isEmpty ? 120 : 160,
          transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        }}
        onDragOver={handleCardDragOver}
        onDragLeave={handleCardDragLeave}
        onDrop={handleCardDrop}
      >
        {/* Header */}
        <div
          draggable
          onDragStart={e => {
            e.dataTransfer.setData('text/plain', `DAY:${dayIndex}`);
            e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            cursor: 'pointer',
            background: headerHovered ? 'var(--color-bg-secondary)' : 'transparent',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            transition: 'background 0.1s',
          }}
          onMouseEnter={() => setHeaderHovered(true)}
          onMouseLeave={() => setHeaderHovered(false)}
          onClick={onNavigateToDay}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', flex: 1 }}>{dayName}</span>
          {restInfo && restInfo.hoursFromPrevious !== null && (
            <RestBadge hours={restInfo.hoursFromPrevious} recoveryLevel={restInfo.recoveryLevel} />
          )}
          {!isEmpty && (
            <MetricStrip
              metrics={dayMetrics}
              visibleMetrics={visibleMetrics}
              size="sm"
              showLabels={true}
            />
          )}
          {!isEmpty && onSaveAsTemplate && (
            <button
              onClick={e => { e.stopPropagation(); onSaveAsTemplate(dayIndex); }}
              title="Save training unit as template"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, padding: 0,
                background: 'transparent',
                border: 'none', cursor: 'pointer',
                color: headerHovered ? 'var(--color-text-tertiary)' : 'transparent',
                borderRadius: 'var(--radius-sm)',
                transition: 'color 0.1s, background 0.1s',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = headerHovered ? 'var(--color-text-tertiary)' : 'transparent';
              }}
            >
              <BookmarkPlus size={11} />
            </button>
          )}
          <ChevronRight size={12} style={{ color: headerHovered ? 'var(--color-text-tertiary)' : 'var(--color-border-secondary)', flexShrink: 0, transition: 'color 0.1s' }} />
        </div>

        {/* Exercise list */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {isEmpty ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 0', fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              {isDragOver ? 'Drop here' : 'No exercises'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {exercises.map(ex => {
                const sentinel = getSentinelType(ex.exercise.exercise_code);
                const members = ex.is_combo ? (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position) : null;
                const borderColor = sentinel === 'text'
                  ? 'transparent'
                  : sentinel
                  ? 'var(--color-border-primary)'
                  : ex.is_combo
                  ? (ex.combo_color || (members?.[0]?.exercise.color) || '#94a3b8')
                  : (ex.exercise.color || '#94a3b8');
                const isHovered = hoveredExId === ex.id;

                return (
                  <div
                    key={ex.id}
                    draggable
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', `${dayIndex}:exercise:${ex.id}`);
                      e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
                      setDraggingExId(ex.id);
                    }}
                    onDragEnd={() => {
                      setDraggingExId(null);
                      setDropIndicator(null);
                      // Same-day reorder drops stopPropagation on the item
                      // handler, so the card's onDrop never clears its own
                      // drag-over visual. onDragEnd on the source always fires;
                      // use it as the catch-all reset.
                      setIsDragOver(false);
                    }}
                    onDragOver={e => {
                      if (!draggingExId || draggingExId === ex.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                      if (dropIndicator?.targetId !== ex.id || dropIndicator.position !== pos) {
                        setDropIndicator({ targetId: ex.id, position: pos });
                      }
                    }}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropIndicator(null);
                      }
                    }}
                    onDrop={e => {
                      const data = e.dataTransfer.getData('text/plain');
                      const parts = data.split(':');
                      if (parts.length >= 3) {
                        const fromDay = parseInt(parts[0], 10);
                        const dragType = parts[1];
                        const itemId = parts[2];
                        if (fromDay === dayIndex && dragType === 'exercise' && itemId !== ex.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          const pos = dropIndicator?.position ?? 'after';
                          setDropIndicator(null);
                          setDraggingExId(null);
                          void handleReorder(itemId, ex.id, pos);
                          return;
                        }
                      }
                      setDropIndicator(null);
                      setDraggingExId(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                      borderLeft: `3px solid ${borderColor}`,
                      background: deleteHeld
                        ? (isHovered ? 'var(--color-danger-bg)' : 'transparent')
                        : (isHovered ? 'var(--color-bg-secondary)' : 'transparent'),
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      boxShadow: dropIndicator?.targetId === ex.id
                        ? dropIndicator.position === 'before'
                          ? 'inset 0 2px 0 0 var(--color-accent)'
                          : 'inset 0 -2px 0 0 var(--color-accent)'
                        : 'none',
                    }}
                    onMouseEnter={() => setHoveredExId(ex.id)}
                    onMouseLeave={() => setHoveredExId(null)}
                    onClick={e => {
                      e.stopPropagation();
                      // Shift+click is a transitional alias for Delete-held+click.
                      // Plan to remove the Shift alias after coaches are used to Delete-held.
                      if (deleteHeld || e.shiftKey) { void onDeleteExercise(ex.id).then(() => onRefresh()); return; }
                      // GPP rows open the editor directly — there's no prescription
                      // to bring up in the day editor for them.
                      if (sentinel === 'gpp') { setEditingGpp(ex); return; }
                      onNavigateToExercise(ex.id);
                    }}
                  >
                    <div style={{ flexShrink: 0, cursor: 'grab', color: isHovered ? 'var(--color-text-tertiary)' : 'var(--color-border-secondary)', marginTop: 2 }}>
                      <GripVertical size={11} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      {sentinel === 'text' ? (
                        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontStyle: 'italic', lineHeight: 1.375, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', margin: 0 }}>
                          {ex.notes || 'Free text…'}
                        </p>
                      ) : sentinel === 'video' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Video size={11} style={{ color: '#6366F1', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Video</span>
                          {ex.notes && (() => {
                            const thumb = getYouTubeThumbnail(ex.notes);
                            return thumb ? <img src={thumb} alt="" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} /> : null;
                          })()}
                        </div>
                      ) : sentinel === 'image' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ImageIcon size={11} style={{ color: '#EC4899', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Image</span>
                          {ex.notes && (
                            <img src={ex.notes} alt="" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                          )}
                        </div>
                      ) : sentinel === 'gpp' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Dumbbell size={11} style={{ color: '#10B981', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                              {ex.metadata?.gpp?.title || 'GPP'}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                              {ex.metadata?.gpp?.rows?.length
                                ? `${ex.metadata.gpp.rows.length} row${ex.metadata.gpp.rows.length === 1 ? '' : 's'}`
                                : 'click to edit'}
                            </span>
                          </div>
                          {ex.metadata?.gpp?.rows?.length ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 17 }}>
                              {ex.metadata.gpp.rows.slice(0, 4).map((row, i) => {
                                const label = row.exercise || `Exercise ${i + 1}`;
                                // reps × sets order — matches how OWL
                                // coaches read prescriptions ("10×3" =
                                // 10 reps, 3 sets).
                                const repsSets = [
                                  row.reps || '',
                                  row.sets > 1 ? `×${row.sets}` : '',
                                ].filter(Boolean).join('');
                                const suffix = [repsSets, row.load].filter(Boolean).join(' · ');
                                return (
                                  <div key={i} style={{
                                    fontSize: 10,
                                    color: 'var(--color-text-secondary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    lineHeight: 1.3,
                                  }}>
                                    <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
                                    {suffix && (
                                      <span style={{ color: 'var(--color-text-tertiary)' }}> {suffix}</span>
                                    )}
                                  </div>
                                );
                              })}
                              {ex.metadata.gpp.rows.length > 4 && (
                                <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                  +{ex.metadata.gpp.rows.length - 4} more
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : ex.is_combo && members ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
                              {members.map(m => (
                                <div key={m.position} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: m.exercise.color || '#94a3b8' }} />
                              ))}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                              {ex.combo_notation || members.map(m => m.exercise.name).join(' + ')}
                            </span>
                            <span style={{ fontSize: 'var(--text-caption)', padding: '1px 6px', background: 'var(--color-accent-muted)', color: 'var(--color-accent)', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>
                              Combo
                            </span>
                          </div>
                          {ex.variation_note && (
                            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{ex.variation_note}</p>
                          )}
                          <div
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            onDragStart={e => e.preventDefault()}
                            draggable={false}
                            style={{ cursor: 'default' }}
                          >
                            <PrescriptionGrid
                              prescriptionRaw={ex.prescription_raw}
                              unit={ex.unit}
                              loadIncrement={loadIncrement}
                              defaultLoad={defaultPrescriptionLoad}
                              isCombo
                              comboPartCount={(members?.length) || 2}
                              compact
                              onSave={(raw, unitOverride) => handleGridSave(ex, raw, unitOverride)}
                            />
                          </div>
                          {ex.notes && (
                            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', margin: 0 }}>{ex.notes}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                              {ex.exercise.name}
                            </span>
                            {ex.variation_note && (
                              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{ex.variation_note}</span>
                            )}
                            {isLinkedToGroupPlan && ex.source === 'group' && (
                              <span style={{ fontSize: 'var(--text-caption)', padding: '1px 4px', background: 'rgba(99,102,241,0.08)', color: '#6366F1', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>G</span>
                            )}
                            {isLinkedToGroupPlan && ex.source === 'individual' && (
                              <span style={{ fontSize: 'var(--text-caption)', padding: '1px 4px', background: 'rgba(245,158,11,0.08)', color: '#D97706', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>I</span>
                            )}
                          </div>
                          <div
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                            onDragStart={e => e.preventDefault()}
                            draggable={false}
                            style={{ cursor: 'default' }}
                          >
                            <PrescriptionGrid
                              prescriptionRaw={ex.prescription_raw}
                              unit={ex.unit}
                              loadIncrement={loadIncrement}
                              defaultLoad={defaultPrescriptionLoad}
                              isCombo={false}
                              compact
                              onSave={(raw, unitOverride) => handleGridSave(ex, raw, unitOverride)}
                            />
                          </div>
                          {ex.notes && (
                            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', margin: 0 }}>{ex.notes}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {isDragOver && (
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-accent)', textAlign: 'center', background: 'var(--color-accent-muted)' }}>
                  Drop to move here
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ marginTop: 'auto', paddingTop: 2 }}>
          <ExerciseSearch
            exercises={allExercises}
            onAdd={handleAddExercise}
            onSlashCommand={key => void handleSlashCommand(key)}
            placeholder={adding ? '…' : '+ Add exercise...'}
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

      {editingGpp && (
        <GppBlockEditor
          open
          initial={editingGpp.metadata?.gpp ?? null}
          exerciseCatalogue={allExercises}
          onClose={() => setEditingGpp(null)}
          onSave={async section => {
            if (!saveGppSection) return;
            await saveGppSection(editingGpp.id, section);
            await onRefresh();
          }}
        />
      )}
    </>
  );
}
