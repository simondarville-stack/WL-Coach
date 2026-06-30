/**
 * WeekBriefCard — read-only display of the coach's week-level brief
 * (week_plans.week_description). Shown both on the week-review screen and at
 * the top of the workout/logging menu so the athlete sees the general notes
 * for the whole week before drilling into a single day.
 *
 * Planned data is coach-authored and read-only to athletes — this only ever
 * displays the brief, never edits it. Renders nothing when the brief is empty.
 */
import { Info } from 'lucide-react';

export function WeekBriefCard({ brief }: { brief: string | null | undefined }) {
  if (!brief?.trim()) return null;
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Info size={11} className="text-gray-500 flex-shrink-0" />
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          Week brief
        </span>
      </div>
      <p className="text-xs text-gray-300 whitespace-pre-wrap leading-snug">{brief}</p>
    </div>
  );
}
