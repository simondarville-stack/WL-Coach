import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal, Button, Input } from '../../ui';
import type { SavedView } from './savedViews';

interface SaveViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  views: SavedView[];
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}

export function SaveViewModal({ isOpen, onClose, views, onSave, onDelete }: SaveViewModalProps) {
  const [name, setName] = useState('');
  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
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
          <Button variant="primary" onClick={handleSave} disabled={!name.trim()}>Save</Button>
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
      {views.length > 0 && (
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <div style={{ fontSize: 'var(--text-caption)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 6, fontWeight: 500 }}>
            Saved views
          </div>
          {views.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <span style={{ fontSize: 'var(--text-label)', color: 'var(--color-text-primary)' }}>{v.name}</span>
              <Button variant="ghost" size="sm" iconOnly icon={<Trash2 size={14} />} onClick={() => onDelete(v.id)} aria-label={`Delete ${v.name}`} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
