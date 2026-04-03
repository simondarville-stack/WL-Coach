import { useState, useEffect } from 'react';
import { X, AlertTriangle, Clipboard, ArrowRight } from 'lucide-react';
import type { Athlete, TrainingGroup } from '../../lib/database.types';
import { formatDateRange } from '../../lib/dateUtils';
import { useCombos } from '../../hooks/useCombos';

interface CopyWeekModalProps {
  onClose: () => void;
  onPasteComplete: () => void;
  destinationWeekStart: string;
  sourceWeekStart: string;
  sourceAthlete: Athlete | null;
  sourceGroup: TrainingGroup | null;
  destinationAthlete: Athlete | null;
  destinationGroup: TrainingGroup | null;
  allAthletes: Athlete[];
  allGroups: TrainingGroup[];
}

type TargetType = 'athlete' | 'group';

export function CopyWeekModal({
  onClose,
  onPasteComplete,
  destinationWeekStart,
  sourceWeekStart,
  sourceAthlete,
  sourceGroup,
  destinationAthlete,
  destinationGroup,
  allAthletes,
  allGroups,
}: CopyWeekModalProps) {
  const getInitialTargetType = (): TargetType => {
    if (destinationGroup) return 'group';
    return 'athlete';
  };

  const [targetType, setTargetType] = useState<TargetType>(getInitialTargetType());
  const [selectedTargetAthleteId, setSelectedTargetAthleteId] = useState<string>(
    destinationAthlete?.id || ''
  );
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState<string>(
    destinationGroup?.id || ''
  );
  const [destinationHasData, setDestinationHasData] = useState(false);
  const [pasting, setPasting] = useState(false);

  const { checkDestinationWeekHasData, copyWeekPlan } = useCombos();

  const resolveTarget = (): { athlete: Athlete | null; group: TrainingGroup | null } => {
    if (targetType === 'athlete') {
      const athlete = allAthletes.find(a => a.id === selectedTargetAthleteId) || null;
      return { athlete, group: null };
    }
    if (targetType === 'group') {
      const group = allGroups.find(g => g.id === selectedTargetGroupId) || null;
      return { athlete: null, group };
    }
    return { athlete: null, group: null };
  };

  const target = resolveTarget();

  const isSameContext =
    sourceWeekStart === destinationWeekStart &&
    sourceAthlete?.id === target.athlete?.id &&
    sourceGroup?.id === target.group?.id;

  useEffect(() => {
    void checkDestinationData();
  }, [destinationWeekStart, targetType, selectedTargetAthleteId, selectedTargetGroupId]);

  const checkDestinationData = async () => {
    try {
      const hasData = await checkDestinationWeekHasData(
        destinationWeekStart,
        target.athlete?.id || null,
        target.group?.id || null,
      );
      setDestinationHasData(hasData);
    } catch { /* ignore */ }
  };

  const handlePaste = async () => {
    if (isSameContext) {
      alert('Source and destination are identical');
      return;
    }
    setPasting(true);
    try {
      await copyWeekPlan({
        sourceWeekStart,
        destinationWeekStart,
        sourceAthleteId: sourceAthlete?.id || null,
        sourceGroupId: sourceGroup?.id || null,
        targetAthleteId: target.athlete?.id || null,
        targetGroupId: target.group?.id || null,
        destinationHasData,
      });
      onPasteComplete();
      onClose();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to paste week: ${errorMessage}`);
    } finally {
      setPasting(false);
    }
  };

  const sourceLabel = sourceAthlete
    ? sourceAthlete.name
    : sourceGroup
    ? `${sourceGroup.name} (Group)`
    : 'Unassigned';

  const targetLabel = target.athlete
    ? target.athlete.name
    : target.group
    ? `${target.group.name} (Group)`
    : 'Select target...';

  const isCrossContext =
    sourceAthlete?.id !== target.athlete?.id ||
    sourceGroup?.id !== target.group?.id;

  const hasValidTarget =
    (targetType === 'athlete' && !!selectedTargetAthleteId) ||
    (targetType === 'group' && !!selectedTargetGroupId);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 animate-backdrop-in">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full animate-dialog-in">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Clipboard size={20} className="text-blue-600" />
            <h2 className="text-lg font-medium text-gray-900">Paste Week</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm text-blue-900">
              <span className="font-medium">Source:</span> {sourceLabel} — {formatDateRange(sourceWeekStart)}
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Paste to</label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTargetType('athlete');
                  if (!selectedTargetAthleteId && allAthletes.length > 0) {
                    setSelectedTargetAthleteId(allAthletes[0].id);
                  }
                }}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  targetType === 'athlete' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Athlete
              </button>
              {allGroups.length > 0 && (
                <button
                  onClick={() => {
                    setTargetType('group');
                    if (!selectedTargetGroupId && allGroups.length > 0) {
                      setSelectedTargetGroupId(allGroups[0].id);
                    }
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    targetType === 'group' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Group
                </button>
              )}
            </div>

            {targetType === 'athlete' && (
              <select
                value={selectedTargetAthleteId}
                onChange={(e) => setSelectedTargetAthleteId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select athlete...</option>
                {allAthletes.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}

            {targetType === 'group' && (
              <select
                value={selectedTargetGroupId}
                onChange={(e) => setSelectedTargetGroupId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select group...</option>
                {allGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>

          {hasValidTarget && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2">
              <ArrowRight size={16} className="text-gray-400 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                <span className="font-medium">Destination:</span> {targetLabel} — {formatDateRange(destinationWeekStart)}
              </p>
            </div>
          )}

          {isCrossContext && hasValidTarget && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Cross-context paste: exercises and structure will be copied from <strong>{sourceLabel}</strong> to <strong>{targetLabel}</strong>.
            </div>
          )}

          {destinationHasData && hasValidTarget && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">Warning: Destination week has existing data</p>
                <p className="text-xs mt-1">All existing exercises and combos will be deleted and replaced.</p>
              </div>
            </div>
          )}

          {isSameContext && hasValidTarget && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              Source and destination are identical. Select a different athlete, group, or week.
            </div>
          )}
        </div>

        <div className="flex gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={pasting}
          >
            Cancel
          </button>
          <button
            onClick={() => void handlePaste()}
            disabled={pasting || isSameContext || !hasValidTarget}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {pasting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Pasting...
              </>
            ) : (
              <>
                <Clipboard size={16} />
                Paste Week
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
