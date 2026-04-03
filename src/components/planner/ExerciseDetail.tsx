import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, Video, Image as ImageIcon, Upload, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type {
  PlannedExercise, Exercise,
  AthletePR, GeneralSettings, DefaultUnit, ComboMemberEntry,
} from '../../lib/database.types';
import type { MacroContext } from './WeeklyPlanner';
import { PrescriptionGrid } from './PrescriptionGrid';
import { SollIstChart } from './SollIstChart';

interface OtherDay {
  dayIndex: number;
  prescriptionRaw: string | null;
  totalSets: number | null;
  totalReps: number | null;
}

interface SollTarget {
  reps: number | null;
  hi: number | null;
  hiReps: number | null;
  hiSets: number | null;
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
function getSentinelType(code: string | null | undefined): SentinelType {
  if (code === 'TEXT') return 'text';
  if (code === 'VIDEO') return 'video';
  if (code === 'IMAGE') return 'image';
  return null;
}
function getYouTubeThumbnail(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

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
    if (hasMacro && plannedExercise) void loadSollTarget();
    if (!isCombo && !sentinel && plannedExercise) void loadOtherDays();
    if (isCombo && members.length > 0 && plannedExercise) void loadComboOtherDays();
  }, [macroContext?.macroId, plannedExercise?.id]);

  async function loadSollTarget() {
    if (!macroContext || !plannedExercise) return;
    const { data: te } = await supabase
      .from('macro_tracked_exercises')
      .select('id')
      .eq('macrocycle_id', macroContext.macroId)
      .eq('exercise_id', plannedExercise.exercise_id)
      .maybeSingle();
    if (!te) { setSollTarget(null); setTrackedExId(null); return; }
    setTrackedExId(te.id);
    const { data: mw } = await supabase
      .from('macro_weeks')
      .select('id')
      .eq('macrocycle_id', macroContext.macroId)
      .eq('week_number', macroContext.weekNumber)
      .maybeSingle();
    if (!mw) { setSollTarget(null); return; }
    const { data: tgt } = await supabase
      .from('macro_targets')
      .select('target_reps, target_hi, target_rhi, target_shi, target_ave')
      .eq('macro_week_id', mw.id)
      .eq('tracked_exercise_id', te.id)
      .maybeSingle();
    setSollTarget(tgt ? {
      reps: tgt.target_reps, hi: tgt.target_hi,
      hiReps: tgt.target_rhi, hiSets: tgt.target_shi, avg: tgt.target_ave,
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
      .from('planned_exercises')
      .select('id, day_index, prescription_raw, summary_total_sets, summary_total_reps')
      .eq('weekplan_id', weekPlanId)
      .eq('is_combo', true)
      .neq('id', plannedExercise.id);
    if (!otherCombos?.length) { setOtherDays([]); return; }
    const matching: OtherDay[] = [];
    for (const combo of otherCombos) {
      const { data: memberData } = await supabase
        .from('planned_exercise_combo_members')
        .select('exercise_id')
        .eq('planned_exercise_id', combo.id);
      const theirIds = (memberData || []).map((m: { exercise_id: string }) => m.exercise_id).sort().join(',');
      if (theirIds === currentMemberIds) {
        matching.push({
          dayIndex: combo.day_index,
          prescriptionRaw: combo.prescription_raw,
          totalSets: combo.summary_total_sets,
          totalReps: combo.summary_total_reps,
        });
      }
    }
    setOtherDays(matching);
  }

  async function applyText() {
    if (!plannedExercise) return;
    setSaving(true);
    try {
      await savePrescription(plannedExercise.id, {
        prescription: textValue,
        unit: (unit as DefaultUnit) || 'absolute_kg',
        isCombo,
      });
      await onSaved();
      setTextMode(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveSentinelNotes() {
    if (!plannedExercise) return;
    setSaving(true);
    try {
      await saveNotes(plannedExercise.id, notes);
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
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
    } finally {
      setUploading(false);
    }
  }

  // Saves a single field to DB. Unit changes also trigger a full refresh (affects grid rendering).
  // variation_note / combo_notation do NOT refresh — to avoid racing with in-flight savePrescription calls.
  async function saveSettingsField(field: 'unit' | 'variation_note' | 'combo_notation', value: string) {
    if (!plannedExercise) return;
    await supabase.from('planned_exercises').update({ [field]: value || null }).eq('id', plannedExercise.id);
    if (field === 'unit') await onSaved();
  }

  // Close immediately, flush pending timers, save in background, then refresh parent.
  function handleClose() {
    // Cancel all pending debounce timers
    [variationNoteTimerRef, comboNameTimerRef, notesTimerRef, refreshTimerRef].forEach(r => {
      if (r.current) { clearTimeout(r.current); r.current = null; }
    });
    // Fire-and-forget: save current state then refresh parent (always, even on error)
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
    onClose(); // Always close immediately — saves happen in the background
  }

  function hiFormat(hi: number | null, hiReps: number | null, hiSets: number | null) {
    if (hi == null) return '—';
    if (hiReps != null && hiSets != null) return `${hi}/${hiReps}/${hiSets}`;
    return `${hi}`;
  }

  const exerciseName = sentinel === 'text' ? 'Free text'
    : sentinel === 'video' ? 'Video'
    : sentinel === 'image' ? 'Image'
    : isCombo && members.length > 0
    ? (plannedExercise?.combo_notation || members.map(m => m.exercise.name).join(' + '))
    : (plannedExercise?.exercise.name ?? 'Exercise');

  return (
    <div
      className="flex flex-col h-full bg-white"
      onKeyDown={e => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          void handleClose();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500" title="Back to day editor">
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            <h2 className="text-base font-medium text-gray-900 leading-tight">{exerciseName}</h2>
            {plannedExercise?.variation_note && (
              <p className="text-xs text-gray-400 italic">{plannedExercise.variation_note}</p>
            )}
          </div>
        </div>
        <button onClick={() => void handleClose()} className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-500">
          <X size={18} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* ── Combo: component exercise list ── */}
        {isCombo && members.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {members.map(m => (
              <div key={m.exerciseId} className="flex items-center gap-1.5 text-xs text-gray-600">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.exercise.color || '#94a3b8' }} />
                {m.exercise.name}
              </div>
            ))}
          </div>
        )}

        {/* ── Content: sentinel-specific or prescription grid ── */}
        {plannedExercise && sentinel === 'text' && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block">Text content</span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={6}
              placeholder="Type your notes or instructions…"
              className="w-full text-sm text-gray-700 italic border border-gray-200 rounded px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        )}

        {plannedExercise && sentinel === 'video' && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block">Video URL</span>
            <input
              type="url"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Paste YouTube or video URL…"
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            {notes && (() => {
              const thumb = getYouTubeThumbnail(notes);
              return thumb
                ? <img src={thumb} alt="Video thumbnail" className="rounded w-full max-w-xs object-cover" />
                : <p className="text-xs text-gray-500 flex items-center gap-1 break-all"><Video size={12} className="text-indigo-400 flex-shrink-0" />{notes}</p>;
            })()}
          </div>
        )}

        {plannedExercise && sentinel === 'image' && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block">Image</span>
            <input
              type="url"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Paste image URL…"
              className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">or upload:</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded transition-colors disabled:opacity-50"
              >
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => void handleImageUpload(e)}
              />
            </div>
            {notes && (
              <img src={notes} alt="" className="rounded w-full max-w-xs object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
            )}
          </div>
        )}

        {plannedExercise && !sentinel && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Prescription</span>
              <button
                onClick={() => { setTextMode(v => !v); setTextValue(plannedExercise.prescription_raw ?? ''); }}
                className="text-[10px] text-gray-400 hover:text-blue-600 transition-colors"
              >
                {textMode ? 'Grid mode' : 'Text mode'}
              </button>
            </div>
            {textMode ? (
              <div className="space-y-2">
                <textarea
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded px-3 py-2 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
                  placeholder={isCombo ? '80×2+1, 90×2+1×2' : '80x5, 85x3x2'}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void applyText()}
                    disabled={saving}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
                  >
                    {saving ? 'Saving…' : 'Apply'}
                  </button>
                  <button onClick={() => setTextMode(false)} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">
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
                  void savePrescription(plannedExercise.id, {
                    prescription: raw,
                    unit: (unit as DefaultUnit) || 'absolute_kg',
                    isCombo,
                  });
                  debouncedRefresh();
                }}
              />
            )}
          </div>
        )}

        {/* ── Variation note (right below prescription) ── */}
        {!sentinel && plannedExercise && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Variation note</label>
            <input
              type="text"
              value={variationNote}
              onChange={e => { setVariationNote(e.target.value); saveVariationNoteDebounced(e.target.value); }}
              onBlur={() => { if (variationNoteTimerRef.current) clearTimeout(variationNoteTimerRef.current); void saveSettingsField('variation_note', variationNote); }}
              placeholder="e.g. pause at knee, blocks"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        )}

        {/* ── Coach notes ── */}
        {!sentinel && plannedExercise && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Coach notes</label>
            <textarea
              value={notes}
              onChange={e => { notesRef.current = e.target.value; setNotes(e.target.value); saveNotesDebounced(plannedExercise.id, e.target.value); }}
              onBlur={() => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); void saveNotes(plannedExercise.id, notesRef.current); }}
              rows={3}
              placeholder="Notes visible to athlete…"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        )}

        {/* ── Other days (regular and combo, not sentinels) ── */}
        {!sentinel && plannedExercise && (
          <div className="border-t border-gray-100 pt-4">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Other days this week</span>
            {otherDays.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Only planned on {dayName} this week</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {otherDays.sort((a, b) => a.dayIndex - b.dayIndex).map(d => {
                    const label = dayLabels[d.dayIndex] || `Day ${d.dayIndex}`;
                    return (
                      <tr key={d.dayIndex} className="border-b border-gray-100 last:border-0">
                        <td className="py-1.5 text-gray-700 font-medium w-24">{label}</td>
                        <td className="py-1.5 font-mono text-gray-600">
                          {d.prescriptionRaw ?? <span className="text-gray-400 italic font-sans">not yet planned</span>}
                        </td>
                        <td className="py-1.5 text-gray-500 text-right whitespace-nowrap">
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

        {/* ── SOLL / IST (macro, regular exercise only) ── */}
        {hasMacro && sollTarget && (
          <div className="border-t border-gray-100 pt-4">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Macro targets</span>
            <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-sm space-y-1.5 mb-3">
              <div className="flex gap-3 items-baseline">
                <span className="text-xs font-sans text-gray-500 w-8 flex-shrink-0">SOLL</span>
                <span className="text-gray-500">R <strong className="text-gray-900">{sollTarget.reps ?? '—'}</strong></span>
                <span className="text-gray-500">Avg <strong className="text-gray-900">{sollTarget.avg ?? '—'}</strong></span>
                <span className="text-gray-500">Hi <strong className="text-gray-900">{hiFormat(sollTarget.hi, sollTarget.hiReps, sollTarget.hiSets)}</strong></span>
              </div>
              <div className="flex gap-3 items-baseline">
                <span className="text-xs font-sans text-gray-500 w-8 flex-shrink-0">IST</span>
                <span className="text-gray-500">R <strong className="text-gray-900">{plannedExercise?.summary_total_reps ?? '—'}</strong></span>
                <span className="text-gray-500">Avg <strong className="text-gray-900">{plannedExercise?.summary_avg_load != null ? Math.round(plannedExercise.summary_avg_load) : '—'}</strong></span>
                <span className="text-gray-500">Hi <strong className="text-gray-900">{plannedExercise?.summary_highest_load ?? '—'}</strong></span>
              </div>
            </div>
            {trackedExId !== null && (
              <SollIstChart exerciseId={plannedExercise!.exercise_id} athleteId={athleteId} macroContext={macroContext!} />
            )}
          </div>
        )}

        {/* ── Settings (not for sentinels) ── */}
        {!sentinel && plannedExercise && (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block">Settings</span>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit</label>
              <select
                value={unit}
                onChange={e => { setUnit(e.target.value); void saveSettingsField('unit', e.target.value); }}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
              >
                {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {isCombo && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Combo name</label>
                <input
                  type="text"
                  value={comboName}
                  onChange={e => { setComboName(e.target.value); saveComboNameDebounced(e.target.value); }}
                  onBlur={() => { if (comboNameTimerRef.current) clearTimeout(comboNameTimerRef.current); void saveSettingsField('combo_notation', comboName); }}
                  placeholder={members.map(m => m.exercise.name).join(' + ')}
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
            )}
          </div>
        )}

      </div>

      {/* Footer — Save button for sentinels only */}
      {sentinel && plannedExercise && (
        <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3 flex justify-end bg-white">
          <button
            onClick={() => void saveSentinelNotes()}
            disabled={saving || uploading}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
