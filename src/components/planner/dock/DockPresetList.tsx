/**
 * DockPresetList — the dock's # preset shelf.
 *
 * Each preset renders as a draggable card (badge + StackedNotation preview
 * + ⏱/⏸): drag one onto an exercise row in a day card to apply it there.
 * Drag payload: text/plain "PRESET:<id>" + the MARK_PRESET marker so rows
 * can accept the drop while it is still in the air (getData is blocked
 * during dragover — see dragPayload.ts).
 */
import { Settings2 } from 'lucide-react';
import type { CoachPreset } from '../../../lib/database.types';
import { StackedNotation } from '../StackedNotation';
import { PresetBadge } from '../PresetManager';
import { formatSeconds } from '../../../lib/exerciseFeatures';
import { MARK_PRESET } from '../dragPayload';

interface DockPresetListProps {
  presets: CoachPreset[];
  query: string;
  onManagePresets?: () => void;
}

export function DockPresetList({ presets, query, onManagePresets }: DockPresetListProps) {
  const q = query.trim().toLowerCase();
  const filtered = q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          {filtered.length} preset{filtered.length === 1 ? '' : 's'} — drag onto an exercise to apply
        </span>
        {onManagePresets && (
          <button
            onClick={onManagePresets}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: 'var(--color-text-secondary)', border: 'none',
              background: 'transparent', cursor: 'pointer', padding: '2px 4px',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
          >
            <Settings2 size={11} /> Manage
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {filtered.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('text/plain', `PRESET:${p.id}`);
              e.dataTransfer.setData(MARK_PRESET, '1');
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={`Drag onto an exercise to apply #${p.name}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 9px', cursor: 'grab',
              background: 'var(--color-bg-secondary)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <PresetBadge name={p.name} color={p.color} />
            {p.prescription_raw
              ? <StackedNotation raw={p.prescription_raw} unit={p.unit} />
              : <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>features only</span>}
            {p.features?.totalTime != null && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>⏱ {formatSeconds(p.features.totalTime)}</span>
            )}
            {p.features?.restTime != null && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>⏸ {formatSeconds(p.features.restTime)}</span>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: '6px 0' }}>
            {q ? 'No presets match.' : 'No presets yet — Manage opens the editor.'}
          </span>
        )}
      </div>
    </div>
  );
}
