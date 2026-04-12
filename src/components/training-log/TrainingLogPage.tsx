import { useState } from 'react';
import { useAthleteStore } from '../../store/athleteStore';
import { AthleteCardPicker } from '../AthleteCardPicker';
import { SessionHistory } from './SessionHistory';
import { SessionView } from './SessionView';
import { CoachSessionView } from './CoachSessionView';

type View =
  | { type: 'history' }
  | { type: 'session'; weekStart: string; dayIndex: number }
  | { type: 'review'; sessionId: string };

export function TrainingLogPage() {
  const { selectedAthlete } = useAthleteStore();
  const [view, setView] = useState<View>({ type: 'history' });

  if (!selectedAthlete) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        <AthleteCardPicker />
      </div>
    );
  }

  if (view.type === 'session') {
    return (
      <SessionView
        athlete={selectedAthlete}
        weekStart={view.weekStart}
        dayIndex={view.dayIndex}
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
      onOpenSession={(weekStart, dayIndex) => setView({ type: 'session', weekStart, dayIndex })}
      onReviewSession={sessionId => setView({ type: 'review', sessionId })}
    />
  );
}
