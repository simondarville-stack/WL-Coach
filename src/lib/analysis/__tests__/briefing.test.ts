import { describe, it, expect } from 'vitest';
import { composeBriefing, type AthleteRaw } from '../briefing';

const clean: AthleteRaw = { name: 'Clean', perf7d: 9500, plan7d: 10000, perfPrior7d: 9000, acwr: 1.1, acwrFlag: 'ok', monotony: 1.4 };
const spiking: AthleteRaw = { name: 'Spike', perf7d: 16000, plan7d: 12000, perfPrior7d: 8000, acwr: 1.7, acwrFlag: 'high', monotony: 1.6 };
const slacking: AthleteRaw = { name: 'Slack', perf7d: 3000, plan7d: 10000, perfPrior7d: 9000, acwr: 0.7, acwrFlag: 'low', monotony: 1.2 };

describe('composeBriefing', () => {
  it('computes adherence and week-over-week delta', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [clean] });
    const a = b.athletes[0];
    expect(a.adherencePct).toBeCloseTo(95, 0);
    expect(a.deltaPct).toBeCloseTo(((9500 - 9000) / 9000) * 100, 1);
    expect(a.flagged).toBe(false);
    expect(a.watch).toHaveLength(0);
  });

  it('flags an ACWR spike and a big volume jump', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [spiking] });
    const a = b.athletes[0];
    expect(a.flagged).toBe(true);
    expect(a.watch.join(' ')).toMatch(/ACWR 1\.70 — load spike/);
    expect(a.watch.join(' ')).toMatch(/volume \+100% vs prior week/);
  });

  it('flags low adherence and an ACWR low', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [slacking] });
    const a = b.athletes[0];
    expect(a.flagged).toBe(true);
    expect(a.watch.join(' ')).toMatch(/adherence 30% — well below plan/);
    expect(a.watch.join(' ')).toMatch(/detraining/);
  });

  it('rolls up the squad', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [clean, spiking, slacking] });
    expect(b.squad.athleteCount).toBe(3);
    expect(b.squad.flagged).toBe(2);
    expect(b.squad.tonnagePerf7d).toBe(9500 + 16000 + 3000);
    expect(b.squad.avgAdherencePct).toBeGreaterThan(0);
  });

  it('handles a missing plan (no adherence, no false flag)', () => {
    const b = composeBriefing({ date: '2026-06-09', athletes: [{ ...clean, plan7d: 0 }] });
    expect(b.athletes[0].adherencePct).toBeNull();
    expect(b.athletes[0].flagged).toBe(false);
  });
});
