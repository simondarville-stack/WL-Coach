import { create } from 'zustand';
import type { WeekPlan } from '../lib/database.types';
import { getMondayOfWeek } from '../lib/dateUtils';

interface WeekState {
  currentWeekStart: string;
  weekPlan: WeekPlan | null;
  setCurrentWeekStart: (date: string) => void;
  setWeekPlan: (plan: WeekPlan | null) => void;
}

const todayMonday = getMondayOfWeek(new Date()).toISOString().split('T')[0];

export const useWeekStore = create<WeekState>((set) => ({
  currentWeekStart: todayMonday,
  weekPlan: null,
  setCurrentWeekStart: (currentWeekStart) => set({ currentWeekStart }),
  setWeekPlan: (weekPlan) => set({ weekPlan }),
}));
