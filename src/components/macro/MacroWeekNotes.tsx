import { useState, useRef } from 'react';

interface MacroWeekNotesProps {
  weekId: string;
  notes: string;
  onSave: (weekId: string, notes: string) => Promise<void>;
}

export function MacroWeekNotes({ weekId, notes, onSave }: MacroWeekNotesProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = () => {
    setDraft(notes);
    setEditing(true);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const handleBlur = async () => {
    if (draft !== notes) {
      await onSave(weekId, draft);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={handleBlur}
        rows={1}
        placeholder="Add note…"
        className="w-full text-[10px] border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent-border)] resize-none leading-snug overflow-hidden"
        style={{ minHeight: '18px', borderColor: 'var(--color-accent-border)', backgroundColor: 'var(--color-bg-primary)' }}
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit"
      className={`text-[10px] leading-snug cursor-text rounded px-1 py-0.5 min-h-[18px] whitespace-pre-wrap break-words hover:bg-[var(--color-bg-secondary)] transition-colors ${
        notes.trim() ? 'text-[color:var(--color-text-secondary)]' : 'text-[color:var(--color-text-tertiary)] italic'
      }`}
    >
      {notes.trim() || 'Add note…'}
    </div>
  );
}
