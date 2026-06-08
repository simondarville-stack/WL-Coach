import { useState } from 'react';
import { Trash2, Star } from 'lucide-react';
import { Modal, Button, Input } from '../../ui';
import { formatDateToDDMMYYYY } from '../../../lib/dateUtils';
import { viewExists, type SavedView } from './savedViews';

interface SaveViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  views: SavedView[];
  onSave: (name: string, description: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string | null) => void;
}

export function SaveViewModal({ isOpen, onClose, views, onSave, onDelete, onSetDefault }: SaveViewModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const overwrite = name.trim() ? viewExists(name.trim()) : false;
  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), description.trim());
    setName('');
    setDescription('');
    onClose();
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Save view"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!name.trim()}>{overwrite ? 'Overwrite' : 'Save'}</Button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-sm)' }}>
        Save the current scope, subjects, dimensions, measures and view as a named
        view. Saved on this device (cross-device sharing arrives with the saved-views table).
      </p>
      <Input
        autoFocus
        placeholder="View name, e.g. Weekly tonnage review"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <div style={{ marginTop: 'var(--space-sm)' }}>
        <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {overwrite && (
        <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-warning-text, var(--color-text-tertiary))', marginTop: 6 }}>
          A view named “{name.trim()}” exists — saving will overwrite it.
        </p>
      )}
      {views.length > 0 && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <div style={{ fontSize: 'var(--text-caption)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 6, fontWeight: 500 }}>
            Saved views
          </div>
          {views.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <button
                type="button"
                onClick={() => onSetDefault(v.isDefault ? null : v.id)}
                aria-label={v.isDefault ? `Unset ${v.name} as default` : `Set ${v.name} as default`}
                title={v.isDefault ? 'Default view — opens on load' : 'Set as default'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: v.isDefault ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
              >
                <Star size={14} fill={v.isDefault ? 'currentColor' : 'none'} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)' }}>{v.name}</div>
                {v.description && <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>{v.description}</div>}
                {v.lastRunAt && <div style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)' }}>last opened {formatDateToDDMMYYYY(v.lastRunAt.slice(0, 10))}</div>}
              </div>
              <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} onClick={() => onDelete(v.id)} aria-label={`Delete ${v.name}`} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
