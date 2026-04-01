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
        onChange={e => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={3}
        placeholder="Add note…"
        className="w-full text-[10px] border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none bg-white leading-snug"
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit"
      className={`text-[10px] leading-snug cursor-text rounded px-1 py-0.5 min-h-[18px] whitespace-pre-wrap break-words hover:bg-white/60 transition-colors ${
        notes.trim() ? 'text-gray-700' : 'text-gray-300 italic'
      }`}
    >
      {notes.trim() || 'Add note…'}
    </div>
  );
}
