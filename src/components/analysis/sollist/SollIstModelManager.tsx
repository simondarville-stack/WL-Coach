/**
 * SollIstModelManager — open, fork and curate Soll–Ist models.
 *
 * Two kinds of model sit behind the Model dropdown and they behave differently,
 * which is exactly what this sheet makes visible:
 *
 *  - **Textbook presets** (BVDG Senior / U23 / Junior) are hardcoded reference
 *    data, matched against the coach's own catalogue by name and alias. They
 *    are never mutated — a row labelled "BVDG — Senior" has to keep meaning
 *    what the BVDG book says. What the coach gets instead is **Open a copy**:
 *    the preset lands on the sheet, fully editable, and saving it makes a model
 *    of their own. Each preset shows how many of its rows actually resolve
 *    against this catalogue, so a coach can see the coverage before opening.
 *  - **Saved models** are the coach's own, and can be renamed, duplicated,
 *    opened and deleted here.
 */
import { useMemo, useState } from 'react';
import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import { Button, Input, Modal } from '../../ui';
import type { Exercise } from '../../../lib/database.types';
import type { SollIstModel } from '../../../lib/sollIst';
import { SOLLIST_PRESETS, presetId, resolvePreset } from '../../../lib/sollIstPresets';
import { formatDateToDDMMYYYY } from '../../../lib/dateUtils';

interface SollIstModelManagerProps {
  open: boolean;
  models: SollIstModel[];
  exercises: Exercise[];
  /** Just enough to name a model's athlete — the same shape the view holds. */
  athletes: Array<{ id: string; name: string }>;
  busy: boolean;
  onClose: () => void;
  /** Load a model / preset onto the sheet by its ref ('preset:<key>' or a uuid). */
  onOpen: (modelRef: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDuplicate: (model: SollIstModel) => Promise<void>;
  onDelete: (model: SollIstModel) => Promise<void>;
}

const cap: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-text-tertiary)',
  fontWeight: 600,
};
const th: React.CSSProperties = {
  ...cap,
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid var(--color-border-secondary)',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--text-label)',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
  verticalAlign: 'middle',
};
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

export function SollIstModelManager({
  open,
  models,
  exercises,
  athletes,
  busy,
  onClose,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: SollIstModelManagerProps) {
  /** Per-model name drafts, so typing doesn't fire a write per keystroke. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<SollIstModel | null>(null);

  const athleteName = useMemo(
    () => new Map(athletes.map((a) => [a.id, a.name])),
    [athletes],
  );

  /** How much of each preset actually lands on this coach's catalogue. */
  const coverage = useMemo(
    () =>
      SOLLIST_PRESETS.map((p) => {
        const resolved = resolvePreset(p, exercises);
        return {
          preset: p,
          mapped: resolved.rows.filter((r) => r.exerciseId != null).length,
          total: resolved.rows.length,
        };
      }),
    [exercises],
  );

  if (!open) return null;

  return (
    <Modal isOpen onClose={onClose} title="Soll–Ist models" size="xl">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        <section>
          <div style={{ ...cap, marginBottom: 6 }}>Textbook</div>
          <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            Shipped reference models. They stay as published — open a copy to edit the
            numbers, then save it as your own.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Model</th>
                <th style={{ ...th, textAlign: 'right' }}>Refs</th>
                <th style={{ ...th, textAlign: 'right' }}>Rows</th>
                <th style={{ ...th, textAlign: 'right' }}>Mapped</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {coverage.map(({ preset, mapped, total }) => (
                <tr key={preset.key}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{preset.name}</div>
                    <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>
                      {preset.description}
                    </div>
                  </td>
                  <td style={num}>{preset.refs.length}</td>
                  <td style={num}>{total}</td>
                  <td
                    style={{
                      ...num,
                      color: mapped === total
                        ? 'var(--color-success-text)'
                        : mapped === 0
                        ? 'var(--color-danger-text)'
                        : 'var(--color-text-secondary)',
                    }}
                    title="How many rows resolve against your exercise catalogue. Unmapped rows still open — repoint them on the sheet."
                  >
                    {mapped}/{total}
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Copy size={12} />}
                      disabled={busy}
                      onClick={() => { onOpen(presetId(preset.key)); onClose(); }}
                    >
                      Open a copy
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <div style={{ ...cap, marginBottom: 6 }}>Saved models</div>
          {models.length === 0 ? (
            <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', margin: 0 }}>
              None yet. Open a copy of a textbook model above, correct the numbers, and
              save it.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Athlete</th>
                  <th style={{ ...th, textAlign: 'right' }}>Rows</th>
                  <th style={{ ...th, textAlign: 'right' }}>Updated</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const unmapped = m.rows.filter((r) => r.exerciseId == null).length;
                  return (
                    <tr key={m.id}>
                      <td style={td}>
                        <Input
                          value={drafts[m.id] ?? m.name}
                          onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                          onBlur={() => {
                            const next = (drafts[m.id] ?? m.name).trim();
                            setDrafts((d) => {
                              const rest = { ...d };
                              delete rest[m.id];
                              return rest;
                            });
                            if (next && next !== m.name) void onRename(m.id, next);
                          }}
                          onKeyDown={(e) => {
                            // The surrounding dialog closes on Enter.
                            if (e.key === 'Enter') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); }
                          }}
                          aria-label={`Rename ${m.name}`}
                        />
                      </td>
                      <td style={{ ...td, color: 'var(--color-text-secondary)' }}>
                        {m.athleteId ? athleteName.get(m.athleteId) ?? '—' : '—'}
                      </td>
                      <td style={num} title={unmapped > 0 ? `${unmapped} row(s) not mapped to a catalogue exercise` : undefined}>
                        {m.rows.length}
                        {unmapped > 0 && <span style={{ color: 'var(--color-text-tertiary)' }}> · {unmapped}⚠</span>}
                      </td>
                      <td style={{ ...num, color: 'var(--color-text-tertiary)' }}>
                        {m.updatedAt ? formatDateToDDMMYYYY(m.updatedAt.slice(0, 10)) : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button variant="ghost" size="sm" icon={<FolderOpen size={12} />} disabled={busy}
                          title="Open on the sheet"
                          onClick={() => { onOpen(m.id); onClose(); }}>
                          Open
                        </Button>
                        <Button variant="ghost" size="sm" icon={<Copy size={12} />} disabled={busy}
                          title="Save a copy under a new name"
                          onClick={() => void onDuplicate(m)}>
                          Duplicate
                        </Button>
                        <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={12} />} disabled={busy}
                          title="Delete this model"
                          onClick={() => setConfirmDelete(m)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {confirmDelete && (
          <div style={{
            padding: 'var(--space-md)', borderRadius: 'var(--radius-md)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
          }}>
            <p style={{ margin: '0 0 8px', fontSize: 'var(--text-label)', color: 'var(--color-danger-text)' }}>
              Delete “{confirmDelete.name}” and its {confirmDelete.rows.length} rows?
              {' '}Saved analyses that used it keep working — they carry their own snapshot
              of the rows.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={async () => { const m = confirmDelete; setConfirmDelete(null); await onDelete(m); }}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
