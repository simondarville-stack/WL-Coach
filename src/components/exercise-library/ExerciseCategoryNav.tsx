/**
 * ExerciseCategoryNav
 *
 * Modal for managing exercise categories: rename, recolor, reorder (drag),
 * add, and delete. Extracted from ExerciseLibrary.tsx for clarity.
 */
import { useState, useRef } from 'react';
import { Layers, GripVertical, Trash2, Check } from 'lucide-react';
import type { Exercise } from '../../lib/database.types';
import type { Category } from '../../hooks/useExercises';
import { Modal, Button, Input, ColorDot } from '../ui';

const PRESET_COLORS = [
  '#E24B4A', '#7F77DD', '#D85A30', '#1D9E75',
  '#EF9F27', '#D4537E', '#3B82F6', '#10B981',
  '#F59E0B', '#8B5CF6', '#EC4899', '#888780',
];

function isProtectedCategory(cat: Category): boolean {
  return cat.name.toLowerCase().includes('system') || cat.name === 'Unspecified';
}

interface ExerciseCategoryNavProps {
  categories: Category[];
  exercises: Exercise[];
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: string) => Promise<void>;
  onReorder: (fromIdx: number, toIdx: number) => Promise<void>;
  onAdd: (name: string, color: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function ExerciseCategoryNav({
  categories,
  exercises,
  onClose,
  onRename,
  onRecolor,
  onReorder,
  onAdd,
  onDelete,
}: ExerciseCategoryNavProps) {
  const visible = categories.filter(c => !isProtectedCategory(c));
  const sorted = [...visible].sort((a, b) => a.display_order - b.display_order);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0]);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Refs for drag indices — state can be stale inside onDragEnd closure
  const dragIdxRef = useRef<number | null>(null);
  const dragOverIdxRef = useRef<number | null>(null);

  const exerciseCounts = new Map<string, number>();
  for (const cat of sorted) {
    exerciseCounts.set(cat.id, exercises.filter(e => (e.category as unknown as string) === cat.name).length);
  }

  function openColorPicker(e: React.MouseEvent, id: string) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setColorPickerPos({ x: rect.left, y: rect.bottom + 4, targetId: id });
  }

  function openNewColorPicker(e: React.MouseEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setColorPickerPos({ x: rect.left, y: rect.top - 140, targetId: null });
  }

  return (
    <>
      <Modal
        isOpen={true}
        onClose={onClose}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Layers size={14} style={{ color: 'var(--color-text-secondary)' }} />
            <span>Manage categories</span>
            <span
              style={{
                fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                fontWeight: 400, marginLeft: 'var(--space-xs)',
              }}
            >
              Drag to reorder
            </span>
          </span>
        }
        size="md"
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', width: '100%' }}>
            <button
              onClick={openNewColorPicker}
              style={{
                width: '24px', height: '24px', borderRadius: 'var(--radius-sm)',
                border: '0.5px solid var(--color-border-secondary)', background: newColor,
                cursor: 'pointer', flexShrink: 0, padding: 0,
              }}
              title="Pick color"
            />
            <Input
              placeholder="New category name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newName.trim()) { onAdd(newName.trim(), newColor); setNewName(''); }
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="primary" size="sm" icon={<Check size={12} />} disabled={!newName.trim()}
              onClick={() => { if (newName.trim()) { onAdd(newName.trim(), newColor); setNewName(''); } }}
            >
              Add
            </Button>
          </div>
        }
      >
        {deleteError && (
          <div style={{
            marginBottom: 'var(--space-sm)', padding: '8px 12px',
            background: '#fee2e2', border: '0.5px solid #fca5a5',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption)', color: '#dc2626',
          }}>
            {deleteError}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {sorted.map((cat, idx) => {
            const count = exerciseCounts.get(cat.id) ?? 0;
            const isEditing = editingId === cat.id;
            const isConfirming = confirmDeleteId === cat.id;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;

            return (
              <div
                key={cat.id}
                draggable
                onDragStart={() => { setDragIdx(idx); dragIdxRef.current = idx; }}
                onDragEnter={(e) => { e.preventDefault(); setDragOverIdx(idx); dragOverIdxRef.current = idx; }}
                onDragOver={(e) => e.preventDefault()}
                onDragEnd={async () => {
                  const from = dragIdxRef.current;
                  const to = dragOverIdxRef.current;
                  setDragIdx(null);
                  setDragOverIdx(null);
                  dragIdxRef.current = null;
                  dragOverIdxRef.current = null;
                  if (from !== null && to !== null && from !== to) {
                    await onReorder(from, to);
                  }
                }}
                className="group"
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                  padding: '8px var(--space-sm)', borderRadius: 'var(--radius-md)',
                  background: isDragOver ? 'var(--color-info-bg)' : 'transparent',
                  border: isDragOver ? '0.5px solid var(--color-info-border)' : '0.5px solid transparent',
                  opacity: dragIdx === idx ? 0.4 : 1,
                  transition: 'background 100ms ease-out',
                }}
                onMouseEnter={e => { if (!isDragOver) e.currentTarget.style.background = 'var(--color-bg-secondary)'; }}
                onMouseLeave={e => { if (!isDragOver) e.currentTarget.style.background = 'transparent'; }}
              >
                <GripVertical size={13} style={{ color: 'var(--color-text-tertiary)', cursor: 'grab', flexShrink: 0 }} />

                <button
                  onClick={(e) => openColorPicker(e, cat.id)}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    width: '20px', height: '20px', borderRadius: 'var(--radius-sm)',
                    border: '0.5px solid var(--color-border-secondary)',
                    background: cat.color ?? 'var(--color-gray-400)',
                    cursor: 'pointer', flexShrink: 0, padding: 0,
                    transition: 'transform 100ms ease-out',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  title="Change color"
                />

                {isEditing ? (
                  <Input
                    autoFocus value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { onRename(cat.id, editName); setEditingId(null); }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => { if (editName.trim()) onRename(cat.id, editName); setEditingId(null); }}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditName(cat.name); setEditingId(cat.id); }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{ flex: 1, fontSize: 'var(--text-body)', color: 'var(--color-text-primary)', cursor: 'text' }}
                  >
                    {cat.name}
                  </span>
                )}

                <span
                  style={{
                    fontSize: 'var(--text-caption)', color: 'var(--color-text-tertiary)',
                    fontFamily: 'var(--font-mono)', width: '24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count}
                </span>

                {isConfirming ? (
                  <div
                    onMouseDown={e => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flexShrink: 0 }}
                  >
                    <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-warning-text)', whiteSpace: 'nowrap' }}>
                      {count > 0 ? `Move ${count} to Unspecified?` : 'Delete?'}
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={async () => {
                        setDeleting(true);
                        setDeleteError(null);
                        try {
                          await onDelete(cat.id);
                          setConfirmDeleteId(null);
                        } catch (err) {
                          console.error('Category delete error:', err);
                          const msg = err instanceof Error
                            ? err.message
                            : (err as { message?: string; details?: string })?.message
                              ?? (err as { details?: string })?.details
                              ?? JSON.stringify(err);
                          setDeleteError(msg);
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      style={{
                        padding: '3px 8px', fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
                        background: 'var(--color-danger-bg, #fee2e2)', color: 'var(--color-danger-text, #dc2626)',
                        border: '0.5px solid var(--color-danger-border, #fca5a5)', borderRadius: 'var(--radius-sm)',
                        cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1,
                      }}
                    >
                      {deleting ? '…' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => { setConfirmDeleteId(null); setDeleteError(null); }}
                      style={{
                        padding: '3px 8px', fontSize: 'var(--text-caption)', fontFamily: 'var(--font-sans)',
                        background: 'transparent', color: 'var(--color-text-secondary)',
                        border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(cat.id)}
                    onMouseDown={e => e.stopPropagation()}
                    title="Delete category"
                    className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                    style={{
                      padding: '2px', background: 'transparent', border: 'none',
                      color: 'var(--color-text-tertiary)', cursor: 'pointer',
                      flexShrink: 0, display: 'flex',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Color picker popover */}
      {colorPickerPos && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 190 }} onClick={() => setColorPickerPos(null)} />
          <div
            style={{
              position: 'fixed', left: colorPickerPos.x, top: colorPickerPos.y,
              background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)',
              borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)',
              display: 'flex', flexWrap: 'wrap', gap: '4px', width: '132px', zIndex: 200,
            }}
          >
            {PRESET_COLORS.map(color => {
              const isActive = colorPickerPos.targetId
                ? categories.find(c => c.id === colorPickerPos.targetId)?.color === color
                : newColor === color;
              return (
                <button
                  key={color}
                  onClick={() => {
                    if (colorPickerPos.targetId) onRecolor(colorPickerPos.targetId, color);
                    else setNewColor(color);
                    setColorPickerPos(null);
                  }}
                  style={{
                    width: '24px', height: '24px', borderRadius: 'var(--radius-sm)',
                    border: isActive ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    background: color, cursor: 'pointer', transition: 'transform 100ms ease-out', padding: 0,
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
