import { useState, useRef, useEffect } from 'react';
import type { PlannedExercise, Exercise, PlannedComboWithDetails, DefaultUnit } from '../lib/database.types';
import { GripVertical, X, Layers, Video, Image as ImageIcon, Type, type LucideIcon } from 'lucide-react';
import { getUnitSymbol } from '../lib/constants';
import { parsePrescription } from '../lib/prescriptionParser';
import { PrescriptionModal } from './PrescriptionModal';
import { ComboCard } from './ComboCard';
import { ComboEditorModal } from './ComboEditorModal';
import { ComboCreatorModal } from './ComboCreatorModal';
import { MediaInputModal } from './MediaInputModal';
import { useCombos } from '../hooks/useCombos';
import { useWeekPlans } from '../hooks/useWeekPlans';

interface DayColumnProps {
  dayIndex: number;
  dayName: string;
  weekPlanId: string;
  exercises: (PlannedExercise & { exercise: Exercise })[];
  allExercises: Exercise[];
  onRefresh: () => Promise<void>;
  onDeleteExercise: (plannedExerciseId: string, dayIndex: number) => Promise<void>;
  onReorderItems: (dayIndex: number, orderedIds: string[]) => Promise<void>;
  onMoveExercise: (exerciseId: string, fromDayIndex: number, toDayIndex: number) => Promise<void>;
  comboRefreshKey?: number;
}

interface SlashCommand {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  bgColor: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/combo', label: 'Combo Exercise', description: 'Create a combo exercise', icon: Layers, iconColor: 'text-blue-700', bgColor: 'bg-blue-50' },
  { key: '/text', label: 'Free Text / Notes', description: 'Add a text note', icon: Type, iconColor: 'text-gray-700', bgColor: 'bg-gray-50' },
  { key: '/video', label: 'Video', description: 'Embed a video link', icon: Video, iconColor: 'text-indigo-700', bgColor: 'bg-indigo-50' },
  { key: '/image', label: 'Image', description: 'Add an image', icon: ImageIcon, iconColor: 'text-pink-700', bgColor: 'bg-pink-50' },
];

export function DayColumn({
  dayIndex,
  dayName,
  weekPlanId,
  exercises,
  allExercises,
  onRefresh,
  onDeleteExercise,
  onReorderItems,
  onMoveExercise,
  comboRefreshKey,
}: DayColumnProps) {
  const {
    loadDayCombos, createCombo, deleteComboWithExercises, copyComboToDay,
  } = useCombos();
  const {
    addExerciseToDay, copyExerciseWithSetLines, copyDayExercises, deleteDayExercises,
    fetchExercisesForDay, updateItemPosition, fetchExerciseByCode, fetchPlannedExerciseById,
  } = useWeekPlans();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [editingExercise, setEditingExercise] = useState<(PlannedExercise & { exercise: Exercise }) | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [draggedItemType, setDraggedItemType] = useState<'exercise' | 'combo' | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOverEmpty, setIsDragOverEmpty] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showMediaModal, setShowMediaModal] = useState<'video' | 'image' | null>(null);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);

  const [combos, setCombos] = useState<PlannedComboWithDetails[]>([]);
  const [editingCombo, setEditingCombo] = useState<PlannedComboWithDetails | null>(null);
  const [comboExerciseIds, setComboExerciseIds] = useState<Set<string>>(new Set());
  const [showComboCreator, setShowComboCreator] = useState(false);

  useEffect(() => {
    if (weekPlanId) {
      refreshCombos();
    }
  }, [weekPlanId, dayIndex, comboRefreshKey]);

  async function refreshCombos() {
    try {
      const { combos: combosWithDetails, comboExerciseIds: linkedExerciseIds } = await loadDayCombos(weekPlanId, dayIndex);
      setCombos(combosWithDetails);
      setComboExerciseIds(linkedExerciseIds);
    } catch (err) {
    }
  }

  const isSlashQuery = searchQuery.startsWith('/');

  const filteredCommands = isSlashQuery
    ? SLASH_COMMANDS.filter(cmd =>
        cmd.key.toLowerCase().startsWith(searchQuery.toLowerCase())
      )
    : [];

  const searchResults = searchQuery && !isSlashQuery
    ? allExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ex.exercise_code && ex.exercise_code.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  async function handleCreateCombo(data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) {
    setIsLoading(true);
    try {
      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;
      await createCombo(weekPlanId, dayIndex, newPosition, {
        exercises: data.exercises,
        unit: data.unit,
        comboName: data.comboName,
        color: data.color,
      });
      await refreshCombos();
      await onRefresh();
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteCombo(comboId: string) {
    if (!confirm('Delete this combo?')) return;

    setIsLoading(true);
    try {
      const combo = combos.find(c => c.id === comboId);
      await deleteComboWithExercises(comboId, combo?.items);
      await refreshCombos();
      await onRefresh();
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    const itemCount = isSlashQuery ? filteredCommands.length : searchResults.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => prev < itemCount - 1 ? prev + 1 : prev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => prev > 0 ? prev - 1 : 0);
    } else if (e.key === 'Enter' && itemCount > 0) {
      e.preventDefault();
      if (isSlashQuery) {
        handleSlashCommand(filteredCommands[selectedSearchIndex].key);
      } else {
        handleSelectExercise(searchResults[selectedSearchIndex]);
      }
    }
  };

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [searchQuery]);

  const handleSlashCommand = (commandKey: string) => {
    setSearchQuery('');
    setShowSearchResults(false);

    switch (commandKey) {
      case '/combo':
        setShowComboCreator(true);
        break;
      case '/text':
        handleAddFreeText();
        break;
      case '/video':
        setShowMediaModal('video');
        break;
      case '/image':
        setShowMediaModal('image');
        break;
    }
  };

  const handleAddMedia = async (type: 'video' | 'image', url: string) => {
    setShowMediaModal(null);
    setIsLoading(true);
    try {
      const code = type === 'video' ? 'VIDEO' : 'IMAGE';
      const sentinelExercise = await fetchExerciseByCode(code);

      if (!sentinelExercise) {
        alert(`${code} exercise type not found. Please run the database migration.`);
        return;
      }

      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;

      await addExerciseToDay(weekPlanId, dayIndex, sentinelExercise.id, newPosition, sentinelExercise.default_unit, { notes: url });
      await onRefresh();

      setTimeout(() => { searchInputRef.current?.focus(); }, 100);
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectExercise = async (exercise: Exercise) => {
    setIsLoading(true);
    try {
      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;

      await addExerciseToDay(weekPlanId, dayIndex, exercise.id, newPosition, exercise.default_unit);

      setSearchQuery('');
      setShowSearchResults(false);
      await onRefresh();

      setTimeout(() => { searchInputRef.current?.focus(); }, 100);
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  };

  async function handleAddFreeText() {
    setIsLoading(true);
    try {
      const freeTextExercise = await fetchExerciseByCode('TEXT');

      if (!freeTextExercise) {
        return;
      }

      const visibleExerciseCount = exercises.filter(ex => !comboExerciseIds.has(ex.id)).length;
      const newPosition = visibleExerciseCount + combos.length + 1;

      await addExerciseToDay(weekPlanId, dayIndex, freeTextExercise.id, newPosition, freeTextExercise.default_unit, { notes: 'Enter your text here...' });

      setSearchQuery('');
      setShowSearchResults(false);
      await onRefresh();

      setTimeout(() => { searchInputRef.current?.focus(); }, 100);
    } catch (err) {
    } finally {
      setIsLoading(false);
    }
  }

  const handleDragStart = (e: React.DragEvent, itemId: string, itemType: 'exercise' | 'combo') => {
    setDraggedItemId(itemId);
    setDraggedItemType(itemType);
    e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', `${dayIndex}:${itemType}:${itemId}`);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDraggedItemType(null);
    setDragOverIndex(null);
    setIsDragOverEmpty(false);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    setDragOverIndex(index);
  };

  const handleDropReorder = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    if (!draggedItemId || !draggedItemType) {
      await handleDrop(e);
      return;
    }

    const isCopy = e.ctrlKey || e.metaKey;
    const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
    const allItems: Array<{ type: 'exercise' | 'combo'; id: string; position: number }> = [
      ...visibleExercises.map(ex => ({ type: 'exercise' as const, id: ex.id, position: ex.position })),
      ...combos.map(combo => ({ type: 'combo' as const, id: combo.id, position: combo.position }))
    ].sort((a, b) => a.position - b.position);

    const draggedIndex = allItems.findIndex(item => item.id === draggedItemId && item.type === draggedItemType);
    if (draggedIndex === -1) return;

    if (isCopy) {
      setIsLoading(true);
      try {
        if (draggedItemType === 'exercise') {
          const draggedExercise = exercises.find(ex => ex.id === draggedItemId);
          if (!draggedExercise) return;
          await copyExerciseWithSetLines(draggedExercise, weekPlanId, dayIndex, dropIndex + 1);
        } else {
          await copyComboToDay(draggedItemId, combos, weekPlanId, dayIndex, dropIndex + 1);
          await refreshCombos();
        }

        await onRefresh();
      } finally {
        setIsLoading(false);
      }
    } else {
      if (draggedIndex === dropIndex) return;

      const reorderedItems = [...allItems];
      const [draggedItem] = reorderedItems.splice(draggedIndex, 1);
      reorderedItems.splice(dropIndex, 0, draggedItem);

      setIsLoading(true);
      try {
        for (let i = 0; i < reorderedItems.length; i++) {
          const item = reorderedItems[i];
          const table = item.type === 'exercise' ? 'planned_exercises' : 'planned_combos';
          await updateItemPosition(table, item.id, i + 1);
        }

        await refreshCombos();
        await onRefresh();
      } finally {
        setIsLoading(false);
      }
    }

    setDraggedItemId(null);
    setDraggedItemType(null);
  };


  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    const dragSource = e.dataTransfer.getData('text/plain');
    if (!dragSource) return;

    const parts = dragSource.split(':');
    if (parts.length < 3) return;

    const [fromDayIndex, itemType, itemId] = parts;
    const fromDay = parseInt(fromDayIndex, 10);

    if (fromDay === dayIndex) return;

    const isCopy = e.ctrlKey || e.metaKey;
    const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
    const newPosition = visibleExercises.length + combos.length + 1;

    setIsLoading(true);
    try {
      if (itemType === 'exercise') {
        if (isCopy) {
          const sourceExercise = await fetchPlannedExerciseById(itemId);
          if (sourceExercise) {
            await copyExerciseWithSetLines(sourceExercise, weekPlanId, dayIndex, newPosition);
          }
        } else {
          await onMoveExercise(itemId, fromDay, dayIndex);
        }
      } else if (itemType === 'combo') {
        await copyComboToDay(itemId, combos, weekPlanId, dayIndex, newPosition);
        await refreshCombos();

        if (!isCopy) {
          await deleteComboWithExercises(itemId);
          await refreshCombos();
        }
      }

      await onRefresh();
    } finally {
      setIsLoading(false);
    }

    setDraggedItemId(null);
    setDraggedItemType(null);
  };

  const handleDayDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.setData('text/plain', `DAY:${dayIndex}`);
  };

  const handleDayDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dragData = e.dataTransfer.getData('text/plain');
    if (!dragData.startsWith('DAY:')) return;

    const sourceDayIndex = parseInt(dragData.split(':')[1], 10);
    if (sourceDayIndex === dayIndex) return;

    const isCopy = e.ctrlKey || e.metaKey;
    setIsLoading(true);

    try {
      const sourceExercises = await fetchExercisesForDay(weekPlanId, sourceDayIndex);

      if (sourceExercises.length > 0) {
        const basePosition = exercises.length + 1;
        await copyDayExercises(sourceExercises, weekPlanId, dayIndex, basePosition);

        if (!isCopy) {
          await deleteDayExercises(sourceExercises.map(ex => ex.id));
        }

        await onRefresh();
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div
        className="bg-white rounded-lg border border-gray-200 p-3 min-h-[200px] flex flex-col"
        onDragOver={(e) => {
          e.preventDefault();
          const dragData = e.dataTransfer.types.includes('text/plain');
          if (dragData) {
            e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
          }
        }}
        onDrop={(e) => {
          const dragData = e.dataTransfer.getData('text/plain');
          if (dragData.startsWith('DAY:')) {
            handleDayDrop(e);
          } else {
            handleDrop(e);
          }
        }}
      >
        <div
          draggable={exercises.length > 0}
          onDragStart={handleDayDragStart}
          className={`flex items-center justify-between mb-2 pb-2 border-b border-gray-100 ${exercises.length > 0 ? 'cursor-move' : ''}`}
        >
          <div className="flex items-center gap-1.5">
            {exercises.length > 0 && <GripVertical size={14} className="text-gray-300" />}
            <span className="text-sm font-medium text-gray-900">{dayName}</span>
          </div>
          {(exercises.length > 0 || combos.length > 0) && (() => {
            const visEx = exercises.filter(ex => !comboExerciseIds.has(ex.id) && ex.exercise.counts_towards_totals);
            const s = visEx.reduce((sum, ex) => sum + (ex.summary_total_sets || 0), 0)
              + combos.reduce((sum, c) => sum + c.set_lines.reduce((ss, l) => ss + l.sets, 0), 0);
            const r = visEx.reduce((sum, ex) => sum + (ex.summary_total_reps || 0), 0)
              + combos.reduce((sum, c) => sum + c.set_lines.reduce((ss, l) => {
                const tr = l.reps_tuple_text.split('+').reduce((rr, p) => rr + (parseInt(p.trim(), 10) || 0), 0);
                return ss + l.sets * tr;
              }, 0), 0);
            return (
              <div className="text-xs text-gray-400">
                S <span className="font-medium text-gray-900">{s}</span>
                {' '}R <span className="font-medium text-gray-900">{r}</span>
              </div>
            );
          })()}
        </div>

        <div
          className="flex-1 space-y-1.5"
          onDragOver={(e) => {
            if (exercises.length === 0) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
              setIsDragOverEmpty(true);
            }
          }}
          onDragLeave={(e) => {
            if (exercises.length === 0 && e.currentTarget === e.target) {
              setIsDragOverEmpty(false);
            }
          }}
          onDrop={(e) => {
            if (exercises.length === 0) {
              setIsDragOverEmpty(false);
              const dragData = e.dataTransfer.getData('text/plain');
              if (dragData.startsWith('DAY:')) {
                handleDayDrop(e);
              } else {
                handleDrop(e);
              }
            }
          }}
        >
          {(() => {
            const visibleExercises = exercises.filter(ex => !comboExerciseIds.has(ex.id));
            const hasItems = visibleExercises.length > 0 || combos.length > 0;

            if (!hasItems) {
              return (
                <div className={`text-center py-8 text-sm transition-colors ${
                  isDragOverEmpty
                    ? 'text-blue-500 bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg'
                    : 'text-gray-400'
                }`}>
                  {isDragOverEmpty ? 'Drop exercise here' : 'No exercises yet'}
                </div>
              );
            }

            const allItems: Array<{ type: 'exercise' | 'combo'; data: any; position: number }> = [
              ...visibleExercises.map(ex => ({ type: 'exercise' as const, data: ex, position: ex.position })),
              ...combos.map(combo => ({ type: 'combo' as const, data: combo, position: combo.position }))
            ].sort((a, b) => a.position - b.position);

            return (
              <>
                {allItems.map((item, index) => {
                  if (item.type === 'exercise') {
                    return (
                      <ExerciseCard
                        key={item.data.id}
                        plannedEx={item.data}
                        index={index}
                        isDragged={draggedItemId === item.data.id && draggedItemType === 'exercise'}
                        isDraggedOver={dragOverIndex === index}
                        onSelect={() => setEditingExercise(item.data)}
                        onDelete={() => onDeleteExercise(item.data.id, dayIndex)}
                        onDragStart={(e) => handleDragStart(e, item.data.id, 'exercise')}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDropReorder(e, index)}
                      />
                    );
                  } else {
                    return (
                      <div
                        key={item.data.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.data.id, 'combo')}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDropReorder(e, index)}
                        className={`transition-all ${
                          draggedItemId === item.data.id && draggedItemType === 'combo' ? 'opacity-50' : ''
                        } ${dragOverIndex === index ? 'border-blue-400 bg-blue-50' : ''}`}
                      >
                        <ComboCard
                          combo={item.data}
                          onEdit={setEditingCombo}
                          onDelete={handleDeleteCombo}
                        />
                      </div>
                    );
                  }
                })}
              </>
            );
          })()}
        </div>

        {/* Search input at bottom of card */}
        <div className="mt-auto pt-2">
          <div className="relative" ref={searchInputRef}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="+ Add exercise..."
              className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded text-gray-500 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 bg-transparent"
              disabled={isLoading}
            />
            {showSearchResults && searchQuery && (
              <div className="absolute z-10 w-full bottom-full mb-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                {isSlashQuery ? (
                  filteredCommands.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">No matching commands</div>
                  ) : (
                    filteredCommands.map((cmd, index) => {
                      const CmdIcon = cmd.icon;
                      return (
                        <button
                          key={cmd.key}
                          onClick={() => handleSlashCommand(cmd.key)}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                            index === selectedSearchIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <CmdIcon size={12} className={cmd.iconColor} />
                            <span className="font-medium text-gray-900">{cmd.label}</span>
                            <span className="text-[10px] text-gray-400 ml-auto">{cmd.key}</span>
                          </div>
                        </button>
                      );
                    })
                  )
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
                ) : (
                  searchResults.filter(ex => ex.category !== '— System').map((ex, index) => (
                    <button
                      key={ex.id}
                      onClick={() => handleSelectExercise(ex)}
                      className={`w-full text-left px-3 py-1.5 text-xs border-b border-gray-50 last:border-0 transition-colors ${
                        index === selectedSearchIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: ex.color }} />
                        <span className="font-medium text-gray-900">{ex.name}</span>
                        {ex.exercise_code && (
                          <span className="text-[10px] text-gray-400 ml-auto">{ex.exercise_code}</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {editingExercise && (
        <PrescriptionModal
          plannedEx={editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={onRefresh}
        />
      )}

      {editingCombo && (
        <ComboEditorModal
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={async () => {
            await refreshCombos();
            await onRefresh();
          }}
        />
      )}

      {showComboCreator && (
        <ComboCreatorModal
          allExercises={allExercises}
          onClose={() => setShowComboCreator(false)}
          onSave={handleCreateCombo}
        />
      )}

      {showMediaModal && (
        <MediaInputModal
          type={showMediaModal}
          onClose={() => setShowMediaModal(null)}
          onSave={(url) => handleAddMedia(showMediaModal, url)}
        />
      )}
    </>
  );
}

interface ExerciseCardProps {
  plannedEx: PlannedExercise & { exercise: Exercise };
  index: number;
  isDragged: boolean;
  isDraggedOver: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/.test(url);
}

function isVimeoUrl(url: string): boolean {
  return /vimeo\.com\/\d+/.test(url);
}

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function getVimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(\d+)/);
  return match ? match[1] : null;
}

function MediaDisplay({ url, type }: { url: string; type: 'video' | 'image' }) {
  if (type === 'image') {
    return (
      <img
        src={url}
        alt="Attached image"
        className="max-h-28 rounded border border-gray-200 object-contain cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          window.open(url, '_blank');
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  // Video
  const ytId = getYouTubeId(url);
  if (ytId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="block relative group"
      >
        <img
          src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
          alt="YouTube video"
          className="w-full max-h-24 rounded border border-gray-200 object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-20 group-hover:bg-opacity-30 rounded transition-colors">
          <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
            <div className="w-0 h-0 border-l-[10px] border-l-white border-y-[6px] border-y-transparent ml-0.5" />
          </div>
        </div>
      </a>
    );
  }

  const vimeoId = getVimeoId(url);
  if (vimeoId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800"
      >
        <Video size={14} />
        <span className="truncate">Vimeo video</span>
      </a>
    );
  }

  // Direct video URL
  return (
    <video
      src={url}
      controls
      preload="metadata"
      className="max-h-24 rounded border border-gray-200 w-full"
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ExerciseCard({
  plannedEx,
  isDragged,
  isDraggedOver,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: ExerciseCardProps) {
  const isFreeText = plannedEx.exercise.exercise_code === 'TEXT';
  const isVideo = plannedEx.exercise.exercise_code === 'VIDEO';
  const isImage = plannedEx.exercise.exercise_code === 'IMAGE';
  const isMedia = isVideo || isImage;

  // Parse prescription for stacked notation
  const parsed = (!isFreeText && !isMedia && plannedEx.prescription_raw)
    ? parsePrescription(plannedEx.prescription_raw)
    : [];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`border-l-3 rounded transition-all cursor-pointer ${
        isDraggedOver ? 'bg-blue-50' : ''
      } ${isDragged ? 'opacity-50' : ''} hover:bg-gray-50`}
      style={{ borderLeft: `3px solid ${plannedEx.exercise.color}` }}
      onClick={onSelect}
    >
      <div className="py-1.5 px-2">
        {isFreeText ? (
          <p className="text-xs text-gray-500 italic leading-snug">
            {plannedEx.notes || 'Click to add text...'}
          </p>
        ) : isMedia ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              {isVideo ? (
                <Video size={11} className="text-indigo-500 flex-shrink-0" />
              ) : (
                <ImageIcon size={11} className="text-pink-500 flex-shrink-0" />
              )}
              <span className="text-[10px] font-medium text-gray-400 uppercase">
                {isVideo ? 'Video' : 'Image'}
              </span>
            </div>
            {plannedEx.notes ? (
              <MediaDisplay url={plannedEx.notes} type={isVideo ? 'video' : 'image'} />
            ) : (
              <p className="text-[10px] text-gray-300 italic">Click to set URL</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-gray-900 truncate leading-none">
                {plannedEx.exercise.name}
              </span>
              {(plannedEx as any).variation_note && (
                <span className="text-[10px] text-gray-400 italic truncate leading-none">
                  {(plannedEx as any).variation_note}
                </span>
              )}
            </div>

            {/* Stacked notation */}
            {parsed.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {parsed.map((line, i) => (
                  <div key={i} className="inline-flex items-center gap-0.5">
                    <div className="flex flex-col items-center leading-none">
                      <span className="text-[11px] font-medium text-gray-900">
                        {line.load}{plannedEx.unit === 'percentage' ? '%' : ''}
                      </span>
                      <div className="w-full h-px bg-gray-400 my-px" />
                      <span className="text-[11px] font-medium text-gray-900">{line.reps}</span>
                    </div>
                    {line.sets > 1 && (
                      <span className="text-[10px] font-medium text-gray-400 ml-px">{line.sets}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : plannedEx.prescription_raw ? (
              <p className="text-[10px] text-gray-500 mt-0.5">{plannedEx.prescription_raw}</p>
            ) : (
              <p className="text-[10px] text-gray-300 italic mt-0.5">No prescription</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
