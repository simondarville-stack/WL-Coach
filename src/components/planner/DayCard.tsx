import { useState } from 'react';
import { GripVertical, Video, Image as ImageIcon, AlignLeft } from 'lucide-react';
import { useShiftHeld } from '../../hooks/useShiftHeld';
import { supabase } from '../../lib/supabase';
import type { PlannedExercise, Exercise, DefaultUnit, ComboMemberEntry } from '../../lib/database.types';
import { parsePrescription, parseFreeTextPrescription, parseComboPrescription } from '../../lib/prescriptionParser';
import { ExerciseSearch } from './ExerciseSearch';
import { ComboCreatorModal } from './ComboCreatorModal';

interface DayCardProps {
  dayIndex: number;
  dayName: string;
  weekPlanId: string;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  comboMembers: Record<string, ComboMemberEntry[]>;
  allExercises: Exercise[];
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
    if (lines.length === 0) return <span className="text-[10px] text-gray-400 italic">{raw}</span>;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="flex flex-col items-center leading-none" style={{ minWidth: '1.5rem' }}>
              <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">{line.loadText}</span>
              <div className="w-full border-t border-gray-400 my-px" />
              <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">{line.reps}</span>
            </div>
            {line.sets > 1 && (
              <span className="text-[9px] text-gray-700 font-medium self-center leading-none">{line.sets}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isCombo) {
    const lines = parseComboPrescription(raw);
    if (lines.length === 0) return <span className="text-[10px] text-gray-400 italic">{raw}</span>;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-0.5">
            <div className="flex flex-col items-center leading-none" style={{ minWidth: '1.5rem' }}>
              <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">
                {line.load}{unit === 'percentage' ? '%' : ''}
              </span>
              <div className="w-full border-t border-gray-400 my-px" />
              <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">{line.repsText}</span>
            </div>
            {line.sets > 1 && (
              <span className="text-[9px] text-gray-700 font-medium self-center leading-none">{line.sets}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  const lines = parsePrescription(raw);
  if (lines.length === 0) {
    return <span className="text-[10px] text-gray-400 italic">{raw}</span>;
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-0.5">
          <div className="flex flex-col items-center leading-none" style={{ minWidth: '1.5rem' }}>
            <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">
              {line.load}{unit === 'percentage' ? '%' : ''}
            </span>
            <div className="w-full border-t border-gray-400 my-px" />
            <span className="font-mono text-[10px] text-gray-900 font-medium leading-tight">{line.reps}</span>
          </div>
          {line.sets > 1 && (
            <span className="text-[9px] text-gray-700 font-medium self-center leading-none">{line.sets}</span>
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
  const shiftHeld = useShiftHeld();

  const daySets = exercises.reduce((s, ex) => s + (ex.summary_total_sets ?? 0), 0);
  const dayReps = exercises.reduce((s, ex) => s + (ex.summary_total_reps ?? 0), 0);
  const isEmpty = exercises.length === 0;

  async function handleAddExercise(exercise: Exercise) {
    setAdding(true);
    try {
      await addExerciseToDay(weekPlanId, dayIndex, exercise.id, exercises.length + 1, exercise.default_unit);
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function getOrCreateSentinel(code: string): Promise<{ id: string; default_unit: string } | null> {
    const { data: existing } = await supabase
      .from('exercises').select('id, default_unit').eq('exercise_code', code).maybeSingle();
    if (existing) return existing;
    const sentinelDefs: Record<string, { name: string; color: string }> = {
      TEXT:  { name: 'Free Text / Notes', color: '#9CA3AF' },
      VIDEO: { name: 'Video',             color: '#6366F1' },
      IMAGE: { name: 'Image',             color: '#EC4899' },
    };
    const def = sentinelDefs[code];
    if (!def) return null;
    const { data: created } = await supabase.from('exercises').insert({
      name: def.name,
      category: '— System',
      default_unit: 'other',
      color: def.color,
      exercise_code: code,
      use_stacked_notation: false,
      counts_towards_totals: false,
      is_competition_lift: false,
    }).select('id, default_unit').single();
    return created ?? null;
  }

  async function handleSlashCommand(key: string) {
    if (key === '/combo') { setShowComboModal(true); return; }
    const codeMap: Record<string, string> = { '/text': 'TEXT', '/video': 'VIDEO', '/image': 'IMAGE' };
    const code = codeMap[key];
    if (!code) return;
    setAdding(true);
    try {
      const sentinel = await getOrCreateSentinel(code);
      if (!sentinel) return;
      // Always use free_text so PrescriptionGrid renders a textarea, not a numeric grid
      await addExerciseToDay(weekPlanId, dayIndex, sentinel.id, exercises.length + 1, 'free_text');
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
    await createComboExercise(weekPlanId, dayIndex, exercises.length + 1, data);
    await onRefresh();
    setShowComboModal(false);
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
        className={[
          'bg-white rounded-lg border shadow-sm flex flex-col transition-all min-h-[200px]',
          isDragOver ? 'border-blue-400 shadow-md bg-blue-50/30' : 'border-gray-200',
        ].join(' ')}
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
          className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 cursor-grab active:cursor-grabbing hover:bg-gray-50 transition-colors rounded-t-lg"
          onClick={onNavigateToDay}
        >
          <span className="text-sm font-medium text-gray-900">{dayName}</span>
          {!isEmpty && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">S <strong className="text-gray-900 font-semibold">{daySets}</strong></span>
              <span className="text-gray-500">R <strong className="text-gray-900 font-semibold">{dayReps}</strong></span>
            </div>
          )}
        </div>

        {/* Exercise list */}
        <div className="flex flex-col flex-1">
          {isEmpty ? (
            <div className="flex-1 flex items-center justify-center py-4 text-xs text-gray-400 italic">
              {isDragOver ? 'Drop here' : 'Rest day'}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-gray-50">
              {exercises.map(ex => {
                const sentinel = getSentinelType(ex.exercise.exercise_code);
                const members = ex.is_combo ? (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position) : null;
                const borderColor = sentinel === 'text'
                  ? 'transparent'
                  : sentinel
                  ? '#d1d5db'
                  : ex.is_combo
                  ? (ex.combo_color || (members?.[0]?.exercise.color) || '#94a3b8')
                  : (ex.exercise.color || '#94a3b8');

                return (
                  <div
                    key={ex.id}
                    draggable
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', `${dayIndex}:exercise:${ex.id}`);
                      e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
                    }}
                    className={[
                      'flex items-start gap-1.5 px-2 py-1.5 group transition-colors cursor-pointer',
                      shiftHeld ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-blue-50/60',
                    ].join(' ')}
                    style={{ borderLeft: `3px solid ${borderColor}` }}
                    onClick={e => {
                      e.stopPropagation();
                      if (e.shiftKey || shiftHeld) { void onDeleteExercise(ex.id).then(() => onRefresh()); return; }
                      onNavigateToExercise(ex.id);
                    }}
                  >
                    <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 group-hover:text-gray-400 mt-0.5 touch-none">
                      <GripVertical size={11} />
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      {sentinel === 'text' ? (
                        <p className="text-xs text-gray-500 italic leading-snug line-clamp-3">
                          {ex.notes || 'Free text…'}
                        </p>
                      ) : sentinel === 'video' ? (
                        <div className="flex items-center gap-1.5">
                          <Video size={11} className="text-indigo-400 flex-shrink-0" />
                          <span className="text-xs text-gray-500">Video</span>
                          {ex.notes && (() => {
                            const thumb = getYouTubeThumbnail(ex.notes);
                            return thumb
                              ? <img src={thumb} alt="" className="w-14 h-9 object-cover rounded flex-shrink-0" />
                              : null;
                          })()}
                        </div>
                      ) : sentinel === 'image' ? (
                        <div className="flex items-center gap-1.5">
                          <ImageIcon size={11} className="text-pink-400 flex-shrink-0" />
                          <span className="text-xs text-gray-500">Image</span>
                          {ex.notes && (
                            <img src={ex.notes} alt="" className="w-14 h-9 object-cover rounded flex-shrink-0" onError={e => { e.currentTarget.style.display = 'none'; }} />
                          )}
                        </div>
                      ) : ex.is_combo && members ? (
                        <>
                          <div className="flex items-baseline gap-1 min-w-0">
                            <div className="flex gap-0.5 items-center flex-shrink-0">
                              {members.map(m => (
                                <div
                                  key={m.exerciseId}
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: m.exercise.color || '#94a3b8' }}
                                />
                              ))}
                            </div>
                            <span className="text-xs font-medium text-gray-900 truncate leading-tight">
                              {ex.combo_notation || members.map(m => m.exercise.name).join(' + ')}
                            </span>
                            <span className="text-[9px] px-1 py-px bg-blue-50 text-blue-600 rounded font-medium flex-shrink-0">
                              Combo
                            </span>
                          </div>
                          <StackedNotation raw={ex.prescription_raw} unit={ex.unit} isCombo={true} />
                          {ex.notes && (
                            <p className="text-[10px] text-gray-400 italic leading-tight">{ex.notes}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-baseline gap-1 min-w-0">
                            <span className="text-xs font-medium text-gray-900 truncate leading-tight">
                              {ex.exercise.name}
                            </span>
                            {ex.variation_note && (
                              <span className="text-[10px] text-gray-400 italic truncate flex-shrink-0">{ex.variation_note}</span>
                            )}
                          </div>
                          <StackedNotation raw={ex.prescription_raw} unit={ex.unit} isCombo={false} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {isDragOver && (
                <div className="px-3 py-2 text-xs text-blue-500 text-center bg-blue-50/50">
                  Drop to move here
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="border-t border-gray-100 mt-auto">
          <ExerciseSearch
            exercises={allExercises}
            onAdd={handleAddExercise}
            onSlashCommand={key => void handleSlashCommand(key)}
            placeholder={adding ? '…' : undefined}
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
    </>
  );
}
