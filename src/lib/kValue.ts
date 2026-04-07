import { supabase } from './supabase';

/**
 * Get the competition total for an athlete.
 * If athlete.competition_total is set (manual override), use that.
 * Otherwise, auto-derive from PRs on competition lifts:
 *   total = best Snatch PR + best C&J PR
 */
export async function getCompetitionTotal(athleteId: string): Promise<number | null> {
  // 1. Check manual override
  const { data: athlete } = await supabase
    .from('athletes')
    .select('competition_total')
    .eq('id', athleteId)
    .single();

  if (athlete?.competition_total) return athlete.competition_total;

  // 2. Auto-derive from PRs on competition lifts
  const { data: prs } = await supabase
    .from('athlete_prs')
    .select('pr_value_kg, exercise:exercises!inner(id, is_competition_lift, category)')
    .eq('athlete_id', athleteId);

  if (!prs?.length) return null;

  // Find best snatch and best C&J
  let bestSnatch = 0;
  let bestCJ = 0;

  for (const pr of prs) {
    const ex = pr.exercise as { id: string; is_competition_lift: boolean; category: string } | null;
    if (!ex?.is_competition_lift) continue;
    const val = pr.pr_value_kg ?? 0;
    const cat = (ex.category || '').toLowerCase();

    if (cat.includes('snatch') && !cat.includes('pull') && !cat.includes('power')) {
      bestSnatch = Math.max(bestSnatch, val);
    } else if (
      (cat.includes('clean') && cat.includes('jerk')) ||
      cat === 'clean & jerk' ||
      cat === 'clean and jerk'
    ) {
      bestCJ = Math.max(bestCJ, val);
    }
  }

  if (bestSnatch === 0 || bestCJ === 0) return null;
  return bestSnatch + bestCJ;
}
