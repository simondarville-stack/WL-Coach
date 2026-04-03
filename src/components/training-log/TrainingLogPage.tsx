import { useState } from 'react';
import { useAthleteStore } from '../../store/athleteStore';
import { SessionHistory } from './SessionHistory';
import { SessionView } from './SessionView';
import { CoachSessionView } from './CoachSessionView';

type View =
  | { type: 'history' }
  | { type: 'session'; date: string }
  | { type: 'review'; sessionId: string };

export function TrainingLogPage() {
  const { selectedAthlete } = useAthleteStore();
  const [view, setView] = useState<View>({ type: 'history' });

  if (!selectedAthlete) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <div className="text-gray-500 text-sm mb-2">No athlete selected</div>
          <div className="text-xs text-gray-400">Select an athlete from the dropdown in the header</div>
        </div>
      </div>
    );
  }

  if (view.type === 'session') {
    return (
      <SessionView
        athlete={selectedAthlete}
        date={view.date}
        onBack={() => setView({ type: 'history' })}
      />
    );
  }

  if (view.type === 'review') {
    return (
      <div className="h-full flex flex-col">
        <CoachSessionView
          sessionId={view.sessionId}
          onClose={() => setView({ type: 'history' })}
        />
      </div>
    );
  }

  return (
    <SessionHistory
      athlete={selectedAthlete}
      onOpenSession={date => setView({ type: 'session', date })}
      onReviewSession={sessionId => setView({ type: 'review', sessionId })}
    />
  );
}
