/**
 * PresetManager — the coach-config editor for # prescription presets.
 *
 * The template is built with the SAME PrescriptionGrid the planner uses, so
 * creating a preset looks and feels exactly like prescribing an exercise
 * (stacked notation, signs, ranges, click gestures, formula cells). The
 * collapsed header previews the template through StackedNotation — the
 * canonical read-only visual.
 */
import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';
import { PrescriptionGrid } from './PrescriptionGrid';
import { StackedNotation } from './StackedNotation';
import type { CoachPreset, DefaultUnit } from '../../lib/database.types';
import type { CoachPresetInput } from '../../hooks/useCoachPresets';
import type { ExerciseFeatures } from '../../lib/exerciseFeatures';
import { formatSeconds, parseTimeInput, timeEditValue, parseTempoInput } from '../../lib/exerciseFeatures';
import { confirmDialog } from '../ui';

interface PresetManagerProps {
  onClose: () => void;
  presets: CoachPreset[];
  createPreset: (input?: Partial<CoachPresetInput>) => Promise<CoachPreset>;
  updatePreset: (id: string, patch: Partial<CoachPresetInput>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  loadIncrement: number;
  /** Coach's per-click load step (grid_click_increment). */
  clickIncrement?: number;
  /** Preset to open expanded on mount — the save-row-as-preset flow lands
   *  the coach directly on the freshly captured preset for naming. */
  initialOpenId?: string | null;
}

export function PresetBadge({ name, color, small = false }: { name: string; color: string; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontSize: small ? 8 : 9, fontWeight: 700, letterSpacing: '0.04em',
        padding: small ? '0 4px' : '1px 6px', borderRadius: 8, whiteSpace: 'nowrap',
        background: `${color}1c`, color,
      }}
    >
      #{name.toUpperCase()}
    </span>
  );
}

/** ⏱ / ⏸ feature editor row: checkbox + duration text ("12", "90s", "2:15"). */
function DurationFeature({
  icon, label, value, onChange,
}: {
  icon: string;
  label: string;
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const active = value != null;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
      <input
        type="checkbox"
        checked={active}
        onChange={e => onChange(e.target.checked ? (value ?? (label.includes('rest') ? 120 : 600)) : undefined)}
      />
      <span style={{ width: 14, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{icon}</span>
      {label}
      {active && (
        <input
          type="text"
          value={draft ?? timeEditValue(value as number)}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            if (draft != null) {
              const sec = parseTimeInput(draft);
              if (sec != null) onChange(sec);
            }
            setDraft(null);
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          title="Minutes; append s for seconds; m:ss works too"
          style={{
            width: 56, fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'right',
            padding: '2px 5px', border: '1px solid var(--color-border-primary)',
            borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)', outline: 'none',
          }}
        />
      )}
      {active && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>= {formatSeconds(value as number)}</span>}
    </label>
  );
}

/** Tempo (time under tension) — four digits, eccentric-pause-concentric-pause. */
function TempoFeature({
  value, onChange,
}: {
  value: string | undefined;
  onChange: (tempo: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const active = value != null;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
      <input
        type="checkbox"
        checked={active}
        onChange={e => onChange(e.target.checked ? (value ?? '3-0-1-0') : undefined)}
      />
      <span style={{ width: 14, fontSize: 11, color: 'var(--color-text-tertiary)' }}>⧖</span>
      tempo (TUT)
      {active && (
        <input
          type="text"
          value={draft ?? (value as string).replace(/-/g, '')}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            if (draft != null) {
              const tempo = parseTempoInput(draft);
              if (tempo != null) onChange(tempo);
            }
            setDraft(null);
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          title="Four digits: eccentric · pause · concentric · pause (e.g. 3120)"
          style={{
            width: 56, fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'right',
            padding: '2px 5px', border: '1px solid var(--color-border-primary)',
            borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)', outline: 'none',
          }}
        />
      )}
      {active && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>= {value}</span>}
    </label>
  );
}

export function PresetManager({
  onClose,
  presets,
  createPreset,
  updatePreset,
  deletePreset,
  loadIncrement,
  clickIncrement,
  initialOpenId = null,
}: PresetManagerProps) {
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  const patchFeatures = (p: CoachPreset, key: 'totalTime' | 'restTime', value: number | undefined) => {
    const next: ExerciseFeatures = { ...(p.features ?? {}) };
    if (value == null) delete next[key]; else next[key] = value;
    void updatePreset(p.id, { features: next });
  };

  const patchTempo = (p: CoachPreset, tempo: string | undefined) => {
    const next: ExerciseFeatures = { ...(p.features ?? {}) };
    if (tempo == null) delete next.tempo; else next.tempo = tempo;
    void updatePreset(p.id, { features: next });
  };

  const featureSummary = (p: CoachPreset) => {
    const bits: string[] = [];
    if (p.features?.totalTime != null) bits.push(`⏱ ${formatSeconds(p.features.totalTime)}`);
    if (p.features?.restTime != null) bits.push(`⏸ ${formatSeconds(p.features.restTime)}`);
    if (p.features?.tempo != null) bits.push(`⧖ ${p.features.tempo}`);
    return bits;
  };

  return (
    <AdaptiveDialog
      onClose={onClose}
      maxWidth={620}
      dismiss="transient"
      title={<span># Prescription presets</span>}
      ariaLabel="Prescription presets"
    >
      <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.45 }}>
          A preset is anything you can prescribe: build the template exactly like a normal exercise
          (signs, ranges and comma segments included), and add ⏱/⏸ if the block carries time.
          Apply with <span style={{ fontFamily: 'var(--font-mono)' }}>#name</span> in the add-exercise
          field or a prescription cell, from a row's + menu, or by dragging from the dock.
        </p>

        {presets.map(p => {
          const expanded = openId === p.id;
          return (
            <div key={p.id} style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 'var(--radius-md)' }}>
              {/* header: badge + StackedNotation preview of the template */}
              <button
                onClick={() => setOpenId(expanded ? null : p.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                }}
              >
                {expanded ? <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                          : <ChevronRight size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />}
                <PresetBadge name={p.name} color={p.color} />
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {p.prescription_raw
                    ? <StackedNotation raw={p.prescription_raw} unit={p.unit} />
                    : <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>no template</span>}
                  {featureSummary(p).map(t => (
                    <span key={t} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{t}</span>
                  ))}
                </span>
              </button>

              {expanded && (
                <div style={{ borderTop: '0.5px solid var(--color-border-secondary)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* identity */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', fontSize: 12 }}>#</span>
                    <input
                      type="text"
                      value={nameDrafts[p.id] ?? p.name}
                      onChange={e => setNameDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                      onBlur={() => {
                        const v = (nameDrafts[p.id] ?? p.name).trim().replace(/\s+/g, '');
                        if (v && v !== p.name) void updatePreset(p.id, { name: v });
                        setNameDrafts(d => { const n = { ...d }; delete n[p.id]; return n; });
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      style={{
                        width: 110, fontSize: 12, padding: '3px 6px',
                        border: '1px solid var(--color-border-primary)', borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', outline: 'none',
                      }}
                    />
                    <input
                      type="color"
                      value={p.color}
                      onChange={e => void updatePreset(p.id, { color: e.target.value })}
                      title="Badge colour"
                      style={{ width: 26, height: 22, padding: 0, border: '1px solid var(--color-border-primary)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
                    />
                    <button
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Delete preset #${p.name}?`,
                          message: 'Rows it was applied to keep their prescription.',
                          confirmLabel: 'Delete preset',
                          tone: 'danger',
                        });
                        if (ok) void deletePreset(p.id);
                      }}
                      title="Delete preset"
                      style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 2 }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger-text)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {/* template — the real prescription editor */}
                  <div>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', fontWeight: 600, marginBottom: 4 }}>
                      Prescription template — optional; built like a normal exercise
                    </div>
                    <PrescriptionGrid
                      prescriptionRaw={p.prescription_raw}
                      unit={p.unit ?? 'absolute_kg'}
                      loadIncrement={loadIncrement}
                      clickIncrement={clickIncrement}
                      isCombo={false}
                      onSave={(raw, unitOverride) => {
                        void updatePreset(p.id, {
                          prescription_raw: raw.trim() === '' ? null : raw,
                          unit: (unitOverride as DefaultUnit | undefined) ?? p.unit ?? 'absolute_kg',
                        });
                      }}
                    />
                  </div>

                  {/* features */}
                  <DurationFeature
                    icon="⏱" label="total time"
                    value={p.features?.totalTime}
                    onChange={sec => patchFeatures(p, 'totalTime', sec)}
                  />
                  <DurationFeature
                    icon="⏸" label="rest between sets"
                    value={p.features?.restTime}
                    onChange={sec => patchFeatures(p, 'restTime', sec)}
                  />
                  <TempoFeature
                    value={p.features?.tempo}
                    onChange={tempo => patchTempo(p, tempo)}
                  />
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={() => void createPreset().then(p => setOpenId(p.id))}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '7px 0', fontSize: 12, color: 'var(--color-text-secondary)',
            border: '1px dashed var(--color-border-primary)', borderRadius: 'var(--radius-md)',
            background: 'none', cursor: 'pointer',
          }}
        >
          <Plus size={12} /> new preset
        </button>
      </div>
    </AdaptiveDialog>
  );
}
