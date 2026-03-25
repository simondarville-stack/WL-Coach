import { X } from 'lucide-react';
import type { Exercise } from '../lib/database.types';
import { ExerciseForm } from './ExerciseForm';

interface ExerciseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingExercise: Exercise | null;
  onSave: (exercise: Partial<Exercise>) => Promise<void>;
}

export function ExerciseFormModal({
  isOpen,
  onClose,
  editingExercise,
  onSave,
}: ExerciseFormModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {editingExercise ? 'Edit Exercise' : 'Add New Exercise'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4">
          <ExerciseForm
            editingExercise={editingExercise}
            onSave={onSave}
            onCancelEdit={onClose}
          />
        </div>
      </div>
    </div>
  );
}
