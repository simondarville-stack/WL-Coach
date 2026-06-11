import { describe, it, expect } from 'vitest';
import { hasLoggedWork, isExerciseDone } from '../trainingLogModel';
import type { DayLog, LoggedExerciseFull } from '../trainingLogModel';

function exercise(over: { status?: string; sets?: { status: string }[] } = {}): LoggedExerciseFull {
  return {
    log: { id: 'le1', status: over.status ?? 'pending' } as never,
    sets: (over.sets ?? []) as never,
    exercise: null,
  };
}

function day(over: { sessionStatus?: string | null; exercises?: LoggedExerciseFull[] }): DayLog {
  return {
    date: '2026-06-10',
    dayIndex: 0,
    session: over.sessionStatus === null ? null : ({ status: over.sessionStatus ?? 'pending' } as never),
    exercises: over.exercises ?? [],
    messages: [],
  };
}

describe('hasLoggedWork (COACH-REVIEW-5)', () => {
  it('is false for an empty / null day', () => {
    expect(hasLoggedWork(null)).toBe(false);
    expect(hasLoggedWork(undefined)).toBe(false);
    expect(hasLoggedWork(day({ sessionStatus: 'pending', exercises: [] }))).toBe(false);
  });

  it('is true when the session is explicitly completed', () => {
    expect(hasLoggedWork(day({ sessionStatus: 'completed' }))).toBe(true);
  });

  it('is true when a pending session has at least one completed exercise', () => {
    const d = day({
      sessionStatus: 'in_progress',
      exercises: [exercise({ status: 'completed' }), exercise({ status: 'pending' })],
    });
    expect(d.session?.status).not.toBe('completed');
    expect(hasLoggedWork(d)).toBe(true);
  });

  it('is true when all of an exercise\'s sets reached a terminal status', () => {
    const d = day({
      sessionStatus: 'pending',
      exercises: [exercise({ sets: [{ status: 'completed' }, { status: 'skipped' }] })],
    });
    expect(isExerciseDone(d.exercises[0])).toBe(true);
    expect(hasLoggedWork(d)).toBe(true);
  });

  it('is false when no exercise is done and session is not completed', () => {
    const d = day({
      sessionStatus: 'in_progress',
      exercises: [exercise({ sets: [{ status: 'pending' }] })],
    });
    expect(hasLoggedWork(d)).toBe(false);
  });
});
