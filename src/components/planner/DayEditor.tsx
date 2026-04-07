import { useState, useEffect, useRef } from 'react';
import { X, Settings as GearIcon, GripVertical, Trash2, Video, Image as ImageIcon, AlignLeft } from 'lucide-react';
import { useShiftHeld } from '../../hooks/useShiftHeld';
import { supabase } from '../../lib/supabase';
import { getOwnerId } from '../../lib/ownerContext';
import type {
  WeekPlan, PlannedExercise, Exercise,
  AthletePR, GeneralSettings, DefaultUnit, ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
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

type SentinelType = 'text' | 'video' | 'image' | null;
function getSentinelType(code: string | null): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}

function getYouTubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

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
        .from('macro_weeks')
        .select('id')
        .eq('macrocycle_id', macroContext.macroId)
        .eq('week_number', macroContext.weekNumber)
        .maybeSingle();
      if (!mw) return;

      const { data: trackedExs } = await supabase
        .from('macro_tracked_exercises')
        .select('id, exercise_id')
        .eq('macrocycle_id', macroContext.macroId);
      if (!trackedExs?.length) return;

      const { data: targets } = await supabase
        .from('macro_targets')
        .select('tracked_exercise_id, target_reps, target_max, target_reps_at_max, target_sets_at_max, target_avg')
        .eq('macro_week_id', mw.id)
        .in('tracked_exercise_id', trackedExs.map(te => te.id));

      const map = new Map<string, MacroTargetData>();
      for (const tgt of targets || []) {
        const te = trackedExs.find(t => t.id === tgt.tracked_exercise_id);
        if (te) {
          map.set(te.exercise_id, {
            reps: tgt.target_reps,
            max: tgt.target_max,
            maxReps: tgt.target_reps_at_max,
            maxSets: tgt.target_sets_at_max,
            avg: tgt.target_avg,
          });
        }
      }
      setMacroTargets(map);
    } catch { /* ignore */ }
  }

  const sortedExercises = exercises.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Day totals — all exercises including combos (summary fields already computed)
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
    if (key === '/newexercise') { setShowNewExerciseModal(true); return; }
    const codeMap: Record<string, string> = { '/text': 'TEXT', '/video': 'VIDEO', '/image': 'IMAGE' };
    const code = codeMap[key];
    if (!code) return;
    setAdding(true);
    try {
      const sentinel = await getOrCreateSentinel(code);
      if (!sentinel) return;
      // Always use free_text so PrescriptionGrid renders a textarea, not a numeric grid
      await addExerciseToDay(weekPlan.id, dayIndex, sentinel.id, exercises.length + 1, 'free_text');
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleNewExerciseSave(exerciseData: Partial<Exercise>) {
    const { data, error } = await supabase.from('exercises').insert([exerciseData]).select().single();
    if (error) throw new Error(error.message);
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

  function handleExerciseDragStart(id: string) {
    setDraggedId(id);
  }

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

  return (
    <>
      <div className="flex flex-col h-full bg-gray-50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-medium text-gray-900">{dayName}</h2>
            {(totalSets > 0 || totalReps > 0) && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-500">S <strong className="text-gray-900 font-medium">{totalSets}</strong></span>
                <span className="text-gray-500">R <strong className="text-gray-900 font-medium">{totalReps}</strong></span>
                {totalTonnage > 0 && (
                  <span className="text-gray-500">T <strong className="text-gray-900 font-medium">{Math.round(totalTonnage).toLocaleString()}</strong></span>
                )}
              </div>
            )}
          </div>
          <button onClick={() => void flushAndClose()} className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Exercise list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {sortedExercises.length === 0 && (
            <p className="text-sm text-gray-400 italic text-center py-8">No exercises yet — search below to add</p>
          )}

          {sortedExercises.map(ex => {
            const sentinel = getSentinelType(ex.exercise.exercise_code);
            const macroTgt = !ex.is_combo && !sentinel ? macroTargets.get(ex.exercise_id) : undefined;
            const isDraggingOver = dragOverId === ex.id;
            const members = ex.is_combo ? (comboMembers[ex.id] ?? []).sort((a, b) => a.position - b.position) : null;
            const borderColor = sentinel === 'text'
              ? 'transparent'
              : sentinel
              ? '#d1d5db'
              : ex.is_combo
              ? (ex.combo_color || members?.[0]?.exercise.color || '#94a3b8')
              : (ex.exercise.color || '#94a3b8');

            return (
              <div
                key={ex.id}
                className={[
                  'rounded-md border transition-all',
                  isDraggingOver ? 'border-blue-400 shadow-sm' : 'border-gray-200',
                  draggedId === ex.id ? 'opacity-50' : '',
                  shiftHeld ? 'bg-red-50' : 'bg-white',
                ].join(' ')}
                style={{ borderLeft: `3px solid ${borderColor}` }}
                onDragOver={e => handleExerciseDragOver(e, ex.id)}
                onDrop={() => void handleExerciseDrop(ex.id)}
              >
                {/* Item header */}
                <div
                  draggable
                  onDragStart={() => handleExerciseDragStart(ex.id)}
                  onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                  onClick={() => { if (shiftHeld) void handleDeleteExercise(ex.id); }}
                  className={[
                    'flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-100 rounded-t-sm',
                    shiftHeld ? 'cursor-pointer bg-red-50 hover:bg-red-100' : 'cursor-grab active:cursor-grabbing bg-gray-50/70',
                  ].join(' ')}
                >
                  <GripVertical size={12} className="text-gray-400 flex-shrink-0" />
                  {sentinel === 'text' ? (
                    <>
                      <AlignLeft size={12} className="text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-400 italic flex-1">Free text</span>
                    </>
                  ) : sentinel === 'video' ? (
                    <>
                      <Video size={12} className="text-indigo-400 flex-shrink-0" />
                      <span className="text-xs text-gray-500 flex-1">Video</span>
                    </>
                  ) : sentinel === 'image' ? (
                    <>
                      <ImageIcon size={12} className="text-pink-400 flex-shrink-0" />
                      <span className="text-xs text-gray-500 flex-1">Image</span>
                    </>
                  ) : ex.is_combo && members ? (
                    <>
                      <div className="flex gap-0.5 items-center flex-shrink-0">
                        {members.map(m => (
                          <div key={m.position} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.exercise.color || '#94a3b8' }} />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-gray-900 truncate flex-1">
                        {ex.combo_notation || members.map(m => m.exercise.name).join(' + ')}
                      </span>
                      <span className="text-[9px] bg-blue-50 text-blue-600 font-medium px-1.5 py-0.5 rounded flex-shrink-0">Combo</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-gray-900 truncate flex-1">{ex.exercise.name}</span>
                      {ex.variation_note && (
                        <span className="text-[10px] text-gray-400 italic truncate">{ex.variation_note}</span>
                      )}
                      {ex.unit && ex.unit !== 'absolute_kg' && (
                        <span className="text-[9px] bg-gray-100 text-gray-600 font-medium px-1.5 py-0.5 rounded flex-shrink-0">
                          {UNIT_BADGE[ex.unit] ?? ex.unit}
                        </span>
                      )}
                    </>
                  )}
                  <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                    {!sentinel && (ex.summary_total_sets != null && ex.summary_total_sets > 0) && (
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                        <span>S <strong className="text-gray-900 font-medium">{ex.summary_total_sets}</strong></span>
                        <span>R <strong className="text-gray-900 font-medium">{ex.summary_total_reps}</strong></span>
                        {ex.summary_highest_load && <span>Hi <strong className="text-gray-900 font-medium">{ex.summary_highest_load}</strong></span>}
                        {ex.summary_avg_load && <span>Avg <strong className="text-gray-900 font-medium">{Math.round(ex.summary_avg_load)}</strong></span>}
                        {macroTgt && (
                          <span className="text-gray-400 border-l border-gray-200 pl-1.5 ml-0.5">
                            Macro: R <span className="text-gray-600">{macroTgt.reps ?? '—'}</span>
                            {macroTgt.max && (
                              <> Max <span className="text-red-700 font-medium">{maxLabel(macroTgt.max, macroTgt.maxReps, macroTgt.maxSets)}</span></>
                            )}
                            {macroTgt.avg && (
                              <> Avg <span className="text-gray-600">{macroTgt.avg}</span></>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => onNavigateToExercise(ex.id)}
                      className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0"
                      title="Detail"
                    >
                      <GearIcon size={12} />
                    </button>
                    <button
                      onClick={() => void handleDeleteExercise(ex.id)}
                      className="p-0.5 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Body — sentinels get custom rendering; exercises + combos get grid + notes */}
                {sentinel === 'text' ? (
                  <div className="px-3 py-2">
                    <textarea
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => handleNotesBlur(ex, e.target.value)}
                      placeholder="Type your notes…"
                      rows={2}
                      className="w-full text-sm text-gray-600 italic placeholder-gray-300 border-0 bg-transparent resize-none focus:outline-none focus:ring-0 leading-snug"
                      style={{ minHeight: '2.5rem' }}
                    />
                  </div>
                ) : sentinel === 'video' ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <input
                      type="url"
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => void saveNotes(ex.id, e.target.value)}
                      placeholder="Paste YouTube or video URL…"
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                    {ex.notes && (() => {
                      const thumb = getYouTubeThumbnail(ex.notes);
                      return thumb
                        ? <img src={thumb} alt="Video thumbnail" className="rounded w-full max-w-[200px] object-cover" />
                        : <p className="text-[10px] text-gray-400 truncate">{ex.notes}</p>;
                    })()}
                  </div>
                ) : sentinel === 'image' ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <input
                      type="url"
                      defaultValue={ex.notes ?? ''}
                      onBlur={e => void saveNotes(ex.id, e.target.value)}
                      placeholder="Paste image URL…"
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                    {ex.notes && (
                      <img src={ex.notes} alt="" className="rounded w-full max-w-[200px] object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
                    )}
                  </div>
                ) : (
                  <>
                    {/* Grid */}
                    <div className="px-3 py-2">
                      <PrescriptionGrid
                        prescriptionRaw={ex.prescription_raw}
                        unit={ex.unit}
                        loadIncrement={loadIncrement}
                        isCombo={ex.is_combo}
                        comboPartCount={ex.is_combo ? ((comboMembers[ex.id] ?? []).length || 2) : undefined}
                        onSave={raw => handleGridSave(ex, raw)}
                      />
                    </div>
                    {/* Notes — shown for both regular exercises and combos */}
                    <div className="px-3 pb-2">
                      <textarea
                        defaultValue={ex.notes ?? ''}
                        onBlur={e => handleNotesBlur(ex, e.target.value)}
                        placeholder="Notes…"
                        rows={1}
                        className="w-full text-[10px] text-gray-500 placeholder-gray-300 italic border-0 bg-transparent resize-none focus:outline-none focus:ring-0 leading-tight"
                        style={{ minHeight: '1rem' }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Search input */}
        <div className="border-t border-gray-200 bg-white flex-shrink-0">
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
