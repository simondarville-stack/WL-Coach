import { useState, useRef, useEffect } from 'react';
import { X, Plus, ArrowUp, ArrowDown, Trash2, GripVertical } from 'lucide-react';
import type { Exercise, DefaultUnit } from '../../lib/database.types';

interface ComboCreatorModalProps {
  allExercises: Exercise[];
  onClose: () => void;
  onSave: (data: {
    exercises: { exercise: Exercise; position: number }[];
    unit: DefaultUnit;
    comboName: string;
    color: string;
  }) => Promise<void>;
}

const PRESET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1',
];

export function ComboCreatorModal({ allExercises, onClose, onSave }: ComboCreatorModalProps) {
  const [selectedExercises, setSelectedExercises] = useState<{ exercise: Exercise; position: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [unit, setUnit] = useState<DefaultUnit>('absolute_kg');
  const [comboName, setComboName] = useState('');
  const [color, setColor] = useState('#3B82F6');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => { setSelectedSearchIndex(0); }, [searchQuery]);

  const searchResults = searchQuery
    ? allExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ex.exercise_code && ex.exercise_code.toLowerCase().includes(searchQuery.toLowerCase()))
      ).slice(0, 15)
    : [];

  const addExercise = (exercise: Exercise) => {
    setSelectedExercises(prev => [...prev, { exercise, position: prev.length + 1 }]);
    setSearchQuery('');
    searchRef.current?.focus();
  };

  const removeExercise = (index: number) => {
    setSelectedExercises(prev =>
      prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, position: i + 1 }))
    );
  };

  const moveExercise = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= selectedExercises.length) return;
    setSelectedExercises(prev => {
      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next.map((item, i) => ({ ...item, position: i + 1 }));
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSearchIndex(prev => Math.min(prev + 1, searchResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSearchIndex(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && searchResults.length > 0) { e.preventDefault(); addExercise(searchResults[selectedSearchIndex]); }
  };

  const handleSave = async () => {
    if (selectedExercises.length < 2) return;
    setIsSaving(true);
    try {
      await onSave({ exercises: selectedExercises, unit, comboName: comboName.trim(), color });
      onClose();
    } catch { /* ignore */ } finally {
      setIsSaving(false);
    }
  };

  const autoName = selectedExercises.map(e => e.exercise.name).join(' + ');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', fontSize: 13,
    border: '1px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-md)', outline: 'none',
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 500,
    color: 'var(--color-text-secondary)', marginBottom: 4,
  };

  return (
    <div
      className="animate-backdrop-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
    >
      <div
        className="animate-dialog-in"
        style={{
          background: 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          border: '1px solid var(--color-border-secondary)',
          maxWidth: 512, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-secondary)',
          padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>Create Combo</h2>
          <button
            onClick={onClose}
            style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Combo Name (optional)</label>
            <input
              type="text"
              value={comboName}
              onChange={(e) => setComboName(e.target.value)}
              placeholder={autoName || 'Auto-generated from exercises'}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as DefaultUnit)}
                style={{ ...inputStyle, appearance: 'auto' }}
              >
                <option value="absolute_kg">kg</option>
                <option value="percentage">%</option>
                <option value="free_text_reps">Free text + reps × sets</option>
                <option value="free_text">Free text</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ribbon Color</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(presetColor => (
                  <button
                    key={presetColor}
                    type="button"
                    onClick={() => setColor(presetColor)}
                    style={{
                      width: 28, height: 28, borderRadius: 4, border: `2px solid ${color === presetColor ? '#111' : 'var(--color-border-secondary)'}`,
                      backgroundColor: presetColor, cursor: 'pointer',
                      transform: color === presetColor ? 'scale(1.1)' : 'scale(1)',
                      transition: 'transform 0.1s, border-color 0.1s',
                    }}
                    title={presetColor}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              Exercises ({selectedExercises.length} selected)
            </label>

            {selectedExercises.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {selectedExercises.map((item, index) => (
                  <div key={`${item.exercise.id}-${index}`} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)',
                    borderRadius: 'var(--radius-md)', padding: '8px 12px',
                  }}>
                    <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-tertiary)', width: 20 }}>{index + 1}.</span>
                    <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, backgroundColor: item.exercise.color ?? '#94a3b8' }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.exercise.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button onClick={() => moveExercise(index, -1)} disabled={index === 0} style={{ padding: 2, background: 'none', border: 'none', cursor: index === 0 ? 'not-allowed' : 'pointer', color: 'var(--color-text-tertiary)', opacity: index === 0 ? 0.3 : 1, display: 'flex' }}>
                        <ArrowUp size={14} />
                      </button>
                      <button onClick={() => moveExercise(index, 1)} disabled={index === selectedExercises.length - 1} style={{ padding: 2, background: 'none', border: 'none', cursor: index === selectedExercises.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--color-text-tertiary)', opacity: index === selectedExercises.length - 1 ? 0.3 : 1, display: 'flex' }}>
                        <ArrowDown size={14} />
                      </button>
                      <button onClick={() => removeExercise(index)} style={{ padding: 2, marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger-text)', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search exercises to add..."
                style={inputStyle}
              />
              {searchQuery && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', zIndex: 10, width: '100%', marginTop: 4,
                  background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)',
                  borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  maxHeight: 192, overflowY: 'auto',
                }}>
                  {searchResults.map((ex, index) => (
                    <button
                      key={ex.id}
                      onClick={() => addExercise(ex)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13,
                        background: index === selectedSearchIndex ? 'var(--color-accent-muted)' : 'transparent',
                        color: index === selectedSearchIndex ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        border: 'none', borderBottom: index < searchResults.length - 1 ? '1px solid var(--color-border-tertiary)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, backgroundColor: ex.color ?? '#94a3b8' }} />
                        <span style={{ fontWeight: 500 }}>{ex.name}</span>
                        {ex.exercise_code && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{ex.exercise_code}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery && searchResults.length === 0 && (
                <div style={{
                  position: 'absolute', zIndex: 10, width: '100%', marginTop: 4,
                  background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)',
                  borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  padding: '8px 12px', fontSize: 13, color: 'var(--color-text-secondary)',
                }}>
                  No matches
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          position: 'sticky', bottom: 0, background: 'var(--color-bg-secondary)',
          borderTop: '1px solid var(--color-border-secondary)',
          padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', fontSize: 13, color: 'var(--color-text-secondary)',
              background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || selectedExercises.length < 2}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13,
              background: isSaving || selectedExercises.length < 2 ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
              color: isSaving || selectedExercises.length < 2 ? 'var(--color-text-tertiary)' : 'var(--color-text-on-accent)',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: isSaving || selectedExercises.length < 2 ? 'not-allowed' : 'pointer',
              transition: 'background 0.1s',
            }}
          >
            <Plus size={16} />
            {isSaving ? 'Creating...' : 'Create Combo'}
          </button>
        </div>
      </div>
    </div>
  );
}
