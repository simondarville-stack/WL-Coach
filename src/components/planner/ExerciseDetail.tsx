// TODO: Consider extracting Soll/Ist target section into SollIstTargetPanel sub-component
// TODO: Consider extracting media gallery into ExerciseMediaGallery sub-component
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, Video, Upload, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  PlannedExercise, Exercise,
  AthletePR, GeneralSettings, DefaultUnit, ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { getSentinelType, getYouTubeThumbnail } from './plannerUtils';
import { PrescriptionGrid } from './PrescriptionGrid';
import { SollIstChart } from './SollIstChart';
import { ExerciseHistoryChart } from './ExerciseHistoryChart';

interface OtherDay {
  dayIndex: number;
  prescriptionRaw: string | null;
  totalSets: number | null;
  totalReps: number | null;
}

interface SollTarget {
  reps: number | null;
  max: number | null;
  maxReps: number | null;
  maxSets: number | null;
  avg: number | null;
}

interface ExerciseDetailProps {
  plannedExercise: (PlannedExercise & { exercise: Exercise }) | null;
  comboMembers: Record<string, ComboMemberEntry[]>;
  weekPlanId: string;
  dayIndex: number;
  dayName: string;
  athleteId: string;
  macroContext: MacroContext | null;
  athletePRs: AthletePR[];
  dayLabels: Record<number, string>;
  settings: GeneralSettings | null;
  onClose: () => void;
  onBack?: () => void;
  onSaved: () => Promise<void>;
  savePrescription: (id: string, data: { prescription: string; unit: DefaultUnit; isCombo?: boolean }) => Promise<void>;
  saveNotes: (id: string, notes: string) => Promise<void>;
  fetchOtherDayPrescriptions: (
    weekplanId: string, exerciseId: string, excludeId: string,
  ) => Promise<OtherDay[]>;
}

type SentinelType = 'text' | 'video' | 'image' | null;

const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'absolute_kg', label: 'kg' },
  { value: 'percentage', label: '%' },
  { value: 'free_text_reps', label: 'Free text with reps × sets' },
  { value: 'free_text', label: 'Free text' },
];

export function ExerciseDetail({
  plannedExercise,
  comboMembers,
  weekPlanId,
  dayName,
  athleteId,
  macroContext,
  dayLabels,
  onClose,
  onBack,
  onSaved,
  savePrescription,
  saveNotes,
  fetchOtherDayPrescriptions,
  settings,
}: ExerciseDetailProps) {
  const isCombo = plannedExercise?.is_combo ?? false;
  const sentinel = getSentinelType(plannedExercise?.exercise.exercise_code);
  const members = isCombo && plannedExercise
    ? (comboMembers[plannedExercise.id] ?? []).sort((a, b) => a.position - b.position)
    : [];

  const hasMacro = !!macroContext && !isCombo && !sentinel && !!plannedExercise;

  const [textMode, setTextMode] = useState(false);
  const [textValue, setTextValue] = useState(plannedExercise?.prescription_raw ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unit, setUnit] = useState<string>(plannedExercise?.unit ?? 'absolute_kg');
  const [variationNote, setVariationNote] = useState(plannedExercise?.variation_note ?? '');
  const [comboName, setComboName] = useState(plannedExercise?.combo_notation ?? '');
  const [notes, setNotes] = useState(plannedExercise?.notes ?? '');
  const notesRef = useRef(plannedExercise?.notes ?? '');
  const [sollTarget, setSollTarget] = useState<SollTarget | null>(null);
  const [trackedExId, setTrackedExId] = useState<string | null>(null);
  const [otherDays, setOtherDays] = useState<OtherDay[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variationNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { void onSaved(); }, 600);
  }, [onSaved]);

  function saveNotesDebounced(id: string, value: string) {
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => { void saveNotes(id, value); }, 400);
  }

  function saveVariationNoteDebounced(value: string) {
    if (variationNoteTimerRef.current) clearTimeout(variationNoteTimerRef.current);
    variationNoteTimerRef.current = setTimeout(() => { void saveSettingsField('variation_note', value); }, 400);
  }

  function saveComboNameDebounced(value: string) {
    if (comboNameTimerRef.current) clearTimeout(comboNameTimerRef.current);
    comboNameTimerRef.current = setTimeout(() => { void saveSettingsField('combo_notation', value); }, 400);
  }

  const loadIncrement = settings?.grid_load_increment ?? 5;

  useEffect(() => {
    let cancelled = false;
    if (hasMacro && plannedExercise) void loadSollTarget();
    if (!isCombo && !sentinel && plannedExercise) void loadOtherDays();
    if (isCombo && members.length > 0 && plannedExercise) void loadComboOtherDays();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macroContext?.macroId, plannedExercise?.id]);

  async function loadSollTarget() {
    if (!macroContext || !plannedExercise) return;
    const { data: te } = await supabase.from('macro_tracked_exercises').select('id')
      .eq('macrocycle_id', macroContext.macroId).eq('exercise_id', plannedExercise.exercise_id).maybeSingle();
    if (!te) { setSollTarget(null); setTrackedExId(null); return; }
    setTrackedExId(te.id);
    const { data: mw } = await supabase.from('macro_weeks').select('id')
      .eq('macrocycle_id', macroContext.macroId).eq('week_number', macroContext.weekNumber).maybeSingle();
    if (!mw) { setSollTarget(null); return; }
    const { data: tgt } = await supabase.from('macro_targets')
      .select('target_reps, target_max, target_reps_at_max, target_sets_at_max, target_avg')
      .eq('macro_week_id', mw.id).eq('tracked_exercise_id', te.id).maybeSingle();
    setSollTarget(tgt ? {
      reps: tgt.target_reps, max: tgt.target_max,
      maxReps: tgt.target_reps_at_max, maxSets: tgt.target_sets_at_max, avg: tgt.target_avg,
    } : null);
  }

  async function loadOtherDays() {
    if (!plannedExercise) return;
    const data = await fetchOtherDayPrescriptions(weekPlanId, plannedExercise.exercise_id, plannedExercise.id);
    setOtherDays(data);
  }

  async function loadComboOtherDays() {
    if (!plannedExercise || members.length === 0) return;
    const currentMemberIds = members.map(m => m.exerciseId).sort().join(',');
    const { data: otherCombos } = await supabase
      .from('planned_exercises').select('id, day_index, prescription_raw, summary_total_sets, summary_total_reps')
      .eq('weekplan_id', weekPlanId).eq('is_combo', true).neq('id', plannedExercise.id);
    if (!otherCombos?.length) { setOtherDays([]); return; }
    // Batch-fetch all combo members in one query (fixes N+1)
    const comboIds = otherCombos.map(c => c.id);
    const { data: allMembers } = await supabase
      .from('planned_exercise_combo_members')
      .select('planned_exercise_id, exercise_id')
      .in('planned_exercise_id', comboIds);
    const memberMap = new Map<string, string[]>();
    for (const m of allMembers || []) {
      const list = memberMap.get(m.planned_exercise_id) || [];
      list.push(m.exercise_id);
      memberMap.set(m.planned_exercise_id, list);
    }
    const matching: OtherDay[] = [];
    for (const combo of otherCombos) {
      const theirIds = (memberMap.get(combo.id) || []).sort().join(',');
      if (theirIds === currentMemberIds) {
        matching.push({ dayIndex: combo.day_index, prescriptionRaw: combo.prescription_raw, totalSets: combo.summary_total_sets, totalReps: combo.summary_total_reps });
      }
    }
    setOtherDays(matching);
  }

  async function applyText() {
    if (!plannedExercise) return;
    setSaving(true);
    try {
      await savePrescription(plannedExercise.id, { prescription: textValue, unit: (unit as DefaultUnit) || 'absolute_kg', isCombo });
      await onSaved();
      setTextMode(false);
    } finally { setSaving(false); }
  }

  async function saveSentinelNotes() {
    if (!plannedExercise) return;
    setSaving(true);
    try {
      await saveNotes(plannedExercise.id, notes);
      await onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !plannedExercise) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${plannedExercise.id}.${ext}`;
      const { error } = await supabase.storage.from('planner-media').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('planner-media').getPublicUrl(path);
      setNotes(urlData.publicUrl);
      await saveNotes(plannedExercise.id, urlData.publicUrl);
      await onSaved();
      onClose();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally { setUploading(false); }
  }

  async function saveSettingsField(field: 'unit' | 'variation_note' | 'combo_notation', value: string) {
    if (!plannedExercise) return;
    await supabase.from('planned_exercises').update({ [field]: value || null }).eq('id', plannedExercise.id);
    if (field === 'unit') await onSaved();
  }

  function handleClose() {
    [variationNoteTimerRef, comboNameTimerRef, notesTimerRef, refreshTimerRef].forEach(r => {
      if (r.current) { clearTimeout(r.current); r.current = null; }
    });
    if (plannedExercise) {
      const id = plannedExercise.id;
      void Promise.all([
        saveNotes(id, notesRef.current).catch(() => {}),
        supabase.from('planned_exercises').update({
          variation_note: variationNote || null,
          ...(isCombo && { combo_notation: comboName || null }),
        }).eq('id', id),
      ]).then(() => void onSaved()).catch(() => void onSaved());
    } else {
      void onSaved();
    }
    onClose();
  }

  function maxFormat(maxVal: number | null, maxReps: number | null, maxSets: number | null) {
    if (maxVal == null) return '—';
    if (maxReps != null && maxSets != null) return `${maxVal}/${maxReps}/${maxSets}`;
    return `${maxVal}`;
  }

  const exerciseName = sentinel === 'text' ? 'Free text'
    : sentinel === 'video' ? 'Video'
    : sentinel === 'image' ? 'Image'
    : isCombo && members.length > 0
    ? (plannedExercise?.combo_notation || members.map(m => m.exercise.name).join(' + '))
    : (plannedExercise?.exercise.name ?? 'Exercise');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', fontSize: 13,
    border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)',
    outline: 'none', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4,
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
              onClick={onBack}
              style={{ padding: 4, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              title="Back to day editor"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', lineHeight: 1.25, margin: 0 }}>{exerciseName}</h2>
            {plannedExercise?.variation_note && (
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: 0 }}>{plannedExercise.variation_note}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => void handleClose()}
          style={{ padding: 4, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

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
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={6}
              placeholder="Type your notes or instructions…"
              className="planner-week-notes"
              style={{ ...inputStyle, resize: 'none', fontStyle: 'italic', lineHeight: 1.55 }}
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
              onChange={e => setNotes(e.target.value)}
              placeholder="Paste YouTube or video URL…"
              style={inputStyle}
            />
            {notes && (() => {
              const thumb = getYouTubeThumbnail(notes);
              return thumb
                ? <img src={thumb} alt="Video thumbnail" style={{ borderRadius: 4, width: '100%', maxWidth: 300, objectFit: 'cover' }} />
                : <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4, wordBreak: 'break-all', margin: 0 }}>
                    <Video size={12} style={{ color: '#6366F1', flexShrink: 0 }} />{notes}
                  </p>;
            })()}
          </div>
        )}

        {/* Sentinel: image */}
        {plannedExercise && sentinel === 'image' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionHeaderStyle}>Image</span>
            <input type="url" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Paste image URL…" style={inputStyle} />
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
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => void handleImageUpload(e)} />
            </div>
            {notes && (
              <img src={notes} alt="" style={{ borderRadius: 4, width: '100%', maxWidth: 300, objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
            )}
          </div>
        )}

        {/* Prescription */}
        {plannedExercise && !sentinel && (
          <div>
            <ExerciseHistoryChart exerciseId={plannedExercise.exercise_id} athleteId={athleteId} macroContext={macroContext} />
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
                />
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
                isCombo={isCombo}
                comboPartCount={isCombo ? (members.length || 2) : undefined}
                onSave={raw => {
                  void savePrescription(plannedExercise.id, { prescription: raw, unit: (unit as DefaultUnit) || 'absolute_kg', isCombo });
                  debouncedRefresh();
                }}
              />
            )}
          </div>
        )}

        {/* Variation note */}
        {!sentinel && plannedExercise && (
          <div>
            <label style={labelStyle}>Variation note</label>
            <input
              type="text"
              value={variationNote}
              onChange={e => { setVariationNote(e.target.value); saveVariationNoteDebounced(e.target.value); }}
              onBlur={() => { if (variationNoteTimerRef.current) clearTimeout(variationNoteTimerRef.current); void saveSettingsField('variation_note', variationNote); }}
              placeholder="e.g. pause at knee, blocks"
              style={inputStyle}
            />
          </div>
        )}

        {/* Coach notes */}
        {!sentinel && plannedExercise && (
          <div>
            <label style={labelStyle}>Coach notes</label>
            <textarea
              value={notes}
              onChange={e => { notesRef.current = e.target.value; setNotes(e.target.value); saveNotesDebounced(plannedExercise.id, e.target.value); }}
              onBlur={() => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); void saveNotes(plannedExercise.id, notesRef.current); }}
              rows={3}
              placeholder="Notes visible to athlete…"
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
                        <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)', fontWeight: 500, width: 96 }}>{label}</td>
                        <td style={{ padding: '6px 0', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                          {d.prescriptionRaw ?? <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontFamily: 'var(--font-sans)' }}>not yet planned</span>}
                        </td>
                        <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
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

        {/* SOLL / IST */}
        {hasMacro && sollTarget && (
          <div style={{ borderTop: '1px solid var(--color-border-tertiary)', paddingTop: 16 }}>
            <span style={sectionHeaderStyle}>Macro targets</span>
            <div style={{
              background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
              padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 13,
              display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12,
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--color-text-tertiary)', width: 32, flexShrink: 0 }}>SOLL</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)' }}>{sollTarget.reps ?? '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Avg <strong style={{ color: 'var(--color-text-primary)' }}>{sollTarget.avg ?? '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Max <strong style={{ color: 'var(--color-text-primary)' }}>{maxFormat(sollTarget.max, sollTarget.maxReps, sollTarget.maxSets)}</strong></span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--color-text-tertiary)', width: 32, flexShrink: 0 }}>IST</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>R <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_total_reps ?? '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Avg <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_avg_load != null ? Math.round(plannedExercise.summary_avg_load) : '—'}</strong></span>
                <span style={{ color: 'var(--color-text-secondary)' }}>Hi <strong style={{ color: 'var(--color-text-primary)' }}>{plannedExercise?.summary_highest_load ?? '—'}</strong></span>
              </div>
            </div>
            {trackedExId !== null && (
              <SollIstChart exerciseId={plannedExercise!.exercise_id} athleteId={athleteId} macroContext={macroContext!} />
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
            {isCombo && (
              <div>
                <label style={labelStyle}>Combo name</label>
                <input
                  type="text"
                  value={comboName}
                  onChange={e => { setComboName(e.target.value); saveComboNameDebounced(e.target.value); }}
                  onBlur={() => { if (comboNameTimerRef.current) clearTimeout(comboNameTimerRef.current); void saveSettingsField('combo_notation', comboName); }}
                  placeholder={members.map(m => m.exercise.name).join(' + ')}
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — Save button for sentinels only */}
      {sentinel && plannedExercise && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--color-border-secondary)', padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', background: 'var(--color-bg-primary)' }}>
          <button
            onClick={() => void saveSentinelNotes()}
            disabled={saving || uploading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              background: saving || uploading ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
              color: saving || uploading ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 500,
              cursor: saving || uploading ? 'not-allowed' : 'pointer',
              opacity: saving || uploading ? 0.5 : 1,
              transition: 'background 0.1s',
            }}
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
