import type { WeeklyAggregate, LiftRatio, IntensityZone } from '../hooks/useAnalysis';

export function generateInsights(
  aggregates: WeeklyAggregate[],
  ratios: LiftRatio[],
  zones: IntensityZone[]
): string[] {
  const insights: string[] = [];

  if (!aggregates.length) return insights;

  // 1. Compliance dropping below 85% for 2+ consecutive weeks
  let lowComplianceStreak = 0;
  for (const agg of aggregates) {
    if (agg.plannedReps > 0 && agg.complianceReps < 85) {
      lowComplianceStreak++;
    } else {
      lowComplianceStreak = 0;
    }
    if (lowComplianceStreak >= 2) {
      insights.push(`Compliance has been below 85% for ${lowComplianceStreak} consecutive weeks — check for fatigue, life stress, or planning issues.`);
      break;
    }
  }

  // 2. Volume spike (>20% week-over-week)
  for (let i = 1; i < aggregates.length; i++) {
    const prev = aggregates[i - 1].performedReps;
    const curr = aggregates[i].performedReps;
    if (prev > 0 && curr > prev * 1.2) {
      insights.push(`Volume spike detected: rep count jumped ${Math.round(((curr - prev) / prev) * 100)}% from week of ${aggregates[i - 1].weekStart} to ${aggregates[i].weekStart}.`);
      break;
    }
  }

  // 3. Ratio drift outside target ranges
  for (const ratio of ratios) {
    if (ratio.value > 0 && (ratio.value < ratio.targetMin || ratio.value > ratio.targetMax)) {
      const dir = ratio.value < ratio.targetMin ? 'below' : 'above';
      insights.push(`${ratio.name} ratio (${ratio.value}%) is ${dir} target range ${ratio.target}.`);
    }
  }

  // 4. Intensity zone imbalance — too much low-intensity
  if (zones.length > 0) {
    const lowZone = zones.find(z => z.zone === '<70%');
    if (lowZone && lowZone.percentage > 50) {
      insights.push(`Over 50% of reps are below 70% 1RM — intensity may be too low for meaningful adaptation.`);
    }
  }

  // 5. PR drought (no PRs in aggregates for 4+ weeks)
  // Inferred from zero performed tonnage with planned tonnage — approximation
  const recentAggs = aggregates.slice(-4);
  const allZeroPerformed = recentAggs.length >= 4 && recentAggs.every(a => a.performedTonnage === 0);
  if (allZeroPerformed) {
    insights.push('No training logged in the last 4 weeks — is training log data being recorded?');
  }

  // 6. Tonnage increase without load increase (junk volume)
  if (aggregates.length >= 4) {
    const recent = aggregates.slice(-4);
    const older = aggregates.slice(-8, -4);
    if (older.length > 0) {
      const recentAvgTonnage = recent.reduce((s, a) => s + a.performedTonnage, 0) / recent.length;
      const olderAvgTonnage = older.reduce((s, a) => s + a.performedTonnage, 0) / older.length;
      const recentMaxLoad = Math.max(...recent.flatMap(a => a.exerciseBreakdowns.map(b => b.performedMaxLoad)));
      const olderMaxLoad = Math.max(...older.flatMap(a => a.exerciseBreakdowns.map(b => b.performedMaxLoad)));

      if (recentAvgTonnage > olderAvgTonnage * 1.15 && recentMaxLoad <= olderMaxLoad) {
        insights.push('Tonnage has increased but max loads are flat — volume is rising without intensity. Consider if this is intentional.');
      }
      if (recentMaxLoad > olderMaxLoad * 1.05 && recentAvgTonnage <= olderAvgTonnage) {
        insights.push('Max loads are rising but overall tonnage is flat — quality over quantity trend. Good sign for peaking phase.');
      }
    }
  }

  // Return at most 3 most relevant
  return insights.slice(0, 3);
}
