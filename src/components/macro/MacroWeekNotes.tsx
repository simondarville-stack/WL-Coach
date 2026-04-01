import { useState, useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';

interface MacroWeekNotesProps {
  weekId: string;
  notes: string;
  onSave: (weekId: string, notes: string) => Promise<void>;
}

export function MacroWeekNotes({ weekId, notes, onSave }: MacroWeekNotesProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes);
  const popoverRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setDraft(notes);
  }, [open, notes]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, draft, notes]);

  const handleClose = async () => {
    if (draft !== notes) {
      await onSave(weekId, draft);
    }
    setOpen(false);
  };

  const hasNote = notes.trim().length > 0;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title={hasNote ? notes : 'Add note'}
        className={`p-0.5 rounded transition-colors ${
          hasNote ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
        }`}
      >
        <MessageSquare size={13} className={hasNote ? 'fill-blue-100' : ''} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-6 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-48"
        >
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleClose}
            placeholder="Add note..."
            rows={3}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
          />
        </div>
      )}
    </div>
  );
}
