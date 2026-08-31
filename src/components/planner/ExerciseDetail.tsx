// TODO: Consider extracting the Target/Planned section into its own sub-component
// TODO: Consider extracting media gallery into ExerciseMediaGallery sub-component
import { useState, useEffect, useRef, useCallback } from 'react';
import { unitOf, unitSuffix, type MacroTargetUnit } from '../../lib/macroTargetUnit';
import { X, ArrowLeft, Video, Upload, Replace } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  PlannedExercise, Exercise,
  AthletePR, GeneralSettings, DefaultUnit, ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { getSentinelType, getYouTubeThumbnail } from './sentinelUtils';
import { plannedNote } from '../../lib/plannedNote';
import { plannedRowLabel } from '../../lib/plannedRowLabel';
import { AutoGrowTextarea } from '../ui';
import { PrescriptionGrid } from './PrescriptionGrid';
import { detectIntendedUnit } from '../../lib/prescriptionParser';
import { expandFormulas } from '../../lib/formulaEval';
import { DEFAULT_UNITS } from '../../lib/constants';
import { SollIstChart } from './SollIstChart';
import { StackedNotation } from './StackedNotation';
import { targetMaxRaw } from '../../lib/plannerMacro';
import { ExerciseHistoryChart } from './ExerciseHistoryChart';
import { ExercisePrescriptionHistory } from './ExercisePrescriptionHistory';
import { ExerciseActualsHistory } from './ExerciseActualsHistory';
import { ExerciseSearch } from './ExerciseSearch';
import { fetchComboPlannedRows, fetchPlannedRowsForExercise } from '../../lib/comboHistory';
import { ComboCreatorModal } from './ComboCreatorModal';

interface OtherDay {
  dayIndex: number;
  prescriptionRaw: string | null;
  /** Needed to render the row as Stacked Load Notation (% vs kg, combo tuples). */
  unit: string | null;
  isCombo: boolean;
  /** The complex this row is, when the viewed lift was trained inside one. */
  comboLabel: string | null;
  totalSets: number | null;
  totalReps: number | null;
}

interface SollTarget {
  reps: number | null;
  max: number | null;
  maxReps: number | null;
  maxSets: number | null;
  avg: number | null;
  /** Coach's macro note for this exercise+week ('' / null = none). */
  note: string | null;
  /** The macro COLUMN's unit — kg, % of PR, or prose. */
  unit: MacroTargetUnit;
  /** Prose load, when the macro column is free text. */
  text: string | null;
}

interface ExerciseDetailProps {
  plannedExercise: (PlannedExercise & { exercise: Exercise }) | null;
  comboMembers: Record<string, ComboMemberEntry[]>;
  weekPlanId: string;
  dayIndex: number;
  dayName: string;
  /** Monday-anchored start of the week being planned, for history context. */
  weekStart: string;
  athleteId: string;
  macroContext: MacroContext | null;
  athletePRs: AthletePR[];
  dayLabels: Record<number, string>;
  settings: GeneralSettings | null;
  allExercises: Exercise[];
  onClose: () => void;
  onBack?: () => void;
  onSaved: () => Promise<void>;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<void>;
  saveNotes: (id: string, notes: string) => Promise<void>;
  saveMediaDescription?: (id: string, description: string) => Promise<void>;
  swapPlannedExercise: (plannedExerciseId: string, newExerciseId: string) => Promise<void>;
  updateComboExercise: (
    plannedExerciseId: string,
    data: { exercises: { exercise: Exercise; position: number }[]; unit: DefaultUnit; comboName: string; color: string },
  ) => Promise<void>;
  /** Coach's # prescription presets — typing "#name" in a grid cell applies one. */
  presets?: import('../../lib/database.types').CoachPreset[];
  onApplyPreset?: (preset: import('../../lib/database.types').CoachPreset) => void;
}

// Unit choices are the canonical DEFAULT_UNITS from constants. Anything
// else in the DB (legacy rpe / other rows) will still render — the select
// just won't offer those as new choices.
const UNIT_OPTIONS = DEFAULT_UNITS;

export function ExerciseDetail({
  plannedExercise,
  comboMembers,
  weekPlanId,
  dayName,
  weekStart,
  athleteId,
  macroContext,
  dayLabels,
  allExercises,
  onClose,
  onBack,
  onSaved,
  savePrescription,
  saveNotes,
  saveMediaDescription,
  swapPlannedExercise,
  updateComboExercise,
  settings,
  presets,
  onApplyPreset,
}: ExerciseDetailProps) {
  const isCombo = plannedExercise?.is_combo ?? false;
  const sentinel = getSentinelType(plannedExercise?.exercise.exercise_code ?? null);
  const members = isCombo && plannedExercise
    ? (comboMembers[plannedExercise.id] ?? []).slice().sort((a, b) => a.position - b.position)
    : [];

  /**
   * Which lift the history sections below are about.
   *
   * null = the complex itself (the default); otherwise one member's exercise
   * id. One control drives the prescription history, the actuals, "other days"
   * and the macro block together, so the coach never has to reconcile four
   * sections that are each looking at something different.
   */
  const [comboView, setComboView] = useState<string | null>(null);
  useEffect(() => { setComboView(null); }, [plannedExercise?.id]);

  /** Member lifts, de-duplicated — "Frivend + Frivend + PushPress" needs two
   *  buttons, not three. Order is the complex's own order. */
  const memberChoices = (() => {
    const seen = new Set<string>();
    return members.filter(m => (seen.has(m.exerciseId) ? false : (seen.add(m.exerciseId), true)));
  })();

  /** The exercise the sections resolve against. */
  const viewExerciseId = comboView ?? plannedExercise?.exercise_id ?? '';
  /** Non-null only while looking at the complex AS the complex; a member view
   *  is an ordinary single-exercise view (which does include the complexes
   *  that lift appears in — see lib/comboHistory). */
  const viewComboMemberIds = isCombo && !comboView ? members.map(m => m.exerciseId) : null;

  // A complex is not itself trackable in a macro yet, so the macro block shows
  // for a plain row, or for a combo once the coach picks a member lift.
  const hasMacro = !!macroContext && !sentinel && !!plannedExercise && (!isCombo || comboView !== null);

  const [textMode, setTextMode] = useState(false);
  const [textValue, setTextValue] = useState(plannedExercise?.prescription_raw ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unit, setUnit] = useState<string>(plannedExercise?.unit ?? 'absolute_kg');
  // The week window the history chart is showing. Both history tables filter
  // to it, so the numbers under the chart are the ones plotted in it.
  const [chartRange, setChartRange] = useState<{ from: string; to: string } | null>(null);

  // The row's own name: a combo's `combo_notation`, or a plain row's
  // `display_name` override. Empty means "use the automatic name".
  const [rowName, setRowName] = useState(
    (plannedExercise?.is_combo ? plannedExercise?.combo_notation : plannedExercise?.display_name) ?? '',
  );
  // Single folded note: notes is the written field, legacy variation_note
  // pre-fills when notes is still empty (see src/lib/plannedNote.ts).
  const initialNote = plannedExercise ? (plannedNote(plannedExercise) ?? '') : '';
  const [notes, setNotes] = useState(initialNote);
  const notesRef = useRef(initialNote);
  const [mediaDescription, setMediaDescription] = useState(plannedExercise?.metadata?.description ?? '');
  const mediaDescriptionRef = useRef(plannedExercise?.metadata?.description ?? '');
  const mediaDescriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sollTarget, setSollTarget] = useState<SollTarget | null>(null);
  const [trackedExId, setTrackedExId] = useState<string | null>(null);
  const [otherDays, setOtherDays] = useState<OtherDay[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSwapPicker, setShowSwapPicker] = useState(false);
  const [showComboEditor, setShowComboEditor] = useState(false);

  const debouncedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { void onSaved(); }, 600);
  }, [onSaved]);

  function saveNotesDebounced(id: string, value: string) {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => { void saveNotes(id, value); }, 400);
  }

  /** A combo names itself in `combo_notation`; a plain row overrides its
   *  catalogue name in `display_name`. One editor, one debounce, and the row
   *  kind picks the column. */
  const nameField: 'combo_notation' | 'display_name' = isCombo ? 'combo_notation' : 'display_name';

  function saveRowNameDebounced(value: string) {
    if (comboNameTimerRef.current) clearTimeout(comboNameTimerRef.current);
    comboNameTimerRef.current = setTimeout(() => { void saveSettingsField(nameField, value); }, 400);
  }

  function flushRowName() {
    if (comboNameTimerRef.current) { clearTimeout(comboNameTimerRef.current); comboNameTimerRef.current = null; }
    void saveSettingsField(nameField, rowName).then(() => debouncedRefresh());
  }

  function saveMediaDescriptionDebounced(id: string, value: string) {
    if (!saveMediaDescription) return;
    if (mediaDescriptionTimerRef.current) clearTimeout(mediaDescriptionTimerRef.current);
    mediaDescriptionTimerRef.current = setTimeout(() => { void saveMediaDescription(id, value); }, 400);
  }

  const loadIncrement = settings?.grid_load_increment ?? 5;
  const defaultPrescriptionLoad = settings?.default_prescription_load ?? 50;

  useEffect(() => {
    if (hasMacro && plannedExercise) void loadSollTarget();
    if (!sentinel && plannedExercise) void loadOtherDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macroContext?.macroId, plannedExercise?.id, comboView]);

  async function loadSollTarget() {
    if (!macroContext || !plannedExercise) return;
    const { data: te } = await supabase.from('macro_tracked_exercises').select('id, target_unit')
      .eq('macrocycle_id', macroContext.macroId).eq('exercise_id', viewExerciseId).maybeSingle();
    if (!te) { setSollTarget(null); setTrackedExId(null); return; }
    setTrackedExId(te.id);
    const { data: mw } = await supabase.from('macro_weeks').select('id')
      .eq('macrocycle_id', macroContext.macroId).eq('week_number', macroContext.weekNumber).maybeSingle();
    if (!mw) { setSollTarget(null); return; }
    const { data: tgt } = await supabase.from('macro_targets')
      .select('target_reps, target_max, target_text, target_reps_at_max, target_sets_at_max, target_avg, note')
      .eq('macro_week_id', mw.id).eq('tracked_exercise_id', te.id).maybeSingle();
    const unit = unitOf(te);
    setSollTarget(tgt ? {
      reps: tgt.target_reps,
      // A free-text column's number is dormant — the prose is the load.
      max: unit === 'free_text_reps' ? null : tgt.target_max,
      text: tgt.target_text,
      unit,
      maxReps: tgt.target_reps_at_max, maxSets: tgt.target_sets_at_max, avg: tgt.target_avg,
      note: tgt.note,
    } : null);
  }

  /**
   * "Other days this week", resolved through the same combo rules as the
   * history tables above it — so the complex matches only itself, and a member
   * lift also finds the complexes it is trained inside. Both cases go through
   * lib/comboHistory rather than the exercise_id-only hook query, which could
   * not tell three different complexes apart.
   */
  async function loadOtherDays() {
    if (!plannedExercise) return;
    const rows = viewComboMemberIds
      ? await fetchComboPlannedRows([weekPlanId], viewComboMemberIds)
      : await fetchPlannedRowsForExercise([weekPlanId], viewExerciseId);
    const data: OtherDay[] = rows
      .filter(r => r.id !== plannedExercise.id)
      .map(r => ({
        dayIndex: r.day_index,
        prescriptionRaw: r.prescription_raw,
        unit: r.unit,
        isCombo: r.is_combo,
        comboLabel: r.is_combo && !viewComboMemberIds ? r.combo_notation : null,
        totalSets: r.summary_total_sets,
        totalReps: r.summary_total_reps,
      }));
    setOtherDays(data);
  }

  async function applyText() {
    if (!plannedExercise) return;
    setSaving(true);
    try {
      // Excel-style "=" tokens resolve before the unit is inferred, so
      // "=160*0.5x3" both stores 80x3 and is still detected as kg.
      const resolved = expandFormulas(textValue);
      const detected = detectIntendedUnit(resolved);
      const effective = (detected ?? unit) as DefaultUnit;
      if (detected && detected !== unit) setUnit(detected);
      await savePrescription(plannedExercise.id, { prescription: resolved, unit: effective || 'absolute_kg', isCombo });
      await onSaved();
      setTextMode(false);
    } finally { setSaving(false); }
  }

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !plannedExercise) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? (sentinel === 'video' ? 'mp4' : 'jpg');
      const path = `${plannedExercise.id}.${ext}`;
      const { error } = await supabase.storage.from('planner-media').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('planner-media').getPublicUrl(path);
      notesRef.current = urlData.publicUrl;
      setNotes(urlData.publicUrl);
      await saveNotes(plannedExercise.id, urlData.publicUrl);
      await onSaved();
      onClose();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally { setUploading(false); }
  }

  async function saveSettingsField(field: 'unit' | 'combo_notation' | 'display_name', value: string) {
    if (!plannedExercise) return;
    await supabase.from('planned_exercises').update({ [field]: value || null }).eq('id', plannedExercise.id);
    if (field === 'unit') await onSaved();
  }

  /** Commit every debounced edit and refresh the planner behind us. Both
   *  leaving routes need this: "back" used to be a pure view switch, so a
   *  renamed row (or a renamed combo, before it) kept showing its old name on
   *  the day card until something else happened to refetch. */
  function flushPendingEdits() {
    [comboNameTimerRef, notesTimerRef, mediaDescriptionTimerRef, refreshTimerRef].forEach(r => {
      if (r.current) { clearTimeout(r.current); r.current = null; }
    });
    if (plannedExercise) {
      const id = plannedExercise.id;
      // Supabase query builders are PromiseLike, not strict Promise.
      const tasks: PromiseLike<unknown>[] = [
        saveNotes(id, notesRef.current).catch(() => {}),
        ...(sentinel
          ? []
          : [supabase.from('planned_exercises').update({ [nameField]: rowName || null }).eq('id', id)]),
      ];
      if (saveMediaDescription && (sentinel === 'image' || sentinel === 'video')) {
        tasks.push(saveMediaDescription(id, mediaDescriptionRef.current).catch(() => {}));
      }
      void Promise.all(tasks).then(() => void onSaved()).catch(() => void onSaved());
    } else {
      void onSaved();
    }
  }

  function handleClose() {
    flushPendingEdits();
    onClose();
  }

  const exerciseName = sentinel === 'text' ? 'Free text'
    : sentinel === 'video' ? 'Video'
    : sentinel === 'image' ? 'Image'
    : plannedRowLabel(plannedExercise ?? {}, {
        memberNames: members.map(m => m.exercise.name),
        exerciseName: plannedExercise?.exercise.name,
      });

  /** What the name box shows when the coach has typed nothing — the name the
   *  row would carry on its own, so clearing the field is visibly a reset
   *  rather than a blank. */
  const autoName = isCombo
    ? members.map(m => m.exercise.name).join(' + ') || 'Combo'
    : plannedExercise?.exercise.name ?? 'Exercise';

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', fontSize: 13,
    border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
    outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4,
  };

  /** Tiny eyebrow used to label the phase / week note lines. */
  const labelStyle_inline: React.CSSProperties = {
    fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--color-text-tertiary)', fontStyle: 'normal', marginRight: 4,
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 8,
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-bg-primary)' }}
      onKeyDown={e => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          void handleClose();
        }
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-secondary)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onBack && (
            <button
              onClick={() => { flushPendingEdits(); onBack(); }}
              style={{ padding: 4, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              title="Back to day editor"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            {/* The title IS the name editor. A coach writing a variation
                ("Snatch from blocks") renames the row here; it stays a plain
                heading until focused, and never touches exercise_id — every
                set, log and analysis row keeps pointing at the catalogue
                exercise. Sentinels have no name to override. */}
            {plannedExercise && !sentinel ? (
              <input
                type="text"
                value={rowName}
                onChange={e => { setRowName(e.target.value); saveRowNameDebounced(e.target.value); }}
                onBlur={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'transparent';
                  flushRowName();
                }}
                placeholder={autoName}
                title={
                  rowName.trim()
                    ? `Renamed for this row only — logged under "${autoName}". Clear to restore.`
                    : 'Rename this row only (for variations)'
                }
                style={{
                  fontSize: 14, fontWeight: 500, lineHeight: 1.25, margin: 0,
                  width: Math.max(12, Math.min(44, (rowName || autoName).length + 2)) + 'ch',
                  maxWidth: 360,
                  padding: '1px 4px', marginLeft: -4,
                  color: 'var(--color-text-primary)',
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                }}
                onFocus={e => {
                  e.currentTarget.style.background = 'var(--color-bg-primary)';
                  e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                }}
                onMouseEnter={e => {
                  if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'var(--color-border-tertiary)';
                }}
                onMouseLeave={e => {
                  if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'transparent';
                }}
              />
            ) : (
              <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.25, margin: 0 }}>{exerciseName}</h2>
            )}
            {plannedExercise && !sentinel && rowName.trim() && !isCombo && (
              <p style={{ fontSize: 10, color: 'var(--color-text-tertiary)', margin: 0 }}>
                logged as {autoName}
              </p>
            )}
            {plannedExercise && plannedNote(plannedExercise) && (
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: 0, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plannedNote(plannedExercise)}</p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {plannedExercise && !sentinel && (
            <button
              onClick={() => {
                if (isCombo) setShowComboEditor(true);
                else setShowSwapPicker(s => !s);
              }}
              title={isCombo ? 'Edit combo' : 'Swap exercise (keeps prescription)'}
              style={{
                padding: 4, borderRadius: 'var(--radius-sm)', border: 'none',
                background: showSwapPicker ? 'var(--color-bg-secondary)' : 'transparent',
                cursor: 'pointer', color: 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = showSwapPicker ? 'var(--color-bg-secondary)' : 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)'; }}
            >
              <Replace size={14} />
            </button>
          )}
          <button
            onClick={() => void handleClose()}
            style={{ padding: 4, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Inline swap picker for single (non-combo) exercises */}
      {showSwapPicker && plannedExercise && !sentinel && !isCombo && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--color-border-secondary)', background: 'var(--color-bg-secondary)' }}>
          <ExerciseSearch
            exercises={allExercises.filter(e => e.category !== '— System' && e.id !== plannedExercise.exercise_id)}
            disableSlashCommands
            dropUp={false}
            autoFocus
            placeholder="Swap to another exercise…"
            onAdd={async (newEx) => {
              await swapPlannedExercise(plannedExercise.id, newEx.id);
              setShowSwapPicker(false);
              await onSaved();
            }}
          />
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Macro context — which cycle, which week of it, which phase, and the
            coach's own phase / week notes. All of this was already in
            `macroContext` and read by nothing but the two charts, so opening an
            exercise in a macro-covered week told you nothing about the block it
            sits in. Gated on `macroContext && !sentinel` only: week-level
            context is exercise-independent, so a COMBO gets it too (its
            per-exercise macro target is genuinely undefined and stays hidden). */}
        {macroContext && !sentinel && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '8px 10px', borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-secondary)',
            borderLeft: `3px solid ${macroContext.phaseColor || 'var(--color-border-secondary)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                {macroContext.macroName}
              </span>
              <span style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                color: 'var(--color-text-secondary)',
              }}>
                W{macroContext.weekNumber}/{macroContext.totalWeeks}
              </span>
              {(macroContext.weekType || macroContext.weekTypeText) && (
                <span style={{
                  fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)',
                }}>
                  {macroContext.weekType || macroContext.weekTypeText}
                </span>
              )}
              {macroContext.phaseName && (
                // Phase colour is coach-authored data — rendered as stored.
                <span style={{ fontSize: 10, color: macroContext.phaseColor || 'var(--color-text-secondary)' }}>
                  {macroContext.phaseName}
                </span>
              )}
              {macroContext.totalRepsTarget != null && (
                <span style={{
                  fontSize: 10, marginLeft: 'auto', fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-tertiary)',
                }} title="The macro's Σreps target for this week">
                  ΣR {macroContext.totalRepsTarget}
                </span>
              )}
            </div>
            {macroContext.phaseNotes.trim() && (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-secondary)' }} title={macroContext.phaseNotes}>
                <span style={labelStyle_inline}>Phase</span> ✎ {macroContext.phaseNotes}
              </div>
            )}
            {macroContext.weekNotes.trim() && (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-secondary)' }} title={macroContext.weekNotes}>
                <span style={labelStyle_inline}>Week</span> ✎ {macroContext.weekNotes}
              </div>
            )}
          </div>
        )}

        {/* Combo: component exercise list */}
        {isCombo && members.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {members.map(m => (
              <div key={m.position} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, backgroundColor: m.exercise.color || '#94a3b8' }} />
                {m.exercise.name}
              </div>
            ))}
          </div>
        )}

        {/* Sentinel: text */}
        {plannedExercise && sentinel === 'text' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionHeaderStyle}>Text content</span>
            <AutoGrowTextarea
              value={notes}
              onChange={e => {
                notesRef.current = e.target.value;
                setNotes(e.target.value);
                saveNotesDebounced(plannedExercise.id, e.target.value);
              }}
              onBlur={() => {
                if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
                void saveNotes(plannedExercise.id, notesRef.current);
              }}
              rows={6}
              placeholder="Type your notes or instructions…"
              className="planner-week-notes"
              style={{ ...inputStyle, fontStyle: 'italic', lineHeight: 1.55 }}
            />
          </div>
        )}

        {/* Sentinel: video */}
        {plannedExercise && sentinel === 'video' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionHeaderStyle}>Video URL</span>
            <input
              type="url"
              value={notes}
              onChange={e => {
                notesRef.current = e.target.value;
                setNotes(e.target.value);
                saveNotesDebounced(plannedExercise.id, e.target.value);
              }}
              onBlur={() => {
                if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
                void saveNotes(plannedExercise.id, notesRef.current);
              }}
              placeholder="Paste YouTube or video URL…"
              style={inputStyle}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>or upload:</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)',
                  borderRadius: 'var(--radius-md)', cursor: uploading ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => void handleMediaUpload(e)} />
            </div>
            {notes && (() => {
              const thumb = getYouTubeThumbnail(notes);
              if (thumb) {
                return <img src={thumb} alt="Video thumbnail" style={{ borderRadius: 4, width: '100%', maxWidth: 300, objectFit: 'cover' }} />;
              }
              const isUploadedVideo = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(notes);
              if (isUploadedVideo) {
                return <video src={notes} controls style={{ borderRadius: 4, width: '100%', maxWidth: 300 }} />;
              }
              return (
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4, wordBreak: 'break-all', margin: 0 }}>
                  <Video size={12} style={{ color: '#6366F1', flexShrink: 0 }} />{notes}
                </p>
              );
            })()}
            <label style={labelStyle}>Description</label>
            <textarea
              value={mediaDescription}
              onChange={e => {
                mediaDescriptionRef.current = e.target.value;
                setMediaDescription(e.target.value);
                saveMediaDescriptionDebounced(plannedExercise.id, e.target.value);
              }}
              onBlur={() => {
                if (mediaDescriptionTimerRef.current) clearTimeout(mediaDescriptionTimerRef.current);
                if (saveMediaDescription) void saveMediaDescription(plannedExercise.id, mediaDescriptionRef.current);
              }}
              rows={2}
              placeholder="e.g. Watch from 0:45, focus on bar path"
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.55 }}
            />
          </div>
        )}

        {/* Sentinel: image */}
        {plannedExercise && sentinel === 'image' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionHeaderStyle}>Image</span>
            <input
              type="url"
              value={notes}
              onChange={e => {
                notesRef.current = e.target.value;
                setNotes(e.target.value);
                saveNotesDebounced(plannedExercise.id, e.target.value);
              }}
              onBlur={() => {
                if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
                void saveNotes(plannedExercise.id, notesRef.current);
              }}
              placeholder="Paste image URL…"
              style={inputStyle}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>or upload:</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)',
                  borderRadius: 'var(--radius-md)', cursor: uploading ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => void handleMediaUpload(e)} />
            </div>
            {notes && (
              <img src={notes} alt="" style={{ borderRadius: 4, width: '100%', maxWidth: 300, objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
            )}
            <label style={labelStyle}>Description</label>
            <textarea
              value={mediaDescription}
              onChange={e => {
                mediaDescriptionRef.current = e.target.value;
                setMediaDescription(e.target.value);
                saveMediaDescriptionDebounced(plannedExercise.id, e.target.value);
              }}
              onBlur={() => {
                if (mediaDescriptionTimerRef.current) clearTimeout(mediaDescriptionTimerRef.current);
                if (saveMediaDescription) void saveMediaDescription(plannedExercise.id, mediaDescriptionRef.current);
              }}
              rows={2}
              placeholder="e.g. Setup cue, what to focus on"
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.55 }}
            />
          </div>
        )}

        {/* Prescription */}
        {plannedExercise && !sentinel && (
          <div>
            {/* One control for the whole panel. The complex is the default
                view; picking a member lift re-points the chart, both history
                tables, "other days" and the macro block at that lift. */}
            {isCombo && memberChoices.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {[{ id: null as string | null, label: plannedExercise.combo_notation?.trim() || 'Complex' },
                  ...memberChoices.map(m => ({ id: m.exerciseId, label: m.exercise.name }))].map(choice => {
                  const active = comboView === choice.id;
                  return (
                    <button
                      key={choice.id ?? '__combo__'}
                      type="button"
                      onClick={() => setComboView(choice.id)}
                      title={choice.id === null
                        ? 'This complex exactly as prescribed'
                        : `${choice.label} on its own, and every complex it is trained inside`}
                      style={{
                        fontSize: 10, padding: '3px 8px', cursor: 'pointer',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-secondary)',
                        borderColor: active ? 'var(--color-accent)' : 'var(--color-border-secondary)',
                        background: active ? 'var(--color-accent-muted)' : 'var(--color-bg-primary)',
                        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        fontWeight: active ? 600 : 500,
                        maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            )}
            <ExerciseHistoryChart
              exerciseId={viewExerciseId}
              athleteId={athleteId}
              macroContext={macroContext}
              currentWeekStart={weekStart}
              onVisibleRangeChange={setChartRange}
              comboMemberIds={viewComboMemberIds}
            />
            {/* Written beside performed, both scoped to the chart's window:
                zoom or pan the chart and these follow it. */}
            {athleteId && (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <ExercisePrescriptionHistory
                    exerciseId={viewExerciseId}
                    athleteId={athleteId}
                    weekStart={weekStart}
                    range={chartRange}
                    comboMemberIds={viewComboMemberIds}
                  />
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <ExerciseActualsHistory
                    exerciseId={viewExerciseId}
                    athleteId={athleteId}
                    weekStart={weekStart}
                    range={chartRange}
                    comboMemberIds={viewComboMemberIds}
                  />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={sectionHeaderStyle}>Prescription</span>
              <button
                onClick={() => { setTextMode(v => !v); setTextValue(plannedExercise.prescription_raw ?? ''); }}
                style={{ fontSize: 10, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)'; }}
              >
                {textMode ? 'Grid mode' : 'Text mode'}
              </button>
            </div>
            {textMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)', resize: 'none', lineHeight: 1.55 }}
                  placeholder={isCombo ? '80×2+1, 90×2+1×2' : '80x5, 85x3x2'}
                  title={'Start a value with = to calculate it: "=160*0.5x3" stores 80x3.\nInside a formula write the set separator as x (not *), and decimals with a full stop.'}
                />
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                  Tip: <code style={{ fontFamily: 'var(--font-mono)' }}>=160*0.5x3</code> → <code style={{ fontFamily: 'var(--font-mono)' }}>80x3</code>
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => void applyText()}
                    disabled={saving}
                    style={{
                      padding: '4px 12px', background: saving ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
                      color: saving ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
                      border: 'none', borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 500,
                      cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {saving ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => setTextMode(false)}
                    style={{ padding: '4px 12px', background: 'none', border: 'none', fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer', borderRadius: 'var(--radius-md)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <PrescriptionGrid
                prescriptionRaw={plannedExercise.prescription_raw}
                unit={plannedExercise.unit}
                loadIncrement={loadIncrement}
                defaultLoad={defaultPrescriptionLoad}
                isCombo={isCombo}
                comboPartCount={isCombo ? (members.length || 2) : undefined}
                onSave={(raw, unitOverride) => {
                  const effective = (unitOverride ?? unit) as DefaultUnit;
                  if (unitOverride && unitOverride !== unit) setUnit(unitOverride);
                  // Catch so a failed write can't surface as an unhandled
                  // rejection; debouncedRefresh below resyncs local state.
                  void savePrescription(plannedExercise.id, { prescription: raw, unit: effective || 'absolute_kg', isCombo }).catch(() => {});
                  debouncedRefresh();
                }}
                presets={presets}
                onApplyPreset={onApplyPreset}
              />
            )}
          </div>
        )}

        {/* Note (folded: variation note + coach notes are one field) */}
        {!sentinel && plannedExercise && (
          <div>
            <label style={labelStyle}>Note</label>
            <textarea
              value={notes}
              onChange={e => { notesRef.current = e.target.value; setNotes(e.target.value); saveNotesDebounced(plannedExercise.id, e.target.value); }}
              onBlur={() => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); void saveNotes(plannedExercise.id, notesRef.current); }}
              rows={3}
              placeholder="e.g. pause at knee, blocks — visible to athlete"
              className="planner-week-notes"
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.55 }}
            />
          </div>
        )}

        {/* Other days */}
        {!sentinel && plannedExercise && (
          <div style={{ borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 16 }}>
            <span style={sectionHeaderStyle}>Other days this week</span>
            {otherDays.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: 0 }}>Only planned on {dayName} this week</p>
            ) : (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <tbody>
                  {otherDays.sort((a, b) => a.dayIndex - b.dayIndex).map(d => {
                    const label = dayLabels[d.dayIndex] || `Day ${d.dayIndex}`;
                    return (
                      <tr key={d.dayIndex} style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '6px 0', verticalAlign: 'top', color: 'var(--color-text-secondary)', fontWeight: 500, width: 96 }}>{label}</td>
                        {/* Stacked Load Notation, like every other read-only
                            prescription (DISPLAY_CONVENTIONS §1). */}
                        <td style={{ padding: '6px 0', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                          {d.comboLabel && (
                            <span
                              title={'Trained inside the complex: ' + d.comboLabel}
                              style={{
                                display: 'block', fontSize: 9, letterSpacing: '0.03em',
                                color: 'var(--color-text-tertiary)', marginBottom: 1,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >
                              {d.comboLabel}
                            </span>
                          )}
                          {d.prescriptionRaw
                            ? <StackedNotation raw={d.prescriptionRaw} unit={d.unit} isCombo={d.isCombo} />
                            : <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>not yet planned</span>}
                        </td>
                        <td style={{ padding: '6px 0', verticalAlign: 'top', color: 'var(--color-text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {d.totalSets != null && d.totalReps != null ? `S${d.totalSets} R${d.totalReps}` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Target (from the macro) vs Planned (what is written into this week).
            NOT "Actual" — nothing here is a logged lift; that lives in the
            history chart's Performed series. The section used to be gated on
            `sollTarget`, which hid
            the SollIstChart too whenever the exercise was tracked in the macro
            but had no target row for THIS week — silence that reads as a bug. */}
        {hasMacro && (
          <div style={{ borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 16 }}>
            <span style={sectionHeaderStyle}>Macro targets</span>
            {!sollTarget && (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                {trackedExId === null
                  ? 'Not tracked in this macro.'
                  : 'Tracked, but no target set for this week.'}
              </div>
            )}
            {sollTarget && <div style={{
              background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
              padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13,
              display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12,
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--color-text-tertiary)', width: 52, flexShrink: 0 }}>Target</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)' }}>{sollTarget.reps ?? '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Avg <strong style={{ color: 'var(--color-text-primary)' }}>{
                  sollTarget.avg != null && sollTarget.unit !== 'free_text_reps'
                    ? `${sollTarget.avg}${unitSuffix(sollTarget.unit)}`
                    : '—'
                }</strong></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)' }}>
                  Max{' '}
                  {sollTarget.unit === 'free_text_reps' && sollTarget.text?.trim()
                    ? <strong style={{ color: 'var(--color-text-primary)' }}>{sollTarget.text}</strong>
                    : sollTarget.max != null
                    // Canonical stacked visual — same as the prescription grid,
                    // in whatever unit the macro column is written in.
                    ? <StackedNotation raw={targetMaxRaw(sollTarget.max, sollTarget.maxReps, sollTarget.maxSets)} unit={sollTarget.unit} />
                    : <strong style={{ color: 'var(--color-text-primary)' }}>—</strong>}
                </span>
              </div>
              {sollTarget.note?.trim() && (
                <div style={{
                  fontSize: 11, fontFamily: 'var(--font-sans)', fontStyle: 'italic',
                  color: 'var(--color-text-secondary)',
                }}>
                  ✎ {sollTarget.note}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--color-text-tertiary)', width: 52, flexShrink: 0 }}>Planned</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_total_reps ?? '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Avg <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_avg_load != null ? Math.round(plannedExercise.summary_avg_load) : '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Hi <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_highest_load ?? '—'}</strong></span>
              </div>
            </div>}
            {trackedExId !== null && (
              <SollIstChart exerciseId={viewExerciseId} athleteId={athleteId} macroContext={macroContext!} />
            )}
          </div>
        )}

        {/* Settings */}
        {!sentinel && plannedExercise && (
          <div style={{ borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <span style={sectionHeaderStyle}>Settings</span>
            <div>
              <label style={labelStyle}>Unit</label>
              <select
                value={unit}
                onChange={e => { setUnit(e.target.value); void saveSettingsField('unit', e.target.value); }}
                style={{ ...inputStyle, appearance: 'auto' }}
              >
                {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* The combo's name moved to the header, where a plain row's name
                override also lives — one name, one place, for both kinds. */}
          </div>
        )}
      </div>

      {/* Sentinel text/video/image fields autosave on blur + debounce (and
          flush on close via handleClose), matching every other note field —
          no explicit Save button. Media uploads persist immediately. */}

      {/* Combo edit modal — reopens the same creator UI pre-filled */}
      {showComboEditor && plannedExercise && isCombo && (
        <ComboCreatorModal
          mode="edit"
          allExercises={allExercises.filter(e => e.category !== '— System')}
          initialExercises={members.map(m => ({ exercise: m.exercise, position: m.position }))}
          initialUnit={(plannedExercise.unit as DefaultUnit) || 'absolute_kg'}
          initialComboName={plannedExercise.combo_notation ?? ''}
          initialColor={plannedExercise.combo_color || members[0]?.exercise.color || '#3B82F6'}
          onClose={() => setShowComboEditor(false)}
          onSave={async (data) => {
            await updateComboExercise(plannedExercise.id, data);
            setShowComboEditor(false);
            await onSaved();
          }}
        />
      )}
    </div>
  );
}
