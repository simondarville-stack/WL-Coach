import { useState } from 'react';
import { GripVertical, Video, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { useShiftHeld } from '../../hooks/useShiftHeld';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import type { PlannedExercise, Exercise, DefaultUnit, ComboMemberEntry } from '../../lib/database.types';
import { parsePrescription, parseFreeTextPrescription, parseComboPrescription } from '../../lib/prescriptionParser';
import { ExerciseSearch } from './ExerciseSearch';
import { ComboCreatorModal } from './ComboCreatorModal';
import { ExerciseFormModal } from '../ExerciseFormModal';
import { RestBadge } from './RestBadge';
import type { RestInfo } from '../../lib/restCalculation';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { MetricStrip } from '../ui/MetricStrip';

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
  onExerciseDrop: (fromDay: number, plannedExId: string, toDay: number, isCopy: boolean) => Promise<void>;
  onDayDrop: (sourceDay: number, destDay: number, isCopy: boolean) => Promise<void>;
}

function getYouTubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

type SentinelType = 'text' | 'video' | 'image' | null;
function getSentinelType(exerciseCode: string | null): SentinelType {
  if (exerciseCode === 'TEXT') return 'text';
  if (exerciseCode === 'VIDEO') return 'video';
  if (exerciseCode === 'IMAGE') return 'image';
  return null;
}

function StackedNotation({ raw, unit, isCombo }: { raw: string | null; unit: string | null; isCombo?: boolean }) {
  if (!raw) return null;

  if (unit === 'free_text_reps') {
    const lines = parseFreeTextPrescription(raw);
    if (lines.length === 0) return <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{raw}</span>;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, minWidth: '1.5rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>{line.loadText}</span>
              <div style={{ width: '100%', borderTop: '0.5px solid var(--color-border-primary)', margin: '1px 0' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>{line.reps}</span>
            </div>
            {line.sets > 1 && (
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontWeight: 500, alignSelf: 'center', lineHeight: 1 }}>{line.sets}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isCombo) {
    const lines = parseComboPrescription(raw);
    if (lines.length === 0) return <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{raw}</span>;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, minWidth: '1.5rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>
                {line.loadMax != null
                  ? `${line.load}-${line.loadMax}${unit === 'percentage' ? '%' : ''}`
                  : `${line.load}${unit === 'percentage' ? '%' : ''}`}
              </span>
              <div style={{ width: '100%', borderTop: '0.5px solid var(--color-border-primary)', margin: '1px 0' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>{line.repsText}</span>
            </div>
            {line.sets > 1 && (
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontWeight: 500, alignSelf: 'center', lineHeight: 1 }}>{line.sets}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  const lines = parsePrescription(raw);
  if (lines.length === 0) {
    return <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{raw}</span>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, minWidth: '1.5rem' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>
              {line.loadMax != null
                ? `${line.load}-${line.loadMax}${unit === 'percentage' ? '%' : ''}`
                : `${line.load}${unit === 'percentage' ? '%' : ''}`}
            </span>
            <div style={{ width: '100%', borderTop: '1px solid var(--color-border-primary)', margin: '1px 0' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.25 }}>{line.reps}</span>
          </div>
          {line.sets > 1 && (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-secondary)', fontWeight: 500, alignSelf: 'center', lineHeight: 1 }}>{line.sets}</span>
          )}
        </div>
      ))}
    </div>
  );
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
}: DayCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [showNewExerciseModal, setShowNewExerciseModal] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [hoveredExId, setHoveredExId] = useState<string | null>(null);
  const [draggingExId, setDraggingExId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: 'before' | 'after' } | null>(null);
  const shiftHeld = useShiftHeld();

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

  async function getOrCreateSentinel(code: string): Promise<{ id: string; default_unit: string } | null> {
    const { data: existing } = await supabase
      .from('exercises').select('id, default_unit').eq('exercise_code', code).eq('owner_id', getOwnerId()).maybeSingle();
    if (existing) return existing;
    const sentinelDefs: Record<string, { name: string; color: string }> = {
      TEXT:  { name: 'Free Text / Notes', color: '#9CA3AF' },
      VIDEO: { name: 'Video',             color: '#6366F1' },
      IMAGE: { name: 'Image',             color: '#EC4899' },
    };
    const def = sentinelDefs[code];
    if (!def) return null;
    const { data: created } = await supabase.from('exercises').insert({
      name: def.name, category: '— System', default_unit: 'other', color: def.color,
      exercise_code: code, use_stacked_notation: false, counts_towards_totals: false, is_competition_lift: false,
      owner_id: getOwnerId(),
    }).select('id, default_unit').single();
    return created ?? null;
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
      await addExerciseToDay(weekPlanId, dayIndex, sentinel.id, exercises.length + 1, 'free_text');
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleNewExerciseSave(exerciseData: Partial<Exercise>) {
    const { data, error } = await supabase.from('exercises').insert([{ ...exerciseData, owner_id: getOwnerId() }]).select().single();
    if (error) throw new Error(error.message);
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
    if (data.startsWith('DAY:')) {
      const sourceDay = parseInt(data.slice(4), 10);
      if (isNaN(sourceDay) || sourceDay === dayIndex) return;
      await onDayDrop(sourceDay, dayIndex, e.ctrlKey || e.metaKey);
    } else {
      const parts = data.split(':');
      if (parts.length < 3) return;
      const fromDay = parseInt(parts[0], 10);
      const dragType = parts[1];
      const itemId = parts[2];
      if (isNaN(fromDay) || fromDay === dayIndex || !itemId) return;
      if (dragType === 'exercise') {
        await onExerciseDrop(fromDay, itemId, dayIndex, e.ctrlKey || e.metaKey);
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
                      background: shiftHeld
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
                      if (shiftHeld) { void onDeleteExercise(ex.id).then(() => onRefresh()); return; }
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
                          <StackedNotation raw={ex.prescription_raw} unit={ex.unit} isCombo={true} />
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
                            {ex.source === 'group' && (
                              <span style={{ fontSize: 'var(--text-caption)', padding: '1px 4px', background: 'rgba(99,102,241,0.08)', color: '#6366F1', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>G</span>
                            )}
                            {ex.source === 'individual' && (
                              <span style={{ fontSize: 'var(--text-caption)', padding: '1px 4px', background: 'rgba(245,158,11,0.08)', color: '#D97706', borderRadius: 'var(--radius-sm)', fontWeight: 500, flexShrink: 0 }}>I</span>
                            )}
                          </div>
                          <StackedNotation raw={ex.prescription_raw} unit={ex.unit} isCombo={false} />
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
    </>
  );
}
