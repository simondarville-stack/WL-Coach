import { useState } from 'react';
import { GripVertical, Video, Image as ImageIcon, ChevronRight, BookmarkPlus, Dumbbell } from 'lucide-react';
import { useDeleteHeld } from '../../hooks/useDeleteHeld';
import { useExercises } from '../../hooks/useExercises';
import type { PlannedExercise, Exercise, DefaultUnit, ComboMemberEntry, GppSection, CoachPreset, AthleteHiddenKey } from '../../lib/database.types';
import { getSentinelType, getYouTubeThumbnail } from './sentinelUtils';
import { getOrCreateSentinel } from './sentinelService';
import { ExerciseSearch } from './ExerciseSearch';
import { ComboCreatorModal } from './ComboCreatorModal';
import { ExerciseFormModal } from '../ExerciseFormModal';
import { RestBadge } from './RestBadge';
import { PrescriptionGrid } from './PrescriptionGrid';
import { GppBlockEditor } from './GppBlockEditor';
import { SourceBadge } from './SourceBadge';
import { AnalysisColumn, FeatureChips, type FeatureMenuItem } from './ExerciseFeatureControls';
import type { ExerciseFeatures } from '../../lib/exerciseFeatures';
import {
  parsePrescription, formatPrescription,
  parseComboPrescription, formatComboPrescription,
} from '../../lib/prescriptionParser';
import type { RestInfo } from '../../lib/restCalculation';
import { computeMetrics, DEFAULT_VISIBLE_METRICS, type MetricKey } from '../../lib/metrics';
import { expandForCounting } from '../../lib/comboExpansion';
import { plannedNote } from '../../lib/plannedNote';
import { MetricStrip } from '../ui/MetricStrip';
import { MARK_DAY, MARK_DAY_REORDER, MARK_EXERCISE, MARK_PRESET } from './dragPayload';
import { plannedRowLabel } from '../../lib/plannedRowLabel';

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
    position: number | null,
    unit: DefaultUnit,
    extras?: { metadata?: import('../../lib/database.types').PlannedExerciseMetadata },
  ) => Promise<PlannedExercise & { id: string }>;
  createComboExercise: (
    weekPlanId: string,
    dayIndex: number,
    position: number | null,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
  /** Optimistic reorder within this day: updates local order immediately and
   *  persists positions in the background (no full refetch / remount). */
  onReorderInDay: (dayIndex: number, orderedIds: string[]) => void;
  onDeleteExercise: (plannedExId: string) => Promise<void>;
  /** Clear the whole training unit (delete-held + click on the unit header). */
  onClearDay: (dayIndex: number) => void | Promise<void>;
  onExerciseDrop: (
    fromDay: number,
    plannedExId: string,
    toDay: number,
    isCopy: boolean,
    isReplace: boolean,
    target?: { exId: string; position: 'before' | 'after' },
  ) => Promise<void>;
  onDayDrop: (sourceDay: number, destDay: number, isCopy: boolean, isReplace: boolean) => Promise<void>;
  /** Move this card to another card's position. Only supplied where position
   *  is the coach's to choose — a calendar-mapped card sits where its weekday
   *  puts it, so it gets no grip. */
  onReorderDay?: (fromDayIndex: number, toDayIndex: number) => void;
  onDockExerciseDrop?: (exerciseId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDrop?: (templateId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onDockTemplateDayDrop?: (templateDayId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onClipboardItemDrop?: (clipboardItemId: string, dayIndex: number, isReplace: boolean) => Promise<void>;
  onSaveAsTemplate?: (dayIndex: number) => void;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<unknown>;
  /** Persist a GPP block payload on a planned_exercise row. */
  saveGppSection?: (plannedExId: string, section: GppSection) => Promise<void>;
  /** Persist the exercise-features bag (⏱ total time, Σ/Ø overrides). */
  saveExerciseFeatures?: (plannedExId: string, features: ExerciseFeatures) => Promise<void>;
  /** Coach's # prescription presets for the add search and the row + menu. */
  presets?: CoachPreset[];
  /** Open the preset manager (from the # list's "manage presets…" entry). */
  onManagePresets?: () => void;
  /** Snapshot a row's prescription + durations into a new preset and open
   *  the manager on it for naming. */
  onSaveAsPreset?: (ex: PlannedExercise & { exercise: Exercise }) => void;
  /** Persist which row parts the athlete app hides (eye menu). */
  saveAthleteVisibility?: (plannedExId: string, hidden: AthleteHiddenKey[]) => Promise<void>;
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
  onReorderInDay,
  onDeleteExercise,
  onClearDay,
  onExerciseDrop,
  onDayDrop,
  onReorderDay,
  onDockExerciseDrop,
  onDockTemplateDrop,
  onDockTemplateDayDrop,
  onClipboardItemDrop,
  onSaveAsTemplate,
  savePrescription,
  saveGppSection,
  saveExerciseFeatures,
  presets,
  onManagePresets,
  onSaveAsPreset,
  saveAthleteVisibility,
  loadIncrement,
  defaultPrescriptionLoad,
  isLinkedToGroupPlan = false,
}: DayCardProps) {
  const { createExercise } = useExercises();
  const [isDragOver, setIsDragOver] = useState(false);
  const [reorderOver, setReorderOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [showNewExerciseModal, setShowNewExerciseModal] = useState(false);
  const [headerHovered, setHeaderHovered] = useState(false);
  const [hoveredExId, setHoveredExId] = useState<string | null>(null);
  const [draggingExId, setDraggingExId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: 'before' | 'after' } | null>(null);
  /** Row currently hovered by a dock preset drag (accent highlight). */
  const [presetDropExId, setPresetDropExId] = useState<string | null>(null);
  /** When non-null, opens the GPP editor for that planned_exercise. */
  const [editingGpp, setEditingGpp] = useState<PlannedExercise | null>(null);
  const deleteHeld = useDeleteHeld();

  function handleGridSave(ex: PlannedExercise, raw: string, unitOverride?: string) {
    // savePrescription writes to the DB and patches the in-memory row, so the
    // header totals update live. No success-path refetch — that would remount
    // the grid mid-edit. On failure, resync once to recover from divergence.
    void savePrescription(ex.id, {
      prescription: raw,
      unit: ((unitOverride ?? ex.unit) as DefaultUnit) || 'absolute_kg',
      isCombo: ex.is_combo,
    }).catch(() => { void onRefresh(); });
  }

  function handleFeaturesSave(ex: PlannedExercise, features: ExerciseFeatures) {
    if (!saveExerciseFeatures) return;
    void saveExerciseFeatures(ex.id, features).catch(() => { void onRefresh(); });
  }

  /** "+"-menu entry that prepends a ≥ sign to every unsigned load in the
   *  prescription. Offered for numeric units only, and only while at least
   *  one segment is still unsigned; per-segment cycling/removal lives on the
   *  glyph in the grid. */
  function signMenuItem(ex: PlannedExercise): FeatureMenuItem[] {
    const numericUnit = ex.unit === 'absolute_kg' || ex.unit === 'percentage' || ex.unit == null;
    if (!numericUnit || !ex.prescription_raw) return [];
    if (ex.is_combo) {
      const lines = parseComboPrescription(ex.prescription_raw);
      if (!lines.length || lines.every(l => l.loadCmp || l.loadText)) return [];
      return [{
        key: 'sign', icon: '≥', label: 'Load sign (≥ ≈ ≤)',
        onAdd: () => handleGridSave(ex, formatComboPrescription(
          lines.map(l => ({ ...l, loadCmp: l.loadText ? l.loadCmp ?? null : l.loadCmp ?? '>=' })),
          ex.unit,
        )),
      }];
    }
    const lines = parsePrescription(ex.prescription_raw);
    if (!lines.length || lines.every(l => l.loadCmp)) return [];
    return [{
      key: 'sign', icon: '≥', label: 'Load sign (≥ ≈ ≤)',
      onAdd: () => handleGridSave(ex, formatPrescription(
        lines.map(l => ({ ...l, loadCmp: l.loadCmp ?? '>=' })),
        ex.unit,
      )),
    }];
  }

  // Expand combos into their member instances so each member's reps count
  // under its own exercise and tick (a combo merely governs structure).
  const dayMetrics = computeMetrics(
    exercises
      .flatMap(ex => expandForCounting(ex, comboMembers[ex.id]))
      .map(c => ({ ...c, counts_towards_totals: c.exercise.counts_towards_totals })),
    competitionTotal,
  );
  const isEmpty = exercises.length === 0;

  async function handleAddExercise(exercise: Exercise, preset?: CoachPreset) {
    setAdding(true);
    try {
      // A #preset configures the new row: features go in on the insert; the
      // prescription template runs through savePrescription so set lines and
      // summary are written by the normal path. (No badge — presets configure
      // the row, they don't tag it.)
      const presetFeatures = preset?.features ?? {};
      const hasFeatures = Object.values(presetFeatures).some(v => v != null);
      const metadata = preset && hasFeatures ? { features: presetFeatures } : undefined;
      const unit = (preset?.prescription_raw ? preset.unit ?? exercise.default_unit : exercise.default_unit) as DefaultUnit;
      const created = await addExerciseToDay(
        weekPlanId, dayIndex, exercise.id, null, unit,
        metadata ? { metadata } : undefined,
      );
      if (preset?.prescription_raw) {
        await savePrescription(created.id, { prescription: preset.prescription_raw, unit, isCombo: false });
      }
    } finally {
      setAdding(false);
    }
    onRefresh();
  }

  /** Apply a #preset to an existing row: template replaces the prescription
   *  (non-combo only — combo notation is its own grammar), features merge
   *  (preset wins). */
  async function applyPresetToRow(ex: PlannedExercise, p: CoachPreset) {
    try {
      if (p.prescription_raw && !ex.is_combo) {
        const unit = (p.unit ?? ex.unit ?? 'absolute_kg') as DefaultUnit;
        await savePrescription(ex.id, { prescription: p.prescription_raw, unit, isCombo: false });
      }
      const pf = p.features ?? {};
      if (Object.values(pf).some(v => v != null) && saveExerciseFeatures) {
        await saveExerciseFeatures(ex.id, { ...(ex.metadata?.features ?? {}), ...pf });
      }
    } catch {
      void onRefresh();
    }
  }

  function presetMenuItems(ex: PlannedExercise): FeatureMenuItem[] {
    if (!presets?.length) return [];
    return presets.map(p => ({
      key: `preset-${p.id}`,
      icon: '#',
      label: `#${p.name}`,
      onAdd: () => void applyPresetToRow(ex, p),
    }));
  }

  function handleVisibilityToggle(ex: PlannedExercise, key: AthleteHiddenKey) {
    if (!saveAthleteVisibility) return;
    const hidden = ex.metadata?.athleteHidden ?? [];
    const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
    void saveAthleteVisibility(ex.id, next).catch(() => { void onRefresh(); });
  }

  /** "Save as preset…" — capture this row's prescription + durations as a
   *  new #preset. Combos are excluded (their tuple grammar is not a preset
   *  template), as are rows with nothing to capture. */
  function saveAsPresetItem(ex: PlannedExercise & { exercise: Exercise }): FeatureMenuItem[] {
    if (!onSaveAsPreset || ex.is_combo) return [];
    const f = ex.metadata?.features;
    const hasContent = !!ex.prescription_raw?.trim() || f?.totalTime != null || f?.restTime != null;
    if (!hasContent) return [];
    return [{
      key: 'save-as-preset',
      icon: '#',
      label: 'Save as preset…',
      onAdd: () => onSaveAsPreset(ex),
    }];
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
      await addExerciseToDay(weekPlanId, dayIndex, sentinel.id, null, 'free_text');
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleNewExerciseSave(exerciseData: Partial<Exercise>) {
    const data = await createExercise(exerciseData);
    setShowNewExerciseModal(false);
    if (data) {
      await addExerciseToDay(weekPlanId, dayIndex, data.id, null, data.default_unit as DefaultUnit);
      await onRefresh();
    }
  }

  async function handleComboCreate(data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) {
    await createComboExercise(weekPlanId, dayIndex, null, data);
    await onRefresh();
    setShowComboModal(false);
  }

  // Inline combo builder: "+" in the search line staged 2+ members. Commits
  // via the same createComboExercise path as the modal (unit + colour default
  // to the lead member), so inline and modal combos are byte-identical.
  async function handleAddComboInline(members: Exercise[]) {
    if (members.length < 2) return;
    setAdding(true);
    try {
      await createComboExercise(weekPlanId, dayIndex, null, {
        exercises: members.map((exercise, i) => ({ exercise, position: i + 1 })),
        unit: members[0].default_unit,
        comboName: '',
        color: members[0].color,
      });
      await onRefresh();
    } finally {
      setAdding(false);
    }
  }

  function handleReorder(draggedId: string, targetId: string, pos: 'before' | 'after') {
    const ids = exercises.map(e => e.id);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx < 0) return;
    ids.splice(fromIdx, 1);
    const toIdx = pos === 'before' ? ids.indexOf(targetId) : ids.indexOf(targetId) + 1;
    ids.splice(toIdx, 0, draggedId);
    // Optimistic: reorder locally + persist in the background. A full refetch
    // would remount every day card and make the drag visibly "jump".
    onReorderInDay(dayIndex, ids);
  }

  function handleCardDragOver(e: React.DragEvent) {
    // Preset drags target individual exercise rows, never the card itself —
    // arming the card would flash the "Drop to move here" move affordance
    // for a gesture that doesn't move anything.
    if (e.dataTransfer.types.includes(MARK_PRESET)) return;
    // A reorder drag is not a move-content drag: arming "Drop here" would
    // promise the wrong outcome. getData() is blocked during dragover, so the
    // kind has to be read off the type list.
    if (e.dataTransfer.types.includes(MARK_DAY_REORDER)) {
      if (!onReorderDay) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setReorderOver(true);
      return;
    }
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleCardDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setReorderOver(false);
    }
  }

  async function handleCardDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    setReorderOver(false);
    const data = e.dataTransfer.getData('text/plain');
    if (!data) return;
    // Reordering moves the CARD, never its contents — handled before anything
    // that would touch exercises, and a drop on itself is a no-op.
    if (data.startsWith('DAYORDER:')) {
      const from = parseInt(data.slice('DAYORDER:'.length), 10);
      if (!Number.isNaN(from) && from !== dayIndex) onReorderDay?.(from, dayIndex);
      return;
    }
    const isCopy = e.ctrlKey || e.metaKey;
    const isReplace = e.shiftKey;
    // Accept both prefixes during the rename window — a card already on
    // screen when the bundle reloads might still emit the legacy CANVAS:
    // marker until the user reloads the page.
    if (data.startsWith('CLIPBOARD:week-day:')) {
      // A single day from a parked week → "week-day:<weekId>:<srcDayIndex>".
      const rest = data.slice('CLIPBOARD:week-day:'.length);
      if (rest && onClipboardItemDrop) await onClipboardItemDrop(`week-day:${rest}`, dayIndex, isReplace);
    } else if (data.startsWith('CLIPBOARD:week:')) {
      // A whole parked week → apply all its days (prompts append/overwrite).
      const weekId = data.slice('CLIPBOARD:week:'.length);
      if (weekId && onClipboardItemDrop) await onClipboardItemDrop(`week:${weekId}`, dayIndex, isReplace);
    } else if (
      data.startsWith('CLIPBOARD:exercise:') ||
      data.startsWith('CLIPBOARD:day:') ||
      data.startsWith('CANVAS:exercise:') ||
      data.startsWith('CANVAS:day:')
    ) {
      const clipboardId = data.slice(data.lastIndexOf(':') + 1);
      if (!clipboardId || !onClipboardItemDrop) return;
      await onClipboardItemDrop(clipboardId, dayIndex, isReplace);
    } else if (data.startsWith('DOCK:exercise:')) {
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
          position: 'relative',
          background: isDragOver ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: isDragOver ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border-secondary)',
          // A reorder drag shows WHERE the card will land, rather than the
          // move-content highlight — two gestures, two affordances.
          boxShadow: reorderOver ? 'inset 3px 0 0 0 var(--color-accent)' : undefined,
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
            // Marker so the throw-away zone can tell what is in the air during
            // dragover, where getData() is blocked.
            e.dataTransfer.setData(MARK_DAY, '1');
            e.dataTransfer.effectAllowed = e.ctrlKey || e.metaKey ? 'copy' : 'move';
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            cursor: 'pointer',
            background: deleteHeld && !isEmpty && headerHovered
              ? 'var(--color-danger-bg)'
              : headerHovered ? 'var(--color-bg-secondary)' : 'transparent',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            transition: 'background 0.1s',
          }}
          onMouseEnter={() => setHeaderHovered(true)}
          onMouseLeave={() => setHeaderHovered(false)}
          title={deleteHeld && !isEmpty ? 'Delete all exercises in this unit' : undefined}
          onClick={e => {
            // Delete-held (or its Shift alias) + click on the unit header
            // clears the entire training unit — mirrors the per-exercise
            // delete-held gesture, with the red header tint as the affordance.
            if ((deleteHeld || e.shiftKey) && !isEmpty) {
              e.stopPropagation();
              void onClearDay(dayIndex);
              return;
            }
            onNavigateToDay();
          }}
        >
          {onReorderDay && (
            <span
              draggable
              // stopPropagation, or the header's own dragstart fires too and
              // the browser sends BOTH payloads — the last write would win and
              // a reorder would silently become a content move.
              onDragStart={e => {
                e.stopPropagation();
                e.dataTransfer.setData('text/plain', `DAYORDER:${dayIndex}`);
                e.dataTransfer.setData(MARK_DAY_REORDER, '1');
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={e => e.stopPropagation()}
              title="Drag to reorder this unit"
              style={{
                display: 'inline-flex', alignItems: 'center',
                marginLeft: -4, marginRight: -2,
                cursor: 'grab',
                color: headerHovered ? 'var(--color-text-tertiary)' : 'transparent',
                transition: 'color 0.1s',
              }}
            >
              <GripVertical size={12} />
            </span>
          )}
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
                // Rows that carry a PrescriptionGrid arm themselves visibly while
                // Delete is held (the grid recolours every cell — see
                // .pgrid-btn-del). The gridless rows — GPP blocks and the text /
                // video / image sentinels — render plain content instead and used
                // to sit there looking untouched, so a coach holding Delete over a
                // day card saw half the rows arm and half not. Recolour their
                // content in the same danger token, hover-independently, so the
                // whole card speaks one language. Content only: tinting the row
                // BACKGROUND hover-independently would turn the entire week pink.
                const dangerText = deleteHeld ? 'var(--color-danger-text)' : undefined;

                return (
                  <div
                    key={ex.id}
                    draggable
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData('text/plain', `${dayIndex}:exercise:${ex.id}`);
                      // Marker type so cross-day DayCards can detect that an
                      // exercise (not a template/dock item) is being dragged,
                      // and accept the drop with a positional indicator. The
                      // value is ignored; only the presence in types matters.
                      e.dataTransfer.setData(MARK_EXERCISE, '1');
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
                      // Dock preset drag → highlight this row as the apply
                      // target (sentinel rows carry no prescription to apply
                      // to, so they don't accept it).
                      if (!sentinel && presets?.length && e.dataTransfer.types.includes(MARK_PRESET)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        if (presetDropExId !== ex.id) setPresetDropExId(ex.id);
                        return;
                      }
                      // Allow drop when an exercise is being dragged from
                      // anywhere (same day OR cross-day). Same-day uses the
                      // local draggingExId; cross-day relies on the dataTransfer
                      // marker because draggingExId is per-DayCard.
                      const isExerciseDrag =
                        draggingExId != null ||
                        e.dataTransfer.types.includes(MARK_EXERCISE);
                      if (!isExerciseDrag) return;
                      if (draggingExId === ex.id) return;
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
                        setPresetDropExId(prev => prev === ex.id ? null : prev);
                      }
                    }}
                    onDrop={e => {
                      const data = e.dataTransfer.getData('text/plain');
                      // Dock preset dropped onto this row → apply it here.
                      if (data.startsWith('PRESET:')) {
                        e.preventDefault();
                        e.stopPropagation();
                        setPresetDropExId(null);
                        const preset = presets?.find(p => p.id === data.slice('PRESET:'.length));
                        if (preset && !sentinel) void applyPresetToRow(ex, preset);
                        return;
                      }
                      const parts = data.split(':');
                      if (parts.length >= 3) {
                        const fromDay = parseInt(parts[0], 10);
                        const dragType = parts[1];
                        const itemId = parts[2];
                        if (dragType === 'exercise' && itemId !== ex.id) {
                          const pos = dropIndicator?.position ?? 'after';
                          if (fromDay === dayIndex) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropIndicator(null);
                            setDraggingExId(null);
                            void handleReorder(itemId, ex.id, pos);
                            return;
                          }
                          // Cross-day drop on a specific exercise row:
                          // route through onExerciseDrop with target info so
                          // the dropped exercise lands at the visual position
                          // instead of being appended to the bottom of the day.
                          // dropIndicator may be null here because the dragover
                          // gate bailed on cross-day (draggingExId is local to
                          // the source DayCard), so recompute from mouse Y.
                          if (!isNaN(fromDay)) {
                            e.preventDefault();
                            e.stopPropagation();
                            const isCopy = e.ctrlKey || e.metaKey;
                            const isReplace = e.shiftKey;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const dropPos: 'before' | 'after' =
                              e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                            setDropIndicator(null);
                            setDraggingExId(null);
                            setIsDragOver(false);
                            void onExerciseDrop(
                              fromDay,
                              itemId,
                              dayIndex,
                              isCopy,
                              isReplace,
                              { exId: ex.id, position: dropPos },
                            );
                            return;
                          }
                        }
                      }
                      setDropIndicator(null);
                      setDraggingExId(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                      borderLeft: `3px solid ${borderColor}`,
                      background: presetDropExId === ex.id
                        ? 'var(--color-accent-muted)'
                        : deleteHeld
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
                    title={deleteHeld ? 'Click to delete this row' : undefined}
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
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
                          <p style={{ fontSize: 11, color: dangerText ?? 'var(--color-text-secondary)', fontStyle: 'italic', lineHeight: 1.375, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', margin: 0, flex: 1, minWidth: 0 }}>
                            {ex.notes || 'Free text…'}
                          </p>
                          <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
                        </div>
                      ) : sentinel === 'video' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Video size={11} style={{ color: dangerText ?? '#6366F1', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: dangerText ?? 'var(--color-text-secondary)' }}>Video</span>
                          {ex.notes && (() => {
                            const thumb = getYouTubeThumbnail(ex.notes);
                            return thumb ? <img src={thumb} alt="" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} /> : null;
                          })()}
                          <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
                        </div>
                      ) : sentinel === 'image' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ImageIcon size={11} style={{ color: dangerText ?? '#EC4899', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: dangerText ?? 'var(--color-text-secondary)' }}>Image</span>
                          {ex.notes && (
                            <img src={ex.notes} alt="" style={{ width: 56, height: 36, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                          )}
                          <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
                        </div>
                      ) : sentinel === 'gpp' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Dumbbell size={11} style={{ color: dangerText ?? '#10B981', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, fontWeight: 500, color: dangerText ?? 'var(--color-text-primary)' }}>
                              {ex.metadata?.gpp?.title || 'GPP'}
                            </span>
                            <span style={{ fontSize: 10, color: dangerText ?? 'var(--color-text-tertiary)' }}>
                              {ex.metadata?.gpp?.rows?.length
                                ? `${ex.metadata.gpp.rows.length} row${ex.metadata.gpp.rows.length === 1 ? '' : 's'}`
                                : 'click to edit'}
                            </span>
                            <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
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
                                    color: dangerText ?? 'var(--color-text-secondary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    lineHeight: 1.3,
                                  }}>
                                    <span style={{ color: dangerText ?? 'var(--color-text-primary)' }}>{label}</span>
                                    {suffix && (
                                      <span style={{ color: dangerText ?? 'var(--color-text-tertiary)' }}> {suffix}</span>
                                    )}
                                  </div>
                                );
                              })}
                              {ex.metadata.gpp.rows.length > 4 && (
                                <div style={{ fontSize: 9, color: dangerText ?? 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
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
                              {plannedRowLabel(ex, { memberNames: members.map(m => m.exercise.name) })}
                            </span>
                            <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
                          </div>
                          {plannedNote(ex) && (
                            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', margin: 0 }}>{plannedNote(ex)}</p>
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
                              presets={presets}
                              onApplyPreset={p => void applyPresetToRow(ex, p)}
                            />
                          </div>
                          {saveExerciseFeatures && ex.metadata?.features && (
                            <FeatureChips
                              features={ex.metadata.features}
                              onSaveFeatures={f => handleFeaturesSave(ex, f)}
                            />
                          )}
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                              {plannedRowLabel(ex, { exerciseName: ex.exercise.name })}
                            </span>
                            <SourceBadge source={ex.source} isLinkedToGroupPlan={isLinkedToGroupPlan} />
                          </div>
                          {plannedNote(ex) && (
                            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', margin: 0 }}>{plannedNote(ex)}</p>
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
                              isCombo={false}
                              compact
                              onSave={(raw, unitOverride) => handleGridSave(ex, raw, unitOverride)}
                              presets={presets}
                              onApplyPreset={p => void applyPresetToRow(ex, p)}
                            />
                          </div>
                          {saveExerciseFeatures && ex.metadata?.features && (
                            <FeatureChips
                              features={ex.metadata.features}
                              onSaveFeatures={f => handleFeaturesSave(ex, f)}
                            />
                          )}
                        </>
                      )}
                    </div>
                    {/* Per-exercise analysis (R/S/Hi/Ø) + "+" feature menu.
                        Sentinel rows (text/media/GPP) carry no summary. */}
                    {!sentinel && saveExerciseFeatures && (
                      <AnalysisColumn
                        ex={ex}
                        rowHovered={isHovered}
                        onSaveFeatures={f => handleFeaturesSave(ex, f)}
                        extraFeatureItems={signMenuItem(ex)}
                        presetItems={[
                          ...presetMenuItems(ex),
                          ...saveAsPresetItem(ex),
                          ...(onManagePresets ? [{ key: 'manage-presets', icon: '⚙', label: 'Manage presets…', onAdd: () => onManagePresets() }] : []),
                        ]}
                        visibility={saveAthleteVisibility ? {
                          hidden: ex.metadata?.athleteHidden ?? [],
                          onToggle: key => handleVisibilityToggle(ex, key),
                        } : undefined}
                        showSummary={ex.exercise.show_planner_summary ?? ex.exercise.counts_towards_totals}
                      />
                    )}
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
            onAdd={(exercise, preset) => void handleAddExercise(exercise, preset)}
            onAddCombo={members => void handleAddComboInline(members)}
            onSlashCommand={key => void handleSlashCommand(key)}
            placeholder={adding ? '…' : '+ Add exercise...'}
            presets={presets}
            onManagePresets={onManagePresets}
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
            // The editor autosaves, so there is NO success-path refetch — it
            // would re-render this card (and remount the editor) on every
            // keystroke. saveGppSection patches the in-memory row instead, so
            // the preview stays live. Resync only when a write actually fails.
            await saveGppSection(editingGpp.id, section).catch(err => {
              void onRefresh();
              throw err;
            });
          }}
        />
      )}
    </>
  );
}
